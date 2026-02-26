---
description: Returns plan context as JSON
agent: build
---

Returns machine-readable plan context.

Usage: `/context <plan-number-or-slug> [--include=plan,todo,review,evidence,state,epic]`

Behavior:
- Calls `bun run wf context <id> --json [--include=...]`
- Resolves `id` to `plans/<NN>-*` (supports `7`, `07`, and full slug)
- Returns resolved plan directory, phase, allowed next commands, and canonical file paths
- Returns requested file contents only for keys listed in `--include`
