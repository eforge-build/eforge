---
id: visibility-provenance
name: Queue/run and Console visibility
branch: bounded-recovery-auto-resume-policy/visibility-provenance
---

# Queue/run and Console visibility

Thread one canonical auto-build/auto-resume state through monitor projections, supervisor/client public types, and Console hooks/components. Include enabled/disabled state, attempts, last decision, and stop reason; keep manual controls visible and label automatic decisions separately from user-confirmed actions.

## Traceability

Criteria: ac-005, ac-006
Aspects: ac-005:evidence:queue-run-auto-build, ac-006:general:general

## Validation

Monitor, client, and Console tests cover enabled, disabled/stopped, attempts, last decision, stop reason, visible manual controls, and visual/text distinction between automatic and manual actions.

## Fragment: Queue/run auto-build projection state

Scope AC-005 to the auto-build projection path only. Implement a single canonical state shape that queue/run/auto-build consumers can read with: enabled/disabled policy, attempt count, last decision, and stop reason.

Implementation outline:
- Treat `packages/monitor/src/auto-build-supervisor.ts` and `packages/monitor/src/projections/auto-build-state.ts` as the monitor-side owners for deriving attempts, decisions, and stop reasons.
- If the state crosses package boundaries, add/extend the public shape in `@eforge-build/client` per the accepted event/schema ownership finding; avoid local duplicate wire interfaces.
- Thread the state into Console via `packages/console-ui/src/hooks/use-auto-build.ts`, run-detail state where applicable, and presentation components such as `auto-build-toggle.tsx` / `QueueActionDisabledReason`.
- Keep route/config/docs work out of this atom unless required by the shared interface atom.

Validation focus: projection tests should cover enabled policy, disabled/stopped policy, incremented attempts, preserved last decision, and user-visible stop reason.
## Fragment: Console manual controls and provenance

Plan console recovery UX updates after the event/client shapes are available: keep manual recovery controls visible whenever the backend exposes manual recovery actions, even when auto-resume decisions are present. Label automatic decisions such as attempted/skipped/exhausted separately from user-confirmed actions. Avoid local wire-shape copies; consume typed client/event projections. Add UI or component tests proving both visibility and provenance labels.