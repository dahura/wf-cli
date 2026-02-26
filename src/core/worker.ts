import { resolvePlan } from "./context";
import { FileDistributedJobQueue, WORKER_ROLE_COMMAND_FILTERS, createLease } from "./distributed";
import type { JobOwner, WorkflowCommand } from "./orchestration-contract";
import { getPlanPhase, startCoding, startFix, startReview } from "./plans";
import { validatePlanReadyForReview } from "./quality";
import { publishPlanPhaseJobs } from "./dispatcher";

export type WorkerOptions = {
  cwd: string;
  role: keyof typeof WORKER_ROLE_COMMAND_FILTERS;
  worker: JobOwner;
  lease_ms: number;
  poll_ms: number;
  max_jobs?: number;
};

type CommandExecutionResult = {
  ok: boolean;
  output: string;
};

async function executeWorkflowCommand(
  cwd: string,
  planRef: string,
  command: WorkflowCommand,
): Promise<CommandExecutionResult> {
  const plan = await resolvePlan(cwd, planRef);
  if (!plan) {
    throw new Error(`Plan '${planRef}' not found.`);
  }

  switch (command) {
    case "plan":
      return { ok: true, output: "plan command does not run inside worker." };
    case "verify": {
      const quality = await validatePlanReadyForReview(plan.dirPath);
      return { ok: quality.ok, output: quality.ok ? "review gate: pass" : quality.errors.join("; ") };
    }
    case "code": {
      const phase = await getPlanPhase(plan.dirPath);
      if (phase === "coding") {
        return { ok: true, output: "code noop in phase 'coding'" };
      }
      if (phase !== "planning") {
        return { ok: false, output: `Cannot start coding from phase '${phase}'.` };
      }
      await startCoding(plan.dirPath);
      return { ok: true, output: "plan entered coding phase" };
    }
    case "fix": {
      const phase = await getPlanPhase(plan.dirPath);
      if (phase === "fixing") {
        return { ok: true, output: "fix noop in phase 'fixing'" };
      }
      if (phase !== "reviewing" && phase !== "blocked") {
        return { ok: false, output: `Cannot start fixing from phase '${phase}'.` };
      }
      await startFix(plan.dirPath);
      return { ok: true, output: "plan entered fixing phase" };
    }
    case "review": {
      const phase = await getPlanPhase(plan.dirPath);
      if (phase === "reviewing") {
        return { ok: true, output: "review noop in phase 'reviewing'" };
      }
      if (phase !== "awaiting_review") {
        return { ok: false, output: `Cannot start review from phase '${phase}'.` };
      }
      await startReview(plan.dirPath);
      return { ok: true, output: "plan entered reviewing phase" };
    }
    case "finish-code":
      return { ok: false, output: "finish-code must be executed by the coding/fixing agent after work is complete." };
    case "done":
      return { ok: false, output: "done must be executed by reviewer after all TODOs are accepted." };
    default:
      throw new Error(`Unsupported command '${command}'.`);
  }
}

async function recoverExpiredJobs(queue: FileDistributedJobQueue): Promise<void> {
  const nowIso = new Date().toISOString();
  const jobs = await queue.list();
  for (const job of jobs) {
    if ((job.status === "claimed" || job.status === "running") && job.lease) {
      if (Date.parse(job.lease.expires_at) > Date.parse(nowIso)) continue;
      await queue.stall({
        job_id: job.job_id,
        cas: { expected_rev: job.rev, expected_status: job.status },
        at: nowIso,
        request_id: crypto.randomUUID(),
      });
      const stalled = await queue.getById(job.job_id);
      if (!stalled) continue;
      await queue.requeueStalled({
        job_id: stalled.job_id,
        cas: { expected_rev: stalled.rev, expected_status: "stalled" },
        at: new Date().toISOString(),
        request_id: crypto.randomUUID(),
      });
    }
  }
}

export async function runWorkerLoop(options: WorkerOptions): Promise<{ processed: number }> {
  const queue = new FileDistributedJobQueue(options.cwd);
  const maxJobs = options.max_jobs ?? Number.POSITIVE_INFINITY;
  let processed = 0;

  while (processed < maxJobs) {
    await recoverExpiredJobs(queue);
    const lease = createLease(new Date().toISOString(), options.lease_ms);
    const job = await queue.claimNext({
      worker: options.worker,
      lease_expires_at: lease.expires_at,
      command_filter: WORKER_ROLE_COMMAND_FILTERS[options.role],
      role_filter: options.role,
      runtime_filter: options.worker.runtime,
      request_id: crypto.randomUUID(),
    });

    if (!job) {
      if (Number.isFinite(maxJobs)) break;
      await Bun.sleep(options.poll_ms);
      continue;
    }

    const actor = { worker_id: options.worker.worker_id, runtime: options.worker.runtime };
    const requestId = crypto.randomUUID();
    await queue.start({
      job_id: job.job_id,
      actor,
      cas: { expected_rev: job.rev, expected_status: "claimed", expected_owner: actor },
      to_status: "running",
      at: new Date().toISOString(),
      request_id: requestId,
    });

    const heartbeatIntervalMs = Math.max(1000, Math.floor(options.lease_ms / 2));
    const heartbeatTimer = setInterval(async () => {
      try {
        const latest = await queue.getById(job.job_id);
        if (!latest || latest.status !== "running") return;
        const nextLease = createLease(new Date().toISOString(), options.lease_ms);
        await queue.heartbeat({
          job_id: latest.job_id,
          actor,
          cas: { expected_rev: latest.rev, expected_status: "running", expected_owner: actor },
          at: new Date().toISOString(),
          lease_expires_at: nextLease.expires_at,
          request_id: crypto.randomUUID(),
        });
      } catch {
        // Best effort heartbeat; terminal transition handles errors.
      }
    }, heartbeatIntervalMs);

    try {
      const result = await executeWorkflowCommand(options.cwd, job.target.plan_id, job.target.workflow_command);
      const latest = await queue.getById(job.job_id);
      if (!latest) throw new Error(`Job '${job.job_id}' disappeared before completion.`);
      if (!result.ok) {
        await queue.fail({
          job_id: latest.job_id,
          actor,
          cas: { expected_rev: latest.rev, expected_status: "running", expected_owner: actor },
          at: new Date().toISOString(),
          error: { message: result.output || "Command failed in worker." },
          request_id: crypto.randomUUID(),
        });
      } else {
        await queue.complete({
          job_id: latest.job_id,
          actor,
          cas: { expected_rev: latest.rev, expected_status: "running", expected_owner: actor },
          at: new Date().toISOString(),
          result: { output: result.output },
          request_id: crypto.randomUUID(),
        });
        const resolvedPlan = await resolvePlan(options.cwd, job.target.plan_id);
        if (resolvedPlan) {
          await publishPlanPhaseJobs(options.cwd, resolvedPlan.dirName);
        }
      }
    } catch (error: any) {
      const latest = await queue.getById(job.job_id);
      if (latest && latest.status === "running") {
        await queue.fail({
          job_id: latest.job_id,
          actor,
          cas: { expected_rev: latest.rev, expected_status: "running", expected_owner: actor },
          at: new Date().toISOString(),
          error: { message: error?.message ?? "Worker execution failed." },
          request_id: crypto.randomUUID(),
        });
      }
    } finally {
      clearInterval(heartbeatTimer);
    }

    processed += 1;
  }

  return { processed };
}
