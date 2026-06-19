---
id: plan-02-full-audit-evidence
name: Bounded Full Implementation Audit Evidence
branch: add-full-implementation-audit-mode-to-backlog-curation/plan-02-full-audit-evidence
agents:
  builder:
    effort: high
    thinking:
      type: adaptive
    rationale: Adds a new bounded evidence collector that must coordinate
      current-state search, lifecycle traces, git/PR classifiers, source
      fingerprints, and planner guardrails without creating false-positive
      closure paths.
  reviewer:
    effort: high
    rationale: Review must inspect evidence confidence, caps, diagnostics,
      determinism, and conservative closure semantics.
  tester:
    effort: high
    rationale: Evidence behavior needs repository-fixture tests for pre-baseline
      shipped work, partial implementation, no-change, ambiguous matches, and
      PR/git degradation.
---

# Bounded Full Implementation Audit Evidence

## Architecture Context

Delta curation remains the routine baseline-based scan. Full implementation audit is an opt-in mode that examines every open backlog item with bounded evidence from current repository state, code/test/doc search, lifecycle traces, git history, PR metadata when available, and existing shipped/superseded classifiers. The source must give the planning agent compact evidence and guardrails; the agent must not invent repository evidence.

## Implementation

### Overview

Create a focused full-audit collector and integrate it into `buildBacklogCurationSource` only when `scanMode === 'full-implementation-audit'`. Preserve the existing delta collection and top-level `gitDelta` output. In full-audit mode, add a deterministic `fullImplementationAudit` source/preview context and feed strong/ambiguous closure candidates from the full-audit git/lifecycle/PR pass into the existing shipped evidence context.

### Key Decisions

1. Include every open backlog item in the full-audit scope; cap evidence per item rather than dropping items from scope.
2. Treat current code/test/doc/current-file matches as implementation evidence for partial or ambiguous findings, not as standalone closure evidence.
3. Permit shipped/superseded closure proposals only from strong lifecycle/git/PR candidates that use the existing evidence prefixes.
4. Route ambiguous shipped/superseded candidates to `skipped` or `needsInput` guidance by exposing ambiguous prefixes and confidence.
5. Keep partial implementation candidates open by presenting remaining-work guidance and evidence/recheck-note suggestions in the source; recommendation filtering remains the existing prospective overlay path.
6. Degrade missing PR history, missing git history, shallow repositories, capped searches, and unreadable paths into diagnostics rather than failing source generation.

## Scope

### In Scope

- Add a bounded full implementation audit source collector.
- Reuse existing modules: `backlog-curation-git-delta.ts`, `backlog-curation-evidence-classification.ts`, `shipped-evidence.ts`, `shipped-evidence-git.ts`, `shipped-evidence-pr.ts`, `shipped-evidence-matching.ts`, `trace-store.ts`, and `trace-activity.ts`.
- Collect current repository state evidence from code, test, documentation, and path/current-file matches with deterministic caps and redaction consistent with existing git excerpt handling.
- Include lifecycle trace, full bounded git history, PR enrichment when available, shipped/superseded evidence candidates, partial implementation candidates, stale/invalid/needs-input hints, and no-change entries in full-audit context.
- Add coverage, caps, diagnostics, evidence source, evidence confidence, matched signals, and truncation counters to source JSON and preview metadata.
- Include full-audit context in source fingerprints and compact/minimal source-text fallbacks.
- Add source guidance that full audit is comprehensive over open items but bounded by caps and available history.
- Add source guidance that the planning agent may cite only supplied repository evidence and must route unsupported or ambiguous evidence to `skipped` or `needs-input` guidance.
- Add source/evidence tests for pre-baseline shipped evidence, superseded evidence, partial implementation, stale/invalid items, unchanged fresh/no-change items, ambiguous shipped/superseded matches, skipped/needs-input routing, PR unavailable diagnostics, available PR-history evidence, lifecycle-trace evidence, current code/test/doc evidence, and deterministic caps.

### Out of Scope

- Workstation rendering of the new full-audit fields; plan-03 adds UI.
- Automatic backlog mutation without preview/apply.
- New daemon routes or engine-specific curation logic.
- Unbounded search of all repository files, all git history, or all remote PRs.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-curation-full-audit.ts` — full-audit collector, caps, diagnostics, current-state search helpers, per-item projection, fingerprint projection, and source-preview projection helpers.

### Modify

- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — call the full-audit collector only in full mode, merge full-audit closure candidates into `shippedEvidenceCandidates`, include `fullImplementationAudit` in source/text/fingerprint/preview metadata, and preserve delta-only behavior when scan mode is `delta`.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — add schemas/types for `BacklogCurationFullImplementationAuditPreview`, item evidence summaries, diagnostics, caps, coverage, and preview evidence details.
- `eforge/extensions/eforge-plan/backlog-curation-evidence-classification.ts` — expose any small formatting/projection helper needed by the full-audit collector without duplicating evidence-prefix logic.
- `eforge/extensions/eforge-plan/shipped-evidence-types.ts` only if the collector needs a shared literal type for full-audit evidence sources; avoid widening existing wire shapes unless necessary.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — add full-audit source/fingerprint/current-state/search/cap tests.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-evidence-classification.test.ts` — add classifier regressions only if helper behavior changes.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts` — add a regression proving full audit finds strong shipped evidence that predates the accepted delta baseline.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — add preview/apply tests proving full-audit generated recommendations exclude same-draft closures and keep partial items open when the draft appends evidence/recheck notes.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-recommendation-overlay.test.ts` — add focused overlay cases for partial implementation status/notes if existing apply-level coverage does not cover the prospective state.

## Collector Details

- Traverse repository files once for current-state evidence, excluding `node_modules/`, `dist/`, `.git/`, generated build output, private backlog storage, and known secret-like files.
- Classify search hits into `current-file-state`, `code-search`, `test-search`, and `documentation-search` using path category and extension rules.
- Match items using existing token/slug helpers where possible: item id, item slug, title slug, title token score, path match, and bounded excerpt match.
- Redact secret-like content before storing excerpts; cap excerpt bytes, excerpts per item, paths per category, diagnostics, and total source bytes.
- Collect bounded full git history independently of the accepted baseline and pass it with PR enrichment to `classifyBacklogCurationEvidence`/`collectShippedEvidence`.
- Build `fullImplementationAudit.scope` from all open item ids and `coverage.auditedItemCount === openItemCount` even when evidence is capped.
- Emit per-item entries with `candidateIntent` values such as `shipped`, `superseded`, `partial-implementation`, `stale-invalid`, `no-change`, `needs-input`, and `skipped` as evidence hints, not as automatic mutation decisions.
- Sort all arrays by stable keys: item id, evidence rank, source, path, commit, PR number, and evidence string.

## Verification

- [ ] Full-audit source `scope.itemIds` includes every open backlog item id in sorted order.
- [ ] Delta mode source output remains compatible with existing git-delta tests and does not include full-audit-only evidence fields unless explicitly allowed as absent/undefined.
- [ ] Full-audit fingerprint differs from delta fingerprint for the same repository state and remains stable across repeated full-audit builds with no file/git changes.
- [ ] Source guidance tells the planning agent to cite only supplied repository evidence, evidence prefixes, and source metadata.
- [ ] A shipped merge commit before the accepted baseline appears as a strong full-audit shipped candidate and is absent from delta-only baseline range candidates.
- [ ] A superseded pre-baseline commit appears as a strong full-audit superseded candidate with the superseded evidence prefix.
- [ ] Available PR enrichment appears as PR-history evidence with source, confidence, and candidate linkage.
- [ ] A lifecycle trace match appears as lifecycle-trace evidence with source, confidence, and candidate linkage.
- [ ] Current code/test/doc matches without strong lifecycle/git/PR closure produce partial-implementation evidence and leave top-level shipped evidence without a closure candidate for that item.
- [ ] A stale/invalid item appears in full-audit context with stale-invalid candidate guidance, evidence source, and confidence.
- [ ] An unchanged fresh item appears in full-audit context as no-change with coverage and no invented repository evidence.
- [ ] Ambiguous shipped and ambiguous superseded matches carry ambiguous confidence/prefixes, route to skipped or needs-input guidance, and do not satisfy closed-status patch validation.
- [ ] Missing or failing PR enrichment adds diagnostics while source generation returns source text.
- [ ] Full-audit caps/truncation counters increase when repository evidence exceeds configured limits.
- [ ] Preview/apply recommendation projection removes same-draft shipped/superseded closures and keeps partial implementation items in open recommendation lanes.