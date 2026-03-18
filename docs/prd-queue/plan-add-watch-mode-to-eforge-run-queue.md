---
title: Plan: Add Watch Mode to `eforge run --queue`
created: 2026-03-18
status: running
---

# Add Watch Mode to `eforge run --queue`

## Problem / Motivation

Currently `eforge run --queue` is a single-pass batch processor: it loads pending PRDs once, processes them sequentially, and exits. If another process enqueues a new PRD while the queue is running, that PRD is invisible until the next manual invocation. There is no way to keep the queue processor running continuously to pick up newly enqueued work without manual re-invocation.

## Goal

Add a `--watch` flag that wraps the existing one-shot queue flow in a polling loop, automatically picking up newly enqueued PRDs without requiring manual re-invocation.

## Approach

Add a new `watchQueue()` async generator method on `EforgeEngine` that wraps `runQueue()` in an outer loop. This keeps `runQueue()` untouched as a clean one-shot primitive while layering the polling concern on top.

Key technical decisions:

- **Wrapper, not modification**: `watchQueue()` wraps `runQueue()` rather than adding loop logic inside it. `runQueue()` stays a clean one-shot primitive.
- **Poll, not filesystem watch**: `fs.watch`/inotify adds complexity and platform variance. Polling at 5s intervals is simple, reliable, and sufficient for a queue where each item takes minutes.
- **5s default poll interval**: Short poll keeps the queue responsive. Each PRD takes minutes to process so the overhead of frequent polls is negligible.
- **No retry of failed PRDs**: Only `pending` PRDs are picked up. Failed PRDs stay failed. Users reset status manually if they want a retry.

A separate PRD is in-flight adding queue UI to the web monitor. Display/monitor rendering changes here should be minimal to avoid conflicts - the monitor will naturally receive the new events and can render them in a follow-up.

### Files to Modify

#### 1. `src/engine/events.ts` — New event types

Add three watch-mode variants to the `QueueEvent` union (after line 232):

```typescript
| { type: 'queue:watch:waiting'; pollIntervalMs: number; nextPollAt: string }
| { type: 'queue:watch:poll'; newPrdCount: number }
| { type: 'queue:watch:cycle'; cycle: number; processed: number; skipped: number }
```

- `queue:watch:waiting` — emitted when entering idle poll sleep
- `queue:watch:poll` — emitted after each poll (heartbeat, even when 0 new PRDs)
- `queue:watch:cycle` — emitted instead of `queue:complete` at the end of each cycle

#### 2. `src/engine/eforge.ts` — Engine changes

**Extend `QueueOptions`** (line 65-78) with two new optional fields:
```typescript
/** Enable continuous watch mode */
watch?: boolean;
/** Poll interval in ms for watch mode (default from config) */
pollIntervalMs?: number;
```

**Add `abortableSleep` helper** (module-level private function):
```typescript
function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  // Returns true if aborted, false if timer completed
  // Sets up timer + signal listener, cleans up both paths
}
```

**Add `watchQueue()` method** on `EforgeEngine` (after `runQueue()`, ~line 636):

```
watchQueue(options) → AsyncGenerator<EforgeEvent>

loop:
  1. Check abort signal → break if aborted
  2. Delegate to runQueue(options), yield all events
     - Intercept queue:complete → yield queue:watch:cycle instead
  3. Check abort signal again → break if aborted
  4. Yield queue:watch:waiting
  5. abortableSleep(pollIntervalMs) → break if aborted
  6. Poll: loadQueue() + resolveQueueOrder()
  7. Yield queue:watch:poll { newPrdCount }
  8. Loop back to step 1 (runQueue will re-scan and find the new pending PRDs)

After loop: yield queue:complete (final)
```

#### 3. `src/engine/config.ts` — Config schema

Add `watchPollIntervalMs` to prdQueue:
- **Zod schema** (line 102-105): add `watchPollIntervalMs: z.number().int().positive().optional()`
- **EforgeConfig interface** (line 132): add `watchPollIntervalMs: number`
- **DEFAULT_CONFIG** (line 181): default `5_000` (5 seconds)
- **resolveConfig** (line 251-253): merge with fallback to default

#### 4. `src/cli/index.ts` — CLI flags

**Add flags to both queue entry points:**

`eforge run` command (line 182-189):
- `--watch` — Enable continuous watch mode
- `--poll-interval <ms>` — Poll interval override (parsed as int)

`eforge queue run` command (line 448-456):
- Same two flags

**Update action handlers** to route to `watchQueue()` when `--watch`:
```typescript
const queueEvents = options.watch
  ? engine.watchQueue({ ...queueOpts, pollIntervalMs: options.pollInterval })
  : engine.runQueue(queueOpts);
```

**Exit code:** In watch mode, abort (Ctrl+C) is a clean exit → code 0.

#### 5. `src/cli/display.ts` — Render new events (minimal)

Add cases to `renderEvent()` for the three new event types:
- `queue:watch:waiting` — log "Watching for new PRDs... (polling every Xs)"
- `queue:watch:poll` — log count if > 0, otherwise quiet
- `queue:watch:cycle` — log cycle number + processed/skipped counts

Keep this minimal since the monitor UI PRD is handling richer queue display. The CLI just needs basic text output to satisfy the exhaustive switch.

#### 6. `src/engine/index.ts` — Barrel export

No changes needed — `watchQueue()` is a method on `EforgeEngine` which is already exported. `QueueOptions` is already re-exported and the new fields are optional.

#### 7. `eforge-plugin/skills/run/run.md` — Skill definition

**Update argument-hint** (line 3):
```yaml
argument-hint: "<source> [--queue] [--watch]"
```

**Add `--watch` to Arguments section** (after line 16):
```markdown
- `--watch` - (optional, queue mode only) Continuously watch for new PRDs instead of exiting after processing the current batch
```

**Update Workflow Step 2** — add watch mode launch variant:
```bash
# Queue + watch mode (continuous processing)
eforge run --queue --watch --auto --verbose
```

**Update Step 3 monitor message** — add watch-mode variant:
> Queue watch mode launched. Processing will continue indefinitely, picking up new PRDs as they are enqueued.
>
> **Monitor**: http://localhost:4567
>
> Press Ctrl+C to stop watching. Use `/eforge:status` for a quick inline status check.

## Scope

**In scope:**
- `--watch` flag on `eforge run --queue` and `eforge queue run`
- `--poll-interval <ms>` override flag
- `watchPollIntervalMs` config option in `eforge.yaml` `prdQueue` section
- Three new `queue:watch:*` event types
- `watchQueue()` engine method wrapping `runQueue()`
- `abortableSleep` helper with abort signal support
- Minimal CLI rendering for the new events
- Plugin skill definition updates for `--watch`

**Out of scope:**
- Monitor UI changes for watch mode (handled by separate queue UI PRD)
- Retry logic for failed PRDs (failed PRDs stay failed, manual reset required)
- Filesystem watching via `fs.watch`/inotify (polling chosen deliberately)
- Changes to `runQueue()` itself (stays untouched as a one-shot primitive)

## Acceptance Criteria

1. `eforge run --queue --watch` enters a continuous polling loop that picks up newly enqueued PRDs without manual re-invocation
2. `eforge queue run --watch` behaves identically to `eforge run --queue --watch`
3. `--poll-interval <ms>` overrides the default poll interval; `eforge.yaml` `prdQueue.watchPollIntervalMs` provides a config-level default; CLI flag takes priority
4. Default poll interval is 5000ms (5 seconds)
5. `queue:watch:waiting` event is emitted when entering idle poll sleep, including `pollIntervalMs` and `nextPollAt`
6. `queue:watch:poll` event is emitted after each poll with `newPrdCount` (including 0)
7. `queue:watch:cycle` event is emitted at the end of each processing cycle (replacing `queue:complete` mid-watch) with `cycle`, `processed`, and `skipped` counts
8. `queue:complete` is emitted only once - after the watch loop exits
9. Ctrl+C (abort signal) during idle sleep exits promptly and cleanly with exit code 0
10. Ctrl+C during active processing completes the current PRD's abort flow, then exits cleanly
11. Only `pending` PRDs are picked up on each cycle; failed PRDs are not retried
12. `abortableSleep` unit tests pass: timer completion returns false, abort returns true promptly
13. `watchQueue` unit tests pass: cycle behavior, mid-idle enqueue pickup, and abort-during-idle
14. TypeScript compilation succeeds with exhaustive switch coverage for the three new event types in `display.ts`
15. Plugin skill definition (`eforge-plugin/skills/run/run.md`) documents `--watch` flag and watch-mode workflow
