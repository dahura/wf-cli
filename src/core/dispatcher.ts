import { join } from "path";
import { readJson, readText } from "./io";
import { buildDedupeKey, FileDistributedJobQueue } from "./distributed";
import { getAllowedWorkflowCommandsForPhase, type WorkflowCommand } from "./orchestration-contract";
import { getExecutorRoleForCommand, resolveExecutorRuntime } from "./routing";
import { isDistributedEnabled } from "./runtime-config";

type PlanState = {
  phase?: string;
  iteration?: number;
  epic_id?: string;
};

export type DispatchResult = {
  published: number;
  deduped: number;
  skipped: boolean;
};

function shouldPublishCommand(phase: string, command: WorkflowCommand): boolean {
  if (command === "finish-code" || command === "done" || command === "review") {
    return false;
  }
  if (phase === "reviewing" && command === "fix") {
    return false;
  }
  return true;
}

export async function enqueuePlanCommand(
  cwd: string,
  planDirName: string,
  command: WorkflowCommand,
  env: Record<string, string | undefined> = process.env,
): Promise<DispatchResult> {
  if (!(await isDistributedEnabled(cwd, env))) {
    return { published: 0, deduped: 0, skipped: true };
  }

  const planId = planDirName.slice(0, 2);
  const statePath = join(cwd, "plans", planDirName, "state.json");
  const state = await readJson<PlanState>(statePath);
  const phase = state.phase ?? "unknown";
  const allowed = getAllowedWorkflowCommandsForPhase(phase);
  if (!allowed.includes(command)) {
    return { published: 0, deduped: 0, skipped: true };
  }

  if (command === "code") {
    const planMdPath = join(cwd, "plans", planDirName, "plan.md");
    const content = await readText(planMdPath).catch(() => "");
    if (!content.trim()) {
      return { published: 0, deduped: 0, skipped: true };
    }
  }

  const planIteration = Number.isInteger(state.iteration) ? (state.iteration as number) : 0;
  const executorRole = getExecutorRoleForCommand(phase, command);
  const executorRuntime = await resolveExecutorRuntime(cwd, executorRole);
  const target = {
    plan_id: planId,
    plan_iteration: planIteration,
    workflow_command: command,
    executor_role: executorRole,
    executor_runtime: executorRuntime,
    ...(state.epic_id ? { epic_id: state.epic_id } : {}),
  };
  const queue = new FileDistributedJobQueue(cwd);
  const dedupeKey = buildDedupeKey(target);
  const result = await queue.enqueue({
    contract_version: 1,
    dedupe_key: dedupeKey,
    dedupe_scope: {
      scope: state.epic_id ? "epic" : "plan",
      ...(state.epic_id ? { epic_id: state.epic_id } : { plan_id: planId }),
    },
    target,
    created_at: new Date().toISOString(),
    metadata: { source: "dispatcher:explicit-command" },
  });
  return result.deduped
    ? { published: 0, deduped: 1, skipped: false }
    : { published: 1, deduped: 0, skipped: false };
}

export async function publishPlanPhaseJobs(
  cwd: string,
  planDirName: string,
  env: Record<string, string | undefined> = process.env,
): Promise<DispatchResult> {
  if (!(await isDistributedEnabled(cwd, env))) {
    return { published: 0, deduped: 0, skipped: true };
  }

  const planId = planDirName.slice(0, 2);
  const statePath = join(cwd, "plans", planDirName, "state.json");
  const state = await readJson<PlanState>(statePath);
  const phase = state.phase ?? "unknown";
  const planIteration = Number.isInteger(state.iteration) ? (state.iteration as number) : 0;
  const queue = new FileDistributedJobQueue(cwd);
  let published = 0;
  let deduped = 0;

  for (const command of getAllowedWorkflowCommandsForPhase(phase)) {
    if (!shouldPublishCommand(phase, command)) continue;

    if (command === "code") {
      const planMdPath = join(cwd, "plans", planDirName, "plan.md");
      const content = await readText(planMdPath).catch(() => "");
      if (!content.trim()) continue;
    }

    const executorRole = getExecutorRoleForCommand(phase, command);
    const executorRuntime = await resolveExecutorRuntime(cwd, executorRole);
    const target = {
      plan_id: planId,
      plan_iteration: planIteration,
      workflow_command: command,
      executor_role: executorRole,
      executor_runtime: executorRuntime,
      ...(state.epic_id ? { epic_id: state.epic_id } : {}),
    };
    const dedupeKey = buildDedupeKey(target);
    const result = await queue.enqueue({
      contract_version: 1,
      dedupe_key: dedupeKey,
      dedupe_scope: {
        scope: state.epic_id ? "epic" : "plan",
        ...(state.epic_id ? { epic_id: state.epic_id } : { plan_id: planId }),
      },
      target,
      created_at: new Date().toISOString(),
      metadata: { source: "dispatcher" },
    });
    if (result.deduped) {
      deduped += 1;
    } else {
      published += 1;
    }
  }

  return { published, deduped, skipped: false };
}
