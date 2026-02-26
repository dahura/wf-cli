import { join } from "path";
import { exists, listDirEntries } from "./io";
import { getAllowedWorkflowCommandsForPhase } from "./orchestration-contract";

export type ContextInclude = "plan" | "todo" | "review" | "evidence" | "state" | "epic";

export type ResolvedPlan = {
  id: string;
  dirName: string;
  dirPath: string;
};

const CONTEXT_INCLUDE_KEYS = new Set<ContextInclude>([
  "plan",
  "todo",
  "review",
  "evidence",
  "state",
  "epic",
]);

export async function listPlanDirectories(cwd: string): Promise<string[]> {
  const plansDir = join(cwd, "plans");
  if (!(await exists(plansDir))) return [];

  return (await listDirEntries(plansDir)).filter((name) => /^\d{2}-/.test(name));
}

export function normalizePlanId(planRef: string): string | null {
  const match = planRef.match(/^(\d{1,2})(?:$|-)/);
  if (!match) return null;
  return match[1].padStart(2, "0");
}

export async function resolvePlan(cwd: string, planRef: string): Promise<ResolvedPlan | null> {
  const plansDir = join(cwd, "plans");
  const directories = await listPlanDirectories(cwd);
  if (directories.length === 0) return null;

  const exact = directories.find((name) => name === planRef);
  if (exact) {
    return {
      id: exact.slice(0, 2),
      dirName: exact,
      dirPath: join(plansDir, exact),
    };
  }

  const normalizedId = normalizePlanId(planRef);
  if (!normalizedId) return null;

  const prefixed = directories.find((name) => name.startsWith(`${normalizedId}-`));
  if (!prefixed) return null;

  return {
    id: normalizedId,
    dirName: prefixed,
    dirPath: join(plansDir, prefixed),
  };
}

export async function availablePlanIds(cwd: string): Promise<string[]> {
  const ids = (await listPlanDirectories(cwd)).map((name) => name.slice(0, 2));
  return [...new Set(ids)].sort();
}

export function parseContextArgs(values: string[]) {
  let planRef: string | undefined;
  let asJson = false;
  let includeRaw = "";

  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];

    if (token === "--json") {
      asJson = true;
      continue;
    }

    if (token === "--include") {
      const includeValue = values[i + 1];
      if (!includeValue || includeValue.startsWith("--")) {
        return {
          error: "Option '--include' requires a comma-separated value.",
          asJson,
        };
      }
      includeRaw = includeValue;
      i += 1;
      continue;
    }

    if (token.startsWith("--include=")) {
      includeRaw = token.slice("--include=".length);
      continue;
    }

    if (token.startsWith("--")) {
      return { error: `Unknown option '${token}'.`, asJson };
    }

    if (planRef) {
      return {
        error: `Unexpected extra argument '${token}'. Provide only one plan reference.`,
        asJson,
      };
    }

    planRef = token;
  }

  const include = new Set<ContextInclude>();
  if (includeRaw) {
    const items = includeRaw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    for (const item of items) {
      if (!CONTEXT_INCLUDE_KEYS.has(item as ContextInclude)) {
        return {
          error: `Unknown include key '${item}'. Allowed: plan,todo,review,evidence,state,epic.`,
          asJson,
        };
      }

      include.add(item as ContextInclude);
    }
  }

  return { planRef, asJson, include };
}

export function getAllowedNextCommands(phase: string): string[] {
  return getAllowedWorkflowCommandsForPhase(phase);
}
