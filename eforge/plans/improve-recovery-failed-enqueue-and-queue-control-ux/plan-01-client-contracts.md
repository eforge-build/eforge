---
id: plan-01-client-contracts
name: Client-owned wire contracts, route constants, helpers, event/snapshot
  schemas, queue capability types, failed-enqueue types, and API version bump.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/client-contracts
---

# Client Contracts

## Architecture Reference

This module implements the architecture sections **Client-owned contracts**, **Shared Data Model**, **Route additions in `@eforge-build/client`**, **Failed enqueue**, **Queue control route responses**, and the client side of **Projection parity**.

Key constraints from architecture:
- Every new route constant, request type, response type, event variant, snapshot field, browser helper, and node helper originates in `packages/client/src`.
- Daemon, Console, CLI/MCP, Pi, and plugin code must consume client-owned route constants and wire types rather than inlining `/api/...` paths or redeclaring shapes.
- Recovery analysis routes remain read-only; this module only defines the explicit recovery-guidance prepare/apply contract.
- Queue item capability metadata is daemon-authored and Console-facing; clients must not infer scheduler rules from queue statuses alone.
- Destructive remove/cancel cascade flows use preview/apply contracts with fail-closed defaults and explicit dependent confirmation.
- Failed-enqueue attention uses durable projection data keyed by `runId`, not recent-activity ring entries.
- New fields stay additive where possible, but `DAEMON_API_VERSION` must be bumped because first-party Console will rely on these routes/fields.

## Scope

### In Scope
- Add client-owned route constants for recovery guidance, queue hold/unhold, queue cascade preview/apply, failed enqueue listing/re-enqueue, and scheduler pause/resume.
- Add TypeScript request/response contracts for all new routes.
- Add queue hold state, queue item capability metadata, cascade preview/apply types, and failed-enqueue projection types.
- Add browser-safe helpers and node daemon-request helpers for the new routes.
- Extend daemon event schemas and snapshot schemas for failed enqueue projections and queue hold/capability metadata.
- Add event-registry entries/projectors for failed-enqueue upsert/resolved events.
- Export all new contracts and helpers from `@eforge-build/client`, `@eforge-build/client/browser`, and `@eforge-build/client/events` where relevant.
- Bump `DAEMON_API_VERSION` for the first-party feature gate.
- Add focused client contract, schema, event projection, and helper route-selection tests.

### Out of Scope
- Engine recovery-guidance rendering or git commits.
- Engine queue hold/cascade/cancel implementation.
- Monitor route handlers, validation, security, recorder, or DB projection code.
- Console components, selectors, hooks, and user interaction flows.
- CLI/MCP/Pi/Claude command exposure.
- Public documentation updates owned by the `docs-validation` module.

## Implementation Approach

### Overview

Implement this module as a pure client-contract expansion. Keep route keys and wire contracts in focused modules, extend existing public facades, and add schema/projector support so downstream daemon and Console work can compile against stable contracts.

The implementation has five parts:

1. **Route map and type contracts** — add the nine new route constants in `API_ROUTES` and define route-local request/response interfaces.
2. **Shared wire data** — extend `QueueItem` with optional hold/capability fields, add `QueueItemWithCapabilities`, and add durable `FailedEnqueueInfo`.
3. **Helpers and exports** — add browser helpers using `fetch` and node helpers using `daemonRequest`/`daemonRequestIfRunning`, then export them from both public entrypoints.
4. **Schemas and projections** — extend TypeBox schemas for queue items, failed enqueue snapshots, and failed enqueue daemon events; add event-registry projectors keyed by `runId`.
5. **Version and tests** — bump the daemon API version and add route/schema/helper tests that fail on contract drift.

### Route Contracts

Add these route keys to `API_ROUTES`:

| Key | Method | Path | Request | Response |
| --- | --- | --- | --- | --- |
| `recoveryGuidancePrepare` | `POST` | `/api/recover/guidance/prepare` | `RecoveryGuidancePrepareRequest` | `RecoveryGuidancePrepareResponse` |
| `queueHold` | `POST` | `/api/queue/:prdId/hold` | `QueueHoldRequest` | `QueueHoldResponse` |
| `queueUnhold` | `POST` | `/api/queue/:prdId/unhold` | `QueueUnholdRequest` | `QueueUnholdResponse` |
| `queueCascadePreview` | `POST` | `/api/queue/:prdId/cascade/preview` | `QueueCascadePreviewRequest` | `QueueCascadePreviewResponse` |
| `queueCascadeApply` | `POST` | `/api/queue/:prdId/cascade/apply` | `QueueCascadeApplyRequest` | `QueueCascadeApplyResponse` |
| `failedEnqueues` | `GET` | `/api/enqueue/failed` | none | `FailedEnqueuesResponse` |
| `failedEnqueueReenqueue` | `POST` | `/api/enqueue/failed/:runId/reenqueue` | `FailedEnqueueReenqueueRequest` | `FailedEnqueueReenqueueResponse` |
| `schedulerPause` | `POST` | `/api/scheduler/pause` | none | `SchedulerPauseResponse` |
| `schedulerResume` | `POST` | `/api/scheduler/resume` | none | `SchedulerResumeResponse` |

Keep existing route keys and response shapes source-compatible. Extend existing queue mutation responses additively with optional `item`, `queue`, and `autoBuild` fields so old daemon responses still type-check while new daemon responses can carry refreshed capability metadata.

### Wire Types

#### Recovery guidance

Create `routes/recovery-guidance.ts` with:
- `RecoveryGuidancePrepareRequest`: `{ prdId: string; setName?: string }`
- `RecoveryGuidancePatchStatus`: `'patched' | 'already-current' | 'artifact-missing' | 'blocked'`
- `RecoveryGuidancePatchedPlan`: `{ planId: string; path: string; status: RecoveryGuidancePatchStatus; reason?: string }`
- `RecoveryGuidancePrepareResponse`: `{ prdId; setName; featureBranch; baseBranch; outputDir; sidecarPath; sidecarGeneratedAt; plans; commitSha? }`

The response field names must match the architecture so engine and daemon modules can report resolved set/branch/output context without inventing local shapes.

#### Queue capabilities and hold state

In `types.ts`, add:
- `QueueItemCapability`: `{ allowed: boolean; reason?: string }`
- `QueueItemCapabilities` with required keys `priority`, `remove`, `dependencyOverride`, `hold`, `unhold`, `cascadeRemove`, `cancel`, and `cascadeCancel`.
- `QueueItemHold`: `{ held: boolean; reason?: string; heldAt?: string }`
- `QueueItemWithCapabilities = QueueItem & { capabilities: QueueItemCapabilities }`

Extend `QueueItem` additively:
- `hold?: QueueItemHold`
- `capabilities?: QueueItemCapabilities`

Route responses that are produced by new queue-control mutations must use `QueueItemWithCapabilities` for returned mutated items and refreshed queues. The base `QueueItem` remains additive/optional to preserve compatibility for older snapshots and tests.

#### Queue hold/unhold

In `routes/queue-control.ts`, add:
- `QueueHoldRequest`: `{ reason?: string }`
- `QueueHoldResponse`: `{ status: 'held' | 'already-held'; item: QueueItemWithCapabilities; queue?: QueueItemWithCapabilities[]; autoBuild?: AutoBuildState }`
- `QueueUnholdRequest`: `{}`
- `QueueUnholdResponse`: `{ status: 'unheld' | 'already-unheld'; item: QueueItemWithCapabilities; queue?: QueueItemWithCapabilities[]; autoBuild?: AutoBuildState }`

#### Queue cascade preview/apply

In `routes/queue-control.ts`, add:
- `QueueControlLocation`: `'queue' | 'waiting' | 'failed' | 'skipped'`
- `QueueCascadeOperation`: `'remove' | 'cancel'`
- `QueueCascadeStrategy`: `'target-only' | 'cascade-dependents'`
- `QueueCascadeEffect`: `'none' | 'target-remove' | 'target-cancel' | 'dependent-remove' | 'dependent-cancel' | 'dependent-skip' | 'refused'`
- `QueueCascadeRunningOwnership`: `{ owned: boolean; sessionId?: string; runId?: string; pid?: number; reason?: string }`
- `QueueCascadeAffectedItem`: `prdId`, `title`, `status`, `location`, `dependsOn`, `depth`, `effect`, `blockers`, optional `runningOwnership`.
- `QueueCascadeExpectedAffected`: `{ token: string; prdIds: string[] }` as the drift-check summary passed from preview to apply.
- `QueueCascadePreviewRequest`: `{ operation: QueueCascadeOperation }`
- `QueueCascadePreviewResponse`: target, dependents, `defaultRefusalReason?`, `safeStrategies`, warnings, blockers, and `expectedAffected`.
- `QueueCascadeApplyRequest`: `{ operation; strategy; expectedAffected; confirmDependents: boolean }`
- `QueueCascadeApplyItemResult`: `prdId`, `previousStatus`, `status`, optional `currentStatus`, `reason`, `sessionId`, and `removedSidecars`.
- `QueueCascadeApplyResponse`: `applied`, `operation`, `strategy`, target result, dependent results, warnings, blockers, optional refreshed `queue`, and optional `autoBuild`.

The `expectedAffected.token` value is opaque to clients; daemon/engine modules can encode a hash, mtime summary, or other drift token without changing this module.

#### Failed enqueue

In `types.ts`, add `FailedEnqueueInfo`:
- `runId: string`
- `sessionId?: string`
- `sourceLabel: string`
- `source?: EnqueueRequest`
- `failureReason: string`
- `failedAt: string`
- `canReenqueue: boolean`
- `disabledReason?: string`
- `nextCommand?: string`
- `resolvedAt?: string`

In `routes/failed-enqueue.ts`, add:
- `FailedEnqueuesResponse = FailedEnqueueInfo[]`
- `FailedEnqueueReenqueueRequest`: `{ confirm: true }`
- `FailedEnqueueReenqueueResponse`: `{ enqueued: boolean; failedEnqueue: FailedEnqueueInfo; queue: QueueItem[]; runs: RunInfo[]; newRunId?: string; disabledReason?: string; nextCommand?: string; autoBuild?: AutoBuildState }`

Require `confirm: true` for the re-enqueue helper body so monitor validation can distinguish an explicit operator action from an accidental no-body POST.

#### Scheduler pause/resume

Create `routes/scheduler.ts` and move/export scheduler response aliases there:
- `SchedulerKickResponse`: `{ ok: true }`
- `SchedulerPauseResponse = AutoBuildState`
- `SchedulerResumeResponse = AutoBuildState`

Keep `api/scheduler.ts` exporting `SchedulerKickResponse` for existing imports, but have it import the type from `routes/scheduler.ts`.

### Event and Snapshot Contracts

Add reusable TypeBox schemas in `events/shared/schemas.ts`:
- `QueueItemCapabilitySchema`
- `QueueItemCapabilitiesSchema`
- `QueueItemHoldSchema`
- `FailedEnqueueInfoSchema`

Extend `DaemonQueueItemSchema` in `events/snapshots.ts` with optional `hold` and `capabilities`. Add optional `failedEnqueues: FailedEnqueueInfo[]` to `DaemonStreamSnapshotSchema`. Although the daemon module will populate this field in stream hello snapshots, keeping it optional at the schema boundary preserves additive compatibility for external consumers and older test fixtures.

Add daemon event variants in `events/variants/daemon.ts`:
- `daemon:failed-enqueue:upsert`: `{ failedEnqueue: FailedEnqueueInfo }`
- `daemon:failed-enqueue:resolved`: `{ runId: string; resolvedAt: string; newRunId?: string }`

Extend `ProjectableState` in `event-registry.ts` with `failedEnqueues?: FailedEnqueueInfo[]`, then add persisted daemon registry entries:
- Upsert inserts/replaces by `runId` and sorts newest `failedAt` first.
- Resolved marks the matching entry with `resolvedAt` and optional `newRunId` is used only in the event summary.

Do not add queue hold/unhold event variants in this module. Queue mutation routes return refreshed queue projections, and downstream modules can add future queue mutation events in client-owned contracts if a live-event path becomes necessary.

### Helper Naming

Add node helpers:
- `apiPrepareRecoveryGuidance`, `apiPrepareRecoveryGuidanceIfRunning`
- `apiHoldQueueItem`, `apiHoldQueueItemIfRunning`
- `apiUnholdQueueItem`, `apiUnholdQueueItemIfRunning`
- `apiPreviewQueueCascade`, `apiPreviewQueueCascadeIfRunning`
- `apiApplyQueueCascade`, `apiApplyQueueCascadeIfRunning`
- `apiGetFailedEnqueues`, `apiGetFailedEnqueuesIfRunning`
- `apiReenqueueFailedEnqueue`, `apiReenqueueFailedEnqueueIfRunning`
- `apiSchedulerPause`, `apiSchedulerPauseIfRunning`
- `apiSchedulerResume`, `apiSchedulerResumeIfRunning`

Add browser helpers:
- `prepareRecoveryGuidance`
- `holdQueueItem`
- `unholdQueueItem`
- `previewQueueCascade`
- `applyQueueCascade`
- `fetchFailedEnqueues`
- `reenqueueFailedEnqueue`
- `pauseScheduler`
- `resumeScheduler`

All helpers must build parameterized paths with `buildPath(API_ROUTES.<key>, params)` and must surface non-2xx daemon response text in the thrown `Error` message, matching existing browser helper patterns.

### Key Decisions

1. **Optional base fields, required mutation projections.** `QueueItem.hold`, `QueueItem.capabilities`, and snapshot `failedEnqueues` are optional for additive compatibility. New mutation response types use `QueueItemWithCapabilities` where the daemon must return capability-bearing items.
2. **Opaque cascade drift token.** `QueueCascadeExpectedAffected.token` is an opaque string so engine/daemon modules can choose the drift algorithm without changing client types.
3. **Explicit re-enqueue confirmation.** `FailedEnqueueReenqueueRequest` requires `{ confirm: true }` so the daemon can reject unconfirmed mutation attempts at validation time.
4. **Failed enqueue projection uses `runId`.** Snapshot/live dedupe and event projectors key failed enqueue entries by `runId`, matching the architecture and preventing duplicate attention rows across reconnects.
5. **API version bump despite additive fields.** Bump to v72 because Console depends on new first-party route and projection fields; stale daemons must fail version verification before Console renders controls that the daemon cannot serve.
6. **No integration command exposure.** This module exports protocol/helper surfaces only. CLI/MCP/Pi/Claude command additions remain out of scope unless a later module explicitly exposes them and updates both integration packages.

## Files

### Create
- `packages/client/src/routes/recovery-guidance.ts` — recovery guidance prepare request/response contracts.
- `packages/client/src/routes/failed-enqueue.ts` — failed enqueue list and re-enqueue request/response contracts.
- `packages/client/src/routes/scheduler.ts` — scheduler kick/pause/resume response contracts.
- `packages/client/src/api/recovery-guidance.ts` — node daemon-request helpers for the recovery guidance prepare route.
- `packages/client/src/api/failed-enqueue.ts` — node daemon-request helpers for failed enqueue list/re-enqueue routes.
- `packages/client/src/browser-failed-enqueue.ts` — browser fetch helpers for failed enqueue list/re-enqueue.
- `packages/client/src/browser-scheduler.ts` — browser fetch helpers for scheduler pause/resume.
- `packages/client/src/__tests__/queue-control-contracts.test.ts` — client route/type/schema coverage for queue capabilities, hold/unhold, and cascade contracts.
- `packages/client/src/__tests__/failed-enqueue-contracts.test.ts` — client route/type/schema/event-registry coverage for failed enqueue contracts.
- `packages/client/src/__tests__/recovery-guidance-contracts.test.ts` — route/type/helper-source coverage for recovery guidance contracts.
- `test/browser-failed-enqueue-helpers.test.ts` — browser helper route-selection and error-surfacing tests for failed enqueue routes.
- `test/browser-scheduler-helpers.test.ts` — browser helper route-selection and error-surfacing tests for scheduler pause/resume.
- `test/browser-recovery-guidance-helpers.test.ts` — browser helper route-selection and error-surfacing tests for recovery guidance prepare.

### Modify
- `packages/client/src/routes/route-map.ts` — add all new route keys in one route-addition block near related queue/recovery/scheduler keys `[region: client-contracts, API_ROUTES additions near existing queue/recovery/scheduler routes]`.
- `packages/client/src/routes.ts` — export new route contract types from `routes/recovery-guidance.ts`, `routes/failed-enqueue.ts`, `routes/scheduler.ts`, and expanded `routes/queue-control.ts` `[region: client-contracts, grouped route contract exports]`.
- `packages/client/src/types.ts` — add queue hold/capability types, extend `QueueItem`, add `QueueItemWithCapabilities`, and add `FailedEnqueueInfo` `[region: client-contracts, queue and failed-enqueue wire type additions adjacent to QueueItem/RunInfo]`.
- `packages/client/src/routes/queue-control.ts` — add hold/unhold, cascade preview/apply, and additive refreshed projection fields on existing queue mutation responses.
- `packages/client/src/api/queue.ts` — add node helpers for hold/unhold and cascade preview/apply using `API_ROUTES` and `buildPath`.
- `packages/client/src/browser-queue-control.ts` — add browser helpers for hold/unhold and cascade preview/apply.
- `packages/client/src/api/scheduler.ts` — import scheduler response types from `routes/scheduler.ts`; add pause/resume node helpers and `IfRunning` variants.
- `packages/client/src/browser-recovery.ts` — add `prepareRecoveryGuidance` using the new route key and recovery-guidance contracts.
- `packages/client/src/events/shared/schemas.ts` — add TypeBox schemas for queue capabilities/hold and failed enqueue info.
- `packages/client/src/events/snapshots.ts` — add optional `hold`/`capabilities` to `DaemonQueueItemSchema` and optional `failedEnqueues` to `DaemonStreamSnapshotSchema` `[region: client-contracts, queue item schema and daemon snapshot additions]`.
- `packages/client/src/events/variants/daemon.ts` — add failed enqueue upsert/resolved daemon event variants.
- `packages/client/src/events.schemas.ts` — re-export new reusable schemas if tests or downstream packages need direct schema imports.
- `packages/client/src/events.ts` — re-export new schema symbols from the events barrel when exported by `events.schemas.ts`.
- `packages/client/src/event-registry.ts` — extend `ProjectableState`, add failed enqueue projectors, summaries, and persisted daemon registry entries `[region: client-contracts, failed-enqueue ProjectableState and event-registry entries]`. This file is over 1,000 lines; use bounded exact edits only.
- `packages/client/src/index.ts` — export new route types, shared wire types, node helpers, and browser helper functions from the main entrypoint `[region: client-contracts, consolidated public exports]`.
- `packages/client/src/browser.ts` — export new route types, shared wire types, browser helpers, and schema/projector types that are browser-safe `[region: client-contracts, consolidated browser exports]`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` from 71 to 72 and add a comment naming the first-party feature gate.
- `packages/client/src/__tests__/events-schemas-auto-build.test.ts` — add daemon snapshot schema cases for queue capabilities/hold and failed enqueue snapshots, or move new cases into the created focused contract tests if imports stay simpler.
- `test/browser-queue-control-helpers.test.ts` — extend existing browser route-selection tests for hold/unhold and cascade preview/apply.
- `test/client-no-start-api-helpers.test.ts` — add node `IfRunning` route-selection coverage for new helpers, or create a smaller sibling test if extending this file would make the setup harder to follow.

## Testing Strategy

### Unit Tests
- Route constants: assert all new `API_ROUTES` entries equal the specified paths and `buildPath` encodes `prdId`/`runId` parameters.
- Type contracts: instantiate representative `RecoveryGuidancePrepareResponse`, `QueueHoldResponse`, `QueueCascadePreviewResponse`, `QueueCascadeApplyResponse`, `FailedEnqueueInfo`, and `FailedEnqueueReenqueueResponse` values.
- Snapshot schemas: `safeParseDaemonStreamSnapshot` accepts queue items with `hold` and full `capabilities`, rejects malformed capability entries, accepts `failedEnqueues`, and rejects malformed failed enqueue items.
- Event schemas: `safeParseEforgeEvent` accepts `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved`, and rejects invalid failed enqueue payloads.
- Event registry: `DAEMON_EVENT_TYPES` contains both failed enqueue event types; `getEventSummary` returns stable summaries; upsert/resolved projectors dedupe by `runId` and mark `resolvedAt`.
- Browser helpers: stub `fetch` and assert method, path, JSON body, content type, returned JSON, and thrown error messages for non-2xx responses.
- Node helpers: use the existing test server pattern to assert daemon-request helpers send the specified method/path/body and `IfRunning` variants do not auto-start when the daemon is absent.
- API version: assert the exported constant is 72 in a focused test or update an existing version assertion if one exists.

### Integration Tests
- No daemon or Console integration tests are required in this module. Downstream modules will test route validation/security, projection parity, and UI behavior after consuming these contracts.

## Verification

- [ ] `API_ROUTES` exposes all nine new route keys with the paths listed in this plan.
- [ ] `buildPath` resolves `queueHold`, `queueUnhold`, `queueCascadePreview`, `queueCascadeApply`, and `failedEnqueueReenqueue` parameters with URL encoding.
- [ ] `routes.ts`, `index.ts`, and `browser.ts` export every new request/response type.
- [ ] `index.ts` exports every new node helper listed in this plan.
- [ ] `browser.ts` exports every new browser helper listed in this plan.
- [ ] `QueueItem` accepts optional `hold` and `capabilities` fields without requiring updates to existing queue item fixtures.
- [ ] New queue mutation response types expose capability-bearing `item` or `queue` fields where this plan lists them.
- [ ] `safeParseDaemonStreamSnapshot` accepts a queue item with all capability keys and a held state.
- [ ] `safeParseDaemonStreamSnapshot` accepts a snapshot containing two `failedEnqueues` entries keyed by distinct `runId` values.
- [ ] `safeParseEforgeEvent` accepts `daemon:failed-enqueue:upsert` with a full `FailedEnqueueInfo` payload.
- [ ] `safeParseEforgeEvent` accepts `daemon:failed-enqueue:resolved` with `runId`, `resolvedAt`, and `newRunId`.
- [ ] `eventRegistry` projects two upserts with the same `runId` to one failed-enqueue entry.
- [ ] `eventRegistry` projects a resolved event by setting `resolvedAt` on the matching failed-enqueue entry.
- [ ] Browser helper tests capture the specified methods, paths, bodies, and content-type headers for every new browser helper.
- [ ] Node helper tests capture the specified methods, paths, and bodies for every new node helper.
- [ ] `DAEMON_API_VERSION` equals `72` and the version comment names the Console feature-gate reason.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
