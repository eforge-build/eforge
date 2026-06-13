---
id: plan-03-preview-labels-and-docs
name: Preview Labels and Documentation
branch: detect-shipped-backlog-items-from-git-and-pr-history/plan-03-preview-labels-and-docs
agents:
  builder:
    effort: medium
    rationale: UI and documentation changes are straightforward once backend labels
      and evidence strings exist.
  reviewer:
    effort: medium
    rationale: Review focuses on visible wording and test coverage rather than new
      backend architecture.
---

# Preview Labels and Documentation

## Architecture Context

The backend and prompt now produce curation drafts whose evidence strings distinguish lifecycle-correlated shipped evidence from git/PR-inferred evidence, and whose generated recommendation model is filtered before apply. The workstation preview needs to surface those labels and identifiers before the user confirms apply, without implying the draft has already mutated backlog metadata.

This plan depends on `plan-02-analyze-all-evidence-integration`.

## Implementation

### Overview

Update the eforge-plan workstation preview and fixtures to display shipped evidence labels, PR identifiers, commit identifiers, ambiguous shipped needs-input labels, and filtered generated recommendation previews. Update README documentation to describe bounded git/PR evidence collection, fail-closed PR enrichment, preview labels, and same-draft recommendation filtering.

### Key Decisions

1. **Preview reads existing draft fields.** Do not add a new task-result wire shape. Parse/display labels from curation draft evidence and needs-input reason strings produced by the prompt.
2. **Draft language stays explicit.** Use “proposed” and “draft” wording for shipped status evidence until `entry.appliedAt` exists.
3. **Preview recommendation counts mirror apply.** The UI hides items proposed as shipped from generated recommendation counts/lists and surfaces a removed-target note.

## Scope

### In Scope

- Workstation preview label extraction for shipped lifecycle evidence, inferred git/PR evidence, PR ids, commit ids, and ambiguous shipped candidates.
- Workstation preview filtering for generated recommendations shown beside a curation draft.
- Mock fixture updates for shipped and ambiguous evidence examples.
- Frontend tests for labels, identifiers, compact rationale, draft wording, and filtered recommendation counts.
- README updates and contract test adjustments for analyze-all git/PR evidence behavior.

### Out of Scope

- Backend provider changes.
- New client/daemon route fields.
- Applying curation automatically.
- PR metadata caching.

## Files

### Create

- No new files expected unless the UI helper grows large; if so, create `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/curation-evidence-labels.ts` for parsing helpers and keep it under 300 lines.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — add evidence-label extraction, PR/commit identifier parsing, and generated-recommendation display filtering helpers.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — render `Shipped evidence: lifecycle trace`, `Shipped evidence: inferred from git/PR history`, `Ambiguous shipped candidate: needs input`, PR identifiers, commit identifiers, compact rationale, and filtered generated recommendation counts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add local display-only types if helper return values need shared names inside the workstation source.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — include one lifecycle shipped patch, one git/PR inferred shipped patch, one ambiguous needs-input candidate, and generated recommendations that originally referenced a proposed-shipped item.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — assert labels, PR/commit identifiers, rationale text, draft wording, ambiguous label, and filtered recommendation counts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.test.ts` — assert evidence parsing and recommendation display filtering if helpers are non-trivial.
- `eforge/extensions/eforge-plan/README.md` — document bounded git/PR evidence in analyze-all, fail-closed PR enrichment, preview labels, and same-draft recommendation filtering.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert the new README contract strings for bounded git/PR evidence and preview labels.

## Implementation Notes

- Prefer display helpers over schema changes. The curation draft schema already carries `evidence: string[]`, `rationale`, and `needsInput.reason`.
- Treat the exact evidence prefixes from plan 02 as stable display labels. If both lifecycle and inferred labels are present for one patch, render lifecycle first and then inferred evidence.
- Extract PR references with bounded regexes such as `PR #191`, `#191`, and `/pull/191`; extract commit references from 7- to 40-character hex strings when introduced by `commit` or `merge commit` wording.
- Recommendation preview filtering can use item ids from `draft.itemChanges` where `metadata.status === 'shipped'`; do not hide unrelated recommendation invalid-reference warnings.
- Ensure rendered copy says the preview is a proposed draft and not an applied metadata update unless `entry.appliedAt` is present.

## Verification

- [ ] Workstation preview test finds `Shipped evidence: lifecycle trace` for a lifecycle-evidence shipped patch.
- [ ] Workstation preview test finds `Shipped evidence: inferred from git/PR history`, a PR identifier, a commit identifier, and the patch rationale for an inferred shipped patch.
- [ ] Workstation preview test finds `Ambiguous shipped candidate: needs input` for an ambiguous candidate routed to `needsInput`.
- [ ] Workstation preview test verifies proposed-shipped item ids are absent from displayed `readyCandidates` and `recommendedNextSequence` counts.
- [ ] Workstation preview wording test verifies the shipped evidence section uses proposed/draft wording and does not say the item was applied when `entry.appliedAt` is absent.
- [ ] README contract test asserts analyze-all documentation mentions bounded git/PR history evidence, optional fail-closed PR enrichment, shipped-evidence preview labels, and same-draft recommendation filtering.