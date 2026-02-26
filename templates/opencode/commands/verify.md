---
description: Runs workflow quality gates for a plan
agent: build
---

Runs workflow quality gates for a plan.

Usage: `/verify <plan-number-or-slug> [--target=all|review|done]`

Behavior:
- Calls `bun run wf verify <id> --target=<...> --json`
- `--target=all` validates both review and done gates (default)
- `--target=review` validates TODO + evidence gate used before `/finish-code`
- `--target=done` validates review verdict gate used before `/done`
- Exits with failure if any selected gate fails
