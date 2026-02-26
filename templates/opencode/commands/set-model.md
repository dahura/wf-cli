---
description: Initializes the agent model for the current session
agent: build
---

Initializes the agent model for the current session.

When this command is issued, the agent MUST execute:

```
bun run wf set-model <model>
```

Rules:
- MUST execute terminal command
- MUST NOT simulate state change
- MUST STOP on execution failure
