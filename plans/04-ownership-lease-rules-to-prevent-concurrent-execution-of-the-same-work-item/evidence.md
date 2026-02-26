# Evidence

Provide execution evidence for each checked TODO ID.

## T1
- status: pass
- command: `bun test`
- output: lease helper behavior is validated for creation, renewal timestamps, and expiry checks.
- notes: implemented in `src/core/distributed.ts` (`createLease`, `isLeaseExpired`).

## T2
- status: pass
- command: `bun test`
- output: owner-only transitions are enforced by transition invariants.
- notes: `validateTransitionInvariants` guards `start|heartbeat|complete|fail`.

## T3
- status: pass
- command: `bun test`
- output: claim eligibility supports safe reclaim on expired claimed/running jobs.
- notes: `canClaimJob` checks lease expiry before reclaiming active jobs.

## T4
- status: pass
- command: `bun test`
- output: concurrent ownership violations are rejected by owner identity checks.
- notes: current owner must match transition actor for execution actions.

## T5
- status: pass
- command: `bun test && bun run typecheck`
- output: suite and typecheck remain green.
- notes: no regressions introduced.
