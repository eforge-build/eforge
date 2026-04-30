---
title: Disable auto-build when a queued build fails
created: 2026-04-30
---

# Disable auto-build when a queued build fails

## Problem / Motivation

Per user feedback memory `feedback_dont_retry_builds.md`, when an auto-build run fails, the daemon should turn auto-build OFF so the queue does not keep cycling failed work. The user just observed a build fail and the queue continued running (a "retry"), which means this safety interlock is missing.

### Root cause

The daemon runs `engine.watchQueue()` in-process and drains the resulting event stream. The drain loop currently throws every event away:

`packages/monitor/src/server-main.ts:408-420`
```ts
watcherDone = (async () => {
  try {
    const events = wrapWatcherEvents(...);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of events) { /* persisted by withRecording, hooks fired by withHooks */ }
  } catch (err) { ... }
})();
```

The engine itself does emit a `queue:prd:complete` event with `status: 'failed'` (see `packages/engine/src/eforge.ts:1695-1708`), and after emitting it the engine calls `discoverNewPrds() + startReadyPrds()` to keep draining the queue (`packages/engine/src/eforge.ts:1860-1862`). That is the loop that re-launches subsequent PRDs. There is no consumer-side hook that flips `daemonState.autoBuild` to `false` on a failed completion, so the watcher keeps running and the engine keeps picking up the next PRDs.

Failure paths that *do* disable auto-build today (for reference): watcher init failure (`server-main.ts:392-394`) and watcher crash (`server-main.ts:425-427`). The "queued build failed" path is the gap.

## Goal

When an auto-build run fails, the daemon disables auto-build (mirroring the existing crash/init-failure pattern) so the queue stops cycling failed work, and the monitor UI surfaces a coherent paused reason.

## Approach

Inspect events in the drain loop. On the first `queue:prd:complete` with `status === 'failed'` for the active watcher session, disable auto-build using the same pattern as the existing API toggle (`packages/monitor/src/server.ts:1064-1075`):

1. Set `daemonState.autoBuild = false`.
2. Call `daemonState.onKillWatcher?.()` (it returns immediately; `stopWatcher` aborts the controller and the generator exits gracefully — in-flight PRD subprocesses are deliberately *not* killed, per the comment at `server-main.ts:354-356`).
3. Write a `daemon:auto-build:paused` event via the existing `writeAutoBuildPausedEvent(db, sessionId, reason)` helper (`server-main.ts:181`) so the monitor UI surfaces a coherent reason ("Build failed: <prdId>") matching the crash/init-failure pattern.

After step 2, `controller.abort()` causes `engine.watchQueue()` to stop yielding and the `for await` loop exits naturally — no deadlock from the loop awaiting itself.

### Files to modify

- `packages/monitor/src/server-main.ts` — replace the silent drain at lines 408-420 with one that inspects each event:
  ```ts
  for await (const event of events) {
    if (
      daemonState.autoBuild &&
      watcherAbort === controller &&
      event.type === 'queue:prd:complete' &&
      event.status === 'failed'
    ) {
      daemonState.autoBuild = false;
      writeAutoBuildPausedEvent(db, sessionId, `Build failed: ${event.prdId}`);
      daemonState.onKillWatcher?.();
    }
  }
  ```
  Drop the `eslint-disable` and `_event` rename. The guard `watcherAbort === controller` mirrors the crash branch at line 424 so a superseded watcher cannot pause a fresh one.

### Monitor UI sync

The UI's auto-build toggle is driven by `useAutoBuild()` (`packages/monitor-ui/src/hooks/use-auto-build.ts`), which polls `GET /api/auto-build` every 5 seconds. With only the server-side change above, the toggle flips OFF on the next poll cycle (≤5 s lag). No SSE/push exists for auto-build state today.

#### Optional UX nudge (recommended)

Make the toggle flip immediately by re-fetching when a `daemon:auto-build:paused` event arrives on the existing session event stream (`useEforgeEvents` at `packages/monitor-ui/src/hooks/use-eforge-events.ts`). One small change in `use-auto-build.ts`: subscribe to that hook (or accept a callback hook from the header) and call `fetchAutoBuild().then(setState)` whenever a `daemon:auto-build:paused` event is observed. This reuses the SSE channel the header already opens, so no new daemon-side plumbing is required — provided the watcher session's events are reaching the UI's session stream (the existing watcher-crash path already writes the same event, so this is a strictly additive UI behavior).

If the watcher session id is not the one the UI is currently subscribed to (e.g. monitor focused on a specific run), fall back path: poll-only is acceptable and matches current behavior on watcher-crash.

## Scope

### In scope

- Modify `packages/monitor/src/server-main.ts` to inspect drain-loop events and disable auto-build on first failed `queue:prd:complete` event for the active watcher session.
- Emit `daemon:auto-build:paused` event with reason `"Build failed: <prdId>"` via `writeAutoBuildPausedEvent`.
- Optional/recommended: update `packages/monitor-ui/src/hooks/use-auto-build.ts` to re-fetch on `daemon:auto-build:paused` SSE events for immediate toggle update (poll-only fallback acceptable).

### Out of scope (Files NOT to modify)

- `packages/engine/src/eforge.ts` — engine intentionally keeps draining its queue; the policy decision belongs to the daemon (consumer), not the engine. Matches the user-toggle path which also disables auto-build at the daemon layer, not in the engine.
- `eforge.yaml` / `config.yaml` — `prdQueue.autoBuild` config is the *default* on daemon start. Existing failure paths only flip in-memory state and emit the `paused` event; we follow the same shape rather than rewriting config on disk.

## Acceptance Criteria

1. **Unit test (preferred)** — add a test next to `test/watch-queue.test.ts` that exercises `wrapWatcherEvents` (already exported for testing per the doc comment at `server-main.ts:194-200`). Build a fake event stream that yields one `queue:prd:complete` with `status: 'failed'`, run it through the same drain loop logic, and assert:
   - (a) `daemonState.autoBuild === false`
   - (b) a `daemon:auto-build:paused` row exists in the test DB.
2. **Type check + suite**: `pnpm type-check && pnpm test` pass.
3. **Manual end-to-end** (after `pnpm build` and daemon restart via the `eforge-daemon-restart` skill):
   - Enable auto-build in the monitor UI.
   - Drop a PRD into `eforge/queue/` whose body is guaranteed to fail (e.g. references a non-existent file or otherwise causes the build agent to error out).
   - Confirm in the monitor UI that:
     - (a) the auto-build toggle flips OFF after the failure event,
     - (b) a "Build failed: ..." paused event is visible in the daemon event log,
     - (c) no further PRDs are picked up from the queue afterward.
