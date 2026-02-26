---
description: Analyze project and create a reusable project skill
agent: build
---

Creates a project-context skill and deploys it to both agent environments.

Usage: `/generate-skill <skill-name> [focus-area]`

Behavior:
- Analyze the current project before writing anything:
  - Read `package.json`, `README.md`, and key source folders
  - Identify stack, architecture patterns, critical workflows, and common pitfalls
- Create skill files under `.wf/skills/<skill-name>/`:
  - Required: `SKILL.md` with YAML frontmatter (`name`, `description`)
  - Optional: `references/*.md` for deep dives
- `SKILL.md` MUST include these sections:
  - Outcome
  - Workflow
  - Non-Negotiable Rules
  - Best-Practice Baseline
  - Output Contract
- Keep instruction text in English and make guidance project-specific, actionable, and concise.
- Deploy copies (no symlinks) by running: `bun run wf skill sync`
- Report created/updated files and what project assumptions were encoded.
