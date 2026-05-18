---
id: plan-01-scheduler-fsm-card-reporting
name: Scheduler FSM Card Reporting
branch: improve-monitor-daemon-scheduler-fsm-card-reporting/plan-01-scheduler-fsm-card-reporting
---

# Scheduler FSM Card Reporting

## Architecture Context

The Scheduler FSM card in `packages/monitor-ui/src/components/daemon/daemon-drawer.tsx` renders canonical auto-build supervisor state from `daemonState.autoBuild`, with queue depth and running builds displayed from `latestHeartbeat`. The daemon emits the initial canonical snapshot through `GET /api/auto-build` and `stream:hello`, then sends live-only `daemon:heartbeat` frames. The shared wire contract for these objects is owned by `@eforge-build/client` in `packages/client/src/types.ts` and `packages/client/src/events.schemas.ts`.

This plan keeps the card backed by current daemon state rather than historical `daemon:scheduler:*` events. It adds optional capacity fields to the shared scheduler state, populates them in the daemon projection from current DB/config data, and has heartbeat projection refresh the canonical UI auto-build slice without replacing the watcher details that heartbeats do not carry.

## Implementation

### Overview

Implement the focused bugfix across three layers:

1. Extend the canonical client scheduler state with optional `runningCount` and `limit` fields.
2. Populate those fields in daemon auto-build REST, `stream:hello`, and heartbeat projections using `db.getRunningRuns().length` and `config.maxConcurrentBuilds` with the engine default as fallback.
3. Update the monitor UI reducer and drawer so live heartbeats refresh `daemonState.autoBuild.scheduler`, capacity displays as `N/M running`, and the debug row reads `Last queue wake-up` with friendly labels.

### Key Decisions

1. **Use optional wire fields.** Add `runningCount?: number` and `limit?: number` to `AutoBuildSchedulerState`. This preserves compatibility with older daemon snapshots and matches the existing optional lifecycle field pattern.
2. **No daemon API version bump.** `packages/client/src/api-version.ts` states that adding optional response fields is non-breaking and must not bump `DAEMON_API_VERSION`.
3. **Enrich server wire projections, not the supervisor reducer.** `AutoBuildSupervisor` owns lifecycle state and does not know DB running-run count or config. Enrich `autoBuildStateToWire()` in `packages/monitor/src/server.ts` so REST, stream snapshot, and heartbeat use one projection.
4. **Merge heartbeat auto-build details into existing UI state.** Heartbeat payloads include lifecycle/scheduler details but not `watcher`; merge heartbeat details into existing `state.autoBuild` when it exists, preserving `watcher` and deep-merging `scheduler` optional fields.
5. **Keep diagnostic information visible.** Unknown `lastMutationReason` values remain visible as raw strings; known route wake-up reasons get user-facing labels.

## Scope

### In Scope

- Client wire type/schema additions for scheduler `runningCount` and `limit`.
- Daemon auto-build projection enrichment for REST, `stream:hello`, and heartbeats.
- Monitor UI heartbeat projection changes that refresh canonical `daemonState.autoBuild` from heartbeat auto-build details.
- Scheduler FSM card label and formatting changes.
- Tests for client schema, daemon projection, reducer/hook live refresh, and drawer rendering.
- Generated docs/schema artifacts that change after `pnpm docs:generate`.

### Out of Scope

- New scheduler features or roadmap additions.
- Inferring status-card capacity from historical `daemon:scheduler:*` activity events.
- Removing the queue wake-up debug row.
- Changing the scheduler algorithm or queue dispatch semantics.
- Database migrations.

## Files

### Modify

- `packages/client/src/types.ts` — add optional `runningCount?: number` and `limit?: number` to `AutoBuildSchedulerState`.
- `packages/client/src/events.schemas.ts` — add optional numeric `runningCount` and `limit` to `AutoBuildSchedulerStateSchema`; ensure `daemon:heartbeat`, `DaemonStreamLivenessSchema`, and `DaemonAutoBuildSchema` pick up the fields through `AutoBuildDetailFields`.
- `packages/client/src/event-registry.ts` — update the `daemon:heartbeat` `project` function to return `latestHeartbeat` and, when `state.autoBuild` is non-null, a merged `autoBuild` containing heartbeat `enabled`, lifecycle fields, and deep-merged scheduler details.
- `packages/client/src/__tests__/events-schemas.test.ts` — add/extend schema cases that accept scheduler `runningCount` and `limit` in heartbeat and stream snapshot auto-build payloads.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — include optional scheduler capacity fields in at least one heartbeat/snapshot fixture so wire parity covers the new shape.
- `packages/monitor/src/server.ts` — expand the `startServer` config type to include `maxConcurrentBuilds`; add a single helper for current running count; enrich `autoBuildStateToWire()` scheduler with `runningCount` and `limit` when a limit is available; reuse the same count in `buildHeartbeatObject()` so heartbeat `runningBuilds` and scheduler `runningCount` match.
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — assert `GET /api/auto-build` and `stream:hello.autoBuild` include `scheduler.runningCount` and `scheduler.limit` using seeded running runs and a test config limit.
- `packages/monitor/src/__tests__/auto-build-route.test.ts` or an existing daemon SSE test — cover heartbeat auto-build capacity projection. Use fake timers or the existing SSE helper pattern to capture a heartbeat with `scheduler.runningCount` and `scheduler.limit`.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` — add a heartbeat regression test that starts with a stale/empty `autoBuild.scheduler`, dispatches a heartbeat with `lastMutationReason`, `runningCount`, and `limit`, and asserts `state.autoBuild.scheduler` has the heartbeat values while the heartbeat is excluded from activity.
- `packages/monitor-ui/src/hooks/__tests__/use-daemon-events.test.ts` — update existing casts/fixtures to use the typed scheduler capacity fields; add coverage if hook-level heartbeat refresh is not already covered by reducer tests.
- `packages/monitor-ui/src/components/daemon/daemon-drawer.tsx` — rename the row to `Last queue wake-up`; add wake-up reason formatting; render missing reasons as `none since startup`; render `runningCount/limit` capacity as `N/M running` while retaining old fallback paths.
- `packages/monitor-ui/src/components/daemon/__tests__/daemon-drawer.test.tsx` — update existing expectations and add render tests for `Last queue wake-up`, missing reason, friendly labels for `apply-recovery`, `external`, and `playbook-enqueue`, unknown raw reason display, and `N/M running` capacity.
- `web/public/schemas/events.schema.json` and any other files updated by `pnpm docs:generate` — commit generated schema/reference drift caused by the TypeBox schema change.

### Create

- None expected.

## Detailed Guidance

### Client contract

Add fields as optional numbers only:

```ts
export interface AutoBuildSchedulerState {
  alive: boolean;
  paused: boolean;
  lastMutationReason?: string;
  runningCount?: number;
  limit?: number;
}
```

Mirror this in `AutoBuildSchedulerStateSchema`:

```ts
runningCount: Type.Optional(Type.Number()),
limit: Type.Optional(Type.Number()),
```

Do not add `capacityRemaining`, `capacity`, or `maxRunningBuilds` to the canonical type unless an existing test proves they are already part of a supported wire shape. The UI may keep those as legacy rendering fallbacks.

### Daemon projection

In `packages/monitor/src/server.ts`:

- Import `DEFAULT_CONFIG` from `@eforge-build/engine/config` or otherwise use the same default value source already owned by the engine config module.
- Change the `options.config` type to include `maxConcurrentBuilds`.
- Add a helper similar to:

```ts
function getRunningBuildCount(): number {
  try {
    return db.getRunningRuns().length;
  } catch {
    return 0;
  }
}
```

- Add a helper for the scheduler limit:

```ts
function getSchedulerLimit(): number {
  return options?.config?.maxConcurrentBuilds ?? DEFAULT_CONFIG.maxConcurrentBuilds;
}
```

- In `autoBuildStateToWire()`, merge capacity onto `snapshot.scheduler`:

```ts
const runningCount = getRunningBuildCount();
const limit = getSchedulerLimit();
return {
  ...snapshot,
  scheduler: snapshot.scheduler
    ? { ...snapshot.scheduler, runningCount, limit }
    : { alive: false, paused: false, runningCount, limit },
};
```

Adapt the exact code to preserve the existing fallback snapshot and avoid duplicate DB calls in heartbeat construction. `buildHeartbeatObject()` can call the helper once and pass/reuse the value or rely on the enriched `autoBuildStateToWire()` as long as `runningBuilds` and `scheduler.runningCount` derive from the same DB read per heartbeat tick.

### UI reducer

Update the `daemon:heartbeat` projection in `packages/client/src/event-registry.ts` because the monitor UI reducer derives daemon handlers from that registry. Preserve the existing `latestHeartbeat` update and add an `autoBuild` delta only when `state.autoBuild` is non-null. Deep-merge the scheduler object so older heartbeats without optional capacity fields do not erase fields from a newer snapshot.

### UI rendering

In `daemon-drawer.tsx`:

- Add a helper with this mapping:
  - `undefined` / empty string → `none since startup`
  - `enqueue` → `enqueue`
  - `playbook-enqueue` → `playbook enqueue`
  - `apply-recovery` → `recovery applied`
  - `external` → `manual kick`
  - unknown non-empty strings → the raw string
- Change row label from `Scheduler injection` to `Last queue wake-up`.
- Change the `runningCount` + `limit` capacity branch from `2/4` to `2/4 running`.
- Keep the legacy fallback branches for `capacityRemaining`, `capacity`, and `maxRunningBuilds` so old snapshots still render without crashing.

### Generated docs

After schema changes, run `pnpm docs:generate` and commit only generated artifacts that change. Do not add a roadmap item for this bugfix.

## Verification

- [ ] `AutoBuildSchedulerState` in `packages/client/src/types.ts` and `AutoBuildSchedulerStateSchema` in `packages/client/src/events.schemas.ts` both expose optional numeric `runningCount` and `limit`.
- [ ] `DAEMON_API_VERSION` remains unchanged because the response-field additions are optional.
- [ ] `GET /api/auto-build` returns `scheduler.runningCount` equal to `db.getRunningRuns().length` and `scheduler.limit` equal to `maxConcurrentBuilds` for a daemon started with test config `{ maxConcurrentBuilds: 4 }`.
- [ ] `stream:hello.autoBuild` equals `GET /api/auto-build` including scheduler capacity fields.
- [ ] A captured `daemon:heartbeat` payload contains `runningBuilds: 1`, `autoBuild.scheduler.runningCount: 1`, and `autoBuild.scheduler.limit: 2` or the configured test limit.
- [ ] Dispatching a `daemon:heartbeat` event updates `state.latestHeartbeat` and updates `state.autoBuild.scheduler.lastMutationReason`, `runningCount`, and `limit` when `state.autoBuild` exists.
- [ ] Dispatching a `daemon:heartbeat` event leaves `state.daemonActivity.length` unchanged.
- [ ] The Scheduler FSM card renders the row label `Last queue wake-up` and no rendered text `Scheduler injection` remains.
- [ ] Missing `lastMutationReason` renders `none since startup`.
- [ ] `apply-recovery`, `external`, and `playbook-enqueue` render as `recovery applied`, `manual kick`, and `playbook enqueue`.
- [ ] Unknown wake-up reason strings render visibly without being replaced by fallback copy.
- [ ] Scheduler capacity with `{ runningCount: 1, limit: 2 }` renders `1/2 running`.
- [ ] `pnpm type-check` exits with status 0.
- [ ] `pnpm test` exits with status 0.
- [ ] `pnpm docs:check` exits with status 0.