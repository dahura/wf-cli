# Plan 04: Ownership and lease rules for exclusive execution

## Goal
Define and implement ownership and lease policy so at most one active worker can execute a work item while allowing safe reclaim after lease expiry.

## Scope
- Define lease lifecycle semantics: claim lease initialization, heartbeat renewals, and expiry checks.
- Define ownership checks for mutation operations (`start`, `heartbeat`, `complete`, `fail`).
- Define reclaim eligibility for expired `claimed`/`running` jobs and `stalled` handling.
- Add tests covering lease expiry, claim eligibility, and ownership enforcement.
- Keep compatibility with contract/lifecycle semantics from plans 01-03.

## Out of scope
- Dispatcher role-routing policy and publish orchestration (plan 06).
- Feature flag rollout surface (plan 07).
- Runtime worker command loops and watchdog behavior (plan 08).

## Acceptance criteria
- Lease and ownership behavior is codified with deterministic rules.
- Claim/reclaim prevents concurrent execution by multiple workers.
- Expired lease behavior is test-covered.
- `bun test` and `bun run typecheck` pass.
