---
title: Eforge-Plan Workstation UX Polish
created: 2026-06-26
---

# Eforge-Plan Workstation UX Polish

## Problem / Motivation

The eforge-plan workstation has several UX gaps that make planning work feel unstable or stale:

- The plan annotation dialog can vanish while a user types a long description, losing confidence in draft input and hiding validation feedback.
- After confirming Handoff, a ready plan remains visible and actionable in the Plans UI until background enqueue/handoff completes, making success or pending state ambiguous.
- Plans list/detail views do not show recency timestamps, so users cannot quickly judge freshness before review, revision, or handoff.
- The Roadmap tab opens editable Markdown by default, even though the local focus roadmap is primarily reading/steering context and should require an explicit edit action.

Together these issues undermine the local-focus direction that extension workstations should be clean, stable, reliable, and workflow-first.

## Goal

Deliver a focused eforge-plan workstation UX pass across the plan annotation dialog, Plans list/detail handoff behavior, Plans recency metadata, and Roadmap read/edit experience. Keep user input stable, make lifecycle state obvious immediately, expose timestamps through shared projection rather than frontend parsing, and default roadmap content to rendered Markdown with explicit edit mode.

## Approach

### Implementation direction

- Treat this as a focused UX feature session with embedded bug fixes, not as an engine or daemon workflow redesign.
- Keep annotation dialogs controlled by explicit open/close actions only.
- Prevent validation, character counts, and save errors from implicitly closing the annotation modal.
- Create an immediate local UI transition after Handoff confirmation so the plan does not remain in the active ready lane while background handoff/enqueue runs.
- Keep handoff progress observable through activity/status UI.
- Make handoff failures recoverable through rollback or retry guidance.
- Source timestamp data from a single projection/API layer so list and detail views render the same lifecycle metadata without ad hoc frontend parsing.
- Pair relative human-readable recency with exact absolute date/time access.
- Make Roadmap read-first: rendered Markdown is the default, edit mode is explicit, and read-only sources never expose editing controls.
- Reuse existing markdown rendering, status badge, activity, and date-formatting conventions where available before introducing new UI primitives.

### Expected code impact

- Update the annotation dialog/popover component state so textarea changes and validation state do not trigger modal dismissal or unmounting.
- Check whether parent re-renders, key changes, validation errors, focus/blur handlers, or popover open-state coupling cause the disappearing-dialog bug.
- Add local optimistic handoff state keyed by plan id in the Plans workstation UI.
- Update Plans list filtering and detail selection behavior for handoff-pending plans.
- Route handoff progress and failure into existing activity/status surfaces.
- Add or normalize lifecycle timestamp fields in the plan artifact projection/API layer.
- Keep daemon wire shapes and route constants owned by `@eforge-build/client`.
- Do not duplicate interfaces or inline `/api/...` paths in UI/monitor code.
- Add a small shared UI helper for relative/absolute timestamp display if one does not already exist.
- Gracefully handle `null`, `undefined`, and invalid dates.
- Split Roadmap read-mode and edit-mode state.
- Render Markdown by default in the Roadmap workstation UI.
- Hide edit controls for read-only roadmap sources.
- Preserve source metadata and stale/recommendation status display outside the editor.
- Add or update UI/component tests for the four user-visible flows.
- Add or update unit/projection tests for timestamp data.
- Prefer focused tests around behavior rather than implementation detail.
- Keep edits bounded.
- Avoid growing large legacy files unnecessarily.
- Use existing semantic region markers if touching larger files.

### Assumptions

- The four selected backlog items are related enough to implement in one excursion-sized session because they share the eforge-plan workstation UX surface.
- Existing backend validation and handoff/enqueue semantics remain authoritative.
- UI changes improve presentation, optimism, and reconciliation rather than bypassing backend validation.
- Local focus roadmap storage is editable.
- Shared/discovered roadmap sources are read-only context.
- Missing timestamp fields may exist in artifacts but not projection.
- If source timestamp data is genuinely unavailable, render placeholders and document the limitation in tests.

## Scope

### In scope

- Keep the annotation dialog mounted while users type long description text.
- Preserve draft textarea content when validation limits are reached.
- Show inline validation and character-limit feedback.
- Disable Save as needed for invalid annotation content.
- Preserve backend annotation validation.
- Display annotation save failures without clearing the draft.
- Immediately remove a confirmed handoff plan from the active/actionable Plans list, or move it to an explicitly non-actionable handoff-pending state.
- Clear selected ready-plan detail or replace it with handoff progress feedback.
- Keep background handoff/enqueue status visible through activity/status UI.
- Restore the plan or show retry guidance if enqueue/handoff fails.
- Reconcile local optimistic state with eventual backend submitted/handed-off state.
- Expose required lifecycle timestamp fields through the plan artifact/projection layer.
- Render human-readable recency in plan rows.
- Expose exact date/time access in title, tooltip, or detail text.
- Show available lifecycle timestamps in plan detail, including created, updated, ready, submitted/handed off, and last build activity.
- Gracefully render missing timestamps.
- Render local focus roadmap Markdown in read mode by default.
- Require explicit Edit before showing textarea/editor and Save/Cancel/Reset controls.
- Preserve read-only roadmap behavior by rendering Markdown without edit controls.
- Display source metadata and stale/recommendation status in read mode without implying active editing.

### Out of scope

- Build-engine scheduling changes.
- Auto-drain changes.
- Queue orchestration changes.
- Daemon workflow expansion beyond the minimal API/projection data required by the UI.
- Broad markdown editor rewrite.
- Unrelated Roadmap authoring features.
- Changes to backlog item semantics beyond satisfying these four selected items.
- Ad hoc daemon route literals.
- Duplicated daemon wire shapes.

## Acceptance Criteria

- Typing long annotation description text does not close the annotation dialog.
- Typing long annotation description text does not unmount the annotation dialog.
- Annotation draft text remains visible at configured validation limits.
- Annotation draft text remains editable beyond configured validation limits.
- Annotation description validation feedback appears inline.
- Annotation validation includes character-limit feedback when configured limits are reached.
- The Save action is disabled while annotation description content violates configured validation limits.
- Backend annotation validation remains enforced on save.
- Backend annotation save failures are displayed in the dialog.
- Backend annotation save failures do not clear the draft text.
- After Handoff confirmation, the plan no longer appears as an actionable ready plan in the active Plans list.
- After confirmed Handoff, selected plan detail does not show stale ready-plan controls.
- After confirmed Handoff, selected plan detail clears, switches to progress feedback, or otherwise reflects non-actionable handoff state.
- Handoff/enqueue progress remains visible through activity/status UI while the background task runs.
- Handoff/enqueue failures remain visible through activity/status UI.
- Handoff/enqueue failure restores the plan or presents a recoverable error with retry guidance.
- After successful handoff/submission reconciliation, the plan artifact state reflects the backend submitted/handed-off state.
- Plans list rows display a human-readable recency timestamp.
- Plan recency UI exposes exact date/time through a tooltip, title, or detail field.
- Plan detail renders the created timestamp when available.
- Plan detail renders the updated timestamp when available.
- Plan detail renders the ready timestamp when available.
- Plan detail renders the submitted or handed-off timestamp when available.
- Plan detail renders the last build activity timestamp when available.
- Missing timestamp values render placeholder text instead of raw `null`, `undefined`, or invalid values.
- Missing timestamp values do not break workstation rendering.
- Timestamp values are supplied by projection/API code.
- Frontend plan list/detail code does not duplicate artifact file parsing to derive timestamp values.
- The Roadmap tab renders Markdown read mode by default for editable local focus roadmap content.
- Roadmap read mode renders headings.
- Roadmap read mode renders lists.
- Roadmap read mode renders inline code.
- Roadmap read mode renders links.
- Editable roadmap edit controls appear only after an explicit Edit action.
- Roadmap edit mode provides Save behavior.
- Roadmap edit mode provides Cancel/Reset behavior.
- Roadmap edit mode does not silently discard unsaved changes when exiting.
- Read-only roadmap sources render as Markdown.
- Read-only roadmap sources do not expose edit controls.
- Roadmap read mode displays source metadata.
- Roadmap read mode displays stale/recommendation status without implying active editing.
- A focused UI/component test covers long annotation input without dialog unmounting.
- A focused UI/component test covers annotation validation-limit behavior with draft preservation.
- A focused UI/component test covers optimistic handoff success.
- A focused UI/component test covers optimistic handoff failure rollback or retry guidance.
- A focused UI/component test covers backend reconciliation after handoff.
- A projection/unit test covers present lifecycle timestamp values.
- A projection/unit test covers missing lifecycle timestamp values.
- A UI/component test covers plan list/detail timestamp rendering for human-readable recency.
- A UI/component test covers exact date/time access in timestamp UI.
- A UI/component test covers timestamp placeholder rendering.
- A UI/component test covers roadmap default Markdown read mode.
- A UI/component test covers roadmap edit mode save behavior.
- A UI/component test covers roadmap edit mode cancel/reset behavior.
- A UI/component test covers read-only roadmap behavior.
- Targeted Vitest suite(s) for changed UI/projection code exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0 when implementation edits large or marked files.

## Manual Verification Notes

- Exercise long annotation typing past likely character limits.
- Confirm the annotation dialog remains open while typing long text.
- Confirm annotation text remains editable after validation appears.
- Confirm Save is disabled or errors safely for invalid annotation content.
- Confirm Cancel/close still works intentionally.
- Confirm a ready plan disappears from the active/actionable list immediately after handoff confirmation.
- Confirm selected detail no longer shows stale ready controls after handoff confirmation.
- Simulate or cover successful handoff completion reconciliation.
- Simulate or cover handoff failure rollback or retry guidance.
- Test projection output for present lifecycle timestamp values.
- Test projection output for missing lifecycle timestamp values.
- Test list/detail rendering for human-readable recency.
- Test list/detail rendering for exact date/time access.
- Test list/detail rendering for timestamp placeholders.
- Test default rendered Markdown mode for editable local focus roadmap.
- Test entering Roadmap edit mode.
- Test saving Roadmap edits.
- Test Roadmap cancel/reset behavior.
- Test exiting Roadmap edit mode.
- Test read-only roadmap sources rendering Markdown without edit controls.
- Run the targeted Vitest suite(s) for changed UI/projection code.
- Run `pnpm type-check`.
- If practical for the touched packages, run `pnpm build`.
- Run `pnpm maintainability:check` before handoff if implementation edits large or marked files.