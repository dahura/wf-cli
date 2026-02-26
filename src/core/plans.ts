import { join } from "path";
import { exists, ensureDir, listDirEntries, readJson, writeJson, writeText } from "./io";

export type PlanPhase =
  | "planning"
  | "coding"
  | "awaiting_review"
  | "reviewing"
  | "fixing"
  | "completed"
  | "blocked";

type PlanState = {
  phase: PlanPhase;
  iteration: number;
  created_at: string;
  epic_id?: string;
};

const EVIDENCE_TEMPLATE = `# Evidence

Provide execution evidence for each checked TODO ID.

Required format per TODO item:

## T1
- status: pass
- command: \`bun test path/to/test.ts\`
- output: short factual result
- notes: optional context

Only \`status: pass\` is accepted for \`/finish-code\`.
`;

async function ensureStatePath(planPath: string): Promise<string> {
  const statePath = join(planPath, "state.json");
  if (!(await exists(statePath))) {
    throw new Error("state.json not found for plan.");
  }
  return statePath;
}

async function readPlanState(planPath: string): Promise<PlanState> {
  const statePath = await ensureStatePath(planPath);
  return readJson<PlanState>(statePath);
}

export async function getPlanPhase(planPath: string): Promise<PlanPhase | "unknown"> {
  try {
    const state = await readPlanState(planPath);
    return state.phase;
  } catch {
    return "unknown";
  }
}

async function writePlanState(planPath: string, state: PlanState) {
  const statePath = await ensureStatePath(planPath);
  await writeJson(statePath, state);
}

async function nextPlanNumber(): Promise<string> {
  const plansDir = join(process.cwd(), "plans");

  if (!(await exists(plansDir))) {
    await ensureDir(plansDir);
    return "01";
  }

  const entries = (await listDirEntries(plansDir))
    .filter((name) => /^\d{2}-/.test(name))
    .map((name) => parseInt(name.slice(0, 2), 10));

  if (entries.length === 0) return "01";
  return String(Math.max(...entries) + 1).padStart(2, "0");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createPlan(name: string, options?: { epicId?: string }) {
  const number = await nextPlanNumber();
  const slug = slugify(name);
  const planDir = join(process.cwd(), "plans", `${number}-${slug}`);

  if (await exists(planDir)) {
    throw new Error(`Plan '${number}-${slug}' already exists.`);
  }

  await ensureDir(planDir);
  await writeText(join(planDir, "plan.md"), "");
  await writeText(join(planDir, "todo.md"), "");
  await writeText(join(planDir, "evidence.md"), EVIDENCE_TEMPLATE);
  await writeJson(
    join(planDir, "state.json"),
    {
      phase: "planning",
      iteration: 0,
      created_at: new Date().toISOString().slice(0, 10),
      ...(options?.epicId ? { epic_id: options.epicId } : {}),
    },
  );

  return { number, slug, path: planDir };
}

export async function startCoding(planPath: string) {
  const state = await readPlanState(planPath);
  if (state.phase !== "planning") {
    throw new Error(`Cannot start coding from phase '${state.phase}'.`);
  }
  await writePlanState(planPath, { ...state, phase: "coding" });
}

export async function finishCode(planPath: string) {
  const state = await readPlanState(planPath);
  if (state.phase !== "coding" && state.phase !== "fixing") {
    throw new Error(`Cannot finish coding from phase '${state.phase}'.`);
  }
  await writePlanState(planPath, { ...state, phase: "awaiting_review" });
}

export async function startReview(planPath: string) {
  const state = await readPlanState(planPath);
  if (state.phase !== "awaiting_review") {
    throw new Error(`Cannot start review from phase '${state.phase}'.`);
  }

  const reviewPath = join(planPath, "review.md");
  if (!(await exists(reviewPath))) {
    await writeText(reviewPath, "");
  }

  await writePlanState(planPath, { ...state, phase: "reviewing" });
}

export async function startFix(planPath: string) {
  const state = await readPlanState(planPath);
  if (state.phase !== "reviewing" && state.phase !== "blocked") {
    throw new Error(`Cannot start fixing from phase '${state.phase}'.`);
  }
  await writePlanState(planPath, {
    ...state,
    phase: "fixing",
    iteration: state.iteration + 1,
  });
}

export async function completePlan(planPath: string) {
  const state = await readPlanState(planPath);
  if (state.phase !== "reviewing") {
    throw new Error(`Cannot complete plan from phase '${state.phase}'.`);
  }
  await writePlanState(planPath, { ...state, phase: "completed" });
}
