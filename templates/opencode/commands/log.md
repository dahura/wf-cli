---
description: Appends implementation memory entry
agent: build
---

Appends an implementation memory entry for the current project scope.

Usage: `/log <summary> [--scope <name>] [--phase <name>] [--about "..."] [--implemented "a;b"] [--next "a;b"]`

Behavior:
- Calls `bun run wf log "<summary>" --json [--scope ... --phase ... --about ... --implemented ... --next ...]`
- Writes chronological memory entries to `.wf/project-memory.*` (or `.wf/scopes/<scope>/project-memory.*`)
- Captures what changed now and what should happen next
- Keeps context lightweight for future chats and agent handoffs
