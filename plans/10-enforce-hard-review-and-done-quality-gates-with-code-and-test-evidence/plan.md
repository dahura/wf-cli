# Plan 10: Enforce hard review/done quality gates with code and test evidence

## Goal
Harden quality gates so checked TODO items require complete, auditable evidence before phase transitions.

## Scope
- Extend quality validation to require evidence `command` and `output` fields.
- Keep strict pass-only semantics for review/done transitions.
- Update and extend quality/verify tests to cover hardened behavior.

## Out of scope
- New evidence storage formats.
- Introducing non-markdown review workflows.

## Acceptance criteria
- `finish-code` fails when checked TODO IDs lack command or output evidence.
- Existing done-gate review verdict requirements remain enforced.
- Automated tests cover positive and negative gate cases.
