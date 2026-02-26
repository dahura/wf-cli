import { join } from "path";
import type { PlanLifecyclePhase, WorkerExecutorRole, WorkflowCommand } from "./orchestration-contract";
import { exists, readJson } from "./io";

type RuntimeRoutingConfig = {
  roles?: Partial<Record<WorkerExecutorRole, string>>;
};

const DEFAULT_ROLE_RUNTIMES: Record<WorkerExecutorRole, string> = {
  orchestrator: "cursor",
  "plan-coder": "opencode",
  "plan-reviewer": "cursor",
  "plan-fixer": "opencode",
};

const ROUTING_CONFIG_PATH = join(".wf", "routing.runtimes.json");

export function getExecutorRoleForCommand(
  phase: string,
  command: WorkflowCommand,
): WorkerExecutorRole {
  if (command === "code") return "plan-coder";
  if (command === "fix") return "plan-fixer";
  if (command === "review" || command === "done" || command === "verify") return "plan-reviewer";
  if (command === "finish-code") {
    return phase === "fixing" ? "plan-fixer" : "plan-coder";
  }
  return "orchestrator";
}

export async function resolveExecutorRuntime(
  cwd: string,
  role: WorkerExecutorRole,
): Promise<string> {
  const path = join(cwd, ROUTING_CONFIG_PATH);
  if (!(await exists(path))) return DEFAULT_ROLE_RUNTIMES[role];
  const config = await readJson<RuntimeRoutingConfig>(path);
  const configured = config.roles?.[role];
  return typeof configured === "string" && configured.length > 0
    ? configured
    : DEFAULT_ROLE_RUNTIMES[role];
}

export function getDefaultRoleRuntimes(): Record<WorkerExecutorRole, string> {
  return { ...DEFAULT_ROLE_RUNTIMES };
}

export function isKnownPlanPhase(phase: string): phase is PlanLifecyclePhase {
  return (
    phase === "planning" ||
    phase === "coding" ||
    phase === "awaiting_review" ||
    phase === "reviewing" ||
    phase === "fixing" ||
    phase === "completed" ||
    phase === "blocked"
  );
}
