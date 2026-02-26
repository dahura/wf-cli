# Evidence

Provide execution evidence for each checked TODO ID.

## T1
- status: pass
- command: `bun test`
- output: lifecycle transition table and helper coverage pass in `src/core/orchestration-contract.test.ts`.
- notes: Added `LIFECYCLE_TRANSITIONS` and `isLifecycleTransitionAllowed`.

## T2
- status: pass
- command: `bun test`
- output: invariant tests pass for required/forbidden `owner`+`lease`, terminal immutability, and terminal payload rules.
- notes: Implemented `validateJobStatusInvariants` and integrated into `validateTransitionInvariants`.

## T3
- status: pass
- command: `bun test`
- output: canonical event vocabulary and event builder tests pass.
- notes: Added `LIFECYCLE_EVENT_TYPES`, `getLifecycleEventType`, and `buildLifecycleEvent`.

## T4
- status: pass
- command: `bun test`
- output: counter semantics helpers validated by unit tests.
- notes: Added `shouldIncrementAttempt`, `shouldIncrementRevision`, and `validateAttemptAndRevisionSemantics`.

## T5
- status: pass
- command: `bun test`
- output: happy-path transitions `queued -> claimed -> running -> succeeded` and `queued -> claimed -> running -> failed` pass.
- notes: Covered in `orchestration-contract` lifecycle tests.

## T6
- status: pass
- command: `bun test`
- output: illegal transition and invalid invariant scenarios are rejected as expected.
- notes: Includes queued->running, claimed->succeeded, running->queued, terminal->non-terminal, and invalid terminal payloads.

## T7
- status: pass
- command: `bun test`
- output: retry/idempotency tests pass for required `request_id`, heartbeat no-op transitions, and terminal idempotent repeats.
- notes: Added `idempotent_retry` enforcement for terminal repeats.

## T8
- status: pass
- command: `bun test && bun run typecheck`
- output: all tests pass (31/31), `tsc --noEmit` passes.
- notes: No schema changes to plan 01 contract types; policy helpers/tests added only.
