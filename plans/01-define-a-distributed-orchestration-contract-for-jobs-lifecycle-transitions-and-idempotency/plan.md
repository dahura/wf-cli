# Plan 01: Define a distributed orchestration contract (jobs, transitions, idempotency, leases)

## Goal
Define a **versioned, JSON-serializable contract** for distributed orchestration so independent runtimes (Cursor + OpenCode workers) can safely coordinate plan execution with **idempotent job creation**, **exclusive ownership via leases**, and **auditable lifecycle transitions**, while mapping cleanly onto existing `wf-cli` plan phases and commands.

## Scope
- Define core terms and invariants: **job**, **work item**, **attempt**, **worker**, **runtime**, **owner**, **lease**, **idempotency/dedupe key**.
- Define a **Job contract (v1)**:
  - Canonical **record schema** (fields + types) and a **stable JSON shape** suitable for persistence and cross-runtime exchange.
  - Lifecycle **status set**: `queued | claimed | running | succeeded | failed | stalled`.
  - **Transition event schema** for observability/auditing (append-only transition log).
  - **Concurrency / atomicity requirements** for transitions (compare-and-swap semantics).
- Define contract-level **idempotency rules**:
  - What must be deduped, in which scope (repo/epic/plan), and what “duplicate” means.
  - How idempotency is enforced at enqueue and transition boundaries (without prescribing the final string format).
- Define contract-level **ownership / lease rules**:
  - Exclusive claim semantics, lease renewal, and what happens on expiration.
  - What inputs/outputs transition operations must accept to be safely retried.
- Define **mapping points** to current `wf-cli` behavior:
  - How a distributed “work item” references today’s plan state (`phase`, `iteration`) and the CLI commands that advance it (`code`, `finish-code`, `review`, `fix`, `done`).
  - How worker roles (from `.wf/subagents.models.json`) relate to job routing (role-specific consumption).

## Out of scope
- Queue persistence/implementation and dispatcher loop (covered by plans **05–06**).
- Worker CLI commands, heartbeats, retries/backoff, and stalled recovery behavior (covered by plan **08**).
- Full lifecycle policy details / state machine edge cases (covered by plan **02**).
- Exact idempotency key **format** and duplicate suppression algorithm (covered by plan **03**).
- Concrete lease durations, renewal cadence, and reclaim policy (covered by plan **04**).
- Any UI/dashboard work.

## Contract: versioning and compatibility
- The contract must be explicitly versioned, e.g. `contract_version: 1`.
- All records must be pure JSON:
  - No `Date` objects; timestamps are ISO-8601 strings (UTC).
  - Prefer integers for counters/revisions.
  - Unknown fields must be **ignored** by readers (forward compatibility).

## Contract v1: entities and fields

### 1) Job identity and target
A **job** represents one orchestratable work item. It has:
- **`job_id`**: unique identifier for the persisted record (opaque string; UUID recommended).
- **`dedupe_key`**: stable identifier for “this work item” used for duplicate suppression (string).
  - The contract requires the field and its semantics; the **exact format** is defined in plan **03**.
- **`target`**: where/what the job acts on (must be serializable and stable):
  - `repo_id` (optional, if needed to disambiguate multiple workspaces)
  - `epic_id` (optional; present for epic-driven orchestration)
  - `plan_id` (required when the job targets a plan)
  - `plan_iteration` (required when work is attempt-scoped; sourced from `plans/<id>/state.json`)
  - `workflow_command` (one of: `plan | code | finish-code | review | fix | done | verify`, as applicable)

### 2) Lifecycle status
- **Non-terminal**: `queued`, `claimed`, `running`, `stalled`
- **Terminal**: `succeeded`, `failed`

Terminal states must be immutable (no further transitions except no-op/idempotent repeats of the terminal write).

### 3) Ownership and leasing
- **Owner** identifies the worker currently responsible:
  - `owner.worker_id` (required for `claimed`/`running`)
  - `owner.runtime` (e.g. `cursor` or `opencode`, string)
  - optional diagnostics: `owner.host`, `owner.pid`
- **Lease** defines exclusivity:
  - `lease.expires_at` ISO timestamp
  - `lease.renewed_at` ISO timestamp (optional)

Invariants:
- At most **one** owner is valid for a non-terminal job at any time.
- A worker may only mutate a job it owns, unless reclaiming a job whose lease has expired (policy details in plan **04**).

### 4) Attempts, revision, and events
- **`attempt`**: integer incremented when a job is (re)claimed for execution (policy in plans **02/04**).
- **`rev`**: monotonically increasing integer for optimistic concurrency control (CAS).
- **`events[]`**: append-only transition history:
  - `event_id` (opaque string)
  - `type` (e.g. `enqueued`, `claimed`, `started`, `heartbeat`, `succeeded`, `failed`, `stalled`, `requeued`)
  - `from_status`, `to_status`
  - `at` ISO timestamp
  - `actor` (worker identity or orchestrator identity)
  - `request_id` (optional; enables idempotent replays of the same transition request)

### 5) Results and errors (shape only)
- `result` (present on `succeeded`): JSON object (implementation-defined; must remain serializable).
- `error` (present on `failed`): JSON object with at least `message` and optional `code`, `stack`, `details`.

## Contract v1: required operations (interface semantics)
The queue/storage implementation (plan **05**) must provide operations with the following semantics (names may differ; behavior must match):

- **Enqueue (idempotent)**: given a job spec with `dedupe_key`, either:
  - create a new job in `queued`, or
  - return the existing job for the same `dedupe_key` (duplicate suppression).
- **Claim (exclusive)**: atomically select a `queued` job matching the consumer’s role filter and set:
  - `status = claimed`, set `owner`, set/refresh `lease`, increment `attempt`, increment `rev`, append event.
- **Start / Heartbeat (owned, retry-safe)**:
  - must be safe to retry with the same `request_id` without changing meaning.
- **Complete / Fail (owned, idempotent)**:
  - must be safe to repeat (e.g. write-once terminal state), guarded by `(job_id, owner, rev/request_id)`.
- **Stall / Reclaim hooks**:
  - the contract must allow representing “lease expired / worker presumed dead” (`stalled`) and subsequent requeue/reclaim (policy in plan **04**).

Concurrency rule:
- Every mutating operation must be expressed as a conditional update (CAS) on at least:
  - expected `status`
  - expected `owner` (when applicable)
  - expected `rev` (or an equivalent revision/token)

## Mapping to existing `wf-cli` plan phases and commands
This contract must map onto the existing plan state machine (see `src/core/plans.ts` and `src/core/context.ts`):
- Plan phases: `planning → coding → awaiting_review → reviewing → fixing → completed|blocked`
- Allowed next commands by phase:
  - `planning`: `code`
  - `coding`: `finish-code`
  - `awaiting_review`: `review`
  - `reviewing`: `fix` or `done`
  - `fixing`: `finish-code`
  - `blocked`: `fix`

Distributed orchestration must treat each “advance” as a job targetable by role-specific workers (routing policy is defined later, but the job payload must carry enough metadata to support it).

## Acceptance criteria
- A written contract exists (in code as types/interfaces and/or accompanying spec text) that:
  - defines the **v1 schema** for jobs, leases, events, idempotency hooks, and required operations,
  - clearly states atomicity/CAS requirements for safe distributed operation,
  - explicitly maps job targets to existing `wf-cli` plan phases/commands and uses plan `iteration` as part of the stable identity.
- The contract is sufficiently precise for plans **02–06** to implement against without redefining core fields.
- `bun test` and `bun run typecheck` pass after the contract artifacts are introduced.
