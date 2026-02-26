import { describe, expect, it } from "bun:test";
import {
  LIFECYCLE_EVENT_TYPES,
  LIFECYCLE_TRANSITIONS,
  PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS,
  SUPPORTED_JOB_CONTRACT_VERSION,
  buildLifecycleEvent,
  getAllowedWorkflowCommandsForPhase,
  getLifecycleEventType,
  isLifecycleTransitionAllowed,
  parseJobRecord,
  shouldIncrementAttempt,
  shouldIncrementRevision,
  validateTransitionInvariants,
  type LifecycleAction,
  type JobRecord,
} from "./orchestration-contract";

function buildRepresentativeJob(): JobRecord {
  return {
    job_id: "job-1",
    contract_version: SUPPORTED_JOB_CONTRACT_VERSION,
    dedupe_key: "epic:01|plan:01|it:0|cmd:finish-code",
    target: {
      repo_id: "wf-cli",
      epic_id: "01",
      plan_id: "01",
      plan_iteration: 0,
      workflow_command: "finish-code",
    },
    status: "succeeded",
    attempt: 1,
    rev: 3,
    events: [
      {
        event_id: "evt-1",
        type: "enqueued",
        from_status: "queued",
        to_status: "queued",
        at: "2026-02-20T15:00:00.000Z",
        actor: "orchestrator",
      },
      {
        event_id: "evt-2",
        type: "succeeded",
        from_status: "running",
        to_status: "succeeded",
        at: "2026-02-20T15:10:00.000Z",
        actor: "worker-a",
        request_id: "req-complete-1",
      },
    ],
    result: {
      files_changed: 4,
    },
  };
}

function buildQueuedJob(): JobRecord {
  return {
    job_id: "job-1",
    contract_version: SUPPORTED_JOB_CONTRACT_VERSION,
    dedupe_key: "epic:01|plan:02|it:0|cmd:finish-code",
    target: {
      repo_id: "wf-cli",
      epic_id: "01",
      plan_id: "02",
      plan_iteration: 0,
      workflow_command: "finish-code",
    },
    status: "queued",
    attempt: 0,
    rev: 1,
    events: [],
  };
}

function buildTransition(
  current: JobRecord,
  next: JobRecord,
  action: LifecycleAction,
  request_id: string,
) {
  return validateTransitionInvariants({
    current,
    next,
    next_status: next.status,
    action,
    cas: { expected_rev: current.rev },
    actor: current.owner
      ? { worker_id: current.owner.worker_id, runtime: current.owner.runtime }
      : undefined,
    request_id,
  });
}

describe("orchestration-contract", () => {
  it("round-trips representative jobs through JSON", () => {
    const job = buildRepresentativeJob();
    const parsed = parseJobRecord(JSON.parse(JSON.stringify(job)));
    expect(parsed).toEqual(job);
  });

  it("ignores unknown fields while parsing known schema", () => {
    const raw = JSON.parse(JSON.stringify(buildRepresentativeJob())) as Record<string, unknown>;
    raw.unknown_top_level = "ignored";

    const target = raw.target as Record<string, unknown>;
    target.future_target_field = "ignored";

    const parsed = parseJobRecord(raw);
    const parsedRaw = parsed as unknown as Record<string, unknown>;
    const parsedTargetRaw = parsed.target as unknown as Record<string, unknown>;

    expect(parsedRaw.unknown_top_level).toBeUndefined();
    expect(parsedTargetRaw.future_target_field).toBeUndefined();
    expect(parsed.target.plan_iteration).toBe(0);
  });

  it("rejects unsupported contract versions", () => {
    const raw = JSON.parse(JSON.stringify(buildRepresentativeJob())) as Record<string, unknown>;
    raw.contract_version = 999;
    expect(() => parseJobRecord(raw)).toThrow(/Unsupported contract_version/);
  });

  it("exposes canonical plan phase to workflow command mapping", () => {
    expect(PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS.planning).toEqual(["code"]);
    expect(PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS.reviewing).toEqual(["fix", "done"]);
    expect(getAllowedWorkflowCommandsForPhase("fixing")).toEqual(["finish-code"]);
  });

  it("exports authoritative lifecycle transitions and canonical event types", () => {
    expect(LIFECYCLE_TRANSITIONS.claimNext).toEqual([
      ["queued", "claimed"],
      ["stalled", "claimed"],
    ]);
    expect(isLifecycleTransitionAllowed("heartbeat", "running", "running")).toBeTrue();
    expect(isLifecycleTransitionAllowed("start", "queued", "running")).toBeFalse();
    expect(getLifecycleEventType("requeueStalled")).toBe(LIFECYCLE_EVENT_TYPES.requeued);
  });

  it("validates happy-path lifecycle to succeeded", () => {
    const queued = buildQueuedJob();
    const claimed: JobRecord = {
      ...queued,
      status: "claimed",
      owner: { worker_id: "worker-a", runtime: "cursor" },
      lease: { expires_at: "2026-02-20T16:00:00.000Z" },
      attempt: 1,
      rev: 2,
    };
    expect(buildTransition(queued, claimed, "claimNext", "req-claim-1")).toEqual([]);

    const running: JobRecord = {
      ...claimed,
      status: "running",
      rev: 3,
    };
    expect(buildTransition(claimed, running, "start", "req-start-1")).toEqual([]);

    const succeeded: JobRecord = {
      ...running,
      status: "succeeded",
      owner: undefined,
      lease: undefined,
      result: { ok: true },
      rev: 4,
    };
    expect(buildTransition(running, succeeded, "complete", "req-complete-1")).toEqual([]);
  });

  it("validates happy-path lifecycle to failed", () => {
    const queued = buildQueuedJob();
    const claimed: JobRecord = {
      ...queued,
      status: "claimed",
      owner: { worker_id: "worker-a", runtime: "cursor" },
      lease: { expires_at: "2026-02-20T16:00:00.000Z" },
      attempt: 1,
      rev: 2,
    };
    const running: JobRecord = {
      ...claimed,
      status: "running",
      rev: 3,
    };
    const failed: JobRecord = {
      ...running,
      status: "failed",
      owner: undefined,
      lease: undefined,
      error: { message: "worker crashed" },
      rev: 4,
    };

    expect(buildTransition(running, failed, "fail", "req-fail-1")).toEqual([]);
  });

  it("rejects illegal transitions and invalid status invariants", () => {
    const queued = buildQueuedJob();
    const invalidRunning: JobRecord = { ...queued, status: "running", rev: 2 };
    const transitionErrors = buildTransition(queued, invalidRunning, "start", "req-start-2");

    expect(transitionErrors).toContain(
      "Transition 'start' does not allow 'queued' -> 'running'.",
    );
    expect(transitionErrors).toContain("Invalid next: status 'running' requires owner and lease.");

    const claimed: JobRecord = {
      ...queued,
      status: "claimed",
      owner: { worker_id: "worker-a", runtime: "cursor" },
      lease: { expires_at: "2026-02-20T16:00:00.000Z" },
      attempt: 1,
      rev: 2,
    };
    const illegalSucceeded: JobRecord = {
      ...claimed,
      status: "succeeded",
      result: { ok: true },
      owner: undefined,
      lease: undefined,
      rev: 3,
    };
    expect(buildTransition(claimed, illegalSucceeded, "complete", "req-complete-2")).toContain(
      "Transition 'complete' does not allow 'claimed' -> 'succeeded'.",
    );

    const running: JobRecord = {
      ...claimed,
      status: "running",
      rev: 3,
    };
    const illegalQueued: JobRecord = {
      ...running,
      status: "queued",
      owner: undefined,
      lease: undefined,
      rev: 4,
    };
    expect(buildTransition(running, illegalQueued, "requeueStalled", "req-requeue-1")).toContain(
      "Transition 'requeueStalled' does not allow 'running' -> 'queued'.",
    );

    const terminalToNonTerminal = validateTransitionInvariants({
      current: {
        ...queued,
        status: "succeeded",
        result: { ok: true },
      },
      next_status: "running",
      action: "start",
      actor: { worker_id: "worker-a", runtime: "cursor" },
      cas: { expected_rev: 1 },
      request_id: "req-start-terminal",
    });
    expect(terminalToNonTerminal).toContain("Terminal job status is immutable.");

    const failedWithResultErrors = validateTransitionInvariants({
      current: {
        ...queued,
        status: "failed",
        result: { should_not: "exist" },
      },
      next_status: "failed",
      action: "fail",
      cas: { expected_rev: 1 },
      request_id: "req-fail-terminal",
      idempotent_retry: true,
    });
    expect(failedWithResultErrors).toContain("Invalid current: status 'failed' requires error.");
    expect(failedWithResultErrors).toContain("Invalid current: status 'failed' forbids result.");
  });

  it("enforces retry-safe request_id, heartbeat no-op, and idempotent terminal repeats", () => {
    const claimed: JobRecord = {
      ...buildQueuedJob(),
      status: "claimed",
      owner: { worker_id: "worker-a", runtime: "cursor" },
      lease: { expires_at: "2026-02-20T16:00:00.000Z" },
      attempt: 1,
      rev: 2,
    };
    const heartbeatNoOp: JobRecord = {
      ...claimed,
      status: "claimed",
      lease: {
        expires_at: "2026-02-20T16:05:00.000Z",
        renewed_at: "2026-02-20T16:00:00.000Z",
      },
      rev: 3,
    };
    expect(buildTransition(claimed, heartbeatNoOp, "heartbeat", "req-heartbeat-1")).toEqual([]);

    const missingRequestId = validateTransitionInvariants({
      current: claimed,
      next_status: "claimed",
      action: "heartbeat",
      cas: { expected_rev: 2 },
      actor: { worker_id: "worker-a", runtime: "cursor" },
    });
    expect(missingRequestId).toContain(
      "Transition 'heartbeat' should include request_id for idempotent retries.",
    );

    const succeeded: JobRecord = {
      ...heartbeatNoOp,
      status: "succeeded",
      owner: undefined,
      lease: undefined,
      result: { ok: true },
      rev: 4,
    };
    const terminalRepeatErrors = validateTransitionInvariants({
      current: succeeded,
      next: { ...succeeded, rev: 4 },
      next_status: "succeeded",
      action: "complete",
      cas: { expected_rev: 4 },
      actor: { worker_id: "worker-a", runtime: "cursor" },
      request_id: "req-complete-repeat",
      idempotent_retry: true,
    });
    expect(terminalRepeatErrors).toEqual([]);
  });

  it("provides helpers for lifecycle counters and event construction", () => {
    expect(shouldIncrementAttempt("claimNext", "queued", "claimed")).toBeTrue();
    expect(shouldIncrementAttempt("start", "claimed", "running")).toBeFalse();
    expect(shouldIncrementRevision({ accepted: true })).toBeTrue();
    expect(shouldIncrementRevision({ accepted: true, idempotent_retry: true })).toBeFalse();

    const event = buildLifecycleEvent({
      event_id: "evt-10",
      action: "stall",
      from_status: "running",
      to_status: "stalled",
      at: "2026-02-20T16:00:00.000Z",
      actor: "watchdog",
      request_id: "req-stall-10",
    });
    expect(event).toEqual({
      event_id: "evt-10",
      type: "stalled",
      from_status: "running",
      to_status: "stalled",
      at: "2026-02-20T16:00:00.000Z",
      actor: "watchdog",
      request_id: "req-stall-10",
    });
  });
});
