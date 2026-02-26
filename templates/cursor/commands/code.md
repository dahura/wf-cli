# /code

Starts coding phase for a plan.

## Usage
/code <plan-number-or-slug>

## Behavior
- Calls `bun run wf code <id>`
- Agent MUST immediately call `bun run wf context <id> --json --include=plan,todo,evidence,state`
- `id` is resolved by CLI to `plans/<NN>-*` (examples: `7`, `07`, `07-full-plan-slug`)
- Agent implements **ALL tasks** from `plans/<resolved-plan-dir>/todo.md`
- Agent MUST **check off** completed items in `plans/<resolved-plan-dir>/todo.md` while working
- Agent MUST keep `plans/<resolved-plan-dir>/evidence.md` in sync for each checked TODO ID
- When all TODO items are completed, Agent MUST run `/finish-code <id>` and STOP
- Agent MUST NOT review
