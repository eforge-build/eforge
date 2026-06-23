---
id: plan-01-review-rail-annotations
name: Review Rail Annotation and Revision Controls
branch: improve-session-plan-review-and-rendering-ux/plan-01-review-rail-annotations
agents:
  builder:
    effort: high
    rationale: "Cross-component React state refactor: the revision-session hook,
      selected plan detail, pending annotation target, main card, and rail must
      share one state owner while preserving existing action payloads."
  reviewer:
    effort: high
    rationale: Payload preservation and UI state placement are central acceptance
      points for this refactor.
---

# Review Rail Annotation and Revision Controls

## Architecture Context

The flat plan detail surface currently owns `usePlanRevisionSession`, renders open annotations, and renders the AI revision thread inside `PlanDetailCard`. The surrounding `PlanContextRail` only shows lineage and build context. This plan moves annotation composition, open-annotation management, and revision-turn activity into the plan rail while keeping the existing backend action ids and payload shapes.

## Implementation

### Overview

Introduce a selected-flat-plan workspace that owns exactly one `usePlanRevisionSession` instance and one pending annotation target. The workspace renders the main plan detail and a plan review rail from the same state. Inline annotation affordances become target selectors; only the rail composer persists an annotation.

### Key Decisions

1. Keep `usePlanRevisionSession` unchanged as the session API owner, but hoist its invocation out of the main card into the selected-plan workspace.
2. Model annotation composition as `pendingAnnotationTarget: PlanRevisionAnnotationTarget | null` plus a note draft in the rail composer.
3. Preserve `create-plan-revision-annotation`, `update-plan-revision-annotation`, `resolve-plan-revision-annotation`, `dismiss-plan-revision-annotation`, `delete-plan-revision-annotation`, `start-plan-revision-turn`, `cancel-plan-revision-turn`, and `retry-plan-revision-turn` payload shapes.
4. Keep existing source backlog item, epic, build-state, and PR context in the rail by extracting or composing the current `PlanContextRail` content.

## Scope

### In Scope

- Move revision-session state and pending annotation target state to a wrapper that renders both main plan content and the review rail.
- Change whole-plan, section, focused-block, and selection annotation buttons so they select a pending target instead of creating an annotation.
- Add a side-rail composer that displays target metadata, captured text, quote context, and a note textarea.
- Persist annotations only from the rail Save action, trimming the note body.
- Cancel pending annotations without invoking a mutation action.
- Render open annotation edit/resolve/dismiss/delete controls in the rail.
- Render revision submit, include-open-annotations, selected annotation, running, cancel, retry, redraft, patch-ready, applied, and failed activity in the rail.
- Keep edit locking tied to `usePlanRevisionSession.hasRunningTurn`.

### Out of Scope

- Backend revision-session contract changes.
- Executive summary persistence or progressive section disclosure.
- Mermaid rendering.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-workspace.tsx` — Wrapper for selected flat plans that owns revision state, pending target state, and renders main detail plus rail.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/pending-annotation-composer.tsx` — Rail composer for pending annotation targets and note persistence.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-review-rail.tsx` — Rail composition for source context, pending composer, open annotations, and revision activity. Keep the file below 300 lines or add durable semantic region markers.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/workstation-view.tsx` — Let the Plans focus use the rail rendered by `PlansView` instead of the outer static rail.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans-view.tsx` — Render a three-column Plans layout for list, selected detail, and selected-plan rail; pass selected artifact/title context into the workspace.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-context-rail.tsx` — Extract reusable source/backlog/epic/build/PR context content or re-export a compatibility wrapper used by `PlanReviewRail`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — Remove local revision-session ownership and embedded annotation/revision panels; accept revision/locked state and annotation target selection callbacks from the workspace.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-annotatable-section.tsx` — Replace `onCreateAnnotation` with `onSelectAnnotationTarget`; keep selection and focused-block target builders.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotations-panel.tsx` — Make the panel rail-friendly with stable aria labels while retaining action calls and payload construction.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.tsx` — Support rail rendering and default-open behavior when recent activity exists.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-thread.tsx` — Preserve cancel/retry/redraft controls in the rail activity view.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-annotations.test.tsx` — Replace immediate-create assertions with pending-target composer, save, cancel, and payload preservation coverage.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.test.tsx` — Assert revision statuses and controls render in the rail.
- Any affected workstation tests under `eforge/extensions/eforge-plan/workstation-src/plans/src/` — Update selectors for the new rail location.

## Verification

- [ ] Component tests prove clicking annotate selection, focused block, section, and whole plan renders the rail composer.
- [ ] Component tests prove no `create-plan-revision-annotation` invocation occurs before Save.
- [ ] Saving the rail composer invokes `create-plan-revision-annotation` with the selected target and trimmed note body.
- [ ] Cancelling the rail composer leaves the bridge invocation list without a create-annotation call.
- [ ] Composer tests cover target kind, dimension or label, captured excerpt, quote context, and note textarea for selection, block, section, and whole-plan targets.
- [ ] Rail tests prove edit, resolve, dismiss, and delete controls call the existing annotation action ids with existing payload shapes.
- [ ] Rail tests prove selected annotation revision controls and include-open-annotations controls call `start-plan-revision-turn` with the existing payload shape.
- [ ] Rail tests prove running, cancel, retry, redraft, patch-ready, applied, and failed revision-turn states are visible in the rail.
- [ ] Tests prove main plan content does not contain the open-annotation management panel or primary revision thread controls.
- [ ] Tests prove plan edit controls remain disabled while `hasRunningTurn` is true.