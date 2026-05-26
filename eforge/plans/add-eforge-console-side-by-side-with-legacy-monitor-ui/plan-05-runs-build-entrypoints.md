---
id: plan-05-runs-build-entrypoints
name: Implement Runs and build detail entry points with run history, active
  session grouping, status rollups, and bounded use of live active-session
  detail.
branch: add-eforge-console-side-by-side-with-legacy-monitor-ui/runs-build-entrypoints
---

# Runs and Build Detail Entry Points

## Architecture Reference

This module implements the **Runs and Build Detail Entry Points** Expedition module contract from the architecture. It adds the Console `/console/runs` route content that answers: "What has run recently and where can I inspect active or historical build details?"

Key constraints from architecture:
- Consume live `RunInfo[]` and `SessionMetadata` from the shared Console daemon stream store created by `console-shell`.
- Consume active-session detail from `useActiveSessionStreams()`; do not open per-session SSE streams from this module and do not subscribe to historical run rows.
- Use `@eforge-build/client/browser` route constants, `buildPath`, and browser-safe wire types for all REST detail fetches.
- Do not import old monitor UI application code, reducers, timeline, graph, heatmap, or session-detail components.
- Do not duplicate daemon-owned wire response interfaces for runs, session metadata, run summaries, run state, plans, or diffs.
- Keep phase 1 detail at entry-point level: active grouping, history list, selected-session summary/state/plans preview, and drill-in affordances grounded in existing routes.
- Render empty, connecting/loading, disconnected/error, and unavailable-detail states.
- Do not render queue editing, priority editing, stack-sync operation controls, multi-project Overseer navigation, or future-only build controls.

Dependencies:
- `console-shell` creates `packages/console-ui`, shared primitives, navigation, route skeleton, daemon state hook, active-session stream manager, `fetchJson`, and active-build selectors.

Downstream users:
- The Now dashboard can link to `/console/runs?session=<id>` for active build cards.
- The Activity view can link event/session identifiers to the Runs route after this module establishes the selected-session query contract.

## Scope

### In Scope
- Replace the `/console/runs` placeholder with a functional Runs view.
- Group live runs by active session, historical session, and non-session plan-set/run groups.
- Compute run status rollups, started/completed times, duration labels, command lists, profile/plan-count labels, event counts when fetched, and plan status counts when fetched.
- Show active runs first and render one active group for each active session in the shared active-session detail store.
- Display bounded live details for active sessions from `UseActiveSessionStreamsResult.sessions`, including connection status, snapshot event count, live event count, latest event type, and terminal/disconnected stream states.
- Display a history table/list for recent non-active run groups derived from live `RunInfo[]`.
- Add a selected-session detail panel driven by `?session=<id>` or local selection.
- Fetch selected session details on demand using existing typed routes:
  - `buildPath(API_ROUTES.runSummary, { id })`
  - `buildPath(API_ROUTES.runState, { id })`
  - `buildPath(API_ROUTES.plans, { runId: id })`
- Show summary sections for runs, plans, current phase/agent, event counts, recent persisted event rows, and generated plan entries when the fetches succeed.
- Add selector tests for grouping, status rollups, active/history partitioning, sorting, and selected-session metadata projection.
- Add component tests for active concurrent sessions, history rows, empty state, connecting state, disconnected state, and selected-detail fetch states.

### Out of Scope
- Creating `packages/console-ui` package foundations; owned by `console-shell`.
- Opening or managing per-session SSE subscriptions; owned by `console-shell`.
- Full legacy monitor timeline, graph, pipeline, heatmap, diff viewer, or console log parity.
- Copying legacy monitor UI reducers or application components.
- Queue mutation controls, priority edits, queue reordering, recovery apply/retry controls, cancel build controls, or stack-sync operation controls.
- Adding new daemon REST routes, SSE event shapes, DB projections, or client wire interfaces.
- Static `/console/` serving, package scripts, and legacy monitor link; owned by `static-serving-package-integration`.
- System/profile/model/config fetching; owned by `system-configuration-view`.

## Implementation Approach

### Overview

Implement the Runs view as a self-contained route under `packages/console-ui/src/views/runs/`. The module consumes the shell's live `ConsoleProjectState`, active-session stream detail map, and connection status. Pure selectors in `src/lib/selectors/runs.ts` transform client-owned `RunInfo` and `SessionMetadata` wire types into UI view models.

The route layout uses three stacked areas:

1. **Active runs section** — first section, one bordered card per currently active session. Each card shows run rollup status, plan set, commands, profile/plan count, live stream status, live/snapshot event counts, latest event type, latest update time, and a button/link that selects the session detail panel.
2. **Run history section** — compact table/list for historical session groups and non-session plan-set groups, sorted newest first. Rows show status, plan set, command sequence, started/completed times, duration, cwd, session id or group key, and metadata labels when present.
3. **Selected detail panel** — shown beside the list on wide screens and below it on narrow screens. It fetches summary/state/plans only for the selected group. The panel distinguishes loading, not found/empty, fetch failed, and partial success states per request.

Selection contract:
- The view reads `session` from `window.location.search` when mounted.
- Selecting a group updates browser history to `/console/runs?session=<encoded id>` without full page reload.
- If no selection exists and active groups exist, the first active group is highlighted but no REST fetch starts until the user clicks **Inspect run**. This prevents background fetches for every active/historical row.
- If no selection exists and there are only history groups, the detail panel displays a neutral "Select a run" state.

Data sources:
- Live data: `projectState.runs`, `projectState.sessionMetadata`, `projectState.connectionStatus`, and `activeSessionStreams.sessions`.
- On-demand fetched data: `RunSummary`, `RunState`, and `PlansResponse` via `fetchJson` and `API_ROUTES` constants.
- No source in this module imports from `@eforge-build/engine`, `packages/monitor/src`, or legacy monitor UI app code.

Available actions:
- Navigate/select a run group for inspection.
- Open generated plan bodies in a local disclosure/preview inside the selected detail panel.
- Copy a session id or run id to the clipboard only if implemented as a browser-only convenience with success/error label; omit this if it adds test burden.
- No workflow-changing actions in phase 1.

### Key Decisions

1. **Use local view models, not duplicated wire interfaces.** `RunGroupViewModel`, `RunRollupStatus`, and detail-loading state are UI-only wrappers. The raw daemon fields remain imported `RunInfo`, `SessionMetadata`, `RunSummary`, `RunState`, `PlansResponse`, and `SessionStreamSnapshot` types from `@eforge-build/client/browser`.
2. **Group by `sessionId` first, then by non-session plan set.** Runs with `sessionId` become session groups keyed by that id. Runs without `sessionId` become non-session groups keyed as `planSet:<planSet>` to preserve enqueue/compile/build history that predates session ids or lacks a worker session id.
3. **Sort groups newest first and sort runs within a group chronologically.** This matches the existing daemon `runs` mental model while making each session's command progression readable: enqueue/compile/run/build in start-time order.
4. **Roll up status from current daemon fields only.** A group is `running` when any run lacks `completedAt` and has a non-terminal status. It is `failed` when any run has a failed/cancelled/killed/error terminal status. It is `completed` when all runs have a success/completed terminal status or completed timestamps without failed statuses. It is `unknown` when the group contains only unrecognized terminal-looking data.
5. **Treat active stream detail as an enhancement.** Active cards render from `RunInfo` even when per-session stream detail is connecting, disconnected, or unavailable. The stream detail badges never replace daemon run status.
6. **Fetch detail only for the selected id.** `useRunDetail(id)` issues at most three REST requests for the selected id and cancels/ignores stale results when selection changes. It does not poll and does not fetch for unselected history rows.
7. **Allow partial detail success.** `RunSummary`, `RunState`, and `PlansResponse` load independently so a failed plans endpoint does not hide a successfully fetched summary.
8. **Use existing route constants for query-safe paths.** All fetch URLs are built with `buildPath(API_ROUTES.runSummary, { id })`, `buildPath(API_ROUTES.runState, { id })`, and `buildPath(API_ROUTES.plans, { runId: id })`. The source contains no quoted `/api/` literals.
9. **Keep generated plan preview lightweight.** The plan panel shows id, type, dependencies, build/review metadata counts, and a collapsed body preview. Full markdown rendering, diff viewing, and file heatmaps are deferred.
10. **Use project-local copy.** Labels use "runs", "builds", "plans", "sessions", and "daemon". No multi-project or Overseer labels appear.

## View Contract

- **Route path:** `/console/runs`
- **Primary user question:** "What has run recently and where can I inspect active or historical build details?"
- **Live inputs:** `runs`, `sessionMetadata`, `connectionStatus`, `lastSnapshotAt`, `lastEventAt`, and active session detail map from `console-shell`.
- **Fetched inputs:** selected run summary, selected run state, selected plans.
- **Component boundaries:**
  - `RunsView` owns route-level layout, selection, and detail hook invocation.
  - `ActiveRunsPanel` owns active group cards.
  - `RunHistoryTable` owns historical rows and empty-history state.
  - `RunDetailPanel` owns selected detail loading/error/partial-success rendering.
  - `RunPlansPreview` owns fetched plan list rendering.
  - `RunEventsPreview` owns recent persisted event rows from `RunState`.
- **Empty state:** when `runs.length === 0` and the stream has connected, show "No runs recorded for this project daemon yet" plus a note that queued work appears in the Queue view.
- **Connecting state:** when `connectionStatus === 'connecting'`, show skeleton/placeholder cards labeled "Connecting to daemon stream" and no stale counts.
- **Disconnected state:** when `connectionStatus === 'disconnected'`, show a warning card using the shell's error string and the timestamp of the last snapshot/event when available.
- **Partial data state:** when live runs exist but selected detail fetches fail, keep the group list visible and show per-section failures in the detail panel.
- **Unavailable detail state:** when a selected id returns `null`/404 for summary/state/plans, show "No persisted detail for this run id" for that section without clearing other sections.

## Files

### Create
- `packages/console-ui/src/views/runs/runs-view.tsx` — route component that receives shell state and active-session details, renders active/history/detail sections, owns selected id query-state, and passes selected id to `useRunDetail`.
- `packages/console-ui/src/views/runs/active-runs-panel.tsx` — active session card grid that renders live stream status from `ActiveSessionDetail` without opening subscriptions.
- `packages/console-ui/src/views/runs/run-history-table.tsx` — compact bordered table/list for non-active groups with status badges, command chips, duration, cwd, and inspect controls.
- `packages/console-ui/src/views/runs/run-detail-panel.tsx` — selected-detail panel with summary, current phase/agent, event counts, run rows, and independent loading/error states.
- `packages/console-ui/src/views/runs/run-plans-preview.tsx` — generated plan preview list for `PlansResponse`, including type, dependency chips, build/review metadata indicators, and collapsed body excerpts.
- `packages/console-ui/src/views/runs/run-events-preview.tsx` — recent event rows from `RunState.events`, including timestamp, event type, plan id, agent, and expandable raw JSON text parsed from `data` when valid.
- `packages/console-ui/src/views/runs/status-pill.tsx` — small status badge helpers for group rollups, plan statuses, and active stream statuses.
- `packages/console-ui/src/views/runs/time-format.ts` — view-local formatting helpers for absolute timestamps, relative age, and durations. This avoids importing monitor UI format utilities.
- `packages/console-ui/src/hooks/use-run-detail.ts` — on-demand selected-id fetch hook using `fetchJson`, `API_ROUTES`, and `buildPath`; returns independent `summary`, `state`, and `plans` resource states.
- `packages/console-ui/src/lib/selectors/runs.ts` — pure selectors for grouping runs, rolling up statuses, partitioning active/history groups, deriving command summaries, metadata labels, plan status counts, and selected group lookup.
- `packages/console-ui/src/views/runs/index.ts` — exports `RunsView` and view model types needed by tests.
- `packages/console-ui/src/__tests__/runs-selectors.test.ts` — selector tests for grouping, rollups, active/history partitioning, sorting, metadata projection, and selected-id lookup.
- `packages/console-ui/src/__tests__/runs-view.test.tsx` — component tests for active concurrent sessions, empty/connecting/disconnected states, history rendering, query selection, and detail panel loading/error/partial success states.
- `packages/console-ui/src/__tests__/use-run-detail.test.tsx` — hook tests with a fake `fetchJson` implementation proving route construction and stale-result cancellation/ignore behavior.

### Modify
- `packages/console-ui/src/app.tsx` — replace the shell placeholder for the `runs` route with `RunsView`, passing `projectState`, `activeSessionStreams`, and current route information `[region: runs-build-entrypoints, Runs route component branch only]`.
- `packages/console-ui/src/lib/navigation.ts` — ensure the `runs` metadata entry has label `Runs`, href `/console/runs`, and a concise description used by the sidebar or route header `[region: runs-build-entrypoints, runs nav item]`.
- `packages/console-ui/src/lib/selectors/index.ts` — export the run selectors from `./runs` `[region: runs-build-entrypoints, exports from ./runs]`.
- `packages/console-ui/src/hooks/use-active-session-streams.ts` — only if shell's returned `ActiveSessionDetail` lacks fields needed by this view, add append-only result fields such as `latestEventType` or `eventCount` derived from existing `snapshotEvents`/`liveEvents` `[region: runs-build-entrypoints, append-only fields consumed by run detail entry points]`.

Shared file region examples:

`packages/console-ui/src/app.tsx`
```tsx
// --- eforge:region runs-build-entrypoints ---
if (route.id === 'runs') {
  return (
    <RunsView
      projectState={daemon.projectState}
      activeSessionStreams={activeSessionStreams}
    />
  );
}
// --- eforge:endregion runs-build-entrypoints ---
```

`packages/console-ui/src/lib/navigation.ts`
```ts
// --- eforge:region runs-build-entrypoints ---
{
  id: 'runs',
  label: 'Runs',
  href: toConsolePath('runs'),
  description: 'Recent build sessions and detail entry points',
}
// --- eforge:endregion runs-build-entrypoints ---
```

`packages/console-ui/src/lib/selectors/index.ts`
```ts
// --- eforge:region runs-build-entrypoints ---
export * from './runs';
// --- eforge:endregion runs-build-entrypoints ---
```

`packages/console-ui/src/hooks/use-active-session-streams.ts` optional append-only region:
```ts
// --- eforge:region runs-build-entrypoints ---
// Append only derived fields; do not change subscription lifecycle here.
latestEventType: deriveLatestEventType(detail.snapshotEvents, detail.liveEvents),
eventCount: detail.snapshotEvents.length + detail.liveEvents.length,
// --- eforge:endregion runs-build-entrypoints ---
```

## Selector and Hook Details

### `selectRunGroups(runs, metadataMap)`

Return `RunGroupViewModel[]` with:
- `key: string`
- `detailId: string` — session id for session groups, run id for single non-session groups when no session exists, or plan-set key when only plan-set grouping is possible.
- `sessionId?: string`
- `label: string` — plan set when present, otherwise session id/run id.
- `isSession: boolean`
- `runs: RunInfo[]`
- `status: 'running' | 'failed' | 'completed' | 'unknown'`
- `startedAt: string | null`
- `completedAt: string | null`
- `durationSeconds: number | null`
- `commands: string[]`
- `cwd: string | null`
- `metadata?: SessionMetadata`
- `planCountLabel?: string`
- `profileLabel?: string`

Grouping rules:
- Use `session:<sessionId>` for runs with `sessionId`.
- Use `planSet:<planSet>` for runs without `sessionId` and with `planSet`.
- Use `run:<run.id>` only when `sessionId` and `planSet` are absent.
- Sort groups by newest `startedAt` descending.
- Sort each group's `runs` by `startedAt` ascending; if timestamps are within one second, sort command order as `enqueue`, `compile`, `adopt`, `run`, `build`, then unknown commands alphabetically.

### `partitionRunGroups(groups, activeSessionIds)`

Return:
- `active: RunGroupViewModel[]` where `group.sessionId` is in `activeSessionIds`.
- `history: RunGroupViewModel[]` for all other groups.

No selector in this module calls `useActiveSessionStreams()`.

### `selectRunStatusRollup(runs)`

Normalize statuses to lowercase. Terminal failed statuses: `failed`, `failure`, `error`, `errored`, `killed`, `cancelled`, `canceled`, `stopped`. Terminal success statuses: `completed`, `complete`, `success`, `succeeded`. Active statuses: `running`, `pending`, `queued`, `starting`, `in-progress`, `building`, `planning`, plus any run with no `completedAt` and an unknown status.

### `useRunDetail(selectedId, fetchJsonOverride?)`

Return:
```ts
type ResourceState<T> =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'empty'; data: null; error: null }
  | { status: 'error'; data: null; error: string };
```

The hook:
- Sets all resources to `idle` when `selectedId` is `null`.
- On selection, starts summary/state/plans requests concurrently.
- Uses `AbortController` if `fetchJson` supports a signal; otherwise uses a monotonically increasing request token and ignores stale resolutions.
- Builds all URLs with `buildPath` and `API_ROUTES` from `@eforge-build/client/browser`.
- Treats `null` return values as `empty`.
- Stores per-resource errors; one failed resource does not change another successful resource.

## Testing Strategy

### Unit Tests
- `runs-selectors.test.ts`
  - Groups two runs with the same `sessionId` into one session group with chronological run order.
  - Groups runs without `sessionId` by `planSet:<planSet>`.
  - Returns `running` when one grouped run is non-terminal and lacks `completedAt`.
  - Returns `failed` when any grouped run has status `failed`, `error`, `killed`, `cancelled`, or `canceled`.
  - Returns `completed` when all grouped runs have success/completed statuses and completion timestamps.
  - Sorts groups newest first by `startedAt`.
  - Partitions two active session ids into two active groups and leaves completed groups in history.
  - Projects `SessionMetadata.planCount` and `SessionMetadata.baseProfile` onto matching session groups.
  - Computes plan status counts from a `RunSummary.plans` fixture with pending/running/completed/failed plans.

- `use-run-detail.test.tsx`
  - Calls the fake fetcher with URLs from `buildPath(API_ROUTES.runSummary, { id })`, `buildPath(API_ROUTES.runState, { id })`, and `buildPath(API_ROUTES.plans, { runId: id })` for one selected id.
  - Leaves all resources in `idle` when selected id is `null`.
  - Records `success` for summary while plans records `error` when only the plans request rejects.
  - Records `empty` for a request that resolves `null`.
  - Ignores a slow response for `session-a` after the selected id changes to `session-b`.

### Component Tests
- `runs-view.test.tsx`
  - Renders two active cards when the project state contains two active sessions and active-session stream details for both.
  - Displays active session stream event counts from `snapshotEvents.length + liveEvents.length` without starting a new stream.
  - Displays the empty state text when `connectionStatus` is `connected` and `runs` is empty.
  - Displays the connecting state text when `connectionStatus` is `connecting`.
  - Displays the disconnected warning and stream error text when `connectionStatus` is `disconnected`.
  - Displays a history row for a completed run group with command, status, duration, cwd, and session id.
  - Clicking **Inspect run** updates `window.location.search` to contain the selected `session` parameter.
  - Selected detail panel renders summary data when the hook returns `RunSummary` success.
  - Selected detail panel renders section-level error text when plans loading fails and summary succeeds.
  - No rendered button or link has text matching `reorder`, `priority edit`, `stack sync`, `cancel build`, or `Overseer`.

### Integration Tests
- `pnpm --filter @eforge-build/console-ui test` includes the selector/hook/component tests.
- `pnpm --filter @eforge-build/console-ui type-check` verifies browser-safe client imports and typed route responses.
- `pnpm --filter @eforge-build/console-ui build` verifies Vite can tree-shake this route without importing Node-only modules.
- Existing Console guard tests verify no hardcoded quoted `/api/` literals and no `@eforge-build/engine` imports in this module's source.

## Verification

- [x] `/console/runs` renders a heading containing `Runs` and a route subtitle containing `build sessions`.
- [x] With `connectionStatus: 'connecting'`, the Runs view renders text containing `Connecting to daemon stream`.
- [x] With `connectionStatus: 'disconnected'` and `error: 'boom'`, the Runs view renders text containing `boom`.
- [x] With `connectionStatus: 'connected'` and `runs: []`, the Runs view renders text containing `No runs recorded for this project daemon yet`.
- [x] A project state fixture with two running `RunInfo` entries with distinct `sessionId` values renders two active run cards.
- [x] Active run cards display the active stream connection state for each matching session id from `activeSessionStreams.sessions`.
- [x] Active run cards display the sum of `snapshotEvents.length` and `liveEvents.length` for each matching session id.
- [x] A completed run fixture renders in the history section, not the active section.
- [x] `selectRunGroups` returns one group for two runs with the same `sessionId`.
- [x] `selectRunGroups` returns a `planSet:<name>` group for runs without `sessionId`.
- [x] `selectRunGroups` sorts groups by newest `startedAt` timestamp first.
- [x] `selectRunStatusRollup` returns `running` for a group containing a non-terminal run with no `completedAt`.
- [x] `selectRunStatusRollup` returns `failed` for a group containing a run with status `killed`.
- [x] `selectRunStatusRollup` returns `completed` for a group whose runs all have completed timestamps and success/completed statuses.
- [x] `partitionRunGroups` returns two active groups when given two active session ids.
- [x] `partitionRunGroups` does not classify non-session historical groups as active.
- [x] `useRunDetail('abc')` calls the fetcher with `buildPath(API_ROUTES.runSummary, { id: 'abc' })`.
- [x] `useRunDetail('abc')` calls the fetcher with `buildPath(API_ROUTES.runState, { id: 'abc' })`.
- [x] `useRunDetail('abc')` calls the fetcher with `buildPath(API_ROUTES.plans, { runId: 'abc' })`.
- [x] `useRunDetail(null)` starts zero fetch requests.
- [x] When the plans request rejects and the summary request resolves, the detail panel displays summary content and plans error text at the same time.
- [x] Clicking an `Inspect run` control changes `window.location.search` to include `session=<selected id>`.
- [x] The selected detail panel displays plan ids and dependency chips from `PlansResponse`.
- [x] The selected detail panel displays recent persisted event types from `RunState.events`.
- [x] The selected detail panel displays `No persisted detail for this run id` for a resource that returns `null`.
- [x] No source file created by this module imports from `@eforge-build/engine`.
- [x] No source file created by this module imports from `packages/monitor-ui/src` or uses the `@/` alias to reach legacy monitor UI files.
- [x] No source file created by this module contains a quoted `/api/` route literal.
- [x] Rendered Runs view text does not contain `Overseer`, `multi-project`, `stack sync`, `queue reorder`, or `priority edit`.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
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
