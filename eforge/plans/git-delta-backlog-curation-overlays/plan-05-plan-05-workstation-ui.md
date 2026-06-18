---
id: plan-05-plan-05-workstation-ui
name: Surface git-delta diagnostics, effective recommendation overlay counts,
  ambiguous needs-input evidence, and truthful freshness labels in the planning
  workstation.
branch: git-delta-backlog-curation-overlays/plan-05-workstation-ui
---

# Workstation UI

## Architecture Reference

This module implements the **Preview/apply/UI parity**, **Recommendation freshness projection**, and workstation portions of the **Integration contracts** from the architecture.

Key constraints from architecture:
- The workstation displays server-provided effective recommendation projections; it must not locally reimplement curation overlay filtering or lane repositioning.
- Git-delta diagnostics and ambiguous needs-input evidence are rendered from server preview/source payloads without local git, PR, or evidence recomputation.
- Recommendation freshness labels come from the server-derived `RecommendationFreshnessView`/status payload and must never infer `fresh` from the mere presence of a recommendation model.
- Preview, apply validation, and UI display must agree on generated recommendation counts, removed targets, repositioned targets, and validation issues.
- Curation-only apply remains visible when generated recommendations are invalid; normal apply remains disabled for unknown, closed, empty, or wrong-lane references.
- This module owns only workstation TypeScript interfaces, view-model helpers, components, mock data, and workstation tests. Backend schema/runtime semantics are owned by dependency modules.

## Scope

### In Scope
- Add workstation types matching the plan-03 recommendation projection and plan-04 freshness view payloads.
- Add workstation types for compact git-delta diagnostics, coverage, baseline/head metadata, scan caps, scanned commits, and affected/ambiguous candidates as exposed by the preview/source payload.
- Replace the local same-draft recommendation filtering in the curation preview with server-provided effective recommendation projection data.
- Show effective generated recommendation counts, removed item/epic ids, repositioned item ids, and projection validation issues in the backlog curation preview.
- Show git-delta baseline/current head/coverage/scanned-count summary plus diagnostic messages in the backlog curation preview.
- Surface ambiguous shipped and ambiguous superseded needs-input evidence labels in curation preview rows.
- Display missing/fresh/stale recommendation freshness labels from server view data in recommendations, roadmap summary chips, and curation preview panels.
- Update workstation mock bridge/fixtures so local dev and tests exercise git-delta diagnostics, effective overlay counts, wrong-lane validation, freshness states, and ambiguous evidence.
- Add workstation view-model and component tests for stale freshness labels, git-delta diagnostics, effective recommendation counts/removals/repositioning, and ambiguous needs-input evidence.

### Out of Scope
- Backend TypeBox schema changes, action output shape changes, baseline sidecar storage, git scans, PR enrichment, and source fingerprint derivation.
- Commit-to-item matching, evidence ranking, and evidence-prefix validation.
- Active-versus-historical trace projection semantics.
- README or workstation documentation updates; plan-06 owns docs.
- Any local workstation git command, `gh` call, recommendation overlay recomputation, or backlog mutation.
- Changes to curation apply confirmation semantics beyond rendering the existing two-step controls.

## Implementation Approach

### Overview

Thread the new server preview/status payloads through the workstation data flow, then make curation preview rendering server-authoritative. `BacklogCurationPreview` will wait for `preview-backlog-curation-task` when list data does not already contain a preview, then render `curationPreview.recommendationProjection.effectiveRecommendations` rather than filtering raw task recommendations in the browser. The raw task result remains available only as provenance text; it is not used to compute displayed effective counts.

Add small presentation helpers for git-delta diagnostics and freshness labels. The git-delta panel formats baseline/current head metadata, coverage kind, scanned commit counts, caps, and diagnostics from the preview payload. The freshness label component formats the server-provided `RecommendationFreshnessView` state/reason/fingerprints and can be reused by curation preview, the recommendations panel, and the roadmap panel.

Update the workstation mock fixtures so local development mirrors the server contract expected from plan-03/plan-04: preview responses contain `recommendationProjection`, `recommendationFreshness`, and `gitDelta`; get-recommendations responses contain `recommendationFreshness`; invalid generated recommendations can include `reason: "wrong-lane"`.

### Key Decisions

1. **Server projection is the only effective recommendation source.** The UI removes `displayRecommendationsForDraft()` and related local closed-target filtering. Counts and display rows come from `curationPreview.recommendationProjection.effectiveRecommendations` after the preview payload loads.
2. **Raw recommendations are not silently relabeled effective.** While preview data is loading, the generated-recommendations section displays a validation/loading message instead of showing browser-filtered raw recommendations. If a legacy backend omits the projection, the preview displays a compact "effective projection unavailable" message and keeps normal apply disabled when validation is absent.
3. **Freshness state is server-authored.** Components render `RecommendationFreshnessView.state` when present, then fall back to existing `RecommendationStatus.state` for compatibility. They no longer default a present recommendation model to `fresh` when no server status exists.
4. **Diagnostics are compact and deterministic.** Git-delta diagnostics are sorted warnings before info, then by code/message/commit. Commit ids and fingerprints are abbreviated in labels with full values in `title` attributes.
5. **Evidence label parsing includes superseded.** `curationEvidencePreview()` recognizes all six prefixes from plan-02 and exposes shipped, superseded, and ambiguous needs-input labels without treating ambiguous labels as closure proof.
6. **Roadmap and recommendations panels share freshness copy.** A shared formatter/component keeps missing/fresh/stale wording consistent after backlog mutation, preview, curation-only apply, and normal apply reloads.
7. **Backward-compatible optional fields.** New UI types mark plan-03/plan-04 fields optional so the workstation still renders older task records, but tests cover the new fields as the expected path.

### Type shape expected by this module

The workstation type additions should mirror backend fields owned by plan-03 and plan-04. If implementation names drift in dependency modules, update these interfaces to the final backend names rather than adding a second UI-only shape.

```ts
// --- eforge:region plan-05-workstation-ui ---
export interface RecommendationFreshnessView {
  state: 'missing' | 'fresh' | 'stale';
  reason: string;
  storedSourceFingerprint?: string;
  comparedSourceFingerprint: string;
  baselineTaskId?: string;
}

export interface BacklogCurationRecommendationProjection {
  effectiveRecommendations?: RecommendationModel;
  summary?: RecommendationSummary;
  removed: { itemIds: string[]; epicIds: string[] };
  repositioned: Array<{ itemId: string; from: string; to: string }>;
  validation: RecommendationReferenceValidationResult;
}

export interface BacklogCurationPreviewDetails {
  valid: boolean;
  recommendationProjection?: BacklogCurationRecommendationProjection;
  recommendationFreshness?: RecommendationFreshnessView;
  gitDelta?: BacklogCurationGitDeltaPreview;
  generatedRecommendationValidation?: RecommendationReferenceValidationResult;
  errors?: BacklogCurationPreviewValidationError[];
}
// --- eforge:endregion plan-05-workstation-ui ---
```

## Files

### Create
- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/recommendation-freshness.tsx` — reusable badge/line formatter for `RecommendationFreshnessView` plus compatibility display for existing `RecommendationStatus`; used by recommendations, roadmap, and curation preview.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-git-delta-panel.tsx` — compact curation preview panel for git-delta baseline/head metadata, coverage, scanned commit count, caps, diagnostics, and affected/ambiguous candidate counts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/components/recommendation-freshness.test.tsx` — component tests for missing/fresh/stale states, reason text, fingerprint abbreviation, and no `fresh` fallback when status is absent.

### Modify
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add `RecommendationFreshnessView`, `RecommendationSummary`, `BacklogCurationRecommendationProjection`, compact git-delta preview/candidate/diagnostic types, `wrong-lane` validation reason, preview/apply projection fields, and `GetRecommendationsResponse.recommendationFreshness`. `[region: plan-05-workstation-ui, TypeScript interface additions matching plan-03/plan-04 backend output and no backend schema edits]`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — store `recommendationFreshness` from `get-recommendations`, pass it through `WorkstationDataState`, and keep it in sync after refresh/apply reloads.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.tsx` — pass `recommendationFreshness` to `RoadmapPanel` and `BacklogView`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — accept `recommendationFreshness` and pass it to `RecommendationsPanel`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx` — render freshness state/reason with the shared freshness component; remove the `recommendations ? 'fresh' : 'missing'` fallback and use server state only.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.tsx` — render the roadmap summary recommendation chip from `RecommendationFreshnessView` when available and pass freshness into refresh-disabled copy.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-view-model.ts` — update refresh status inputs to accept freshness view data without deriving freshness from model presence.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — replace local same-draft overlay/filter helpers with server projection selectors/count helpers; extend evidence parsing for shipped, superseded, ambiguous shipped, and ambiguous superseded prefixes; add deterministic formatting helpers for removed/repositioned projection metadata. `[region: plan-05-workstation-ui, replace local overlay helpers with server projection formatting and evidence label extraction]`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — render `BacklogCurationGitDeltaPanel`, freshness label, effective recommendations from `recommendationProjection`, projection removed/repositioned summaries, and wrong-lane validation messages; keep normal apply disabled when projection validation is invalid.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — pass the enriched `backlogCurationPreview` through unchanged; no local projection logic.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add mock `RecommendationFreshnessView` objects, mock git-delta diagnostics, mock effective curation recommendation projection, wrong-lane validation issue fixture, and ambiguous superseded needs-input fixture.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — return the enriched mock curation preview from `preview-backlog-curation-task` so dev mode and lazy preview loading exercise the new panels.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — assert `recommendationFreshness` is loaded from `get-recommendations` and survives refresh reloads.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.test.ts` — replace local overlay filtering assertions with server projection count/removed/repositioned assertions and superseded/ambiguous evidence-label assertions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — add component coverage for git-delta diagnostics, effective recommendation counts, removed/repositioned projection text, wrong-lane validation text, freshness labels, and ambiguous needs-input labels.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.test.tsx` — extend missing/fresh/stale tests to pass `RecommendationFreshnessView`, assert the reason/fingerprint line, and assert recommendations without server status are not labeled fresh.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.test.tsx` — assert roadmap summary chip and refresh controls render the server freshness state for missing/fresh/stale inputs.

## Testing Strategy

### Unit Tests
- Freshness component renders `missing`, `fresh`, and `stale` badges from `RecommendationFreshnessView.state` and displays `reason` text.
- Freshness component abbreviates stored and compared fingerprints while preserving full fingerprints in `title` attributes.
- Freshness component renders no `fresh` badge when both `RecommendationFreshnessView` and `RecommendationStatus` are absent.
- Curation view-model evidence parsing returns labels for shipped lifecycle, shipped git/PR, superseded lifecycle, superseded git/PR, ambiguous shipped, and ambiguous superseded prefixes.
- Curation view-model projection helper returns counts from `recommendationProjection.effectiveRecommendations` and not from raw task recommendations.
- Curation view-model projection helper returns sorted removed item ids, removed epic ids, and repositioned item descriptions from server metadata.
- Git-delta panel formatter sorts warning diagnostics before info diagnostics and abbreviates commits/head hashes deterministically.

### Integration / Component Tests
- `BacklogCurationPreview` displays baseline commit/time/source, current `HEAD`, coverage kind, scanned commit count, scan caps, and each git-delta diagnostic from `curationPreview.gitDelta`.
- `BacklogCurationPreview` displays generated recommendation counts from `recommendationProjection.effectiveRecommendations` and does not display raw recommendation counts after effective preview data is present.
- `BacklogCurationPreview` displays removed item/epic ids and repositioned item ids from `recommendationProjection` metadata.
- `BacklogCurationPreview` displays `wrong-lane` validation issues and keeps normal confirm disabled when projection validation is invalid.
- `BacklogCurationPreview` displays ambiguous shipped and ambiguous superseded needs-input evidence labels from draft `needsInput` rows.
- `RecommendationsPanel` displays missing/fresh/stale state, reason text, and source fingerprint drift details from server freshness/status payloads.
- `RecommendationsPanel` with recommendations but no server freshness/status displays no `fresh` badge.
- `RoadmapPanel` summary chip changes among missing/fresh/stale based on the supplied server freshness view.
- `useWorkstationData` maps `get-recommendations.recommendationFreshness` into state after initial load and after `refreshRecommendations()` reloads.

Suggested targeted commands:

```bash
pnpm test -- eforge/extensions/eforge-plan/workstation-src/plans/src/components/recommendation-freshness.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.test.ts eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx
pnpm --filter @eforge-build/eforge-plan-workstation type-check
pnpm maintainability:check
```

## Verification

- [ ] `BacklogCurationPreview` renders a `baseline-missing` diagnostic message when `curationPreview.gitDelta.diagnostics` contains that code.
- [ ] `BacklogCurationPreview` renders a `baseline-unreachable` diagnostic message when `curationPreview.gitDelta.diagnostics` contains that code.
- [ ] `BacklogCurationPreview` renders `coverage fallback` when `curationPreview.gitDelta.coverage.kind === 'fallback'`.
- [ ] `BacklogCurationPreview` renders the scanned commit count from `curationPreview.gitDelta.scannedCommitCount`.
- [ ] `BacklogCurationPreview` renders effective generated recommendation counts from `curationPreview.recommendationProjection.effectiveRecommendations`.
- [ ] `BacklogCurationPreview` renders removed item ids from `curationPreview.recommendationProjection.removed.itemIds`.
- [ ] `BacklogCurationPreview` renders removed epic ids from `curationPreview.recommendationProjection.removed.epicIds`.
- [ ] `BacklogCurationPreview` renders repositioned item ids from `curationPreview.recommendationProjection.repositioned`.
- [ ] `BacklogCurationPreview` does not call any local helper that filters recommendation ids by draft status.
- [ ] `BacklogCurationPreview` displays `Ambiguous shipped candidate: needs input` for matching draft needs-input evidence.
- [ ] `BacklogCurationPreview` displays `Ambiguous superseded candidate: needs input` for matching draft needs-input evidence.
- [ ] `BacklogCurationPreview` displays `wrong-lane` validation issue labels and disables the normal confirm button for invalid projection validation.
- [ ] `RecommendationsPanel` displays `missing` when the server freshness view state is `missing`.
- [ ] `RecommendationsPanel` displays `fresh` when the server freshness view state is `fresh`.
- [ ] `RecommendationsPanel` displays `stale` when the server freshness view state is `stale`.
- [ ] `RecommendationsPanel` with a recommendation model and no server freshness/status does not display a `fresh` badge.
- [ ] `RoadmapPanel` displays `recommendations missing`, `recommendations fresh`, and `recommendations stale` chips for the three server freshness states.
- [ ] `useWorkstationData()` exposes `recommendationFreshness.state` from `get-recommendations` after initial load.
- [ ] `useWorkstationData().refreshRecommendations()` reloads `recommendationFreshness.state` from the post-refresh `get-recommendations` response.
- [ ] Targeted workstation Vitest suites listed above exit 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
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
