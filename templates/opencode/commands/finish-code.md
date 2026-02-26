---
description: Marks coding as complete
agent: build
---

Marks coding as complete.

Usage: `/finish-code <plan-number-or-slug>`

Behavior:
- Calls `bun run wf finish-code <id>`
- Sets phase to awaiting_review
- Agent MUST STOP
