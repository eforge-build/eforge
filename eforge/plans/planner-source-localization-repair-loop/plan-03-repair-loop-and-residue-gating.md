---
id: plan-03-repair-loop-and-residue-gating
name: Repair Loop and Residue Gating
branch: planner-source-localization-repair-loop/plan-03-repair-loop-and-residue-gating
agents:
  builder:
    effort: high
    rationale: Adds bounded compiler control flow and changes reduce/residue
      semantics while preserving fail-closed behavior.
  reviewer:
    effort: high
    rationale: Review must check repair termination, affected-atom reruns,
      diagnostics, and residue gating for source/localization gaps.
  tester:
    effort: high
    rationale: Integration regressions need to prove gap repair, exhaustion
      diagnostics, and absence of vague candidate-reduce-gap plans.
---

# Repair Loop and Residue Gating

## Architecture Context

Plans 01 and 02 make concrete localized evidence available before atom planning. This plan completes the source by treating source/localization reduce gaps as compiler repair inputs instead of executable work. It also updates residue synthesis so unresolved source/localization gaps cannot become vague `candidate-reduce-gap` implementation plans.

## Implementation

### Overview

Classify reducer gaps that indicate missing owner paths, missing contract/entrypoint/configuration/consumer-surface evidence, directory-only evidence, missing materialized source, or localization ambiguity. For classified gaps, run a bounded repair pass that adds focused localization needs, refreshes localized shared-brief ownership, rematerializes evidence, reruns affected atom planners, reruns affected reducers, and records machine-readable diagnostics. When repair attempts are exhausted, the compiler returns incomplete/failed diagnostics with coverage transparency rather than synthesizing meta-planning branches.

### Key Decisions

1. Keep atom planners and reducers tool-less. Repair uses deterministic compiler internals, not agent repository access.
2. Rerun only affected atoms when reducer gap metadata identifies atom ids; fall back to atoms linked through source need ids, criterion ids, aspect ids, interface keys, or localized paths.
3. Cap repair attempts with a small default limit and record every attempt, affected atoms, localized owner paths, unresolved gaps, coverage status for affected original criteria/aspects/source needs, and exhaustion reason.
4. Treat source/localization gaps as non-buildable residue unless they have concrete localized owners, product-scoped outputs, and validation tied to original PRD criteria.

## Scope

### In Scope

- Add structured source/localization gap classification to reduce contracts and reducer prompt output.
- Add deterministic post-reduce classification for old or partial reducer outputs.
- Add bounded repair orchestration in the compiler runner or a helper module.
- Rerun localization, localized shared-brief ownership, materialization, atom map, and reduce for affected atoms, then merge updated atom outputs with unaffected outputs.
- Add machine-readable repair diagnostics to compiler results and emitted planning events only if the existing event type cannot carry diagnostics.
- Include coverage transparency in exhausted repair diagnostics by reporting affected original criterion ids, aspect ids, source need ids, localized owner status, and evidence materialization status.
- Gate residue and plan artifact synthesis so unresolved source/localization gaps do not create vague executable plans.
- Add docs/comments that explain source inventory, source localization, evidence materialization, atom planning, reducers, residue, repair-loop responsibilities, repository-agnostic defaults, and optional hint mechanisms.
- Update existing runtime hardening/residue tests and add synthetic repair-loop regressions.

### Out of Scope

- Workflow scheduler, daemon, console, or workstation UX.
- Broad semantic search or mutation-capable tools.
- Product-specific default mappings for eforge route/client/extension names.
- Database migrations.

## Files

### Create

- `packages/engine/src/planner-compiler/source-localization-repair.ts` — gap classifier, affected-atom resolver, bounded repair attempt orchestration helpers, output merge utilities, and diagnostics builders.
- `test/planning-compiler-repair-loop.test.ts` — integration coverage with synthetic repositories, `StubHarness`, broad source gaps, affected-atom reruns, repair exhaustion, and no candidate-reduce-gap output.
- `packages/engine/src/planner-compiler/README.md` — lightweight internal architecture notes for inventory, localization, materialization, atom map, reduce, repair, residue, repository-agnostic defaults, and project hint extension points, unless an existing planner-compiler doc file already owns this content.

### Modify

- `packages/engine/src/planner-compiler/compiler-runner.ts` — call the repair helper after reduce, cap attempts, refresh localized shared-brief ownership, rerun affected stages, surface diagnostics, and skip residue synthesis for unresolved source/localization gaps.
- `packages/engine/src/planner-compiler/reduce-contracts.ts` — add structured gap fields for issue kind, source/localization signal, source need ids, affected atom ids, owner paths, criterion/aspect ids, and product-scoped validation references.
- `packages/engine/src/planner-compiler/reduce-runner.ts` — normalize reducer output through the new gap contract and preserve tool-less reducer calls.
- `packages/engine/src/planner-compiler/reducer-agent.ts` — prompt reducers to classify missing source/localization evidence as structured repair gaps, not as implementation-plan candidates.
- `packages/engine/src/planner-compiler/residue-contracts.ts` — represent buildable vs repair-only residue and require concrete localized owner paths for source/localization-derived residue.
- `packages/engine/src/planner-compiler/residue-synthesis.ts` — filter unresolved source/localization gaps out of executable residue candidates; emit diagnostics instead.
- `packages/engine/src/planner-compiler/plan-artifact-synthesis.ts` — require product-scoped outputs and original PRD validation for any buildable residue derived from a localized source gap.
- `packages/engine/src/planner-compiler/event-sink.ts` and `packages/client/src/events/variants/planning-map-reduce.ts` — modify only if an event contract is required for repair diagnostics; keep event wire shapes owned by `@eforge-build/client`.
- `packages/engine/src/planner-compiler.ts` — export repair diagnostics/contracts required by tests.
- `test/planning-residue-synthesis.test.ts` — assert unresolved source/localization gaps are repair-only and buildable residue requires concrete owners plus PRD-tied validation.
- `test/planning-plan-artifact-synthesis.test.ts` — assert source/localization reduce gaps do not become executable `candidate-reduce-gap` plans without concrete localized owners and product-scoped outputs.
- `test/planning-compiler-runtime-hardening.test.ts` — replace old missing-evidence-to-residue expectations with fail-closed diagnostics or repaired product-scoped output expectations.
- `test/planning-compiler-runner.test.ts` — add end-to-end compiler assertions for localization-before-repair order and exhausted repair diagnostics.
- `test/planning-source-evidence.test.ts` — add any evidence diagnostics needed by repair classification.

## Implementation Notes

- Repair diagnostics must be machine-readable. Include attempt number, status, gap ids, gap classification, source need ids, affected atom ids, criterion/aspect ids, localized owner paths, localized owner status, evidence materialization status, unresolved reason, and whether residue synthesis was blocked.
- If reducer output omits new structured fields, classify source/localization gaps through deterministic signals in gap text, evidence statuses, source need ids, missing owner paths, or aspect source metadata.
- After a repair attempt changes localization records, rebuild the affected shared-brief ownership data before source evidence rematerialization so repaired atom prompts and diagnostics use current owner paths and rationales.
- Add `affectedAtomIds` support to atom map execution if absent. The helper must reuse prior atom outputs for unaffected atoms and preserve deterministic output ordering before reduce.
- A repaired path must still pass source evidence materialization budgets. Budget failures with concrete owner paths may become product-scoped residue only when validation references original PRD criteria.
- Keep repair attempts low-budget; default to one or two attempts and expose the limit in diagnostics.
- Do not add new client events unless tests demonstrate existing compiler diagnostics cannot be observed. If events are added, define variants in `packages/client/src/events/variants/planning-map-reduce.ts` and import them from client-owned schemas.

## Verification

- [ ] A synthetic PRD that initially produces a missing-owner reduce gap triggers localization, localized shared-brief ownership refresh, rematerialization, affected atom rerun, reduce rerun, and then product-scoped final plans.
- [ ] A synthetic PRD with no localizable owners exhausts repair attempts and returns machine-readable diagnostics containing gap ids, affected atoms, coverage status for affected criteria/aspects/source needs, and exhaustion reason.
- [ ] Unresolved source/localization reduce gaps do not create executable `candidate-reduce-gap` plan artifacts.
- [ ] Buildable residue from a source/localization gap contains concrete localized owner paths, product-scoped outputs, and validation tied to original PRD criteria.
- [ ] Reducer and atom planner `StubHarness` calls keep `tools: 'none'` during normal and repair attempts.
- [ ] Current-repository route/client/extension cases pass as fixture data through generic resolver signals, with no default eforge layout mapping in source localization code.
- [ ] Planner-compiler architecture docs describe the localization and repair responsibilities and the hint/configuration seam.
- [ ] `pnpm maintainability:check` exits 0 after new files and large-file edits.