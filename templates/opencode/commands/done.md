---
description: Completes a plan
agent: build
---

Completes a plan.

Usage: `/done <plan-number-or-slug>`

Behavior:
- Calls `bun run wf done <id>`
- Runs done quality gates and marks plan completed only if:
  - every checked TODO has `- [TID]: pass`,
  - every accepted TODO has a complete review contract section (`intent_match`, `behavior_match`, `test_adequacy`, `risk`, `code_refs`),
  - if `- strict: true` is present in `review.md`, `quality-run.json` exists and is valid.
