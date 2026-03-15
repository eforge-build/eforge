---
id: plan-01-peppy-painting-tulip
name: Add `sessionId` to all events and update hooks
depends_on: []
branch: peppy-painting-tulip/main
---

# Add `sessionId` to all events and update hooks

## Context

When `eforge run` executes, it calls `plan()` then `build()` sequentially. Each method generates its own `runId` and emits independent `eforge:start`/`eforge:end` pairs. Downstream consumers - the monitor DB, Langfuse traces, and the Schaake OS hooks in `~/.config/eforge/hooks/` - see two separate sessions for what is logically a single run. The hooks use `EFORGE_RUN_ID` as the session identifier, so the tracking API registers two sessions per `eforge run`.

**Fix**: Add `sessionId` to ALL events (not just lifecycle). When `run` composes plan+build, both phases share the same `sessionId`. For standalone `plan()`/`build()` calls, `sessionId` equals `runId`. Update the hooks to use `EFORGE_SESSION_ID`. Document hooks configuration in `docs/hooks.md`.

## Changes

### 1. `src/engine/events.ts` — Add `sessionId` to the event type

Use intersection to add `sessionId` as a common field across all events:

```typescript
type EforgeEventPayload =
  | { type: 'eforge:start'; runId: string; planSet: string; ... }
  | { type: 'plan:start'; source: string }
  | ...;

type EforgeEvent = { sessionId: string } & EforgeEventPayload;
```

This makes `sessionId` required on every event. Export `EforgeEventPayload` as well for engine-internal use (events before session stamping).

### 2. `src/engine/session.ts` — New middleware (small file)

Create a `withSessionId()` async generator middleware:

```typescript
async function* withSessionId(
  events: AsyncGenerator<EforgeEventPayload>,
  sessionId?: string,
): AsyncGenerator<EforgeEvent> {
  for await (const event of events) {
    // Auto-derive sessionId from first eforge:start if not pre-set
    if (!sessionId && event.type === 'eforge:start') {
      sessionId = event.runId;
    }
    yield { ...event, sessionId: sessionId ?? '' } as EforgeEvent;
  }
}
```

For `run`, caller passes a pre-generated `sessionId`. For standalone `plan`/`build`, it auto-derives from the first `eforge:start` event's `runId`.

### 3. `src/engine/eforge.ts` and all internal engine generators — Change to `EforgeEventPayload`

- Change `plan()`, `build()`, `adopt()`, `planExpeditionModules()` return types from `AsyncGenerator<EforgeEvent>` to `AsyncGenerator<EforgeEventPayload>`
- Change `runReviewCycle()`, `cleanupPlanFiles()`, `ReviewCycleConfig.run()` return types to `AsyncGenerator<EforgeEventPayload>`
- Change `createToolTracker.handleEvent()` parameter from `EforgeEvent` to `EforgeEventPayload`
- Update the `EforgeEngine` public API comment to note that consumers should wrap with `withSessionId()`

**Cascading type change**: Since `EforgeEvent` now requires `sessionId`, ALL internal engine code that yields or consumes events before the `withSessionId` middleware must use `EforgeEventPayload` instead. This includes:
- `src/engine/backend.ts` — `AgentBackend.run()` return type
- `src/engine/backends/claude-sdk.ts` — `run()` and `mapSdkEvents()` return types
- `src/engine/orchestrator.ts` — `PlanRunner`, `ValidationFixer`, `Orchestrator.execute()`, `AsyncEventQueue<EforgeEvent>` → `AsyncEventQueue<EforgeEventPayload>`
- `src/engine/agents/*.ts` — all agent runner return types (`runPlanner`, `builderImplement`, `builderEvaluate`, `runReview`, `runPlanReview`, `runPlanEvaluate`, `runCohesionReview`, `runCohesionEvaluate`, `runModulePlanner`, `runValidationFixer`)

These are mechanical find-and-replace changes: `AsyncGenerator<EforgeEvent>` → `AsyncGenerator<EforgeEventPayload>` and updating imports. The consumer-facing middleware (`withHooks`, `withRecording`) stays on `EforgeEvent` since they run after `withSessionId`.

### 4. `src/cli/index.ts` — Apply session middleware

- Import `withSessionId` from `../engine/session.js`
- Import `randomUUID` from `node:crypto`
- Update `wrapEvents()` to include session stamping as the first middleware in the chain (before hooks and recording):
  ```typescript
  function wrapEvents(events, monitor, hooks, sessionId?) {
    let wrapped = withSessionId(events, sessionId);
    if (hooks.length > 0) wrapped = withHooks(wrapped, hooks, cwd);
    return monitor ? monitor.wrapEvents(wrapped) : wrapped;
  }
  ```
- In `run` command (line 196): generate `const sessionId = randomUUID()` before phase 1, pass to both `wrapEvents()` calls
- Standalone `plan`/`build` commands: don't pass `sessionId` — middleware auto-derives from `runId`

### 5. `src/engine/hooks.ts` — Expose `EFORGE_SESSION_ID`

- Update the `withHooks` middleware (line 142): when handling `eforge:start`, set `hookEnv.EFORGE_SESSION_ID` from `event.sessionId`
- Since all events now have `sessionId` (from the upstream middleware), every hook invocation gets the correct session ID
- Keep `EFORGE_RUN_ID` as well for backward compat (still captures per-phase runId)

### 6. `src/engine/tracing.ts` — Use `sessionId` for Langfuse session grouping

- `createTracingContext()` already accepts a `sessionId` param (line 69)
- Currently `plan()` passes `planSetName` and `build()` passes `planSet` as sessionId
- No engine-level change needed — the Langfuse session grouping will use the event `sessionId` instead
- Add a `TracingContext.setSessionId(id: string)` method, called from the `withSessionId` middleware or from the CLI when the session is known, so the trace gets the correct session grouping

Actually, simpler: since `createTracingContext` is called inside `plan()`/`build()` before the middleware runs, we need to either:
- Accept `sessionId` as an engine option and pass it through, OR
- Accept that Langfuse traces continue grouping by `planSetName` (which already correlates plan+build traces since they share the same plan set name)

The current Langfuse grouping by `planSetName` already works for correlating plan and build traces. Leave this as-is. The `sessionId` field in events handles the monitor/hooks correlation; Langfuse uses `planSetName`.

### 7. `src/monitor/recorder.ts` — Record `sessionId`

- The recorder receives `EforgeEvent` (which now includes `sessionId`)
- When handling `eforge:start`, pass `event.sessionId` to `db.insertRun()`
- The event JSON in `data` column already contains `sessionId` since it's serialized from the stamped event

### 8. `src/monitor/db.ts` — Add `session_id` column

- Add `session_id TEXT` to the `runs` CREATE TABLE schema
- Add migration for existing DBs (same pattern as `pid` migration on line 89):
  ```typescript
  if (!columns.some((c) => c.name === 'session_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN session_id TEXT');
  }
  ```
- Add `sessionId` to `RunRecord` interface
- Update `insertRun()` to accept and store `sessionId`
- Add `getRunsBySession(sessionId: string): RunRecord[]` query
- Update all SELECT statements to include `session_id as sessionId`

### 9. `~/.config/eforge/hooks/` — Update shell scripts

All five hook scripts currently use `EFORGE_RUN_ID` as the session identifier. Update them to use `EFORGE_SESSION_ID`:

**`session-start.sh`** (line 14): `SESSION_ID="${EFORGE_SESSION_ID:-${EFORGE_RUN_ID:-}}"` — prefer session ID, fall back to run ID for backward compat

**`session-end.sh`** (line 17): same pattern

**`log-event.sh`** (line 14): same pattern

**`thread-start.sh`** (line 14): same pattern

**`thread-stop.sh`** (line 14): same pattern

### 10. `docs/hooks.md` — New hooks documentation

Create a hooks documentation file covering:
- What hooks are and when they fire
- **Important distinction from Claude Code hooks**: eforge hooks are informational and fire-and-forget. They run in the background and do not block or influence the eforge run in any way. A hook failure, timeout, or slow execution has no impact on the pipeline. This makes them suitable for logging, notifications, and external system integration but not for gating or modifying behavior.
- Hook configuration in `eforge.yaml` (event patterns with glob matching)
- Environment variables available to hooks (`EFORGE_SESSION_ID`, `EFORGE_RUN_ID`, `EFORGE_CWD`, `EFORGE_GIT_REMOTE`, `EFORGE_EVENT_TYPE`)
- Event JSON on stdin
- Example hook script
- Timeout behavior (default, configurable per hook)
- Reference to the full event type list
- Global vs project-level hook configuration and merge behavior (concatenation)

### 11. `README.md` — Link to hooks docs

Add a "Hooks" subsection under the existing Configuration section (after Plugins), with a brief description and link to `docs/hooks.md`.

### 12. `CLAUDE.md` — Update hook env var table

Update the hook env vars table to include `EFORGE_SESSION_ID` and note that it's the preferred session identifier (stable across plan+build in `run` mode).

### 13. Tests

- `test/hooks.test.ts` — Update `eforge:start` event fixtures to include `sessionId`. Add test that `EFORGE_SESSION_ID` env var is set from event `sessionId`.
- `test/monitor-reducer.test.ts` — Update event fixtures with `sessionId`
- `test/monitor-wave-utils.test.ts` — Update event fixtures with `sessionId`
- Consider a new test verifying `withSessionId()` middleware: auto-derives from first `eforge:start`, stamps all events, pre-set `sessionId` takes precedence

## Files to modify

**Engine:**
- `src/engine/events.ts` — type restructure
- `src/engine/session.ts` — new middleware file
- `src/engine/eforge.ts` — return type changes (all generators)
- `src/engine/backend.ts` — `AgentBackend.run()` return type → `EforgeEventPayload`
- `src/engine/backends/claude-sdk.ts` — return types → `EforgeEventPayload`
- `src/engine/orchestrator.ts` — `PlanRunner`, `ValidationFixer`, `execute()` → `EforgeEventPayload`
- `src/engine/agents/planner.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/builder.ts` — return types → `EforgeEventPayload`
- `src/engine/agents/reviewer.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/plan-reviewer.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/plan-evaluator.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/cohesion-reviewer.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/cohesion-evaluator.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/module-planner.ts` — return type → `EforgeEventPayload`
- `src/engine/agents/validation-fixer.ts` — return type → `EforgeEventPayload`
- `src/engine/hooks.ts` — `EFORGE_SESSION_ID` env var
- `src/engine/index.ts` — re-export `withSessionId` + `EforgeEventPayload`

**CLI:**
- `src/cli/index.ts` — session middleware wiring

**Monitor:**
- `src/monitor/recorder.ts` — pass `sessionId` to DB
- `src/monitor/db.ts` — `session_id` column + migration

**Hooks (user config):**
- `~/.config/eforge/hooks/session-start.sh`
- `~/.config/eforge/hooks/session-end.sh`
- `~/.config/eforge/hooks/log-event.sh`
- `~/.config/eforge/hooks/thread-start.sh`
- `~/.config/eforge/hooks/thread-stop.sh`

**Docs:**
- `docs/hooks.md` — new file
- `README.md` — link to hooks docs
- `CLAUDE.md` — update env var table

**Tests:**
- `test/hooks.test.ts` — add `sessionId` to fixtures, test `EFORGE_SESSION_ID`
- `test/monitor-reducer.test.ts` — add `sessionId` to event fixtures
- `test/monitor-wave-utils.test.ts` — add `sessionId` to event fixtures
- `test/agent-wiring.test.ts` — update `EforgeEvent` → `EforgeEventPayload` imports/types
- `test/cohesion-review.test.ts` — update event type references
- `test/files-changed-event.test.ts` — update event type references
- `test/validation-fixer.test.ts` — update event type references
- `test/orchestration-logic.test.ts` — update event type references
- `test/sdk-mapping.test.ts` — update event type references
- `test/sdk-event-mapping.test.ts` — update event type references
- `test/stub-backend.ts` — update `run()` return type → `EforgeEventPayload`
- New: `test/session.test.ts` — `withSessionId` middleware

## Verification

1. `pnpm type-check` — no type errors
2. `pnpm test` — all tests pass
3. Manual: `eforge run` with monitor — confirm both runs table rows share the same `session_id`:
   ```sql
   SELECT id, session_id, command FROM runs ORDER BY started_at;
   ```
4. Manual: verify hooks receive `EFORGE_SESSION_ID` — add a temporary `env >> /tmp/eforge-hook-env.txt` to a hook script and inspect
5. Standalone `eforge plan` / `eforge build` work unchanged (sessionId auto-derived from runId)
