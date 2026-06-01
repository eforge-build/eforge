---
id: plan-02-projections-read-models
name: Extract reusable read-side projections for run summaries, run state,
  plans, queue items, stack layers, auto-build state, config redaction, and
  event hydration.
branch: migrate-monitor-server-to-a-maintainable-architecture/projections-read-models
---

# Projections Read Models

## Architecture Reference

This module implements the projection layer from the architecture sections **Target package layout**, **Projection contracts**, and **Module implementation boundaries / `projections-read-models`**.

Key constraints from architecture:
- Projection modules produce reusable read models for REST routes and SSE `stream:hello` snapshots while preserving current daemon HTTP/SSE wire shapes.
- Projection functions depend on `MonitorDB`, filesystem paths, or narrow value objects; they do not depend on `MonitorContext`, route modules, HTTP primitives, or stream lifecycle modules.
- Wire shapes come from `@eforge-build/client`; monitor projections must import client-owned types/schemas instead of re-declaring route response interfaces.
- `server.ts` is owned by `server-composition-coverage`; this module creates projection modules and direct tests, but it does not wire or trim `packages/monitor/src/server.ts`.
- Sync and async queue loaders live in one queue projection module so `GET /api/queue` and daemon `stream:hello.queue` can share the same shaping logic after final wiring.
- Stack-layer loading lives in one stack projection module so `GET /api/stack/layers` and daemon `stream:hello.stackLayers` can share the same validation logic after final wiring.
- Event hydration must call `safeParseEforgeEvent(value)` from `@eforge-build/client` and must preserve current log-and-skip behavior for malformed event rows.

## Scope

### In Scope
- Create projection modules under `packages/monitor/src/projections/` for:
  - run summaries;
  - run state and event hydration;
  - plans endpoint response construction;
  - queue item loading and queue-depth read helpers;
  - stack layer loading and validation;
  - auto-build state, heartbeat auto-build payloads, and daemon heartbeat object projection;
  - config/profile/git-remote redaction;
  - diff endpoint response shaping.
- Copy behavior from `packages/monitor/src/server.ts` into projection modules without changing public route behavior.
- Add direct projection tests that lock current edge cases and compare selected projection output with current `server.ts` helpers where compatibility exports exist.
- Keep all created implementation files at or below 600 lines; add durable semantic `eforge:region` markers to any created implementation file that exceeds 300 lines.
- Keep `test/run-summary-plans.test.ts` unchanged so its import from `@eforge-build/monitor/server` remains a compatibility regression check for the final module.

### Out of Scope
- No changes to `packages/monitor/src/server.ts` in this module.
- No route registry, route handler, HTTP primitive, `MonitorContext`, or stream-hub wiring.
- No `streams/*` files. The stream-hub module may later import these projection helpers or add thin stream-owned wrappers.
- No daemon API route, request shape, response shape, SSE frame shape, or `DAEMON_API_VERSION` change.
- No database schema, recorder, scheduler, engine orchestration, plugin, or Pi extension change.

## Implementation Approach

### Overview

Create projection modules by moving the read-side logic currently embedded in `server.ts` into standalone functions. The current `server.ts` implementation remains in place during this module to avoid cross-module conflicts; downstream modules will wire the new functions into routes and streams.

The projection modules must be read-side only: they may query `MonitorDB`, read files, parse data, validate client-owned schemas, and return typed wire objects, but they must not write files, mutate daemon state, spawn workers, or write HTTP/SSE responses.

Downstream integration points:
- `server-composition-coverage` will re-export `buildRunSummary` from `projections/run-summary.ts` through `@eforge-build/monitor/server`.
- `control-monitor-routes` will call `buildRunSummary`, `buildRunState`, `buildPlansResponse`, `buildDiffResponse`, and queue projections.
- `config-profile-stack-routes` will call config redaction, stack layer projection, and auto-build projection helpers.
- `stream-hub` will call queue, stack, auto-build, heartbeat, and event hydration helpers when constructing `stream:hello` snapshots and replaying rows.

### Key Decisions

1. **Do not edit `server.ts` in this module.**
   - Rationale: the architecture assigns `server.ts` to `server-composition-coverage`. Creating projection modules first gives later modules stable imports without causing concurrent edits to the 4,924-line composition file.

2. **Preserve existing quirks as contract.**
   - Rationale: this is a behavior-preserving migration. Examples to preserve:
     - `buildRunSummary` seeds plans from the latest `planning:complete` event, but `buildPlansResponse` uses the first `planning:complete` event for compiled plans because current `servePlans` does that.
     - `plan:build:complete` and `plan:build:failed` only mutate an existing plan entry; they do not create missing entries.
     - queue frontmatter parsing remains the current small line parser, not full YAML parsing.
     - invalid stack layer entries invalidate the whole stack layer file and return `[]`.
     - malformed event rows are logged to stderr and skipped.

3. **Use client-owned wire types everywhere a response crosses the daemon boundary.**
   - Rationale: project policy assigns route constants and daemon wire shapes to `@eforge-build/client`. Projection functions return `RunSummary`, `RunState`, `PlansResponse`, `QueueItem[]`, `StackLayerWire[]`, `AutoBuildState`, `DaemonStreamSnapshot['liveness']`, and `DiffResponse` imported from the client package.

4. **Keep queue filesystem logic in one module.**
   - Rationale: sync and async queue readers must share `parseQueueFrontmatter`, item construction, recovery verdict parsing, and `dependsOn` filtering so REST and daemon stream snapshots cannot drift.

5. **Keep event parsing available from the projection layer until stream ownership lands.**
   - Rationale: `stream-hub` depends on this module, but this module has no dependency on `stream-hub`. Implement `parseEventRow` in `projections/event-hydration.ts` and expose it for route and stream consumers. If a later module introduces `streams/event-parser.ts`, it can re-export or wrap this function rather than duplicating parsing logic.

6. **Make auto-build capacity explicit.**
   - Rationale: the projection module must not query the DB or read config by itself. Callers pass `runningCount` and `limit` from context or route-local providers; the projection enriches the controller snapshot with those values.

## Files

### Create

- `packages/monitor/src/projections/run-summary.ts` — exports `buildRunSummary(db, sessionId): RunSummary` plus private helper functions for session status, plan seeding, lifecycle overlays, current phase/agent, event counts, and duration.
- `packages/monitor/src/projections/event-hydration.ts` — exports `parseEventRow`, `hydrateEforgeEvent`, `hydrateEventRecordForRunState`, `hydrateRecentDaemonActivity`, and session status helpers used by run state and streams.
- `packages/monitor/src/projections/run-state.ts` — exports `buildRunState(db, sessionId): RunState` and uses event hydration helpers to return the same `{ status, events }` shape as the current `/api/run-state/:id` handler.
- `packages/monitor/src/projections/plans.ts` — exports `buildPlansResponse({ db, sessionId, planOutputDir }): Promise<PlansResponse>` plus private filesystem/orchestration helpers currently nested under `servePlans`.
- `packages/monitor/src/projections/queue-items.ts` — exports `parseQueueFrontmatter`, `loadQueueItemsSync`, `loadQueueItems`, `loadQueueItemsForCwd`, `loadQueueItemsForCwdSync`, and `countPendingQueueDepth`.
- `packages/monitor/src/projections/stack-layers.ts` — exports `stackLayersToWire(cwd): StackLayerWire[]` and validates each layer with `StackLayerWireSchema` from `@eforge-build/client`.
- `packages/monitor/src/projections/auto-build-state.ts` — exports `autoBuildStateToWire`, `autoBuildHeartbeatToWire`, and `buildDaemonHeartbeatObject` using client `AutoBuildState` / `DaemonStreamSnapshot` types and a narrow auto-build controller provider.
- `packages/monitor/src/projections/config-redaction.ts` — exports `redactSensitive(value)` and `redactGitRemote(remote)` with the exact current sensitive key set and URL credential-stripping behavior.
- `packages/monitor/src/projections/diff.ts` — exports `buildDiffResponse(db, sessionId, planId, filePath?)` returning client `DiffResponse`.
- `packages/monitor/src/__tests__/projections-run-summary.test.ts` — direct projection tests, including parity between `projections/run-summary.ts` and the current `server.ts` export on a seeded DB.
- `packages/monitor/src/__tests__/projections-event-run-state.test.ts` — tests event row back-compat patching, invalid-row skipping, `buildRunState` status derivation, and hydrated event serialization.
- `packages/monitor/src/__tests__/projections-plans.test.ts` — tests compiled plans, expedition file loading, gap-close fallback, `build:resume:artifacts` fallback, and build/review enrichment from `orchestration.yaml`.
- `packages/monitor/src/__tests__/projections-queue-items.test.ts` — tests sync/async parity, pending/running/failed/skipped/waiting statuses, recovery verdict sidecars, malformed sidecars, and `dependsOn` filtering.
- `packages/monitor/src/__tests__/projections-stack-layers.test.ts` — tests absent file, malformed JSON, invalid root, invalid entry, and valid layer fixtures.
- `packages/monitor/src/__tests__/projections-auto-build-state.test.ts` — tests default disabled projection, controller snapshot projection, scheduler capacity enrichment, heartbeat auto-build payload, and daemon heartbeat object fields with injected timestamps.
- `packages/monitor/src/__tests__/projections-config-redaction.test.ts` — tests nested sensitive key redaction, array handling, credential stripping from URL remotes, and unchanged SSH-style remotes.
- `packages/monitor/src/__tests__/projections-diff.test.ts` — tests single-file and bulk diff response shaping from real `MonitorDB` rows.

### Modify

No existing production source files are modified by this module.

No shared-file edit regions are required because this module does not edit files listed in the architecture Shared File Registry. If an implementer discovers that a shared file edit is unavoidable, stop and update this plan before implementation; do not add ad hoc changes to `server.ts`, `routes/index.ts`, `context.ts`, or `streams/*`.

## Implementation Details

### `run-summary.ts`

Preserve current `buildRunSummary` behavior:
- session status precedence: no runs => `unknown`; any running => `running`; else any failed => `failed`; else `completed`;
- `runs` array maps `completedAt` from `undefined` to `null`;
- plan map seeds from the latest `planning:complete` event;
- `plan:build:start` creates missing entries with `branch: null` and `dependsOn: []` fallback;
- `plan:build:complete` and `plan:build:failed` update entries only when the plan exists;
- current phase comes from the latest `phase:start` event;
- current agent comes from the latest `agent:start` without a matching `agent:stop` by `agentId`;
- event error count increments for event types ending in `:failed` or `:error`;
- active duration uses `Date.now()` as the current implementation does.

Split the implementation into helpers to keep cognitive complexity under 30 per function.

### `event-hydration.ts` and `run-state.ts`

`parseEventRow` copies current semantics:
- JSON parse failure logs `[parseEventRow] unparseable JSON...` and returns `null`;
- missing payload `timestamp` is patched from the DB timestamp;
- missing payload `type` is patched from the DB type;
- validation calls `safeParseEforgeEvent(parsed)`;
- validation failure logs `[parseEventRow] invalid event...` and returns `null`.

`buildRunState` must:
- derive `RunState['status']` with the same precedence as the current handler;
- fetch `db.getEventsBySession(sessionId)`;
- skip rows whose parsed event is `null`;
- return event records with `data: JSON.stringify(parsedEvent)` while preserving row `id`, `runId`, `type`, `planId`, `agent`, and `timestamp` fields.

Expose helpers that `stream-hub` can reuse:
- `hydrateEforgeEvent(row)` for replaying one DB row;
- `hydrateRecentDaemonActivity(rows, helloCursor)` for daemon `stream:hello.recentActivity` with the existing `id <= helloCursor` trim;
- `deriveSessionStreamStatus(sessionRuns)` returning `pending | running | failed | completed` for session SSE snapshots.

### `plans.ts`

Move the current plan response construction without route response writing:
- `candidateOrchestrationPaths(repoCwd, planBase, planSet)` preserves main-repo then merge-worktree order.
- `candidatePlanDirs(repoCwd, planBase, planSet)` preserves main-repo then merge-worktree order.
- `readExpeditionFiles(planDir, moduleMap)` reads `architecture.md` and sorted `modules/*.md`, skipping module files not present in `moduleMap` when the map is non-empty.
- `readBuildConfigFromOrchestration(db, sessionId, planOutputDir)` reads `orchestration.yaml` from the latest run with `cwd` and `planSet`, preserving the current path containment check.
- `buildPlansResponse` combines expedition files, compiled plans, gap-close plans, and `build:resume:artifacts` fallback in the current order.
- Build/review config enrichment only fills `plan.build` or `plan.review` when that property is `undefined`.

Use `PlanInfo` / `PlansResponse` from `@eforge-build/client` instead of the local `PlanResponse` type currently nested in `server.ts`.

### `queue-items.ts`

Keep queue item shaping byte-for-byte compatible with current responses:
- manual frontmatter parser supports arrays, integers, booleans, quoted strings, and raw strings exactly as current code;
- only files ending in `.md` are considered;
- directory traversal is not introduced because callers pass resolved queue directories and file names come from `readdir`;
- pending items become `running` when `<id>.lock` exists in the lock directory;
- failed items may gain `recoveryVerdict` from `<id>.recovery.json` when `recoveryVerdictSchema` validation succeeds;
- failed/skipped items lose `dependsOn`;
- live pending/running/waiting items keep only dependencies that reference other live items.

Both sync and async loaders must call the same item-builder and post-processing helpers. `countPendingQueueDepth(cwd, queueDirOption)` returns the count of `.md` files directly under the pending queue root and returns `0` if the directory is absent or unreadable.

### `stack-layers.ts`

Preserve current stack layer projection:
- read `.eforge/stacks/layers.json` from the supplied `cwd`;
- return `[]` when the file is absent, unreadable, malformed, has a root other than `{ version: 1, layers: [...] }`, or contains any invalid layer entry;
- validate every layer with `safeParseWithSchema(StackLayerWireSchema, item)`.

### `auto-build-state.ts`

Use a narrow input shape:

```ts
interface AutoBuildProjectionInput {
  state?: { autoBuildController: Pick<AutoBuildController, 'getSnapshot'> };
  capacity: { runningCount: number; limit: number };
}
```

`autoBuildStateToWire(input)` must:
- call `state.autoBuildController.getSnapshot()` when present;
- fall back to the same disabled snapshot currently embedded in `server.ts` when absent;
- enrich `scheduler.runningCount` and `scheduler.limit` with the passed capacity;
- create a default scheduler object when the snapshot lacks `scheduler`.

`autoBuildHeartbeatToWire(input)` returns the current heartbeat sub-shape: `enabled`, `paused`, `desired`, `mode`, `scheduler`, `lastTransition`, and `reason`.

`buildDaemonHeartbeatObject(input)` returns `DaemonStreamSnapshot['liveness']` with injected `now`, `startedAtMs`, `queueDepth`, `runningBuilds`, `subscriberCount`, and auto-build inputs. Use an injectable clock in tests so assertions do not depend on wall time.

### `config-redaction.ts`

Preserve the current sensitive key set:
- `apikey`
- `token`
- `secret`
- `password`
- `authorization`
- `credential`
- `credentials`

The match is case-insensitive after lowercasing the key. Array and object values recurse. Non-object scalar values return unchanged. `redactGitRemote` strips username/password from URL remotes and leaves SSH/non-URL remotes unchanged.

### `diff.ts`

Move the inline diff response mapping from `serveDiff`:
- with `filePath`, return `{ diff: record?.diffText ?? null }`;
- without `filePath`, return `{ files: records.map((r) => ({ path: r.filePath, diff: r.diffText })) }`.

## Testing Strategy

### Unit Tests
- Run summary:
  - seed pending plans from latest `planning:complete`;
  - overlay running/completed/failed status without dropping sibling plans;
  - fallback to build-start events when planning data is absent;
  - direct projection output equals current `server.ts` `buildRunSummary` for a completed session fixture.
- Event hydration/run state:
  - missing payload `timestamp` and `type` are injected from DB columns;
  - invalid JSON rows return `null`;
  - invalid schema rows return `null`;
  - `buildRunState` skips invalid rows and returns hydrated JSON strings for valid rows.
- Plans:
  - compiled plans from `planning:complete` map to `PlansResponse` entries;
  - expedition architecture and module files load from the main repo path;
  - merge-worktree fallback path is used when the main path is absent;
  - gap-close plan body falls back to latest gap-closer `agent:result` text when `planBody` is non-substantive;
  - `build:resume:artifacts` produces plans only when other sources produce no plans;
  - `orchestration.yaml` build/review config enriches existing plan entries without overwriting present fields.
- Queue items:
  - sync and async loaders return deeply equal arrays for the same fixture;
  - lock files convert pending status to running;
  - valid recovery sidecars add `recoveryVerdict` for failed items;
  - missing/malformed sidecars omit `recoveryVerdict`;
  - `dependsOn` keeps live dependencies and drops missing/failed/skipped dependencies.
- Stack layers:
  - absent file, malformed JSON, invalid root, and invalid layer entry return `[]`;
  - valid fixtures return exact layer objects.
- Auto-build state:
  - absent daemon state returns disabled wire state with capacity fields;
  - controller snapshot returns enabled/running fields with capacity fields;
  - heartbeat auto-build payload contains `paused: true` when mode is `paused` or scheduler is paused;
  - daemon heartbeat object contains injected timestamp, uptime, queue depth, running count, subscriber count, and auto-build scheduler capacity.
- Config redaction:
  - nested sensitive keys become `[redacted]`;
  - arrays recurse;
  - URL credentials are removed from HTTPS remotes;
  - SSH remote strings return unchanged.
- Diff:
  - single-file lookup returns `diff: null` for missing file;
  - single-file lookup returns the latest diff for an existing file;
  - bulk lookup returns `{ path, diff }` records sorted as `MonitorDB.getFileDiffs` supplies them.

### Integration Tests
- Existing `startServer` tests remain unchanged in this module and continue to run against the current `server.ts` implementation.
- Existing parity tests (`stream-hello-parity.test.ts`, `daemon-sse-handshake.test.ts`, `session-sse-handshake.test.ts`, `stack-layers-route.test.ts`) remain unchanged during this module; downstream wiring modules will rely on them when replacing server-local helpers with projection imports.
- `test/run-summary-plans.test.ts` remains unchanged and continues importing `buildRunSummary` from `@eforge-build/monitor/server`.

## Verification

- [ ] `packages/monitor/src/projections/run-summary.ts` exports `buildRunSummary(db, sessionId): RunSummary`.
- [ ] `packages/monitor/src/projections/run-state.ts` exports `buildRunState(db, sessionId): RunState`.
- [ ] `packages/monitor/src/projections/plans.ts` exports `buildPlansResponse(...)` returning `Promise<PlansResponse>`.
- [ ] `packages/monitor/src/projections/queue-items.ts` exports both `loadQueueItemsSync` and `loadQueueItems`.
- [ ] `packages/monitor/src/projections/stack-layers.ts` exports `stackLayersToWire(cwd): StackLayerWire[]`.
- [ ] `packages/monitor/src/projections/auto-build-state.ts` exports `autoBuildStateToWire`, `autoBuildHeartbeatToWire`, and `buildDaemonHeartbeatObject`.
- [ ] `packages/monitor/src/projections/config-redaction.ts` exports `redactSensitive` and `redactGitRemote`.
- [ ] `packages/monitor/src/projections/diff.ts` exports `buildDiffResponse` returning `DiffResponse`.
- [ ] `git diff -- packages/monitor/src/server.ts` produces no diff after this module.
- [ ] `rg "safeParseEforgeEvent" packages/monitor/src/projections/event-hydration.ts` returns at least one line.
- [ ] `rg "EforgeEventSchema\.safeParse|EforgeEventSchema\.parse" packages/monitor/src/projections` returns no lines.
- [ ] `rg "interface .*Response|type .*Response" packages/monitor/src/projections` returns no duplicated client-owned route response shapes except narrow internal helper input types.
- [ ] `wc -l packages/monitor/src/projections/*.ts` shows every created implementation file at or below 600 lines.
- [ ] Every created implementation file over 300 lines contains balanced durable `// --- eforge:region <semantic-slug> ---` and `// --- eforge:endregion <semantic-slug> ---` markers.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
