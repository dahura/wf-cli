import { join } from "path";
import { ensureDir, exists, readJson, readText, writeJson, writeText } from "./io";
import { listEnabledModelIds } from "./models";

export type SubagentRole =
  | "epic-planner"
  | "plan-coder"
  | "plan-reviewer"
  | "plan-fixer"
  | "plan-verifier";

export const REQUIRED_SUBAGENT_ROLES: readonly SubagentRole[] = [
  "epic-planner",
  "plan-coder",
  "plan-reviewer",
  "plan-fixer",
  "plan-verifier",
] as const;

type SubagentModelConfig = {
  version: 1;
  default_model: string;
  agents: Partial<Record<SubagentRole, string>>;
  opencode_agents?: Partial<Record<SubagentRole, string>>;
  allow_unknown_models?: boolean;
};

type SubagentModelCatalog = {
  version: 1;
  recommended: string[];
  custom: string[];
};

type SubagentAgentFileStatus = {
  role: SubagentRole;
  cursor_file_ok: boolean;
  opencode_file_ok: boolean;
  model: string;
};

export type SubagentPreflightResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  roles: SubagentAgentFileStatus[];
};

type ValidationIssue = {
  message: string;
  model?: string;
  role?: SubagentRole | "default_model";
  suggestion?: string;
  kind: "error" | "warning";
};

const ROLE_DEFAULTS: Record<SubagentRole, string> = {
  "epic-planner": "gpt-5.2",
  "plan-coder": "gpt-5.3-codex",
  "plan-reviewer": "claude-4.5-opus",
  "plan-fixer": "gpt-5.3-codex",
  "plan-verifier": "claude-4.5-opus",
};

const OPENCODE_ROLE_DEFAULTS: Record<SubagentRole, string> = {
  "epic-planner": "alibaba/qwen3.5-plus",
  "plan-coder": "openrouter/minimax2.1",
  "plan-reviewer": "alibaba/qwen3.5-plus",
  "plan-fixer": "openrouter/minimax2.1",
  "plan-verifier": "alibaba/qwen3.5-plus",
};

const CURSOR_ROLE_HINTS: Record<
  SubagentRole,
  { description: string; readonly?: boolean; prompt: string }
> = {
  "epic-planner": {
    description: "Breaks epic scope into clear independent plans.",
    readonly: true,
    prompt:
      "You design implementation plans. Split epics into scoped plans, define dependencies, and maximize independent execution.",
  },
  "plan-coder": {
    description: "Implements TODO items for a single plan.",
    prompt:
      "You implement TODO items for one plan, keep changes scoped, and maintain evidence entries for completed IDs.",
  },
  "plan-reviewer": {
    description: "Reviews plan implementation quality and completeness.",
    readonly: true,
    prompt:
      "You review completed plan work, validate behavior, and produce verdicts per TODO ID: pass, fail, or partial.",
  },
  "plan-fixer": {
    description: "Fixes findings from review for a single plan.",
    prompt:
      "You fix only findings listed in review output, keep scope minimal, and update evidence for corrected TODO IDs.",
  },
  "plan-verifier": {
    description: "Performs skeptical final verification before completion.",
    readonly: true,
    prompt:
      "You independently verify that claimed work is truly complete and tests/validations support completion.",
  },
};

const OPENCODE_ROLE_HINTS: Record<
  SubagentRole,
  { description: string; readonly?: boolean; prompt: string }
> = CURSOR_ROLE_HINTS;

export function getSubagentConfigPath(cwd: string): string {
  return join(cwd, ".wf", "subagents.models.json");
}

export function getSubagentCatalogPath(cwd: string): string {
  return join(cwd, ".wf", "models.catalog.json");
}

function uniqueModels(models: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const model of models) {
    const normalized = normalizeModelInput(model);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output.sort();
}

export function getDefaultSubagentModelCatalog(): SubagentModelCatalog {
  return {
    version: 1,
    recommended: uniqueModels(listEnabledModelIds()),
    custom: uniqueModels(["openrouter/minimax2.1", "alibaba/qwen3.5-plus"]),
  };
}

export function getDefaultSubagentModelConfig(): SubagentModelConfig {
  return {
    version: 1,
    default_model: "gpt-5.3-codex",
    agents: { ...ROLE_DEFAULTS },
    opencode_agents: { ...OPENCODE_ROLE_DEFAULTS },
    allow_unknown_models: true,
  };
}

function resolveRoleModel(
  config: SubagentModelConfig,
  role: SubagentRole,
  runtime: "cursor" | "opencode" = "cursor",
): string {
  if (runtime === "opencode") {
    const runtimeModel = config.opencode_agents?.[role] ?? OPENCODE_ROLE_DEFAULTS[role];
    return runtimeModel ?? config.agents[role] ?? config.default_model;
  }
  return config.agents[role] ?? config.default_model;
}

function normalizeModelInput(value: string): string {
  return value.trim();
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function suggestModel(input: string, knownModels: string[]): string | undefined {
  const target = normalizeModelInput(input).toLowerCase();
  const known = uniqueModels(knownModels);
  let best: { id: string; distance: number } | null = null;
  for (const id of known) {
    const distance = levenshtein(target, id.toLowerCase());
    if (!best || distance < best.distance) {
      best = { id, distance };
    }
  }

  if (!best) return undefined;
  return best.distance <= 10 ? best.id : undefined;
}

function formatUnknownModelIssue(
  model: string,
  role: SubagentRole | "default_model",
  knownModels: string[],
  asWarning: boolean,
): ValidationIssue {
  const normalized = normalizeModelInput(model);
  const suggestion = suggestModel(normalized, knownModels);
  const scope = role === "default_model" ? "default_model" : `role '${role}'`;
  return {
    message:
      (suggestion
      ? `Unknown or disabled model '${normalized}' for ${scope}. Did you mean '${suggestion}'?`
      : `Unknown model '${normalized}' for ${scope}.`) +
      (asWarning
        ? " Keeping it because allow_unknown_models=true."
        : " Add it to .wf/models.catalog.json or enable allow_unknown_models."),
    model: normalized,
    role,
    suggestion,
    kind: asWarning ? "warning" : "error",
  };
}

function resolveKnownModels(catalog: SubagentModelCatalog): string[] {
  return uniqueModels([...catalog.recommended, ...catalog.custom]);
}

export function listSupportedSubagentModels(catalog: SubagentModelCatalog): string[] {
  return resolveKnownModels(catalog);
}

export function validateSubagentModelConfig(
  config: SubagentModelConfig,
  catalog: SubagentModelCatalog = getDefaultSubagentModelCatalog(),
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: ValidationIssue[] = [];
  const knownModels = resolveKnownModels(catalog);
  const allowUnknown = config.allow_unknown_models ?? true;

  if (config.version !== 1) {
    errors.push(`Unsupported config version '${String(config.version)}'. Expected version 1.`);
    issues.push({
      message: `Unsupported config version '${String(config.version)}'. Expected version 1.`,
      kind: "error",
    });
  }

  if (catalog.version !== 1) {
    errors.push(`Unsupported model catalog version '${String(catalog.version)}'. Expected version 1.`);
    issues.push({
      message: `Unsupported model catalog version '${String(catalog.version)}'. Expected version 1.`,
      kind: "error",
    });
  }

  const normalizedDefault = normalizeModelInput(config.default_model);
  if (!knownModels.includes(normalizedDefault)) {
    const issue = formatUnknownModelIssue(normalizedDefault, "default_model", knownModels, allowUnknown);
    if (issue.kind === "error") {
      errors.push(issue.message);
    } else {
      warnings.push(issue.message);
    }
    issues.push(issue);
  }

  for (const role of Object.keys(ROLE_DEFAULTS) as SubagentRole[]) {
    const model = normalizeModelInput(resolveRoleModel(config, role));
    if (!knownModels.includes(model)) {
      const issue = formatUnknownModelIssue(model, role, knownModels, allowUnknown);
      if (issue.kind === "error") {
        errors.push(issue.message);
      } else {
        warnings.push(issue.message);
      }
      issues.push(issue);
    }
    const opencodeModel = normalizeModelInput(resolveRoleModel(config, role, "opencode"));
    if (!knownModels.includes(opencodeModel)) {
      const issue = formatUnknownModelIssue(opencodeModel, role, knownModels, allowUnknown);
      if (issue.kind === "error") {
        errors.push(`[opencode] ${issue.message}`);
      } else {
        warnings.push(`[opencode] ${issue.message}`);
      }
      issues.push(issue);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
  };
}

export async function initSubagentModelConfig(cwd: string) {
  const configPath = getSubagentConfigPath(cwd);
  if (await exists(configPath)) {
    await initSubagentModelCatalog(cwd);
    return { created: false, path: configPath };
  }

  const defaults = getDefaultSubagentModelConfig();
  await writeJson(configPath, defaults);
  await initSubagentModelCatalog(cwd);
  return { created: true, path: configPath };
}

export async function initSubagentModelCatalog(cwd: string) {
  const catalogPath = getSubagentCatalogPath(cwd);
  if (await exists(catalogPath)) {
    return { created: false, path: catalogPath };
  }
  await writeJson(catalogPath, getDefaultSubagentModelCatalog());
  return { created: true, path: catalogPath };
}

export async function readSubagentModelConfig(cwd: string): Promise<SubagentModelConfig> {
  const configPath = getSubagentConfigPath(cwd);
  if (!(await exists(configPath))) {
    return getDefaultSubagentModelConfig();
  }
  return readJson<SubagentModelConfig>(configPath);
}

export async function readSubagentModelCatalog(cwd: string): Promise<SubagentModelCatalog> {
  const catalogPath = getSubagentCatalogPath(cwd);
  if (!(await exists(catalogPath))) {
    return getDefaultSubagentModelCatalog();
  }
  const parsed = await readJson<SubagentModelCatalog>(catalogPath);
  return {
    version: parsed?.version ?? 1,
    recommended: uniqueModels(Array.isArray(parsed?.recommended) ? parsed.recommended : []),
    custom: uniqueModels(Array.isArray(parsed?.custom) ? parsed.custom : []),
  };
}

function renderCursorAgent(role: SubagentRole, model: string) {
  const hint = CURSOR_ROLE_HINTS[role];
  const readonly = hint.readonly ? "true" : "false";
  return `---
name: ${role}
description: ${hint.description}
model: ${model}
readonly: ${readonly}
---

${hint.prompt}
`;
}

function renderOpencodeAgent(role: SubagentRole, model: string) {
  const hint = OPENCODE_ROLE_HINTS[role];
  const readonlyBlock = hint.readonly
    ? `permission:
  edit: deny
  bash: ask
`
    : "";
  return `---
description: ${hint.description}
mode: subagent
model: ${model}
${readonlyBlock}---

${hint.prompt}
`;
}

export async function applySubagentModelConfig(
  cwd: string,
  config: SubagentModelConfig,
  catalog: SubagentModelCatalog = getDefaultSubagentModelCatalog(),
) {
  const validation = validateSubagentModelConfig(config, catalog);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  const cursorDir = join(cwd, ".cursor", "agents");
  const opencodeDir = join(cwd, ".opencode", "agents");
  await ensureDir(cursorDir);
  await ensureDir(opencodeDir);

  const applied: Record<SubagentRole, string> = {} as Record<SubagentRole, string>;

  for (const role of Object.keys(ROLE_DEFAULTS) as SubagentRole[]) {
    const cursorModel = normalizeModelInput(resolveRoleModel(config, role, "cursor"));
    const opencodeModel = normalizeModelInput(resolveRoleModel(config, role, "opencode"));
    applied[role] = cursorModel;

    await writeText(join(cursorDir, `${role}.md`), renderCursorAgent(role, cursorModel));
    await writeText(join(opencodeDir, `${role}.md`), renderOpencodeAgent(role, opencodeModel));
  }

  return { applied };
}

function isAgentSpecContentValid(content: string): boolean {
  const normalized = content.trim();
  return (
    normalized.length >= 32 &&
    normalized.includes("name:") &&
    normalized.includes("model:") &&
    normalized.includes("description:")
  );
}

async function checkAgentSpec(path: string): Promise<boolean> {
  if (!(await exists(path))) return false;
  const content = await readText(path);
  return isAgentSpecContentValid(content);
}

export async function runSubagentPreflight(cwd: string): Promise<SubagentPreflightResult> {
  const config = await readSubagentModelConfig(cwd);
  const catalog = await readSubagentModelCatalog(cwd);
  const validation = validateSubagentModelConfig(config, catalog);

  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  const roles: SubagentAgentFileStatus[] = [];

  for (const role of REQUIRED_SUBAGENT_ROLES) {
    const model = resolveRoleModel(config, role);
    const cursorPath = join(cwd, ".cursor", "agents", `${role}.md`);
    const opencodePath = join(cwd, ".opencode", "agents", `${role}.md`);
    const cursorOk = await checkAgentSpec(cursorPath);
    const opencodeOk = await checkAgentSpec(opencodePath);

    if (!cursorOk) {
      errors.push(
        `Missing or invalid agent spec '.cursor/agents/${role}.md'. Run 'bun run wf sync --reseed && bun run wf sync'.`,
      );
    }
    if (!opencodeOk) {
      warnings.push(
        `Missing or invalid agent spec '.opencode/agents/${role}.md'. Run 'bun run wf sync --reseed && bun run wf sync'.`,
      );
    }

    roles.push({
      role,
      cursor_file_ok: cursorOk,
      opencode_file_ok: opencodeOk,
      model,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    roles,
  };
}
