---
id: plan-04-plan-03-prospective-overlay-apply
name: Build the shared prospective backlog/recommendation overlay used by
  preview and apply, add placement validation, and record accepted analysis
  baselines after explicit applies.
branch: git-delta-backlog-curation-overlays/plan-03-prospective-overlay-apply
---

# Prospective Overlay Apply

## Architecture Reference

This module implements the **One prospective projection**, **Prospective recommendation projection**, and **Apply, recommendation overlay, and baseline recording** sections from the architecture. It also implements the `plan-03-prospective-overlay-apply` portions of the Shared File Registry.

Key constraints from architecture:
- Preview, apply validation, and workstation display must consume one pure prospective recommendation projection; task result JSON is preserved and is not mutated to produce overlay behavior.
- Generated recommendations are evaluated against the prospective post-curation backlog state, not the pre-curation backlog state.
- Normal curation apply remains explicit and two-step; curation-only apply remains available and discards generated recommendations.
- Apply validation rejects unknown, closed, and wrongly placed generated recommendation references after the curation overlay is applied.
- Accepted analysis baseline metadata is recorded only after explicit accepted apply succeeds, and it stays in eforge-plan private extension storage through the plan-01 baseline writer APIs.
- Curation-only apply records an accepted `backlog-curation` baseline because the curation draft was accepted; manual `put-recommendations` does not record an analysis baseline.
- Recommendation-refresh baseline recording is limited to preserved `recommendation-refresh` workflow entries that carry a source fingerprint.
- Evidence-prefix validation for closed status patches is owned by `plan-02-evidence-classification`; this module must not weaken or bypass it.

## Scope

### In Scope
- Expand the recommendation overlay helper into a pure prospective projection builder.
- Build prospective item/epic reference records by applying curation draft metadata changes in memory.
- Filter closed item and epic recommendation targets after draft item/epic status changes.
- Reposition or exclude generated recommendation references for draft-proposed active/planned/status-changed items using explicit lane rules.
- Add placement validation for generated recommendation references after overlay.
- Return effective recommendation projection metadata from preview and apply results.
- Ensure normal apply validation and preview use the same `buildProspectiveCurationProjection()` result.
- Preserve raw generated recommendations in the task result while writing only the effective projection when generated recommendations are accepted.
- Record accepted analysis baseline sidecars after successful backlog-curation apply, including curation-only apply.
- Record accepted analysis baseline sidecars after successful recommendation-refresh apply from a preserved workflow entry with a source fingerprint.
- Add tests for overlay behavior, preview/apply parity, placement validation, curation-only behavior, and accepted baseline recording.

### Out of Scope
- Git-delta baseline schema, sidecar path helpers, git subprocess scanning, shallow/unreachable/no-git diagnostics, and PR enrichment collection owned by plan-01.
- Commit-to-item matching, shipped/superseded evidence classification, and evidence-prefix validation owned by plan-02.
- Recommendation freshness view derivation and active-versus-historical trace classification owned by plan-04.
- Workstation TypeScript interfaces, components, and local display changes owned by plan-05.
- README/workstation documentation updates owned by plan-06.
- Changes to direct `put-recommendations` lane semantics beyond existing reference validation.
- Unattended apply, scheduling, auto-enqueue, auto backlog draining, or writes to legacy `.backlog/recommendations.json`.

## Implementation Approach

### Overview

Replace the existing closed-target-only recommendation overlay with a pure prospective projection helper in `backlog-curation-recommendation-overlay.ts`. The helper will accept current backlog reference records, a parsed curation draft, and an optional generated recommendation model. It will derive prospective item/epic records in memory, filter closed recommendation targets, reposition draft status-change targets according to recommendation lane rules, validate the effective model, and return compact metadata for preview/apply/UI consumers.

`prepareBacklogCurationDraftApply()` will remain the single place that parses and validates curation drafts, applies in-memory markdown/frontmatter patches, and checks item dependency/epic references. After curation patch validation, it will call the projection helper once. `previewBacklogCurationDraftFromTask()` and `applyBacklogCurationDraftFromTask()` will both return data from that same prepared projection. Normal apply will write the effective recommendation model only when the projection validation is valid. Curation-only apply will apply backlog changes, skip recommendation writes, and still return the projection validation metadata.

Accepted baseline recording will be added through a small plan-03 helper that consumes the plan-01 writer and git-state collector. Curation apply will record `passKind: "backlog-curation"` only after backlog writes and recommendation write/status handling have succeeded. Recommendation-refresh task apply will record `passKind: "recommendation-refresh"` only after the generated recommendation model has been written and freshness status has been recorded for the workflow entry source fingerprint.

### Key Decisions

1. **One projection result is the apply contract.** `PreparedBacklogCurationApply` will carry a `recommendationProjection` object. Preview serializes it; normal apply validates it and writes its `effectiveRecommendations`; curation-only apply returns it without writing recommendations.
2. **The helper is pure and clone-based.** `buildProspectiveCurationProjection()` must not mutate the draft, current records, or generated recommendation model. Tests will deep-clone inputs before calls and assert byte-for-byte equality after calls.
3. **Projection applies recommendation-relevant metadata only.** The helper applies `metadata.status` from item/epic curation patches to reference records. Full markdown/body mutation remains in `backlog-curation-apply.ts`, where section operations and Evidence append rules already exist.
4. **Closed targets are removed before validation.** Items or epics closed by the same draft are removed from every generated recommendation target field before unknown/closed/wrong-lane validation runs.
5. **Lane repositioning is limited to draft-caused status changes.** The overlay may move an item proposed as `active` from ready/next/group/blocked-target lanes into `activeWork`, or move an item proposed as `planned` from `activeWork` into `readyCandidates`. Other wrong-lane references become validation issues rather than broad auto-rewrites.
6. **Wrong-lane validation is curation-overlay specific.** Direct recommendation writes keep existing unknown/closed reference validation. The stricter placement check is applied to generated recommendations from curation after the prospective overlay.
7. **Baseline writing is post-success and private.** This module never shapes sidecar JSON directly. It calls plan-01 exports and records only after accepted writes succeed. Manual recommendation puts and generic planner recommendation applies do not call the baseline recorder.
8. **Recommendation-refresh workflow entries become accepted analysis passes.** When `apply-planning-agent-task-result` applies recommendations for a preserved `recommendation-refresh` entry with `sourceFingerprint`, the module records a `recommendation-refresh` baseline and marks the workflow entry applied.
9. **No fallback UI recomputation.** Backend preview/apply outputs include effective recommendations, counts/summary, removed ids, repositioned ids, and validation. Plan-05 can display these fields without rebuilding overlay rules in the workstation.

### Prospective projection API

Implement the expanded helper in `backlog-curation-recommendation-overlay.ts` with exports shaped like:

```ts
// --- eforge:region plan-03-prospective-overlay-apply ---
export interface RecommendationReferenceRecord {
  id: string;
  kind: 'item' | 'epic';
  title?: string;
  slug?: string;
  status: string;
  lifecycleState?: string;
}

export interface RecommendationRepositionedTarget {
  itemId: string;
  from: string;
  to: string;
}

export interface ProspectiveCurationProjection {
  prospectiveItems: RecommendationReferenceRecord[];
  prospectiveEpics: RecommendationReferenceRecord[];
  effectiveRecommendations?: BacklogRecommendationModel;
  removed: { itemIds: string[]; epicIds: string[] };
  repositioned: RecommendationRepositionedTarget[];
  validation: RecommendationReferenceValidationResult;
  summary: RecommendationSummary | undefined;
}

export function buildProspectiveCurationProjection(input: {
  currentItems: readonly RecommendationReferenceRecord[];
  currentEpics: readonly RecommendationReferenceRecord[];
  draft: unknown;
  generatedRecommendations?: BacklogRecommendationModel;
}): ProspectiveCurationProjection;
// --- eforge:endregion plan-03-prospective-overlay-apply ---
```

The helper must also retain a compatibility export for existing tests/callers:

- `filterRecommendationsForCurationDraftStatusOverlay(model, draft)` can delegate to the new helper and return `{ recommendations, removed }` so dependent code that has not moved yet keeps compiling.

### Overlay lane rules

Use deterministic lane rules after applying draft metadata status changes:

- Closed item statuses (`shipped`, `stale`, `superseded`) remove item ids from `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy`.
- Closed epic statuses remove epic ids from `safeParallelizableGroups.epicIds`.
- Groups whose `itemIds` become empty are removed.
- Blocked chains whose `itemIds` become empty are removed.
- Draft-proposed `active` items are removed from `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, and `blockedChains.itemIds`; one `activeWork` entry is added or retained for each such item that appeared in those lanes.
- Draft-proposed `planned` items are removed from `activeWork`; one `readyCandidates` entry is added or retained for each such item that appeared only in `activeWork`.
- Draft-proposed `candidate` items are removed from `activeWork` and are not auto-added elsewhere unless they already appear in a ready/next/group lane.
- `blockedChains.blockedBy` keeps open active/planned/candidate blockers; closed blockers are removed and then validated if still present.
- Duplicate item refs introduced by repositioning are collapsed by `itemId` with the earliest original rationale/ref preserved.
- `rationaleAndAssumptions` receives one deterministic note when removals or repositioning occurred. The note lists sorted item/epic ids and does not include volatile timestamps.

### Placement validation rules

After overlay, collect validation issues with these rules:

- Unknown item/epic ids produce `reason: "unknown"`.
- Closed item/epic ids produce `reason: "closed"`.
- Empty safe-parallel groups produce `reason: "empty"`.
- `activeWork` item refs must point to prospective `status: "active"` or a prospective lifecycle state in `active`, `queue`, `build`, or `pr-open`; otherwise produce `reason: "wrong-lane"`.
- `readyCandidates`, `recommendedNextSequence`, and `safeParallelizableGroups.itemIds` must not point to prospective `status: "active"`; otherwise produce `reason: "wrong-lane"`.
- `blockedChains.itemIds` must not point to prospective `status: "active"`; otherwise produce `reason: "wrong-lane"`.
- `blockedChains.blockedBy` accepts any open item status.
- Validation issue messages include the path, target id, current prospective status, and the expected lane/status rule.

### Accepted baseline recording flow

Create a thin helper that adapts plan-01 git-delta APIs to apply call sites:

```ts
// --- eforge:region plan-03-prospective-overlay-apply ---
export async function recordAcceptedAnalysisBaselineForApply(cwd: string, input: {
  taskId: string;
  passKind: 'backlog-curation' | 'recommendation-refresh';
  sourceFingerprint: string;
  acceptedAt?: string;
}): Promise<void>;
// --- eforge:endregion plan-03-prospective-overlay-apply ---
```

Implementation details:
- Call the plan-01 git-delta collector or current-head helper to get `currentHead`, `coverage.kind`, and diagnostics. If git is unavailable, record `headCommit: null`, `headTime: null`, `coverage: "unavailable"`, and the returned diagnostics.
- Call `writeAcceptedAnalysisBaseline()` from `backlog-curation-git-delta.ts`; do not construct the sidecar path or JSON in this module.
- Use the draft `sourceFingerprint` for `backlog-curation` applies.
- Use the preserved workflow entry `sourceFingerprint` for `recommendation-refresh` applies.
- Do not record a baseline when the source fingerprint is missing.
- Do not record a baseline for direct `applyPlannerResult()` calls, generic planning-agent recommendation applies, or `put-recommendations`.

## Files

### Create
- `eforge/extensions/eforge-plan/backlog-curation-accepted-baseline.ts` — plan-03 adapter that records accepted analysis baselines through plan-01 read/write/collection APIs after accepted apply flows.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts` — focused tests for no-git baseline recording input, missing source-fingerprint skip behavior, and sidecar content written through the plan-01 reader.

### Modify
- `eforge/extensions/eforge-plan/backlog-curation-recommendation-overlay.ts` — replace the closed-target-only filter with `buildProspectiveCurationProjection()`, effective recommendation filtering/repositioning, curation-specific placement validation, summary construction, and compatibility delegation for `filterRecommendationsForCurationDraftStatusOverlay()`.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — call the projection helper from `prepareBacklogCurationDraftApply()`, return projection metadata from preview/apply, validate normal apply with the projection validation, write only `projection.effectiveRecommendations`, preserve curation-only apply behavior, and record the accepted `backlog-curation` baseline after successful writes. `[region: plan-03-prospective-overlay-apply, prepare/preview/apply projection usage and accepted-baseline recording; do not edit plan-02 validatePatchBasics evidence-prefix checks]`
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — extend recommendation validation issues with `reason: "wrong-lane"`; add backend schemas/types for the effective recommendation projection (`effectiveRecommendations`, `recommendationSummary`, `removed`, `repositioned`, `validation`); include the projection on preview/apply outputs while retaining `generatedRecommendationValidation` for compatibility. `[region: plan-03-prospective-overlay-apply, recommendation projection and wrong-lane schema fields]`
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — after successful `applyRecommendations` for a preserved `recommendation-refresh` workflow entry with `sourceFingerprint`, record the accepted `recommendation-refresh` baseline and mark that workflow entry applied; leave generic/direct recommendation apply behavior unchanged.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — add recommendation guidance telling the agent to generate recommendations against the prospective post-curation state, omit draft-closed targets, place draft-active items only in `activeWork`, and place draft-planned/candidate items in ready/next/group lanes rather than `activeWork`. `[region: plan-03-prospective-overlay-apply, Recommendation guidance prospective-state wording; do not edit plan-02 evidence-prefix guidance]`
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts` — replace/extend closed-filter tests with prospective projection tests for closed filtering, active/planned repositioning, wrong-lane validation, deterministic summaries, and input immutability.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — add preview/apply parity tests, curation-only projection tests, normal apply wrong-lane rejection tests, and accepted baseline sidecar assertions after curation applies.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — add recommendation-refresh apply tests proving preserved workflow entries record a `recommendation-refresh` baseline and generic recommendation applies do not.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — assert `preview-backlog-curation-task` exposes the same effective recommendation projection/validation shape used by apply.

### Shared-File Registry Notes

- `backlog-curation-apply.ts` is shared with plan-02. This module owns only projection usage, generated recommendation validation/write flow, and accepted-baseline recording. Plan-02 owns `validatePatchBasics()` evidence-prefix validation for shipped/superseded status changes.
- `backlog-curation-schemas.ts` is shared with plan-05. This module owns backend TypeBox schema/type additions; plan-05 owns workstation TypeScript interface and component consumption.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` is shared with plan-02. This module owns recommendation prospective-state wording in the Recommendation guidance section; plan-02 owns evidence prefixes and no-invented-evidence wording in Backlog curation guidance.
- `recommendation-status.ts` is shared by plan-03 and plan-04 in the architecture. This plan avoids freshness changes there. If implementation needs a local import/type adjustment, keep it outside plan-04 trace/freshness regions and do not change missing/fresh/stale derivation.

## Testing Strategy

### Unit Tests
- `buildProspectiveCurationProjection()` filters a draft-closed item id from `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy`.
- `buildProspectiveCurationProjection()` filters a draft-closed epic id from `safeParallelizableGroups.epicIds`.
- `buildProspectiveCurationProjection()` drops safe-parallel groups and blocked chains whose `itemIds` become empty.
- Draft-proposed active item references move from ready/next/group/blocked-target lanes into one `activeWork` entry.
- Draft-proposed planned item references move from `activeWork` into one `readyCandidates` entry.
- Projection output `removed.itemIds`, `removed.epicIds`, and `repositioned` arrays are sorted deterministically.
- Projection validation returns `wrong-lane` for a non-active item left in `activeWork` after overlay.
- Projection validation returns `wrong-lane` for an active item left in ready/next/group/blocked-target lanes after overlay.
- Projection validation returns `unknown`, `closed`, and `empty` issues with existing issue paths unchanged.
- The helper leaves the input recommendation model and draft unchanged.
- Accepted-baseline helper writes `schemaVersion: 1`, `taskId`, `passKind`, `sourceFingerprint`, `acceptedAt`, git coverage, and diagnostics that plan-01 `readAcceptedAnalysisBaseline()` returns.
- Accepted-baseline helper returns without writing a sidecar when `sourceFingerprint` is missing.

### Integration Tests
- `previewBacklogCurationDraftFromTask()` returns `recommendationProjection.effectiveRecommendations` matching the model later written by normal `applyBacklogCurationDraftFromTask()` for the same task.
- Normal curation apply rejects generated recommendations with a `wrong-lane` issue before backlog files or `current.json` change.
- Normal curation apply writes the effective recommendation model, not the raw task result model, after draft-closed targets are removed.
- Curation-only apply writes backlog changes, skips recommendation writes, returns `recommendationsSkipped`, returns the projection validation, and records a `backlog-curation` accepted baseline.
- Failed curation apply leaves the accepted analysis baseline sidecar absent.
- Successful normal curation+recommendations apply records a `backlog-curation` sidecar with the task id and draft source fingerprint.
- Successful recommendation-refresh task apply records a `recommendation-refresh` sidecar with the workflow entry source fingerprint and marks the workflow entry applied.
- Direct `applyPlannerResult()` recommendation apply and `put-recommendations` leave the analysis baseline sidecar absent.
- Prompt contract tests assert the recommendation guidance contains prospective post-curation state wording and lane placement wording.

## Verification

- [ ] `buildProspectiveCurationProjection()` removes `ship-me` from every item recommendation target field when the draft sets `metadata.status: "shipped"`.
- [ ] `buildProspectiveCurationProjection()` removes `closed-epic` from `safeParallelizableGroups.epicIds` when the draft sets `metadata.status: "superseded"` on that epic.
- [ ] `buildProspectiveCurationProjection()` moves `activate-me` into `activeWork` once when the draft sets `metadata.status: "active"` and the raw model lists it in ready/next/group lanes.
- [ ] `buildProspectiveCurationProjection()` moves `plan-me` out of `activeWork` and into `readyCandidates` when the draft sets `metadata.status: "planned"`.
- [ ] Projection validation emits `reason: "wrong-lane"` for `activeWork[0].itemId` when the prospective item status is `candidate`.
- [ ] Projection validation emits `reason: "wrong-lane"` for `readyCandidates[0].itemId` when the prospective item status is `active`.
- [ ] Preview output `recommendationProjection.effectiveRecommendations` deep-equals the recommendation model written by apply for the same task fixture.
- [ ] Normal curation apply rejects a wrong-lane generated recommendation before the target backlog markdown file bytes change.
- [ ] Curation-only apply returns `recommendationsSkipped.reason === "apply-curation-only"` and leaves `recommendations/current.json` absent for a task with generated recommendations.
- [ ] Normal curation apply writes `analysis-baseline/current.json` with `passKind: "backlog-curation"`, `taskId`, and the draft `sourceFingerprint`.
- [ ] Curation-only apply writes `analysis-baseline/current.json` with `passKind: "backlog-curation"`, `taskId`, and the draft `sourceFingerprint`.
- [ ] Failed curation apply leaves `analysis-baseline/current.json` absent.
- [ ] Applying a preserved recommendation-refresh task writes `analysis-baseline/current.json` with `passKind: "recommendation-refresh"`, `taskId`, and the workflow entry `sourceFingerprint`.
- [ ] Direct `applyPlannerResult()` with recommendations leaves `analysis-baseline/current.json` absent.
- [ ] `put-recommendations` leaves `analysis-baseline/current.json` absent.
- [ ] Targeted Vitest suites for overlay, curation apply, accepted baseline recording, planner orchestration, and prompt contracts exit 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

Suggested targeted commands:

```bash
pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts
pnpm type-check
pnpm maintainability:check
```

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
