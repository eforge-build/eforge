---
id: plan-02-localized-evidence-pipeline
name: Localized Evidence Pipeline
branch: planner-source-localization-repair-loop/plan-02-localized-evidence-pipeline
agents:
  builder:
    effort: high
    rationale: Threads a new optional bundle through shared brief, materialization,
      atom task contracts, and compiler ordering without breaking existing
      callers.
  reviewer:
    effort: high
    rationale: Review must verify type changes and all consumers move together so
      intermediate merges type-check.
---

# Localized Evidence Pipeline

## Architecture Context

Plan 01 creates repository indexing and localization records. This plan inserts localization into the normal compiler path before source evidence materialization and atom planner invocation, then feeds localized owner excerpts and rationale to tool-less atom agents. Reducers remain tool-less and unchanged until plan 03.

The target order is:

`deriveSourceInventory` -> `derivePlanningAtomGraph` -> `deriveSourceLocalizationBundle` -> `deriveSharedPlanningBrief` -> `materializePlanningSourceEvidence` -> atom map -> reduce.

## Implementation

### Overview

Wire `SourceLocalizationBundle` through compiler-runner, shared brief ownership, source evidence materialization, atom task construction, and atom prompts. Localized candidate files become the source of ownership and materialized evidence, while exact legacy evidence paths keep backward-compatible behavior through the same bundle.

### Key Decisions

1. Make localization input required in the compiler-runner path and optional at lower-level pure helpers so existing focused tests can construct minimal graph-only cases.
2. Store ownership rationale and localization need ids on shared brief/evidence records instead of duplicating full record payloads in every atom task.
3. Preserve atom planner and reducer harness options with `tools: 'none'` by default.
4. Keep byte/file accounting in `PlanningSourceEvidenceBundle` authoritative after localization expands directories or broad surfaces into concrete files.

## Scope

### In Scope

- Insert source localization between atom graph derivation and shared brief/evidence materialization in `compiler-runner.ts`.
- Derive `PlanningEvidenceOwnership` from localized candidate owner files as well as exact evidence paths.
- Materialize localized files with excerpts, ownership rationale, candidate confidence/rank, need ids, and budget accounting.
- Deliver localized evidence and rationale to relevant atom tasks/prompts, including globally assigned candidates.
- Preserve old missing/non-actionable evidence statuses for unresolved records, but avoid leaving actionable directories as only non-materialized directory statuses when directory expansion finds files.
- Add compiler and evidence tests for ordering, excerpts, global assignment, budget accounting, generated artifact exclusion, and tool-less atom/reducer calls.

### Out of Scope

- Reduce-gap repair and residue gating; plan 03 owns that.
- Source-localizer agent implementation.
- Client event schema changes unless an existing compiler event cannot carry diagnostics.

## Files

### Modify

- `packages/engine/src/planner-compiler/compiler-runner.ts` — create the localization bundle after atom graph derivation, pass it into shared brief and evidence materialization, expose bundle diagnostics in compile diagnostics, and keep atom/reducer harness calls tool-less.
- `packages/engine/src/planner-compiler/shared-brief.ts` — use localized candidate files for evidence ownership, shared-primary selection, atom ownership sections, and interface summaries.
- `packages/engine/src/planner-compiler/shared-brief-contracts.ts` — add optional localization fields to ownership/brief records, such as need ids, confidence, candidate rank, ownership rationale, and localization status.
- `packages/engine/src/planner-compiler/source-evidence-materialization.ts` — read localized candidate files, enforce per-file/per-atom/total budgets, attach rationale and byte accounting, and keep missing/read-error diagnostics machine-readable.
- `packages/engine/src/planner-compiler/source-evidence-contracts.ts` — add localized evidence metadata and helper accessors while preserving existing statuses for callers.
- `packages/engine/src/planner-compiler/atom-planning-contracts.ts` — include localized evidence summaries/need ids on atom tasks or task metadata.
- `packages/engine/src/planner-compiler/atom-map-runner.ts` — include localized evidence records when constructing atom tasks and maintain unchanged `tools: 'none'` harness options.
- `packages/engine/src/planner-compiler/atom-planner-agent.ts` — render localized source excerpts, owner rationale, confidence, rank, and budget notes in the atom prompt without giving repository tools to the agent.
- `packages/engine/src/planner-compiler/atom-source-materialization.ts` — include localized evidence sections in atom-source prompt materialization if this helper owns prompt excerpt formatting.
- `packages/engine/src/planner-compiler/atom-graph.ts` — carry localization-ready need ids or global source inventory candidates only if plan 01 did not keep that state fully in the bundle.
- `packages/engine/src/planner-compiler.ts` — export updated contracts used by tests.
- `test/planning-source-evidence.test.ts` — add localized directory/surface materialization, excerpt, rationale, by-atom, and budget-accounting assertions.
- `test/planning-compiler-runner.test.ts` — assert compiler ordering and that broad subsystem/interface PRDs reach atom planners with localized source excerpts.
- `test/planning-compiler-runtime-hardening.test.ts` — assert generated planner artifacts stay excluded from localization/materialization and broad source references do not produce meta-planning artifacts in the normal path.
- `test/agent-wiring.test.ts` or the existing planner harness test file — assert atom planner and reducer calls keep `tools: 'none'` after localization is added.

## Implementation Notes

- Type changes to shared brief/source evidence records and every constructor/consumer must land in this plan together.
- When a localized record has multiple candidates, materialize only the capped candidate set selected by the bundle, not a fresh path search.
- When multiple atoms share a localized owner, select a primary atom with deterministic ordering and record all delivered atom ids.
- Evidence prompt text must distinguish: localized owner path, why it was selected, record status, excerpt byte length, and any budget truncation.
- If a file is too large, record the concrete path and byte status; do not silently drop it from by-atom diagnostics.

## Verification

- [ ] Compiler-runner calls `deriveSourceLocalizationBundle` before `deriveSharedPlanningBrief`, `materializePlanningSourceEvidence`, atom map, and reduce in ordering tests.
- [ ] A broad interface PRD in a synthetic repository produces atom tasks containing concrete localized source excerpts and ownership rationale.
- [ ] Directory evidence with matching files yields materialized file records rather than only `directory` status.
- [ ] `PlanningSourceEvidenceBundle.totalBytes`, per-file excerpt bytes, per-atom bytes, and budget-exceeded records match test fixture file sizes.
- [ ] Atom planner and reducer `StubHarness` calls contain `tools: 'none'`.
- [ ] Generated planner artifacts never appear in source evidence records or atom prompts.
- [ ] `pnpm type-check` exits 0 after all shared brief, evidence, atom task, and compiler-runner consumers compile.