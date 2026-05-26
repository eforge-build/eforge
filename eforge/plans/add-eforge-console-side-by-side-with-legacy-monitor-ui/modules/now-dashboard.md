# Now Dashboard

## Architecture Reference

This module implements the `now-dashboard` Expedition Module Contract from the architecture: the Console landing route at `/console/` with daemon status, auto-build/scheduler summary, queue depth, concurrent active build cards, attention items, stack layer summary, and recent activity preview.

Key constraints from architecture:
- Consume the shared Console project state and active-session detail store created by `console-shell`; do not open an additional daemon-wide SSE stream.
- Render data from existing `@eforge-build/client/browser` wire types and stream snapshots; do not duplicate daemon response interfaces.
- Support two or more concurrent active builds by rendering one live detail card per active visible session returned by the shared active-session subscription manager.
- Distinguish connecting, connected, disconnected, stale, empty, and partial-data states in the dashboard copy and visual treatment.
- Surface attention items before secondary detail: stream errors, failed queue items, failed/recently failed runs, recovery verdicts, and stale liveness.
- Render stack layer information only when `stackLayers.length > 0`; omit stack-sync operation controls.
- Do not render queue reordering, priority editing, multi-project Overseer navigation, or workflow-changing controls that lack typed client APIs.
- Preserve the project-local mental model and existing terms: daemon, queue, runs, builds, sessions, profiles, plans, and stack layers.

## Scope

### In Scope
- Replace the shell placeholder for `/console/` with a functional Now dashboard route.
- Add dashboard selectors for queue summaries, active build card models, attention items, liveness freshness, auto-build/scheduler display, stack summaries, and recent activity preview.
- Add dashboard components for status overview, attention list, active build grid, compact queue snapshot, stack summary, recent activity preview, and state banners.
- Use `getEventSummary` from `@eforge-build/client/browser` for activity summaries when it returns text; fall back to event type labels when no summary is available.
- Derive active build cards from live `RunInfo[]`, `SessionMetadata`, and `ActiveSessionDetail` data supplied by `console-shell`.
- Show both snapshot session event counts and live session event counts on active build cards.
- Extract current phase, latest agent, latest progress message, and latest error from active session live events when those events exist.
- Add empty, connecting, disconnected, stale, and partial-data dashboard states.
- Add unit tests for Now selectors, including queue summary derivation, attention item ordering, active build card derivation for two concurrent sessions, stack summary derivation, and recent activity filtering.
- Add component tests for the rendered dashboard states and absence of deferred controls.

### Out of Scope
- Creating or changing the daemon-wide SSE hook; owned by `console-shell`.
- Creating or changing active session stream subscription lifecycle; owned by `console-shell`.
- Full Queue view tables, filtering, grouping, and queue route behavior; owned by `queue-view`.
- Full Runs history tables, run detail routes, run summary fetches, plans, and diffs; owned by `runs-build-entrypoints`.
- System configuration fetch sections; owned by `system-configuration-view`.
- Activity/audit filtering and raw JSON expansion; owned by `activity-audit-view`.
- Static serving, root scripts, monitor package build graph, and legacy monitor link; owned by `static-serving-package-integration`.
- Queue reordering, priority editing, stack-sync operation controls, multi-daemon views, Overseer language, or new daemon APIs.
- Importing legacy monitor UI application reducers, layout, timeline, graph, heatmap, or route components.

## Implementation Approach

### Overview

Implement the Now dashboard as a pure consumer of the shared shell state. The dashboard receives `ConsoleProjectState` and `UseActiveSessionStreamsResult` from `App`, calls pure selectors to derive compact view models, and renders cards in an attention-first order.

Route layout for `/console/`:

1. **Connection/state banner** at the top of the route panel when the daemon stream is connecting, disconnected, stale, or partially populated.
2. **Status overview row** with daemon connection, auto-build mode, scheduler capacity, queue depth, running build count, subscribers, uptime, and last update time.
3. **Attention section** that appears when there is a stream error, stale heartbeat, failed queue item, queue item with recovery verdict, active session error, or recent failed run.
4. **Active builds grid** with one card per active session, including plan set/command/status, metadata profile/plan count, current phase, latest agent, latest progress/error, event counts, and link to `/console/runs`.
5. **Queue snapshot and recent runs** compact cards, using counts and top few items only; full exploration remains in Queue and Runs modules.
6. **Stack summary** only when stack layers exist, grouped by status/provider/stack id without stack-sync controls.
7. **Recent activity preview** with the latest non-heartbeat daemon activity entries and a link to `/console/activity`.

The route remains read-only. Links navigate to existing Console routes with normal anchors; no workflow-changing buttons are added.

### Key Decisions

1. **Use selector-owned view models.** Components render `NowStatusSummary`, `NowAttentionItem`, `NowActiveBuildCard`, `NowQueueSummary`, `NowStackSummary`, and `NowActivityPreviewItem` models from `src/lib/selectors/now.ts`. This keeps component tests simple and prevents daemon wire shape duplication.
2. **Treat stale liveness as a UI state, not a daemon error.** A helper compares `Date.now()` with `state.lastEventAt`, `state.latestHeartbeat?.at`, and `state.liveness.timestamp`; the default stale threshold is 30 seconds. The banner text says `No daemon heartbeat in {duration}` without marking the daemon failed.
3. **Use `runs` as the active-build identity source.** The dashboard maps each active session id to the most recent active `RunInfo` for that session. Session metadata and active stream detail enrich the card, but a card still renders when stream detail is connecting or unavailable.
4. **Infer live detail only from typed events already present.** Current phase uses latest `phase:start` or terminal `phase:end`; latest agent uses latest `agent:start`, `agent:activity`, `agent:result`, or `agent:stop`; progress uses latest `plan:build:progress`; error uses latest event with an `error` or `message` field for known warning/error/failure types. Unknown event types contribute to counts but do not create invented labels.
5. **Limit previews.** The dashboard shows at most five attention items, four queue rows, four recent run rows, six stack layer rows, and six recent activity rows. Counts indicate omitted items. Dedicated routes own complete lists.
6. **Render recovery verdict chips from embedded queue payloads only.** A failed queue item with `recoveryVerdict` displays `{verdict} / {confidence}`. A failed queue item without `recoveryVerdict` displays `recovery pending`. No sidecar fetch or apply action is added in this module.
7. **Use existing route helpers for in-app links.** Dashboard links use `toConsolePath('queue')`, `toConsolePath('runs')`, and `toConsolePath('activity')` from `src/lib/navigation.ts`; no hardcoded API route literal is introduced.
8. **Keep stack layer summary observational.** Stack layers are grouped by current `status` and `stackId` where present. The card contains labels, counts, and top layer rows; it contains no stack-sync, rebase, land, retry, or reorder controls.

## Data Contract

### Inputs
- `ConsoleProjectState` from `src/lib/project-state.ts`:
  - `connectionStatus`
  - `runs`
  - `queue`
  - `sessionMetadata`
  - `autoBuild`
  - `liveness`
  - `latestHeartbeat`
  - `recentActivity`
  - `stackLayers`
  - `lastSnapshotAt`
  - `lastEventAt`
  - `error`
- `UseActiveSessionStreamsResult` from `src/hooks/use-active-session-streams.ts`:
  - `sessions`
  - `activeSessionIds`
  - `subscriptionCount`
- `now?: number` injection in selectors for deterministic freshness tests.

### Derived View Models
- `NowDashboardModel`:
  - `connectionBanner: NowBanner | null`
  - `status: NowStatusSummary`
  - `attention: NowAttentionItem[]`
  - `activeBuilds: NowActiveBuildCard[]`
  - `queue: NowQueueSummary`
  - `recentRuns: NowRecentRunItem[]`
  - `stack: NowStackSummary | null`
  - `activity: NowActivityPreviewItem[]`
  - `hasSnapshot: boolean`
- `NowActiveBuildCard`:
  - `sessionId`
  - `runId`
  - `planSet`
  - `command`
  - `status`
  - `startedAt`
  - `durationMs`
  - `cwd`
  - `profile`
  - `planCount`
  - `streamStatus`
  - `snapshotEventCount`
  - `liveEventCount`
  - `currentPhase`
  - `latestAgent`
  - `latestProgress`
  - `latestError`
  - `href`
- `NowAttentionItem` severity values: `critical`, `warning`, `info`.

### State Rendering Contract
- **Connecting:** before the first snapshot, display a route-level `Connecting to daemon stream` banner and skeleton-like placeholder cards with zero counts labeled as pending.
- **Disconnected/error:** display a route-level `Daemon stream disconnected` banner with the error string from state; continue rendering the last known snapshot if present.
- **Stale:** display a route-level `Daemon heartbeat stale` banner when the freshness helper exceeds the stale threshold; continue rendering last known values with a stale label.
- **Empty:** when connected and queue/runs/activity/stack collections are empty, render explicit empty copy in each card: `Queue is empty`, `No active builds`, `No stack layers recorded`, and `No recent activity in the daemon snapshot`.
- **Partial data:** when the daemon stream has connected but an optional collection is absent in a future-compatible state shape, render `Unavailable from daemon snapshot` for that card rather than inventing a value.

## Files

### Create
- `packages/console-ui/src/views/now-dashboard.tsx` — route-level Now dashboard component that receives `projectState` and `activeSessions`, calls `selectNowDashboardModel`, and renders the dashboard sections.
- `packages/console-ui/src/components/now/now-state-banner.tsx` — connection, disconnected, stale, and partial-data banner component for the top of the dashboard.
- `packages/console-ui/src/components/now/now-status-overview.tsx` — status cards for daemon connection, auto-build mode, scheduler capacity, queue depth, active builds, uptime, subscribers, and last update.
- `packages/console-ui/src/components/now/attention-panel.tsx` — attention-first list of stream errors, stale heartbeat, failed queue items, recovery verdicts, active session errors, and recent failed runs.
- `packages/console-ui/src/components/now/active-builds-grid.tsx` — responsive grid that renders one `ActiveBuildCard` per active session and an empty state when none exist.
- `packages/console-ui/src/components/now/active-build-card.tsx` — single active session summary with run identity, metadata, stream status, phase/agent/progress/error summaries, event counts, duration, and Runs link.
- `packages/console-ui/src/components/now/queue-snapshot-card.tsx` — compact queue counts and top queue rows with dependency and recovery verdict labels; links to `/console/queue`.
- `packages/console-ui/src/components/now/recent-runs-card.tsx` — compact recent run rows with status, plan set, command, duration, and link to `/console/runs`.
- `packages/console-ui/src/components/now/stack-summary-card.tsx` — read-only stack layer counts and top rows; returns `null` when `stackLayers.length === 0`.
- `packages/console-ui/src/components/now/recent-activity-card.tsx` — recent non-heartbeat activity list with timestamp, event type, summary, and link to `/console/activity`.
- `packages/console-ui/src/components/now/metric-card.tsx` — small bordered metric card used by the status overview.
- `packages/console-ui/src/lib/selectors/now.ts` — pure selector functions and dashboard view model types. Imports wire types from `@eforge-build/client/browser` or `src/lib/types`; does not redeclare queue/run/session/stack wire shapes.
- `packages/console-ui/src/lib/format.ts` — Console-local formatting helpers for relative time, duration, timestamps, status labels, and truncated identifiers if `console-shell` has not already created equivalent helpers.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — unit tests for dashboard selectors and view model derivation.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — component tests for populated, empty, connecting, disconnected, stale, and deferred-control-absence states.

### Modify
- `packages/console-ui/src/app.tsx` — render `NowDashboard` for the `now` route and keep other route placeholders unchanged `[region: now-dashboard, Now route component branch only]`.
- `packages/console-ui/src/lib/selectors/index.ts` — export Now selectors after shell selector exports `[region: now-dashboard, exports from ./now]`.
- `packages/console-ui/src/lib/navigation.ts` — only if shell did not already create Now metadata, add or replace the `now` route metadata entry with label `Now` and href `/console/` `[region: now-dashboard, now nav item]`.
- `packages/console-ui/src/components/ui/index.ts` — only if the implementation needs shared primitive exports added by this module, append exports for already-created primitives; prefer direct imports from primitive files to avoid this edit `[region: now-dashboard, append-only primitive exports if needed]`.

## Shared File Region Declarations

`packages/console-ui/src/app.tsx`:
```tsx
// --- eforge:region now-dashboard ---
import { NowDashboard } from './views/now-dashboard';

// Inside the shell-owned route switch only:
if (route.id === 'now') {
  return (
    <NowDashboard
      projectState={daemon.state}
      activeSessions={activeSessions}
    />
  );
}
// --- eforge:endregion now-dashboard ---
```

`packages/console-ui/src/lib/selectors/index.ts`:
```ts
// --- eforge:region now-dashboard ---
export * from './now';
// --- eforge:endregion now-dashboard ---
```

`packages/console-ui/src/lib/navigation.ts`:
```ts
// --- eforge:region now-dashboard ---
{
  id: 'now',
  label: 'Now',
  href: toConsolePath('now'),
  description: 'Live project status',
}
// --- eforge:endregion now-dashboard ---
```

## Component Boundaries

- `NowDashboard` owns section ordering and passes only view models to child components.
- `NowStateBanner` owns route-level live-state copy and status-specific iconography.
- `NowStatusOverview` owns high-level daemon/auto-build/scheduler metrics.
- `AttentionPanel` owns item severity rendering and recovery verdict labels.
- `ActiveBuildsGrid` owns active build empty state and card grid layout.
- `ActiveBuildCard` owns one session card and reads no global state.
- `QueueSnapshotCard`, `RecentRunsCard`, `StackSummaryCard`, and `RecentActivityCard` own compact previews and route links to complete views.
- Shared formatting helpers contain no React imports.
- Selector functions contain no DOM or React imports.

## Selector Details

### Queue Summary
`selectNowQueueSummary(queue)` returns:
- `total`
- `byStatus: Record<string, number>`
- `runningCount`
- `pendingCount`
- `failedCount`
- `waitingCount`
- `withDependenciesCount`
- `withRecoveryVerdictCount`
- `topItems` sorted by status attention order: failed, running, waiting, pending, then any other status; tie-break by higher priority, then older `created`, then `id`.

### Attention Items
`selectNowAttentionItems(state, activeDetails, now)` returns ordered items:
1. Stream disconnected/error.
2. Stale heartbeat.
3. Active session stream error.
4. Failed queue items with recovery verdict.
5. Failed queue items without recovery verdict.
6. Recent failed runs, newest first.
7. Queue items blocked by dependencies.

Limit render to five items and expose `hiddenCount` for the panel footer.

### Active Build Cards
`selectNowActiveBuildCards(state.runs, state.sessionMetadata, activeDetails, now)`:
- Groups active runs by `sessionId` using the shell's active-session criteria or imported `isActiveRun` helper when available.
- Picks the newest active run per session by `startedAt`.
- Sorts newest active session first.
- Joins `sessionMetadata[sessionId]` for `baseProfile` and `planCount`.
- Joins `activeDetails.sessions[sessionId]` for stream status and events.
- Reads current phase from latest `phase:start` or `phase:end` live event.
- Reads latest agent from latest `agent:start`, `agent:activity`, `agent:result`, or `agent:stop` live event.
- Reads latest progress from latest `plan:build:progress` live event.
- Reads latest error from active detail error or latest known event with error/message fields in error/warning/failure event families.
- Preserves a card when active detail is missing by setting `streamStatus: 'connecting'` and event counts to zero.

### Status Summary
`selectNowStatusSummary(state, activeDetails, now)`:
- Uses `state.connectionStatus` for stream state.
- Uses `state.autoBuild.mode`, `state.autoBuild.desired`, `state.autoBuild.scheduler`, `state.autoBuild.watcher`, and `state.liveness.autoBuild` fields when present.
- Uses `state.latestHeartbeat.payload.queueDepth` and `.runningBuilds` when present; otherwise falls back to derived queue and active build counts.
- Uses `state.liveness.uptime`, `.subscribers`, and `.timestamp` for daemon heartbeat metrics.
- Computes `lastUpdateMsAgo` from `state.lastEventAt ?? state.lastSnapshotAt`.

### Stack Summary
`selectNowStackSummary(stackLayers)` returns `null` for an empty array. For a non-empty array, it returns counts by `status`, counts by `stackId`, and up to six rows with `prdId`, `stackId`, `provider`, `branch`, `baseBranch`, `status`, and landing status when present.

### Recent Activity
`selectNowRecentActivity(state.recentActivity)`:
- Filters out `daemon:heartbeat` events by default.
- Sorts newest first by activity id and event timestamp fallback.
- Uses `getEventSummary(event)` when available.
- Falls back to `event.type` when summary is undefined.
- Limits to six rows and exposes `hiddenCount`.

## Testing Strategy

### Unit Tests
- `now-selectors.test.ts`:
  - Queue summary counts `running`, `pending`, `waiting`, `failed`, dependencies, and recovery verdicts from a `QueueItem[]` fixture.
  - Queue top items order failed items before running, waiting, pending, and other statuses.
  - Attention items place stream error before stale heartbeat and failed queue items.
  - Attention items label failed queue items with `retry / high`, `split / medium`, `abandon / low`, or `manual / high` when `recoveryVerdict` exists.
  - Active build derivation returns two card models for two active runs with distinct session IDs.
  - Active build derivation de-duplicates multiple active run rows for one session and selects the newest `startedAt`.
  - Active build derivation excludes completed runs with `completedAt`.
  - Active build card derives current phase from a `phase:start` event and latest agent from an `agent:start` event.
  - Active build card derives latest progress from `plan:build:progress` and latest error from `plan:build:failed`.
  - Status summary uses `autoBuild.scheduler.runningCount` and `.limit` when present.
  - Status summary falls back to active card count when scheduler running count is absent.
  - Stack summary returns `null` for an empty stack layer array and returns status counts for populated layers.
  - Recent activity filters heartbeat events and uses event summaries for non-heartbeat events.
  - Stale helper returns stale when the last heartbeat is older than 30 seconds.

### Component Tests
- `now-dashboard.test.tsx`:
  - Populated render includes section headings `Attention`, `Active builds`, `Queue`, `Recent runs`, `Stack layers`, and `Recent activity` when corresponding data exists.
  - Two concurrent active sessions render two active build cards with their session identifiers or plan set labels.
  - Empty connected render includes `Queue is empty`, `No active builds`, and `No recent activity in the daemon snapshot`.
  - Connecting render includes `Connecting to daemon stream` before the first snapshot.
  - Disconnected render includes `Daemon stream disconnected` and the stream error text.
  - Stale render includes `Daemon heartbeat stale` when selector input time exceeds the stale threshold.
  - Stack summary section is absent when `stackLayers` is an empty array.
  - Rendered output contains no buttons or links with text matching `reorder`, `edit priority`, `overseer`, `sync stack`, `rebase stack`, or `land stack` case-insensitively.

### Integration Tests
- Run package-level checks after implementation:
  - `pnpm --filter @eforge-build/console-ui test -- now`
  - `pnpm --filter @eforge-build/console-ui type-check`
  - `pnpm --filter @eforge-build/console-ui build`
- Existing Console guard tests from `console-shell` cover no engine imports and no hardcoded `/api/` route literals for files added by this module.

## Verification

- [ ] `/console/` renders `Now` dashboard content instead of the shell placeholder.
- [ ] The Now dashboard receives project state and active session detail from shell-owned props or context and creates no `subscribeWithSnapshot` call.
- [ ] `packages/console-ui/src/lib/selectors/now.ts` imports queue, run, session metadata, event, auto-build, and stack types from `@eforge-build/client/browser` or `src/lib/types`.
- [ ] `packages/console-ui/src/lib/selectors/now.ts` contains no local interface named `QueueItem`, `RunInfo`, `SessionMetadata`, `AutoBuildState`, or `StackLayerWire`.
- [ ] A fixture with two active runs using distinct `sessionId` values produces two active build card view models.
- [ ] A rendered fixture with two active sessions displays two active build cards.
- [ ] Completed runs with `completedAt` do not appear in active build cards.
- [ ] The dashboard displays daemon connection state, auto-build mode or desired state, queue depth, active build count, and last update time.
- [ ] Scheduler capacity displays `runningCount / limit` when both values exist in `autoBuild.scheduler`.
- [ ] Failed queue items display recovery verdict and confidence text when `recoveryVerdict` exists.
- [ ] Failed queue items without `recoveryVerdict` display `recovery pending`.
- [ ] The stack summary component returns `null` for an empty stack layer array.
- [ ] A non-empty stack layer fixture renders stack id, provider, branch, and status text.
- [ ] Recent activity preview omits `daemon:heartbeat` entries by default.
- [ ] Recent activity preview displays fallback event type text when `getEventSummary` returns undefined.
- [ ] Connecting state displays `Connecting to daemon stream` before the first snapshot.
- [ ] Disconnected state displays `Daemon stream disconnected` and the stored error string.
- [ ] Stale state displays `Daemon heartbeat stale` when the last heartbeat age exceeds 30 seconds in selector tests.
- [ ] Empty connected state displays `Queue is empty`, `No active builds`, and `No recent activity in the daemon snapshot`.
- [ ] Dashboard source contains no text labels matching `reorder`, `edit priority`, `Overseer`, `sync stack`, `rebase stack`, or `land stack`.
- [ ] `pnpm --filter @eforge-build/console-ui test -- now` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
