---
id: plan-02-eforge-plan-annotation-revisions
name: Audit and close any remaining eforge-plan annotation-driven Revise with AI
  gaps in private storage, actions, source-context snapshotting, workstation UI,
  and tests while preserving existing extension-owned behavior.
branch: strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup/eforge-plan-annotation-revisions
---

# Eforge-plan Annotation Revisions

## Architecture Reference

This module implements the `Eforge-plan annotation revision contract` and `eforge-plan-annotation-revisions` sections from the architecture.

Key constraints from architecture:
- Keep annotation, revision-turn, transcript/index, preview/apply, and workstation state in the eforge-plan extension private storage path under `.eforge/storage/extensions/eforge-plan/`.
- Pass annotation snapshots as read-only source context to daemon-owned `eforge-plan.planning-draft` tasks; revision flows must not mark plans ready, hand off plans, enqueue builds, or mutate backlog records.
- Treat the existing annotation implementation as the baseline. Audit first, then use bounded edits only for unmet requirements.
- Use semantic target metadata and bounded quote context instead of durable DOM offsets.
- Resolve annotations only from the durable turn snapshot after a successful patch-bearing apply; answer-only, needs-input, failed, cancelled, mismatched, or invalid-patch turns leave annotations unresolved.
- Do not edit public core docs, recovery contracts, daemon/Console recovery UI, or trust cleanup code from this module.

## Scope

### In Scope
- Audit existing eforge-plan plan revision annotation storage, action schemas, action handlers, source-context snapshotting, workstation UI, and tests against the expedition acceptance criteria.
- Close annotation-related gaps in private revision storage normalization and persistence.
- Close annotation action gaps for selected/open annotation snapshots, steering text, one-running-turn enforcement, and non-kernel side-effect boundaries.
- Close source-context gaps in `buildPlanRevisionSourceText` or its fallback path so annotation snapshots remain structured and bounded.
- Close workstation gaps for selected text, block, section, and whole-plan annotation creation; unresolved annotation management; sticky annotation revision controls; and manual Revise with AI compatibility.
- Add targeted regression coverage for any gap found during the audit, with at least one new test asserting that patch-bearing apply resolves only referenced annotations.
- Update the eforge-plan README annotation section only if code changes alter documented annotation behavior.

### Out of Scope
- Public kernel-boundary documentation, nav, manifests, generated reference artifacts, and docs-boundary tests.
- Recovery event contracts, queue recovery preflight, daemon projections, and Console recovery UI.
- Removal of `extensions.trustProjectExtensions`.
- Moving annotation or revision state into engine, daemon, `@eforge-build/client`, or backlog storage.
- Adding plan-ready, handoff, enqueue, or backlog mutation behavior to revision flows.
- Regenerating workstation assets or public docs artifacts.

## Implementation Approach

### Overview

Use a gap-audit and hardening pass. Existing files already cover most annotation-driven Revise with AI behavior, so the builder must first run/read the current tests and inspect the relevant code paths before editing. Add missing regression tests before code changes when a behavior is not covered. Then make the smallest implementation edits needed for failing tests or uncovered acceptance criteria.

Recommended implementation sequence:

1. Run bounded searches for plan revision annotation symbols and confirm no annotation state lives outside eforge-plan private storage.
2. Run the focused runtime and workstation tests listed in the Verification section once dependencies are installed.
3. Add or tighten tests for missing coverage, especially referenced-only auto-resolution and bounded annotation source-context fallback.
4. Patch storage/action/source/UI code only for failing or uncovered cases.
5. Re-run focused tests, eforge-plan type-checks, and maintainability checks.
6. Edit `eforge/extensions/eforge-plan/README.md` only when behavior or action payload semantics change.

### Key Decisions

1. **Preserve the current design and close deltas only.** The architecture states that annotation-driven revisions are already substantially implemented. Rewriting storage, actions, or UI increases risk without changing module ownership.
2. **Use the stored turn snapshot as the apply-time authority.** Annotation resolution must derive from `turn.annotationSnapshot`, not from the live unresolved annotation list, so later edits cannot alter historical apply behavior.
3. **Keep source context JSON-structured and bounded.** Full snapshots can be sent while under the existing source-text budget; the fallback context must summarize annotation counts, selected/open IDs, target kind/dimension/label, and bounded previews when the full context exceeds the cap.
4. **Keep manual Revise with AI payloads separate.** Message-only revision requests must continue to call `start-plan-revision-turn` with `{ session, message }` and no annotation snapshot.
5. **Use workstation-frame selection APIs only.** Selection targets must be built from `window.getSelection()` inside the workstation app. Do not introduce parent Console selection APIs, parent DOM access, or durable DOM offsets.
6. **Do not touch generated assets.** The Vite bundle in `workstation-assets/` is generated and gitignored; this module changes source and tests only.

## Files

### Create
- None expected. Add a new focused test file only if the existing `plan-revision-annotations.test.ts` or workstation plan tests become too broad after the new cases.

### Modify
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — audit schema constants and TypeBox schemas for annotation target metadata, quote context, timestamps, resolution metadata, and turn snapshots; patch only if a required field is missing.
- `eforge/extensions/eforge-plan/plan-revision-store.ts` — audit private index normalization, annotation ordering, idempotent apply metadata, and referenced-annotation resolution; patch only if legacy sessions, scoped persistence, or referenced-only resolution fail tests.
- `eforge/extensions/eforge-plan/plan-revision-annotations.ts` — audit selected/open snapshot construction, deep-copy behavior, user-message derivation, and source/fallback snapshot summaries; patch only if source snapshots omit required metadata or mutate after turn creation.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — audit action validation, one-running-turn lock reuse, read-only daemon task start payloads, retry/redraft snapshot preservation, and apply side effects; patch only if annotation turns can enqueue builds, mark ready, hand off, mutate backlog state, or select closed annotations.
- `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` — audit `buildPlanRevisionSourceText`, recent-turn summaries, fallback annotation summaries, patch validation, and adapter-backed section apply; patch only if annotation context is omitted or can exceed the source-text cap without summary.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — mirror runtime annotation/revision projection fields in workstation types when schema changes require UI type updates.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-targets.ts` — audit selection, block, section, whole-plan target builders; patch only if targets include DOM offsets, miss quote context, exceed configured bounds, or use selection APIs outside `window.getSelection()`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-annotatable-section.tsx` — audit rendered-section controls and selection/focused-block wiring; patch only if selected text, block fallback, or section fallback creation fails.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — audit whole-plan annotation wiring and plan-lock behavior; patch only if whole-plan creation or revision lock state fails.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotations-panel.tsx` — audit unresolved annotation list, edit/delete/resolve/dismiss controls, sticky control count, steering input, selected/open payload construction, and disabled states; patch only if UI tests expose a gap.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` — audit bridge action payloads, auto-load, manual submit, annotation submit, auto-apply, and stale projection handling; patch only if manual payloads or auto-apply semantics regress.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-plan-revisions.ts` — keep mock workstation data aligned with any runtime projection field additions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — keep dev/mock bridge annotation action handling aligned with any action payload changes.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts` — add or tighten action/storage/source-context tests, including referenced-only annotation resolution after successful patch apply and no-resolution cases for answer-only, needs-input, failed, cancelled, mismatched, and invalid-patch turns.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts` — add store-specific migration or normalization tests only if the action-level tests do not cover a storage behavior.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts` — add action-level side-effect boundary tests only if new gaps are found in manual revision payloads, one-running-turn locking, or non-enqueue behavior.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action/schema registration expectations only if schemas or action IDs change.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-annotation-targets.test.ts` — add target-builder tests for bounded quote context, no DOM-offset fields, and workstation-frame selection behavior when coverage is missing.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-annotations.test.tsx` — add or tighten UI tests for selected text, block, section, whole-plan, unresolved-card controls, sticky controls, and running-turn disabled state.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx` — add or tighten hook tests for annotation payload trimming, manual payload compatibility, and auto-apply call count.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update source-asset contract assertions only if workstation file names, action IDs, or required source strings change.
- `eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts` — update README contract assertions only if the annotation workflow docs change.
- `eforge/extensions/eforge-plan/README.md` — update only behavior-specific annotation docs `[region: eforge-plan-annotation-revisions, ## Annotation revision workflow and direct plan-revision annotation action rows only]`.

## Testing Strategy

### Unit Tests
- `plan-revision-annotations.test.ts`: snapshot construction, deep-copy behavior, selected/open annotation validation, derived message text, source-context snapshot contents, bounded fallback summary, referenced-only annotation resolution, and no-resolution paths.
- `plan-revision-store.test.ts`: private storage path, malformed/legacy index fallback, session normalization with `annotations: []`, newest-first ordering, idempotent apply metadata, and resolved annotation metadata.
- `plan-revision-annotation-targets.test.ts`: quote context bounds, selected-text capture, outside-selection rejection, block/section/whole-plan targets, and absence of offset/selector/xpath fields.
- `plan-revision-annotation-view-model` coverage inside `plan-revision-annotation-targets.test.ts`: open annotation sorting, selected-ID synchronization, and sticky-control disabled reasons.

### Integration Tests
- `plan-revision-actions.test.ts` and `plan-revision-annotations.test.ts`: dispatch real eforge-plan extension actions through `dispatchExtensionAction` with hand-crafted daemon task records, then verify read-only planning task inputs, one-running-turn enforcement, retry/redraft snapshot preservation, adapter-backed section apply, and no build-queue calls.
- `use-plan-revision-session.test.tsx`: verify bridge payloads for manual and annotation-driven revision turns, auto-apply behavior, stale projection handling, and annotation mutation action inputs.
- `plan-detail-annotations.test.tsx`: render `PlanDetailCard` and verify selected text, block fallback, section fallback, whole-plan fallback, unresolved annotation controls, sticky revision payload, and running-turn disabled state.
- `registration.test.ts` and `workstation-assets.test.ts`: verify registered action schemas/IDs and workstation source references remain in sync after changes.

## Verification

- [ ] `pnpm exec vitest run eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
- [ ] `pnpm --dir eforge/extensions/eforge-plan/workstation-src/plans exec vitest run src/views/plans/plan-detail-annotations.test.tsx src/views/plans/plan-revision-annotation-targets.test.ts src/views/plans/use-plan-revision-session.test.tsx` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] A test creates at least two unresolved annotations, applies a patch-bearing turn that snapshots only one annotation, and asserts that only the snapshotted annotation receives `resolvedAt` and `resolvedByTurnId`.
- [ ] A test parses `sourceText` from `start-plan-revision-turn` and finds `annotationSnapshot.annotations[0].target.quoteContext.exact` plus target `kind` and `dimension` values.
- [ ] A workstation test creates a selected-text annotation using `window.getSelection()` and asserts no `create-plan-revision-annotation` call occurs for a selection outside the rendered section.
- [ ] A workstation test invokes block, section, and whole-plan annotation controls and asserts each action payload has the expected `target.kind`.
- [ ] A workstation test submits the sticky annotation control and observes `start-plan-revision-turn` with `annotationIds`, `includeOpenAnnotations`, and trimmed `steering`.
- [ ] A hook or UI test submits the manual Revise with AI form and observes `start-plan-revision-turn` with `{ session, message }` and no annotation fields.
- [ ] A runtime test or existing assertion verifies revision apply does not call `set-session-plan-ready`, `handoff-session-plan`, build queue enqueue, or backlog mutation actions.
- [ ] If README changes are made, `pnpm exec vitest run eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
