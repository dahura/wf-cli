# /generate-skill

Analyzes the project and creates a reusable project-context skill.

## Usage
/generate-skill <skill-name> [focus-area]

## Behavior
- Analyze project context before writing:
  - Read `package.json`, `README.md`, and key source folders
  - Identify stack, architecture patterns, critical workflows, and common pitfalls
- Create skill files under `.wf/skills/<skill-name>/`:
  - Required: `SKILL.md` with YAML frontmatter (`name`, `description`)
  - Optional: `references/*.md` for deeper guidance
- `SKILL.md` MUST include:
  - Outcome
  - Workflow
  - Non-Negotiable Rules
  - Best-Practice Baseline
  - Output Contract
- Instruction text MUST be in English and specific to this repository.
- Deploy copies (no symlinks) by running: `bun run wf skill sync`
- Report all created/updated files and the assumptions encoded into the skill.
