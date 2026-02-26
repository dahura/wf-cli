# Plan 03: Idempotency key format and duplicate suppression rules

## Goal
Define and implement a deterministic idempotency strategy for distributed jobs so repeated enqueue and transition requests do not create duplicate work or inconsistent mutations.

## Scope
- Define canonical `dedupe_key` format and parsing rules using contract fields (`repo_id?`, `epic_id?`, `plan_id`, `plan_iteration`, `workflow_command`).
- Define duplicate suppression behavior for enqueue (`deduped: true` + return existing record).
- Define transition replay semantics using `request_id` for retry-safe operations.
- Add tests for key round-trip, malformed key parsing, and queue dedupe behavior.
- Keep compatibility with plan 01 and plan 02 contract/lifecycle semantics.

## Out of scope
- Lease duration/reclaim policy tuning (plan 04).
- Dispatcher scheduling and role-aware publication (plans 05-06).
- Worker long-lived command loops (plan 08).

## Acceptance criteria
- Stable `dedupe_key` builder/parser semantics are documented and test-covered.
- Queue enqueue suppresses duplicates by dedupe key.
- Retry-safe transitions preserve idempotent semantics.
- `bun test` and `bun run typecheck` pass.
