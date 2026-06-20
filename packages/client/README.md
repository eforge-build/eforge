# @eforge-build/client

Zero-dependency HTTP client for the eforge daemon.

## Consumers

- Root CLI (`packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, `packages/eforge/src/cli/mcp-extension-contributions.ts`)
- Monitor (`packages/monitor/src/index.ts`, `packages/monitor/src/server-main.ts`, `packages/monitor/src/registry.ts`)
- Console UI (`packages/console-ui/`, via `@eforge-build/client/browser`)
- Pi extension (`packages/pi-eforge/extensions/eforge/index.ts`, `packages/pi-eforge/extensions/eforge/extension-contributions.ts`)

## What's included

- **Lockfile operations** - read, write, update, remove the daemon lockfile
- **Daemon client** - `ensureDaemon`, `daemonRequest`, `daemonRequestIfRunning`, and status-preserving `daemonRequestWithStatus` helpers for routes that return typed non-2xx bodies
- **Route contract** - `API_ROUTES` constant map + `ApiRoute` type + `buildPath(pattern, params)` helper. Single source of truth for every daemon HTTP path; consumers reference these constants (or the typed helpers below) instead of inlining `/api/...` literals
- **Typed per-route helpers** - `api/queue.ts`, `api/queue-recovery.ts`, `api/failed-enqueue.ts`, `api/recovery-guidance.ts`, `api/scheduler.ts`, `api/profile.ts`, `api/status.ts`, `api/config.ts`, `api/models.ts`, `api/daemon.ts`, `api/recover.ts`, `api/recovery-sidecar.ts`, `api/apply-recovery.ts`, `api/playbook.ts`, `api/session-plan.ts`, `api/session-plan-set.ts`, `api/extensions.ts`, `api/extension-contributions.ts`, and `api/extension-agent-tasks.ts` expose one function per route. Queue-control helpers include `apiHoldQueueItem`, `apiUnholdQueueItem`, `apiPreviewQueueCascade`, and `apiApplyQueueCascade`; failed-enqueue helpers include `apiGetFailedEnqueues` and `apiReenqueueFailedEnqueue`; recovery guidance uses `apiPrepareRecoveryGuidance`; scheduler launch gating uses `apiSchedulerPause` and `apiSchedulerResume`. Browser consumers use the matching `@eforge-build/client/browser` helpers: `holdQueueItem`, `unholdQueueItem`, `previewQueueCascade`, `applyQueueCascade`, `fetchFailedEnqueues`, `reenqueueFailedEnqueue`, `prepareRecoveryGuidance`, `pauseScheduler`, and `resumeScheduler`. `api/extension-contribution-dispatch.ts` builds on the contribution manifest/action helpers to list and invoke host-facing action, integration-command, and action-backed deep-link targets. Each standard helper (e.g. `apiEnqueue`, `apiHealth`, `apiListProfiles`) wraps `daemonRequest<ResponseType>`, which **auto-starts the daemon** if no live daemon is found. For callers that must never auto-start the daemon (e.g. the Pi extension, which uses non-starting helpers for all daemon-backed operations), every route also has a `*IfRunning` variant (e.g. `apiGetQueueIfRunning`, `apiHealthIfRunning`, `apiListProfilesIfRunning`) that returns `null` when no daemon is running instead of spawning one. The `*IfRunning` variants also perform API version verification when a live daemon is found, so callers get the same stale-daemon diagnostics as the standard helpers
- **Session stream** - `subscribeWithSnapshot()` async-generator for consuming any daemon SSE stream with reconnect/backoff. Yields `{ kind: 'snapshot' }` on every connect (from `stream:hello`), `{ kind: 'event' }` for JSON events, and `{ kind: 'named' }` for other named SSE events. `DaemonStreamSnapshotSchema` is exported from `@eforge-build/client/events` for validating the hello snapshot shape, including `DaemonStreamSnapshot.failedEnqueues`, queue `dispatchFailure`, `QueueItem.hold`, and `QueueItem.capabilities`. Durable failed-enqueue projections use `FailedEnqueueInfo` and are updated by `daemon:failed-enqueue:upsert` / `daemon:failed-enqueue:resolved`. `aggregateSessionSummary()` computes a `SessionSummary` from a flat event array. SSE callers use `API_ROUTES.daemonEvents` for daemon-wide streams or `buildPath(API_ROUTES.events, { runId })` for per-session streams.
- **Request/response types** - TypeScript interfaces and TypeBox schemas for daemon HTTP endpoints, including queue controls, failed-enqueue recovery, `RecoveryGuidancePrepareResponse`, scheduler pause/resume, extension contribution manifest availability metadata, action invocation (including unavailable failures), and daemon-owned agent-task contracts
- **API version** - `DAEMON_API_VERSION` constant for version negotiation

## Rationale

The Pi extension (`packages/pi-eforge/`) cannot depend on the main `@eforge-build/eforge` package because it pulls in heavy engine dependencies (Claude SDK, build pipeline, etc.) that are unnecessary for a thin HTTP client. This zero-dependency package extracts the shared daemon wire protocol - lockfile operations, HTTP client helpers, and response type definitions - so both the MCP proxy and the Pi extension use the same typed client without duplicating code.

## Stability

- Public exports are stability-promised within a major version.
- Breaking changes bump the major version and are noted in the release.
- `DAEMON_API_VERSION` is bumped independently when the HTTP contract breaks.
