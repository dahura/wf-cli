# /who-are-you

## Purpose

Reports the current agent/session state.

This command is informational and used as a mandatory preflight check.

---

## Mandatory Execution

When this command is issued, the agent MUST execute:

```
bun run wf who-are-you
```

---

## Behavior

- Read session state via terminal execution
- Output model and capabilities as plain text

---

## Rules

- MUST NOT infer identity
- MUST NOT simulate output
- MUST NOT proceed without execution
