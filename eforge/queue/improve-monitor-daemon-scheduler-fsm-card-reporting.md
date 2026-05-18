---
title: Improve Monitor Daemon Scheduler FSM Card Reporting
created: 2026-05-18
profile: gpt-claude-combo
---

# Improve Monitor Daemon Scheduler FSM Card Reporting

## Problem / Motivation

The daemon Scheduler FSM card in the monitor UI presents two misleading or low-value rows:

1. `Capacity` often/always displays `not reported` even though the daemon has enough information to present current concurrency usage, e.g. `1/2 running` or `1 remaining of 2`.
2. `Scheduler injection` is an internal term. The signal is useful for debugging and should be kept, but renamed to a user-comprehensible debug label: `Last queue wake-up`.

This change should make the Scheduler FSM card more accurate without removing the debug signal. It should also avoid stale display of live scheduler details when heartbeats already carry fresher auto-build information.

### Context and Evidence

- `packages/monitor-ui/src/components/daemon/daemon-drawer.tsx` renders the Scheduler FSM card. It currently labels `scheduler?.lastMutationReason` as `Scheduler injection` and displays `not reported` when absent.
- The same file’s `formatSchedulerCapacity(autoBuild)` searches for `scheduler.runningCount`, `scheduler.limit`, `scheduler.capacityRemaining`, `scheduler.capacity`, or `scheduler.maxRunningBuilds`.
- `packages/client/src/types.ts` defines `AutoBuildSchedulerState` as only `{ alive, paused, lastMutationReason? }`; no capacity fields are part of the canonical client wire type today.
- `packages/monitor/src/auto-build-supervisor.ts` snapshots and refreshes only watcher liveness and scheduler `{ alive, paused, lastMutationReason? }`.
- `notifyQueueMutation()` is the source of `lastMutationReason`; values come from daemon route wake-ups such as `enqueue`, `playbook-enqueue`, `apply-recovery`, and `external`.
- `packages/monitor/src/server.ts` builds daemon `autoBuild` and heartbeat snapshots from the supervisor.
- Heartbeats include queue depth and running build count, but the canonical `autoBuild.scheduler` snapshot still lacks capacity details.
- `packages/engine/src/queue/scheduler.ts` knows `parallelism` and emits scheduler diagnostic events with capacity-like values:
  - `daemon:scheduler:dequeued.capacityRemaining`
  - `daemon:scheduler:capacity-blocked.runningCount`
  - `daemon:scheduler:capacity-blocked.limit`
- These are historical events rather than current status-card state.
- `eforge_config show` reports `maxConcurrentBuilds: 2` for this project. This is the configured concurrency limit that should back the status-card capacity denominator.
- Roadmap alignment: this is a UI/daemon maturity bugfix within the existing daemon-as-orchestration-authority direction. It does not add a new roadmap feature.
- Classification: **bugfix / focused** with high confidence. The symptom is incorrect/unhelpful UI reporting in an existing daemon status card; the likely fix spans the shared client wire contract, monitor daemon snapshot/heartbeat projection, monitor UI reducer, and drawer rendering/tests.

### Reproduction Steps

Observed/reported behavior:

1. Open the monitor UI daemon activity drawer.
2. Inspect the `Scheduler FSM` card.
3. Current actual behavior from the screenshot:
   - `Scheduler injection`: `not reported`.
   - `Capacity`: `not reported`.
4. Expected behavior after this fix:
   - The debug row is labeled `Last queue wake-up`, not `Scheduler injection`.
   - If no queue wake-up has happened since startup, display `none since startup` rather than `not reported`.
   - If a wake-up reason is present, display a friendly label, e.g. `recovery applied` for `apply-recovery`, `manual kick` for `external`.
   - `Capacity` displays current concurrency usage, e.g. `1/2 running`, using current running build count and configured max concurrent builds.
   - Existing live UI should converge on fresh scheduler details from heartbeat updates instead of requiring a reconnect.

Validation evidence:

- Backend current-state check with `eforge_auto_build get` returned `scheduler.lastMutationReason: apply-recovery`, showing the daemon can report the wake-up field in snapshots.
- `eforge_config show` returned `maxConcurrentBuilds: 2`, showing the configured denominator exists.
- The current card reads queue depth/running builds from `latestHeartbeat`, but capacity from `autoBuild.scheduler`, where capacity fields are absent today.

### Root Cause

1. **Capacity fields are not in the canonical auto-build wire contract.**
   - `packages/monitor-ui/src/components/daemon/daemon-drawer.tsx` expects optional scheduler fields such as `runningCount`, `limit`, `capacityRemaining`, `capacity`, or `maxRunningBuilds`.
   - `packages/client/src/types.ts` and `packages/client/src/events.schemas.ts` define `AutoBuildSchedulerState` without those fields.
   - `packages/monitor/src/auto-build-supervisor.ts` only snapshots scheduler `alive`, `paused`, and `lastMutationReason`.
   - Result: `formatSchedulerCapacity(autoBuild)` falls through to `not reported`.

2. **Capacity exists only as transient scheduler diagnostic event data today.**
   - `packages/engine/src/queue/scheduler.ts` emits `daemon:scheduler:dequeued.capacityRemaining` and `daemon:scheduler:capacity-blocked.runningCount/limit`.
   - Those events are historical/activity-feed signals, not a durable current-state snapshot for the status card.
   - The status card should use current state, not infer from old events.

3. **The label `Scheduler injection` exposes implementation vocabulary.**
   - The field being shown is `scheduler.lastMutationReason`, set by `AutoBuildSupervisor.notifyQueueMutation()` when daemon routes inject a `queue:mutation` wake-up into the live scheduler.
   - The signal is useful for debugging, but `Last queue wake-up` better describes it.

4. **Live stale-display risk.**
   - `daemon:heartbeat` projection updates `latestHeartbeat`, whose payload includes enriched `autoBuild` details.
   - The canonical `daemonState.autoBuild` slice is seeded from `stream:hello` or direct `SET_AUTO_BUILD` actions, and transition events only update transition fields; heartbeat currently does not refresh `daemonState.autoBuild`.
   - Result: an already-open drawer may continue showing stale/empty `lastMutationReason` until reconnect or another explicit auto-build state update.

## Goal

Improve the monitor UI Scheduler FSM card so it reports accurate, current scheduler capacity and preserves the queue wake-up debug signal with clearer user-facing copy.

The card should display live scheduler details from the canonical daemon/client wire contract and converge on fresh heartbeat data without requiring a reconnect.

## Approach

### High-Level Implementation

- Rename the Scheduler FSM card row from `Scheduler injection` to `Last queue wake-up`.
- Keep the row visible for debugging.
- Display missing `scheduler.lastMutationReason` as `none since startup`.
- Map known wake-up reasons to friendly labels:
  - `enqueue` → `enqueue`
  - `playbook-enqueue` → `playbook enqueue`
  - `apply-recovery` → `recovery applied`
  - `external` → `manual kick`
- Preserve unknown string values, preferably raw or minimally humanized, so debugging information is not lost.
- Make capacity a current-state metric, primarily displayed as `N/M running`.
- Use:
  - `N`: current running build count.
  - `M`: configured scheduler/build concurrency limit, `maxConcurrentBuilds`.
- Do not rely on historical `daemon:scheduler:*` events as the primary source for status-card capacity.
- Extend the shared client wire type/schema for scheduler state with optional current capacity fields, e.g.:
  - `runningCount?: number`
  - `limit?: number`
- Populate those fields in daemon auto-build snapshot and heartbeat paths from current daemon/config/runtime data.
- Preserve backward compatibility by keeping capacity fields optional and safely rendering older snapshots without them.
- Refresh live UI state by having heartbeat handling refresh the canonical `daemonState.autoBuild` with heartbeat auto-build details when present, or by having the drawer explicitly use heartbeat auto-build scheduler fields for live-only details.
- Prefer keeping `daemonState.autoBuild` authoritative/current so header/drawer behavior stays consistent.
- Keep existing stream snapshot seeding behavior working.
- Bump `DAEMON_API_VERSION` if the HTTP/SSE wire surface changes according to project policy.

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `maxConcurrentBuilds` is the correct capacity denominator for the Scheduler FSM card. | `packages/engine/src/eforge.ts` passes `this.config.maxConcurrentBuilds` as scheduler `parallelism`; `packages/engine/src/config.ts` defines default `maxConcurrentBuilds: 2`; `eforge_config show` reports `maxConcurrentBuilds: 2`. | high | low | Add daemon/server tests that assert projected `scheduler.limit` equals config `maxConcurrentBuilds`. | Capacity label would misrepresent actual concurrency. |
| Current running build count from the daemon DB (`db.getRunningRuns().length`) is an acceptable numerator for status-card capacity. | `packages/monitor/src/server.ts` heartbeat already uses `db.getRunningRuns().length` for `runningBuilds`; screenshot and UI already present `Running builds` from heartbeat. | medium-high | medium | Test with concurrent queue builds and compare scheduler diagnostic events against heartbeat running count; inspect worker tracker if finer-grained scheduler-only count is needed. | UI may count non-auto-build runs or lag scheduler state. If so, refine source to scheduler-owned count or active run projection. |
| Capacity should be optional wire fields on `AutoBuildSchedulerState` rather than only derived in the UI from heartbeat/config. | Project policy says daemon wire shapes are owned by `@eforge-build/client`, and current status-card card is intended to reflect canonical `autoBuild` snapshot. | high | low | Update `packages/client/src/types.ts` and `events.schemas.ts`; run type-check/schema tests. | If not in contract, UI may drift again or duplicate shape logic. |
| Heartbeat can safely refresh canonical `daemonState.autoBuild` without disrupting stream snapshot semantics. | Heartbeat already contains `autoBuild` detail; reducer currently treats heartbeat as live-only liveness. No evidence of code relying on heartbeat not updating autoBuild. | medium | medium | Review `packages/monitor-ui/src/lib/daemon-reducer.ts`, hook tests, and header/drawer behavior; add regression tests. | Could inadvertently override a more complete snapshot with a partial heartbeat object if merge logic is too blunt. Mitigation: merge partial fields carefully. |
| The debug signal should remain visible even when unknown values appear. | User explicitly requested keeping Last queue wake-up for debugging. | high | none | User confirmation already provided. | Hiding unknown values would reduce debugging utility. |
| API version bump may be required. | `packages/client/src/api-version.ts` documents daemon API versions and prior changes for optional auto-build lifecycle fields. | medium | low | Apply repo policy during implementation; if wire contract expands, bump and update comment. | Version mismatch warnings or clients unaware of new wire shape. |

No unresolved low-confidence/high-impact assumptions remain. The only medium-confidence item is the exact numerator source; it has a clear validation path and a bounded UI impact.

### Recommended Profile

Recommended profile: **Excursion**.

Rationale: this is a cohesive bugfix that crosses several packages (`@eforge-build/client`, monitor daemon, monitor UI, tests) but does not require delegated subsystem/module planning. A single planner can enumerate the contract changes, daemon projection changes, UI reducer/rendering changes, and test updates. It is more than an Errand because it touches the shared wire contract and live stream behavior, but it is not an Expedition because no independent module planners are needed.

## Scope

### In Scope

- Monitor UI Scheduler FSM card copy and rendering changes.
- Shared client wire contract updates for optional scheduler capacity fields.
- Daemon auto-build snapshot and heartbeat projection updates.
- Monitor UI live state refresh behavior so scheduler details update from heartbeat data.
- Tests for UI rendering, reducer/hook behavior, client schema/wire behavior, and daemon/server projection.
- Documentation updates if monitor UI/daemon activity docs mention this card or auto-build fields.
- API version bump if required by project policy.

### Out of Scope

- Adding new roadmap items.
- Adding a new roadmap feature.
- Relying on historical `daemon:scheduler:*` diagnostic events as the primary source for current status-card capacity.
- Removing the queue wake-up debug signal.

## Acceptance Criteria

1. **Rename and keep debug wake-up signal**
   - The Scheduler FSM card row label changes from `Scheduler injection` to `Last queue wake-up`.
   - The row remains visible for debugging.
   - `undefined`/missing `scheduler.lastMutationReason` displays `none since startup`.
   - Known values render friendly labels:
     - `enqueue` → `enqueue`
     - `playbook-enqueue` → `playbook enqueue`
     - `apply-recovery` → `recovery applied`
     - `external` → `manual kick`
   - Unknown string values remain visible, preferably raw or minimally humanized, so debugging information is not lost.

2. **Make Capacity a current-state metric**
   - The card displays current concurrency as `N/M running` where:
     - `N` is current running build count.
     - `M` is configured scheduler/build concurrency limit (`maxConcurrentBuilds`).
   - If only remaining capacity is available, existing fallback display may remain, but the primary happy path should be `runningCount/limit`.
   - For this project with `maxConcurrentBuilds: 2` and 1 running build, the UI should display `1/2 running` or an equivalently clear current-state label.
   - Do not rely on historical `daemon:scheduler:*` events as the primary source for the status-card capacity value.

3. **Wire capacity through the canonical contract**
   - Extend the shared client wire type/schema for scheduler state with current capacity fields, e.g. `runningCount?: number` and `limit?: number`.
   - Populate these fields in daemon auto-build snapshot and heartbeat paths from current daemon/config/runtime data.
   - Preserve backward compatibility: optional fields only; older snapshots without capacity still render safely.
   - Update daemon stream/auto-build route tests and wire-schema tests as needed.
   - Bump `DAEMON_API_VERSION` if the HTTP/SSE wire surface changes according to project policy.

4. **Refresh live UI state**
   - Heartbeat handling should refresh the canonical `daemonState.autoBuild` with heartbeat auto-build details when present, or the drawer should explicitly use heartbeat auto-build scheduler fields for live-only details.
   - Prefer keeping `daemonState.autoBuild` authoritative/current so header/drawer behavior stays consistent.
   - Existing stream snapshot seeding behavior should continue to work.

5. **Tests**
   - Monitor UI drawer tests cover:
     - `Last queue wake-up` label.
     - Friendly wake-up labels.
     - Missing wake-up reason → `none since startup`.
     - Capacity display from current `runningCount/limit`.
   - Reducer/hook tests cover heartbeat refreshing auto-build scheduler details if that implementation path is chosen.
   - Client schema/wire tests cover optional capacity fields.
   - Daemon/server tests cover auto-build snapshot/heartbeat capacity projection.

6. **Docs and user-facing copy**
   - If monitor UI/daemon activity docs mention this card or auto-build fields, update them.
   - Do not add new roadmap items; this is a bugfix/maturity improvement.
