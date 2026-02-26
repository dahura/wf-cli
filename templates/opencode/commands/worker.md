---
description: Start the autonomous worker loop for coding and fixing jobs
agent: build
---

Starts the autonomous worker loop for this project. Handles both `code` and `fix` jobs from the distributed queue — one OpenCode session is sufficient for both roles.

## What this does

Enters a continuous polling loop:

1. Attempts to claim a `plan-coder` job from the queue
2. If none found, attempts to claim a `plan-fixer` job
3. If a job is claimed — reads the plan context, implements or fixes TODOs, calls `/finish-code`
4. If no jobs found in either role — waits 10 seconds and repeats

Runs until you stop it (Ctrl-C or close session).

## Required procedure

1. Run `bun run wf who-are-you` to confirm session and project.
2. Run `bun run wf config show --json` to confirm `distributed: true`.
3. Enter the loop:

```
Loop:
  a. bun run wf worker plan-coder --runtime opencode --max-jobs 1
     → If output contains "processed 0 jobs" → go to step b
     → If job processed → the plan is now in coding phase
       - bun run wf epic list --json → find plans in "coding" phase
       - bun run wf context <plan-id> --json --include=plan,todo,state
       - Implement all pending TODOs
       - For each completed TODO: bun run wf todo implemented <plan-id> <TID> --test "<cmd>" --output "<result>"
       - bun run wf finish-code <plan-id>
       - Continue loop

  b. bun run wf worker plan-fixer --runtime opencode --max-jobs 1
     → If output contains "processed 0 jobs" → sleep 10s → go to step a
     → If job processed → the plan is now in fixing phase
       - bun run wf epic list --json → find plans in "fixing" phase
       - bun run wf context <plan-id> --json --include=plan,todo,review,evidence,state
       - bun run wf todo list <plan-id> --json → find rejected TODOs
       - Fix only rejected TODOs
       - For each fixed TODO: bun run wf todo implemented <plan-id> <TID> --test "<cmd>" --output "<result>"
       - bun run wf finish-code <plan-id>
       - Continue loop
```

## Rules

- Never skip a TODO without implementing it.
- Do not call `/review`, `/done`, or `/fix` — those are the orchestrator's responsibility.
- Stop immediately if `finish-code` fails — report the error rather than looping.
- Do not modify files outside the current plan's scope.
