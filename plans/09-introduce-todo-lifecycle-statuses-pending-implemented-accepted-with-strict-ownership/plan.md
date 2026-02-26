# Plan 09: Introduce TODO lifecycle statuses and strict ownership

## Goal
Represent TODO lifecycle as explicit statuses (`pending`, `implemented`, `accepted`) and enforce ownership boundaries between implementers and reviewers.

## Scope
- Add a lifecycle derivation module for TODO + review content.
- Expose lifecycle data in `wf context` output.
- Add tests that verify status derivation and ownership mapping.

## Out of scope
- Migrating existing `todo.md` syntax.
- Adding a separate persisted lifecycle state file.

## Acceptance criteria
- Lifecycle is derived deterministically from TODO and review artifacts.
- Ownership is explicit (`implementer` for pending/implemented, `reviewer` for accepted).
- `bun test` and `bun run typecheck` pass.
