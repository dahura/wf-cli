---
description: Manage subagent model configuration
agent: build
---

Manages subagent model configuration and applies generated agent files.

Usage:
- `/subagents init-models`
- `/subagents init-model-catalog`
- `/subagents validate-models [--json]`
- `/subagents show-models [--json]`
- `/subagents list-models [--json]`
- `/subagents apply-models [--json]`

Behavior:
- Calls `bun run wf subagents ...`
- Reads/writes `.wf/subagents.models.json`
- Reads/writes `.wf/models.catalog.json`
- Generates:
  - `.cursor/agents/*.md`
  - `.opencode/agents/*.md`
