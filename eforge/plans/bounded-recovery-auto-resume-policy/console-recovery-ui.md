---
id: console-recovery-ui
name: Console recovery display/controls
branch: bounded-recovery-auto-resume-policy/console-recovery-ui
---

# Console recovery display/controls

Update Console to render shared auto-build recovery fields, keep manual recovery controls visible, and label automated versus user-originated recovery actions.

## Traceability

Criteria: ac-005, ac-006
Aspects: ac-005:evidence:queue-run-auto-build, ac-006:general:general

## Validation

Author Console render/control tests for projected fields, visible manual controls, and action-source labeling.

## Fragment: Expose auto-build projection state

Add a shared client-owned auto-build projection shape/event fields for enabled/disabled policy, attempt count, last decision, and stop reason. Populate them from monitor auto-build supervisor/projection state, keeping REST/SSE/stream snapshots on the same shared projection path rather than ad-hoc object shaping.
## Fragment: Render auto-build projection state in Console

Update Console auto-build/run-detail hooks and existing UI components to consume the shared projection fields. Use the existing disabled-reason component for stop reasons and add tests for enabled, disabled, retry/attempt, last-decision, and stopped states.