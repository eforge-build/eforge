---
id: plan-04-annotation-workstation
name: Add rendered plan annotation capture, fallback controls, unresolved
  annotation management, and sticky annotation-driven revision UX.
branch: mature-eforge-plan-with-annotation-revisions-local-roadmaps-and-installable-packaging/annotation-workstation
---

# Annotation Workstation

## Architecture Reference

This module implements the **Annotation and revision design**, **Annotation action contract**, **Revision flow**, and `annotation-workstation` module guidance from the architecture for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**.

Key constraints from architecture:
- Depend on `annotation-backend` action/type contracts only. The workstation bundle must not import backend implementation helpers.
- Capture annotations inside the workstation iframe with `window.getSelection()` and rendered plan-section metadata; do not depend on parent Console selection APIs.
- Persist semantic annotation targets containing target kind, optional dimension, captured text, and quote-style context. Do not persist DOM offsets as durable anchors.
- Provide selected-text capture plus accessible block, section, and whole-plan fallback controls in the rendered flat session plan view.
- Render unresolved annotations with target context, stored timestamps, edit/delete/resolve/dismiss controls, and a sticky annotation-driven **Revise with AI** control.
- Start annotation-driven revision turns through the existing `start-plan-revision-turn` action fields: `annotationIds`, `includeOpenAnnotations`, and `steering`, while preserving the manual `{ session, message }` prompt flow.
- Reuse the existing one-running-turn lock and auto-apply flow exposed through `usePlanRevisionSession`; do not add daemon routes or daemon wire-shape declarations.
- Keep action payloads bounded and JSON-safe; backend validation remains authoritative.
- Keep new implementation files under 600 lines and split components/helpers/tests before a file approaches the limit.

## Scope

### In Scope
- Add workstation-facing TypeScript interfaces for plan revision annotations, annotation targets, quote context, and turn annotation snapshots.
- Add pure helpers for quote-context construction, annotation target creation, unresolved annotation filtering, annotation sorting, and compact target labels.
- Add rendered plan-section annotation capture using in-frame selection state.
- Add accessible fallback controls for:
  - the currently focused rendered block,
  - a section,
  - the whole plan.
- Add annotation action callbacks to `usePlanRevisionSession` for create, update, delete, resolve, dismiss, and annotation-driven turn submission.
- Load an existing revision session silently when a plan detail opens so persisted unresolved annotations appear after reloads without requiring a manual revision-thread start.
- Render unresolved annotation cards with target context, created/updated timestamps, edit/delete/resolve/dismiss controls, and selected-for-revision checkboxes.
- Render a sticky annotation-driven revision control when unresolved annotations exist, including unresolved count, optional steering text, selected annotation IDs, and an “include open annotations” option.
- Disable annotation-driven revision submission while a turn is queued or running, and while revision actions are busy/loading.
- Preserve the existing manual `PlanRevisionPanel` prompt behavior and existing auto-apply behavior.
- Add dev/mock bridge support for annotation action cases so local workstation development can exercise annotation capture and revision submission without a daemon.
- Add focused component/hook tests for selection capture, block/section/whole-plan fallbacks, unresolved annotation management controls, sticky annotation revision submission, and manual prompt regression.

### Out of Scope
- Backend schemas, storage helpers, annotation action registration, revision turn snapshot persistence, source-text assembly, and apply-time annotation resolution; `annotation-backend` owns those.
- Roadmap state, roadmap source status, local focus roadmap editing, and recommendation refresh UI; roadmap modules own those.
- README/public documentation for annotation revisions; `packaging-docs-validation` owns final user documentation.
- Package install/update/trust/reload validation.
- New daemon routes, daemon scheduling/orchestration features, or daemon wire-shape declarations.
- Rewriting shared project roadmap files.

## Implementation Approach

### Overview

Build the annotation UI as a browser-only layer over the annotation backend actions. `PlanDetailCard` keeps owning the flat session-plan detail view, but delegates rendered section capture to a new `AnnotatablePlanSection` component and unresolved annotation/revision controls to a new `PlanRevisionAnnotationsPanel` component.

`usePlanRevisionSession` becomes the single hook for revision-session state and annotation mutations. It still supports the existing manual `submit(message: string)` call used by `PlanRevisionPanel`. It also exposes annotation methods that invoke the backend action IDs by bridge only, store the returned session projection, and surface errors through the existing toast provider. A silent `loadExistingSession()` path calls `get-plan-revision-session` when a plan detail opens, suppressing the expected “no session exists” error so existing annotations appear after reloads without creating revision records for every viewed plan.

Rendered section capture never stores DOM offsets. For selection annotations, `AnnotatablePlanSection` reads `window.getSelection()` inside the iframe, verifies the range belongs to that section’s rendered markdown container, copies `selection.toString()`, and builds quote context from the rendered section text. For block annotations, rendered top-level markdown blocks are made focusable after `SafeMarkdown` renders; the user focuses/clicks a block and then uses an accessible “Annotate focused block” button. Section and whole-plan fallback buttons build targets from the section source text or a bounded whole-plan text assembled from dimension headings plus section content.

Unresolved annotations are the live session annotations without `resolvedAt` and without `dismissedAt`. The panel lists only unresolved annotations, sorted by creation time. The sticky revision control sends selected annotation IDs plus `includeOpenAnnotations` and optional steering text to `start-plan-revision-turn`. Backend snapshot and resolution semantics remain owned by `annotation-backend`.

### Key Decisions

1. **Keep annotation mutation inside `usePlanRevisionSession`.** The existing hook already serializes revision-session projection state, polling, auto-apply, and revision busy flags. Adding annotation methods there prevents each component from duplicating bridge calls or session projection handling.
2. **Silent session load uses `get-plan-revision-session`, not `start-plan-revision-session`.** A plan with no revision state stays untouched until the user captures an annotation or starts a revision turn. A persisted annotation session is loaded and rendered after plan-detail mount.
3. **Selection capture is button-driven.** The section toolbar exposes `Annotate selection` only when the current in-frame selection is inside that section. The button uses `onMouseDown={(event) => event.preventDefault()}` so clicking it does not clear the browser selection before capture.
4. **Block fallback uses focus, not coordinates.** Top-level rendered markdown elements receive `tabIndex=0`, `role="group"`, and stable `data-plan-annotation-block` metadata after render. This creates a keyboard path for block capture and avoids mouse-coordinate or DOM-offset persistence.
5. **Quote context is derived from text snapshots.** `buildQuoteContext(sourceText, capturedText)` records `exact`, bounded `prefix`, and bounded `suffix` from the rendered section/whole-plan text when the captured text is found; otherwise it records the captured text as `exact` with best-effort surrounding context omitted. The durable target never includes range offsets, node paths, or element IDs.
6. **Whole-plan target content is bounded before submission.** The UI mirrors backend limits for captured text/context/label lengths so most invalid-payload errors are prevented client-side, but it still relies on backend schemas for final validation.
7. **Annotation edits modify the user note only in the first UI pass.** Backend supports target replacement, but this module exposes note editing to avoid accidental retargeting after a user captures semantic context. Delete can be used to discard an incorrect target.
8. **Manual revision UI remains in `PlanRevisionPanel`.** The new sticky control calls a new annotation-specific hook method. Existing tests that submit a free-form prompt through `PlanRevisionPanel` must continue to observe `{ session, message }` payloads.
9. **Mock annotation state lives in `mock-plan-revisions.ts`.** Do not grow `mock-data.ts`; the revision fixture file already owns mock revision sessions and can add bounded annotation records/action helpers.
10. **Use action IDs only.** New workstation code calls `create-plan-revision-annotation`, `update-plan-revision-annotation`, `delete-plan-revision-annotation`, `resolve-plan-revision-annotation`, `dismiss-plan-revision-annotation`, and `start-plan-revision-turn` through the bridge. It does not import daemon HTTP helpers or route constants.

### Component Contracts

Use these hook additions unless implementation testing exposes a narrower existing convention:

```ts
// --- eforge:region plan-03-annotation-workstation ---
export interface PlanRevisionAnnotationMutationInput {
  annotationId: string;
  body?: string;
}

export interface SubmitAnnotationRevisionInput {
  annotationIds?: string[];
  includeOpenAnnotations?: boolean;
  steering?: string;
}

export interface PlanRevisionAnnotationApiAdditions {
  createAnnotation: (target: PlanRevisionAnnotationTarget, body?: string) => Promise<PlanRevisionSessionProjection | null>;
  updateAnnotation: (input: PlanRevisionAnnotationMutationInput) => Promise<PlanRevisionSessionProjection | null>;
  deleteAnnotation: (annotationId: string) => Promise<PlanRevisionSessionProjection | null>;
  resolveAnnotation: (annotationId: string) => Promise<PlanRevisionSessionProjection | null>;
  dismissAnnotation: (annotationId: string) => Promise<PlanRevisionSessionProjection | null>;
  submitAnnotationRevision: (input: SubmitAnnotationRevisionInput) => Promise<PlanRevisionSessionProjection | null>;
}
// --- eforge:endregion plan-03-annotation-workstation ---
```

`PlanDetailCard` section rendering is replaced with an annotatable section component and a whole-plan fallback control:

```tsx
{/* --- eforge:region plan-03-annotation-workstation --- */}
<AnnotatablePlanSection
  plan={plan}
  dimension={key}
  content={content}
  disabled={locked || revision.busy || revision.loading}
  onCreateAnnotation={revision.createAnnotation}
/>
<PlanRevisionAnnotationsPanel plan={plan} api={revision} disabled={locked} />
{/* --- eforge:endregion plan-03-annotation-workstation --- */}
```

## Files

### Create
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-targets.ts` — pure helpers for text bounding, whitespace normalization, quote-context construction, whole-plan text assembly, selection target creation from a `Selection`, focused-block target creation from an `HTMLElement`, section target creation, and whole-plan target creation. Keep this file free of bridge imports.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-view-model.ts` — pure helpers for `isOpenAnnotation`, creation-time sorting, selected-ID initialization, target label text, context excerpts, timestamp label data, and submit-disabled reasons.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-annotatable-section.tsx` — rendered section wrapper around `SafeMarkdown`; manages in-frame selection state, focusable rendered block metadata, `Annotate selection`, `Annotate focused block`, and `Annotate section` controls.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotations-panel.tsx` — unresolved annotation list, inline note editor, delete/resolve/dismiss controls, selected-for-revision checkboxes, sticky revision control, steering textarea, include-open toggle, and success/error toast integration through hook return values.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-targets.test.ts` — unit tests for quote-context construction, selection containment rejection, block/section/whole-plan target shapes, bounding behavior, and no-offset target data.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-annotations.test.tsx` — component/integration tests rendering `PlanDetailCard` with a bridge stub to cover selected-text annotation, block fallback, section fallback, whole-plan fallback, unresolved annotation controls, sticky revision submission, and manual prompt regression.

### Modify
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add annotation target, annotation, turn snapshot, annotation action request/response, and `annotationSnapshot`/`annotations` projection interfaces near the existing plan revision types `[region: annotation-workstation, plan revision annotation projection interfaces]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` — add an `autoLoadExisting?: boolean` hook option, silent existing-session load, annotation mutation methods, annotation-driven turn submission, `submit` input compatibility for manual prompts, session projection updates after annotation mutations, and stale-session guards for annotation action results `[region: annotation-workstation, annotation action callbacks and annotation-driven turn submission]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — call `usePlanRevisionSession` with `autoLoadExisting: true`, render annotatable sections, add whole-plan annotation fallback placement in the sections header, mount `PlanRevisionAnnotationsPanel` before the manual `PlanRevisionPanel`, pass revision busy/running state to annotation controls, and keep existing plan mutation locking behavior `[region: annotation-workstation, rendered-section annotation capture/fallback controls and annotation panel placement]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.tsx` — preserve manual prompt submission while adapting to any hook method rename or overload; keep the visible copy and disabled behavior for free-form revision turns `[region: annotation-workstation, manual revision prompt compatibility with extended hook API]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx` — add hook tests for silent load ignoring missing-session errors, create/update/delete/resolve/dismiss action payloads, annotation-driven start-turn payloads, and unchanged manual `{ session, message }` payloads.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.test.tsx` — update existing bridge stubs to include `annotations: []` when needed and add one regression assertion that manual prompt submission still calls `start-plan-revision-turn` without `annotationIds`, `includeOpenAnnotations`, or `steering`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-plan-revisions.ts` — add `annotations` arrays to mock sessions, mock create/update/delete/resolve/dismiss helpers, and annotation snapshot data for mock annotation-driven turns.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — import mock annotation helpers and add switch cases for `create-plan-revision-annotation`, `update-plan-revision-annotation`, `delete-plan-revision-annotation`, `resolve-plan-revision-annotation`, and `dismiss-plan-revision-annotation` without touching roadmap action cases `[region: annotation-workstation, mock annotation action cases]`.
- `test/eforge-plan-workstation.test.ts` — assert the planning workstation `allowedActions` includes the five annotation mutation actions and that the existing revision turn actions remain allowed `[region: annotation-workstation, annotation allowed action assertions]`.

Shared-file note: `bridge.ts` is not listed in the architecture Shared File Registry, but `roadmap-workstation` also plans mock bridge action cases. This module owns only annotation action cases in `bridge.ts`; `roadmap-workstation` owns `get-roadmap-state`, `update-roadmap-state`, `refresh-recommendations`, and mock recommendation wrapping.

If temporary source coordination markers are needed in shared files, use the compiled plan slug `plan-03-annotation-workstation`, for example:

```tsx
{/* --- eforge:region plan-03-annotation-workstation --- */}
{/* annotation-workstation-owned temporary JSX */}
{/* --- eforge:endregion plan-03-annotation-workstation --- */}
```

## Implementation Details

### Workstation-facing types

Mirror the backend action contract in `types.ts` without importing backend source:

- `PlanRevisionAnnotationTargetKind`: `'selection' | 'block' | 'section' | 'whole-plan'`.
- `PlanRevisionAnnotationQuoteContext`: `{ exact: string; prefix?: string; suffix?: string }`.
- `PlanRevisionAnnotationTarget`: `{ kind; dimension?; label?; capturedText; quoteContext }`.
- `PlanRevisionAnnotation`: `{ annotationId; targetSession; body?; target; createdAt; updatedAt; resolvedAt?; resolvedByTurnId?; dismissedAt? }`.
- `PlanRevisionTurnAnnotationSnapshot`: `steering`, `selectedAnnotationIds`, `openAnnotationIds`, `includeOpenAnnotations`, and copied snapshot annotations.
- Add `annotationSnapshot?: PlanRevisionTurnAnnotationSnapshot` to `PlanRevisionTurnProjection`.
- Add `annotations?: PlanRevisionAnnotation[]` to `PlanRevisionSessionProjection`; treat an absent field as `[]` in view-model helpers to tolerate old projections during staged module builds.

### Target capture and quote context

`plan-revision-annotation-targets.ts` owns all target construction. Use constants that mirror backend limits:

- `MAX_CAPTURED_TEXT = 6000`.
- `MAX_CONTEXT_TEXT = 1000`.
- `MAX_LABEL_TEXT = 200`.
- `MAX_STEERING_TEXT = 4000`.

Target helpers:

- `buildQuoteContext(sourceText, capturedText)` trims bounded text, searches for the captured text in normalized source text, and returns `{ exact, prefix, suffix }` when found.
- `buildSelectionAnnotationTarget(selection, sectionRoot, dimension, label)` returns `null` when the selection is collapsed, outside the section, or empty after trimming.
- `buildBlockAnnotationTarget(blockElement, sectionRoot, dimension, label)` copies `blockElement.innerText || textContent` and quote context from the section root text.
- `buildSectionAnnotationTarget(dimension, label, content)` records section content with `kind: 'section'`.
- `buildWholePlanAnnotationTarget(plan)` records bounded text assembled as `# topic`, session, and `## <dimension>` headings plus section content with `kind: 'whole-plan'`.

Do not include properties named `offset`, `startOffset`, `endOffset`, `range`, `nodePath`, `selector`, or `xpath` in target objects.

### Rendered section controls

`AnnotatablePlanSection` receives `plan`, `dimension`, `content`, `disabled`, and `onCreateAnnotation`. It renders:

- Section title and badges using `titleCase`.
- `Annotate selection` button, disabled when no current selection is inside the rendered markdown container.
- `Annotate focused block` button, disabled until a focus/click event identifies a rendered top-level block.
- `Annotate section` button, enabled when section content is non-empty.
- `SafeMarkdown` in a ref-wrapped container.

On mount and after content changes, decorate top-level rendered markdown children under `.plan-prose`:

```ts
// --- eforge:region plan-03-annotation-workstation ---
block.tabIndex = 0;
block.setAttribute('role', 'group');
block.setAttribute('aria-label', `${titleCase(dimension)} block ${index + 1}`);
block.dataset.planAnnotationBlock = String(index + 1);
// --- eforge:endregion plan-03-annotation-workstation ---
```

Use `document.addEventListener('selectionchange', ...)` while the component is mounted. The handler reads `window.getSelection()` and updates only when the selection belongs to this section. The handler must not read `window.parent`, `parent.document`, or host-level selection APIs.

### Annotation panel and sticky revision control

`PlanRevisionAnnotationsPanel` receives `plan`, `api`, and `disabled`. It derives open annotations from `api.revisionSession?.annotations ?? []`.

For each open annotation card, render:

- target kind, dimension label when present, and target label;
- captured text excerpt and quote prefix/suffix when present;
- created and updated timestamps using `<time dateTime={...}>` plus the existing `formatRelativeTime` helper;
- body text or “No note” state;
- `Edit note`, `Save note`, `Cancel`, `Delete`, `Resolve`, and `Dismiss` controls;
- a checkbox with label `Include annotation <short id> in selected revision set`.

Sticky revision control behavior:

- Render only when `openAnnotations.length > 0`.
- Display text such as `3 open annotations`.
- Include an optional steering textarea.
- Include a checked-by-default `Include all open annotations` checkbox.
- Keep selected annotation IDs in component state; when annotations reload, drop IDs no longer open and add new open IDs to the default selected set.
- `Revise with AI from annotations` calls `api.submitAnnotationRevision({ annotationIds: selectedIds, includeOpenAnnotations, steering })`.
- Disable the submit button when `api.loading`, `api.busy`, `api.hasRunningTurn`, `disabled`, `selectedIds.length === 0 && !includeOpenAnnotations`, or steering exceeds the backend/UI bound.
- Clear steering after a successful submit and leave checkboxes synced to the returned session projection.

### Hook action semantics

Add these methods to `usePlanRevisionSession`:

- `loadExistingSession()` — calls `get-plan-revision-session` with `{ session, includePlan: false }`; on a missing-session error, returns `null` without pushing a toast.
- `createAnnotation(target, body?)` — invokes `create-plan-revision-annotation` with `{ session, target, ...(body && { body }) }`.
- `updateAnnotation({ annotationId, body })` — invokes `update-plan-revision-annotation` with `{ session, annotationId, body }`.
- `deleteAnnotation(annotationId)` — invokes `delete-plan-revision-annotation`.
- `resolveAnnotation(annotationId)` — invokes `resolve-plan-revision-annotation`.
- `dismissAnnotation(annotationId)` — invokes `dismiss-plan-revision-annotation`.
- `submitAnnotationRevision({ annotationIds, includeOpenAnnotations, steering })` — ensures or uses the loaded session, trims steering, invokes `start-plan-revision-turn`, and stores `result.session`.

Every annotation mutation sets `busy` during the bridge call, stores the returned session projection only when `targetSession === currentSessionRef.current`, and shows one success toast with action-specific copy after a non-null result. Manual `submit(message: string)` keeps returning `null` for an empty trimmed message and still sends only `{ session, message: trimmed }`.

## Testing Strategy

### Unit Tests
- `plan-revision-annotation-targets.test.ts`
  - `buildQuoteContext` returns `exact`, bounded `prefix`, and bounded `suffix` for a captured substring.
  - `buildQuoteContext` bounds long captured text and context fields to the UI constants.
  - `buildSelectionAnnotationTarget` returns `null` for a collapsed selection and for a selection outside the section root.
  - `buildSelectionAnnotationTarget` returns `kind: 'selection'`, `dimension`, `capturedText`, and `quoteContext` for an in-section selection.
  - `buildBlockAnnotationTarget` returns `kind: 'block'` with rendered block text and section quote context.
  - `buildSectionAnnotationTarget` and `buildWholePlanAnnotationTarget` return semantic target objects without offset/range/node-path fields.
- `plan-revision-annotation-view-model` tests can live beside the target tests or in a dedicated file if helpers grow:
  - open-annotation filtering excludes `resolvedAt` and `dismissedAt` records;
  - sorting is stable by `createdAt` then `annotationId`;
  - selected-ID synchronization removes deleted/resolved IDs and includes newly open IDs;
  - submit-disabled reason distinguishes running turn, busy hook, no selected/open annotations, and over-limit steering.
- `use-plan-revision-session.test.tsx`
  - silent existing-session load stores a session with annotations.
  - missing-session load returns `null` and does not call the toast error path.
  - create/update/delete/resolve/dismiss methods invoke the expected action IDs with `{ session, annotationId, ... }` payloads.
  - `submitAnnotationRevision` invokes `start-plan-revision-turn` with `annotationIds`, `includeOpenAnnotations`, and trimmed `steering`.
  - manual `submit('  revise  ')` invokes `start-plan-revision-turn` with exactly `{ session: 's', message: 'revise' }`.

### Component Tests
- `plan-detail-annotations.test.tsx`
  - Renders a plan detail, stubs an in-frame `window.getSelection()` range inside the Scope section, clicks `Annotate selection in Scope`, and observes `create-plan-revision-annotation` with `target.kind: 'selection'`, `dimension: 'scope'`, captured text, and quote context.
  - Stubs a selection outside the rendered section and observes the section selection button disabled or no create action.
  - Focuses a rendered markdown block, clicks `Annotate focused block in Scope`, and observes `target.kind: 'block'` with block text.
  - Clicks `Annotate section Scope` and observes `target.kind: 'section'` with the section content.
  - Clicks `Annotate whole plan` and observes `target.kind: 'whole-plan'` with text from both rendered sections.
  - Renders unresolved annotations from the session projection and observes target context, created/updated `<time>` elements, edit, delete, resolve, and dismiss controls.
  - Edits an annotation note and observes `update-plan-revision-annotation` with the annotation ID and trimmed body.
  - Clicks delete/resolve/dismiss controls and observes the corresponding annotation action IDs.
  - With two unresolved annotations, fills steering, clicks `Revise with AI from annotations`, and observes `start-plan-revision-turn` with selected IDs, `includeOpenAnnotations: true`, and trimmed steering.
  - With a queued/running turn in the projection, observes the sticky submit button disabled and no start-turn action after click.
  - Submits the manual prompt in `PlanRevisionPanel` and observes no annotation fields in the manual start-turn payload.

### Integration/Regression Tests
- Update `test/eforge-plan-workstation.test.ts` to assert annotation action IDs are present in the workstation allowlist after `annotation-backend` registers them.
- Keep existing auto-apply tests intact; component tests for annotation-driven turns only assert start payloads. Backend tests own snapshot immutability and apply-time auto-resolution.
- Mock bridge regression: invoke `create-plan-revision-annotation` through the dev bridge, then `get-plan-revision-session`, and assert the returned session contains the created unresolved annotation.

## Verification

- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test -- src/views/plans/plan-revision-annotation-targets.test.ts src/views/plans/plan-detail-annotations.test.tsx src/views/plans/use-plan-revision-session.test.tsx src/views/plans/plan-revision-panel.test.tsx` exits 0.
- [ ] `pnpm test -- test/eforge-plan-workstation.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation build` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `plan-detail-annotations.test.tsx` observes `create-plan-revision-annotation` called with `target.kind: 'selection'`, `target.dimension: 'scope'`, non-empty `capturedText`, and `quoteContext.exact` for selected text inside the rendered Scope section.
- [ ] `plan-detail-annotations.test.tsx` observes `create-plan-revision-annotation` called with `target.kind: 'block'` after focusing a rendered markdown block.
- [ ] `plan-detail-annotations.test.tsx` observes `create-plan-revision-annotation` called with `target.kind: 'section'` after clicking the section fallback control.
- [ ] `plan-detail-annotations.test.tsx` observes `create-plan-revision-annotation` called with `target.kind: 'whole-plan'` after clicking the whole-plan fallback control.
- [ ] `plan-detail-annotations.test.tsx` observes unresolved annotation cards containing target context text, `time[dateTime]` elements for created and updated timestamps, and buttons named `Edit note`, `Delete`, `Resolve`, and `Dismiss`.
- [ ] `plan-detail-annotations.test.tsx` observes `start-plan-revision-turn` called with `annotationIds`, `includeOpenAnnotations`, and trimmed `steering` from the sticky annotation revision control.
- [ ] `plan-detail-annotations.test.tsx` observes the sticky annotation revision submit button disabled when a projected turn has status `queued` or `running`.
- [ ] `use-plan-revision-session.test.tsx` observes manual `submit` sending exactly `{ session: 's', message: 'revise' }` with no annotation keys.
- [ ] `rg "window\.parent|parent\.document|parent\.getSelection|offset|startOffset|endOffset|nodePath|xpath" eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-targets.ts eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-annotatable-section.tsx` returns no matches.
- [ ] `rg "/api/" eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-*annotation* eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` returns no matches.
- [ ] No new implementation file exceeds 600 lines.
- [ ] No new test file exceeds 1,200 lines.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
