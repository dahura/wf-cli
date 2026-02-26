# /fix

Fixes issues from review.

## Usage
/fix <plan-number-or-slug>

## Behavior
- Calls `bun run wf fix <id>`
- Agent MUST immediately call `bun run wf context <id> --json --include=review,todo,evidence,state`
- Agent implements fixes listed in `plans/<resolved-plan-dir>/review.md` (no new features)
- Agent MUST track progress in `plans/<resolved-plan-dir>/todo.md` (add/check off fix TODOs)
- Agent MUST update `plans/<resolved-plan-dir>/evidence.md` for each checked fix TODO ID
- When fix TODOs are completed: run `/finish-code <id>` to return to `awaiting_review` and STOP
- Returns to awaiting_review
