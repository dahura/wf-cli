import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type {
  ClaimJobInput,
  CompleteJobInput,
  DistributedJobQueue,
  EnqueueJobInput,
  EnqueueJobResult,
  FailJobInput,
  HeartbeatJobInput,
  JobLease,
  JobOwner,
  JobRecord,
  JobStatus,
  JobTarget,
  ListJobsFilter,
  LifecycleAction,
  RequeueStalledJobInput,
  StartJobInput,
  StallJobInput,
  WorkflowCommand,
} from "./orchestration-contract";
import {
  SUPPORTED_JOB_CONTRACT_VERSION,
  buildLifecycleEvent,
  parseJobRecord,
  validateTransitionInvariants,
} from "./orchestration-contract";

export const DISTRIBUTED_ENV_FLAG = "WF_DISTRIBUTED";
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const QUEUE_DB_PATH = join(".wf", "distributed", "queue.db");

export type WorkerRole = "orchestrator" | "plan-coder" | "plan-reviewer" | "plan-fixer";

export const WORKER_ROLE_COMMAND_FILTERS: Record<WorkerRole, WorkflowCommand[]> = {
  orchestrator: ["plan", "verify"],
  "plan-coder": ["code"],
  "plan-reviewer": ["review"],
  "plan-fixer": ["fix"],
};

type MutableTransitionInput = {
  current: JobRecord;
  next_status: JobStatus;
  action: LifecycleAction;
  actor?: { worker_id: string; runtime: string };
  request_id?: string;
};

export function isDistributedModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[DISTRIBUTED_ENV_FLAG] === "1";
}

export function buildDedupeKey(target: JobTarget): string {
  return [
    `plan:${target.plan_id}`,
    `it:${target.plan_iteration}`,
    `cmd:${target.workflow_command}`,
    target.executor_role ? `role:${target.executor_role}` : "",
    target.executor_runtime ? `runtime:${target.executor_runtime}` : "",
    target.epic_id ? `epic:${target.epic_id}` : "",
    target.repo_id ? `repo:${target.repo_id}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

export function parseDedupeKey(key: string): {
  plan_id: string;
  plan_iteration: number;
  workflow_command: WorkflowCommand;
  executor_role?: string;
  executor_runtime?: string;
  epic_id?: string;
  repo_id?: string;
} | null {
  const values = new Map<string, string>();
  for (const segment of key.split("|")) {
    const [rawK, rawV] = segment.split(":");
    if (!rawK || !rawV) continue;
    values.set(rawK, rawV);
  }

  const plan_id = values.get("plan");
  const plan_iteration_raw = values.get("it");
  const workflow_command = values.get("cmd") as WorkflowCommand | undefined;
  if (!plan_id || !plan_iteration_raw || !workflow_command) return null;
  const plan_iteration = Number(plan_iteration_raw);
  if (!Number.isInteger(plan_iteration)) return null;
  return {
    plan_id,
    plan_iteration,
    workflow_command,
    ...(values.get("role") ? { executor_role: values.get("role") } : {}),
    ...(values.get("runtime") ? { executor_runtime: values.get("runtime") } : {}),
    ...(values.get("epic") ? { epic_id: values.get("epic") } : {}),
    ...(values.get("repo") ? { repo_id: values.get("repo") } : {}),
  };
}

export function createLease(nowIso: string, leaseMs = DEFAULT_LEASE_MS): JobLease {
  const now = new Date(nowIso);
  const expires = new Date(now.getTime() + leaseMs);
  return {
    expires_at: expires.toISOString(),
    renewed_at: now.toISOString(),
  };
}

export function isLeaseExpired(lease: JobLease, nowIso: string): boolean {
  return Date.parse(lease.expires_at) <= Date.parse(nowIso);
}

export function canClaimJob(job: JobRecord, nowIso: string): boolean {
  if (job.status === "queued" || job.status === "stalled") return true;
  if ((job.status === "claimed" || job.status === "running") && job.lease) {
    return isLeaseExpired(job.lease, nowIso);
  }
  return false;
}

function transitionRecord(input: MutableTransitionInput): JobRecord {
  const errors = validateTransitionInvariants({
    current: input.current,
    next_status: input.next_status,
    action: input.action,
    cas: { expected_rev: input.current.rev },
    actor: input.actor,
    request_id: input.request_id,
  });
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  return {
    ...input.current,
    status: input.next_status,
    rev: input.current.rev + 1,
  };
}

export class FileDistributedJobQueue implements DistributedJobQueue {
  private readonly db: Database;

  constructor(private readonly cwd: string) {
    const dbPath = join(cwd, QUEUE_DB_PATH);
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.ensureSchema();
  }

  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    const tx = this.db.transaction(() => {
      const existing = this.getByDedupeKeySync(input.dedupe_key);
      if (existing) return { job: existing, deduped: true } satisfies EnqueueJobResult;

      const job: JobRecord = {
        job_id: crypto.randomUUID(),
        contract_version: SUPPORTED_JOB_CONTRACT_VERSION,
        dedupe_key: input.dedupe_key,
        target: input.target,
        status: "queued",
        attempt: 0,
        rev: 1,
        events: [
          buildLifecycleEvent({
            event_id: crypto.randomUUID(),
            action: "enqueue",
            from_status: "queued",
            to_status: "queued",
            at: input.created_at,
            actor: "dispatcher",
            request_id: input.metadata?.request_id as string | undefined,
          }),
        ],
      };

      this.persistJobSync(job);
      return { job, deduped: false } satisfies EnqueueJobResult;
    });
    return tx();
  }

  async claimNext(input: ClaimJobInput): Promise<JobRecord | null> {
    const tx = this.db.transaction(() => {
      const nowIso = new Date().toISOString();
      const candidate = this.pickNextJobSync(input, nowIso);
      if (!candidate) return null;

      const next = transitionRecord({
        current: candidate,
        next_status: "claimed",
        action: "claimNext",
        actor: { worker_id: input.worker.worker_id, runtime: input.worker.runtime },
        request_id: input.request_id ?? crypto.randomUUID(),
      });
      next.owner = input.worker;
      next.lease = {
        expires_at: input.lease_expires_at,
        renewed_at: nowIso,
      };
      next.attempt = candidate.attempt + 1;
      next.events = [
        ...candidate.events,
        buildLifecycleEvent({
          event_id: crypto.randomUUID(),
          action: "claimNext",
          from_status: candidate.status,
          to_status: "claimed",
          at: nowIso,
          actor: `${input.worker.runtime}:${input.worker.worker_id}`,
          request_id: input.request_id,
        }),
      ];

      this.persistJobSync(next);
      return next;
    });
    return tx();
  }

  async start(input: StartJobInput): Promise<JobRecord> {
    return this.applyWithOwnerTransition(
      input.job_id,
      "start",
      "running",
      input.actor,
      input.cas,
      input.at,
      input.request_id,
    );
  }

  async heartbeat(input: HeartbeatJobInput): Promise<JobRecord> {
    const next = await this.applyWithOwnerTransition(
      input.job_id,
      "heartbeat",
      "running",
      input.actor,
      input.cas,
      input.at,
      input.request_id,
    );
    next.lease = { expires_at: input.lease_expires_at, renewed_at: input.at };
    this.persistJobSync(next);
    return next;
  }

  async complete(input: CompleteJobInput): Promise<JobRecord> {
    const next = await this.applyWithOwnerTransition(
      input.job_id,
      "complete",
      "succeeded",
      input.actor,
      input.cas,
      input.at,
      input.request_id,
    );
    next.result = input.result;
    next.owner = undefined;
    next.lease = undefined;
    this.persistJobSync(next);
    return next;
  }

  async fail(input: FailJobInput): Promise<JobRecord> {
    const next = await this.applyWithOwnerTransition(
      input.job_id,
      "fail",
      "failed",
      input.actor,
      input.cas,
      input.at,
      input.request_id,
    );
    next.error = input.error;
    next.owner = undefined;
    next.lease = undefined;
    this.persistJobSync(next);
    return next;
  }

  async stall(input: StallJobInput): Promise<JobRecord> {
    const current = await this.requireJob(input.job_id);
    this.assertCas(current, input.cas);
    const next = transitionRecord({
      current,
      next_status: "stalled",
      action: "stall",
      request_id: input.request_id,
    });
    next.owner = undefined;
    next.lease = undefined;
    next.events = [
      ...current.events,
      buildLifecycleEvent({
        event_id: crypto.randomUUID(),
        action: "stall",
        from_status: current.status,
        to_status: "stalled",
        at: input.at,
        actor: "watchdog",
        request_id: input.request_id,
      }),
    ];
    this.persistJobSync(next);
    return next;
  }

  async requeueStalled(input: RequeueStalledJobInput): Promise<JobRecord> {
    const current = await this.requireJob(input.job_id);
    this.assertCas(current, input.cas);
    const next = transitionRecord({
      current,
      next_status: "queued",
      action: "requeueStalled",
      request_id: input.request_id,
    });
    next.events = [
      ...current.events,
      buildLifecycleEvent({
        event_id: crypto.randomUUID(),
        action: "requeueStalled",
        from_status: current.status,
        to_status: "queued",
        at: input.at,
        actor: "watchdog",
        request_id: input.request_id,
      }),
    ];
    this.persistJobSync(next);
    return next;
  }

  async getById(job_id: string): Promise<JobRecord | null> {
    const row = this.db
      .query("SELECT payload_json FROM jobs WHERE job_id = ? LIMIT 1")
      .get(job_id) as { payload_json: string } | null;
    if (!row) return null;
    return parseJobRecord(JSON.parse(row.payload_json));
  }

  async list(filter?: ListJobsFilter): Promise<JobRecord[]> {
    const where: string[] = [];
    const args: SQLQueryBindings[] = [];
    if (filter?.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    if (filter?.owner_worker_id) {
      where.push("owner_worker_id = ?");
      args.push(filter.owner_worker_id);
    }
    if (filter?.plan_id) {
      where.push("plan_id = ?");
      args.push(filter.plan_id);
    }
    if (filter?.workflow_command) {
      where.push("workflow_command = ?");
      args.push(filter.workflow_command);
    }

    const query =
      "SELECT payload_json FROM jobs" +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY created_at ASC";
    const rows = this.db.query(query).all(...args) as Array<{ payload_json: string }>;
    return rows.map((row) => parseJobRecord(JSON.parse(row.payload_json)));
  }

  private async applyWithOwnerTransition(
    jobId: string,
    action: LifecycleAction,
    nextStatus: JobStatus,
    actor: { worker_id: string; runtime: string },
    cas: { expected_rev: number; expected_status?: JobStatus; expected_owner?: Pick<JobOwner, "worker_id" | "runtime"> },
    at: string,
    requestId?: string,
  ): Promise<JobRecord> {
    const current = await this.requireJob(jobId);
    this.assertCas(current, cas);
    const next = transitionRecord({
      current,
      next_status: nextStatus,
      action,
      actor,
      request_id: requestId,
    });
    next.events = [
      ...current.events,
      buildLifecycleEvent({
        event_id: crypto.randomUUID(),
        action,
        from_status: current.status,
        to_status: nextStatus,
        at,
        actor: `${actor.runtime}:${actor.worker_id}`,
        request_id: requestId,
      }),
    ];
    this.persistJobSync(next);
    return next;
  }

  private async requireJob(jobId: string): Promise<JobRecord> {
    const existing = await this.getById(jobId);
    if (!existing) throw new Error(`Job '${jobId}' not found.`);
    return existing;
  }

  private assertCas(
    current: JobRecord,
    cas: { expected_rev: number; expected_status?: JobStatus; expected_owner?: Pick<JobOwner, "worker_id" | "runtime"> },
  ): void {
    if (current.rev !== cas.expected_rev) {
      throw new Error(
        `CAS mismatch for job '${current.job_id}': expected rev ${cas.expected_rev}, got ${current.rev}.`,
      );
    }
    if (cas.expected_status && current.status !== cas.expected_status) {
      throw new Error(
        `CAS mismatch for job '${current.job_id}': expected status '${cas.expected_status}', got '${current.status}'.`,
      );
    }
    if (cas.expected_owner) {
      if (
        !current.owner ||
        current.owner.worker_id !== cas.expected_owner.worker_id ||
        current.owner.runtime !== cas.expected_owner.runtime
      ) {
        throw new Error(`CAS mismatch for job '${current.job_id}': expected owner mismatch.`);
      }
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        contract_version INTEGER NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        rev INTEGER NOT NULL,
        plan_id TEXT NOT NULL,
        workflow_command TEXT NOT NULL,
        executor_role TEXT,
        executor_runtime TEXT,
        created_at TEXT NOT NULL,
        owner_worker_id TEXT,
        owner_runtime TEXT,
        lease_expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status_role_runtime_created
        ON jobs (status, executor_role, executor_runtime, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_owner_worker
        ON jobs (owner_worker_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_plan_command
        ON jobs (plan_id, workflow_command);

      CREATE TABLE IF NOT EXISTS job_events (
        job_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        request_id TEXT,
        PRIMARY KEY (job_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_job_events_job_time
        ON job_events (job_id, at, seq);
    `);
  }

  private getByDedupeKeySync(dedupeKey: string): JobRecord | null {
    const row = this.db
      .query("SELECT payload_json FROM jobs WHERE dedupe_key = ? LIMIT 1")
      .get(dedupeKey) as { payload_json: string } | null;
    if (!row) return null;
    return parseJobRecord(JSON.parse(row.payload_json));
  }

  private pickNextJobSync(input: ClaimJobInput, nowIso: string): JobRecord | null {
    const where: string[] = ["status IN ('queued','stalled')"];
    const args: SQLQueryBindings[] = [];
    if (input.expected_status) {
      where.push("status = ?");
      args.push(input.expected_status);
    }
    if (input.command_filter && input.command_filter.length > 0) {
      where.push(`workflow_command IN (${input.command_filter.map(() => "?").join(",")})`);
      args.push(...input.command_filter);
    }
    if (input.role_filter) {
      where.push("executor_role = ?");
      args.push(input.role_filter);
    }
    if (input.runtime_filter) {
      where.push("executor_runtime = ?");
      args.push(input.runtime_filter);
    }

    const query = `
      SELECT payload_json
      FROM jobs
      WHERE ${where.join(" AND ")}
      ORDER BY created_at ASC
      LIMIT 1
    `;
    const row = this.db.query(query).get(...args) as { payload_json: string } | null;
    if (!row) return null;
    return parseJobRecord(JSON.parse(row.payload_json));
  }

  private persistJobSync(job: JobRecord): void {
    const createdAt = job.events[0]?.at ?? new Date().toISOString();
    const payload = JSON.stringify(job);
    this.db
      .query(
        `
        INSERT INTO jobs (
          job_id, contract_version, dedupe_key, payload_json, status, attempt, rev,
          plan_id, workflow_command, executor_role, executor_runtime, created_at,
          owner_worker_id, owner_runtime, lease_expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          contract_version=excluded.contract_version,
          dedupe_key=excluded.dedupe_key,
          payload_json=excluded.payload_json,
          status=excluded.status,
          attempt=excluded.attempt,
          rev=excluded.rev,
          plan_id=excluded.plan_id,
          workflow_command=excluded.workflow_command,
          executor_role=excluded.executor_role,
          executor_runtime=excluded.executor_runtime,
          created_at=excluded.created_at,
          owner_worker_id=excluded.owner_worker_id,
          owner_runtime=excluded.owner_runtime,
          lease_expires_at=excluded.lease_expires_at
      `,
      )
      .run(
        job.job_id,
        job.contract_version,
        job.dedupe_key,
        payload,
        job.status,
        job.attempt,
        job.rev,
        job.target.plan_id,
        job.target.workflow_command,
        job.target.executor_role ?? null,
        job.target.executor_runtime ?? null,
        createdAt,
        job.owner?.worker_id ?? null,
        job.owner?.runtime ?? null,
        job.lease?.expires_at ?? null,
      );

    this.db.query("DELETE FROM job_events WHERE job_id = ?").run(job.job_id);
    const insertEvent = this.db.query(
      `
      INSERT INTO job_events (
        job_id, event_id, seq, type, from_status, to_status, at, actor, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    );
    for (let i = 0; i < job.events.length; i += 1) {
      const evt = job.events[i];
      insertEvent.run(
        job.job_id,
        evt.event_id,
        i,
        evt.type,
        evt.from_status,
        evt.to_status,
        evt.at,
        evt.actor,
        evt.request_id ?? null,
      );
    }
  }
}
