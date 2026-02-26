# Plan 02: Job lifecycle semantics (`queued → claimed → running → succeeded|failed|stalled`)

## Goal
Define and codify the **authoritative job lifecycle semantics** for distributed orchestration so all queue/storage implementations and worker runtimes enforce the same safe state machine: `queued → claimed → running → succeeded|failed|stalled`.

## Scope
- Define the **meaning** of each job status (`queued`, `claimed`, `running`, `succeeded`, `failed`, `stalled`) and the **required invariants** for each status (ownership, leases, terminal fields, mutability).
- Specify the **authoritative allowed transitions** and which contract operation performs them (`enqueue`, `claimNext`, `start`, `heartbeat`, `complete`, `fail`, `stall`, `requeueStalled`).
- Specify **attempt** and **revision (`rev`)** semantics and when they must change.
- Specify **retry / idempotency semantics** for lifecycle transitions using `request_id` (without defining `dedupe_key` format).
- Add/extend **implementation-agnostic contract helpers/validators + tests** so later plans (queue, workers, recovery) implement against a single canonical lifecycle policy.
- Explicitly document boundaries and integration points with plan **01** (contract), plan **03** (dedupe key format), and plan **04** (lease/reclaim policy).

## Out of scope
- Exact `dedupe_key` string format and duplicate suppression algorithm (plan **03**).
- Concrete lease durations, renewal cadence, reclaim eligibility rules, and backoff (plan **04**).
- Queue persistence/selection algorithms and dispatcher loop (plans **05–06**).
- Worker CLI commands, long-lived consumer loops, and automated stalled recovery behavior (plan **08**).
- Role-to-runtime routing policy and configuration surface (later plans).

## Lifecycle semantics (contract v1)
This plan refines the contract from plan **01** by defining **state machine policy** and **edge-case behavior**. It must remain compatible with:
- `JobStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "stalled"`
- `DistributedJobQueue` operations in `src/core/orchestration-contract.ts`

### Status meanings
- **`queued`**: Job exists and is **eligible to be claimed** by a worker. No active owner/lease.
- **`claimed`**: A specific worker has **exclusive responsibility** via an active lease, but execution has not been marked as started yet.
- **`running`**: The owner has started execution and is expected to heartbeat/renew the lease while making progress.
- **`succeeded`**: Terminal success; contains `result`.
- **`failed`**: Terminal failure; contains `error`.
- **`stalled`**: Non-terminal “orphaned” state indicating the previous lease/owner is no longer trusted (e.g., lease expired / worker presumed dead). This state exists to enable safe recovery without silent duplicate execution.

### Required invariants per status
- **Queued**
  - `owner` MUST be absent
  - `lease` MUST be absent
  - `result`/`error` MUST be absent
- **Claimed**
  - `owner` MUST be present
  - `lease` MUST be present
  - `result`/`error` MUST be absent
- **Running**
  - `owner` MUST be present
  - `lease` MUST be present
  - `result`/`error` MUST be absent until terminal write
- **Succeeded**
  - `result` MUST be present
  - `error` MUST be absent
  - `owner`/`lease` SHOULD be absent (clear on terminal write)
- **Failed**
  - `error` MUST be present
  - `result` MUST be absent
  - `owner`/`lease` SHOULD be absent (clear on terminal write)
- **Stalled**
  - `owner` MUST be absent (clear on stall)
  - `lease` MUST be absent (clear on stall)
  - `result`/`error` MUST be absent

### Allowed transitions (authoritative)
No transitions outside the following set are allowed. “No-op” repeats with the same resulting status are allowed only where explicitly stated (for idempotent retries).

- **Enqueue**
  - Creates `queued` (or returns existing record by `dedupe_key`, per plan **03**)
- **Claim (`claimNext`)**
  - `queued → claimed`
  - `stalled → claimed` is allowed only as a **reclaim** path; eligibility/policy is defined in plan **04**
- **Start (`start`)**
  - `claimed → running`
- **Heartbeat (`heartbeat`)**
  - `claimed → claimed` (lease extension without starting)
  - `running → running` (lease extension while running)
- **Complete (`complete`)**
  - `running → succeeded`
- **Fail (`fail`)**
  - `running → failed`
- **Stall (`stall`)**
  - `claimed → stalled`
  - `running → stalled`
- **Requeue (`requeueStalled`)**
  - `stalled → queued`

### Concurrency, CAS, and retry semantics
These rules layer on top of plan **01** invariants (CAS required, terminal immutability, owner-only execution transitions).

- **CAS is mandatory**: every mutating transition must use optimistic concurrency (`cas.expected_rev` at minimum).
- **Owner-only execution transitions**: `start`, `heartbeat`, `complete`, `fail` must only be accepted from the current owner.
- **System transitions**: `stall` and `requeueStalled` do not require an owning actor, but must still use CAS and must only apply from allowed source states.
- **Idempotent retries**:
  - All retry-safe transitions MUST carry a `request_id` (as already required by contract invariants).
  - Repeating the same logical transition with the same `request_id` SHOULD be treated as success and MUST NOT change semantics (no extra attempt increments; no duplicate terminal writes).
  - Queue implementations may satisfy this either by detecting prior application via the transition/event log or by returning the current record when it already reflects the requested outcome.

### Attempt and revision semantics
- **`attempt`**
  - Starts at 0 when created in `queued`.
  - Increments exactly when a job enters `claimed` via `claimNext` (including reclaiming a stalled job).
  - MUST NOT change on `start`, `heartbeat`, `complete`, `fail`, `stall`, or `requeueStalled`.
- **`rev`**
  - Monotonically increases on every accepted state mutation (including lease renewal heartbeats).
  - MUST NOT increase for idempotent retries that are treated as no-ops due to matching `request_id` / already-applied transitions.

### Event semantics (audit log)
- Each successful transition appends a `JobEvent` describing `(from_status, to_status, at, actor, request_id?)`.
- Event `type` strings should be canonicalized across implementations (e.g. `enqueued`, `claimed`, `started`, `heartbeat`, `succeeded`, `failed`, `stalled`, `requeued`) so later observability commands can rely on a stable vocabulary.

## Integration points with other plans
- **Plan 01 (contract)**: this plan must not change the v1 schema; it adds **policy** and **validators** around the existing fields/operations.
- **Plan 03 (idempotency key format)**: lifecycle rules must treat `dedupe_key` as an opaque string with dedupe semantics, without assuming its format.
- **Plan 04 (leases/reclaim)**: this plan defines how `stalled` behaves and which transitions exist; plan 04 defines **when** stalls are detected, **how long** leases last, and the reclaim/backoff policy.

## Acceptance criteria
- The repository contains a clear, test-backed definition of:
  - allowed lifecycle transitions and per-status invariants,
  - attempt/rev update semantics,
  - retry/idempotency expectations using `request_id`,
  - and explicit boundaries with plans **03**/**04**.
- Contract-level helpers/validators exist so future queue/worker implementations can reuse the same lifecycle policy.
- `bun test` and `bun run typecheck` pass.
