# /plan

Creates a new plan from a user intent.

## Usage
/plan <description> [--epic <epic-id-or-slug>]

## Behavior
- Calls `bun run wf plan "<description>" [--epic <id>]`
- Creates plan directory and initial state
- Optionally links created plan to an existing epic
- Agent MUST then write `plan.md` and `todo.md`
- Agent MUST STOP after writing files
