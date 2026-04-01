---
id: plan-01-transitive-reduction
name: Transitive Reduction in Orchestration Config Parsing
depends_on: []
branch: transitive-reduction-for-plan-dependencies-and-thread-line-swimlane-ui/transitive-reduction
---

# Transitive Reduction in Orchestration Config Parsing

## Architecture Context

The orchestration system parses `orchestration.yaml` files into `OrchestrationConfig` objects via `parseOrchestrationConfig()` in `src/engine/plan.ts`. The `dependsOn` arrays are currently passed through verbatim from the YAML, which means redundant transitive edges (e.g., Plan 03 listing both Plan 01 and Plan 02 when Plan 02 already depends on Plan 01) are preserved. All downstream consumers - `resolveDependencyGraph()`, `propagateFailure()`, `isPlanReady()`, the graph visualization, and the swimlane UI - read from these arrays, so reducing at parse time fixes all consumers at once.

Execution semantics are preserved because:
- `resolveDependencyGraph()` (Kahn's algorithm) produces identical waves - transitive reduction doesn't change topological order
- `isPlanReady()` checks `dependsOn.every(dep => merged)` - a plan's direct dep can't be merged until its own deps are merged, so indirect deps are implicitly satisfied
- `propagateFailure()` uses BFS over the dependents adjacency, which still reaches all transitive dependents through intermediate nodes

## Implementation

### Overview

Add a `transitiveReduce()` utility function and call it inside `parseOrchestrationConfig()` after parsing the plans array, before returning the config. The function computes reachability for each node and removes any edge that is reachable through another path.

### Key Decisions

1. **Reduce at parse time, not at consumption sites** - one reduction benefits all consumers (graph, swimlane, scheduling, failure propagation) without any changes to those consumers.
2. **Pure function in `src/engine/plan.ts`** - keeps the utility co-located with parsing logic; exported for testability.
3. **Algorithm: for each node, BFS/DFS from each direct dep to find indirect reachability** - O(V*(V+E)) in worst case but plan counts are small (typically <20), so this is negligible.

## Scope

### In Scope
- `transitiveReduce()` function that takes a plans array and returns a new array with minimized `dependsOn`
- Integration into `parseOrchestrationConfig()` after plan parsing
- Unit tests covering: no reduction needed (already minimal), single redundant edge removed, chain of 3+ with full transitive closure reduced, diamond dependency pattern, single-node graph, empty plans array

### Out of Scope
- Changes to orchestration.yaml file format
- Changes to any consumer code (graph, swimlane, orchestrator) - they benefit automatically
- UI changes (handled in plan-02)

## Files

### Modify
- `src/engine/plan.ts` - Add exported `transitiveReduce()` function; call it on the parsed `plans` array inside `parseOrchestrationConfig()` before returning
- `test/plan-parsing.test.ts` - Add test suite for `transitiveReduce()` covering: linear chain (A->B->C with C listing both A and B), diamond (A->B, A->C, B->D, C->D with D listing A,B,C), already-minimal graph, empty input, single plan with no deps

## Verification

- [ ] `transitiveReduce([{id:'A',dependsOn:[]},{id:'B',dependsOn:['A']},{id:'C',dependsOn:['A','B']}])` returns C with `dependsOn: ['B']` only
- [ ] `transitiveReduce([{id:'A',dependsOn:[]},{id:'B',dependsOn:['A']},{id:'C',dependsOn:['A']},{id:'D',dependsOn:['A','B','C']}])` returns D with `dependsOn: ['B','C']` only
- [ ] Plans with no redundant edges pass through unchanged
- [ ] Empty plans array returns empty array
- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes (existing + new tests)
