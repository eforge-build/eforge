---
id: plan-03-plan-02-evidence-classification
name: Make shipped/affected evidence range-aware, add deterministic
  commit-to-item matching and superseded/ambiguous evidence classification, and
  enforce required evidence prefixes.
branch: git-delta-backlog-curation-overlays/plan-02-evidence-classification
---

# Evidence Classification

## Architecture Reference

This module implements the `plan-02-evidence-classification` module from the architecture, especially:

- **Core architectural principles / Deterministic evidence before prompting**
- **Shared data model / Git delta source projection** for `affectedItemCandidates`
- **Shared data model / Evidence prefixes**
- **Integration contracts / Git delta and shipped evidence**
- **Integration contracts / Evidence validation and prompt contract**
- The `plan-02-evidence-classification` portions of the **Shared File Registry**

Key constraints from architecture:

- Consume the range-aware git-delta output from `plan-01-git-delta-baseline`; curation source assembly must not perform a second unrelated recent-HEAD scan.
- Commit-to-item matching and evidence ranking run deterministically before the planning agent prompt.
- Matching considers item id, title, slug, changed paths, branch hints, PR number/title/body/files, merge subjects, and bounded excerpts.
- Strong shipped/superseded evidence may drive closed-status patches only when the patch evidence contains the required exact prefix for that status.
- Ambiguous evidence never justifies a status change; it is exposed to the agent as skipped/needs-input guidance with compact evidence.
- PR enrichment remains optional and bounded; no required GitHub dependency is introduced.
- Trace/lifecycle rows are consumed as projected evidence only; active-versus-historical trace semantics belong to `plan-04-trace-lifecycle-freshness`.
- Preview/apply recommendation overlay and accepted-baseline recording belong to `plan-03-prospective-overlay-apply`.

## Scope

### In Scope

- Add deterministic git-delta commit-to-item matching and ranking for open backlog items.
- Populate `gitDelta.affectedItemCandidates` from the plan-01 git-delta scan.
- Extend shipped evidence candidate modeling with shipped, superseded, affected, ambiguous-shipped, and ambiguous-superseded intents.
- Preserve existing shipped-evidence confidence rules while allowing superseded evidence when explicit superseded/obsolete/replaced lifecycle or git/PR evidence exists.
- Route ambiguous shipped/superseded matches into source context labels that instruct the agent to use `skipped` or `needsInput`.
- Project compact evidence strings, `matchedBy`, commit hashes, PR numbers, branch hints, changed paths, excerpts, and source labels into curation source JSON and fingerprint inputs.
- Update the planning-draft prompt with no-inventing-evidence guidance for git-delta candidates, superseded evidence prefixes, and ambiguous needs-input prefixes.
- Enforce status-specific evidence prefixes for shipped and superseded closed-status curation patches in apply validation.
- Add tests for matching signals, source projection, ambiguous evidence, superseded evidence, and prefix validation.

### Out of Scope

- Baseline sidecar storage, `HEAD`/baseline resolution, git subprocess range scanning, shallow/unreachable/no-git diagnostics, and PR enrichment collection owned by plan-01.
- Accepted baseline recording after apply and prospective recommendation overlay filtering/repositioning owned by plan-03.
- Active-versus-historical trace classification and recommendation freshness derivation owned by plan-04.
- Workstation UI rendering of git-delta diagnostics or ambiguous evidence owned by plan-05.
- README/workstation documentation updates owned by plan-06.
- Any unattended curation apply, auto-enqueue, scheduling, or required GitHub authentication.
- Any writes to `.backlog/recommendations.json`.

## Implementation Approach

### Overview

Add a focused deterministic classifier that consumes the plan-01 git-delta scan plus existing lifecycle trace summaries and backlog items. The classifier scores item matches, classifies closure intent (`shipped`, `superseded`, or non-closing `affected`), assigns confidence (`strong`, `medium`, `ambiguous`, or omitted/weak), and returns compact source projections.

`buildBacklogCurationSource()` will attach classifier results to `gitDelta.affectedItemCandidates` before source/fingerprint projection and will expose strong/ambiguous shipped/superseded candidates through the existing `shippedEvidenceCandidates` source section. Existing non-curation callers of `collectShippedEvidence()` continue to receive the prior recent-history behavior unless they pass plan-01 pre-collected git history.

Apply-time validation then rejects shipped/superseded patches that lack status-specific evidence prefixes. This provides a second guard after the prompt guidance: the agent can only request status closure with source-cited evidence, and invalid drafts fail before any backlog file write.

### Key Decisions

1. **Use one pure classifier as the curation evidence authority.** Create a helper that can be unit-tested with in-memory git records, PR metadata, lifecycle rows, and items. Source assembly calls this helper once with plan-01 git records.
2. **Keep existing shipped-evidence rules as the lower bound.** Existing `classifyConfidence()` outcomes for shipped candidates must not become more permissive. Superseded evidence gets its own explicit intent classifier and requires superseded/obsolete/replaced wording plus a deterministic item match.
3. **Use two-phase matching to bound excerpt work.** Cheap signals from commit/PR/lifecycle text and paths run first. File excerpts are collected only for preliminary candidate pairs that pass id/slug/title/branch/PR/path thresholds.
4. **Separate match evidence from closure intent.** A commit can match an item without proving shipped or superseded closure. Such candidates become `affected`/`medium` rather than shipped/superseded status-change suggestions.
5. **Model ambiguity explicitly.** Closure language with broad title-only, near-title-only, conflicting paths, or multiple similarly scored targets becomes `ambiguous-shipped` or `ambiguous-superseded` and is projected with the required ambiguous needs-input prefix.
6. **Validate prefixes by target status.** `metadata.status: "shipped"` accepts only shipped lifecycle or git/PR prefixes. `metadata.status: "superseded"` accepts only superseded lifecycle or git/PR prefixes. Ambiguous prefixes and the opposite closed-status prefix are rejected.
7. **Avoid client schema churn.** The curation source is planner input JSON, not a public daemon route schema. Ambiguous evidence goes into existing source fields and existing draft `skipped.reason` / `needsInput.reason` strings.
8. **Do not edit plan-01-owned git-delta implementation unless exports are missing.** If plan-01 does not export a concrete `BacklogCurationGitDeltaSource` type, use a local structural input type in the new classifier instead of modifying `backlog-curation-git-delta.ts`.

### Matching and Classification Details

Implement the classifier around these concepts:

- `matchedBy`: stable array entries from `item-id`, `item-title`, `item-slug`, `changed-path`, `branch-hint`, `pr-number`, `pr-title`, `pr-body`, `pr-file`, `merge-subject`, and `bounded-excerpt`.
- `intent`: `shipped`, `superseded`, `affected`, `ambiguous-shipped`, or `ambiguous-superseded`.
- `confidence`: `strong`, `medium`, or `ambiguous` for git-delta affected candidates; shipped-evidence candidates retain `strong`, `ambiguous`, and `weak` for compatibility.
- `evidence`: compact strings with one of these prefixes when projected for agent use:
  - `Shipped evidence: lifecycle trace — ...`
  - `Shipped evidence: inferred from git/PR history — ...`
  - `Superseded evidence: lifecycle trace — ...`
  - `Superseded evidence: inferred from git/PR history — ...`
  - `Ambiguous shipped candidate: needs input — ...`
  - `Ambiguous superseded candidate: needs input — ...`

Recommended classifier flow:

1. Normalize each item id/title into slugs and title tokens using existing matching helpers.
2. For each scanned commit, combine subject, body excerpt, merge subject, branch hints, changed paths, PR number/title/body/files, and plan-01 bounded excerpts into a bounded match text.
3. Compute initial match signals for every open item and discard pairs with no id/slug/title/branch/PR/path signal.
4. Collect file excerpts for surviving git-record/item pairs through `collectGitFileExcerpts()` with existing caps; rerun signal analysis with excerpt text.
5. Detect shipped intent from lifecycle landing/merged/shipped rows, merge subjects, PR-merged metadata, and shipped/landed/released/completed wording.
6. Detect superseded intent only from explicit superseded/obsolete/replaced/deprecated/removed-as-obsolete/no-longer-needed wording or lifecycle rows with `status: "superseded"`.
7. Classify strong closure evidence only when closure intent is present and deterministic match signals include item id/slug, explicit PR item reference, branch hint plus path/excerpt, or lifecycle affected item id.
8. Classify `affected` when match signals are deterministic but closure intent is absent.
9. Classify ambiguous closure candidates when closure intent is present but evidence is broad, path-conflicting, near-title-only, or tied across multiple items.
10. Sort by confidence, intent rank (`shipped`/`superseded`, then ambiguous closure, then affected), score, most recent commit time, item id, and citation for deterministic output.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-curation-evidence-classification.ts` — pure curation evidence classifier, git-delta affected candidate builder, intent detection, source/fingerprint projections, and bounded evidence formatting.
- `eforge/extensions/eforge-plan/backlog-curation-evidence-prefixes.ts` — exported exact prefix constants plus `validateClosedStatusEvidencePrefix(status, evidence)` helper used by apply validation and tests.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts` — unit tests for deterministic match signals, intent classification, ranking, affected candidates, superseded candidates, and ambiguous closure routing.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts` — unit tests for shipped/superseded lifecycle/git prefixes, opposite-status rejection, ambiguous-prefix rejection, missing evidence rejection, and stale-status non-prefix behavior.

### Modify

- `eforge/extensions/eforge-plan/shipped-evidence-types.ts` — add evidence intent, match-source, matched-by, affected candidate, optional preclassified candidate, and superseded evidence fields while preserving existing required fields. `[region: plan-02-evidence-classification, append classification/affected/superseded types near candidate interfaces]`
- `eforge/extensions/eforge-plan/shipped-evidence-matching.ts` — extend match analysis with matched-by derivation, PR number/title/body/file distinctions, merge-subject/bounded-excerpt signals, closure-intent helpers, and deterministic tie-break helpers.
- `eforge/extensions/eforge-plan/shipped-evidence-git.ts` — expose merge-subject and bounded-excerpt matching metadata consumed by the classifier without changing plan-01 range argument construction. `[region: plan-02-evidence-classification, excerpt/matching metadata helpers only]`
- `eforge/extensions/eforge-plan/shipped-evidence.ts` — classify shipped and superseded closure candidates, emit ambiguous closure candidates, keep weak omission behavior, and consume plan-01 pre-collected git history without touching the input short-circuit. `[region: plan-02-evidence-classification, provider candidate classification, evidence fields, intent labels, and ranking helpers; no edits to input.gitHistory plumbing]`
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — attach classifier output to `gitDelta.affectedItemCandidates`, include enriched `gitDelta` in source/fingerprint/minimal fallback, project intent/matchedBy/evidence labels in `shippedEvidenceCandidates`, and add source counts for affected/superseded/ambiguous candidates. `[region: plan-02-evidence-classification, shipped/affected evidence projection and ranking blocks]`
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — call `validateClosedStatusEvidencePrefix()` from `validatePatchBasics()` for `metadata.status` values `shipped` and `superseded`; keep existing append-only Evidence behavior. `[region: plan-02-evidence-classification, validatePatchBasics evidence-prefix checks]`
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — add git-delta affected candidate guidance, superseded prefixes, exact ambiguous prefixes, and no-inventing-evidence instructions. `[region: plan-02-evidence-classification, evidence prefix/invention guidance in Backlog curation guidance]`
- `eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts` — extend existing shipped-evidence tests for range-aware pre-collected records, superseded lifecycle/git/PR evidence, affected non-closing matches, ambiguous superseded matches, and stable ranking.
- `eforge/extensions/eforge-plan/__tests__/shipped-evidence-gap-regressions.test.ts` — add regression cases for false-positive prevention: broad title-only superseded wording, direct id with unrelated paths, stale/unreachable PR metadata, and ambiguous tie routing.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — assert `gitDelta.affectedItemCandidates` is populated from baseline-scanned commits, includes `matchedBy`, commit hashes, evidence prefixes, and ambiguous candidate labels in source text.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — add apply validation cases for missing/wrong shipped prefix, missing/wrong superseded prefix, ambiguous prefix rejection, lifecycle prefix acceptance, git/PR prefix acceptance, and stale closed-status evidence behavior.

### Shared-File Registry Notes

- `shipped-evidence.ts` is not in the architecture Shared File Registry, but plan-01 already identified it as a necessary shared plumbing file. This module must restrict edits to candidate classification, evidence fields, superseded/affected intent, labels, and ranking. Plan-01 owns the `input.gitHistory` / pre-enriched PR short-circuit.
- `trace-store.ts` and `lifecycle-projection.ts` are shared by plan-02 and plan-04 in the architecture. This module reads `TraceSummary`/`LifecycleLinkRow` projections only and must not edit those files.
- `backlog-curation-git-delta.ts` is plan-01-owned. This module enriches the `gitDelta` object in `backlog-curation-source.ts`; it must not move baseline read/write or git subprocess logic.

If code examples need temporary build-coordination markers, use the compiled plan slug:

```ts
// --- eforge:region plan-02-evidence-classification ---
export const SHIPPED_GIT_PR_EVIDENCE_PREFIX = 'Shipped evidence: inferred from git/PR history — ';
export const SUPERSEDED_GIT_PR_EVIDENCE_PREFIX = 'Superseded evidence: inferred from git/PR history — ';
// --- eforge:endregion plan-02-evidence-classification ---
```

## Testing Strategy

### Unit Tests

- `matchedBy` includes `item-id` for exact backlog id references in commit subject/body and PR body.
- `matchedBy` includes `item-title` for high token-score title matches and excludes broad-only title tokens.
- `matchedBy` includes `item-slug` for item id slug and title slug references.
- `matchedBy` includes `changed-path` when changed paths contain item-specific slug/title tokens.
- `matchedBy` includes `branch-hint` for merge subjects such as `owner/feature/<item-slug>`.
- `matchedBy` includes `pr-number`, `pr-title`, `pr-body`, and `pr-file` when optional PR metadata supplies each signal.
- `matchedBy` includes `merge-subject` for merge commit subjects and `bounded-excerpt` for file excerpts.
- Shipped classifier returns `strong` for reachable merge/lifecycle evidence with deterministic item match and aligned path or explicit PR item reference.
- Superseded classifier returns `strong` for explicit superseded/obsolete/replaced evidence with deterministic item match.
- Non-closing matched commits return `intent: "affected"` and never use shipped/superseded evidence prefixes.
- Broad title-only closure wording returns `ambiguous-shipped` or `ambiguous-superseded` with the matching ambiguous prefix.
- Multiple equal-score item matches for one closure commit return ambiguous candidates instead of strong closure candidates.
- Ranking order is stable for equal confidence/score inputs.
- Prefix helper accepts both shipped prefixes for shipped status and both superseded prefixes for superseded status.
- Prefix helper rejects shipped prefixes for superseded status, superseded prefixes for shipped status, ambiguous prefixes for either status, and whitespace-only evidence arrays.

### Integration Tests

- `collectShippedEvidence()` with pre-collected plan-01 git history uses those records and does not call the recent-HEAD collector path.
- `buildBacklogCurationSource()` emits `gitDelta.affectedItemCandidates` with baseline-scanned commit hashes and bounded evidence.
- `buildBacklogCurationSource()` includes strong shipped and superseded candidates in `shippedEvidenceCandidates` with exact evidence labels.
- `buildBacklogCurationSource()` includes ambiguous shipped/superseded candidates as needs-input labels and excludes weak candidates.
- Source fingerprint changes when `gitDelta.affectedItemCandidates` changes for the same backlog body state.
- Apply validation rejects shipped/superseded patches without the required status-specific prefix before any backlog file changes.
- Apply validation accepts shipped and superseded patches with lifecycle prefixes.
- Apply validation accepts shipped and superseded patches with git/PR prefixes.
- Apply validation rejects ambiguous-prefix evidence for shipped and superseded patches.
- Prompt contract test verifies the planning-draft prompt contains all four closure prefixes and both ambiguous prefixes.

## Verification

- [ ] `buildBacklogCurationSource()` returns `source.gitDelta.affectedItemCandidates.length > 0` for a baseline-scanned commit that references an open item id.
- [ ] A candidate from an item-id commit contains `matchedBy` with `item-id`.
- [ ] A candidate from an item-title commit contains `matchedBy` with `item-title`.
- [ ] A candidate from an item-slug commit contains `matchedBy` with `item-slug`.
- [ ] A candidate from aligned changed paths contains `matchedBy` with `changed-path`.
- [ ] A candidate from a merge branch hint contains `matchedBy` with `branch-hint`.
- [ ] A candidate from enriched PR metadata contains `matchedBy` entries for `pr-number`, `pr-title`, `pr-body`, and `pr-file` when each field matches.
- [ ] A candidate from a merge commit subject contains `matchedBy` with `merge-subject`.
- [ ] A candidate from a bounded file excerpt contains `matchedBy` with `bounded-excerpt`.
- [ ] Strong shipped git/PR evidence projects an evidence string that starts with `Shipped evidence: inferred from git/PR history — `.
- [ ] Strong shipped lifecycle evidence projects an evidence string that starts with `Shipped evidence: lifecycle trace — `.
- [ ] Strong superseded git/PR evidence projects an evidence string that starts with `Superseded evidence: inferred from git/PR history — `.
- [ ] Strong superseded lifecycle evidence projects an evidence string that starts with `Superseded evidence: lifecycle trace — `.
- [ ] Ambiguous shipped evidence projects an evidence string that starts with `Ambiguous shipped candidate: needs input — `.
- [ ] Ambiguous superseded evidence projects an evidence string that starts with `Ambiguous superseded candidate: needs input — `.
- [ ] `applyBacklogCurationDraftFromTask()` rejects a shipped patch whose evidence contains only a superseded prefix.
- [ ] `applyBacklogCurationDraftFromTask()` rejects a superseded patch whose evidence contains only a shipped prefix.
- [ ] `applyBacklogCurationDraftFromTask()` rejects a shipped or superseded patch whose evidence contains only an ambiguous prefix.
- [ ] `applyBacklogCurationDraftFromTask()` accepts a shipped patch with a shipped lifecycle or git/PR prefix.
- [ ] `applyBacklogCurationDraftFromTask()` accepts a superseded patch with a superseded lifecycle or git/PR prefix.
- [ ] A stale-status patch with non-empty evidence continues through validation without requiring shipped/superseded prefixes.
- [ ] Targeted Vitest suites for evidence classification, shipped evidence, curation source, apply validation, and prompt contract exit 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

Suggested targeted commands:

```bash
pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-prefixes.test.ts eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts
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
