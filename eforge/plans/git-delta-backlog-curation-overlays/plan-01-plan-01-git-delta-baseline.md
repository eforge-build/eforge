---
id: plan-01-plan-01-git-delta-baseline
name: Add accepted-analysis baseline sidecar, bounded git-delta scanning,
  diagnostics, and source/fingerprint projection for analyze-all curation.
branch: git-delta-backlog-curation-overlays/plan-01-git-delta-baseline
---

# Git Delta Baseline

## Architecture Reference

This module implements the `plan-01-git-delta-baseline` module from the architecture, especially:

- **Shared data model / Accepted analysis baseline sidecar**
- **Shared data model / Git delta source projection**
- **Integration contracts / Baseline sidecar and git delta**
- The `plan-01-git-delta-baseline` portions of the **Shared File Registry**

Key constraints from architecture:

- Baseline metadata lives only in eforge-plan private extension storage under `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json`.
- Missing, invalid, unreachable, shallow, and no-git states produce explicit `gitDelta.diagnostics`; fallback coverage is never reported as complete.
- Git and optional `gh` collection are bounded by source-visible caps and subprocess timeouts.
- `buildBacklogCurationSource()` includes `gitDelta` in both the source JSON and the stable source-fingerprint projection.
- The source provider passes the enriched curation source through; it does not recompute or filter `gitDelta`.
- This module exposes baseline writer APIs for later apply/recommendation-refresh modules, but it does not call those writers from apply flows.
- Deterministic item/epic matching, affected-item candidate ranking, superseded classification, and evidence-prefix validation belong to downstream modules.

## Scope

### In Scope

- Create the accepted-analysis baseline sidecar schema, path helpers, read helper, write helper, and tests.
- Add bounded git-delta collection from the accepted baseline to `HEAD`, including current `HEAD`, scanned commits, caps, and diagnostics.
- Support fallback bounded recent-history scans for missing baseline, invalid sidecar, unreachable baseline, shallow repository, and no-git states.
- Capture optional PR metadata through existing `gh` enrichment with source-visible diagnostics and no required GitHub dependency.
- Add `gitDelta` to analyze-all curation source JSON, source text fallbacks, and source fingerprint projection.
- Add range-aware git history collection plumbing so curation source assembly can reuse the same git records for shipped-evidence collection.
- Preserve existing non-curation shipped-evidence behavior when no explicit git range/history is supplied.

### Out of Scope

- Populating `gitDelta.affectedItemCandidates` with deterministic item or epic matches.
- Classifying shipped, superseded, affected, or ambiguous evidence beyond exposing scanned commits and empty candidate-shell fields.
- Prompt wording and apply-time evidence-prefix validation.
- Preview/apply recommendation overlay behavior.
- Recording accepted baselines from `applyBacklogCurationDraftFromTask()` or recommendation-refresh apply call sites.
- Trace lifecycle/freshness semantics, workstation UI, and documentation updates.
- Any required GitHub authentication or broad GitHub dependency.

## Implementation Approach

### Overview

Add a focused `backlog-curation-git-delta.ts` module that owns baseline persistence and git-delta projection. The helper reads the current accepted-analysis baseline sidecar, resolves local git state, validates whether the baseline commit can provide complete coverage to `HEAD`, scans either the baseline range or bounded recent history, enriches PR metadata when available, and returns both the public `BacklogCurationGitDeltaSource` and internal git-history records for reuse by shipped-evidence collection.

`buildBacklogCurationSource()` will collect `gitDelta` once near the start of source assembly, pass its git history records into shipped-evidence collection, include a compact `gitDelta` projection in the source fingerprint, and retain `gitDelta` in compact/minimal source-text fallbacks. The deferred source provider remains a thin pass-through around `buildBacklogCurationSource()`.

### Key Decisions

1. **Sidecar schema stays private to eforge-plan.** Define the TypeBox schema and TypeScript types in `backlog-curation-git-delta.ts` instead of adding a public client schema. The sidecar is extension-private storage, and later modules can import the writer directly from the same package.
2. **Read APIs separate caller simplicity from diagnostic needs.** Export `readAcceptedAnalysisBaseline(cwd)` for consumers that only need the sidecar, and use an internal/read-result helper for `collectBacklogCurationGitDelta()` so invalid JSON or schema errors become `baseline-invalid-sidecar` diagnostics instead of thrown errors.
3. **Complete coverage requires a usable reachable baseline.** A recorded non-null baseline commit must exist locally, the repository must not be shallow, and `git merge-base --is-ancestor <baseline> <head>` must exit 0. Any failed condition switches to fallback coverage and emits a diagnostic.
4. **Scan with `cap + 1` to detect truncation.** The scanner requests one commit beyond `caps.commitScanCount`, slices output back to the cap, and emits `scan-cap-truncated` when extra commits exist.
5. **Use `execFile`, fixed argv arrays, and timeouts.** Do not invoke shell commands. Baseline commits from sidecars are schema-validated hex strings before use in revision ranges.
6. **Source fingerprint includes stable git-delta semantics.** Add `projectGitDeltaForFingerprint(gitDelta)` that includes baseline/current head, coverage, caps, scanned commit metadata, PR metadata, and diagnostic code/severity/commit, but excludes volatile raw error detail.
7. **Candidate shell remains empty in this module.** Return `affectedItemCandidates: []` until `plan-02-evidence-classification` adds deterministic matching and ranking.
8. **Existing shipped evidence remains backwards-compatible.** Add optional pre-collected git/PR inputs to shipped-evidence collection; if absent, current recent-HEAD scanning and PR enrichment behavior remain unchanged.

### Git-Delta Collection Flow

`collectBacklogCurationGitDeltaWithHistory({ cwd, caps, enrichPullRequests, signal })` returns:

- `gitDelta: BacklogCurationGitDeltaSource`
- `gitHistory: GitHistoryCollection` containing the same bounded records used to build `gitDelta.scannedCommits`
- optional PR enrichment metadata/diagnostics for reuse by shipped evidence

Collection steps:

1. Normalize caps with defaults and hard maxima.
2. Read and validate the baseline sidecar from `analysis-baseline/current.json`.
3. Check `git rev-parse --is-inside-work-tree`; unavailable or false returns `currentHead: null`, `coverage.kind: 'unavailable'`, zero scanned commits, and a `git-unavailable` diagnostic.
4. Resolve current `HEAD` with `git rev-parse HEAD` and `git show -s --format=%cI HEAD`.
5. Resolve baseline source:
   - no file: `baseline.source: 'missing'`, `baseline-missing` diagnostic, fallback scan;
   - invalid file/schema: `baseline.source: 'invalid-sidecar'`, `baseline-invalid-sidecar` diagnostic, fallback scan;
   - valid sidecar with `git.headCommit: null`: `baseline.source: 'unavailable'`, `baseline-missing` diagnostic, fallback scan when git is now available;
   - valid sidecar with commit: `baseline.source: 'accepted-analysis-sidecar'`.
6. Check shallow state with `git rev-parse --is-shallow-repository`; shallow repositories emit `baseline-shallow` and use fallback scans.
7. For non-shallow sidecars with a commit, validate `git cat-file -e <baseline>^{commit}` and `git merge-base --is-ancestor <baseline> <head>`.
8. Complete scans use `<baseline>..<head>`; fallback scans use recent commits reachable from `<head>`.
9. Map git history records into `gitDelta.scannedCommits` with bounded subject/body excerpts, merge subject, commit time, parents, merge flag, changed paths, branch hints, PR numbers, and bounded excerpts.
10. Optionally call existing `enrichPullRequests()` once for PR numbers in scanned commits; map successful metadata into each scanned commit's `pr` field and map failures to `pr-enrichment-unavailable` diagnostics.
11. Cap diagnostics with an internal constant and include `caps` in the source.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-curation-git-delta.ts` — accepted-analysis baseline schema/path/read/write helpers, git-delta caps/types, git subprocess helpers, range/fallback scan orchestration, PR enrichment projection, `collectBacklogCurationGitDelta()`, `collectBacklogCurationGitDeltaWithHistory()`, and `projectGitDeltaForFingerprint()`.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-git-delta.test.ts` — unit tests for sidecar read/write, missing/invalid sidecars, complete baseline range scans, bounded truncation, unreachable baseline fallback, shallow fallback, no-git diagnostics, and optional PR enrichment projection.

### Modify

- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — import git-delta helpers, add `gitDeltaCaps` to source-build options, collect git delta once, pass pre-collected git/PR inputs to shipped evidence, add `gitDelta` to fingerprint/source JSON, and retain `gitDelta` in minimal source-text fallback. `[region: plan-01-git-delta-baseline, imports/options plus gitDelta collection and source/fingerprint/minimal-fallback insertion]`
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — keep the provider as a pass-through around `buildBacklogCurationSource()` and allow the enriched source text containing `gitDelta` to flow to the daemon task.
- `eforge/extensions/eforge-plan/shipped-evidence-types.ts` — add range/scan input types and optional pre-collected git/PR inputs to `CollectShippedEvidenceInput` without changing existing required fields. `[region: plan-01-git-delta-baseline, near GitHistoryCollection and CollectShippedEvidenceInput definitions]`
- `eforge/extensions/eforge-plan/shipped-evidence-git.ts` — add range-aware collection entry points while preserving `collectGitHistoryRecords(cwd, caps, signal)` behavior for existing callers. `[region: plan-01-git-delta-baseline, range-aware git log argument construction and exported range collection helper]`
- `eforge/extensions/eforge-plan/shipped-evidence.ts` — consume optional pre-collected `gitHistory`/PR metadata before falling back to the existing recent-HEAD collection path. `[region: plan-01-git-delta-baseline, provider collect() git-history and PR-enrichment input plumbing]`
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — assert `gitDelta` appears in source/source text with baseline metadata, current `HEAD`, caps, scanned commits, diagnostics, and minimal fallback retention.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts` — assert the deferred analyze-all source provider emits source text containing `gitDelta` metadata.
- `eforge/extensions/eforge-plan/__tests__/shipped-evidence.test.ts` — cover range-aware git history collection and preservation of existing recent-HEAD behavior when no range/pre-collected history is supplied.

### Shared-File Registry Note

The architecture registry lists `shipped-evidence-types.ts` and `shipped-evidence-git.ts` for this module, but it does not list `shipped-evidence.ts`. This module needs a narrow `shipped-evidence.ts` plumbing edit to consume pre-collected git history and avoid a duplicate curation git scan. Proposed non-overlap boundary:

- `plan-01-git-delta-baseline` owns only the `input.gitHistory` / pre-enriched PR short-circuit in `shippedEvidenceProvider.collect()`.
- `plan-02-evidence-classification` owns candidate classification, evidence fields, superseded/affected intent, and ranking logic in the same file.

If the architecture is revised before implementation, add `shipped-evidence.ts` to the Shared File Registry with that boundary.

## Testing Strategy

### Unit Tests

- Baseline sidecar path resolves to `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json`.
- `writeAcceptedAnalysisBaseline()` writes schema version 1 and `readAcceptedAnalysisBaseline()` reads the same task id, pass kind, source fingerprint, accepted time, `HEAD`, coverage, and diagnostics.
- Invalid sidecar JSON/schema produces `baseline.source: 'invalid-sidecar'`, `coverage.kind: 'fallback'` when git is usable, and a `baseline-invalid-sidecar` diagnostic.
- Missing sidecar produces `baseline.source: 'missing'`, `coverage.kind: 'fallback'`, and a `baseline-missing` diagnostic.
- Complete baseline range scans include commits after the baseline and exclude the baseline commit.
- Range scans respect `commitScanCount`, `changedPathCount`, `excerptCount`, `excerptBytes`, `prEnrichmentCount`, and `subprocessTimeoutMs` caps.
- Unreachable baseline commits produce `coverage.kind: 'fallback'` and `baseline-unreachable` diagnostics.
- Shallow repositories produce `coverage.kind: 'fallback'` and `baseline-shallow` diagnostics.
- Directories outside git repositories produce `coverage.kind: 'unavailable'`, `currentHead: null`, zero scanned commits, and `git-unavailable` diagnostics.
- Range-aware shipped-evidence git collection preserves the old no-range recent-HEAD behavior.

### Integration Tests

- `buildBacklogCurationSource()` source JSON includes `gitDelta.baseline.commit`, `gitDelta.baseline.time`, `gitDelta.baseline.source`, `gitDelta.currentHead`, `gitDelta.scannedCommitCount`, `gitDelta.scannedCommits`, `gitDelta.caps`, and `gitDelta.diagnostics`.
- `buildBacklogCurationSource()` source text retains `gitDelta` in normal, compact, and minimal fallback forms.
- `sourceFingerprint` changes when new commits appear in the scanned git-delta range even when backlog item bodies do not change.
- Deferred source provider output from `buildSource()` parses as JSON containing `gitDelta`.
- Existing shipped-evidence source tests continue to see strong/ambiguous git-history candidates, PR metadata enrichment, PR fallback diagnostics, and weak-candidate omission.

## Verification

- [ ] `readAcceptedAnalysisBaseline()` returns `null` for a missing sidecar path.
- [ ] `writeAcceptedAnalysisBaseline()` creates `analysis-baseline/current.json` with `schemaVersion: 1`.
- [ ] `collectBacklogCurationGitDelta()` returns a `baseline-missing` diagnostic and `coverage.kind: 'fallback'` when no sidecar exists in a git repository.
- [ ] `collectBacklogCurationGitDelta()` returns `baseline.source: 'accepted-analysis-sidecar'` and `coverage.kind: 'complete'` when the sidecar commit is an ancestor of `HEAD` in a non-shallow repository.
- [ ] A complete scan with baseline `A` and later commits `B`, `C` returns scanned commit hashes for `B` and `C` and excludes `A`.
- [ ] A scan with `commitScanCount: 1` over two post-baseline commits returns one scanned commit and a `scan-cap-truncated` diagnostic.
- [ ] An invalid sidecar produces `baseline.source: 'invalid-sidecar'` and a `baseline-invalid-sidecar` diagnostic.
- [ ] An unreachable sidecar commit produces a `baseline-unreachable` diagnostic and `coverage.kind: 'fallback'`.
- [ ] A shallow repository produces a `baseline-shallow` diagnostic and `coverage.kind: 'fallback'`.
- [ ] A non-git directory produces `currentHead: null`, `scannedCommitCount: 0`, and a `git-unavailable` diagnostic.
- [ ] `buildBacklogCurationSource()` source JSON contains top-level `gitDelta` with baseline, current head, caps, scanned commits, coverage, diagnostics, and `affectedItemCandidates: []`.
- [ ] `JSON.parse(sourceText).gitDelta` exists for normal and minimal fallback source text.
- [ ] `sourceFingerprint` changes after a new scanned commit is added with no backlog body mutation.
- [ ] `collectShippedEvidence()` uses supplied pre-collected git history when present and uses recent `HEAD` history when absent.
- [ ] Targeted Vitest suites for git-delta/source/shipped-evidence pass.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
