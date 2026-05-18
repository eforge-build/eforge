---
id: plan-01-no-start-client-helpers
name: Add Non-Starting Client API Helpers
branch: prevent-pi-eforge-ambient-status-polling-from-auto-starting-the-daemon/plan-01-no-start-client-helpers
agents:
  builder:
    effort: high
    rationale: This touches many typed client API wrappers and must preserve
      existing auto-start helpers while adding no-start variants with consistent
      shapes.
  reviewer:
    effort: high
    rationale: Review must verify no-start semantics do not regress existing CLI/MCP
      auto-start behavior.
---

# Add Non-Starting Client API Helpers

## Architecture Context

`@eforge-build/client` owns daemon lockfile discovery, HTTP request helpers, typed route helpers, and the public exports consumed by both the Claude Code plugin and the Pi extension. Today `daemonRequest(...)` intentionally calls `ensureDaemon(cwd)`, which auto-starts `eforge daemon start` when no live daemon is present. The Pi extension needs a non-starting path, but existing CLI/MCP behavior must keep using the current auto-starting helpers.

This plan adds no-start variants without changing server routes, wire contracts, or the daemon API version.

## Implementation

### Overview

Add a consistent no-start request layer in `packages/client/src/daemon-client.ts`, export it from `packages/client/src/index.ts`, and provide no-start variants for the typed route helpers that Pi uses. Existing helpers such as `apiEnqueue`, `apiPlaybookList`, and `apiListExtensions` continue to use `daemonRequest(...)`; new `*IfRunning` helpers use `daemonRequestIfRunning(...)` and return `null` when no live daemon is available.

### Key Decisions

1. Keep `daemonRequest(...)` auto-starting so existing CLI/MCP behavior and other consumers remain unchanged.
2. Make no-start helpers return the same `{ data, port }` envelope when a daemon is running, and `null` when no daemon is running. Pi can wrap `null` into a user-facing error in plan 2.
3. Update `daemonRequestIfRunning(...)` to perform API version verification before non-version requests when a live daemon exists. This preserves stale-daemon diagnostics for Pi after it stops using `daemonRequest(...)`.
4. Do not bump `DAEMON_API_VERSION`; no HTTP route contract changes are introduced.

## Scope

### In Scope

- Add a typed `DaemonNotRunningError` or equivalent exported error type/message helper if useful for callers.
- Update `daemonRequestIfRunning(...)` to verify API version when it finds a live lockfile and the path is not `API_ROUTES.version`.
- Add no-start route helper variants for every route helper used by `packages/pi-eforge/`, including:
  - Queue/build status: enqueue, cancel, queue list, runs, latest run, running runs, run summary, running session summaries, run state, plans, diff, session metadata.
  - Config/profile/models/status: config show/validate, profile list/show/use/create/delete, model providers/list, health/project context/auto-build get/set as needed by Pi.
  - Extension tooling: list/show/validate/test/new/reload/trust/untrust.
  - Playbooks: list/show/save/enqueue/promote/demote/validate/copy.
  - Session plans: list/show/create/set-section/skip-dimension/set-status/select-dimensions/readiness/migrate-legacy.
  - Recovery/lifecycle helpers used by Pi: recover, read recovery sidecar, apply recovery, stop daemon.
- Export the new helpers from `packages/client/src/index.ts`.
- Update client README text describing auto-starting vs non-starting helpers.
- Add client-level tests that exercise no-start behavior with no lockfile and stale lockfile.

### Out of Scope

- Refactoring Pi extension call sites; plan 2 consumes the helpers.
- Daemon singleton/startup locking.
- Changing daemon HTTP routes or response schemas.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Create

- `test/client-no-start-api-helpers.test.ts` — validates non-starting daemon client behavior and representative route helpers.

### Modify

- `packages/client/src/daemon-client.ts` — add exported no-start error type/message if needed; ensure `daemonRequestIfRunning(...)` never calls `ensureDaemon(...)`, returns `null` for missing/stale lockfiles, and verifies API version for live daemons.
- `packages/client/src/api/queue.ts` — add `*IfRunning` variants used by Pi footer/status/build/queue/follow paths.
- `packages/client/src/api/config.ts` — keep or adjust existing config `*IfRunning` variants for consistency.
- `packages/client/src/api/profile.ts` — add profile `*IfRunning` variants.
- `packages/client/src/api/status.ts` — add status/auto-build `*IfRunning` variants.
- `packages/client/src/api/models.ts` — add model listing `*IfRunning` variants.
- `packages/client/src/api/extensions.ts` — add extension tooling `*IfRunning` variants.
- `packages/client/src/api/playbook.ts` — add playbook `*IfRunning` variants.
- `packages/client/src/api/session-plan.ts` — add session-plan `*IfRunning` variants.
- `packages/client/src/api/recover.ts` — add recovery trigger `*IfRunning` variant.
- `packages/client/src/api/recovery-sidecar.ts` — add sidecar read `*IfRunning` variant.
- `packages/client/src/api/apply-recovery.ts` — add apply-recovery `*IfRunning` variant.
- `packages/client/src/api/daemon.ts` — add stop-daemon `*IfRunning` variant.
- `packages/client/src/index.ts` — export all new no-start helpers and any new error type.
- `packages/client/README.md` — document that default route helpers auto-start and `*IfRunning` variants are passive.

## Verification

- [ ] `daemonRequestIfRunning(cwd, "GET", API_ROUTES.health)` returns `null` with no lockfile and does not spawn an `eforge` executable placed first in `PATH`.
- [ ] `daemonRequestIfRunning(cwd, "GET", API_ROUTES.health)` returns `null` with a stale lockfile whose port has no listener and does not spawn an `eforge` executable placed first in `PATH`.
- [ ] A representative new route helper, such as `apiGetQueueIfRunning({ cwd })`, returns `null` with no live daemon.
- [ ] Existing auto-starting helpers still import/use `daemonRequest(...)`; new `*IfRunning` helpers import/use `daemonRequestIfRunning(...)`.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test -- client-no-start-api-helpers` passes.
