# Evidence

## T1
- status: pass
- command: `bun test src/core/quality.test.ts`
- output: evidence parsing validates status, command, and output extraction by TODO section.
- notes: implemented in `src/core/quality.ts`.

## T2
- status: pass
- command: `bun test src/core/quality.test.ts`
- output: review gate fails when command/output fields are missing for checked TODO IDs.
- notes: covered by dedicated negative test.

## T3
- status: pass
- command: `bun test src/core/quality.test.ts`
- output: done-gate pass/fail behavior for review verdict lines remains enforced.
- notes: existing done-gate tests kept and updated for stricter evidence content.

## T4
- status: pass
- command: `bun test src/core/quality.test.ts src/core/verify.test.ts`
- output: updated suites validate hardened evidence requirements and verify command targets.
- notes: tests updated with full evidence entries.

## T5
- status: pass
- command: `bun test && bun run typecheck`
- output: all tests and typecheck pass.
- notes: no regressions detected.
