---
id: plan-07-build-detail-tabs
name: Build detail Changes, Graph, and Plan tabs
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-07-build-detail-tabs
agents:
  builder:
    effort: high
    rationale: Ports heatmap, dependency graph, and plan-preview families with their
      respective heavyweight dependencies. Each tab is a self-contained
      subsystem.
---

---
id: plan-07-build-detail-tabs
name: Build detail Changes, Graph, and Plan tabs
depends_on: [plan-06-build-detail-base]
---

# Build detail Changes, Graph, and Plan tabs

## Architecture Context

The Log tab is functional after plan-06. This plan fills in the remaining three tabs of the bottom panel:
- `Changes` — `FileHeatmap` family ported from monitor-ui (`@xyflow/react` not needed here; only Tailwind + tokens).
- `Graph` — `DependencyGraph` ported from monitor-ui, consuming `@xyflow/react` and `@dagrejs/dagre`.
- `Plan` — `PlanTab` + `PlanPreviewPanel` ported from monitor-ui, consuming `shiki` for syntax highlighting.

All three depend on plan-02 having installed the heavy libraries and plan-06 having wired the bottom tab panel.

## Implementation

### Overview

1. **Port heatmap family** to `packages/console-ui/src/components/heatmap/`:
   - `file-heatmap.tsx`, `heatmap-cell.tsx`, `heatmap-legend.tsx`, `heatmap-summary.tsx`, `diff-viewer.tsx`, `use-heatmap-data.ts`, `index.ts`.
2. **Port graph family** to `packages/console-ui/src/components/graph/`:
   - `dependency-graph.tsx`, `dag-node.tsx`, `dag-edge.tsx`, `graph-status.ts`, `use-graph-layout.ts`, `index.ts`.
3. **Port preview family** to `packages/console-ui/src/components/preview/`:
   - `plan-preview-panel.tsx`, `plan-preview-context.tsx`, `plan-body-highlight.tsx`, `plan-metadata.tsx`, `index.ts`.
4. **Port plan-tab** to `packages/console-ui/src/components/console/plan-tab.tsx` (companion to plan-06's `console-panel.tsx`).
5. **Port shiki helper** to `packages/console-ui/src/lib/shiki.ts` (ported from `packages/monitor-ui/src/lib/shiki.ts`).
6. **Wire tabs in `bottom-tab-panel.tsx`** (plan-06's file):
   - `Changes` tab renders `<FileHeatmap />` when `runState.fileChanges.size > 0`, otherwise an empty-state message.
   - `Graph` tab renders `<DependencyGraph />` when there are dependency edges in `runState.earlyOrchestration`; otherwise stays disabled.
   - `Plan` tab renders `<PlanTab />` when `runState.earlyOrchestration` is non-null; otherwise stays disabled.
7. **Port co-located tests** for each family.
8. **Code-split optional.** Each tab body could be lazy-loaded for further bundle savings; ship without it unless straightforward.

### Key Decisions

1. **One plan covers all three tabs** — they share the bottom panel and the same dependency family is already in place.
2. **PlanPreviewContext is a top-level React context** scoped to the detail view; render the provider in `run-detail-view.tsx` so the Plan tab tree can read from it.
3. **Shiki initialized lazily** to avoid loading the grammar set unless the Plan tab is opened.
4. **Empty states are concrete strings**, not skeletons: `"No file changes recorded yet."`, etc.

## Scope

### In Scope
- Port heatmap, graph, preview families.
- Port `plan-tab.tsx` and `shiki.ts`.
- Wire tab contents in `bottom-tab-panel.tsx`.
- Update `run-detail-view.tsx` to mount `PlanPreviewContext` provider when needed.
- Port co-located tests.

### Out of Scope
- README/docs (plan-08).
- Any non-detail-route changes.

## Files

### Create
- `packages/console-ui/src/components/heatmap/file-heatmap.tsx`
- `packages/console-ui/src/components/heatmap/heatmap-cell.tsx`
- `packages/console-ui/src/components/heatmap/heatmap-legend.tsx`
- `packages/console-ui/src/components/heatmap/heatmap-summary.tsx`
- `packages/console-ui/src/components/heatmap/diff-viewer.tsx`
- `packages/console-ui/src/components/heatmap/use-heatmap-data.ts`
- `packages/console-ui/src/components/heatmap/index.ts`
- `packages/console-ui/src/components/heatmap/__tests__/file-heatmap.test.tsx`
- `packages/console-ui/src/components/graph/dependency-graph.tsx`
- `packages/console-ui/src/components/graph/dag-node.tsx`
- `packages/console-ui/src/components/graph/dag-edge.tsx`
- `packages/console-ui/src/components/graph/graph-status.ts`
- `packages/console-ui/src/components/graph/use-graph-layout.ts`
- `packages/console-ui/src/components/graph/index.ts`
- `packages/console-ui/src/components/preview/plan-preview-panel.tsx`
- `packages/console-ui/src/components/preview/plan-preview-context.tsx`
- `packages/console-ui/src/components/preview/plan-body-highlight.tsx`
- `packages/console-ui/src/components/preview/plan-metadata.tsx`
- `packages/console-ui/src/components/preview/index.ts`
- `packages/console-ui/src/components/console/plan-tab.tsx`
- `packages/console-ui/src/lib/shiki.ts`

### Modify
- `packages/console-ui/src/views/run-detail/bottom-tab-panel.tsx` — fill in `Changes`, `Graph`, `Plan` tab contents; remove stubs.
- `packages/console-ui/src/views/run-detail/run-detail-view.tsx` — wrap the tree in `PlanPreviewContext` provider.

## Verification

- [ ] The `Changes` tab renders the ported `FileHeatmap` when `runState.fileChanges.size > 0`, otherwise renders the empty-state message `"No file changes recorded yet."`.
- [ ] The `Graph` tab renders the ported `DependencyGraph` when `runState.earlyOrchestration` contains dependency edges.
- [ ] The `Graph` tab trigger remains disabled when `runState.earlyOrchestration` has no dependency edges.
- [ ] The `Plan` tab renders the ported `PlanTab` when `runState.earlyOrchestration` is non-null.
- [ ] The `Plan` tab trigger remains disabled when `runState.earlyOrchestration` is null.
- [ ] `packages/console-ui/src/components/heatmap/file-heatmap.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/graph/dependency-graph.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/preview/plan-preview-panel.tsx` exists on disk.
- [ ] `packages/console-ui/src/lib/shiki.ts` exists on disk.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
