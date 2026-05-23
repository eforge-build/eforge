---
id: plan-03-stack-daemon-ui
name: Expose Stack Layers through Client, Daemon, and Monitor UI
branch: complete-first-class-stacked-pr-and-git-spice-support/plan-03-stack-daemon-ui
agents:
  builder:
    effort: high
    rationale: This plan spans shared wire contracts, monitor server projection,
      daemon stream snapshots, reducer state, and React rendering.
  reviewer:
    effort: high
    rationale: Review must verify API shapes are owned by @eforge-build/client and
      no ad hoc monitor-local stack wire interfaces are introduced.
---

# Expose Stack Layers through Client, Daemon, and Monitor UI

## Architecture Context

Stack layer state is stored in `.eforge/stacks/layers.json`, but the monitor currently ignores stack events and has no API projection for layer metadata. Project policy requires daemon wire shapes to be owned by `@eforge-build/client`; monitor server and UI must consume shared types instead of local shape declarations.

## Implementation

### Overview

Add a typed stack layers response and daemon route, include stack layer snapshots in the daemon SSE handshake, project live stack events into daemon UI state, and render stack/layer metadata in the monitor. The UI must show enough information to answer stack id, PRD/layer, artifact branch/ref, parent branch, provider, landing state, and PR URL when present.

### Key Decisions

1. Add a dedicated `GET /api/stack/layers` route and also include `stackLayers` in `stream:hello` for daemon-wide monitor state.
2. Use `StackLayerWire` from `@eforge-build/client`; do not define a monitor-local stack layer interface.
3. Use shared row/file-to-wire projection helpers for stack layers so REST and SSE snapshots cannot drift.
4. Handle live updates from `stack:layer:recorded` and `stack:landing:update` in the client event registry projector and monitor daemon reducer.

## Scope

### In Scope

- Client-owned stack response and snapshot wire shapes.
- Daemon route and stream snapshot projection for `.eforge/stacks/layers.json`.
- Monitor UI state and rendering for stack layers.
- Tests proving REST and SSE use the same layer projection.
- Tests proving stack events update the rendered UI state.

### Out of Scope

- Runtime provider implementation.
- Consumer CLI/Pi/Claude tool schema changes.
- Documentation prose.

## Files

### Create

- `packages/client/src/api/stack.ts` — typed helpers such as `apiGetStackLayers()` and `apiGetStackLayersIfRunning()`.
- `packages/monitor-ui/src/components/stack/stack-layers-card.tsx` — shadcn/ui-based stack layer summary/list component.
- `packages/monitor-ui/src/components/stack/__tests__/stack-layers-card.test.tsx` — rendering tests for stack id, PRD, branches, provider, landing status, and PR URL.

### Modify

- `packages/client/src/routes.ts` — add `API_ROUTES.stackLayers` and `StackLayersResponse` using `StackLayerWire`.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — export the stack API helper and response types.
- `packages/client/src/events.schemas.ts` — add `stackLayers: Type.Array(StackLayerWireSchema)` to the daemon stream snapshot schema and export the response type if derived here.
- `packages/client/src/event-registry.ts` — add projectors for `stack:layer:recorded` and `stack:landing:update` that update `ProjectableState.stackLayers`.
- `packages/client/src/__tests__/events-schemas.test.ts` — validate daemon snapshots with `stackLayers` and event projection behavior.
- `packages/monitor/src/server.ts` — add a shared `loadStackLayers`/`stackLayersToWire` helper using client types, serve `GET /api/stack/layers`, and include the same projection in daemon `stream:hello`.
- `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts` — assert `stream:hello` includes `stackLayers` with canonical fields.
- `packages/monitor/src/__tests__/stack-layers-route.test.ts` — assert `GET /api/stack/layers` returns the same shape as the state file projection and returns `[]` when the file is absent or invalid.
- `packages/monitor-ui/src/lib/types.ts` — re-export any new client stack response types.
- `packages/monitor-ui/src/lib/daemon-reducer.ts` — add `stackLayers` to `DaemonState`, `initialDaemonState`, `BATCH_SEED`, and selectors.
- `packages/monitor-ui/src/hooks/use-daemon-events.ts` — seed `stackLayers` from the snapshot.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` — cover stack layer seeding and live stack event updates.
- `packages/monitor-ui/src/lib/reducer/index.ts` — remove stack events from per-session ignored-only comments if daemon projection now owns them; keep exhaustive handling valid.
- `packages/monitor-ui/src/app.tsx` — render `StackLayersCard` in the upper panel or daemon-visible area with `daemonState.stackLayers`.
- `packages/monitor-ui/src/__tests__/api-routes-compliance.test.tsx` — update expected route usage only if needed; no literal `/api/stack/layers` strings in UI code.

## Verification

- [ ] `GET /api/stack/layers` returns `[]` when `.eforge/stacks/layers.json` is absent.
- [ ] `GET /api/stack/layers` and daemon `stream:hello.stackLayers` return identical layer objects for a fixture state file.
- [ ] Monitor UI renders stack id, PRD id, artifact branch, base/parent branch, provider, landing status, and PR URL for a seeded stack layer.
- [ ] Dispatching `stack:layer:recorded` followed by `stack:landing:update` updates `daemonState.stackLayers` without a REST refetch.
- [ ] `rg "interface .*Stack|type .*Stack" packages/monitor/src packages/monitor-ui/src --glob '!dist/**'` shows no monitor-local wire shape replacing `StackLayerWire`; UI component props may use imported client types.
- [ ] `pnpm vitest run packages/client/src/__tests__/events-schemas.test.ts packages/monitor/src/__tests__/daemon-sse-handshake.test.ts packages/monitor/src/__tests__/stack-layers-route.test.ts packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts packages/monitor-ui/src/components/stack/__tests__/stack-layers-card.test.tsx` passes.
- [ ] `pnpm type-check` passes.