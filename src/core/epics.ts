import { join } from "path";
import { ensureDir, exists, listDirEntries, readJson, readText, writeJson, writeText } from "./io";
import { createPlan, getPlanPhase, type PlanPhase } from "./plans";
import { publishPlanPhaseJobs } from "./dispatcher";

export type EpicState = {
  phase: "active" | "completed" | "blocked";
  created_at: string;
  plan_ids: string[];
  orchestration?: {
    status: "idle" | "running" | "paused" | "failed" | "completed";
    started_at?: string;
    updated_at?: string;
    last_error?: string;
    last_run_summary?: string;
  };
};
type EpicOrchestrationState = NonNullable<EpicState["orchestration"]>;

export type ResolvedEpic = {
  id: string;
  dirName: string;
  dirPath: string;
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function nextEpicNumber(): Promise<string> {
  const epicsDir = join(process.cwd(), "epics");
  if (!(await exists(epicsDir))) {
    await ensureDir(epicsDir);
    return "01";
  }

  const entries = (await listDirEntries(epicsDir))
    .filter((name) => /^\d{2}-/.test(name))
    .map((name) => parseInt(name.slice(0, 2), 10));

  if (entries.length === 0) return "01";
  return String(Math.max(...entries) + 1).padStart(2, "0");
}

export async function listEpicDirectories(cwd: string): Promise<string[]> {
  const epicsDir = join(cwd, "epics");
  if (!(await exists(epicsDir))) return [];
  return (await listDirEntries(epicsDir)).filter((name) => /^\d{2}-/.test(name));
}

export function normalizeEpicId(epicRef: string): string | null {
  const match = epicRef.match(/^(\d{1,2})(?:$|-)/);
  if (!match) return null;
  return match[1].padStart(2, "0");
}

export async function resolveEpic(cwd: string, epicRef: string): Promise<ResolvedEpic | null> {
  const epicsDir = join(cwd, "epics");
  const directories = await listEpicDirectories(cwd);
  if (directories.length === 0) return null;

  const exact = directories.find((name) => name === epicRef);
  if (exact) {
    return {
      id: exact.slice(0, 2),
      dirName: exact,
      dirPath: join(epicsDir, exact),
    };
  }

  const normalized = normalizeEpicId(epicRef);
  if (!normalized) return null;
  const prefixed = directories.find((name) => name.startsWith(`${normalized}-`));
  if (!prefixed) return null;
  return {
    id: normalized,
    dirName: prefixed,
    dirPath: join(epicsDir, prefixed),
  };
}

export async function availableEpicIds(cwd: string): Promise<string[]> {
  const ids = (await listEpicDirectories(cwd)).map((name) => name.slice(0, 2));
  return [...new Set(ids)].sort();
}

function renderPlansMapYaml(planIds: string[]) {
  const lines = ["plans:"];
  if (planIds.length === 0) {
    lines.push("  []");
    return `${lines.join("\n")}\n`;
  }

  for (const planId of [...planIds].sort()) {
    lines.push(`  - ${planId}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readEpicState(epicPath: string): Promise<EpicState> {
  const statePath = join(epicPath, "state.json");
  if (!(await exists(statePath))) {
    throw new Error("Epic state.json not found.");
  }
  return readJson<EpicState>(statePath);
}

async function writeEpicState(epicPath: string, state: EpicState) {
  await writeJson(join(epicPath, "state.json"), state);
  await writeText(join(epicPath, "plans-map.yaml"), renderPlansMapYaml(state.plan_ids));
}

function nowIso() {
  return new Date().toISOString();
}

async function appendEpicReport(epicPath: string, lines: string[]) {
  const reportPath = join(epicPath, "report.md");
  const existing = (await exists(reportPath)) ? await readText(reportPath) : "# Epic Report\n\n";
  const block = [`## ${nowIso()}`, ...lines].join("\n");
  const next = `${existing.trimEnd()}\n\n${block}\n`;
  await writeText(reportPath, next);
}

function ensureOrchestration(state: EpicState): EpicOrchestrationState {
  return state.orchestration ?? { status: "idle" };
}

export async function createEpic(name: string) {
  const number = await nextEpicNumber();
  const slug = slugify(name);
  const epicDir = join(process.cwd(), "epics", `${number}-${slug}`);

  if (await exists(epicDir)) {
    throw new Error(`Epic '${number}-${slug}' already exists.`);
  }

  await ensureDir(epicDir);
  await writeText(
    join(epicDir, "epic.md"),
    `# Epic: ${name}\n\n## Goal\n\n## Scope\n\n## Success Criteria\n`,
  );
  await writeText(join(epicDir, "plans-map.yaml"), renderPlansMapYaml([]));
  await writeText(join(epicDir, "report.md"), "# Epic Report\n\n");
  await writeJson(join(epicDir, "state.json"), {
    phase: "active",
    created_at: new Date().toISOString().slice(0, 10),
    plan_ids: [],
    orchestration: {
      status: "idle",
      updated_at: nowIso(),
    },
  } as EpicState);

  return { number, slug, path: epicDir };
}

export async function linkPlanToEpic(epicPath: string, planDirName: string) {
  const state = await readEpicState(epicPath);
  if (!state.plan_ids.includes(planDirName)) {
    state.plan_ids.push(planDirName);
    await writeEpicState(epicPath, state);
  }
}

export async function readEpicContext(epicPath: string) {
  const epic = await readText(join(epicPath, "epic.md"));
  const plansMap = await readText(join(epicPath, "plans-map.yaml"));
  const report = await readText(join(epicPath, "report.md"));
  const state = await readEpicState(epicPath);
  return { epic, plansMap, report, state };
}

function extractScopePlanNames(epicMarkdown: string): string[] {
  const lines = epicMarkdown.split(/\r?\n/);
  const names: string[] = [];
  let inScope = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      inScope = trimmed.toLowerCase() === "## scope";
      continue;
    }
    if (!inScope) continue;

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text) names.push(text);
      continue;
    }
  }

  return [...new Set(names)].slice(0, 8);
}

function deriveFallbackPlanNames(epicMarkdown: string): string[] {
  const titleMatch = epicMarkdown.match(/^#\s*Epic:\s*(.+)$/m);
  const title = titleMatch?.[1]?.trim() || "Epic Delivery";
  return [
    `${title}: scaffold and structure`,
    `${title}: core implementation`,
    `${title}: validation and documentation`,
  ];
}

function epicIdFromDirName(dirName: string): string {
  return dirName.slice(0, 2);
}

export type EpicPlanEntry = {
  id: string;
  dir: string;
  phase: PlanPhase | "unknown";
};

export async function runEpicOrchestration(epic: ResolvedEpic) {
  const state = await readEpicState(epic.dirPath);
  const orchestration = ensureOrchestration(state);
  if (orchestration.status === "running") {
    throw new Error(`Epic ${epic.id} orchestration is already running.`);
  }

  const epicMarkdown = await readText(join(epic.dirPath, "epic.md"));
  const currentPlanIds = [...state.plan_ids];
  let created = 0;

  if (currentPlanIds.length === 0) {
    const planNames = extractScopePlanNames(epicMarkdown);
    const selectedPlanNames = planNames.length > 0 ? planNames : deriveFallbackPlanNames(epicMarkdown);

    for (const planName of selectedPlanNames) {
      const plan = await createPlan(planName, { epicId: epic.id });
      const planDirName = `${plan.number}-${plan.slug}`;
      currentPlanIds.push(planDirName);
      created += 1;
    }
  }

  const updated: EpicState = {
    ...state,
    plan_ids: currentPlanIds,
    phase: "active",
    orchestration: {
      ...orchestration,
      status: "running",
      started_at: orchestration.started_at ?? nowIso(),
      updated_at: nowIso(),
      last_error: undefined,
      last_run_summary:
        created > 0
          ? `Created ${created} plan(s) and linked to epic ${epic.id}.`
          : `No new plans created. Using existing ${currentPlanIds.length} plan(s).`,
    },
  };
  await writeEpicState(epic.dirPath, updated);

  const plansDir = join(process.cwd(), "plans");
  const plans: EpicPlanEntry[] = await Promise.all(
    currentPlanIds.map(async (dirName) => {
      const planPath = join(plansDir, dirName);
      const phase = await getPlanPhase(planPath);
      return { id: dirName.slice(0, 2), dir: dirName, phase };
    }),
  );

  for (const plan of plans) {
    await publishPlanPhaseJobs(process.cwd(), plan.dir);
  }

  await appendEpicReport(epic.dirPath, [
    `- action: epic run ${epic.id}`,
    `- status: ${updated.orchestration?.status ?? "idle"}`,
    `- summary: ${updated.orchestration?.last_run_summary ?? ""}`,
    `- total_plans: ${currentPlanIds.length}`,
  ]);

  return {
    created_plans: created,
    total_plans: currentPlanIds.length,
    status: updated.orchestration?.status ?? "idle",
    summary: updated.orchestration?.last_run_summary ?? "",
    plans,
  };
}

async function setEpicOrchestrationStatus(
  epic: ResolvedEpic,
  status: EpicOrchestrationState["status"],
  summary: string,
) {
  const state = await readEpicState(epic.dirPath);
  const orchestration = ensureOrchestration(state);
  const updated: EpicState = {
    ...state,
    orchestration: {
      ...orchestration,
      status,
      updated_at: nowIso(),
      last_run_summary: summary,
      ...(status === "failed" ? { last_error: summary } : { last_error: undefined }),
    },
  };
  await writeEpicState(epic.dirPath, updated);
  await appendEpicReport(epic.dirPath, [
    `- action: orchestration status update`,
    `- status: ${status}`,
    `- summary: ${summary}`,
  ]);
  return updated;
}

export async function stopEpicOrchestration(epic: ResolvedEpic) {
  const state = await readEpicState(epic.dirPath);
  const status = ensureOrchestration(state).status;
  if (status !== "running") {
    throw new Error(`Epic ${epic.id} is not running. Current status: ${status}.`);
  }
  await setEpicOrchestrationStatus(epic, "paused", "Orchestration paused by user.");
}

export async function resumeEpicOrchestration(epic: ResolvedEpic) {
  const state = await readEpicState(epic.dirPath);
  const status = ensureOrchestration(state).status;
  if (status === "running") {
    return {
      resumed: false,
      message: `Epic ${epic.id} orchestration is already running.`,
    };
  }
  if (status === "completed") {
    return {
      resumed: false,
      message: `Epic ${epic.id} orchestration is already completed.`,
    };
  }

  await setEpicOrchestrationStatus(epic, "running", "Orchestration resumed.");
  return {
    resumed: true,
    message: `Epic ${epic.id} orchestration resumed.`,
  };
}

export async function getEpicStatus(epic: ResolvedEpic) {
  const state = await readEpicState(epic.dirPath);
  const orchestration = ensureOrchestration(state);

  const counts: Record<PlanPhase | "unknown", number> = {
    planning: 0,
    coding: 0,
    awaiting_review: 0,
    reviewing: 0,
    fixing: 0,
    completed: 0,
    blocked: 0,
    unknown: 0,
  };

  for (const planDirName of state.plan_ids) {
    const planStatePath = join(process.cwd(), "plans", planDirName, "state.json");
    if (!(await exists(planStatePath))) {
      counts.unknown += 1;
      continue;
    }
    const planState = await readJson<{ phase?: PlanPhase }>(planStatePath);
    const phase = planState.phase;
    if (!phase || !(phase in counts)) {
      counts.unknown += 1;
      continue;
    }
    counts[phase] += 1;
  }

  const allCompleted = state.plan_ids.length > 0 && counts.completed === state.plan_ids.length;
  const hasBlocked = counts.blocked > 0;
  const desiredPhase: EpicState["phase"] = allCompleted ? "completed" : hasBlocked ? "blocked" : "active";
  if (state.phase !== desiredPhase) {
    state.phase = desiredPhase;
    await writeEpicState(epic.dirPath, {
      ...state,
      phase: desiredPhase,
      orchestration: ensureOrchestration(state),
    });
  }

  if (allCompleted && orchestration.status !== "completed") {
    await setEpicOrchestrationStatus(epic, "completed", "All linked plans are completed.");
    state.phase = "completed";
    await writeEpicState(epic.dirPath, {
      ...state,
      phase: "completed",
      orchestration: {
        ...orchestration,
        status: "completed",
        updated_at: nowIso(),
        last_run_summary: "All linked plans are completed.",
      },
    });
  }

  return {
    id: epicIdFromDirName(epic.dirName),
    dir: join("epics", epic.dirName),
    epic_phase: state.phase,
    orchestration: ensureOrchestration(
      allCompleted
        ? {
            ...state,
            orchestration: {
              ...orchestration,
              status: "completed",
              updated_at: nowIso(),
              last_run_summary: "All linked plans are completed.",
            },
          }
        : state,
    ),
    total_plans: state.plan_ids.length,
    plans_by_phase: counts,
  };
}
