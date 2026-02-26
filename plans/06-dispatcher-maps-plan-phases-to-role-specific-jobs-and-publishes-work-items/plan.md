# Plan 06: Dispatcher role mapping and work-item publication

## Goal
Map plan phases to role-specific distributed jobs and publish those jobs through the queue so workers can consume only relevant commands.

## Scope
- Define role-to-command filters for orchestrator/coder/reviewer/fixer workers.
- Implement dispatcher mapping from plan phase to `workflow_command` jobs.
- Ensure published jobs include stable target identity (`epic`, `plan`, `iteration`, command).
- Add tests for correct routing and command filter behavior.

## Out of scope
- Feature flag rollout and UX safeguards (plan 07).
- Worker command-loop execution engine (plan 08).

## Acceptance criteria
- Dispatcher publishes correctly targeted jobs for plan phases.
- Role-specific consumers can filter claimable commands.
- Mapping and routing behavior is test-covered.
- `bun test` and `bun run typecheck` pass.
