---
id: plan-01-console-shell
name: Create the new Console UI package foundation, visual shell, route
  skeleton, shared live-data store, daemon SSE hook, active session subscription
  manager, primitives, and guard tests.
branch: add-eforge-console-side-by-side-with-legacy-monitor-ui/console-shell
---

# Console Shell

## Architecture Reference

This module implements the `console-shell` Expedition Module Contract from the architecture: the new Console UI package foundation, project-local visual shell, route skeleton, daemon-wide SSE state store, bounded active-session stream manager, shared primitives, and source guard tests.

Key constraints from architecture:
- Create a new browser-only `@eforge-build/console-ui` package served later at `/console/` with Vite `base: '/console/'`.
- Import daemon routes, stream helpers, event types, and wire types from `@eforge-build/client/browser`; do not import `@eforge-build/engine`.
- Use `subscribeWithSnapshot` and `API_ROUTES.daemonEvents` for exactly one daemon-wide project stream.
- Use per-session streams only for active sessions visible to the dashboard; do not subscribe to historical runs by default.
- Use the wireframe only for visual style: near-black background, green `#67f553` accent, compact sidebar, bordered cards/tables, Inter and JetBrains Mono font stacks, and eforge logo treatment.
- Keep `/` versus `/console/` as separate SPAs. The Console shell includes a normal link back to `/` with accessible name containing `Monitor`.
- Leave view-specific content to the Now, Queue, Runs, System, and Activity modules; this module creates placeholders and shared data contracts.

## Scope

### In Scope
- Create `packages/console-ui` as a Vite + React + TypeScript + Tailwind 4 package named `@eforge-build/console-ui`.
- Add package-local build, type-check, dev, and test scripts.
- Add package-local Vite, TypeScript, PostCSS, shadcn `components.json`, and Vitest configuration.
- Add global Console styling tokens, including near-black background and `#67f553` accent.
- Add generic shadcn-style primitives needed by the shell: `Button`, `Card`, `Badge`, and shared `cn` utility.
- Build a compact sidebar shell with eforge logo, **Eforge Console** branding, top-level route skeleton, connection/status strip, responsive fallback, and link to `/` labeled with `Monitor`.
- Add lightweight client-side route parsing for `/console/`, `/console/queue`, `/console/runs`, `/console/system`, and `/console/activity`.
- Add placeholder route content that clearly identifies each planned view without rendering view-specific controls.
- Implement a shared project-state reducer fed by daemon `stream:hello` snapshots and daemon events.
- Implement `useDaemonEvents()` using `subscribeWithSnapshot` from `@eforge-build/client/browser` and `API_ROUTES.daemonEvents`.
- Implement active build derivation from live `RunInfo[]` data.
- Implement `useActiveSessionStreams()` to subscribe to active visible session IDs, unsubscribe removed IDs, close terminal sessions, and ignore historical runs by default.
- Add source guard tests for hardcoded `/api/` literals and `@eforge-build/engine` imports.
- Add tests for active-session derivation and active-session subscribe/unsubscribe behavior.

### Out of Scope
- Monitor server static serving at `/console/`; owned by `static-serving-package-integration`.
- Root `package.json`, `packages/monitor/package.json`, `packages/monitor/tsup.config.ts`, and legacy monitor link changes; owned by `static-serving-package-integration`.
- Now dashboard data cards, Queue view, Runs detail surfaces, System configuration fetch sections, and Activity/audit filters; owned by their view modules.
- Queue reordering, priority editing, stack-sync operation controls, Overseer or multi-project navigation, and any controls without an implemented typed client API.
- Importing or copying legacy monitor UI reducers, layout, timeline, graph, heatmap, or application components.
- Adding new daemon REST/SSE APIs.

## Implementation Approach

### Overview

Create the Console package by copying only generic setup patterns and shadcn primitives from `packages/monitor-ui`. Build the app around a small presentational shell plus hooks and selectors that consume `@eforge-build/client/browser` types directly.

The initial app renders all five top-level routes with placeholder panels so downstream view modules can replace content without modifying package configuration or live-data plumbing. The shell owns the daemon stream and active session stream contracts so all views consume the same data rather than opening independent SSE connections.

The Console state flow is:

1. `src/main.tsx` renders `App` inside React `StrictMode`.
2. `App` calls `useDaemonEvents()` once.
3. `useDaemonEvents()` opens `subscribeWithSnapshot<DaemonStreamSnapshot, EforgeEvent>(API_ROUTES.daemonEvents, ...)` and dispatches snapshot/event actions to `consoleProjectReducer`.
4. `selectActiveSessionIds()` derives active visible session IDs from `state.runs`.
5. `useActiveSessionStreams(activeSessionIds)` opens `subscribeWithSnapshot<SessionStreamSnapshot, EforgeEvent>(buildPath(API_ROUTES.events, { runId: sessionId }), ...)` for each active ID and aborts streams removed from the active set.
6. `ConsoleShell` receives project state, active session detail state, route metadata, and placeholder route content.

### Key Decisions

1. **Use package-local Vitest config instead of root `vitest.config.ts`.** The existing root config maps `@/` to `packages/monitor-ui/src`. A second global `@/` alias would conflict. `packages/console-ui/vitest.config.ts` maps `@/` to `packages/console-ui/src` for Console package tests. Root Vitest can be updated in a later repo-level test integration if it uses non-conflicting aliases.
2. **Use client-owned wire types with a local UI state wrapper.** `RunInfo`, `QueueItem`, `SessionMetadata`, `AutoBuildState`, `DaemonStreamSnapshot`, `SessionStreamSnapshot`, `StackLayerWire`, and `EforgeEvent` come from `@eforge-build/client/browser`. Local interfaces may wrap connection status, timestamps, and errors but must not duplicate daemon response shapes.
3. **Derive daemon event projection from `eventRegistry`.** Mirror the monitor UI pattern by deriving a handler registry from `eventRegistry` project functions. This avoids copying daemon event mutation rules into Console.
4. **Represent snapshot session events separately from live typed events.** `SessionStreamSnapshot.events` arrives as `{ id, data }[]`; the active detail store preserves these raw snapshot entries and stores live `EforgeEvent[]` frames separately. View modules can add typed parsing later if a browser-safe parse helper is exported.
5. **Use active visible sessions as the subscription bound.** The hook subscribes to the unique sorted active session IDs passed by the route scope. Initial shell passes all active sessions from `runs`; future dashboard modules may pass a narrower visible set. The hook never opens streams for completed historical rows.
6. **Use local/system font stacks.** Global CSS defines Inter and JetBrains Mono first in the stack without fetching external font files. This satisfies the visual direction while keeping the package usable without network font loading.
7. **Use the GitHub avatar logo through a single brand constant.** Phase 1 can use the existing external eforge avatar URL. Keeping it in `src/lib/brand.ts` makes a later vendored asset swap a one-file change.
8. **Keep placeholder views read-only.** Shell route placeholders identify the planned route, live connection state, and data availability only. They do not render queue editing, stack sync, or other deferred controls.

## Files

### Create
- `packages/console-ui/package.json` — package manifest for `@eforge-build/console-ui` with `dev`, `build`, `type-check`, `test`, and `test:watch` scripts. Dependencies: `@eforge-build/client`, React, React DOM, lucide, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, and `tailwind-merge`. Dev dependencies mirror monitor UI Vite/Tailwind/TypeScript/Vitest/testing packages as needed.
- `packages/console-ui/vite.config.ts` — Vite React config with alias `@` to `src`, `base: '/console/'`, `outDir: 'dist'`, and dev proxy for `/api` to `http://localhost:4567`.
- `packages/console-ui/vitest.config.ts` — package-local Vitest config with `jsdom` available for component tests, `@` alias to Console `src`, and `@eforge-build/client/browser` alias to `../client/src/browser.ts` for workspace source tests.
- `packages/console-ui/tsconfig.json` — strict browser TypeScript config using `moduleResolution: 'bundler'`, JSX `react-jsx`, `baseUrl`, and `@/*` path mapping.
- `packages/console-ui/postcss.config.js` — Tailwind 4 PostCSS plugin config matching monitor UI.
- `packages/console-ui/components.json` — shadcn config using `src/globals.css`, `@/components`, `@/components/ui`, `@/lib`, and lucide icons.
- `packages/console-ui/index.html` — Vite HTML shell with root node and title `Eforge Console`.
- `packages/console-ui/src/main.tsx` — React entrypoint importing `./globals.css` and rendering `App`.
- `packages/console-ui/src/app.tsx` — app composition, route state, daemon hook wiring, active-session hook wiring, and `ConsoleShell` render `[region: console-shell, shell imports, provider setup, layout frame, route switch container, loading/error shell states]`.
- `packages/console-ui/src/globals.css` — Tailwind import, theme tokens, near-black background, `#67f553` accent token, border/card/table tokens, Inter and JetBrains Mono stacks, scrollbars, and responsive base styles.
- `packages/console-ui/src/lib/brand.ts` — `CONSOLE_NAME`, eforge logo URL, accent token string, and brand copy constants.
- `packages/console-ui/src/lib/utils.ts` — `cn()` helper copied from monitor UI primitive pattern.
- `packages/console-ui/src/lib/types.ts` — re-export browser-safe client wire types and define local `ConnectionStatus`/activity wrapper types without duplicating daemon response interfaces.
- `packages/console-ui/src/lib/navigation.ts` — route id type, route metadata, path helpers, current-route parser, and route ordering `[region: console-shell, ConsoleRouteId type, nav item interface, shared path helpers, route ordering]`.
- `packages/console-ui/src/lib/project-state.ts` — `ConsoleProjectState`, `initialConsoleProjectState`, reducer actions, snapshot seeding, event projection, activity ring buffer, last snapshot/event timestamps, and stream error state.
- `packages/console-ui/src/lib/daemon-event-projector.ts` — derived handler registry from `eventRegistry` project functions.
- `packages/console-ui/src/lib/fetch-json.ts` — typed JSON fetch helper for route constants; rejects non-2xx with an `Error` containing HTTP status and returns `null` for 404 only when caller opts in.
- `packages/console-ui/src/lib/selectors/active-builds.ts` — terminal status helpers and `selectActiveSessionIds(runs)` with deterministic sorted unique IDs.
- `packages/console-ui/src/lib/selectors/index.ts` — shared selector exports `[region: console-shell, shared selector types and foundation exports]`.
- `packages/console-ui/src/hooks/use-daemon-events.ts` — daemon-wide SSE hook `[region: console-shell, entire hook, reducer dispatch, connection status, snapshot handling]`.
- `packages/console-ui/src/hooks/use-active-session-streams.ts` — active session subscription manager `[region: console-shell, stream lifecycle, subscribe/unsubscribe, terminal close behavior, returned map type]`.
- `packages/console-ui/src/components/ui/button.tsx` — shadcn-style Button primitive adapted from monitor UI.
- `packages/console-ui/src/components/ui/card.tsx` — shadcn-style Card primitive adapted from monitor UI.
- `packages/console-ui/src/components/ui/badge.tsx` — shadcn-style Badge primitive adapted from monitor UI.
- `packages/console-ui/src/components/ui/index.ts` — primitive exports `[region: console-shell, primitive exports]`.
- `packages/console-ui/src/components/shell/console-shell.tsx` — presentational app frame with sidebar, status strip, main route panel, and responsive layout.
- `packages/console-ui/src/components/shell/sidebar.tsx` — compact navigation, logo, project-local label placeholder, stream status indicator, and Monitor return link.
- `packages/console-ui/src/components/shell/status-strip.tsx` — connection status, queue count, active build count, auto-build mode, and last update display based on shared state.
- `packages/console-ui/src/components/shell/route-placeholder.tsx` — read-only placeholder panel for each route with loading/connecting/error/offline copy from shared state.
- `packages/console-ui/src/components/common/empty-state.tsx` — small reusable empty/unavailable panel used by placeholders.
- `packages/console-ui/src/__tests__/guards.test.ts` — combined guard test for direct `@eforge-build/engine` imports and literal `/api/` route strings in non-test Console source `[region: console-shell, no-engine/no-API-literal guards]`.
- `packages/console-ui/src/__tests__/active-builds.test.ts` — unit tests for active session derivation from `RunInfo[]`.
- `packages/console-ui/src/__tests__/active-session-streams.test.tsx` — jsdom React test for subscribe/unsubscribe behavior using an injected fake `subscribeWithSnapshot` implementation.
- `packages/console-ui/src/__tests__/console-shell.test.tsx` — jsdom render test for `ConsoleShell` proving the logo, `Eforge Console`, compact nav, bordered route surface, and `Monitor` link to `/` are present.

### Modify
- `pnpm-lock.yaml` — lockfile importer/dependency updates for `packages/console-ui` after running pnpm install/build tooling. Coordinate with `static-serving-package-integration`, which will add root and monitor package dependency entries in its own module.

No root `vitest.config.ts` change is planned in this module. The package-local Vitest config avoids the existing root `@/` alias collision with `packages/monitor-ui/src`.

## Shared File Region Declarations

This module creates shared files that later view modules may extend. Add explicit markers when implementing these files.

`packages/console-ui/src/app.tsx`:
```tsx
// --- eforge:region console-shell ---
export function App() {
  // daemon stream, active-session stream, shell layout, route placeholder container
}
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/lib/navigation.ts`:
```ts
// --- eforge:region console-shell ---
export type ConsoleRouteId = 'now' | 'queue' | 'runs' | 'system' | 'activity';
export interface ConsoleNavItem { id: ConsoleRouteId; label: string; href: string; }
export const consoleRouteOrder: ConsoleRouteId[] = ['now', 'queue', 'runs', 'system', 'activity'];
export function toConsolePath(id: ConsoleRouteId): string { /* implementation */ }
export function parseConsoleRoute(pathname: string): ConsoleRouteId { /* implementation */ }
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/lib/selectors/index.ts`:
```ts
// --- eforge:region console-shell ---
export * from './active-builds';
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/hooks/use-daemon-events.ts`:
```ts
// --- eforge:region console-shell ---
export function useDaemonEvents(): UseDaemonEventsResult {
  // subscribeWithSnapshot(API_ROUTES.daemonEvents) and reducer dispatch
}
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/hooks/use-active-session-streams.ts`:
```ts
// --- eforge:region console-shell ---
export function useActiveSessionStreams(sessionIds: readonly string[]): UseActiveSessionStreamsResult {
  // buildPath(API_ROUTES.events, { runId: sessionId }) and AbortController lifecycle
}
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/components/ui/index.ts`:
```ts
// --- eforge:region console-shell ---
export * from './badge';
export * from './button';
export * from './card';
// --- eforge:endregion console-shell ---
```

`packages/console-ui/src/__tests__/guards.test.ts`:
```ts
// --- eforge:region console-shell ---
describe('Console source guards', () => {
  // no literal API route strings and no engine imports
});
// --- eforge:endregion console-shell ---
```

## State and Hook Contracts

### `ConsoleProjectState`

Use this shape, with imported wire types from `@eforge-build/client/browser`:

- `runs: RunInfo[]`
- `queue: QueueItem[]`
- `sessionMetadata: Record<string, SessionMetadata>`
- `autoBuild: AutoBuildState | null`
- `liveness: DaemonStreamSnapshot['liveness'] | null`
- `latestHeartbeat: ProjectableState['latestHeartbeat']`
- `recentActivity: ConsoleActivityEntry[]`
- `stackLayers: StackLayerWire[]`
- `connectionStatus: 'connecting' | 'connected' | 'disconnected'`
- `lastSnapshotAt: number | null`
- `lastEventAt: number | null`
- `error: string | null`

`SNAPSHOT_RECEIVED` must replace the snapshot-owned arrays/maps and set `connectionStatus` to `connected`. `EVENT_RECEIVED` must append non-heartbeat daemon events to the activity ring and apply `eventRegistry` project deltas when a project function exists. `STREAM_ERROR` must set `connectionStatus` to `disconnected` and store an error message.

### `selectActiveSessionIds`

Rules:
- Ignore runs without `sessionId`.
- Ignore runs with `completedAt` set.
- Ignore lower-cased statuses in terminal set: `completed`, `complete`, `success`, `succeeded`, `failed`, `failure`, `error`, `cancelled`, `canceled`, `stopped`.
- Include statuses such as `running`, `pending`, `queued`, `starting`, and unknown non-terminal strings when `completedAt` is absent.
- Return sorted unique session IDs for stable hook dependencies.

### `useActiveSessionStreams`

Return shape:
- `sessions: Record<string, ActiveSessionDetail>`
- `activeSessionIds: string[]`
- `subscriptionCount: number`

`ActiveSessionDetail` includes:
- `sessionId`
- `connectionStatus`
- `status: SessionStreamSnapshot['status'] | 'connecting' | 'disconnected'`
- `snapshotEvents: SessionStreamSnapshot['events']`
- `liveEvents: EforgeEvent[]`
- `lastEventAt: number | null`
- `error: string | null`

Lifecycle requirements:
- Create one `AbortController` per newly active session.
- Call `buildPath(API_ROUTES.events, { runId: sessionId })` for the stream URL.
- Abort controllers for sessions removed from the active set.
- Close a session subscription when a snapshot status or live event indicates terminal completion/failure.
- Remove stale details for sessions no longer active after preserving terminal status until the next render pass.
- Accept an optional injected `subscribe` function in tests; production default uses `subscribeWithSnapshot` from `@eforge-build/client/browser`.

## Testing Strategy

### Unit Tests
- `active-builds.test.ts`:
  - Two running runs with different `sessionId` values produce two active IDs.
  - Completed and failed runs with `completedAt` do not produce active IDs.
  - Duplicate active rows for one `sessionId` produce one ID.
  - Unknown non-terminal status without `completedAt` produces an active ID.
- `guards.test.ts`:
  - Scan `packages/console-ui/src` excluding `__tests__` and `node_modules`.
  - Fail on non-comment lines containing `@eforge-build/engine`.
  - Fail on non-comment lines containing quote/backtick followed by `/api/`.
- `project-state` reducer tests if implementation extracts reducer helpers into pure functions:
  - Snapshot seeds runs, queue, metadata, auto-build, liveness, recent activity, and stack layers.
  - Heartbeat events update liveness/heartbeat without adding activity entries.

### Hook and Component Tests
- `active-session-streams.test.tsx` with jsdom:
  - Mount a test component with two active IDs and an injected fake subscribe generator; assert two subscriptions start with URLs produced by `buildPath(API_ROUTES.events, ...)`.
  - Re-render with one ID removed; assert the removed session's `AbortSignal` is aborted and the remaining session stays subscribed.
  - Re-render with only a historical/completed selector result represented by an empty active ID array; assert no historical subscription starts.
  - Emit a terminal snapshot or `session:end` event from the fake generator; assert the session detail status becomes terminal and its controller aborts.
- `console-shell.test.tsx` with jsdom:
  - Render the presentational `ConsoleShell` with stub state.
  - Assert accessible link text containing `Monitor` has `href="/"`.
  - Assert `Eforge Console` text and logo `img` with non-empty `src` are rendered.
  - Assert nav links for Now, Queue, Runs, System, and Activity have `/console/`-scoped hrefs.

### Integration Tests
- Package build integration through Vite:
  - `pnpm --filter @eforge-build/console-ui build` must emit `dist/index.html` with `/console/assets/` references because `base` is `/console/`.
- Browser-safe import integration:
  - `pnpm --filter @eforge-build/console-ui type-check` must pass with no `@eforge-build/engine` imports.

## Verification

- [ ] `packages/console-ui/package.json` exists and declares `"name": "@eforge-build/console-ui"`.
- [ ] `packages/console-ui/vite.config.ts` sets `base: '/console/'`.
- [ ] `packages/console-ui/vite.config.ts` proxies `/api` only in dev-server configuration, not in `src` source files.
- [ ] `packages/console-ui/src/globals.css` contains `#67f553` and a near-black background token.
- [ ] `packages/console-ui/src/globals.css` declares Inter and JetBrains Mono font stacks or local/system fallbacks containing those names.
- [ ] The Console shell renders text `Eforge Console`.
- [ ] The Console shell renders an eforge logo image with non-empty `src` and non-empty `alt`.
- [ ] The Console shell renders a link with accessible name containing `Monitor` and `href="/"`.
- [ ] Sidebar navigation contains links for Now, Queue, Runs, System, and Activity.
- [ ] Sidebar route links use `/console/`-scoped paths.
- [ ] Primary route content is wrapped in a bordered card or panel surface.
- [ ] `useDaemonEvents()` calls `subscribeWithSnapshot` from `@eforge-build/client/browser` with `API_ROUTES.daemonEvents`.
- [ ] Console source imports daemon wire types from `@eforge-build/client/browser`.
- [ ] Console source contains zero imports from `@eforge-build/engine` outside test fixtures.
- [ ] Console source contains zero hardcoded quoted `/api/` route literals outside test fixtures.
- [ ] `selectActiveSessionIds()` returns two IDs for two concurrent active runs with distinct session IDs.
- [ ] `selectActiveSessionIds()` returns no ID for runs with terminal status and `completedAt` set.
- [ ] `useActiveSessionStreams()` starts one session stream per active visible session ID.
- [ ] `useActiveSessionStreams()` aborts a removed session stream when the active ID list shrinks.
- [ ] `useActiveSessionStreams()` starts zero streams when active ID list is empty.
- [ ] `useActiveSessionStreams()` builds session stream URLs with `buildPath(API_ROUTES.events, { runId: sessionId })`.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0 and emits `packages/console-ui/dist/index.html` with `/console/assets/` references.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
