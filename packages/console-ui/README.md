# @eforge-build/console-ui

The active monitoring dashboard for eforge. This package replaces `packages/monitor-ui/`, which is retained as the legacy implementation until the port is fully baked.

## Route table

The canonical route list lives in [`src/lib/navigation.ts`](src/lib/navigation.ts). The current routes are:

| Path | Route ID | Description |
|------|----------|-------------|
| `/console/` | `now` | Now dashboard - active builds, queue, and live status |
| `/console/runs/:detailId` | `runDetail` | Build detail view for a specific run |
| `/console/plans` | `plans` | Planning Workspace - read-only view of session plans with metadata, readiness, and markdown preview |
| `/console/system` | `system` | System - configuration, profiles, playbooks, extensions, and diagnostic surfaces |

All unrecognized paths (including previously removed routes) redirect to `now`.

## Data flow

```
daemon SSE
  → useActiveSessionStreams  (src/hooks/use-active-session-streams.ts)
  → reducer at src/lib/run-state/
  → selectors                (src/lib/selectors/ and src/lib/run-state/selectors/)
  → views

daemon REST (session plans)
  → API_ROUTES.sessionPlanList  GET /api/session-plan/list[?includeSubmitted=true]
  → API_ROUTES.sessionPlanShow  GET /api/session-plan/show?session=:session
  → use-session-plans.ts        (src/views/plans/use-session-plans.ts)
  → PlansView
```

The `useActiveSessionStreams` hook subscribes to per-session SSE streams for all active session IDs. Each stream's events are folded through the run-state reducer to produce a `RunState` snapshot. Selectors derive view-ready data from those snapshots without mutating state.

The reducer implementation is shared with `packages/monitor-ui/` (dual-reducer constraint) to keep both dashboards in sync during the transition period.

The Planning Workspace (`/console/plans`) uses REST requests rather than SSE. It calls `API_ROUTES.sessionPlanList` to fetch the list of session plans (filtering to active plans by default, or including handed-off/submitted plans when the toggle is enabled), then calls `API_ROUTES.sessionPlanShow` after the user selects a plan to retrieve full metadata, readiness detail, and the markdown body. No daemon state is derived from the list response alone - the detail panel always fetches from `sessionPlanShow`.

## Adding a new control surface

- **Top-level Console route** - add route metadata and a nav item to `src/lib/navigation.ts` (update `ConsoleRouteBaseId`, `consoleRouteOrder`, `ROUTE_LABELS`, `toConsolePath`, `parseConsoleRoute`, and `buildNavItems`). `ControlSurfaceLinks` renders internal nav buttons automatically from `buildNavItems()`, so no direct edits to `src/components/header/control-surface-links.tsx` are needed for standard routes.
- **Non-route or external links** - add them directly to `src/components/header/control-surface-links.tsx` (e.g., the Monitor back-link that points outside the Console).
- **System route entry** - add a panel or section under `src/views/system/`. The system route is the home for configuration and diagnostic surfaces that do not need top-level navigation prominence.

## Dev

```bash
pnpm dev:console
```

Starts the Vite dev server for console-ui only (alias for `pnpm --filter @eforge-build/console-ui dev`).
