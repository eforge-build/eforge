---
title: Prevent Pi eforge Ambient Status Polling from Auto-Starting the Daemon
created: 2026-05-18
profile: gpt-claude-combo
---

# Prevent Pi eforge Ambient Status Polling from Auto-Starting the Daemon

## Problem / Motivation

Pi's eforge extension performs ambient footer status polling for every active Pi session. That polling currently uses daemon client APIs that auto-start the eforge daemon when none is running. With two Pi sessions in separate terminals, simultaneous ambient refreshes after daemon idle shutdown can race and spawn two daemon processes for the same project.

Each daemon owns its own in-memory queue scheduler and auto-build watcher, so the configured `maxConcurrentBuilds` limit is enforced per daemon rather than project-wide. The observed result was three builds running with `maxConcurrentBuilds: 2`.

Affected users: anyone with the Pi eforge extension installed and multiple Pi sessions open in the same eforge project.

Impact:

- Duplicate daemon processes
- Duplicate auto-build watchers
- Violated queue parallelism
- Confusing monitor ports
- Lockfile overwritten by the last daemon to start

### Evidence Gathered

- `packages/pi-eforge/extensions/eforge/index.ts` registers Pi `session_start` and immediately starts footer polling via `startStatusPolling(ctx)`. That function calls `refreshStatus(ctx)` immediately and then every 5 seconds.
- `refreshStatus(ctx)` currently calls `daemonRequest(...)` for `API_ROUTES.profileShow` and `API_ROUTES.queue`, and calls `apiGetRunningSessionSummaries({ cwd })` for active build footer state.
- `packages/client/src/daemon-client.ts` shows `daemonRequest(...)` calls `ensureDaemon(cwd)`, and `ensureDaemon(cwd)` auto-starts `eforge daemon start` when no live daemon lockfile exists.
- `packages/client/src/api/queue.ts` shows `apiGetRunningSessionSummaries(...)` calls `apiGetRunningRuns(...)`; `apiGetRunningRuns(...)` also uses `daemonRequest(...)`, so it can auto-start the daemon from the footer path.
- The observed incident had two daemons for the same cwd start within ~1 ms after idle shutdown, each with its own auto-build watcher; this is consistent with multiple Pi sessions performing ambient status refresh concurrently.
- Roadmap alignment: `docs/roadmap.md` has a daemon maturity goal: “single orchestration authority with richer controls and safety checks”. Preventing ambient UI from spawning daemon instances supports that direction.

### Reproduction Steps

Observed incident reproduction:

1. Let the project daemon shut down due to idle timeout.
2. Have two Pi sessions active in separate terminals with the `@eforge-build/pi-eforge` extension loaded.
3. Both sessions receive `session_start` and call `startStatusPolling(ctx)`.
4. Each session's first `refreshStatus(ctx)` performs daemon-backed status requests.
5. Because no live daemon is visible yet, both client processes can enter `ensureDaemon(cwd)` and spawn `eforge daemon start`.
6. One daemon binds the preferred port (`4567` in the observed case); the other retries to `4568` and also starts successfully.
7. Both persistent daemons load config and enable auto-build, resulting in two active queue watchers.

Observed evidence from this machine:

- Previous daemon shut down at `2026-05-18T14:13:31.724Z` due to idle timeout.
- Daemon PID `44785` started at `2026-05-18T14:13:36.630Z` on port `4567`.
- Daemon PID `44786` started at `2026-05-18T14:13:36.631Z` on port `4568`.
- Both emitted auto-build watcher-started events by `2026-05-18T14:13:36.637Z`.
- Running build child processes were parented by both daemons, confirming both were active schedulers.

Expected behavior: ambient Pi footer/status rendering should be passive. If no daemon is running, it should show no eforge footer/status rather than starting one. Explicit user commands may still start the daemon when appropriate.

### Root Cause

Confirmed root cause in code:

- `packages/pi-eforge/extensions/eforge/index.ts` registers `pi.on('session_start', ...)` and calls `startStatusPolling(ctx)` for every Pi session.
- `startStatusPolling(ctx)` immediately invokes `refreshStatus(ctx)`, then repeats every 5 seconds.
- `refreshStatus(ctx)` uses `daemonRequest(...)` for `API_ROUTES.profileShow` and `API_ROUTES.queue`.
- `refreshStatus(ctx)` also calls `apiGetRunningSessionSummaries({ cwd })`; in `packages/client/src/api/queue.ts`, that path calls `apiGetRunningRuns(...)`, which uses `daemonRequest(...)` for `API_ROUTES.runs`, then calls `apiGetRunSummary(...)`, also using `daemonRequest(...)`.
- `packages/client/src/daemon-client.ts` shows `daemonRequest(...)` calls `ensureDaemon(cwd)`. `ensureDaemon(cwd)` auto-starts by spawning `eforge daemon start` when there is no live daemon lockfile.

Therefore the ambient Pi footer path is side-effecting: a passive UI refresh can create a persistent daemon and auto-build watcher.

Related latent issue: daemon startup itself lacks an atomic singleton/startup lock. That deeper race permits duplicate daemons if two callers auto-start simultaneously. This plan focuses on removing Pi ambient auto-starts; a separate daemon-level singleton hardening task would still be valuable defense in depth.

## Goal

Pi eforge ambient footer/status rendering should be passive and must not auto-start the daemon.

No Pi extension operation should auto-start the daemon except the explicit daemon lifecycle start/restart path.

## Approach

Implement the change by auditing all Pi daemon-backed call paths and replacing side-effecting daemon client usage with non-starting request behavior except for explicit daemon start/restart.

Key technical decisions and constraints:

- Ambient footer polling should use a non-starting request path, such as `daemonRequestIfRunning(...)`, or new non-starting client helpers.
- Pi calls should avoid importing or using side-effecting `daemonRequest(...)` or route API helpers backed by `daemonRequest(...)`, except in the explicit daemon start/restart implementation or behind an explicitly named start helper.
- `eforge_daemon { action: "start" }` may call `ensureDaemon(ctx.cwd)`.
- `eforge_daemon { action: "restart" }` may stop, then start via `ensureDaemon(ctx.cwd)`.
- `eforge_daemon { action: "stop" }` must not start a daemon when none is running.
- Other Pi tools/commands that require the daemon should fail clearly when the daemon is not running, with guidance to run `eforge_daemon { action: "start" }` or `/eforge:restart`/manual `eforge daemon start` as appropriate.
- Existing shared client API helpers generally auto-start because they call `daemonRequest`. This was validated for queue helpers; grep found many Pi imports/calls to client API helpers. Implementation should audit every helper used by Pi, including `apiListExtensions`, playbook helpers, profile commands, config command, etc., and either add no-start variants or route through a Pi-local no-start wrapper.
- Once a daemon is explicitly running, existing Pi tools should preserve their response shapes and behavior.
- Update user-facing Pi skill docs/error text where they currently claim daemon connection failure auto-starts, so docs say the user must explicitly start the daemon.
- Do not bump `packages/pi-eforge/package.json` version.
- No daemon HTTP API version bump is required unless a breaking server route contract is changed.

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Broad Pi policy is desired: no Pi operation auto-starts the daemon except explicit daemon start/restart. | User explicitly confirmed option 2: “yes, 2”. | high | low | N/A — user-stated requirement. | If wrong, commands would become less convenient by requiring explicit daemon start. |
| Ambient footer polling is currently capable of auto-starting daemons. | Validated in `packages/pi-eforge/extensions/eforge/index.ts`: `session_start` → `startStatusPolling` → `refreshStatus`; validated in `packages/client/src/daemon-client.ts`: `daemonRequest` → `ensureDaemon` → spawn `eforge daemon start`. | high | low | Add a regression test that stubs/observes no start path during session footer refresh. | If wrong, fix may target the wrong call path; observed duplicate daemon race could remain. |
| `apiGetRunningSessionSummaries` used by footer polling can auto-start. | Validated in `packages/client/src/api/queue.ts`: `apiGetRunningSessionSummaries` → `apiGetRunningRuns` → `daemonRequest`. | high | low | Replace or supplement with `IfRunning` variants and test no daemon startup. | If missed, footer polling could still start a daemon even after replacing direct `daemonRequest` calls. |
| The explicit daemon start/restart tool should remain the only Pi-side use of `ensureDaemon`. | User requirement plus existing `eforge_daemon` semantics in `packages/pi-eforge/extensions/eforge/index.ts`. | high | low | Static grep/test over `packages/pi-eforge` for `ensureDaemon(` and `daemonRequest(` allowlist. | If wrong, some hidden path may still auto-start or explicit start may regress. |
| Existing shared client API helpers generally auto-start because they call `daemonRequest`. | Validated for queue helpers; grep found many Pi imports/calls to client API helpers. Not every helper implementation was read, but the pattern is consistent. | medium | medium | Audit every helper used by Pi (`apiListExtensions`, playbook helpers, profile commands, config command, etc.) and either add no-start variants or route through a Pi-local no-start wrapper. | If wrong/incomplete, a less obvious command path could still start the daemon. |
| Daemon startup singleton hardening is out of scope for this PRD. | Root cause has two layers; this plan addresses the Pi trigger. The deeper daemon race remains valuable defense-in-depth but is not required to satisfy the user’s Pi policy. | high | low | Create/follow-up separate PRD for atomic daemon singleton/startup lock. | Duplicate daemons may still be possible from two explicit starts or other clients until daemon-level locking is fixed. |

### Profile Signal

Recommended profile: **excursion**.

Rationale: this is a cohesive bugfix with a clear root cause, but it spans multiple Pi integration modules and likely requires shared helper design plus static/regression tests. A single planner can cover the work without delegated module planning, so Expedition would be unnecessary. Errand is too small because broad policy requires auditing all Pi daemon call sites and updating docs/tests.

## Scope

### In Scope

- Prevent Pi eforge ambient footer polling from auto-starting the daemon.
- Ensure no Pi extension operation auto-starts the daemon except explicit daemon lifecycle start/restart.
- Preserve existing behavior and response shapes for explicit user workflows once a daemon is already running:
  - Build enqueue
  - Follow
  - Status
  - Config/profile/playbook/session-plan/recovery/extension tools
- Audit all Pi imports and helper usage to find route-specific client helpers backed by `daemonRequest(...)`.
- Add or use non-starting client helpers such as `daemonRequestIfRunning(...)`.
- Update Pi docs/error text that currently claims daemon connection failure auto-starts.
- Add regression and policy/static tests covering the new behavior.
- Support roadmap direction from `docs/roadmap.md` daemon maturity goal: “single orchestration authority with richer controls and safety checks”.

### Out of Scope

- Daemon-level singleton/startup lock hardening. Startup itself currently lacks an atomic singleton/startup lock, and duplicate daemons may still be possible from two explicit starts or other clients until daemon-level locking is fixed. This should be handled as a separate defense-in-depth task.
- Bumping `packages/pi-eforge/package.json` version.
- Bumping the daemon HTTP API version unless a breaking server route contract is changed.

## Acceptance Criteria

1. Pi eforge ambient footer polling never auto-starts the daemon. If no daemon is running, footer keys `eforge`, `eforge-build`, and `eforge-queue` are cleared/left unset.
2. No Pi extension operation auto-starts the daemon except the explicit daemon lifecycle tool path:
   - `eforge_daemon { action: "start" }` may call `ensureDaemon(ctx.cwd)`.
   - `eforge_daemon { action: "restart" }` may stop, then start via `ensureDaemon(ctx.cwd)`.
   - `eforge_daemon { action: "stop" }` must not start a daemon when none is running.
3. All other Pi tools/commands that require the daemon fail clearly when the daemon is not running, with guidance to run `eforge_daemon { action: "start" }` or `/eforge:restart`/manual `eforge daemon start` as appropriate.
4. Explicit user workflows keep their existing behavior once a daemon is already running: build enqueue, follow, status, config/profile/playbook/session-plan/recovery/extension tools still use the current daemon and return the same data shapes.
5. The Pi extension no longer imports/uses side-effecting `daemonRequest(...)` or route API helpers backed by `daemonRequest(...)` except in the explicit daemon start/restart implementation or behind an explicitly named start helper. Prefer `daemonRequestIfRunning(...)` or new non-starting client helpers for Pi calls.
6. Tests cover the regression: invoking Pi session-start/footer refresh with no daemon lockfile or a stale lockfile does not call/spawn `ensureDaemon` and does not execute `eforge daemon start`.
7. Tests or static guard cover broad policy: non-daemon-start Pi tool/command paths use non-starting request helpers; the only allowed `ensureDaemon` calls in `packages/pi-eforge/` are `eforge_daemon` start/restart.
8. User-facing Pi skill docs/error text are updated where they currently claim daemon connection failure auto-starts, so docs say the user must explicitly start the daemon.
9. Do not bump `packages/pi-eforge/package.json` version. No daemon HTTP API version bump is required unless a breaking server route contract is changed.
