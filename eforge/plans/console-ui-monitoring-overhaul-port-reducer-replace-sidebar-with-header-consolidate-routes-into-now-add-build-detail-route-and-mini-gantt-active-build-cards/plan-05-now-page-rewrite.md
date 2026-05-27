---
id: plan-05-now-page-rewrite
name: Now page rewrite with mini-Gantt cards and activity drawer
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-05-now-page-rewrite
agents:
  builder:
    effort: high
    rationale: Section-by-section rewrite of the Now page; the mini-Gantt component
      and drawer are net-new and visual correctness matters.
---

---
id: plan-05-now-page-rewrite
name: Now page rewrite with mini-Gantt cards and activity drawer
depends_on: [plan-03-hook-signature-and-consumers, plan-04-shell-and-routes]
---

# Now page rewrite with mini-Gantt cards and activity drawer

## Architecture Context

The Now page is the single monitoring entry point now that queue/runs/activity routes are gone. This plan replaces three card components (`QueueSnapshotCard`, `RecentRunsCard`, `RecentActivityCard`) with their successors (`QueueCard` display-only, `RunHistoryCard` inline-expanding, `ActivityDrawerLauncher` + `ActivityDrawer`), and gives `ActiveBuildCard` a mini-Gantt pipeline strip plus a whole-card click target. Layout order top-to-bottom: Attention → Active builds → Queue → Stack | Activity (two-column) → Run history.

The Now page reads from the reduced `runState` for active builds (plan-03 wired this up). The drawer surfaces the same activity event list the deleted activity route used to render; the four event-list files move into a new `components/now/activity-drawer/` location.

## Implementation

### Overview

1. **`BuildPipelineStrip` component.** New shared component at `src/components/now/build-pipeline-strip.tsx`. Reads `RunState.orchestration.plans`, `planStatuses`, and `agentThreads`. Renders one row per plan plus a PRD row when planning events exist. Each row is a horizontal strip of stage-colored segments. Heights and colors driven by tokens already in `globals.css`. Reused by plan-06 on the detail route (export it once, consume in two places).
2. **`ActiveBuildCard` rewrite.** Add the mini-Gantt strip below the existing text content. Make the whole card clickable — `onClick` navigates to `/console/runs/{sessionId}` via the route handler from `app.tsx`. Add a visible `Inspect →` affordance in the card's bottom-right. Cursor becomes pointer on hover. Respect `prefers-reduced-motion` for the hover lift.
3. **`QueueCard` display-only.** New component at `src/components/now/queue-card.tsx`. Renders the queue as rows: id, title, status, non-interactive priority chip, non-interactive dependency chips. Zero buttons, dropdowns, dialogs, or drag handles. Replace `QueueSnapshotCard` usage in `now-dashboard.tsx`.
4. **`RunHistoryCard` inline-expanding.** New component at `src/components/now/run-history-card.tsx`. Default: top 4 rows (status + label + timestamp + duration). A `Show all ▼` button expands the card in place, revealing a filter bar (`status`, `command`, `search`) plus a scrollable list of all runs. `Hide ▲` collapses back to 4 rows. Each row is clickable and navigates to `/console/runs/{detailId}`. Replace `RecentRunsCard` usage.
5. **`ActivityDrawer` and launcher.**
   - Move `activity-event-list.tsx`, `activity-event-row.tsx`, `activity-toolbar.tsx`, and `raw-event-panel.tsx` from `src/views/activity/` to `src/components/now/activity-drawer/`. Update imports.
   - Move any list-side selectors used by these files (e.g., `classifyFamily`) into `src/components/now/activity-drawer/selectors.ts`. Move their tests alongside.
   - Create `src/components/now/activity-drawer.tsx` (the drawer shell using shadcn `Sheet`) and `src/components/now/activity-drawer-launcher.tsx` (button + 3-item preview).
   - Drawer open state syncs to the URL query parameter `?activity=open` via `window.history.replaceState`. The launcher reads the initial value on mount.
   - Esc closes the drawer and removes the query parameter.
   - Replace `RecentActivityCard` usage with `ActivityDrawerLauncher`. The drawer itself mounts at the Now page root.
6. **`now-dashboard.tsx` reorder.** Sections top-to-bottom: `AttentionPanel` (existing, conditional render unchanged), `ActiveBuildsGrid`, `QueueCard`, two-column row `[StackSummaryCard | ActivityDrawerLauncher]`, `RunHistoryCard`. Mount `ActivityDrawer` once at the page root.
7. **Delete legacy cards and tests.** Remove `queue-snapshot-card.tsx`, `recent-activity-card.tsx`, `recent-runs-card.tsx`. Verify and delete `metric-card.tsx` and `now-state-banner.tsx` if unused after the rewrite. Remove or rewrite `now-dashboard.test.tsx` / `now-selectors.test.ts` to match the new section list.

### Key Decisions

1. **Drawer URL state = `?activity=open`** (D5/B2). One query param, no nested route.
2. **Whole-card click + visible `Inspect →` affordance** (D14/B3).
3. **Display-only queue** (D6/B1) — zero mutation endpoints called.
4. **`react-resizable-panels` not used here** — the detail route consumes it (plan-06).
5. **Drawer preview limited to 3 most recent events** to keep the launcher card narrow.

## Scope

### In Scope
- BuildPipelineStrip component.
- ActiveBuildCard rewrite (mini-Gantt + whole-card click + Inspect affordance).
- QueueCard display-only.
- RunHistoryCard inline-expanding.
- ActivityDrawer + launcher; move event-list files.
- now-dashboard.tsx reorder.
- Delete legacy cards.
- Test rewrites for the new Now layout.

### Out of Scope
- Queue mutations (out of scope per PRD).
- Build detail route (plan-06).
- Full ThreadPipeline (plan-06).

## Files

### Create
- `packages/console-ui/src/components/now/build-pipeline-strip.tsx`
- `packages/console-ui/src/components/now/queue-card.tsx`
- `packages/console-ui/src/components/now/run-history-card.tsx`
- `packages/console-ui/src/components/now/activity-drawer.tsx`
- `packages/console-ui/src/components/now/activity-drawer-launcher.tsx`
- `packages/console-ui/src/components/now/activity-drawer/activity-event-list.tsx` — moved from `src/views/activity/`.
- `packages/console-ui/src/components/now/activity-drawer/activity-event-row.tsx` — moved.
- `packages/console-ui/src/components/now/activity-drawer/activity-toolbar.tsx` — moved.
- `packages/console-ui/src/components/now/activity-drawer/raw-event-panel.tsx` — moved.
- `packages/console-ui/src/components/now/activity-drawer/selectors.ts` — moved drawer-specific selectors (e.g., `classifyFamily`).
- `packages/console-ui/src/components/now/__tests__/build-pipeline-strip.test.tsx`
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx`
- `packages/console-ui/src/components/now/__tests__/run-history-card.test.tsx`
- `packages/console-ui/src/components/now/__tests__/activity-drawer.test.tsx`
- `packages/console-ui/src/components/now/activity-drawer/__tests__/selectors.test.ts` — moved.

### Modify
- `packages/console-ui/src/components/now/active-build-card.tsx` — render `BuildPipelineStrip`; whole-card click; `Inspect →` affordance.
- `packages/console-ui/src/components/now/active-builds-grid.tsx` — pass through navigation handler.
- `packages/console-ui/src/views/now-dashboard.tsx` — reorder sections; swap component imports.
- `packages/console-ui/src/app.tsx` — pass navigation handler into NowDashboard so cards can navigate.
- Existing tests for the Now dashboard and selectors — rewrite for the new section list.
- `packages/console-ui/src/views/activity/` — remaining `index.ts` is updated (or deleted if empty) since its files have moved.

### Delete
- `packages/console-ui/src/components/now/queue-snapshot-card.tsx`
- `packages/console-ui/src/components/now/recent-activity-card.tsx`
- `packages/console-ui/src/components/now/recent-runs-card.tsx`
- `packages/console-ui/src/components/now/metric-card.tsx` — only if confirmed unused (else keep).
- `packages/console-ui/src/components/now/now-state-banner.tsx` — only if confirmed unused (else keep).
- `packages/console-ui/src/views/activity/activity-event-list.tsx` — moved.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` — moved.
- `packages/console-ui/src/views/activity/activity-toolbar.tsx` — moved.
- `packages/console-ui/src/views/activity/raw-event-panel.tsx` — moved.

## Verification

- [ ] `packages/console-ui/src/components/now/queue-snapshot-card.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/components/now/recent-activity-card.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/components/now/recent-runs-card.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/components/now/build-pipeline-strip.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/now/queue-card.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/now/run-history-card.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/now/activity-drawer.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/now/activity-drawer-launcher.tsx` exists on disk.
- [ ] Rendering the Now page produces a DOM tree containing in this top-to-bottom order: `AttentionPanel` (when active), `ActiveBuildsGrid`, `QueueCard`, a two-column row containing `StackSummaryCard` and `ActivityDrawerLauncher`, then `RunHistoryCard`.
- [ ] Each rendered `ActiveBuildCard` contains a `BuildPipelineStrip` element with one row per plan in the reduced `RunState.orchestration.plans` array, plus a PRD row when planning events exist.
- [ ] Clicking anywhere on the `ActiveBuildCard` invokes the navigation handler with the path `/console/runs/{sessionId}`.
- [ ] Each `ActiveBuildCard` renders a visible "Inspect →" affordance.
- [ ] The `QueueCard` renders zero buttons, dropdowns, dialogs, or drag handles in its DOM output.
- [ ] A test fires a `fetch` spy and asserts the `QueueCard` issues zero `fetch` or `POST` calls during render and user interaction.
- [ ] The `RunHistoryCard` initially renders at most 4 rows.
- [ ] Clicking `Show all ▼` reveals a filter bar with `status`, `command`, and `search` controls plus a scrollable list of all runs.
- [ ] Clicking each run-history row navigates to `/console/runs/{detailId}`.
- [ ] Clicking the `ActivityDrawerLauncher` opens a shadcn `Sheet` from the right and sets the URL query parameter to include `activity=open`.
- [ ] Pressing Escape closes the drawer and removes the `activity` query parameter from the URL.
- [ ] Mounting the Now page with the initial URL `?activity=open` renders the drawer in its open state.
- [ ] The opened drawer renders the same event list and toolbar previously shown by the `/console/activity` route.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
