# /epic

Creates and manages higher-level epics that group multiple plans. The `/epic run` command launches full end-to-end orchestration — you (the chat) drive the loop directly.

## Usage
- `/epic "<name>"`
- `/epic context <epic-id-or-slug> --json`
- `/epic attach <epic-id-or-slug> <plan-id-or-slug>`
- `/epic list --json`
- `/epic run <epic-id-or-slug> [--json]`
- `/epic status <epic-id-or-slug> [--json]`
- `/epic resume <epic-id-or-slug> [--json]`
- `/epic stop <epic-id-or-slug> [--json]`

---

## `/epic run <id>` — Full autonomous orchestration

**You are the orchestrator.** Never delegate orchestration to an `@orchestrator` role.

### Step 0 — Bootstrap

1. Run: `bun run wf epic run <id> --json`
2. Read returned `plans[]` with `id`, `dir`, and `phase`
3. Run: `bun run wf config show --json`
4. If `distributed: true`, run: `bun run wf workers start`

### Step 1 — Planning fan-out

- For plans in `planning` with empty `plan.md`/`todo.md`, invoke `@epic-planner`.
- If plans are independent, launch multiple `@epic-planner` subagents in parallel.
- Wait until each planner finishes, then transition plan with `/code <plan-id>`.

### Step 2 — Execution loop per plan

For each plan, run this loop until the plan becomes `completed`:

1. **Coding path**
   - If phase is `coding`, invoke `@plan-coder`.
   - Coder must call `/finish-code <plan-id>` when TODOs are implemented.

2. **Review path**
   - If phase is `awaiting_review`, run `/review <plan-id>`, then invoke `@plan-reviewer`.
   - Reviewer must call `/done <plan-id>` when clean.
   - If reviewer reports issues in epic orchestration mode, continue automatically to fix loop (do not ask user to run `/fix`).

3. **Fix loop**
   - If phase is `reviewing`, run `/fix <plan-id>`, invoke `@plan-fixer`, then require `/finish-code <plan-id>`.
   - Return to review path and repeat until reviewer calls `/done`.

4. **Blocked handling**
   - If plan enters `blocked`, stop orchestration and report immediately.

### Step 3 — Parallel execution rule

- Default: process plans sequentially.
- Allowed parallelization:
  - Planner fan-out for clearly independent plans.
  - Coder/reviewer/fixer fan-out only for independent plans with no shared file ownership risk.
- If independence is uncertain, run sequentially.

### Step 4 — Completion

1. Run: `bun run wf epic status <id> --json`
2. Confirm all linked plans are `completed`
3. Report completion summary

---

## `/epic resume <id>`

1. Run: `bun run wf epic resume <id> --json`
2. Re-enter the same loop and skip already completed plans

## `/epic status <id>`

- Run: `bun run wf epic status <id> --json`
- Display epic phase, orchestration status, and plan phases

## `/epic stop <id>`

- Run: `bun run wf epic stop <id>`
- Confirm orchestration is paused

## `/epic list`

- Run: `bun run wf epic list --json`

## `/epic attach <epic-id> <plan-id>`

- Run: `bun run wf epic attach <epic-id> <plan-id>`

---

## Rules

- Lifecycle transitions must use workflow commands: `/code`, `/finish-code`, `/review`, `/fix`, `/done`.
- `bun run wf ... --json` is for bootstrap/status/context reads.
- Do not edit implementation code directly while orchestrating; invoke specialized subagents instead.
