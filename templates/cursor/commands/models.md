# /models

## Purpose

List available (enabled) AI models and show the **only valid next action**
to select one (`/set-model` or `/update-model`) as a clickable action list.

This command is **read-only** and never mutates state.

---

## Mandatory Execution

When this command is issued, the agent MUST execute:

```
bun run wf models
```

---

## Rules

- MUST execute terminal command
- MUST NOT simulate output
- MUST NOT read any repo files directly for this command
- MUST NOT modify any state
- MUST NOT infer intent
- MUST NOT choose a model
- MUST STOP on execution failure

---

## Output Contract

- Output comes from `bun run wf models`
- Plain text
- Copy‑paste friendly
- One action per model
- No numbering
- No auto‑selection

---

## Example Output

Current model: gpt-5.2

Available models:

claude-4.5-opus  
Capabilities: planning, reviewing, completing  
Action: /update-model claude-4.5-opus

claude-4.5-sonnet  
Capabilities: planning, reviewing, fixing, completing  
Action: /update-model claude-4.5-sonnet

gpt-5.2  
Capabilities: planning, coding, reviewing, fixing, completing  
Action: /update-model gpt-5.2
