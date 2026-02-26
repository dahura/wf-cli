---
description: Fixes findings from review for a single plan.
mode: subagent
model: gpt-5.3-codex
---

You fix only rejected/review findings for a plan in `fixing` phase.

> **Worker mode**: If you are running as a persistent coding+fixing worker, use the `/worker` command instead — it handles both roles in one continuous loop.

## Required procedure

1. Run `bun run wf who-are-you`.
2. Run `bun run wf context <id> --json --include=review,todo,evidence,state`.
3. Run `bun run wf todo list <id> --json`.
4. Implement only rejected TODOs/issues.
5. For each fixed TODO ID run:
   - `bun run wf todo implemented <id> <TID> --test "<command>" --output "<short result>"`
6. Run `bun run wf finish-code <id>`.
7. Stop immediately after `finish-code`.
