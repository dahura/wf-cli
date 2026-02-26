# Plan 12: Add `wf worker` long-lived consumer loop with lease heartbeat and retries

## Goal
Implement a worker runtime command that continuously claims, executes, heartbeats, and finalizes distributed jobs with safe recovery behavior.

## Scope
- Add worker CLI parsing and runtime entrypoint.
- Implement claim/start/execute/complete-fail loop with lease heartbeat.
- Add expired-lease recovery by stalling and requeueing recoverable jobs.
- Add worker loop tests for role-filtered execution.

## Out of scope
- Multi-process worker supervision.
- External observability stack integrations.

## Acceptance criteria
- `wf worker <role>` can process eligible jobs from the distributed queue.
- Heartbeats and retry-safe failure handling are implemented.
- Expired in-flight jobs are recoverable through requeue path.
- `bun test` and `bun run typecheck` pass.
