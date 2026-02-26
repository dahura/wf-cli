# Epic: Distributed Multi-Environment Orchestration (Cursor + OpenCode Workers)

## Goal
Add an event-driven orchestration layer to `wf-cli` so plan execution can be distributed automatically across multiple runtimes (Cursor and OpenCode) with role-based worker pools, while preserving full backward compatibility with the current command-driven flow.

## Scope
- Define a distributed orchestration contract for jobs, lifecycle transitions, and idempotency:
  - Job lifecycle: `queued -> claimed -> running -> succeeded|failed|stalled`
  - Idempotency key format and duplicate suppression rules
  - Ownership/lease rules to prevent concurrent execution of the same work item
- Introduce queue abstraction and dispatcher loop in `wf-cli`:
  - Dispatcher maps plan phases to role-specific jobs and publishes work items
  - Support feature-flagged mode: `WF_DISTRIBUTED=1` enables distributed orchestration
- Add worker runtime commands for long-lived consumers:
  - `wf worker` for role-filtered workers (for Cursor and OpenCode environments)
  - Worker heartbeat, claim/lease renewal, retry/backoff, stalled job recovery
- Add runtime routing policy for multi-environment execution:
  - Cursor workers handle orchestration/review roles
  - OpenCode workers handle coding/fixing roles
  - Keep policy configurable per role
- Introduce a unified user-facing configuration surface:
  - Add a single top-level config (`wf.config.json` or `wf.config.yaml`) for mode selection, role-to-model mapping, and environment routing
  - Keep runtime/session/job state in separate internal files and do not mix mutable execution state with user-declared config
  - Ensure existing `.wf/subagents.models.json` and related files remain supported during migration
- Provide observability and operations tooling:
  - Queue/job status commands
  - Structured logs for job transitions, retries, and failures
  - Manual retry and dead-letter handling paths
- Deliver phased rollout with safe fallback:
  - Distributed mode OFF by default
  - Existing `/epic run` and plan lifecycle commands remain functional unchanged

## Out of scope
- Full cloud-managed scheduler or multi-tenant orchestration service
- UI dashboard for queue monitoring
- Auto-scaling infrastructure for worker pools
- Rewriting existing plan quality gates and review semantics
- Mandatory migration of all users to distributed mode
- Forcing users to edit runtime state files directly

## Acceptance criteria
- `wf-cli` supports a distributed mode where workers in separate runtimes can automatically pick up and complete role-specific jobs.
- No duplicate execution for the same phase/iteration/role combination (idempotency enforced).
- If a worker crashes mid-job, work is safely recoverable via stalled detection and retry policy.
- With distributed mode disabled, current behavior remains unchanged and compatible.
- End-to-end epic execution can complete using mixed worker pools (Cursor + OpenCode) without manual baton passing.
- Operators can inspect queue state, in-flight jobs, retries, and failures via CLI commands.
- Users can configure workflow behavior from a single stable config surface, while runtime state stays internal and isolated.
