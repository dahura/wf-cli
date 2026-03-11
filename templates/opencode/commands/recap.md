---
description: Returns compact project recap
agent: build
---

Returns a compact project recap for a fresh agent/chat.

Usage: `/recap [--scope <name>] [--limit <n>]`

Behavior:
- Calls `bun run wf recap --json [--scope ... --limit ...]`
- Returns project brief + latest memory entries
- Uses scope-aware storage to avoid cross-project overwrites in monorepos
- Prefer `/recap --scope <product>` for `examples/*` products
