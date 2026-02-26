# /update-model

## Purpose

Updates the active agent model for the current session.

---

## Mandatory Execution

When this command is issued, the agent MUST execute:

```
bun run wf update-model <model>
```

---

## Rules

- MUST execute terminal command
- MUST NOT simulate state change
- MUST STOP on execution failure
