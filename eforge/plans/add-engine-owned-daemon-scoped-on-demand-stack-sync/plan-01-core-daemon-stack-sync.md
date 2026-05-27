---
id: plan-01-core-daemon-stack-sync
name: Core Daemon-Owned Stack Sync
branch: add-engine-owned-daemon-scoped-on-demand-stack-sync/plan-01-core-daemon-stack-sync
agents:
  builder:
    effort: high
    rationale: Cross-package API, daemon concurrency, durable state,
      provider-boundary refactor, and safety semantics require careful
      coordinated changes.
  reviewer:
    effort: high
    rationale: Review must verify subprocess safety, daemon cwd ownership,
      event/wire compatibility, and provider-boundary discipline.
  tester:
    effort: high
    rationale: Tests must cover concurrent route behavior, active-build deferral,
      agent-worktree safety, event schemas, and provider-boundary regression
      gates.
---

# Core Daemon-Owned Stack Sync

## Architecture Context

Stack sync currently exists as an engine helper and a daemon route, but the CLI can fall back to local mutation from any cwd. This plan establishes the core safety boundary: stack sync is a daemon-owned operation that runs from the daemon's project root, records durable status, emits daemon-visible lifecycle events, and uses provider-neutral adapter methods instead of git-spice argv in orchestration code.

Keep the implementation on-demand. Do not add periodic polling. Do not auto-pause global auto-build for ordinary active-build deferrals.

## Implementation

### Overview

Implement a daemon stack-sync service around the existing `performStackSync()` primitive. The service must collect active build exclusions from the monitor DB, serialize wet sync mutations with a daemon-level mutex, persist the last/current sync status under `.eforge/stacks/`, emit stack sync lifecycle events, and expose a status route/snapshot field for clients.

Refactor provider-specific operations so non-provider modules do not import `stacking/git-spice.ts` or construct git-spice argv arrays directly.

Harden daemon discovery so commands invoked from agent worktrees cannot silently fall back to local mutation.

### Key Decisions

1. Persist stack sync status in `.eforge/stacks/sync-status.json` rather than adding monitor DB tables. This satisfies restart visibility without a schema migration and keeps stack runtime state colocated with `.eforge/stacks/layers.json`.
2. Add `deferred` to the stack sync outcome vocabulary. Active-build overlap is a retryable deferral, distinct from disabled stacking (`skipped`) and provider failures (`failed`/`conflict`).
3. Serialize wet stack sync requests in the daemon service. Dry-runs may run without taking the wet mutation mutex, but wet provider sync/restack commands must never overlap.
4. Keep git-spice details inside the provider adapter. Sync orchestration uses provider previews and provider redaction/PR parsing helpers; only the adapter/test/factory boundary may reference git-spice argv directly.
5. Add an opt-in daemon-owned after-build trigger config (`stacking.sync.afterBuild: true`) for the existing automatic workflow preset, but implement it as a daemon service request rather than a shell post-merge command.

## Scope

### In Scope

- Add shared wire types for stack sync trigger, active-build policy, outcome, provider command, active-build skip, report/status, and status route response.
- Extend `StackSyncRequest` with optional `trigger` and `activeBuildPolicy` fields.
- Extend `StackSyncResponse` with sync id, trigger, active-build policy, started/completed timestamps, deferred/conflict/failure fields, and sanitized provider command diagnostics.
- Add `GET /api/stack/sync/status` and include last/current stack sync status in the daemon `stream:hello` snapshot.
- Add stack sync lifecycle event schemas and registry entries for daemon-scoped persisted events.
- Add daemon service code that collects active build exclusions from `db.getRunningRuns()`, invokes `performStackSync()` from `options.cwd`, filters `activeBuildSkips`, persists status, emits lifecycle events, and serializes wet syncs.
- Refactor `performStackSync()` to return `deferred` on active-build overlap according to the active-build policy and to use provider command previews instead of hard-coded git-spice argv.
- Add durable sync-status load/save helpers under the stacking runtime state area.
- Extend provider adapters with provider-neutral command preview, PR URL parsing, pull-request URL validation, and redaction helpers.
- Update `executeStackLanding()` to use provider-level PR parsing/redaction helpers instead of importing `stacking/git-spice.ts`.
- Harden daemon client discovery for agent worktrees: discover the original project root daemon via the git common dir when possible; otherwise return/throw a specific safe error so callers do not fall back locally.
- Harden `eforge stack sync`: use the daemon route for wet sync, auto-start a daemon only from normal project roots, never run wet local fallback from an agent worktree, and allow dry-run local fallback only when clearly labeled as lacking daemon active-build knowledge.
- Add optional daemon-owned after-build sync scheduling in the monitor watcher when `stacking.enabled` and `stacking.sync.afterBuild` are true.
- Add tests for route shape, active-build deferral, mutex serialization, project-root cwd execution, durable status after restart, event schema/registry coverage, client helper behavior, agent-worktree no-fallback safety, config parsing, and provider-boundary grep gates.

### Out of Scope

- Periodic stack sync polling.
- Auto-resolving restack conflicts.
- Adding non-git-spice stack providers.
- Console/Pi/Claude UX rendering beyond preserving compatibility; richer surfaces are in later plans.

## Files

### Create

- `packages/engine/src/stacking/sync-state.ts` — load/save `.eforge/stacks/sync-status.json` with current/last stack sync status.
- `packages/monitor/src/stack-sync-service.ts` — daemon-owned stack sync orchestration, active-build collection, mutex, persistence, and event emission helpers.
- `test/stack-provider-boundary.test.ts` — grep-style regression checks for forbidden non-provider git-spice imports and hard-coded argv arrays.
- `test/stack-sync-cli-safety.test.ts` — CLI/client safety regression for agent worktree no wet local fallback.

### Modify

- `packages/engine/src/config.ts` — add `stacking.sync.afterBuild?: boolean` with default false and validation docs; keep existing stacking defaults compatible.
- `packages/engine/src/stacking/provider.ts` — add provider-neutral helpers for command previews, PR URL parsing/validation, and message redaction.
- `packages/engine/src/stacking/git-spice.ts` — implement the new provider helpers and keep git-spice argv definitions contained here.
- `packages/engine/src/stacking/sync.ts` — add trigger/policy/report metadata, `deferred` outcome handling, provider previews, sanitized failed command reporting, and durable-status-compatible report shape.
- `packages/engine/src/stacking/landing.ts` — remove direct git-spice helper imports; call provider-level helper methods.
- `packages/engine/src/stacking/index.ts` — export new sync status types/helpers; preserve only accepted provider boundary exports.
- `packages/client/src/events.schemas.ts` — add stack sync wire schemas/types, lifecycle event variants, and optional daemon snapshot stack sync status.
- `packages/client/src/event-registry.ts` — add daemon-scoped persisted stack sync event metadata and projection to stack sync state.
- `packages/client/src/routes.ts` — add `API_ROUTES.stackSyncStatus`, request/response/status route types, and updated outcome union.
- `packages/client/src/api/stack.ts` — add `apiGetStackSyncStatus` and `apiGetStackSyncStatusIfRunning`; update `apiStackSync` helpers to carry new body fields.
- `packages/client/src/daemon-client.ts` — add project-root daemon discovery from agent worktrees and safe errors for non-discoverable worktree calls.
- `packages/client/src/index.ts` and browser exports if needed — export new stack sync types/helpers.
- `packages/monitor/src/server.ts` — delegate stack sync POST/GET routes to the new service; include stack sync status in `stream:hello`; ensure route uses `options.cwd`.
- `packages/monitor/src/server-main.ts` — trigger daemon-owned after-build sync when configured and a build session completes successfully.
- `packages/eforge/src/cli/index.ts` — remove unsafe wet local fallback, route wet sync through daemon ownership, and render `deferred`/status metadata.
- `test/stack-sync-route.test.ts` — extend route tests for trigger/policy validation, deferred outcome, mutex serialization, project root cwd, status route, and restart status.
- `test/client-no-start-api-helpers.test.ts` — cover new status helper and updated request body shape.
- `test/daemon-client-guard.test.ts` — cover agent-worktree project root daemon discovery and safe non-discovery failure.
- `test/config.test.ts` — cover `stacking.sync.afterBuild` default and parsing.
- `test/git-spice-provider.test.ts` — cover command preview helpers and provider redaction/PR URL helpers.
- `test/stack-runtime-landing.test.ts` — update assertions after landing uses provider-level helpers.
- `packages/client/src/__tests__/events-schemas.test.ts` and `packages/client/src/__tests__/events-wire-parity.test.ts` — add stack sync lifecycle event cases and snapshot shape coverage.
- `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts` and `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — assert stack sync status appears in `stream:hello` and matches status route data.

## Verification

- [ ] `POST /api/stack/sync` with `dryRun: true` returns provider commands with `ran: false` and no provider command side effects.
- [ ] A wet sync with active-build overlap returns `outcome: "deferred"` (or `"skipped"` only when `activeBuildPolicy: "skip"`) and does not call `provider.restackStack`.
- [ ] A wet sync with no active-build overlap records `provider.syncRepo` before `provider.restackStack` when restack candidates exist.
- [ ] Two concurrent wet daemon route calls do not execute provider commands concurrently.
- [ ] The status route returns the last terminal sync after the POST response has completed.
- [ ] Status loaded from `.eforge/stacks/sync-status.json` appears after restarting the daemon server in tests.
- [ ] A CLI wet sync from an agent worktree with no discoverable project daemon exits non-zero and does not call local `performStackSync()`.
- [ ] Non-provider engine modules do not import `stacking/git-spice.ts` directly, except allowlisted provider factory/index boundaries.
- [ ] Non-provider engine modules do not contain hard-coded argv arrays for `repo sync`, `stack restack`, or `branch submit`.
- [ ] Stack sync failure responses include a failed provider command record and sanitized error output.
- [ ] Stack sync lifecycle events parse with `safeParseEforgeEvent()` and are present in the event registry.
