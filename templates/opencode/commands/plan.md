---
description: Create a new plan from user intent
agent: build
---

Creates a new plan using the provided intent description.

- Usage: `/plan <description> [--epic <epic-id-or-slug>]`
- Runs: `bun run wf plan "<description>" [--epic <id>]`
- Sets up a plan directory and initial state
- Optionally links created plan to an existing epic
- Writes `plan.md` and `todo.md`
- Stops after writing these files
