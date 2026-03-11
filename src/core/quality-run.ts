import { createHash } from "node:crypto";
import { join } from "path";
import { readJson, writeJson } from "./io";

export type StrictProfile = "fast" | "default" | "full";

export type StrictCheckResult = {
  name: string;
  command: string;
  exit_code: number;
  duration_ms: number;
  stdout_sha256: string;
  stderr_sha256: string;
  skipped?: boolean;
  skip_reason?: string;
};

export type QualityRunArtifact = {
  schema_version: 1;
  mode: "strict";
  strict_profile: StrictProfile;
  plan_ref: string;
  created_at: string;
  git: {
    head: string;
    dirty: boolean;
  };
  checks: StrictCheckResult[];
  ok: boolean;
};

const QUALITY_ARTIFACT_FILE = "quality-run.json";

function hashText(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function runCommand(cwd: string, command: string): Promise<{
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}> {
  const started = Date.now();
  const proc = Bun.spawn(["bash", "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    exitCode,
    durationMs: Date.now() - started,
    stdout,
    stderr,
  };
}

async function detectChecks(cwd: string, profile: StrictProfile): Promise<Array<{ name: string; command: string }>> {
  const pkgPath = join(cwd, "package.json");
  let scripts: Record<string, string> = {};
  try {
    const pkg = await readJson<{ scripts?: Record<string, string> }>(pkgPath);
    scripts = pkg.scripts ?? {};
  } catch {
    scripts = {};
  }

  const checks: Array<{ name: string; command: string }> = [];
  if (scripts.typecheck) checks.push({ name: "typecheck", command: "bun run typecheck" });
  if (profile !== "fast" && scripts.lint) checks.push({ name: "lint", command: "bun run lint" });
  if (scripts.test) checks.push({ name: "test", command: "bun run test" });
  else checks.push({ name: "test", command: "bun test" });
  if (profile === "full" && scripts["test:integration"]) {
    checks.push({ name: "test:integration", command: "bun run test:integration" });
  }

  return checks;
}

async function readGitHead(cwd: string): Promise<string> {
  const result = await runCommand(cwd, "git rev-parse HEAD");
  if (result.exitCode !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

async function readGitDirty(cwd: string): Promise<boolean> {
  const result = await runCommand(cwd, "git status --porcelain");
  if (result.exitCode !== 0) return false;
  return result.stdout.trim().length > 0;
}

export async function runStrictQualityChecks(input: {
  cwd: string;
  planDirPath: string;
  planRef: string;
  profile: StrictProfile;
}): Promise<QualityRunArtifact> {
  const checks = await detectChecks(input.cwd, input.profile);
  checks.push({
    name: "wf_verify",
    command: `bun run wf verify ${input.planRef} --target=review --json`,
  });

  const results: StrictCheckResult[] = [];
  for (const check of checks) {
    const run = await runCommand(input.cwd, check.command);
    results.push({
      name: check.name,
      command: check.command,
      exit_code: run.exitCode,
      duration_ms: run.durationMs,
      stdout_sha256: hashText(run.stdout),
      stderr_sha256: hashText(run.stderr),
    });
  }

  const artifact: QualityRunArtifact = {
    schema_version: 1,
    mode: "strict",
    strict_profile: input.profile,
    plan_ref: input.planRef,
    created_at: new Date().toISOString(),
    git: {
      head: await readGitHead(input.cwd),
      dirty: await readGitDirty(input.cwd),
    },
    checks: results,
    ok: results.every((check) => check.exit_code === 0),
  };

  await writeJson(join(input.planDirPath, QUALITY_ARTIFACT_FILE), artifact);
  return artifact;
}

export async function readStrictQualityArtifact(planDirPath: string): Promise<QualityRunArtifact> {
  return readJson<QualityRunArtifact>(join(planDirPath, QUALITY_ARTIFACT_FILE));
}

export function qualityArtifactPath(planDirPath: string): string {
  return join(planDirPath, QUALITY_ARTIFACT_FILE);
}
