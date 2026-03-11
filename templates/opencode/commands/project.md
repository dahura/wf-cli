---
description: Creates or updates project brief context
agent: build
---

Creates or updates a project brief for fast fresh-chat context.

Usage: `/project <summary> [--scope <name>] [--product "..."] [--users "..."] [--stack "..."] [--constraints "a;b"] [--success "a;b"]`

Behavior:
- Calls `bun run wf project "<summary>" --json [--scope ... --product ... --users ... --stack ... --constraints ... --success ...]`
- Writes project-level brief artifacts under `.wf/` (or scoped under `.wf/scopes/<scope>/`)
- Persists stable project metadata (what this product is, for whom, key constraints, success criteria)
- Should be used before `/log` when starting a new product scope
