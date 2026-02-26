export const SUPPORTED_JOB_CONTRACT_VERSION = 1 as const;

export type JobContractVersion = typeof SUPPORTED_JOB_CONTRACT_VERSION;

export type WorkflowCommand =
  | "plan"
  | "code"
  | "finish-code"
  | "review"
  | "fix"
  | "done"
  | "verify";

export type WorkerExecutorRole = "orchestrator" | "plan-coder" | "plan-reviewer" | "plan-fixer";

export type JobStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "stalled";

export type JobOwner = {
  worker_id: string;
  runtime: string;
  host?: string;
  pid?: number;
};

export type JobLease = {
  expires_at: string;
  renewed_at?: string;
};

export type JobTarget = {
  repo_id?: string;
  epic_id?: string;
  plan_id: string;
  plan_iteration: number;
  workflow_command: WorkflowCommand;
  executor_role?: WorkerExecutorRole;
  executor_runtime?: string;
};

export type JobEvent = {
  event_id: string;
  type: string;
  from_status: JobStatus;
  to_status: JobStatus;
  at: string;
  actor: string;
  request_id?: string;
};

export type JobFailure = {
  message: string;
  code?: string;
  stack?: string;
  details?: Record<string, unknown>;
};

export type JobRecord = {
  job_id: string;
  contract_version: JobContractVersion;
  dedupe_key: string;
  target: JobTarget;
  status: JobStatus;
  attempt: number;
  rev: number;
  owner?: JobOwner;
  lease?: JobLease;
  events: JobEvent[];
  result?: Record<string, unknown>;
  error?: JobFailure;
};

export type DedupeScope = "repo" | "epic" | "plan";

export type DedupeScopeRef = {
  scope: DedupeScope;
  repo_id?: string;
  epic_id?: string;
  plan_id?: string;
};

export type CasExpectation = {
  expected_rev: number;
  expected_status?: JobStatus;
  expected_owner?: Pick<JobOwner, "worker_id" | "runtime">;
};

export type EnqueueJobInput = {
  contract_version: JobContractVersion;
  dedupe_key: string;
  dedupe_scope: DedupeScopeRef;
  target: JobTarget;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type EnqueueJobResult = {
  job: JobRecord;
  deduped: boolean;
};

export type ClaimJobInput = {
  worker: JobOwner;
  lease_expires_at: string;
  command_filter?: WorkflowCommand[];
  role_filter?: WorkerExecutorRole;
  runtime_filter?: string;
  expected_status?: "queued" | "stalled";
  request_id?: string;
};

export type TransitionRequest = {
  job_id: string;
  actor: Pick<JobOwner, "worker_id" | "runtime">;
  cas: CasExpectation;
  request_id?: string;
  at: string;
};

export type StartJobInput = TransitionRequest & {
  to_status: "running";
};

export type HeartbeatJobInput = TransitionRequest & {
  lease_expires_at: string;
};

export type CompleteJobInput = TransitionRequest & {
  result: Record<string, unknown>;
};

export type FailJobInput = TransitionRequest & {
  error: JobFailure;
};

export type StallJobInput = {
  job_id: string;
  cas: CasExpectation;
  at: string;
  request_id?: string;
};

export type RequeueStalledJobInput = {
  job_id: string;
  cas: CasExpectation;
  at: string;
  request_id?: string;
};

export type ListJobsFilter = {
  status?: JobStatus;
  owner_worker_id?: string;
  plan_id?: string;
  workflow_command?: WorkflowCommand;
};

export interface DistributedJobQueue {
  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>;
  claimNext(input: ClaimJobInput): Promise<JobRecord | null>;
  start(input: StartJobInput): Promise<JobRecord>;
  heartbeat(input: HeartbeatJobInput): Promise<JobRecord>;
  complete(input: CompleteJobInput): Promise<JobRecord>;
  fail(input: FailJobInput): Promise<JobRecord>;
  stall(input: StallJobInput): Promise<JobRecord>;
  requeueStalled(input: RequeueStalledJobInput): Promise<JobRecord>;
  getById(job_id: string): Promise<JobRecord | null>;
  list(filter?: ListJobsFilter): Promise<JobRecord[]>;
}

export type PlanLifecyclePhase =
  | "planning"
  | "coding"
  | "awaiting_review"
  | "reviewing"
  | "fixing"
  | "completed"
  | "blocked";

export const PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS = {
  planning: ["code"],
  coding: ["finish-code"],
  awaiting_review: ["review"],
  reviewing: ["fix", "done"],
  fixing: ["finish-code"],
  completed: [],
  blocked: ["fix"],
} as const satisfies Record<PlanLifecyclePhase, readonly WorkflowCommand[]>;

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(["succeeded", "failed"]);
export const LIFECYCLE_EVENT_TYPES = {
  enqueued: "enqueued",
  claimed: "claimed",
  started: "started",
  heartbeat: "heartbeat",
  succeeded: "succeeded",
  failed: "failed",
  stalled: "stalled",
  requeued: "requeued",
} as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[keyof typeof LIFECYCLE_EVENT_TYPES];

export type LifecycleAction =
  | "enqueue"
  | "claimNext"
  | "start"
  | "heartbeat"
  | "complete"
  | "fail"
  | "stall"
  | "requeueStalled";

type LifecycleSourceStatus = JobStatus | "none";
type LifecycleTransition = readonly [LifecycleSourceStatus, JobStatus];

export const LIFECYCLE_TRANSITIONS: Record<LifecycleAction, readonly LifecycleTransition[]> = {
  enqueue: [["none", "queued"]],
  claimNext: [
    ["queued", "claimed"],
    ["stalled", "claimed"],
  ],
  start: [["claimed", "running"]],
  heartbeat: [
    ["claimed", "claimed"],
    ["running", "running"],
  ],
  complete: [
    ["running", "succeeded"],
    ["succeeded", "succeeded"],
  ],
  fail: [
    ["running", "failed"],
    ["failed", "failed"],
  ],
  stall: [
    ["claimed", "stalled"],
    ["running", "stalled"],
  ],
  requeueStalled: [["stalled", "queued"]],
};

const RETRY_SAFE_TRANSITIONS = new Set<LifecycleAction>([
  "claimNext",
  "start",
  "heartbeat",
  "complete",
  "fail",
  "stall",
  "requeueStalled",
]);
const TERMINAL_IDEMPOTENT_REPEAT_ACTIONS = new Set<LifecycleAction>(["complete", "fail"]);
const OWNER_REQUIRED_ACTIONS = new Set<LifecycleAction>(["start", "heartbeat", "complete", "fail"]);
const ACTION_TO_EVENT_TYPE: Record<LifecycleAction, LifecycleEventType> = {
  enqueue: LIFECYCLE_EVENT_TYPES.enqueued,
  claimNext: LIFECYCLE_EVENT_TYPES.claimed,
  start: LIFECYCLE_EVENT_TYPES.started,
  heartbeat: LIFECYCLE_EVENT_TYPES.heartbeat,
  complete: LIFECYCLE_EVENT_TYPES.succeeded,
  fail: LIFECYCLE_EVENT_TYPES.failed,
  stall: LIFECYCLE_EVENT_TYPES.stalled,
  requeueStalled: LIFECYCLE_EVENT_TYPES.requeued,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid '${field}': expected non-empty string.`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid '${field}': expected integer.`);
  }
  return value;
}

function readStatus(value: unknown, field: string): JobStatus {
  const parsed = readString(value, field);
  if (
    parsed !== "queued" &&
    parsed !== "claimed" &&
    parsed !== "running" &&
    parsed !== "succeeded" &&
    parsed !== "failed" &&
    parsed !== "stalled"
  ) {
    throw new Error(`Invalid '${field}': unsupported status '${parsed}'.`);
  }
  return parsed;
}

function readWorkflowCommand(value: unknown, field: string): WorkflowCommand {
  const parsed = readString(value, field);
  if (
    parsed !== "plan" &&
    parsed !== "code" &&
    parsed !== "finish-code" &&
    parsed !== "review" &&
    parsed !== "fix" &&
    parsed !== "done" &&
    parsed !== "verify"
  ) {
    throw new Error(`Invalid '${field}': unsupported workflow command '${parsed}'.`);
  }
  return parsed;
}

function readExecutorRole(value: unknown, field: string): WorkerExecutorRole {
  const parsed = readString(value, field);
  if (
    parsed !== "orchestrator" &&
    parsed !== "plan-coder" &&
    parsed !== "plan-reviewer" &&
    parsed !== "plan-fixer"
  ) {
    throw new Error(`Invalid '${field}': unsupported executor role '${parsed}'.`);
  }
  return parsed;
}

function parseOwner(value: unknown, field: string): JobOwner {
  if (!isObjectRecord(value)) {
    throw new Error(`Invalid '${field}': expected object.`);
  }

  return {
    worker_id: readString(value.worker_id, `${field}.worker_id`),
    runtime: readString(value.runtime, `${field}.runtime`),
    ...(typeof value.host === "string" ? { host: value.host } : {}),
    ...(typeof value.pid === "number" && Number.isInteger(value.pid) ? { pid: value.pid } : {}),
  };
}

function parseLease(value: unknown, field: string): JobLease {
  if (!isObjectRecord(value)) {
    throw new Error(`Invalid '${field}': expected object.`);
  }

  return {
    expires_at: readString(value.expires_at, `${field}.expires_at`),
    ...(typeof value.renewed_at === "string" ? { renewed_at: value.renewed_at } : {}),
  };
}

function parseTarget(value: unknown, field: string): JobTarget {
  if (!isObjectRecord(value)) {
    throw new Error(`Invalid '${field}': expected object.`);
  }

  return {
    ...(typeof value.repo_id === "string" ? { repo_id: value.repo_id } : {}),
    ...(typeof value.epic_id === "string" ? { epic_id: value.epic_id } : {}),
    plan_id: readString(value.plan_id, `${field}.plan_id`),
    plan_iteration: readInteger(value.plan_iteration, `${field}.plan_iteration`),
    workflow_command: readWorkflowCommand(value.workflow_command, `${field}.workflow_command`),
    ...(typeof value.executor_role === "string"
      ? { executor_role: readExecutorRole(value.executor_role, `${field}.executor_role`) }
      : {}),
    ...(typeof value.executor_runtime === "string" ? { executor_runtime: value.executor_runtime } : {}),
  };
}

function parseEvent(value: unknown, index: number): JobEvent {
  if (!isObjectRecord(value)) {
    throw new Error(`Invalid 'events[${index}]': expected object.`);
  }

  return {
    event_id: readString(value.event_id, `events[${index}].event_id`),
    type: readString(value.type, `events[${index}].type`),
    from_status: readStatus(value.from_status, `events[${index}].from_status`),
    to_status: readStatus(value.to_status, `events[${index}].to_status`),
    at: readString(value.at, `events[${index}].at`),
    actor: readString(value.actor, `events[${index}].actor`),
    ...(typeof value.request_id === "string" ? { request_id: value.request_id } : {}),
  };
}

function parseError(value: unknown): JobFailure {
  if (!isObjectRecord(value)) {
    throw new Error("Invalid 'error': expected object.");
  }

  return {
    message: readString(value.message, "error.message"),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
    ...(isObjectRecord(value.details) ? { details: value.details } : {}),
  };
}

export function parseJobRecord(value: unknown): JobRecord {
  if (!isObjectRecord(value)) {
    throw new Error("Invalid job record: expected object.");
  }

  const contractVersion = readInteger(value.contract_version, "contract_version");
  if (contractVersion !== SUPPORTED_JOB_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported contract_version '${contractVersion}'. Supported: ${SUPPORTED_JOB_CONTRACT_VERSION}.`,
    );
  }

  const eventsRaw = value.events;
  if (!Array.isArray(eventsRaw)) {
    throw new Error("Invalid 'events': expected array.");
  }

  return {
    job_id: readString(value.job_id, "job_id"),
    contract_version: SUPPORTED_JOB_CONTRACT_VERSION,
    dedupe_key: readString(value.dedupe_key, "dedupe_key"),
    target: parseTarget(value.target, "target"),
    status: readStatus(value.status, "status"),
    attempt: readInteger(value.attempt, "attempt"),
    rev: readInteger(value.rev, "rev"),
    ...(value.owner === undefined ? {} : { owner: parseOwner(value.owner, "owner") }),
    ...(value.lease === undefined ? {} : { lease: parseLease(value.lease, "lease") }),
    events: eventsRaw.map((event, index) => parseEvent(event, index)),
    ...(isObjectRecord(value.result) ? { result: value.result } : {}),
    ...(value.error === undefined ? {} : { error: parseError(value.error) }),
  };
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function isLifecycleTransitionAllowed(
  action: LifecycleAction,
  from_status: LifecycleSourceStatus,
  to_status: JobStatus,
): boolean {
  const allowed = LIFECYCLE_TRANSITIONS[action];
  return allowed.some(([from, to]) => from === from_status && to === to_status);
}

export function getLifecycleEventType(action: LifecycleAction): LifecycleEventType {
  return ACTION_TO_EVENT_TYPE[action];
}

export type BuildLifecycleEventInput = {
  event_id: string;
  action: LifecycleAction;
  from_status: JobStatus;
  to_status: JobStatus;
  at: string;
  actor: string;
  request_id?: string;
};

export function buildLifecycleEvent(input: BuildLifecycleEventInput): JobEvent {
  return {
    event_id: input.event_id,
    type: getLifecycleEventType(input.action),
    from_status: input.from_status,
    to_status: input.to_status,
    at: input.at,
    actor: input.actor,
    ...(input.request_id ? { request_id: input.request_id } : {}),
  };
}

export function getAllowedWorkflowCommandsForPhase(phase: string): WorkflowCommand[] {
  const allowed = PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS[phase as PlanLifecyclePhase];
  return allowed ? [...allowed] : [];
}

export type TransitionInvariantInput = {
  current: JobRecord;
  next?: JobRecord;
  next_status: JobStatus;
  action: LifecycleAction;
  cas: CasExpectation | null;
  actor?: Pick<JobOwner, "worker_id" | "runtime">;
  request_id?: string;
  idempotent_retry?: boolean;
};

function sameOwner(
  left: Pick<JobOwner, "worker_id" | "runtime">,
  right: Pick<JobOwner, "worker_id" | "runtime">,
): boolean {
  return left.worker_id === right.worker_id && left.runtime === right.runtime;
}

export function validateTransitionInvariants(input: TransitionInvariantInput): string[] {
  const errors: string[] = [];
  errors.push(...validateJobStatusInvariants(input.current, "current"));
  const isTerminalRepeat = input.current.status === input.next_status && isTerminalJobStatus(input.next_status);

  if (!isLifecycleTransitionAllowed(input.action, input.current.status, input.next_status)) {
    errors.push(
      `Transition '${input.action}' does not allow '${input.current.status}' -> '${input.next_status}'.`,
    );
  }

  if (isTerminalJobStatus(input.current.status) && input.next_status !== input.current.status) {
    errors.push("Terminal job status is immutable.");
  }

  if (!input.cas || !Number.isInteger(input.cas.expected_rev)) {
    errors.push("CAS with expected_rev is required for every transition.");
  }

  if (OWNER_REQUIRED_ACTIONS.has(input.action) && !isTerminalRepeat) {
    if (!input.current.owner) {
      errors.push(`Cannot '${input.action}' without an active owner.`);
    } else if (!input.actor || !sameOwner(input.current.owner, input.actor)) {
      errors.push(`Only current owner can '${input.action}'.`);
    }
  }

  if (RETRY_SAFE_TRANSITIONS.has(input.action) && !input.request_id) {
    errors.push(`Transition '${input.action}' should include request_id for idempotent retries.`);
  }

  if (
    isTerminalRepeat &&
    TERMINAL_IDEMPOTENT_REPEAT_ACTIONS.has(input.action) &&
    !input.idempotent_retry
  ) {
    errors.push(`Terminal repeat '${input.action}' must be marked as idempotent_retry.`);
  }

  if (input.next) {
    errors.push(...validateJobStatusInvariants(input.next, "next"));
    errors.push(
      ...validateAttemptAndRevisionSemantics({
        current: input.current,
        next: input.next,
        action: input.action,
        accepted: true,
        idempotent_retry: input.idempotent_retry,
      }),
    );
  }

  return errors;
}

function hasOwnerAndLease(record: JobRecord): boolean {
  return Boolean(record.owner && record.lease);
}

export function validateJobStatusInvariants(
  record: JobRecord,
  label: "current" | "next" = "current",
): string[] {
  const errors: string[] = [];

  const ownerAndLeaseRequired = record.status === "claimed" || record.status === "running";
  const ownerAndLeaseForbidden =
    record.status === "queued" ||
    record.status === "succeeded" ||
    record.status === "failed" ||
    record.status === "stalled";

  if (ownerAndLeaseRequired && !hasOwnerAndLease(record)) {
    errors.push(`Invalid ${label}: status '${record.status}' requires owner and lease.`);
  }

  if (ownerAndLeaseForbidden && (record.owner || record.lease)) {
    errors.push(`Invalid ${label}: status '${record.status}' forbids owner and lease.`);
  }

  if (record.status === "succeeded") {
    if (!record.result || !isObjectRecord(record.result)) {
      errors.push(`Invalid ${label}: status 'succeeded' requires result.`);
    }
    if (record.error) {
      errors.push(`Invalid ${label}: status 'succeeded' forbids error.`);
    }
  }

  if (record.status === "failed") {
    if (!record.error) {
      errors.push(`Invalid ${label}: status 'failed' requires error.`);
    }
    if (record.result) {
      errors.push(`Invalid ${label}: status 'failed' forbids result.`);
    }
  }

  if (
    (record.status === "queued" || record.status === "claimed" || record.status === "running" || record.status === "stalled") &&
    (record.result || record.error)
  ) {
    errors.push(`Invalid ${label}: status '${record.status}' forbids result and error.`);
  }

  return errors;
}

export function shouldIncrementAttempt(
  action: LifecycleAction,
  from_status: JobStatus,
  to_status: JobStatus,
): boolean {
  return (
    action === "claimNext" &&
    to_status === "claimed" &&
    (from_status === "queued" || from_status === "stalled")
  );
}

export function shouldIncrementRevision(input: {
  accepted: boolean;
  idempotent_retry?: boolean;
}): boolean {
  return input.accepted && !input.idempotent_retry;
}

export type ValidateAttemptAndRevisionSemanticsInput = {
  current: JobRecord;
  next: JobRecord;
  action: LifecycleAction;
  accepted: boolean;
  idempotent_retry?: boolean;
};

export function validateAttemptAndRevisionSemantics(
  input: ValidateAttemptAndRevisionSemanticsInput,
): string[] {
  const errors: string[] = [];
  const expectedAttempt =
    input.current.attempt +
    (shouldIncrementAttempt(input.action, input.current.status, input.next.status) ? 1 : 0);
  if (input.next.attempt !== expectedAttempt) {
    errors.push(`Invalid attempt progression: expected ${expectedAttempt}, got ${input.next.attempt}.`);
  }

  const expectedRev =
    input.current.rev + (shouldIncrementRevision(input) ? 1 : 0);
  if (input.next.rev !== expectedRev) {
    errors.push(`Invalid revision progression: expected ${expectedRev}, got ${input.next.rev}.`);
  }

  return errors;
}
