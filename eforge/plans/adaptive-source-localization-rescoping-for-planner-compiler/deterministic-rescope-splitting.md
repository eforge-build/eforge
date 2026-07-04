---
id: deterministic-rescope-splitting
name: Deterministic degraded-scope atom splitting
branch: adaptive-source-localization-rescoping-for-planner-compiler/deterministic-rescope-splitting
---

# Deterministic degraded-scope atom splitting

Implement deterministic rescope classification/directives and atom-graph splitting for risky degraded exploration outcomes.

## Scope

- In `packages/engine/src/compile-resilience/planning-decomposition-limits.ts`, add limits for max adaptive rescope attempts, per-scope exploration budget base/per-need scaling, total cross-run budget multiplier, and any needed maxima using the existing default + maximum pattern. Keep `planningUnitMaxLocalExplorationToolUses` as the per-scope clamp.
- In `packages/engine/src/planner-compiler/adaptive-rescope.ts` (new) and supporting planner-compiler contracts, derive deterministic rescope directives from unresolved source need ids, criteria/aspects, interface keys, subsystem hints, evidence paths, candidate owner paths, and bounded rescope hints. Stable-sort every input and produce stable directive/group ids.
- Reuse existing risk signals: high-confidence share versus `EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE`, per-record localization confidence, subsystem diversity versus `maxSubsystemsPerUnit`, degraded outcome status, and unresolved needs with interface keys. Do not invent a parallel heuristic taxonomy.
- Define critical unresolved needs as those tied to criteria with interface keys or contract/entrypoint need kinds, and return fail-closed diagnostics when attempts/budgets are exhausted while critical needs remain unresolved.
- In `packages/engine/src/planner-compiler/atom-graph.ts`, accept optional deterministic rescope directives in `derivePlanningAtomGraph`, split affected atoms accordingly, and apply the atom-root collapse override only under a degraded exploration outcome.
- In `packages/engine/src/planner-compiler/compiler-runner.ts`, accept and thread rescope directives into atom-graph derivation. Do not put adaptive rescope orchestration in `compiler-runner.ts`.
- Keep `packages/engine/src/planner-compiler/source-localization-repair.ts` changes limited to consuming the shared localization issue vocabulary; the reduce-gap repair loop remains pre-existing and semantically unchanged.
- Record split groups, rationale, original/revised atom counts, remaining unresolved/low-confidence localization, and fail-closed/proceeded decisions in compiler diagnostics.

## Traceability

Criteria: ac-004, ac-006, ac-009
Aspects: ac-004:evidence:criteria-aspects, ac-004:interface:schema-contract, ac-006:general:general, ac-009:general:general

## Validation

- `pnpm test -- test/planning-atom-graph.test.ts test/planning-compiler-diagnostics.test.ts`
- `pnpm type-check`
- Verify repeated runs with the same degraded input produce identical split scopes; cross-cutting degraded `atom-root` does not proceed unsplit unless deterministic localization confidence is sufficient; configured attempt/budget limits clamp rescoping; and exhausted rescoping returns fail-closed diagnostics.
