import { join } from "path";
import { exists, readJson, readText, writeJson, writeText } from "./io";

const PROJECT_BRIEF_JSON = "project-brief.json";
const PROJECT_BRIEF_MD = "project-brief.md";
const PROJECT_SCOPES_DIR = "scopes";

export type ProjectBrief = {
  summary: string;
  product?: string;
  users?: string;
  stack?: string;
  constraints: string[];
  successCriteria: string[];
  updatedAt: string;
};

export type UpsertProjectBriefInput = {
  summary: string;
  product?: string;
  users?: string;
  stack?: string;
  constraints?: string[];
  successCriteria?: string[];
};

export type ProjectBriefOptions = {
  scope?: string;
};

function normalizeList(value: string[] | undefined): string[] {
  if (!value) return [];
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizeScope(scope: string | undefined): string | null {
  const value = scope?.trim();
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function getProjectBriefPaths(cwd: string, options?: ProjectBriefOptions) {
  const scope = normalizeScope(options?.scope);
  const dir = scope ? join(cwd, ".wf", PROJECT_SCOPES_DIR, scope) : join(cwd, ".wf");
  return {
    dir,
    scope,
    jsonPath: join(dir, PROJECT_BRIEF_JSON),
    markdownPath: join(dir, PROJECT_BRIEF_MD),
  };
}

function renderBriefMarkdown(brief: ProjectBrief): string {
  const lines: string[] = [];
  lines.push("# Project Brief");
  lines.push("");
  lines.push(`- updated_at: ${brief.updatedAt}`);
  lines.push(`- summary: ${brief.summary}`);
  if (brief.product) lines.push(`- product: ${brief.product}`);
  if (brief.users) lines.push(`- users: ${brief.users}`);
  if (brief.stack) lines.push(`- stack: ${brief.stack}`);
  if (brief.constraints.length > 0) {
    lines.push("- constraints:");
    for (const item of brief.constraints) lines.push(`  - ${item}`);
  }
  if (brief.successCriteria.length > 0) {
    lines.push("- success_criteria:");
    for (const item of brief.successCriteria) lines.push(`  - ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function readProjectBrief(
  cwd: string,
  options?: ProjectBriefOptions,
): Promise<ProjectBrief | null> {
  const { jsonPath } = getProjectBriefPaths(cwd, options);
  if (!(await exists(jsonPath))) return null;

  try {
    const parsed = await readJson<Partial<ProjectBrief>>(jsonPath);
    if (!parsed || typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) {
      return null;
    }
    return {
      summary: parsed.summary.trim(),
      ...(typeof parsed.product === "string" && parsed.product.trim().length > 0
        ? { product: parsed.product.trim() }
        : {}),
      ...(typeof parsed.users === "string" && parsed.users.trim().length > 0
        ? { users: parsed.users.trim() }
        : {}),
      ...(typeof parsed.stack === "string" && parsed.stack.trim().length > 0
        ? { stack: parsed.stack.trim() }
        : {}),
      constraints: normalizeList(Array.isArray(parsed.constraints) ? parsed.constraints : []),
      successCriteria: normalizeList(
        Array.isArray(parsed.successCriteria) ? parsed.successCriteria : [],
      ),
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function upsertProjectBrief(
  cwd: string,
  input: UpsertProjectBriefInput,
  options?: ProjectBriefOptions,
): Promise<ProjectBrief> {
  const summary = input.summary.trim();
  if (!summary) throw new Error("Project summary cannot be empty.");

  const brief: ProjectBrief = {
    summary,
    ...(input.product?.trim() ? { product: input.product.trim() } : {}),
    ...(input.users?.trim() ? { users: input.users.trim() } : {}),
    ...(input.stack?.trim() ? { stack: input.stack.trim() } : {}),
    constraints: normalizeList(input.constraints),
    successCriteria: normalizeList(input.successCriteria),
    updatedAt: new Date().toISOString(),
  };

  const { jsonPath, markdownPath } = getProjectBriefPaths(cwd, options);
  await writeJson(jsonPath, brief);
  await writeText(markdownPath, renderBriefMarkdown(brief));
  return brief;
}

export async function readProjectBriefMarkdown(
  cwd: string,
  options?: ProjectBriefOptions,
): Promise<string | null> {
  const { markdownPath } = getProjectBriefPaths(cwd, options);
  if (!(await exists(markdownPath))) return null;
  return readText(markdownPath);
}
