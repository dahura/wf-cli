# 🌊 wf-cli

> **Workflow CLI for AI-agent orchestration**  
> A strict, state-driven workflow manager that synchronizes human developers and AI agents (like Cursor) through epics, plans, and quality gates.

---

## 🚀 Getting Started

### Requirements
- [Bun](https://bun.sh/) 1.0+

### Installation

Add `wf-cli` to your project:
```bash
bun add -d wf-cli
```

Or run without installation:
```bash
bunx wf-cli --help
```

Add the shortcut to your `package.json`:
```json
{
  "scripts": {
    "wf": "wf",
    "wf:init": "wf init",
    "wf:sync": "wf sync"
  }
}
```

Initialize the workspace (seeds templates and rules):
```bash
bun run wf:init
```

---

## 🤖 AI Agent Workflow (The Lifecycle)

`wf-cli` enforces a strict lifecycle for tasks. AI agents should use these commands to progress through a task:

1. **Create a Plan:**  
   `bun run wf plan "Add user authentication"`
2. **Start Coding:**  
   `bun run wf code <id>`
3. **Verify Quality Gates:**  
   `bun run wf verify <id> --target=all`  
   *(Requires `evidence.md` to be filled and TODOs checked with `[T1]` IDs)*
4. **Finish Coding:**  
   `bun run wf finish-code <id>`
5. **Review Implementation:**  
   `bun run wf review <id>`  
   *(Requires `review.md` to have `pass` verdicts for all TODOs)*
6. **Complete:**  
   `bun run wf done <id>`

---

## 📚 Epics (High-Level Orchestration)

For larger features, group plans into Epics:

- **Create:** `bun run wf epic "Refactor Auth System"`
- **List:** `bun run wf epic list --json`
- **Attach Plan:** `bun run wf epic attach <epic-id> <plan-id>`
- **Run Orchestrator:** `bun run wf epic run <id>`
- **Status:** `bun run wf epic status <id>`

---

## 🛠️ Asset & Subagent Management

`wf-cli` manages templates, skills, and subagent models across `.cursor` and `.opencode` environments.

### Assets
- `bun run wf init` - Seeds `.wf/templates` from bundled package templates and syncs assets into agent directories.
- `bun run wf sync` - Syncs `.wf/templates` to agent directories.
- `bun run wf skill sync` - Copies skills from `.wf/skills` to agent environments.

### Subagents & Models
- `bun run wf subagents init-models` - Initialize default model config.
- `bun run wf subagents validate-models` - Validate your `.wf/subagents.models.json`.
- `bun run wf subagents list-models` - Show available models.

---

## 🔒 Quality Gates Explained

To ensure AI agents don't skip steps, `wf-cli` enforces strict checks:
- **TODO IDs:** Checklist items must use explicit IDs (e.g., `- [x] [T1] Implement login`).
- **Evidence:** `evidence.md` must contain matching sections (`## [T1]`) with `- status: pass`.
- **Verdicts:** `review.md` must explicitly pass each ID (`- [T1]: pass`).

If any of these fail, `wf finish-code` and `wf done` will reject the transition.

---

## 📦 Runtime commands overview

```bash
wf who-are-you
wf models
wf set-model <model>
wf update-model <model>

wf epic "<description>"
wf epic context <id> --json
wf epic attach <epic-id> <plan-id>
wf epic list --json
wf epic run <id> [--json]
wf epic status <id> [--json]
wf epic resume <id> [--json]
wf epic stop <id> [--json]

wf plan "<description>"
wf plan "<description>" --epic <epic-id>
wf code <id>
wf context <id> --json --include=plan,todo,review,evidence,state,epic
wf verify <id> --target=all --json
wf finish-code <id>
wf review <id>
wf fix <id>
wf done <id>

wf subagents init-models
wf subagents init-model-catalog
wf subagents validate-models [--json]
wf subagents show-models [--json]
wf subagents list-models [--json]
wf subagents apply-models [--json]
```
