# Plan 05: Introduce queue abstraction and dispatcher loop in wf-cli

## Goal
Introduce a concrete distributed queue implementation and dispatcher loop entry points in `wf-cli` that can enqueue and claim orchestration jobs using the v1 contract.

## Scope
- Implement a queue abstraction backed by project-local state for initial distributed mode.
- Provide enqueue/list/get/claim and transition operations aligned with contract semantics.
- Add dispatcher-facing helpers for creating queue instances and pushing work items.
- Add tests for queue persistence behavior and basic dispatcher interaction flow.

## Out of scope
- Detailed role-based routing matrix and phase-command mapping expansion (plan 06).
- User-facing feature flag defaults and rollout messaging (plan 07).
- Worker runtime commands and long-lived consumers (plan 08).

## Acceptance criteria
- Queue abstraction is available and integrated for dispatcher usage.
- Basic enqueue/claim/transition flow is operational and test-covered.
- Contract compatibility remains intact.
- `bun test` and `bun run typecheck` pass.
