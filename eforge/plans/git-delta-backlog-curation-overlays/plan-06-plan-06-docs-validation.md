---
id: plan-06-plan-06-docs-validation
name: Update eforge-plan documentation for baseline storage, git-delta
  diagnostics, overlay-first apply behavior, and active-versus-historical trace
  semantics.
branch: git-delta-backlog-curation-overlays/plan-06-docs-validation
---

# Docs Validation

## Architecture Reference

This module implements the **Documentation updates**, **Preview/apply/UI parity**, **Recommendation freshness projection**, **Recommendation freshness and trace classification**, and **Private storage only** sections from the architecture. It also owns the `plan-06-docs-validation` documentation work listed in the Shared File Registry.

Key constraints from architecture:
- Documentation must describe accepted-analysis baseline metadata as private eforge-plan storage under `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json`, not backlog item bodies and not legacy recommendation files.
- Missing, invalid, unreachable, shallow, and no-git baseline states must be presented as diagnostic/fallback coverage states, not as complete git-delta coverage.
- Backlog curation preview/apply semantics must be documented as overlay-first: preview, apply validation, and workstation display consume the same prospective recommendation projection.
- Documentation must preserve existing safety guarantees: evidence sections are append-only, curation apply is explicit/two-step, curation-only apply remains available, and generated recommendations are private-extension-storage scoped.
- Trace documentation must distinguish historical audit rows from active work signals; submitted session-plan traces alone do not mark items active or planned.
- Workstation documentation must make the server preview/status payload authoritative for git-delta diagnostics, effective recommendation counts, removed/repositioned targets, validation issues, ambiguous needs-input evidence, and missing/fresh/stale freshness labels.

## Scope

### In Scope
- Update `eforge/extensions/eforge-plan/README.md` for accepted analysis baseline sidecar storage and write semantics.
- Document the analyze-all `gitDelta` source/output section: baseline commit/time/source, current `HEAD`, scanned commits, caps, diagnostics, coverage kind, optional PR enrichment, and deterministic affected-item evidence candidates.
- Document evidence-prefix rules for shipped and superseded closures and ambiguous shipped/superseded needs-input evidence.
- Replace same-draft closed-target filtering wording with overlay-first prospective recommendation projection wording.
- Document preview/apply parity: effective generated recommendations, closed-target removal, active/planned repositioning, unknown/closed/wrong-lane validation, raw result preservation, normal apply writes, and curation-only discard behavior.
- Document accepted-baseline recording after normal curation apply, curation-only apply, and preserved recommendation-refresh apply; document that manual `put-recommendations` does not create a git baseline.
- Update recommendation freshness documentation so missing/fresh/stale labels are derived by comparing stored fingerprints to current or prospective fingerprints and stale snapshots are not labeled fresh after backlog mutation or curation-only apply.
- Update trace/lifecycle documentation so session-plan, queue, build, PR, and landing rows are historical by default, with active state requiring live editable plan evidence, live queue/run/build evidence, current PR/landing evidence, or explicit active backlog status.
- Create workstation developer documentation under `eforge/extensions/eforge-plan/workstation-src/plans/` explaining server-authoritative curation preview data, git-delta diagnostics, effective recommendation projection display, freshness labels, and mock/test expectations.
- Add or update documentation contract tests that fail when README/workstation docs omit the new baseline, git-delta, overlay, freshness, or trace semantics.

### Out of Scope
- Runtime code changes for git-delta collection, evidence classification, prospective overlay, freshness derivation, trace classification, or workstation rendering.
- Backend TypeBox schema changes, action output changes, prompt changes, or source fingerprint algorithms.
- Public docs/reference regeneration beyond running the existing docs/check commands when required by final changes.
- Package version bumps, Pi package version changes, Claude Code plugin changes, or generated workstation asset commits.
- Any write to legacy `.backlog/recommendations.json`.

## Implementation Approach

### Overview

Perform a documentation-sync pass after dependency modules land. First inspect the final names and output fields introduced by plans 01-05, then update the extension README and add focused workstation developer documentation that matches the shipped contracts. Keep the README edits bounded to existing sections plus one focused curation subsection, because the file is already large and has existing contract tests tied to section text.

The README update will connect user-facing behavior to storage and apply semantics:

1. Storage model explains `analysis-baseline/current.json` separately from recommendation freshness status.
2. Usage/actions explain `analyze-all-backlog`, `apply-planning-agent-task-result`, and `refresh-recommendations` with git-delta and accepted-baseline semantics.
3. Recommendation freshness explains current/prospective fingerprint comparison and curation-only behavior.
4. A focused curation subsection explains `gitDelta`, evidence prefixes, ambiguous needs-input evidence, overlay-first recommendation projection, apply validation, and baseline recording.
5. Workstation and planning-boundary sections explain what the UI displays and which data remains server-authoritative.
6. Trace/lifecycle sections explain historical trace rows versus active evidence.

The workstation docs will be a developer-facing README next to the Vite app. It will tell future UI contributors to render server-provided `gitDelta`, `recommendationProjection`, and `recommendationFreshness` payloads without local git scanning, `gh` enrichment, recommendation overlay recomputation, or freshness inference from model presence.

### Key Decisions

1. **Document final shipped names, not planned placeholders.** During implementation, grep final exports/schemas such as `BacklogCurationGitDeltaSource`, `RecommendationFreshnessView`, `recommendationProjection`, `effectiveRecommendations`, and `wrong-lane`; if a dependency renamed a field, the docs and tests use the final field name.
2. **Keep baseline docs separate from recommendation status docs.** Recommendation freshness remains useful for staleness, but git-delta coverage comes from `analysis-baseline/current.json`; documenting them together without distinction recreates the stale-baseline failure mode.
3. **Use a curation workflow subsection instead of scattering all details.** Storage paths belong in Storage model, action summaries belong in Usage/Actions, but a dedicated curation subsection gives users one place to understand diagnostics, evidence prefixes, overlay projection, and apply outcomes.
4. **Treat workstation docs as developer contract docs.** The source Vite app currently has no local README; adding `workstation-src/plans/README.md` gives plan-05 UI contributors a nearby contract for server-owned preview data and avoids repeating backend details in component comments.
5. **Contract tests assert observable phrases and paths.** Tests verify concrete storage paths, status strings, diagnostic codes, exact evidence prefixes, field names, and action names rather than broad prose quality.
6. **Do not document unsupported automation as future behavior.** The non-goals remain explicit: no unattended curation apply, no auto-enqueue, no scheduling, no auto backlog draining, no required GitHub dependency, and no legacy recommendations writes.

## Files

### Create
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — developer-facing workstation contract for backlog curation preview data: server-owned `gitDelta`, `recommendationProjection`, `recommendationFreshness`, effective counts, removed/repositioned targets, wrong-lane validation, ambiguous needs-input evidence, mock bridge fixture expectations, and targeted workstation test commands.
- `eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts` — documentation contract tests for the new workstation README, including server-authoritative projection wording, no local git/gh/overlay/freshness recomputation, curation-only visibility, and targeted UI test command references.

### Modify
- `eforge/extensions/eforge-plan/README.md` — update install/storage/usage/action/workstation/trace/planning-boundary docs for baseline storage, git-delta diagnostics, evidence prefixes, overlay-first preview/apply, freshness derivation, and active-versus-historical traces. `[region: plan-06-docs-validation, bounded prose edits in Storage model, Recommendation freshness, Actions, Console and host surfaces, Trace sidecars, Lifecycle linkage, and Planning workstation boundary sections]`
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — replace legacy same-draft filtering assertions with overlay-first projection assertions; add assertions for analysis-baseline path, `gitDelta` metadata/diagnostics, accepted-baseline recording rules, shipped/superseded/ambiguous evidence prefixes, curation-only freshness semantics, and wrong-lane validation wording.
- `eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts` — extend package/privacy and mature workflow assertions for analysis-baseline private storage, no baseline writes from `put-recommendations`, optional PR enrichment/no broad GitHub dependency, and active-versus-historical trace semantics.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update README/workstation-source contract assertions that currently mention same-draft recommendation filtering so they assert server-provided effective recommendation projection, git-delta diagnostics, freshness labels, and ambiguous shipped/superseded needs-input labels instead. `[region: plan-06-docs-validation, README/source contract assertions only; no workstation runtime/source edits]`

### Shared-File Registry Notes

- `eforge/extensions/eforge-plan/README.md` is listed in the architecture Shared File Registry as owned by `plan-06-docs-validation`; this module may edit all relevant README documentation sections.
- `workstation-src/plans/README.md` is new and owned by this module. Architecture states workstation documentation under `workstation-src/plans/` is owned by `plan-06-docs-validation`.
- `workstation-assets.test.ts` is not listed in the architecture Shared File Registry, but plan-05 may add UI assertions in the same test file. This module's edits are limited to documentation/source-contract assertions and must not edit plan-05 component behavior assertions.
- No source marker examples are expected for Markdown-only changes. If implementation adds temporary coordination markers in test/source snippets, use the compiled cleanup slug:

```ts
// --- eforge:region plan-06-docs-validation ---
const WORKSTATION_README = 'eforge/extensions/eforge-plan/workstation-src/plans/README.md';
// --- eforge:endregion plan-06-docs-validation ---
```

## Detailed Documentation Updates

### README storage and baseline text

Add the baseline sidecar to the storage list:

- `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json` stores the schema-versioned accepted analysis baseline.
- The sidecar records `acceptedAt`, `taskId`, `passKind`, `sourceFingerprint`, `git.headCommit`, `git.headTime`, git coverage (`complete`, `fallback`, or `unavailable`), and diagnostics.
- It is written only after an explicit accepted curation/recommendation-refresh apply succeeds.
- Missing or no-git baseline states are recorded/loaded as diagnostics and fallback/unavailable coverage, not complete coverage.
- The sidecar is not encoded into backlog item or epic bodies, recommendation model JSON, or legacy `.backlog/recommendations.json`.

### README curation workflow text

Add or update prose that states:

- `analyze-all-backlog` source contains top-level `gitDelta` with `baseline.commit`, `baseline.time`, `baseline.source`, `currentHead`, `scannedCommitCount`, scanned commits, scan caps, coverage, diagnostics, and affected item candidates.
- Diagnostics include `baseline-missing`, `baseline-invalid-sidecar`, `baseline-unreachable`, `baseline-shallow`, `git-unavailable`, `git-command-failed`, `scan-cap-truncated`, and `pr-enrichment-unavailable`.
- Fallback scans are bounded recent-history scans and the UI labels their coverage as incomplete/fallback.
- Optional PR enrichment through `gh` can add PR title/body/file evidence, but local git evidence and diagnostics remain sufficient when `gh` is unavailable.
- Deterministic matching considers item ids, titles, slugs, changed paths, branch hints, PR numbers/titles/bodies/files, merge subjects, and bounded excerpts.
- Strong closed-status patches require exact evidence prefixes:
  - `Shipped evidence: lifecycle trace — `
  - `Shipped evidence: inferred from git/PR history — `
  - `Superseded evidence: lifecycle trace — `
  - `Superseded evidence: inferred from git/PR history — `
- Ambiguous closure evidence is routed to skipped/needs-input with exact prefixes:
  - `Ambiguous shipped candidate: needs input — `
  - `Ambiguous superseded candidate: needs input — `

### README overlay/freshness text

Replace same-draft filtering language with overlay-first language:

- Preview and apply validation both call the same prospective recommendation projection.
- The projection applies proposed item/epic status changes in memory, removes closed item/epic recommendation targets, repositions or excludes draft-active/planned/status-changed items according to lane rules, and validates unknown/closed/empty/wrong-lane references.
- Raw generated task output remains preserved as provenance; the effective projection is what preview displays and normal apply writes.
- Normal curation apply writes backlog records first, writes only the effective generated recommendation model after validation, records recommendation freshness against the post-curation fingerprint, and records the accepted analysis baseline.
- Curation-only apply writes backlog records, discards generated recommendations, returns projection metadata, records the accepted curation baseline, and does not mark discarded recommendations fresh.
- Recommendation-refresh apply records an accepted baseline only for preserved recommendation-refresh workflow entries with a source fingerprint; manual `put-recommendations` updates recommendation freshness but does not create a git baseline.
- Freshness labels come from comparison of stored recommendation/source fingerprint data against the current or prospective fingerprint; a present recommendation model without matching status is stale or missing, not fresh.

### README trace/lifecycle text

Update trace and board wording:

- Trace sidecars are durable historical audit records.
- Submitted, abandoned, completed, failed, stale, superseded, shipped, merged, and landed session-plan trace rows remain visible evidence but do not create active/planned state by themselves.
- Active state can come from a current editable session plan, live queue/PRD evidence, running build/run/session evidence, current PR-open/landing evidence, or explicit `active` backlog status.
- Queue/build rows with terminal status or `completedAt` remain historical.
- PR-open/started/running landing rows can indicate active work; landed/merged/auto-merged/shipped rows are terminal lifecycle evidence.

### Workstation README text

The new workstation README covers:

- The bridge/action boundary and why the iframe does not read private storage or call git/`gh`.
- Required preview payload fields displayed by the curation preview: `gitDelta`, `recommendationProjection`, `recommendationFreshness`, `generatedRecommendationValidation`, and draft rows.
- Rendering rules for baseline/head/coverage/diagnostics, effective recommendation counts, removed/repositioned metadata, validation issues including `wrong-lane`, and ambiguous shipped/superseded needs-input evidence.
- Freshness rendering rules for missing/fresh/stale states after backlog mutation, curation preview, curation-only apply, and normal curation+recommendations apply.
- Mock bridge/fixture obligations for local Vite development.
- Targeted commands for workstation docs/UI checks.

## Testing Strategy

### Unit Tests
- README contract tests assert the analysis-baseline sidecar path and storage fields.
- README contract tests assert `gitDelta` field names, diagnostic codes, coverage kinds, and bounded fallback behavior.
- README contract tests assert all four closed-status evidence prefixes and both ambiguous needs-input prefixes.
- README contract tests assert overlay-first projection terms: `prospective`, `effectiveRecommendations`, removed/repositioned targets, `wrong-lane`, and raw task result preservation.
- README contract tests assert curation-only apply records an accepted curation baseline but does not mark discarded generated recommendations fresh.
- README contract tests assert `put-recommendations` does not create an accepted-analysis git baseline.
- README contract tests assert submitted/historical session-plan traces do not create active/planned state without live evidence.
- Workstation docs tests assert no local git/`gh`/overlay/freshness recomputation wording and require server-owned preview fields.

### Integration Tests
- Targeted existing README/workstation asset tests pass with the updated curation wording.
- Workstation docs tests read the new source README and verify that developer commands and mock-fixture expectations match plan-05 UI behavior.
- Full project validation commands run after docs and tests are updated:
  - `pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts`
  - `pnpm type-check`
  - `pnpm maintainability:check`

## Verification

- [ ] `eforge/extensions/eforge-plan/README.md` contains `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json`.
- [ ] README text lists baseline sidecar fields `acceptedAt`, `taskId`, `passKind`, `sourceFingerprint`, `git.headCommit`, `git.headTime`, `coverage`, and `diagnostics`.
- [ ] README text states that baseline metadata is not stored in backlog item bodies, recommendation model JSON, or legacy `.backlog/recommendations.json`.
- [ ] README text states that `put-recommendations` does not create an accepted-analysis git baseline.
- [ ] README text names `gitDelta.baseline.commit`, `gitDelta.baseline.time`, `gitDelta.baseline.source`, `gitDelta.currentHead`, `gitDelta.scannedCommitCount`, scanned commits, scan caps, coverage, diagnostics, and affected item candidates.
- [ ] README text names the diagnostic codes `baseline-missing`, `baseline-invalid-sidecar`, `baseline-unreachable`, `baseline-shallow`, `git-unavailable`, `git-command-failed`, `scan-cap-truncated`, and `pr-enrichment-unavailable`.
- [ ] README text states that missing/unreachable/shallow/no-git baselines produce fallback or unavailable coverage labels.
- [ ] README text states that optional PR enrichment through `gh` is not required.
- [ ] README text contains all four closed-status evidence prefixes and both ambiguous needs-input prefixes.
- [ ] README text states that ambiguous shipped/superseded evidence goes to skipped or needs-input rather than status changes.
- [ ] README text replaces same-draft recommendation filtering with prospective overlay projection wording.
- [ ] README text states that preview and apply validation use the same prospective recommendation projection.
- [ ] README text states that normal curation apply writes only effective generated recommendations after overlay validation.
- [ ] README text states that curation-only apply records a curation baseline and leaves discarded generated recommendations unfresh.
- [ ] README text states that freshness is derived by comparing stored and current or prospective source fingerprints.
- [ ] README text states that submitted session-plan traces alone do not mark items active or planned.
- [ ] README text states that active state requires current editable plan, live queue/run/build, current PR/landing evidence, or explicit active backlog status.
- [ ] `eforge/extensions/eforge-plan/workstation-src/plans/README.md` exists.
- [ ] Workstation README text names `gitDelta`, `recommendationProjection`, `effectiveRecommendations`, `recommendationFreshness`, removed targets, repositioned targets, and `wrong-lane` validation.
- [ ] Workstation README text states that the iframe does not run local git commands, call `gh`, recompute recommendation overlay, or infer freshness from recommendation model presence.
- [ ] Workstation README text names missing/fresh/stale freshness labels and ambiguous shipped/superseded needs-input labels.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["doc-author", "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["docs", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
