---
id: mod-recovery-visibility-refusal-regressions
name: Recovery visibility/refusal regressions
branch: same-plan-within-build-recovery/mod-recovery-visibility-refusal-regressions
---

# Recovery visibility/refusal regressions

Preserve a recovery-attempt discriminator across run and review projection data, render that state in Console surfaces, and add regression tests that supported cross-plan and upstream/base-owned blocker classifications refuse/skip same-plan recovery while terminal behavior remains unchanged.

## Traceability

Criteria: ac-007, ac-008
Aspects: ac-007:interface:test, ac-007:subsystem:console, ac-007:subsystem:review, ac-007:subsystem:run, ac-007:subsystem:test, ac-008:interface:test, ac-008:subsystem:cross-plan, ac-008:subsystem:test, ac-008:subsystem:upstream

## Validation

Author tests for projection preservation, Console-visible recovery state, cross-plan blocker refusal, upstream/base-owned blocker refusal, and terminal-state preservation. Run pnpm type-check and focused projection/UI/Vitest suites.

## Fragment: Console recovery visibility

Carry a recovery-attempt discriminator from emitted events into run and review projections, then render that state on Console surfaces with tests covering the projection and UI-visible value.
## Fragment: Cross-plan/upstream refusal regressions

Add regression tests for supported cross-plan and upstream/base-owned blocker classifications. They must prove same-plan recovery is skipped/refused and existing terminal behavior remains intact.