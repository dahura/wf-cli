# /review

Starts review phase.

## Usage
/review <plan-number-or-slug>

## Behavior
- Calls `bun run wf review <id>`
- Agent MUST immediately call `bun run wf context <id> --json --include=plan,todo,review,evidence,state`
- Agent creates/updates `plans/<resolved-plan-dir>/review.md`
- Agent MUST include verdict lines for each checked TODO ID: `- [T1]: pass|fail|partial`
- Agent MUST NOT implement fixes

## Decision (after writing `review.md`)

- If **no issues**: run `/done <id>` and STOP
- If **issues exist** and review is run standalone:
  - DO NOT transition phases automatically
  - STOP and tell the user there are key fixes to implement
  - Ask the user to start fixing by running `/fix <id>` (fixes are done only in `fixing`)
- If **issues exist** and review is running inside `/epic run` orchestration:
  - DO NOT stop for user confirmation
  - Continue orchestration loop automatically: `/fix <id>` -> `@plan-fixer` -> `/finish-code <id>` -> `/review <id>`
