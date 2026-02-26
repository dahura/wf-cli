# Evidence

## T1
- status: pass
- command: `bun test`
- output: `src/core/orchestration-contract.test.ts` passes, including JSON round-trip for representative contract object.
- notes: Added `src/core/orchestration-contract.ts` with v1 `JobRecord` schema fields (`job_id`, `contract_version`, `dedupe_key`, `target`, `status`, `attempt`, `rev`, `owner`, `lease`, `events`, `result`, `error`).

## T2
- status: pass
- command: `bun run typecheck`
- output: `tsc --noEmit` exit code 0.
- notes: Added `DistributedJobQueue` interface with implementation-agnostic operations (`enqueue`, `claimNext`, `start`, `heartbeat`, `complete`, `fail`, `stall`, `requeueStalled`, `getById`, `list`) and CAS-bearing transition input types.

## T3
- status: pass
- command: `bun test`
- output: Invariant checks test passes for terminal immutability, owner-only completion, and CAS requirement.
- notes: Added pure function `validateTransitionInvariants` plus helpers for terminal detection and owner matching.

## T4
- status: pass
- command: `bun test`
- output: Contract test suite passes for JSON round-trip, unknown-field ignore behavior, and unsupported version rejection.
- notes: Added `src/core/orchestration-contract.test.ts`.

## T5
- status: pass
- command: `bun test`
- output: Mapping assertions pass for `planning -> code`, `reviewing -> fix|done`, and `fixing -> finish-code`.
- notes: Added canonical mapping constant `PLAN_PHASE_ALLOWED_WORKFLOW_COMMANDS` and switched `getAllowedNextCommands` to consume it.

## T6
- status: pass
- command: `bun run typecheck`
- output: `tsc --noEmit` exit code 0.
- notes: Added idempotency contract surface via `dedupe_key`, `DedupeScopeRef`, `EnqueueJobInput.dedupe_scope`, and transition `request_id` fields; concrete key format intentionally not specified.

## T7
- status: pass
- command: `bun run typecheck`
- output: `tsc --noEmit` exit code 0.
- notes: Added ownership/lease contract surface (`JobOwner`, `JobLease`, claim/heartbeat lease fields, and transition invariants for owner checks); lease timing/reclaim policy intentionally deferred.
