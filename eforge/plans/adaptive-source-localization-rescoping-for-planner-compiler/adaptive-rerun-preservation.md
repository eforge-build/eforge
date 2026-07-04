---
id: adaptive-rerun-preservation
name: Affected-scope localization reruns and preservation
branch: adaptive-source-localization-rescoping-for-planner-compiler/adaptive-rerun-preservation
---

# Affected-scope localization reruns and preservation

Implement the pre-map adaptive rescope loop in the compile-stage integration layer and preserve unaffected localization/planning outputs.

## Scope

- Add/extend `packages/engine/src/planner-compiler/adaptive-rescope.ts` alongside `compile-stage-integration.ts` to orchestrate bounded rescope attempts around `resolveExplorationHints`. The loop lives in the stage-integration layer, not in `compiler-runner.ts`.
- In `packages/engine/src/planner-compiler/compile-stage-integration.ts`, record structured diagnostics for degraded scopes, invoke the adaptive rescope loop before map planning, pass deterministic directives to `runBoundedPlannerCompiler`, preserve successful outputs for unaffected scopes, and re-emit the existing `planning:map-reduce:atoms` snapshot when a revised graph is produced.
- In `packages/engine/src/planner-compiler/exploration-agent.ts` and source-localization modules, add per-scope need filtering, scope fingerprints/cache keys, need-count-derived exploration budget sizing, matching turn-ceiling scaling, and cross-run tool-use ledger accounting so total exploration budget is capped across attempts.
- Update `packages/engine/src/planner-compiler/compiler-diagnostics.ts` and `compiler-diagnostics-contracts.ts` with the rescope diagnostics section and a compaction pass so rescope history cannot crowd out coverage/repair data.
- Preserve architectural boundaries: repository access remains limited to deterministic compiler internals and the read-only exploration phase; atom planners/reducers remain tool-less; exploration outputs are evidence only and cannot author final plan modules, orchestration, or dependencies.
- Reuse existing `planning:progress`, `planning:warning`, and `planning:map-reduce:atoms` events only. Do not add client event variants or a Console surface.

## Traceability

Criteria: ac-005, ac-007, ac-008
Aspects: ac-005:evidence:localization-exploration, ac-007:general:general, ac-008:evidence:localization-rescope

## Validation

- `pnpm test -- test/planning-compiler-stage-integration.test.ts test/planning-exploration-agent.test.ts test/planning-source-localization.test.ts`
- `pnpm type-check`
- Verify a rescope affecting one scope reruns only that scope and reuses successful unaffected localization/atom outputs where applicable; planner/reducer harnesses remain tool-less; exploration result schemas reject or ignore module/dependency authoring; and the cross-run ledger caps total tool uses across rescope attempts.
