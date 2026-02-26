import { dirname, join, relative } from "path";
import { ensureDir, exists, readJson, readText, removeDir, writeJson, writeText } from "./core/io";

const AGENTS = ["cursor", "opencode"] as const;
const WORKSPACE_TEMPLATE_ROOT = join(".wf", "templates");
const WORKSPACE_SKILLS_ROOT = join(".wf", "skills");
const WORKSPACE_MANAGED_FILE = join(".wf", "managed-files.json");
const BUNDLED_TEMPLATE_ROOT = join(import.meta.dir, "..", "templates");
const KINDS = ["commands", "rules", "agents"] as const;

type Agent = (typeof AGENTS)[number];
type AssetKind = (typeof KINDS)[number];

type ManagedEntry = {
  agent: Agent;
  kind: AssetKind;
  relativePath: string;
};

type ManagedConfig = {
  version: 1;
  entries: ManagedEntry[];
};

async function listFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];

  const glob = new Bun.Glob("**/*");
  const out: string[] = [];

  for await (const relPath of glob.scan({ cwd: dir, dot: true })) {
    const fullPath = join(dir, relPath);
    out.push(fullPath);
  }

  return out;
}

async function copyFile(src: string, dest: string) {
  const content = await readText(src);
  await writeText(dest, content);
}

async function isTemplateSeeded(repoRoot: string) {
  for (const agent of AGENTS) {
    const commandsDir = join(repoRoot, WORKSPACE_TEMPLATE_ROOT, agent, "commands");
    const agentsDir = join(repoRoot, WORKSPACE_TEMPLATE_ROOT, agent, "agents");
    if ((await exists(commandsDir)) || (await exists(agentsDir))) return true;
  }
  return false;
}

async function copyTemplateTree(sourceRoot: string, destRoot: string) {
  const files = await listFiles(sourceRoot);
  for (const file of files) {
    const rel = relative(sourceRoot, file);
    if (!rel || rel.startsWith("..")) continue;
    if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;
    const dest = join(destRoot, rel);
    await ensureDir(dirname(dest));
    await copyFile(file, dest);
  }
}

async function copyTree(sourceRoot: string, destRoot: string) {
  const files = await listFiles(sourceRoot);
  for (const file of files) {
    const rel = relative(sourceRoot, file);
    if (!rel || rel.startsWith("..")) continue;
    const dest = join(destRoot, rel);
    await ensureDir(dirname(dest));
    await copyFile(file, dest);
  }
}

async function listSkillNames(repoRoot: string): Promise<string[]> {
  const skillsRoot = join(repoRoot, WORKSPACE_SKILLS_ROOT);
  if (!(await exists(skillsRoot))) return [];

  const glob = new Bun.Glob("*/SKILL.md");
  const names = new Set<string>();
  for await (const relPath of glob.scan({ cwd: skillsRoot, dot: true })) {
    const skillName = relPath.slice(0, relPath.indexOf("/"));
    if (skillName) names.add(skillName);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function syncSkills(repoRoot: string) {
  const skillNames = await listSkillNames(repoRoot);
  for (const skillName of skillNames) {
    const source = join(repoRoot, WORKSPACE_SKILLS_ROOT, skillName);
    for (const agent of AGENTS) {
      const destination = join(repoRoot, `.${agent}`, "skills", skillName);
      await removeDir(destination);
      await ensureDir(destination);
      await copyTree(source, destination);
    }
  }
}

function uniqueEntries(entries: ManagedEntry[]): ManagedEntry[] {
  const seen = new Set<string>();
  const out: ManagedEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.agent}:${entry.kind}:${entry.relativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function collectEntriesFromTemplateRoot(templateRoot: string): Promise<ManagedEntry[]> {
  const entries: ManagedEntry[] = [];
  for (const agent of AGENTS) {
    for (const kind of KINDS) {
      const baseDir = join(templateRoot, agent, kind);
      const files = (await listFiles(baseDir)).filter((path) =>
        kind === "commands" || kind === "agents"
          ? path.endsWith(".md")
          : path.endsWith(".md") || path.endsWith(".mdc"),
      );

      for (const file of files) {
        const rel = relative(baseDir, file);
        if (!rel || rel.startsWith("..")) continue;
        entries.push({ agent, kind, relativePath: rel });
      }
    }
  }

  return uniqueEntries(entries).sort((a, b) => {
    const left = `${a.agent}:${a.kind}:${a.relativePath}`;
    const right = `${b.agent}:${b.kind}:${b.relativePath}`;
    return left.localeCompare(right);
  });
}

async function readManagedConfig(repoRoot: string): Promise<ManagedConfig | null> {
  const configPath = join(repoRoot, WORKSPACE_MANAGED_FILE);
  if (!(await exists(configPath))) return null;

  const parsed = await readJson<ManagedConfig>(configPath);
  if (!parsed || !Array.isArray(parsed.entries)) return null;

  return {
    version: 1,
    entries: uniqueEntries(parsed.entries),
  };
}

async function writeManagedConfig(repoRoot: string, entries: ManagedEntry[]) {
  const configPath = join(repoRoot, WORKSPACE_MANAGED_FILE);
  const payload: ManagedConfig = {
    version: 1,
    entries: uniqueEntries(entries),
  };
  await writeJson(configPath, payload);
}

async function seedBundledTemplates(repoRoot: string) {
  const workspaceTemplates = join(repoRoot, WORKSPACE_TEMPLATE_ROOT);
  await ensureDir(workspaceTemplates);

  for (const agent of AGENTS) {
    const source = join(BUNDLED_TEMPLATE_ROOT, agent);
    const destination = join(workspaceTemplates, agent);
    await copyTemplateTree(source, destination);
  }
}

async function captureWorkspaceAsTemplates(repoRoot: string) {
  for (const agent of AGENTS) {
    const sourceCommandsDir = join(repoRoot, `.${agent}`, "commands");
    const sourceRulesDir = join(repoRoot, `.${agent}`, "rules");
    const sourceAgentsDir = join(repoRoot, `.${agent}`, "agents");

    const commandFiles = (await listFiles(sourceCommandsDir)).filter((path) =>
      path.endsWith(".md"),
    );
    const ruleFiles = (await listFiles(sourceRulesDir)).filter((path) =>
      path.endsWith(".md") || path.endsWith(".mdc"),
    );
    const agentFiles = (await listFiles(sourceAgentsDir)).filter((path) => path.endsWith(".md"));

    if (commandFiles.length === 0 || ruleFiles.length === 0) {
      throw new Error(
        `Cannot capture templates for .${agent}. Missing commands or rules in workspace.`,
      );
    }

    for (const file of commandFiles) {
      const rel = file.slice(sourceCommandsDir.length + 1);
      const dest = join(
        repoRoot,
        WORKSPACE_TEMPLATE_ROOT,
        agent,
        "commands",
        rel,
      );
      await copyFile(file, dest);
    }

    for (const file of ruleFiles) {
      const rel = file.slice(sourceRulesDir.length + 1);
      const dest = join(repoRoot, WORKSPACE_TEMPLATE_ROOT, agent, "rules", rel);
      await copyFile(file, dest);
    }

    for (const file of agentFiles) {
      const rel = file.slice(sourceAgentsDir.length + 1);
      const dest = join(repoRoot, WORKSPACE_TEMPLATE_ROOT, agent, "agents", rel);
      await copyFile(file, dest);
    }
  }
}

async function ensureManagedConfig(repoRoot: string): Promise<ManagedEntry[]> {
  const fromWorkspaceTemplates = await collectEntriesFromTemplateRoot(
    join(repoRoot, WORKSPACE_TEMPLATE_ROOT),
  );
  if (fromWorkspaceTemplates.length === 0) {
    throw new Error("Templates are not initialized. Run 'wf init' first.");
  }

  const fromBundledTemplates = await collectEntriesFromTemplateRoot(BUNDLED_TEMPLATE_ROOT);
  const existing = await readManagedConfig(repoRoot);

  const merged = uniqueEntries([
    ...(existing?.entries ?? fromWorkspaceTemplates),
    ...fromBundledTemplates,
  ]);

  await writeManagedConfig(repoRoot, merged);
  return merged;
}

async function syncManagedEntries(repoRoot: string, entries: ManagedEntry[]) {
  for (const entry of entries) {
    const src = join(
      repoRoot,
      WORKSPACE_TEMPLATE_ROOT,
      entry.agent,
      entry.kind,
      entry.relativePath,
    );

    if (!(await exists(src))) {
      continue;
    }

    const dest = join(
      repoRoot,
      `.${entry.agent}`,
      entry.kind,
      entry.relativePath,
    );
    await copyFile(src, dest);
  }
}

export async function runInit(repoRoot: string) {
  if (!(await isTemplateSeeded(repoRoot))) {
    if (await exists(BUNDLED_TEMPLATE_ROOT)) {
      await seedBundledTemplates(repoRoot);
    } else {
      await captureWorkspaceAsTemplates(repoRoot);
    }
  }

  const entries = await ensureManagedConfig(repoRoot);
  await syncManagedEntries(repoRoot, entries);
  await syncSkills(repoRoot);

  console.log("✅ wf templates initialized and synced for .cursor and .opencode (skills synced)");
}

export async function runInitWithOptions(
  repoRoot: string,
  options?: {
    force?: boolean;
  },
) {
  if (options?.force) {
    await removeDir(join(repoRoot, WORKSPACE_TEMPLATE_ROOT));
    if (await exists(BUNDLED_TEMPLATE_ROOT)) {
      await seedBundledTemplates(repoRoot);
    } else {
      await captureWorkspaceAsTemplates(repoRoot);
    }
  }
  await runInit(repoRoot);
}

export async function runSync(
  repoRoot: string,
  options?: {
    reseed?: boolean;
  },
) {
  if (options?.reseed) {
    await removeDir(join(repoRoot, WORKSPACE_TEMPLATE_ROOT));
    if (await exists(BUNDLED_TEMPLATE_ROOT)) {
      await seedBundledTemplates(repoRoot);
    } else {
      await captureWorkspaceAsTemplates(repoRoot);
    }
  }

  const entries = await ensureManagedConfig(repoRoot);
  await syncManagedEntries(repoRoot, entries);
  await syncSkills(repoRoot);

  console.log(
    options?.reseed
      ? "✅ wf templates reseeded and synced to .cursor and .opencode (skills synced)"
      : "✅ wf templates synced to .cursor and .opencode (skills synced)",
  );
}

export async function runSkillSync(repoRoot: string) {
  await syncSkills(repoRoot);
  console.log("✅ wf skills synced to .cursor/skills and .opencode/skills");
}
