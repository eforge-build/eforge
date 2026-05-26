# Add Eforge Console Side-by-Side With Legacy Monitor UI

## Profile

Expedition. The source explicitly requests delegated module planning for seven major Console areas, and the work crosses a new browser package, shared client wire contracts, monitor static serving, package build graph, legacy monitor navigation, tests, and documentation.

## Current-State Findings

- `packages/console-ui/` does not exist.
- `pnpm-workspace.yaml` includes `packages/*`, so `packages/console-ui` becomes a workspace member when created.
- Root `package.json` has `build:ui` and `dev:monitor` for `@eforge-build/monitor-ui`; it has no Console scripts or dependency yet.
- `packages/monitor/package.json` has `@eforge-build/monitor-ui` as a dev dependency and no Console UI dependency.
- `packages/monitor/tsup.config.ts` copies only `../monitor-ui/dist` into `dist/monitor-ui`.
- `packages/monitor/src/server.ts` serves one SPA from `UI_DIR = resolve(__dirname, 'monitor-ui')` and falls through to `serveStaticFile(req, res, url)` for non-API routes.
- Existing monitor static serving includes path containment checks, asset 404 handling, hashed asset cache headers, and SPA fallback behavior that must be preserved for both roots.
- `packages/monitor-ui` is a Vite + React + TypeScript + Tailwind 4 + shadcn-style package with guard tests for API route literals and engine imports. Its application state and reducers are legacy monitor-specific and must not be imported wholesale into Console.
- `@eforge-build/client/browser` exports the route constants, `buildPath`, `subscribeWithSnapshot`, browser-safe stream types, daemon snapshot types, route response types, event types, and stack layer types needed for phase 1.
- `docs/roadmap.md` keeps Overseer as future multi-project observability; Console must remain project-local.

## Vision and Goals

Create a new browser-only `@eforge-build/console-ui` package branded as **Eforge Console** and serve it at `/console/` while the legacy monitor remains at `/`. Phase 1 must provide a live, project-local operator Console grounded in the daemon data that already exists: liveness, auto-build state, queue, runs, recent activity, session metadata, stack layers, and on-demand system surfaces.

The Console must answer, per view: what is happening, what needs attention, and what can the operator do next. It must distinguish live stream data from fetched data and unavailable data. It must omit queue editing, priority editing, stack-sync controls, multi-project language, and wireframe-only concepts unless a matching typed client API exists at implementation time.

## Non-Goals

- No deletion or rewrite of `packages/monitor-ui` in this phase.
- No new daemon APIs except static serving of the second SPA.
- No new engine dependencies in browser code.
- No inline `/api/...` route literals in Console source outside sanctioned test fixtures.
- No Overseer or multi-project UI.
- No stack-sync operation controls in phase 1.
- No queue reordering or priority editing controls unless typed APIs already exist at implementation time.

## Architecture Overview

```mermaid
flowchart TD
  Browser[Console browser app at /console/] -->|subscribeWithSnapshot(API_ROUTES.daemonEvents)| DaemonSse[Daemon-wide SSE]
  DaemonSse --> Snapshot[stream:hello snapshot]
  Snapshot --> ProjectStore[Console project state store]
  DaemonSse --> Deltas[Daemon event deltas]
  Deltas --> ProjectStore
  ProjectStore --> ActiveSelector[Active build selector]
  ActiveSelector -->|bounded active sessions| SessionStreams[subscribeWithSnapshot(buildPath(API_ROUTES.events))]
  SessionStreams --> DetailStore[Active build detail store]
  Browser -->|fetch typed route constants| Rest[Existing daemon REST APIs]
  ProjectStore --> Views[Now / Queue / Runs / System / Activity]
  DetailStore --> Views
```

## Core Architectural Principles

1. **Engine emits, consumers render.** Console consumes existing `@eforge-build/client/browser` events and routes; it does not import engine internals or monitor server internals.
2. **One authoritative project stream.** A single daemon-wide SSE subscription seeds and updates project state. Per-session streams are derived, bounded, and only used for active visible build detail.
3. **Browser-safe client boundary.** Console imports route constants, stream helpers, and wire types from `@eforge-build/client/browser`. If a needed browser export is missing, add it to the browser entrypoint rather than importing Node-only modules.
4. **Transitional hosting, not runtime mode.** `/` and `/console/` are two separate SPAs. They link to each other with normal anchors and share no iframe or state.
5. **Project-local language.** Use runs, queue, builds, plans, sessions, profiles, extensions, playbooks, and daemon. Do not describe Console as multi-project or Overseer.
6. **Style without feature inheritance.** Use the wireframe only for dark terminal-adjacent styling: near-black background, `#67f553` accent, compact sidebar, bordered cards/tables, Inter + JetBrains Mono typography, and eforge logo treatment.
7. **Read-only by default.** Display current system surfaces and existing daemon state. Workflow-changing controls require an existing typed API and explicit state/error handling.

## Shared Data Model and State Contracts

### Project State Store

The Console foundation owns a reducer/store shaped around existing client wire types rather than duplicated interfaces:

- `runs: RunInfo[]`
- `queue: QueueItem[]`
- `sessionMetadata: Record<string, SessionMetadata>`
- `autoBuild: AutoBuildState | null`
- `liveness: DaemonStreamSnapshot['liveness'] | null`
- `recentActivity` / activity ring entries derived from `DaemonStreamSnapshot['recentActivity']` and live daemon events
- `stackLayers: StackLayerWire[]`
- `connectionStatus: 'connecting' | 'connected' | 'disconnected'`
- `lastSnapshotAt`, `lastEventAt`, and `error` fields for stale/unavailable UI states

The store is seeded from `subscribeWithSnapshot<DaemonStreamSnapshot, EforgeEvent>(API_ROUTES.daemonEvents, ...)` and updated by live event frames. The reducer may reuse behavior patterns from monitor UI, but it must not import old monitor UI reducers or application-specific components.

### Active Build Detail Store

The Console foundation owns active session subscription management:

- Active session IDs are derived from daemon `runs` and liveness/scheduler state. A run is active when it has a `sessionId` and a non-terminal status such as `running` or pending/in-progress status used by current daemon data.
- Only sessions visible in the active dashboard scope are subscribed.
- For each active session, subscribe with `subscribeWithSnapshot<SessionStreamSnapshot, EforgeEvent>(buildPath(API_ROUTES.events, { runId: sessionId }), ...)`.
- Terminal snapshots or terminal live events close and remove that session subscription after storing a final detail summary.
- Historical run rows are not subscribed by default.
- The logic must support two or more concurrent active builds; the bound is the derived active visible set, not a hardcoded subscriber count.

### Route and Fetch Contracts

- All fetches and subscriptions use `API_ROUTES`, `buildPath`, typed route helpers, or `subscribeWithSnapshot` from `@eforge-build/client/browser`.
- Query strings may be built with `new URLSearchParams(...)` appended to route constants.
- Console code must not redeclare daemon wire response interfaces for runs, queue, session metadata, auto-build, stack layers, or system surfaces already exported from the client package.

## UI Structure

The Console app uses Vite `base: '/console/'`. Internally it can use lightweight client-side routing backed by `window.location.pathname` under `/console/` with SPA fallback support from the daemon:

- `/console/` — Now dashboard
- `/console/queue` — Queue view
- `/console/runs` — Runs and build detail entry points
- `/console/system` — System configuration view
- `/console/activity` — Activity/audit view

Primary shell elements:

- Compact left sidebar with eforge logo, project label if available from `API_ROUTES.projectContext`, top-level navigation, stream status, and a link back to `/` with accessible name containing `Monitor`.
- Main content area with a small top status strip for daemon connection, auto-build mode, queue depth, running builds, and last update time.
- Bordered cards and tables for primary content.
- Empty, loading/connecting, error/unavailable, and partial-data states for every top-level view.

## Per-View Contracts for Module Planners

Every view module plan must include: primary user question, data sources, live vs fetched data, route path, component boundaries, available actions, empty/loading/error states, and concrete acceptance checks.

### Now Dashboard

Primary question: "What is happening now and what needs attention?"

Data sources:

- Live daemon state: liveness, auto-build, queue, runs, session metadata, recent activity, stack layers.
- Active build detail store for visible active sessions.

Layout guidance:

- Status strip: daemon connection, auto-build runtime mode/desired state, scheduler capacity when reported, queue depth, running builds, last heartbeat time.
- Attention cards first: failed queue items with recovery verdict chips when present, failed/recently failed runs, disconnected/stale stream warning.
- Active builds grid: one card per active session. Cards show session/plan set, command, status, profile/plan count when metadata exists, current phase/agent when live detail exists, latest error summary when present, and link to Runs detail.
- Queue snapshot: compact pending/running/failed counts and top queue items.
- Stack summary: render stack layers only when `stackLayers.length > 0`; omit stack-sync operation controls.
- Recent activity: last few non-heartbeat daemon events with summaries.

### Queue View

Primary question: "What work is queued, running, failed, or blocked?"

Data sources:

- Live daemon `queue` from snapshot and stream updates.
- Recovery verdict fields embedded in queue payloads.

Layout guidance:

- Group or filter by status: running, pending, failed, and other statuses surfaced by daemon data.
- Table/card rows include PRD id, title, status, priority if present, created timestamp, dependencies, and recovery verdict chip if present.
- Dependency chips display `dependsOn` values without claiming graph editing capabilities.
- No queue reorder, priority edit, or stack-sync controls in phase 1.

### Runs and Build Detail Entry Points

Primary question: "What has run recently and where can I inspect active or historical build details?"

Data sources:

- Live daemon `runs` and `sessionMetadata`.
- Active detail store for active sessions.
- Optional on-demand typed fetches using `API_ROUTES.runSummary`, `API_ROUTES.runState`, `API_ROUTES.plans`, or `API_ROUTES.diff` when a user drills in.

Layout guidance:

- Active runs section first, grouped by session id where multiple run rows share a session.
- History table with plan set, command, status, started/completed times, cwd/project label, and session id.
- Detail affordance can be a side panel or route state, but phase 1 detail remains entry-point level unless implemented with existing route constants.
- No import from old monitor timeline/graph/heatmap application code.

### System Configuration View

Primary question: "What daemon/project configuration and runtime surfaces are currently available?"

Data sources:

- Typed fetches via existing route constants for project context, health, version, config show/validate, profiles, extensions, playbooks, session plans, model providers, and model list.
- All response shapes from `@eforge-build/client/browser`.

Layout guidance:

- Read-only sections by default: Daemon, Config, Profiles, Extensions, Playbooks, Session Plans, Models/Providers.
- Show source/provenance when the API returns it; show unavailable states for missing or failed endpoints.
- Mutating controls are omitted in phase 1 unless a module planner explicitly ties each control to an existing typed client API and adds confirmation/error handling.

### Activity/Audit View

Primary question: "What happened recently and how can I debug daemon behavior?"

Data sources:

- Live activity ring from daemon stream snapshot `recentActivity` and subsequent non-heartbeat daemon events.
- Event summaries from `getEventSummary` when usable from the browser entrypoint.

Layout guidance:

- Chronological list with timestamp, type, scope/category, session/plan identifiers when present, and concise summary.
- Filters for event family/type and attention/error events, implemented client-side.
- Expandable raw JSON panel for debugging.
- Offline/empty states distinguish "no activity yet" from "stream has not connected".

## Static Serving and Package Integration Contract

The monitor server must serve two independent SPA roots:

- Legacy monitor: `/`, `/index.html`, `/assets/...` from `dist/monitor-ui`.
- Console: `/console/`, `/console/index.html`, `/console/assets/...` from `dist/console-ui`.

Implementation guidance:

- Add `CONSOLE_UI_DIR = resolve(__dirname, 'console-ui')` next to `UI_DIR`.
- Generalize static serving to a function shaped like `serveStaticFile(req, res, urlPath, rootDir, basePath)` or an equivalent small helper.
- Normalize `/console` and `/console/` consistently; acceptance requires `/console/` to return Console HTML.
- Strip `basePath` before resolving files under a root directory.
- Preserve traversal protection. Use `resolve(rootDir, '.' + relativePath)` containment checks and consider URL decoding before resolving so encoded traversal attempts cannot escape.
- Preserve asset 404 behavior for `/assets/...` under each SPA root.
- Preserve `Cache-Control: public, max-age=31536000, immutable` for asset paths and `no-cache` for HTML/fallback.
- API routes remain matched before static serving; unknown `/api/...` returns JSON 404.
- Add test support without changing public API semantics, for example optional `uiDirs` in `startServer` options or an exported static resolver helper used by tests.

Build/package integration:

- `packages/monitor/tsup.config.ts` copies `../monitor-ui/dist` to `dist/monitor-ui` when present and `../console-ui/dist` to `dist/console-ui` when present.
- `packages/monitor/package.json` adds `@eforge-build/console-ui` as a workspace devDependency.
- Root `package.json` adds a Console dev script and Console build script while preserving `dev:monitor`. `build:ui` can build both UIs or a new `build:console-ui` can be added alongside an updated combined script.
- `pnpm-lock.yaml` is updated through pnpm after package changes.

## Shared File Registry

The module planners and builders must avoid overlapping edits in the shared files below. Region markers named here are planning boundaries; builders add them only if their generated plans call for explicit markers.

| File | Modules | Region Strategy |
|------|---------|-----------------|
| `packages/console-ui/src/app.tsx` | console-shell, now-dashboard, queue-view, runs-build-entrypoints, system-configuration-view, activity-audit-view | Shell owns app frame and shared layout. Each view owns only its route entry/render branch if it needs to touch this file; prefer shell-created placeholder routes so view modules edit their own files only. |
| `packages/console-ui/src/lib/navigation.ts` | console-shell, now-dashboard, queue-view, runs-build-entrypoints, system-configuration-view, activity-audit-view | Shell owns nav item type and ordering. Each view owns one metadata entry region. |
| `packages/console-ui/src/lib/selectors/index.ts` | console-shell, now-dashboard, queue-view, runs-build-entrypoints, system-configuration-view, activity-audit-view | Append-only export regions per view. Selector implementations live in per-view files to avoid conflicts. |
| `packages/console-ui/src/hooks/use-daemon-events.ts` | console-shell, activity-audit-view, now-dashboard | Shell owns the subscription and reducer dispatch. View modules consume state; any additional event projection must be added through shell-declared reducer/action regions, not ad hoc rewrites. |
| `packages/console-ui/src/hooks/use-active-session-streams.ts` | console-shell, now-dashboard, runs-build-entrypoints | Shell owns subscription manager. Now and Runs modules consume its public result shape; if fields are missing, add append-only result fields in declared regions. |
| `packages/console-ui/src/components/ui/index.ts` | console-shell, all view modules | Shell owns primitive exports. View modules import direct primitive files unless a module planner declares an append-only export region. |
| `packages/console-ui/src/__tests__/guards.test.ts` | console-shell, static-serving-package-integration | Shell owns no-engine/no-API-literal guards; static module may add allowlist comments or fixtures in a dedicated region only. |
| `packages/monitor-ui/src/components/layout/header.tsx` | static-serving-package-integration | Static integration owns the legacy Monitor-to-Console link. No Console view module edits this file. |
| `packages/monitor/src/server.ts` | static-serving-package-integration | Static integration owns all changes to SPA static serving and test hooks. No Console view module edits this file. |
| `packages/monitor/tsup.config.ts` | static-serving-package-integration | Static integration owns UI dist copy changes. |
| `packages/monitor/package.json` | static-serving-package-integration | Static integration owns monitor devDependency changes. |
| `package.json` | static-serving-package-integration | Static integration owns root scripts and workspace devDependency changes. |
| `vitest.config.ts` | console-shell | Shell owns Console test include/alias additions; other modules create tests under paths matched by that config. |

### Region Declarations

**`packages/console-ui/src/app.tsx`**:
- `console-shell`: shell imports, provider setup, layout frame, route switch container, loading/error shell states.
- `now-dashboard`: Now route component branch only if not fully created by shell.
- `queue-view`: Queue route component branch only if not fully created by shell.
- `runs-build-entrypoints`: Runs route component branch only if not fully created by shell.
- `system-configuration-view`: System route component branch only if not fully created by shell.
- `activity-audit-view`: Activity route component branch only if not fully created by shell.

**`packages/console-ui/src/lib/navigation.ts`**:
- `console-shell`: `ConsoleRouteId` type, nav item interface, shared path helpers.
- `now-dashboard`: `now` nav item.
- `queue-view`: `queue` nav item.
- `runs-build-entrypoints`: `runs` nav item.
- `system-configuration-view`: `system` nav item.
- `activity-audit-view`: `activity` nav item.

**`packages/console-ui/src/lib/selectors/index.ts`**:
- `console-shell`: shared selector types and foundation exports.
- `now-dashboard`: exports from `./now`.
- `queue-view`: exports from `./queue`.
- `runs-build-entrypoints`: exports from `./runs`.
- `system-configuration-view`: exports from `./system`.
- `activity-audit-view`: exports from `./activity`.

**`packages/console-ui/src/hooks/use-daemon-events.ts`**:
- `console-shell`: entire hook, reducer dispatch, connection status, snapshot handling.
- `now-dashboard`: no direct edits unless adding consumed derived fields in an append-only return-shape region.
- `activity-audit-view`: no direct edits unless adding activity-specific derived fields in an append-only return-shape region.

**`packages/console-ui/src/hooks/use-active-session-streams.ts`**:
- `console-shell`: stream lifecycle, subscribe/unsubscribe, terminal close behavior, returned map type.
- `now-dashboard`: append-only fields consumed by active build cards.
- `runs-build-entrypoints`: append-only fields consumed by run detail entry points.

## Technical Decisions and Rationale

1. **Create a new Vite package instead of modifying monitor-ui.** This preserves the legacy monitor during the transition and prevents legacy reducer/component coupling from leaking into Console.
2. **Use `base: '/console/'`.** This scopes generated Vite asset URLs to `/console/assets/...` and prevents collisions with the legacy monitor's `/assets/...` output.
3. **Copy shadcn primitives, not application code.** Generic primitives such as `Button`, `Card`, `Badge`, `ScrollArea`, `Tooltip`, and `Sheet` may be copied/adapted from monitor UI. Legacy monitor layout, reducers, timeline, graph, heatmap, and session-specific application state are not copied wholesale.
4. **One stream plus bounded active streams.** The daemon stream owns project state; active session streams add live detail only for currently active visible builds. This supports concurrent active builds without opening streams for every historical row.
5. **Route constants are the only API path authority.** Guard tests enforce that Console source has no hardcoded `/api/` literals and no engine imports.
6. **Static server tests are required.** Serving two SPAs changes a daemon boundary; tests must cover both roots, both asset roots, SPA fallback, cache headers, and traversal attempts.
7. **Docs are modest.** README or existing monitor docs can mention Console preview at `/console/`; docs must not claim unimplemented queue editing, stack-sync controls, or Overseer behavior.

## Quality Attributes

- **Trustworthy live data:** UI labels distinguish connecting, connected, disconnected, stale, empty, and partially unavailable states.
- **Compatibility:** Existing legacy monitor URLs and assets remain served at `/` and `/assets/...`.
- **Route drift resistance:** Console source uses client route constants and browser-safe exports only.
- **Package graph reliability:** Workspace dependencies and scripts cause Console UI to build before monitor packaging when required.
- **Testability:** Pure selectors cover queue summaries and active build derivation; hook tests cover active session subscribe/unsubscribe behavior; server tests cover static routing; guard tests cover API literals and engine imports.
- **Future compatibility:** The shell can later host stack sync observability and richer queue controls without rendering them before typed APIs/events exist.

## Expedition Module Contracts

### `console-shell`

Owns the new package foundation: `package.json`, Vite/TS/PostCSS/components config, Tailwind globals, shadcn-style primitives, logo and layout shell, route skeleton, state store, daemon-wide SSE hook, active session subscription manager, typed fetcher, guard tests, test config wiring, and placeholder views.

Acceptance focus:

- `packages/console-ui/package.json` exists with name `@eforge-build/console-ui`.
- `vite.config.ts` sets `base: '/console/'` and proxies `/api` to the daemon dev port.
- Shell renders **Eforge Console**, eforge logo, near-black background token, `#67f553` accent token, compact sidebar, bordered card/table primitives, and a link to `/` with accessible name containing `Monitor`.
- Daemon stream uses `subscribeWithSnapshot` and `API_ROUTES.daemonEvents` from `@eforge-build/client/browser`.
- Active session subscription manager subscribes active visible sessions, unsubscribes removed/terminal sessions, and ignores historical runs by default.
- Guard tests fail on direct engine imports and hardcoded `/api/` literals.

### `now-dashboard`

Owns the Now dashboard content and selectors: daemon status, auto-build/scheduler state, queue depth, concurrent active build cards, attention/failure summary, stack layer summary, and recent activity preview.

Acceptance focus:

- Dashboard shows both active build cards when daemon state contains two concurrent active sessions.
- Dashboard renders queue, run, auto-build/liveness, recent activity, and stack layer data from the shared live store.
- Empty, connecting, disconnected/error, and partial-data states are visible and distinguishable.
- No queue editing, priority editing, stack-sync operation, or Overseer controls appear.

### `queue-view`

Owns the queue route, queue selectors, queue summary derivation tests, queue table/cards, dependency display, priority display, and recovery verdict chips.

Acceptance focus:

- Queue summary counts derive from `QueueItem[]` without duplicated interfaces.
- View renders empty, connecting, disconnected/error, and populated states.
- Failed items show recovery verdict chips when `recoveryVerdict` is present.
- No queue reorder or priority edit controls appear.

### `runs-build-entrypoints`

Owns the runs route, run grouping/status rollups, active/history sections, run detail entry affordances, and any on-demand fetches for run summaries/state/plans/diffs using client route constants.

Acceptance focus:

- Runs list derives from live `RunInfo[]` and `SessionMetadata`.
- Active build grouping uses the shared active session detail store rather than opening historical streams.
- History rows link or drill into phase-1 detail surfaces.
- Empty, connecting, disconnected/error, and unavailable detail states render.

### `system-configuration-view`

Owns the system route and read-only implemented system surfaces: daemon health/version/project context, config show/validate, profiles, extensions, playbooks, session plans, models/providers.

Acceptance focus:

- All fetches use `API_ROUTES`, `buildPath`, typed helpers, and browser-safe client types.
- Sections identify loading, success, empty, and fetch-failed states independently.
- The view avoids mutating controls unless each control is tied to an existing typed API with explicit confirmation and error handling.
- No new response interfaces duplicate client-owned wire shapes.

### `activity-audit-view`

Owns the activity route, live event log, event summary rendering, filters/grouping, raw JSON/debug affordances, and activity empty/error states.

Acceptance focus:

- Recent snapshot activity and live daemon events appear in chronological order.
- Heartbeats do not dominate the default activity list.
- Filters work client-side and do not trigger new daemon routes.
- Raw event expansion uses existing `EforgeEvent` typing from the client package.

### `static-serving-package-integration`

Owns serving `/console/` beside `/`, UI dist copy, package graph scripts/dependencies, legacy monitor link to Console, monitor server tests, built asset path verification, and modest docs update.

Acceptance focus:

- Monitor server returns legacy index for `/` and Console index for `/console/`.
- `/assets/...` serves legacy assets; `/console/assets/...` serves Console assets.
- Asset 404, SPA fallback, cache headers, and path traversal protection are tested for both roots.
- Monitor tsup copy step copies both UI dists when present.
- Root scripts include Console dev/build commands and preserve `dev:monitor`.
- Legacy monitor header contains a visible link/button with accessible name containing `Console` targeting `/console/`.
- Documentation changes, if any, describe Console as a transitional preview at `/console/` and avoid unimplemented capabilities.
