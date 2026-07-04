---
id: planner-compiler-rescope-tests
name: Planner compiler rescoping regression tests
branch: adaptive-source-localization-rescoping-for-planner-compiler/planner-compiler-rescope-tests
---

# Planner compiler rescoping regression tests

Author focused regression tests for the planner-compiler rescoping feature using real code and existing `StubHarness` patterns where agent wiring is required.

## Scope

- Extend `test/planning-exploration-agent.test.ts` for successful structured outcomes, submit-only budget exhaustion, rejected read-only calls after exhaustion, honored submit calls during grace mode, deterministic no-submit `budget-exhausted` fallback, ambiguous outcomes, unknown-id diagnostics, per-scope budget/turn scaling, and cross-run ledger caps.
- Extend `test/planning-atom-graph.test.ts` for deterministic rescope grouping, stable atom ids, degraded atom-root split behavior, and high-confidence warning-only passthrough.
- Extend `test/planning-compiler-stage-integration.test.ts` for risky degraded scopes triggering pre-map rescoping, reruns limited to affected scopes, preservation of unaffected outputs, re-emitted atom snapshots, and rescope exhaustion fail-closed behavior.
- Extend `test/planning-compiler-diagnostics.test.ts` for machine-readable exploration/rescope diagnostics, rescope compaction, unresolved needs/reasons, split rationale, preserved/rerun atoms, and fail-closed outcomes.
- Extend `test/planning-source-localization.test.ts` or adjacent focused tests for shared localization issue vocabulary consumption without changing reduce-gap repair semantics.
- Add or split adjacent test files if maintainability limits require it; keep tests grouped by logical behavior rather than source file.

## Traceability

Criteria: ac-010
Aspects: ac-010:interface:test, ac-010:subsystem:test

## Validation

- `pnpm test -- test/planning-exploration-agent.test.ts test/planning-source-localization.test.ts test/planning-atom-graph.test.ts test/planning-compiler-stage-integration.test.ts test/planning-compiler-diagnostics.test.ts`
- `pnpm type-check`
- `pnpm maintainability:check`
- New tests should fail without the structured outcomes, deterministic splitting, bounded reruns, diagnostics, and preservation behavior.
