---
title: Harden Session-Plan Canonical Status Recovery
created: 2026-07-09
---

# Harden Session-Plan Canonical Status Recovery

**Created:** 2026-07-09

## Problem / Motivation

### Executive Summary

Create an excursion-sized eforge-plan session-plan hardening pass that fixes count-based lifecycle aggregation, makes extension-managed session-plan status use one effective canonical source across eforge-plan handoff and kernel/MCP set-status paths, and adds a provenance-preserving resubmit flow for submitted plans whose correlated build/queue lifecycle failed or was removed.

The main changed surfaces are eforge-plan canonical/session-plan records and actions, session-plan projections, workstation plan badges, daemon/kernel session-plan status handling, and MCP/Pi/Claude-facing tool guidance where behavior is exposed.

The direction is to keep eforge-plan canonical SQLite status authoritative for extension-managed plans, mirror or reject kernel writes explicitly instead of silently diverging, and allow failed/removed submitted plans to return to handoff-eligible state without losing source item/epic provenance.

Out of scope: broad engine scheduling changes, new auto-drain behavior, unrelated Console retry/queue recovery UX, or deleting/recreating plans as recovery.

Confidence should come from focused projection tests, canonical status bridge integration coverage, resubmit-to-handoff regression coverage, UI label expectations, type-checking, and the normal workspace test/maintainability gates.

### Problem Statement

Three related eforge-plan session-plan behaviors make the workstation and handoff workflow less trustworthy:

- Multi-item session plans can show a yellow `Partial` lifecycle badge solely because they have more than one source item, even when every linked item has the same lifecycle state.
- eforge-plan canonical status and the daemon/kernel `/api/session-plan/set-status` path can disagree: a kernel/MCP ready write can report success while eforge-plan handoff still sees the canonical plan as `submitted` and blocks handoff.
- A session plan submitted to a build that later fails or is removed lacks a first-class resubmission path; the workaround is delete/recreate, which can destroy `source_item_ids`, `source_epic_ids`, recommendation provenance, and lifecycle continuity.

## Goal

The intended outcome is a coherent canonical session-plan lifecycle where badges reflect real source-item state, ready/submitted status has one effective source for extension-managed plans, and failed/removed submitted plans can be recovered and handed off again without provenance loss.

## Approach

### High-Level Technical Direction

- Keep eforge-plan canonical SQLite status authoritative for extension-managed plans.
- Mirror or reject kernel writes explicitly instead of silently diverging.
- Allow failed/removed submitted plans to return to handoff-eligible state without losing source item/epic provenance.
- Replace count-based lifecycle aggregation in `eforge/extensions/eforge-plan/projections/session-plans.ts` for both current and legacy/fallback projections.
- Keep `partial` only for genuinely mixed source-item states, missing/incomplete lifecycle evidence, or another explicitly named mixed/incomplete state if the existing wire/UI contract is intentionally clarified.
- Update the workstation plan badge/tooltip in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx` so `Partial` means mixed/incomplete lifecycle coverage rather than readiness failure.
- Make extension-managed session-plan status canonical-aware across eforge-plan actions and the daemon/kernel session-plan set-status route (`packages/monitor/src/routes/session-plan-service.ts`, with related workflow/tool output in `packages/input/src/session-planning-workflow.ts` as needed).
- Add a first-class eforge-plan resubmit action/UX for submitted plans whose correlated build/queue lifecycle is failed or removed, preserving session identity and source item/epic/recommendation provenance where appropriate.
- Keep Pi and Claude plugin/MCP-facing behavior in sync if new or changed user-facing commands/tools are exposed.
- Use shared client route constants/wire contracts if daemon/client API response shapes or routes change.

### Code Impact

Likely code impact areas:

- `eforge/extensions/eforge-plan/projections/session-plans.ts`: introduce a small lifecycle aggregation helper that deduplicates meaningful states and returns a concrete state when all resolved source items agree; update both main and fallback projection paths.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx`: adjust the visible chip label/tooltip/copy for `partial` so users understand it as mixed/incomplete lifecycle evidence.
- `eforge/extensions/eforge-plan/session-plan-actions.ts`: add or extend canonical status helpers for ready/handoff/resubmit, and ensure handoff consults the same effective status path used by status updates.
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`: preserve source refs and provenance fields during resubmission/status transitions; add audit-friendly fields/events if existing structures support them.
- `eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts`: integrate terminal removed cleanup with resubmit eligibility without clearing provenance needed for recovery.
- `packages/monitor/src/routes/session-plan-service.ts`: make kernel set-status canonical-aware for extension-managed plans or return a clear failure/warning response before claiming success.
- `packages/input/src/session-planning-workflow.ts` and MCP/Pi/Claude integration packages as needed: surface authoritative status-source guidance and any new resubmit affordance consistently.
- Tests under the existing vitest structure: add focused unit tests for aggregation and integration-style tests for canonical status bridge/resubmission workflows, using real code rather than mocks.

### Design Decisions

- Canonical eforge-plan status is the effective authority for extension-managed session plans. Kernel/Markdown status may be a compatibility mirror, but it must not silently override or diverge from canonical handoff eligibility.
- Prefer a single reusable status-transition helper for extension-managed plans over duplicating SQLite/status-write logic in daemon route handlers.
- If the kernel set-status route cannot safely update canonical eforge-plan state for an extension-managed plan, fail loudly with actionable guidance instead of returning success.
- Lifecycle aggregation should be state-aware, not item-count-aware: normalize source-item lifecycle states, ignore duplicate same-state evidence, return the unique state when exactly one meaningful state is present, and reserve `partial` for mixed or incomplete evidence.
- Resubmission should be a deliberate transition, not an implicit side effect of queue cleanup. It should check terminal failed/removed correlation, transition the plan back to handoff-eligible status, preserve provenance, and append/retain audit evidence of the prior submitted attempt.
- Handoff after resubmission should create a new build/queue lifecycle correlation rather than mutating the old failed/removed record into a successful-looking one.
- User-facing integrations should use shared client contracts and remain synchronized between `eforge-plugin/` and `packages/pi-eforge/` when commands/tools or output semantics change.
- Risks to guard against include duplicate builds from resubmitting active plans, provenance loss during cleanup, and renewed status-source drift from duplicated status logic.

### Assumptions

- Current source still has count-based `partial` aggregation in both the main and fallback session-plan projections.
- Existing canonical ready/handoff paths already synchronize some eforge-plan status, so the bridge work can extend current helpers rather than invent a parallel status model.
- Queue-removal cleanup and source item/epic preservation already exist in canonical code, but no first-class resubmit action/product surface exists yet.

### Validation Plan

1. Add projection tests for:
   - two source items both `planned` → lifecycle state `planned`;
   - two or more source items with mixed states → lifecycle state `partial`/mixed;
   - fallback/legacy projection path follows the same aggregation rules.
2. Add status bridge tests for:
   - eforge-plan set-ready followed by handoff sees ready;
   - kernel/MCP set-status on an extension-managed plan either updates canonical status or returns an actionable failure;
   - handoff and show/list projections report the same effective status source.
3. Add resubmission workflow coverage for:
   - submitted plan with failed/removed correlated build;
   - queue-removal/recovery cleanup;
   - resubmit transition preserving source item/epic/provenance fields;
   - handoff after resubmit creating a new queue/build correlation.
4. Add UI/serialization expectations for the lifecycle badge copy if component or projection tests already cover workstation output.
5. Run `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check`; run docs/reference checks only if API docs or generated reference artifacts change.

## Scope

### In Scope

- Replace count-based lifecycle aggregation in `eforge/extensions/eforge-plan/projections/session-plans.ts` for both current and legacy/fallback projections.
- Keep `partial` only for genuinely mixed source-item states, missing/incomplete lifecycle evidence, or another explicitly named mixed/incomplete state if the existing wire/UI contract is intentionally clarified.
- Update the workstation plan badge/tooltip in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx` so `Partial` means mixed/incomplete lifecycle coverage rather than readiness failure.
- Make extension-managed session-plan status canonical-aware across eforge-plan actions and the daemon/kernel session-plan set-status route (`packages/monitor/src/routes/session-plan-service.ts`, with related workflow/tool output in `packages/input/src/session-planning-workflow.ts` as needed).
- Add a first-class eforge-plan resubmit action/UX for submitted plans whose correlated build/queue lifecycle is failed or removed, preserving session identity and source item/epic/recommendation provenance where appropriate.
- Keep Pi and Claude plugin/MCP-facing behavior in sync if new or changed user-facing commands/tools are exposed.
- Use shared client route constants/wire contracts if daemon/client API response shapes or routes change.

### Out of Scope

- New scheduling, auto-drain, or wrapper-app orchestration behavior.
- Broad build-engine retry semantics unrelated to session-plan resubmission eligibility.
- Reworking the entire session-plan data model beyond the minimum canonical status/provenance bridge needed here.
- Treating delete/recreate as an acceptable recovery workflow.
- Broad engine scheduling changes, new auto-drain behavior, unrelated Console retry/queue recovery UX, or deleting/recreating plans as recovery.

## Acceptance Criteria

- A session plan linked to two or more source backlog items whose lifecycle states all resolve to the same state projects and displays that state, not `partial`.
- A session plan with mixed source-item lifecycle states, missing lifecycle evidence, or intentionally incomplete coverage still projects `partial` or an explicitly clearer equivalent, with UI text explaining mixed/incomplete coverage.
- Regression coverage includes a same-state two-item plan, plus existing or new mixed shipped/planned evidence coverage.
- For extension-managed plans, `set-session-plan-ready`, kernel/MCP `eforge_session_plan set-status`, and `handoff-session-plan` report the same effective status, or unsupported status writes fail loudly with an actionable status-source message.
- Tool output or documentation identifies the authoritative status source for extension-managed session plans.
- A submitted session plan correlated with a terminal failed or removed queue/build record can be resubmitted without deleting/recreating the plan.
- Resubmission preserves `source_item_ids`, `source_epic_ids`, session identity where appropriate, and recommendation/provenance links already stored in canonical records.
- Handoff after resubmission creates a new queue/build lifecycle record and no longer returns the stale submitted-status not-ready error.
- Regression coverage demonstrates failed build or removed queue cleanup → resubmit → handoff, including provenance preservation.
- `pnpm test`, `pnpm type-check`, and `pnpm maintainability:check` exit 0.