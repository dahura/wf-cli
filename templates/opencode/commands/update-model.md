---
description: Updates the active agent model for the current session
agent: build
---

Updates the active agent model for the current session.

When this command is issued, the agent MUST execute:

```
bun run wf update-model <model>
```

Rules:
- MUST execute terminal command
- MUST NOT simulate state change
- MUST STOP on execution failure
