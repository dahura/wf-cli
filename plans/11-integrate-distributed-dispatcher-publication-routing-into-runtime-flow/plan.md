# Plan 11: Integrate distributed dispatcher publication/routing into runtime flow

## Goal
Wire distributed dispatch publication directly into epic/runtime transitions so role-specific workers receive jobs automatically when distributed mode is enabled.

## Scope
- Add dispatcher publication utility for current plan phase commands.
- Publish queue jobs during epic orchestration and plan phase transitions.
- Keep publication feature-flagged behind `WF_DISTRIBUTED=1`.
- Add tests for enabled/disabled publication behavior.

## Out of scope
- Distributed scheduling fairness and prioritization policies.
- External queue backends beyond current file queue.

## Acceptance criteria
- Transitioning plans publishes deterministic deduped jobs in distributed mode.
- No jobs are published when distributed mode is disabled.
- Dispatcher behavior is covered by automated tests.
