# Plan 07: Feature-flagged distributed mode (`WF_DISTRIBUTED=1`)

## Goal
Add a controlled feature-flag path so distributed orchestration behavior is enabled only when `WF_DISTRIBUTED=1`, while preserving existing default behavior.

## Scope
- Define and implement distributed-mode flag detection.
- Route distributed queue/dispatcher behavior behind flag guards.
- Keep non-distributed mode behavior unchanged by default.
- Add tests for enabled and disabled flag paths.

## Out of scope
- Long-lived worker runtime command execution loops (plan 08).
- Production deployment and remote queue backends.

## Acceptance criteria
- `WF_DISTRIBUTED=1` enables distributed path.
- Flag off keeps existing local/default behavior.
- Both paths are tested for regressions.
- `bun test` and `bun run typecheck` pass.
