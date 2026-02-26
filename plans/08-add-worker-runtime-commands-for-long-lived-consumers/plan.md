# Plan 08: Add worker runtime commands for long-lived consumers

## Goal
Implement worker runtime commands that can run long-lived consumer loops for distributed jobs, execute mapped workflow commands, and safely report completion/failure transitions.

## Scope
- Add worker CLI command surface for role-specific consumers.
- Implement claim-execute-transition loop with lease heartbeat and graceful shutdown.
- Handle successful completion, failures, and retry-safe transition requests.
- Add tests for worker loop behavior and command dispatch integration.

## Out of scope
- External orchestration service deployment.
- UI/dashboard for worker monitoring.

## Acceptance criteria
- Worker commands can consume and process role-appropriate jobs.
- Loop handles heartbeats, completion/failure transitions, and shutdown safely.
- Behavior is covered by automated tests.
- `bun test` and `bun run typecheck` pass.
