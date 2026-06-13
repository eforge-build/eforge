---
title: Detect Shipped Backlog Items from Git and PR History
created: 2026-06-13
---

# Detect Shipped Backlog Items from Git and PR History

## Problem / Motivation

Analyze-all currently treats backlog item status as primarily a function of backlog metadata and known lifecycle traces. When implementation work lands through a PR or merge commit but the associated lifecycle trace is missing, incomplete, or not linked to the backlog record, the item can remain open and continue to appear in recommended-next output.

The triggering dogfood case was PR #191 / merge commit `bba403ca`, which landed interactive eforge-plan plan-revision sessions while the corresponding backlog item remained open and was still recommended. The gap is not lifecycle traces alone; analyze-all lacks an independent semantic/history evidence pass that can correlate open backlog text with merged PRs, branches, commits, and code/docs changes.

This creates duplicate planning work, reduces trust in curation, and forces users to manually remember which backlog proposals have already shipped. The core problem is not to auto-close more items; it is to give the curation draft enough ranked, cited evidence to propose shipped status only when the evidence is strong, while routing ambiguous matches to needs-input/skipped and removing proposed-shipped items from same-run recommendations.

## Goal

Enhance eforge-plan Analyze all backlog so curation can conservatively identify open backlog items that appear to have already shipped in reachable git or PR history, even when queue/run/lifecycle traces are missing.

The output should propose structured shipped-status patches only with durable, cited evidence and should prevent those same items from appearing in recommended-next sequences.

## Approach

Introduce a small evidence-provider layer used by analyze-all before the curation prompt/model is built. The provider should be deterministic, bounded, and testable behind a narrow interface so tests can feed real local git fixtures or hand-crafted history objects without mocking SDKs.

The evidence provider should produce compact, typed candidates with:

- `evidenceSource`: `lifecycle`, `git-history`, `pr-history`, or `combined`.
- The item id/title being considered.
- Matched PR number, PR title, and branch when available.
- Matched merge commit and commit subjects.
- Changed-path hints and short code/doc evidence excerpts.
- Confidence classification: `strong`, `ambiguous`, or `weak`.
- Citation strings suitable for `backlogCurationDraft` evidence.

Local git history should be the baseline evidence source. PR metadata should be optional enrichment using existing repository/GitHub access patterns if present, with timeouts and fail-closed behavior when CLI/API/authentication is unavailable. Analyze-all must still run without network access or GitHub authentication.

The local git collector should gather bounded evidence from reachable merge commits, commit subjects, short hashes, branch-ish hints where available, changed-path summaries, and grep-like title/slug matching. It should prefer recent reachable history and rank exact slug/title/branch matches before fuzzy semantic matches.

Evidence payloads must stay compact. Prefer identifiers, subjects, path summaries, and short excerpts over full diffs or long PR bodies. Apply hard caps to candidate PRs, commits, excerpts, candidate counts, excerpt sizes, and changed-path summaries.

Use conservative shipped inference rules:

- Strong evidence requires at least two independent signals, such as backlog slug or near-exact title appearing in a merged PR title/branch, plus a reachable merge commit, plus changed files that align with the item area.
- Strong evidence may also be inferred when lifecycle trace is missing but PR metadata explicitly references the backlog item id/slug and the merge commit is reachable from `HEAD` or a main-equivalent branch.
- Ambiguous evidence includes similar wording with no item id/slug, no branch/PR confirmation, or changes that are too broad to verify.
- Weak evidence includes commit-only fuzzy title similarity, stale closed PRs not reachable from the current branch, or unrelated path changes.
- Only strong evidence should produce `metadata.status = shipped` in a curation draft.
- Ambiguous evidence should become `needsInput` or skipped, with the candidate evidence cited.
- Weak evidence should stay out of the draft.

Lifecycle trace correlation should remain the highest-confidence source, but previews and rationale must distinguish lifecycle-correlated shipped evidence from git/PR-history inferred shipped evidence.

Implementation steps:

1. Locate analyze-all curation assembly in the eforge-plan integration and identify existing lifecycle trace and recommendation inputs.
2. Add a git/PR evidence collection module behind a narrow interface.
3. Implement local git history collection first.
4. Add optional PR metadata enrichment using existing repository/GitHub access patterns if present.
5. Merge evidence into the analyze-all curation context with explicit labels for lifecycle-correlated versus git/PR-inferred evidence.
6. Update curation prompt/schema instructions so shipped proposals require strong specific evidence, ambiguous matches go to `needsInput`/skipped, and recommendations exclude proposed-shipped items.
7. Update preview rendering to surface the evidence class and citations clearly before apply.
8. Add regression tests for recommendation filtering and the missing-lifecycle/reachable-PR scenario.

Expected code impact:

- eforge-plan analyze-all orchestration should add an evidence-collection step before the curation prompt/model request is assembled.
- The resulting compact candidates should be passed into both curation and recommendation filtering.
- Backlog curation context/prompt construction should be extended with typed shipped-evidence candidates and explicit labels for lifecycle, git-history, PR-history, and combined evidence sources.
- A git history access module should add a bounded local collector for reachable merge commits, commit subjects, short hashes, changed-path summaries, and candidate matching against item id/slug/title tokens.
- Optional PR metadata enrichment should integrate with existing repository/GitHub access patterns if present, with timeouts and fail-closed behavior.
- Matching/ranking utilities should centralize slug/title normalization, exact/near-exact matching, signal counting, confidence classification, and evidence citation formatting so the curation prompt and tests share the same semantics.
- Recommendation generation should filter recommended-next and ready-candidate outputs through a draft status overlay so any item proposed as shipped in the same curation draft is not recommended again.
- Preview/rendering surfaces in first-party integrations should show source, confidence, PR/commit identifiers, and compact rationale without implying the patch has already been applied.
- Tests should add fixtures or hand-crafted history records for reachable merged PR evidence, ambiguous title-only evidence, PR-unavailable fallback, context caps, and recommendation filtering.

The implementation should keep daemon/client route contracts unchanged unless existing analyze-all APIs need an explicit optional evidence field. Any new wire shape or shared type that crosses package boundaries should live in the owning shared package rather than being re-declared in consumers.

Assumptions:

- Analyze-all has access to the open backlog item corpus and can be extended to request a bounded shipped-evidence payload before generating the curation draft.
- The repository has local git history available from the working checkout.
- PR metadata may be unavailable, unauthenticated, rate-limited, or incomplete.
- Reachability from the current branch or configured main-equivalent is a meaningful proxy for shipped/landed work.
- Backlog item ids/slugs and titles are stable enough to serve as primary deterministic matching signals.
- Existing preview/apply validation remains the final safety gate.
- This feature only drafts proposed curation changes.

Open validation questions:

- Should PR metadata be fetched live, cached with a freshness TTL, or both?
- What final threshold or signal matrix should define strong versus ambiguous when PR/branch/title signals are strong but code-path evidence is weak?

## Scope

In scope:

- Add bounded git and optional PR-history evidence to analyze-all curation context for open backlog items.
- Correlate evidence against item title, slug/id, branch names, PR titles/bodies, merge commits, commit subjects, and compact code/docs signals.
- Distinguish lifecycle-correlated shipped evidence from git/PR-history inferred shipped evidence in previews and rationale.
- Classify ambiguous matches as needs-input or skipped, never automatic shipped changes.
- Exclude items proposed as shipped from generated recommendations in the same draft.
- Add tests covering a landed PR reachable from the current branch without lifecycle traces.
- Add focused tests for recommendation filtering and the missing-lifecycle/reachable-PR scenario.
- Add focused tests for ambiguous title-only evidence.
- Add focused tests for PR metadata unavailable fallback.
- Add focused tests for context bounding.
- Add focused tests for preview/model labeling.

Out of scope:

- Automatically applying shipped status without preview/validation.
- Replacing lifecycle trace correlation.
- Unbounded repository history ingestion.
- Large diff summaries.
- Requiring network access for analyze-all to work.

## Acceptance Criteria

- Analyze-all invokes a bounded shipped-evidence collection step for open backlog items before the curation prompt/model request is assembled.
- Analyze-all curation context includes bounded git/PR history evidence relevant to open backlog items.
- The evidence provider emits an `evidenceSource` value of `lifecycle`, `git-history`, `pr-history`, or `combined` for each shipped-evidence candidate.
- The evidence provider includes the item id or title being considered for each shipped-evidence candidate.
- The evidence provider includes matched PR number, PR title, and branch when those values are available.
- The evidence provider includes matched merge commit identifiers and commit subjects when those values are available.
- The evidence provider includes changed-path hints and short code/doc evidence excerpts when those values are available.
- The evidence provider includes a confidence classification of `strong`, `ambiguous`, or `weak` for each candidate.
- The evidence provider includes citation strings suitable for `backlogCurationDraft` evidence.
- The evidence provider caps candidate PRs, commits, and excerpts.
- The evidence provider prefers recent reachable history.
- The evidence provider ranks exact slug/title/branch matches before fuzzy semantic matches.
- The local git collector gathers reachable merge commits.
- The local git collector gathers commit subjects.
- The local git collector gathers short commit hashes.
- The local git collector gathers branch-ish hints when available.
- The local git collector gathers changed-path summaries.
- The local git collector performs bounded item id, slug, and title matching.
- Optional PR metadata enrichment fails closed to git-only evidence when PR metadata is unavailable.
- Analyze-all still runs when PR metadata is unavailable, unauthenticated, rate-limited, or incomplete.
- Analyze-all still runs without network access.
- Analyze-all does not ingest unbounded repository history.
- Analyze-all does not include full diffs in the model context.
- Analyze-all does not include oversized diff summaries in the model context.
- Curation proposes `metadata.status = shipped` only when evidence is strong, specific, and cited.
- Strong shipped evidence requires multiple reinforcing signals.
- A reachable merged PR title or branch match plus aligned changed files is classified as strong when the backlog slug or near-exact title also matches.
- PR metadata that explicitly references the backlog item id/slug plus a reachable merge commit is classified as strong when lifecycle traces are missing.
- Similar wording without an item id/slug, branch confirmation, or PR confirmation is classified as ambiguous.
- Changes that are too broad to verify are classified as ambiguous.
- Commit-only fuzzy title similarity is classified as weak.
- Stale closed PRs that are not reachable from the current branch are classified as weak.
- Unrelated path changes are classified as weak.
- Ambiguous matches are surfaced as `needsInput` or skipped, not shipped.
- Ambiguous matches include cited candidate evidence when surfaced.
- Weak matches do not produce shipped item changes.
- Collection errors do not block analyze-all.
- Unreachable commits do not produce shipped item changes.
- Over-broad matches do not produce shipped item changes.
- Partial evidence is not inflated into shipped status.
- Curation prompt/schema instructions require strong specific evidence for shipped proposals.
- Curation prompt/schema instructions route ambiguous matches to `needsInput` or skipped.
- Curation prompt/schema instructions prevent proposed-shipped items from being recommended in the same draft.
- Lifecycle-correlated shipped evidence is labeled separately from git/PR-history inferred shipped evidence in curation context.
- Preview distinguishes lifecycle-correlated shipped evidence from git/PR-history inferred shipped evidence.
- Preview includes the label `Shipped evidence: lifecycle trace` for lifecycle-trace shipped evidence.
- Preview includes the label `Shipped evidence: inferred from git/PR history` for inferred shipped evidence.
- Preview includes the label `Ambiguous shipped candidate: needs input` for ambiguous shipped candidates routed to needs input.
- Preview for inferred shipped items shows PR identifiers when available.
- Preview for inferred shipped items shows commit identifiers when available.
- Preview for inferred shipped items shows a compact rationale.
- Preview wording does not imply that a proposed curation patch has already been applied.
- Recommendation generation consumes the curation draft status overlay or explicitly filters shipped `itemChanges`.
- Recommendation generation excludes items proposed as shipped by the same curation draft.
- Recommended-next output excludes items proposed as shipped by the same curation draft.
- Ready-candidate output excludes items proposed as shipped by the same curation draft.
- A regression test verifies that an open item with no lifecycle traces but with a reachable merged PR/title/branch match is proposed shipped with evidence.
- A regression test verifies that the same proposed-shipped item is removed from `recommendedNextSequence` in the same draft.
- A regression test verifies that an ambiguous title-only match produces `needsInput` or skipped rather than shipped.
- A regression test verifies that PR metadata unavailable does not fail analyze-all.
- A regression test verifies that git-only shipped inference occurs only when git-only evidence satisfies the strong-evidence rule.
- A regression test verifies that evidence payload caps are honored.
- A regression test verifies that oversized diffs are not included in the evidence payload.
- A regression test verifies that preview/model labeling distinguishes lifecycle evidence from git/PR inferred evidence.
- A unit test validates normalization and matching for exact slug/id matches.
- A unit test validates normalization and matching for near-title matches.
- A unit test validates normalization and matching for branch-name matches.
- A unit test validates broad false positives.
- A unit test validates weak commit-only similarities.
- An integration-style analyze-all test verifies that an open item with no lifecycle trace and a reachable merged PR/merge commit with matching title or branch and relevant changed paths produces a shipped `itemChange` with evidence.
- A validation test verifies that candidate counts stay bounded.
- A validation test verifies that excerpt sizes stay bounded.
- A validation test verifies that changed-path summaries stay bounded.
- Tests cover an open item whose landed PR is reachable from the current branch but not linked by lifecycle traces.

## Manual Verification Notes

- Dogfood against the PR #191 / `bba403ca` scenario or an equivalent fixture to confirm the original failure mode no longer recommends an already-landed item.
- Manually review analyze-all preview wording to confirm it presents proposed curation patches without implying that backlog metadata was already updated.