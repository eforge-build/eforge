---
id: plan-02-workstation-ux-polish
name: Workstation UX Polish
branch: eforge-plan-workstation-ux-polish/plan-02-workstation-ux-polish
agents:
  builder:
    effort: high
    rationale: This plan coordinates several UI flows, component tests, and docs
      while reusing existing workstation patterns.
---

# Workstation UX Polish

## Architecture Context

The workstation is a React/Vite iframe that talks to eforge-plan only through `window.eforge.invokeAction`. The UI must render server projections rather than scanning local files. Existing patterns to reuse include `SafeMarkdown`, `Badge`, `ToneChip`, `Spinner`, `formatRelativeTime`, two-step in-app confirmation, and the durable Planning activity rail.

## Implementation

### Overview

Polish four workstation flows: keep the annotation composer stable while typing and validating long input, make handoff state change immediately after confirmation, render projected timestamp metadata in plan list/detail UI, and make the Roadmap view read-first with explicit edit mode.

### Key Decisions

1. Keep annotation composer dismissal explicit. Remove implicit scroll/resize dismissal and keep draft state mounted until Save or Cancel.
2. Add local optimistic handoff state in `PlansView`, keyed by session/plan id, so the selected ready plan stops rendering as actionable before the asynchronous handoff action returns.
3. Render timestamp values through a shared UI helper with relative text and exact ISO access via `title`/`dateTime`; missing or invalid values render placeholders.
4. Default Roadmap local focus content to `SafeMarkdown` read mode. Only an explicit Edit action reveals textarea, Save, Cancel, and Reset controls, and read-only sources never render edit controls.

## Scope

### In Scope

- Annotation composer character count, inline limit feedback, disabled Save over the backend body limit, and in-dialog save error display.
- Draft preservation for over-limit annotation text and backend save failures.
- Immediate optimistic handoff hiding or non-actionable pending state after second-step confirmation.
- Handoff pending, failure, and reconciliation state surfaced through the existing Planning activity/status UI while the background handoff/enqueue runs.
- Handoff success reconciliation with refreshed backend artifacts.
- Handoff failure rollback with visible retry guidance and restored plan actionability.
- Plan row recency text and exact timestamp access.
- Plan detail lifecycle timestamp metadata for created, updated, ready, submitted/handoff, and last build activity values.
- Roadmap Markdown read mode by default, explicit edit mode, Save, Cancel, Reset, and read-only source Markdown rendering.
- Roadmap source metadata plus stale/recommendation status visible in read mode without implying editing.
- Focused UI/component tests for the changed behavior.
- Workstation documentation sync for the visible UX behavior.

### Out of Scope

- New daemon routes or route literals.
- Daemon workflow changes beyond consuming plan 01 projection fields.
- New markdown editor capabilities.
- Broad layout rewrites outside the specified workstation surfaces.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/timestamp.tsx` — reusable relative/exact timestamp display with placeholder handling.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/plan-timestamps.ts` — plan artifact/detail timestamp selection helpers, including recency and build-activity selection.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/plan-timestamps.test.ts` — unit coverage for recency selection, missing values, and invalid date handling.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plans-view-handoff.test.tsx` — component coverage for optimistic handoff success, failure rollback/retry guidance, activity/status visibility, and backend reconciliation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-timestamps-rendering.test.tsx` — component coverage for list/detail timestamp rendering, exact access, and placeholders.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/pending-annotation-composer.tsx` — keep the dialog mounted until explicit Save/Cancel/Escape; add character-limit feedback, disabled Save, and save-error state without clearing the draft.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-workspace.tsx` — adapt pending annotation save handling so backend failures surface inside the composer and do not close it.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` — provide a narrow way for annotation creation to rethrow or return backend error text for the composer while preserving existing toast behavior elsewhere.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-annotations.test.tsx` — add long-input, validation-limit, explicit-dismissal, and save-failure draft-preservation coverage.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — render projected lifecycle timestamps in the detail card and delegate confirmed handoff to the parent optimistic flow.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx` — own optimistic handoff state, filter pending plans from actionable list rows, clear/replace selected detail after confirmation, reconcile success/failure after refresh, render retry guidance, and surface pending/failure entries through the existing Planning activity/status UI.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.tsx` — split read/edit state, render local focus and read-only source Markdown through `SafeMarkdown`, hide edit controls outside edit mode, and keep source/freshness/recommendation metadata visible in read mode.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.test.tsx` — update and add tests for default Markdown read mode, edit save, cancel/reset, source metadata/freshness status, and read-only source behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-roadmap.ts` — add representative Markdown content to read-only source fixtures for read-mode tests.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — update mock handoff responses/artifact refresh behavior if component tests or local dev need submitted reconciliation.
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — document projected timestamps, optimistic handoff state, and Roadmap read-first behavior for workstation contributors.
- `eforge/extensions/eforge-plan/README.md` — sync user-facing workstation behavior text for Roadmap read mode, plan recency, stable annotations, and handoff pending state.

## Implementation Notes

- Avoid growing `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` and `src/fixtures/mock-data.ts`; both are at the 600-line implementation cap. Prefer local augmented types in new helper files or line-neutral edits if TypeScript needs extra timestamp fields.
- Keep timestamp rendering from projection fields only. Do not parse plan Markdown or artifact paths in React to infer dates.
- Preserve the current two-step handoff confirmation text; the second click is the point where optimistic state starts.
- For annotation body limits, mirror `MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH = 4000` in the workstation with an inline comment naming the backend schema constant.
- If Roadmap edit mode has dirty content and the user cancels, require an explicit discard confirmation or keep edit mode active; do not discard on a single incidental state change.

## Verification

- [ ] Typing more than 4,000 characters in the annotation composer keeps the dialog mounted and the textarea value unchanged.
- [ ] Annotation Save is disabled while the draft exceeds the body limit and inline feedback reports the limit state.
- [ ] Backend annotation save failure text appears in the composer and the draft remains in the textarea.
- [ ] Scroll and resize events do not close the annotation composer; Cancel and Escape close it.
- [ ] After confirmed Handoff, the selected ready plan row is absent from the actionable list before `handoff-session-plan` resolves.
- [ ] After confirmed Handoff, the detail pane displays pending handoff progress or clears stale ready controls before the backend response resolves.
- [ ] Handoff pending and failure states remain visible in the existing Planning activity/status surface while the background action runs or fails.
- [ ] Handoff success followed by refresh leaves the submitted plan absent from active artifacts.
- [ ] Handoff failure restores the plan row and renders retry/manual guidance containing the backend or fallback message.
- [ ] Plan list rows display relative recency text and expose the exact timestamp through `title` or `dateTime`.
- [ ] Plan detail displays Created, Updated, Ready, Submitted, and Last build activity rows when values exist.
- [ ] Missing or invalid timestamp values display placeholder text and do not render raw `null`, `undefined`, or invalid date strings.
- [ ] Roadmap local focus renders Markdown read mode by default, including heading, list, inline code, and link elements.
- [ ] Roadmap read mode keeps source metadata and stale/recommendation status visible outside edit controls for editable and read-only sources.
- [ ] Roadmap Edit reveals textarea, Save, Cancel, and Reset controls; those controls are hidden again in read mode.
- [ ] Roadmap Save invokes `update-roadmap-state` with local focus content and expected hash, then returns to read mode.
- [ ] Roadmap Cancel/Reset preserves or explicitly discards dirty edits without silent data loss.
- [ ] Read-only roadmap sources render Markdown content and expose no edit, save, cancel, or reset controls.
- [ ] Targeted workstation Vitest suites for annotations, handoff, timestamps, and roadmap pass.