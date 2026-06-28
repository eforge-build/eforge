---
id: plan-01-terminal-curation-byte-cap
name: Preserve Terminal Curation Findings Under Reducer Byte Caps
branch: preserve-terminal-curation-findings-under-reducer-byte-caps/plan-01-terminal-curation-byte-cap
agents:
  builder:
    effort: high
    rationale: The change spans reducer input prioritization, prompt compaction,
      runner result visibility, and regression tests; it needs careful
      schema-compatible behavior under tight byte caps.
  reviewer:
    effort: high
    rationale: Review must verify data-integrity guarantees for terminal curation
      findings and named omission behavior.
  tester:
    effort: high
    rationale: Tests must exercise byte-cap edge cases that are sensitive to
      serialized sizes and outcome ordering.
---

# Preserve Terminal Curation Findings Under Reducer Byte Caps

## Architecture Context

`eforge-plan` analyze-all curation uses a map/reduce flow: item audit agents produce compact `BacklogCurationMapReduceItemOutcome` values, `buildBacklogCurationReducerInput()` packages those outcomes under `BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES`, and the monitor runner sends the capped input to the reducer agent. Today the packet builder shrinks global context and then repeatedly `pop()`s outcomes from the tail, making closure outcomes dependent on input order. Source-backed terminal `change` findings (`verdict: "shipped"` or `"superseded"`) must be preserved before lower-value outcomes, or named explicitly when the hard cap prevents preservation.

Existing draft visibility is sufficient if omitted terminal candidates are surfaced as top-level needs-input guidance or `backlogCurationDraft.needsInput` rows. Do not add daemon/client preview API fields unless the implementation proves the existing needs-input/skipped surfaces cannot express the named omissions.

## Implementation

### Overview

Replace tail-pop reducer pruning with deterministic semantic prioritization and compaction. Protect source-backed terminal change findings, compact lower-value detail before dropping outcomes, emit named omitted-terminal diagnostics when protection cannot fit every terminal candidate, and ensure the reducer/runner path exposes those names instead of producing a silent partial closure draft.

### Key Decisions

1. Treat a protected terminal outcome as a `cache-hit` or `audited-finding` whose `finding.disposition` is `"change"` and whose `finding.verdict` is `"shipped"` or `"superseded"`.
2. Retain protected terminal outcomes before no-op rechecks, partial/still-needed notes, item-agent failures, invalid findings, oversized-packet outcomes, recommendation-only detail, and nonessential diagnostics.
3. Prefer schema-compatible compaction over cap increases: keep required outcome/finding identity fields and truncate/drop low-value arrays or diagnostic text while preserving terminal closure evidence fields.
4. If any protected terminal outcome still cannot fit, emit named diagnostics carrying each omitted item id and verdict; the map/reduce runner must prevent a silent normal apply by turning those diagnostics into named needs-input/split guidance or by augmenting a returned draft with named `needsInput` rows before validation.
5. Reuse existing `needsInput`/`skipped` preview rendering. Add no preview schema/UI fields unless named omissions cannot be made visible through existing result shapes.

## Scope

### In Scope

- Semantic priority and compaction in `buildBacklogCurationReducerInput()`.
- Named diagnostics for omitted protected terminal findings.
- Reducer prompt instructions for terminal-omission diagnostics.
- Reducer prompt sanitization/compaction adjustments so retained terminal outcomes stay compact but include closure-critical fields.
- Map/reduce runner handling that makes omitted terminal candidates visible and prevents silent partial curation apply.
- Regression tests for late shipped and superseded terminal findings under reducer byte pressure.
- Regression tests proving terminal outcomes beat lower-value outcomes under byte pressure.
- Regression tests proving omitted terminal diagnostics name item ids and verdicts.
- Existing source-first closure validation behavior for closed-status patches.

### Out of Scope

- Increasing reducer byte caps as the fix.
- Changing source-first closure authority.
- Treating git/PR history as closure authority.
- Adding broader auto-apply workflow behavior.
- Breaking daemon/client route or response contracts.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/backlog-curation-packets.ts` — Replace tail-pop pruning with semantic priority selection and compaction helpers. Add protected-terminal detection, compact outcome/finding projection, lower-value detail pruning, and named omitted-terminal diagnostics. Keep output valid against `BacklogCurationMapReduceReducerInputSchema`.
- `eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts` — Adjust reducer prompt sanitization/compaction so terminal findings retain item id, source/body hashes, disposition, verdict, closure roles, summary/rationale, checked paths, and compact current-source citations; continue stripping raw bodies/raw audit/git data.
- `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-reducer.md` — Instruct the reducer to treat named terminal-omission diagnostics as unsafe for a normal complete curation draft: emit top-level `decision: "needs-input"` split guidance or draft `needsInput` rows naming every omitted item id and verdict.
- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — Detect reducer inputs that carry named terminal-omission diagnostics. Ensure the returned planning result exposes those named omissions: either fail closed with top-level needs-input split guidance before a normal draft is accepted, or append named `backlogCurationDraft.needsInput` rows before validation when a draft is returned. Do not allow a reducer result with omitted terminal diagnostics to look like a complete apply-ready curation without named omissions.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts` — Add capped-input regressions for late `shipped` and `superseded` findings, terminal priority over lower-value outcomes, required terminal fields after compaction, and named omitted-terminal diagnostics.
- `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` — Add runner regressions proving the reducer receives protected terminal outcomes under byte pressure and omitted protected terminals produce named diagnostics/needs-input visibility.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*` — Only modify if a new additive preview warning field is introduced; otherwise rely on existing top-level needs-input and `backlogCurationDraft.needsInput` rendering.

## Implementation Notes

- Keep helper functions small and bounded; both main implementation files already use durable `// --- eforge:region ... ---` markers.
- Do not add properties to existing client schemas unless unavoidable. The current diagnostic shape can carry named omissions through `code`, `severity`, `message`, and `path`.
- Use deterministic ordering: semantic priority first, then original index or item id for stable ties.
- Terminal compaction must keep, at minimum:
  - outcome/finding `itemId`
  - `sourceFingerprint`, `packetSha256`, and `bodySha256`
  - `finding.disposition` and `finding.verdict`
  - `finding.closureEvidenceRoles`
  - `finding.summary` or `finding.rationale`
  - compact `checkedPaths`
  - compact current-source citations prioritized by closure roles (`implementation`, `replacement`, `product-surface`, then supporting/current-source)
- Generic dropped-outcome diagnostics may remain for nonterminal outcomes, but terminal omissions must never be represented only as a generic retained-count message.
- Preserve existing apply-time validation: closed-status patches still require current-source evidence prefixes/roles, and historical hints remain non-authoritative.

## Verification

- [ ] `buildBacklogCurationReducerInput()` retains a late source-backed `shipped` change finding when lower-priority outcomes exceed the reducer cap.
- [ ] `buildBacklogCurationReducerInput()` retains a late source-backed `superseded` change finding when lower-priority outcomes exceed the reducer cap.
- [ ] Under byte pressure, protected terminal outcomes are retained before no-op recheck, partial/still-needed, failure/invalid, recommendation-only, and diagnostic-only outcomes.
- [ ] Retained terminal outcomes include item id, source/body hashes, verdict, disposition, closure roles, rationale or summary, and compact current-source citations.
- [ ] When protected terminal outcomes cannot all fit, diagnostics name each omitted terminal candidate exercised by the test and include each candidate verdict.
- [ ] The reducer prompt mentions named terminal-omission diagnostics and requires needs-input/split guidance instead of silent omission.
- [ ] The map/reduce runner prevents an apply-ready result from hiding omitted terminal diagnostics; omitted terminal candidates are visible as named needs-input/split guidance.
- [ ] Existing preview rendering shows named omissions through current top-level needs-input or draft `needsInput` rows when no new preview field is added.
- [ ] Closed-status patch validation still rejects closure patches without current-source evidence prefixes/roles.
- [ ] Historical git/PR hints remain non-authoritative for closure.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
