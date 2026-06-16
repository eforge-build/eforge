# Annotation Backend

## Architecture Reference

This module implements the **Annotation model**, **Annotation action contract**, and **Revision flow** sections from the architecture document for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**. It builds on `package-foundation`, so implementation work assumes `eforge/extensions/eforge-plan/` already imports public package entrypoints and builds as `@eforge-build/eforge-plan`.

Key constraints from architecture:
- Persist annotations in eforge-plan private project-local revision storage under the target revision session.
- Store semantic/quote-context annotation targets; do not persist DOM offsets as durable anchors.
- Keep existing manual `start-plan-revision-turn` callers compatible with `{ session, message }`.
- Snapshot selected/open annotations and steering text onto each durable revision turn before the daemon task result can mutate later state.
- Include structured annotation context and steering text in `buildPlanRevisionSourceText`.
- Resolve referenced annotations only after a successful patch-bearing `apply-plan-revision-turn` result.
- Leave referenced annotations unresolved for answer-only, needs-input, failed, cancelled, invalid-patch, and mismatched revision turns.
- Reuse the existing one-running-turn lock, auto-apply semantics, and idempotent apply behavior.
- Use extension actions; do not add daemon routes or re-declare daemon wire shapes.
- Keep action responses bounded and JSON-safe.

## Scope

### In Scope
- Add persisted annotation schemas/types for `PlanRevisionAnnotation`, `PlanRevisionAnnotationTarget`, quote context, and turn snapshots.
- Migrate existing revision indexes that lack session-level `annotations` arrays to `annotations: []` during normalization.
- Add store helpers for create, update, delete, resolve, dismiss, and apply-time resolution of plan revision annotations.
- Register bounded extension actions:
  - `create-plan-revision-annotation`
  - `update-plan-revision-annotation`
  - `delete-plan-revision-annotation`
  - `resolve-plan-revision-annotation`
  - `dismiss-plan-revision-annotation`
- Extend `start-plan-revision-turn` to accept optional `annotationIds`, `includeOpenAnnotations`, and `steering` while preserving existing `message` behavior.
- Snapshot selected annotations, open annotations, and steering text onto `PlanRevisionTurnEntry`.
- Include the annotation snapshot in plan-revision source context and recent-turn context.
- Resolve referenced unresolved annotations with `resolvedAt` and `resolvedByTurnId` after successful patch application.
- Update extension registration and workstation `allowedActions` for backend annotation actions.
- Add focused tests for storage migration, annotation handlers, snapshot immutability, source context, and apply-time resolution/non-resolution paths.

### Out of Scope
- Rendered plan selection capture, block/section/whole-plan fallback controls, sticky UI state, and annotation list UI. Those belong to `annotation-workstation`.
- Roadmap state, roadmap source resolution, recommendation freshness, and roadmap workstation UI. Those belong to roadmap modules.
- Package install/update/trust/reload validation and README/user documentation. Those belong to `packaging-docs-validation`.
- Changes to client-owned daemon route constants, daemon response wire shapes, or engine scheduling behavior.
- Automatic rewrites of shared project roadmap files.

## Implementation Approach

### Overview

Add annotation support as a backward-compatible extension of the current plan revision index. The revision index keeps `schemaVersion: 1`; normalization fills missing `annotations` arrays on legacy sessions before validating the full index. New annotation records live under the revision session that owns the target flat session plan.

Create a small pure-helper module, `plan-revision-annotations.ts`, for open-annotation filtering, snapshot assembly, referenced-ID extraction, and annotation-derived user-message generation. Keep file I/O and atomic mutation in `plan-revision-store.ts`, action registration/orchestration in `plan-revision-actions.ts`, and source text assembly in `plan-revision-orchestration.ts`.

A manual revision turn remains a `{ session, message }` request. An annotation-driven turn may provide selected annotation IDs, request open annotations, and/or steering text. Before starting the daemon planning task, the backend validates selected annotations against the current session, computes the open annotation set, deep-copies the referenced annotation records into `turn.annotationSnapshot`, and passes the same snapshot into `buildPlanRevisionSourceText`. Later annotation edits update only the live session annotation records; historical turn snapshots remain unchanged.

Apply-time resolution happens in the existing `apply-plan-revision-turn` action after the patch has passed task, target, fingerprint, and section validation and after `applyRevisionPatchSections` writes the plan. `markPlanRevisionTurnApplied` records `appliedAt`/`appliedSections` and resolves referenced unresolved annotations in the same revision-index write. All not-applicable paths return before this store mutation, so answer-only, needs-input, failed, cancelled, mismatched, and invalid-patch turns leave annotations unresolved.

### Key Decisions

1. **Schema version stays at 1 with migration-on-read.** The only persisted shape change is adding optional/new fields that can be normalized from existing data. Legacy sessions missing `annotations` parse as sessions with `annotations: []`.
2. **Annotation records are bounded at input.** Define explicit max lengths for annotation body, captured text, quote prefix/suffix, labels, steering text, and per-session annotation count. Reject create requests once the per-session cap is reached.
3. **Durable targets reject DOM-offset-only data.** Target schemas include `kind`, optional `dimension`, optional `label`, `capturedText`, and `quoteContext`; schemas use `additionalProperties: false`, so offset-only or DOM-node payloads fail validation.
4. **Projection avoids unbounded list payloads.** `get-plan-revision-session` includes annotations when plan data is included. `list-plan-revision-sessions` includes annotations only when `includePlan: true`. Annotation mutation actions return a session projection with annotations and without full plan content.
5. **Annotation-only turns synthesize a non-empty user message.** `PlanRevisionTurnEntry.userMessage`, daemon task `topic`, and `boundedSourceText` still require a non-empty request. If the caller omits `message`, derive a bounded message such as `Revise from 2 plan annotations.` and store the original steering text in `annotationSnapshot.steering`.
6. **Open annotation inclusion defaults to annotation-driven behavior.** Manual message-only turns do not include open annotations unless `includeOpenAnnotations: true` is present. Requests with selected annotations or steering default `includeOpenAnnotations` to `true` unless explicitly set to `false`.
7. **Retry/redraft preserves the parent annotation snapshot.** Retrying a failed/cancelled turn or redrafting a needs-input turn uses the parent turn's snapshot instead of reading current annotations again. Redraft answers/steering remain in the existing `redraft` context.
8. **Apply-time resolution is tied to first successful apply.** The existing idempotent re-apply branch returns the previous applied result without rewriting the plan or changing annotation resolution timestamps.

## Files

### Create
- `eforge/extensions/eforge-plan/plan-revision-annotations.ts` — pure annotation helpers: open-state predicate, bounded snapshot assembly, selected/open ID validation, snapshot referenced-ID extraction, derived user-message text, and source/recent-turn projection helpers. Keep this file below 600 lines.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts` — focused tests for revision-index migration, annotation action handlers, turn snapshot/source text behavior, historical snapshot immutability, successful apply resolution, and non-resolution outcomes. Keep this test file below 1,200 lines.

### Modify
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add annotation constants, target/quote-context/annotation/snapshot schemas, annotation action input schemas, optional `annotationSnapshot` on `PlanRevisionTurnEntrySchema`, required `annotations` on `PlanRevisionSessionEntrySchema`, optional `annotations` on session projections, optional `annotationSnapshot` on turn projections, and extended `StartPlanRevisionTurnInputSchema` `[region: annotation-backend, plan revision annotation schemas and start-turn input extension]`.
- `eforge/extensions/eforge-plan/plan-revision-store.ts` — normalize legacy sessions to include `annotations: []`, create new sessions with `annotations: []`, order annotations deterministically, add annotation mutation helpers, enforce the per-session annotation cap, and extend `markPlanRevisionTurnApplied` with an option that resolves referenced annotations in the same write as applied metadata `[region: annotation-backend, annotation normalization and mutation helpers]`.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — register the five annotation actions, add their handlers, extend `start-plan-revision-turn` input handling and `startTurn` params, snapshot annotations before daemon task start, include snapshots on stored turns, copy parent snapshots on retry/redraft, include annotations in selected session projections, and call apply-time resolution only on successful patch-bearing applies `[region: annotation-backend, annotation action registration/start-turn/apply-time resolution]`.
- `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` — extend `buildPlanRevisionSourceText` params with optional annotation snapshot, include structured annotations/steering in the bounded source context, include a bounded annotation snapshot summary in fallback context, and include a bounded annotation snapshot summary in recent-turn context `[region: annotation-backend, revision source annotation context]`.
- `eforge/extensions/eforge-plan/index.ts` — add annotation action IDs to the planning workstation `allowedActions`; `planRevisionActions` registration continues to provide the actual action definitions `[region: annotation-backend, workstation allowedActions for annotation APIs]`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — add annotation action IDs to registration expectations, classify them as local-write actions, assert no daemon/build-queue side effects, and assert output schemas expose annotation target/snapshot fields through plan revision projections `[region: annotation-backend, registration assertions for annotation actions]`.

If temporary source coordination markers are used while implementing shared-file edits, use the compiled plan slug `plan-02-annotation-backend`, for example `// --- eforge:region plan-02-annotation-backend ---` and `// --- eforge:endregion plan-02-annotation-backend ---`.

## Implementation Details

### Schemas and persisted shapes

Add these schema-backed types in `planning-agent-task-schemas.ts`:
- `PlanRevisionAnnotationTargetKind`: `'selection' | 'block' | 'section' | 'whole-plan'`.
- `PlanRevisionAnnotationQuoteContext`: `{ exact: string; prefix?: string; suffix?: string }`.
- `PlanRevisionAnnotationTarget`: `{ kind; dimension?; label?; capturedText; quoteContext }`.
- `PlanRevisionAnnotation`: `{ annotationId; targetSession; body?; target; createdAt; updatedAt; resolvedAt?; resolvedByTurnId?; dismissedAt? }`.
- `PlanRevisionTurnAnnotationSnapshot`: `{ steering?; selectedAnnotationIds; openAnnotationIds; includeOpenAnnotations; annotations }` where each snapshot annotation includes `snapshotAt` and `snapshotReason: 'selected' | 'open' | 'selected-and-open'`.

Use these bounds unless implementation testing exposes a TypeBox issue:
- `MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION = 100`.
- `MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH = 4000`.
- `MAX_PLAN_REVISION_ANNOTATION_TEXT_LENGTH = 6000` for `capturedText` and `quoteContext.exact`.
- `MAX_PLAN_REVISION_ANNOTATION_CONTEXT_LENGTH = 1000` for `prefix` and `suffix`.
- `MAX_PLAN_REVISION_ANNOTATION_LABEL_LENGTH = 200` for `dimension` and `label`.
- `MAX_PLAN_REVISION_STEERING_LENGTH = 4000`.

Extend `StartPlanRevisionTurnInputSchema` so a request passes validation when it contains one of:
- `message`
- non-empty `annotationIds`
- non-empty `steering`
- `includeOpenAnnotations: true`

A handler-level check then rejects `includeOpenAnnotations: true` when no unresolved annotations exist and no message/steering is present.

### Store and normalization

Update `readPlanRevisionIndex` to normalize before schema validation:
1. Parse JSON.
2. If the root is not an object with `schemaVersion: 1` and `sessions: []`, return an empty index.
3. For each session object, add `annotations: []` when missing.
4. Validate the normalized value with `PlanRevisionIndexSchema`.
5. Return `orderIndex(validated)` or an empty index on validation failure.

Add store helpers with these semantics:
- `createPlanRevisionAnnotation(cwd, session, { body, target }, now)` ensures the session exists, checks the per-session cap, appends an annotation with `targetSession: session`, and updates session `updatedAt`.
- `updatePlanRevisionAnnotation(cwd, session, annotationId, patch, now)` updates only provided `body`/`target` fields and sets `updatedAt` on the annotation and session.
- `deletePlanRevisionAnnotation(cwd, session, annotationId)` removes the annotation from the session.
- `resolvePlanRevisionAnnotation(cwd, session, annotationId, now)` sets `resolvedAt` when absent and leaves `resolvedByTurnId` unset for manual resolution.
- `dismissPlanRevisionAnnotation(cwd, session, annotationId, now)` sets `dismissedAt` when absent.
- `markPlanRevisionTurnApplied(..., options?: { resolveReferencedAnnotations?: boolean })` records applied metadata and, when requested, sets `resolvedAt` and `resolvedByTurnId` on still-present annotations referenced by the turn snapshot that do not already have `resolvedAt` or `dismissedAt`.

### Action handlers

Each annotation action validates the flat session plan exists with `loadFlatPlanRevisionTarget(ctx.cwd, input.session)` before mutating annotation state. Mutation actions return `projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true })` so the caller receives the updated annotation list without full plan content.

Extend `projectSessionEntry` to accept projection options instead of a single boolean:
- `includePlan`
- `includeAnnotations`

Existing callers keep the same observable behavior: `get-plan-revision-session` defaults to plan data, `list-plan-revision-sessions` follows `includePlan`, and `start-plan-revision-session` returns plan data.

`startTurn` receives optional annotation input and uses `buildPlanRevisionAnnotationSnapshot` after `assertNoActiveTurn` and before `buildPlanRevisionSourceText`. The snapshot is added to:
- the durable `PlanRevisionTurnEntry`
- the source text params
- the start output `turn`

If durable turn recording fails after the daemon task starts, keep the existing task-cancel path.

### Source text

`buildPlanRevisionSourceText` adds an `annotationSnapshot` field to the `context` object when a snapshot exists. The field includes IDs, `includeOpenAnnotations`, steering text, and the copied annotation targets/body/timestamps. `boundedSourceText` already truncates long strings, and `revisionFallbackContext` must preserve at least:
- `annotationSnapshot.steering`
- selected/open counts
- selected/open IDs
- the first bounded annotation target summaries

`buildRecentRevisionTurnContext` includes a compact `annotationSnapshot` summary for turns that have one. Include counts and IDs plus bounded target labels/kinds/dimensions; do not include full captured text in recent-turn summaries.

### Apply-time resolution

In `applyPlanRevisionTurnAction`:
1. Keep all existing not-applicable checks before patch application.
2. Keep the existing idempotent branch when `storedTurn.appliedAt` is present.
3. After `applyRevisionPatchSections` succeeds, call `markPlanRevisionTurnApplied` with `resolveReferencedAnnotations: true` and the same timestamp used for `appliedAt`.
4. Return the existing `kind: 'applied'` payload.

This sequence leaves annotations unresolved when validation fails before patch application or when the task is not a completed patch-bearing plan revision result.

## Testing Strategy

### Unit Tests
- Add a revision-store migration test that writes a legacy index containing a valid session without `annotations`, then asserts `readPlanRevisionIndex` returns that session with `annotations: []` and existing turns preserved.
- Test `createPlanRevisionAnnotation`, `updatePlanRevisionAnnotation`, `resolvePlanRevisionAnnotation`, `dismissPlanRevisionAnnotation`, and `deletePlanRevisionAnnotation` through extension action dispatch.
- Test target persistence for `kind`, `dimension`, `capturedText`, and `quoteContext`.
- Test the per-session annotation cap by creating `MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION` annotations and asserting the next create action returns a handler error.
- Test snapshot helper behavior for selected-only, open-only, selected-and-open, dismissed annotations, resolved annotations, and missing selected IDs.
- Test derived user-message text for annotation-only requests and compatibility for manual `message` requests.

### Integration Tests
- Dispatch `start-plan-revision-turn` with selected annotations, open annotations, and steering. Assert the stored turn contains `annotationSnapshot`, the daemon task `sourceText.context.annotationSnapshot` contains the same annotation bodies/targets, and `sourceText.context.annotationSnapshot.steering` equals the request steering.
- Edit an annotation after a turn starts, then read the revision index and assert the stored turn snapshot still contains the original annotation body/target.
- Dispatch a successful patch-bearing `apply-plan-revision-turn` and assert referenced live annotations have `resolvedAt` and `resolvedByTurnId` equal to the applied turn ID.
- Dispatch a second apply for the same turn and assert `resolvedAt` remains the first apply timestamp.
- Dispatch answer-only, needs-input, failed, cancelled, mismatched-target, mismatched-fingerprint, duplicate-patch, and invalid-dimension apply attempts and assert referenced annotations have neither `resolvedAt` nor `resolvedByTurnId`.
- Dispatch an existing manual `{ session, message }` start request and assert no `annotationSnapshot` field appears on the stored turn or source context.
- Registration tests assert all five annotation actions are registered, workstation-allowed, and marked with local-write side effects without daemon-state or build-queue side effects.

## Verification

- [ ] `rg "create-plan-revision-annotation|PlanRevisionAnnotation" eforge/extensions/eforge-plan -g "*.ts" -g "!dist/**"` shows the new backend implementation and no duplicate pre-existing implementation paths.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
- [ ] A legacy revision index with a session missing `annotations` reads back with `annotations: []` and preserved turns.
- [ ] `start-plan-revision-turn` accepts `{ session, message }` and stores a turn without `annotationSnapshot`.
- [ ] `start-plan-revision-turn` accepts `{ session, annotationIds, includeOpenAnnotations: true, steering }` and stores `annotationSnapshot.annotations` with immutable copies of selected/open annotations.
- [ ] `buildPlanRevisionSourceText` output JSON contains `context.annotationSnapshot.annotations` and `context.annotationSnapshot.steering` for annotation-driven turns.
- [ ] Successful patch-bearing `apply-plan-revision-turn` sets `resolvedAt` and `resolvedByTurnId` on referenced unresolved annotations.
- [ ] Answer-only, needs-input, failed, cancelled, invalid-patch, mismatched-target, and mismatched-fingerprint apply attempts leave referenced annotations without `resolvedAt` and `resolvedByTurnId`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

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
