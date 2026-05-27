# @eforge-build/console-ui

The active monitoring dashboard for eforge. This package replaces `packages/monitor-ui/`, which is retained as the legacy implementation until the port is fully baked.

## Route table

The canonical route list lives in [`src/lib/navigation.ts`](src/lib/navigation.ts). The current routes are:

| Path | Route ID | Description |
|------|----------|-------------|
| `/console/` | `now` | Now dashboard - active builds, queue, and live status |
| `/console/runs/:detailId` | `runDetail` | Build detail view for a specific run |
| `/console/system` | `system` | System - configuration, profiles, playbooks, extensions, and diagnostic surfaces |

All unrecognized paths (including previously removed routes) redirect to `now`.

## Data flow

```
daemon SSE
  → useActiveSessionStreams  (src/hooks/use-active-session-streams.ts)
  → reducer at src/lib/run-state/
  → selectors                (src/lib/selectors/ and src/lib/run-state/selectors/)
  → views
```

The `useActiveSessionStreams` hook subscribes to per-session SSE streams for all active session IDs. Each stream's events are folded through the run-state reducer to produce a `RunState` snapshot. Selectors derive view-ready data from those snapshots without mutating state.

The reducer implementation is shared with `packages/monitor-ui/` (dual-reducer constraint) to keep both dashboards in sync during the transition period.

## Adding a new control surface

- **Header entry** - add a link to `src/components/header/control-surface-links.tsx`. Header links are always visible and navigate between top-level routes.
- **System route entry** - add a panel or section under `src/views/system/`. The system route is the home for configuration and diagnostic surfaces that do not need top-level navigation prominence.

## Dev

```bash
pnpm dev:console
```

Starts the Vite dev server for console-ui only (alias for `pnpm --filter @eforge-build/console-ui dev`).
