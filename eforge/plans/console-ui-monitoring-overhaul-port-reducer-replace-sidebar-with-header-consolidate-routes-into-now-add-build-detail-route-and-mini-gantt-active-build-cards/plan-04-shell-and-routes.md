---
id: plan-04-shell-and-routes
name: Replace sidebar with header, delete legacy routes
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-04-shell-and-routes
agents:
  builder:
    effort: high
    rationale: Wide-impact IA change touching shell, navigation, app.tsx route
      table, and multiple view directories deleted at once. Must keep type-check
      + build green.
---

---
id: plan-04-shell-and-routes
name: Replace sidebar with header, delete legacy routes
depends_on: [plan-02-deps-and-shadcn]
---

# Replace sidebar with header, delete legacy routes

## Architecture Context

The console-ui shell currently renders `<Sidebar /> + <main /> + <StatusStrip />`. The new IA replaces the left sidebar with a top header that absorbs the bottom status strip's content (connection dot, auto-build toggle, last-update timestamp, queue-count chip, active-count chip) and exposes a slot for future control-surface links. The route table contracts from 5 entries (`now`, `queue`, `runs`, `system`, `activity`) to 3 (`now`, `runDetail`, `system`), with the deleted routes' content folded into the Now page in plan-05.

This plan lands the shell shape and the route-table reduction, including deletion of `views/queue/`, `views/activity/`, and the list-side of `views/runs/`. The Now dashboard continues to render its existing components in this plan (the Now rewrite happens in plan-05). For deleted routes, navigating to `/console/queue`, `/console/runs`, or `/console/activity` redirects to Now per the new `parseConsoleRoute` rules.

## Implementation

### Overview

1. **Header component family.** Create `src/components/header/` with `header.tsx` (top-level layout, `h-12` ish), `connection-indicator.tsx`, `auto-build-toggle.tsx`, `project-name-chip.tsx`, `control-surface-links.tsx` (slot for future links). Use shadcn `Switch` for auto-build toggle and `Tooltip` for chip hover details. Truncation order on overflow: timestamp first, then queue/active chips.
2. **Shell restructure.** Rewrite `src/components/shell/console-shell.tsx` to render `<Header />` followed by `<main />` only. Delete `sidebar.tsx` and `status-strip.tsx`. The shell no longer accepts `currentRoute` for sidebar highlight purposes — header logo + control links replace that affordance.
3. **Route table reduction.** Update `src/lib/navigation.ts`:
   - Replace `ConsoleRouteId` with the discriminated union `'now' | 'system' | { id: 'runDetail'; detailId: string }`.
   - `consoleRouteOrder` becomes `['now', 'runDetail', 'system']`.
   - `parseConsoleRoute('/console/queue')`, `/console/runs`, and `/console/activity` all return `'now'`.
   - `parseConsoleRoute('/console/runs/{detailId}')` returns `{ id: 'runDetail', detailId }`.
   - `toConsolePath` produces `/console/runs/{detailId}` for the run detail route.
   - Remove `consoleRouteOrder` entries for the deleted routes and the matching `ROUTE_LABELS` and region annotations.
4. **app.tsx update.** Remove the imports and route branches for `queue`, `runs` (list), and `activity`. Add a runDetail branch that mounts a minimal placeholder component (e.g. `<RoutePlaceholder routeId="runDetail" />`); the full `BuildDetailView` lands in plan-06. Drop the `currentRoute` prop chain into the (now headerless) shell where no longer needed.
5. **Delete legacy view directories.**
   - Delete entire `src/views/queue/` directory.
   - Delete entire `src/views/activity/` directory **except** files that move to the activity drawer (plan-05). Since plan-05 will move `activity-event-list.tsx`, `activity-event-row.tsx`, `activity-toolbar.tsx`, and `raw-event-panel.tsx` into the new drawer location, this plan **keeps** those four files in their current location and lets plan-05 move them. Delete only `activity-view.tsx`, `index.ts`, and the `activity-selectors.test.ts` parts that are list-view specific.
   - Delete the list-side of `src/views/runs/`: `runs-view.tsx`, `runs-filter-bar.tsx`, `runs-day-groups.tsx`, `run-history-table.tsx`, `active-runs-panel.tsx`, and `index.ts`'s list export. Keep `run-detail-panel.tsx`, `run-events-preview.tsx`, `run-plans-preview.tsx`, `status-pill.tsx`, `time-format.ts` (plan-06 consumes them).
6. **Test cleanup.** Delete tests for removed views: `queue-view.test.tsx`, `queue-selectors.test.ts`, `activity-view.test.tsx`, the list-view portion of `activity-selectors.test.ts`, `runs-view.test.tsx`, and the list-view portion of `runs-selectors.test.ts`. Selectors that survive (e.g., `classifyFamily` used by the drawer) keep their tests.
7. **Shell tests.** Update or replace existing shell tests to assert header presence and the absence of sidebar/status-strip DOM elements.

### Key Decisions

1. **Header replaces both sidebar and status strip in one move** to avoid a transient two-shell intermediate state.
2. **`runDetail` placeholder only in this plan.** plan-06 mounts the full `BuildDetailView`.
3. **Activity event-list/toolbar/raw-event-panel files stay put** until plan-05 moves them into the drawer location. This avoids touching them twice.
4. **No `react-router`.** Continue extending the minimal `parseConsoleRoute`/`toConsolePath` pair (D12).

## Scope

### In Scope
- Create header component family.
- Delete sidebar, status-strip.
- Trim navigation.ts to 3 route IDs.
- Update app.tsx routing.
- Delete `views/queue/`, list-side of `views/runs/`, and `activity-view.tsx`.
- Delete tests for removed views.
- Add new shell-shape tests.

### Out of Scope
- Now page section rewrites (plan-05).
- BuildDetailView component (plan-06).
- Activity drawer (plan-05 moves the surviving event-list files into `src/components/now/activity-drawer/`).

## Files

### Create
- `packages/console-ui/src/components/header/header.tsx`
- `packages/console-ui/src/components/header/connection-indicator.tsx`
- `packages/console-ui/src/components/header/auto-build-toggle.tsx`
- `packages/console-ui/src/components/header/project-name-chip.tsx`
- `packages/console-ui/src/components/header/control-surface-links.tsx`
- `packages/console-ui/src/__tests__/header.test.tsx` — DOM assertions on header content.

### Modify
- `packages/console-ui/src/components/shell/console-shell.tsx` — render header + main only.
- `packages/console-ui/src/lib/navigation.ts` — update `ConsoleRouteId` discriminated union; rewrite `parseConsoleRoute`/`toConsolePath`/`consoleRouteOrder`/`buildNavItems`; remove dead region annotations.
- `packages/console-ui/src/app.tsx` — remove queue/runs/activity branches; add runDetail placeholder branch; remove `currentRoute` prop where unused; drop dead region annotations.
- `packages/console-ui/src/__tests__/console-shell.test.tsx` (or current equivalent) — assert header presence and sidebar/status-strip absence.
- `packages/console-ui/src/__tests__/navigation.test.ts` (or equivalent) — assert new route parsing rules.

### Delete
- `packages/console-ui/src/components/shell/sidebar.tsx`
- `packages/console-ui/src/components/shell/status-strip.tsx`
- `packages/console-ui/src/views/queue/` (entire directory)
- `packages/console-ui/src/views/activity/activity-view.tsx`
- `packages/console-ui/src/views/activity/index.ts`
- `packages/console-ui/src/views/runs/runs-view.tsx`
- `packages/console-ui/src/views/runs/runs-filter-bar.tsx`
- `packages/console-ui/src/views/runs/runs-day-groups.tsx`
- `packages/console-ui/src/views/runs/run-history-table.tsx`
- `packages/console-ui/src/views/runs/active-runs-panel.tsx`
- `packages/console-ui/src/views/runs/index.ts` (rewrite or delete depending on what plan-06 needs)
- `packages/console-ui/src/__tests__/queue-view.test.tsx`
- `packages/console-ui/src/__tests__/queue-selectors.test.ts`
- `packages/console-ui/src/__tests__/activity-view.test.tsx`
- `packages/console-ui/src/__tests__/runs-view.test.tsx`
- List-view portions of `activity-selectors.test.ts` and `runs-selectors.test.ts` (keep selectors that still exist; remove tests for selectors that have been deleted).

## Verification

- [ ] `packages/console-ui/src/components/shell/sidebar.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/components/shell/status-strip.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/views/queue/` directory does not exist on disk.
- [ ] `packages/console-ui/src/views/activity/activity-view.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/views/runs/runs-view.tsx` does not exist on disk.
- [ ] `packages/console-ui/src/components/header/header.tsx` exists on disk.
- [ ] `parseConsoleRoute('/console/queue')` returns `'now'`.
- [ ] `parseConsoleRoute('/console/runs')` returns `'now'`.
- [ ] `parseConsoleRoute('/console/runs/abc123')` returns an object whose `id === 'runDetail'` and `detailId === 'abc123'`.
- [ ] `parseConsoleRoute('/console/activity')` returns `'now'`.
- [ ] `parseConsoleRoute('/console/system')` returns `'system'`.
- [ ] The exported `consoleRouteOrder` array contains exactly the IDs `now`, `runDetail`, `system` in that order.
- [ ] Rendering `<ConsoleShell />` in the header test produces a DOM tree whose first child is a top header element.
- [ ] The rendered header contains the eforge logo SVG, project repo basename, connection-status indicator, auto-build toggle, last-update timestamp, queue-count chip, and active-count chip.
- [ ] No DOM element with `role="navigation"` and a vertical orientation appears in the rendered shell.
- [ ] No footer or bottom status strip is rendered in the shell.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `grep -rn "console/queue\|console/runs[^/]\|console/activity" packages/console-ui/src/` returns zero matches (the `[^/]` excludes the new `/console/runs/:detailId` path).
