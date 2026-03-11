import { join } from "path";
import { exists, readText, writeText } from "./io";

const MEMORY_DIR = ".wf";
const MEMORY_SCOPES_DIR = "scopes";
const MEMORY_JSONL_FILE = "project-memory.jsonl";
const MEMORY_MD_FILE = "project-memory.md";
const MAX_ENTRIES = 500;

export type ProjectMemoryEntry = {
  id: string;
  timestamp: string;
  summary: string;
  phase?: string;
  about?: string;
  implemented: string[];
  next: string[];
};

export type AppendProjectMemoryInput = {
  summary: string;
  phase?: string;
  about?: string;
  implemented?: string[];
  next?: string[];
};

export type ProjectMemoryOptions = {
  scope?: string;
};

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

export function getProjectMemoryPaths(cwd: string, options?: ProjectMemoryOptions) {
  const scope = normalizeScope(options?.scope);
  const dir = scope
    ? join(cwd, MEMORY_DIR, MEMORY_SCOPES_DIR, scope)
    : join(cwd, MEMORY_DIR);
  return {
    dir,
    scope,
    jsonlPath: join(dir, MEMORY_JSONL_FILE),
    markdownPath: join(dir, MEMORY_MD_FILE),
  };
}

function normalizeList(value: string[] | undefined): string[] {
  if (!value) return [];
  return value.map((item) => item.trim()).filter(Boolean);
}

function entryToMarkdown(entry: ProjectMemoryEntry): string {
  const lines: string[] = [];
  lines.push(`## ${entry.timestamp}`);
  lines.push(`- summary: ${entry.summary}`);
  if (entry.phase) lines.push(`- phase: ${entry.phase}`);
  if (entry.about) lines.push(`- about: ${entry.about}`);
  if (entry.implemented.length > 0) {
    lines.push(`- implemented:`);
    for (const item of entry.implemented) {
      lines.push(`  - ${item}`);
    }
  }
  if (entry.next.length > 0) {
    lines.push(`- next:`);
    for (const item of entry.next) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function writeProjectMemoryMarkdown(
  cwd: string,
  entries: ProjectMemoryEntry[],
  options?: ProjectMemoryOptions,
): Promise<void> {
  const { markdownPath } = getProjectMemoryPaths(cwd, options);
  const latest = entries.slice(-100).reverse();
  const sections = latest.map((entry) => entryToMarkdown(entry)).join("\n");
  const content = ["# Project Memory", "", sections.trimEnd(), ""].join("\n");
  await writeText(markdownPath, content);
}

export async function readProjectMemory(
  cwd: string,
  options?: ProjectMemoryOptions,
): Promise<ProjectMemoryEntry[]> {
  const { jsonlPath } = getProjectMemoryPaths(cwd, options);
  if (!(await exists(jsonlPath))) return [];

  const raw = await readText(jsonlPath);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: ProjectMemoryEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<ProjectMemoryEntry>;
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) continue;
      if (typeof parsed.timestamp !== "string" || parsed.timestamp.trim().length === 0) continue;
      const normalized: ProjectMemoryEntry = {
        id:
          typeof parsed.id === "string" && parsed.id.trim().length > 0
            ? parsed.id
            : `${parsed.timestamp}-${entries.length + 1}`,
        timestamp: parsed.timestamp,
        summary: parsed.summary.trim(),
        ...(typeof parsed.phase === "string" && parsed.phase.trim().length > 0
          ? { phase: parsed.phase.trim() }
          : {}),
        ...(typeof parsed.about === "string" && parsed.about.trim().length > 0
          ? { about: parsed.about.trim() }
          : {}),
        implemented: Array.isArray(parsed.implemented)
          ? parsed.implemented.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [],
        next: Array.isArray(parsed.next)
          ? parsed.next.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [],
      };
      entries.push(normalized);
    } catch {
      // Ignore malformed lines; keep memory file resilient.
    }
  }

  return entries;
}

export async function appendProjectMemory(
  cwd: string,
  input: AppendProjectMemoryInput,
  options?: ProjectMemoryOptions,
): Promise<ProjectMemoryEntry> {
  const summary = input.summary.trim();
  if (!summary) throw new Error("Summary cannot be empty.");

  const entries = await readProjectMemory(cwd, options);
  const entry: ProjectMemoryEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    summary,
    ...(input.phase?.trim() ? { phase: input.phase.trim() } : {}),
    ...(input.about?.trim() ? { about: input.about.trim() } : {}),
    implemented: normalizeList(input.implemented),
    next: normalizeList(input.next),
  };

  const nextEntries = [...entries, entry].slice(-MAX_ENTRIES);
  const { jsonlPath } = getProjectMemoryPaths(cwd, options);
  const serialized = `${nextEntries.map((item) => JSON.stringify(item)).join("\n")}\n`;
  await writeText(jsonlPath, serialized);
  await writeProjectMemoryMarkdown(cwd, nextEntries, options);
  return entry;
}

export async function readProjectMemoryRecap(
  cwd: string,
  limit = 8,
  options?: ProjectMemoryOptions,
): Promise<{
  total: number;
  entries: ProjectMemoryEntry[];
  paths: ReturnType<typeof getProjectMemoryPaths>;
}> {
  const entries = await readProjectMemory(cwd, options);
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 8;
  const latest = entries.slice(-normalizedLimit).reverse();
  return {
    total: entries.length,
    entries: latest,
    paths: getProjectMemoryPaths(cwd, options),
  };
}
