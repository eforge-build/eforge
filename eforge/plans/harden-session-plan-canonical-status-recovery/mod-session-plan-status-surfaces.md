---
id: mod-session-plan-status-surfaces
name: Session-plan status/projection surfaces
branch: harden-session-plan-canonical-status-recovery/mod-session-plan-status-surfaces
---

# Session-plan status/projection surfaces

Implement canonical session-plan lifecycle projection and consumer surfaces: homogeneous evidence projects to its shared state; mixed, missing, incomplete, or planned/shipped-mixed evidence projects to partial with reason metadata rendered by workstation/consumer UI. Normalize extension, MCP, and kernel effective status handling so extension-managed plans use canonical eforge-plan SQLite session-plan status records as the effective authority; projections, monitor events, event-tail output, and status fields must render or diagnose that source rather than becoming a second authority. Keep Claude plugin and Pi extension aligned where feasible.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:general:general, ac-002:interface:ui, ac-002:interface:ui-surface, ac-002:subsystem:incomplete, ac-002:subsystem:mixed, ac-002:subsystem:ui, ac-003:subsystem:planned, ac-003:subsystem:shipped, ac-004:interface:extension, ac-004:interface:extension-surface, ac-004:subsystem:extension, ac-004:subsystem:kernel, ac-004:subsystem:mcp, ac-005:interface:extension, ac-005:interface:extension-surface, ac-005:subsystem:extension

## Validation

Author tests for projection cases, UI partial reason display, and extension/MCP/kernel status parity, errors, and disclosure.

## Fragment: Expose authoritative status source in extension surfaces

Scope AC-005 to extension-owned session-plan surfaces. First inspect the localized candidates (`eforge/extensions/eforge-plan/session-plan-view-model.ts`, `session-plan-actions.ts`, `session-plan-schemas.ts`, `packages/pi-eforge/extensions/eforge/index.ts`) and choose the smallest user-facing place that already reports session-plan status or handoff/profile details. Add a concise disclosure such as: status source = canonical eforge-plan SQLite session-plan status records in the eforge-plan extension store; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics. If a structured field is added, keep it backward-compatible and update extension-owned schemas/view models plus Pi/Claude-facing docs in sync. Do not make the Pi event tail, projections, or monitor DB query appear authoritative.

## Fragment: Canonical-aware kernel/MCP set-status bridge

Implement the AC-004 status bridge for extension-managed session plans. Work through the shared eforge-plan status-transition helper in `eforge/extensions/eforge-plan/session-plan-actions.ts` and `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`, then update `packages/monitor/src/routes/session-plan-service.ts` and `packages/input/src/session-planning-workflow.ts` as needed. For extension-managed plans, kernel/MCP `eforge_session_plan set-status` must either update the same canonical status seen by `set-session-plan-ready`, `handoff-session-plan`, show/list projections, and tool output, or fail loudly with an actionable status-source message before claiming success. Use shared client route constants/wire contracts if any daemon/client response shapes change, and keep Pi/Claude-facing output synchronized when behavior is exposed there.

## Fragment: Uniform source-state lifecycle projection

Implement the lifecycle aggregation/display rule from AC-001 at the canonical projection boundary: when a session plan is linked to two or more source backlog items and every linked item resolves to the same lifecycle state, the projected/session-plan display status should be that shared state rather than `partial`. Preserve the existing `partial` result for genuinely mixed states. Update both the primary/current and legacy/fallback session-plan projection paths, using the provided evidence paths as localization targets for projection logic and tests, especially lifecycle/session-plan projections and existing lifecycle regression fixtures.

## Fragment: Lifecycle projection policy for partial-equivalent states

Work in the eforge-plan projection/policy layer localized by source evidence: `eforge/extensions/eforge-plan/planning-state-policy.ts`, `eforge/extensions/eforge-plan/projections/coverage.ts`, `eforge/extensions/eforge-plan/projections/index.ts`, `eforge/extensions/eforge-plan/projections/lifecycle.ts`, and `eforge/extensions/eforge-plan/projections/types.ts`. Ensure mixed item lifecycle states, missing lifecycle evidence, and intentionally incomplete coverage resolve to `partial` or an explicitly clearer non-terminal equivalent. Carry stable reason metadata so UI consumers can explain why the plan is partial. Add/adjust regression coverage in the localized lifecycle/projection test area.

## Fragment: UI explanation for mixed or incomplete session plans

Use the projection reason metadata in the localized UI surfaces: `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx`, `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx`, `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx`, `packages/console-ui/src/components/header/control-surface-links.tsx`, and `packages/console-ui/src/views/runs/run-plans-preview.tsx`. Prefer specific user text for mixed source states, missing lifecycle evidence, and incomplete coverage; avoid duplicating lifecycle classification logic in UI components. Add component/asset tests that assert the explanatory text appears with the partial-equivalent state.

## Fragment: Planned/shipped lifecycle regression scope

Plan AC-003 as one coupled lifecycle-regression slice. Inspect the localized eforge-plan lifecycle/projection paths first, then add focused Vitest coverage for: (1) a session plan with two items that recover to the same lifecycle state, and (2) mixed shipped/planned evidence that preserves both signals and the expected aggregate under existing lifecycle policy. Make minimal implementation changes only where the new/updated tests expose status recovery drift.