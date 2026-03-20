---
id: plan-01-gate-and-reorder-graph-tab
name: Gate and Reorder Graph Tab
dependsOn: []
branch: hide-graph-tab-when-not-a-meaningful-dag/gate-and-reorder-graph-tab
---

# Gate and Reorder Graph Tab

## Architecture Context

The monitor dashboard's `app.tsx` owns tab visibility logic, tab ordering, and default tab selection. The `effectiveOrchestration` variable merges server-fetched orchestration with early orchestration synthesized from `expedition:architecture:complete` events - both sources include `dependsOn` arrays on plan entries, so gating on dependency edges works for the full lifecycle.

## Implementation

### Overview

Three targeted changes in `src/monitor/ui/src/app.tsx`:
1. Gate `graphEnabled` on actual dependency edges (not just plan existence)
2. Change default `activeTab` from `'graph'` to `'timeline'`
3. Reorder tab buttons so Graph is last instead of first

### Key Decisions

1. Gate on `plans.some(p => p.dependsOn && p.dependsOn.length > 0)` rather than checking plan count. A multi-plan run with all independent plans (no `dependsOn` entries) still has no meaningful DAG, so the graph should stay hidden.
2. Default to `'timeline'` because it's always available and provides useful information for every run type.
3. The existing fallback on line 164 (`if activeTab === 'graph' && !graphEnabled`) remains as a safety net - no changes needed there.

## Scope

### In Scope
- Adding `hasDependencyEdges` check derived from `effectiveOrchestration.plans`
- Updating `graphEnabled` to require both `hasOrchestration` and `hasDependencyEdges`
- Changing `useState<ContentTab>('graph')` to `useState<ContentTab>('timeline')`
- Moving the Graph tab `<button>` block from first position to last position in the tab bar

### Out of Scope
- Changes to the `DependencyGraph` component itself
- Changes to the orchestration data model or reducer
- Changes to any other tabs or their visibility logic

## Files

### Modify
- `src/monitor/ui/src/app.tsx` — Gate `graphEnabled` on dependency edges, change default tab to `'timeline'`, reorder tab buttons so Graph is last

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes with zero failures
- [ ] Default `activeTab` initial value is `'timeline'` (line 26)
- [ ] `graphEnabled` is `false` when no plan has a non-empty `dependsOn` array
- [ ] `graphEnabled` is `true` when at least one plan has a non-empty `dependsOn` array
- [ ] Tab button order in JSX is: Timeline, Heatmap, Plans, Graph
