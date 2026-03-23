---
title: Plan: Add Formatter/Enqueue Visibility to Monitor
created: 2026-03-23
status: pending
---

# Add Formatter/Enqueue Visibility to Monitor

## Problem / Motivation

When a PRD is enqueued (via `eforge build` or `eforge enqueue`), a formatter agent runs to normalize the input into a structured PRD. This formatting process is **completely invisible** in the monitor because:

1. **Events are silently dropped**: `withRecording()` in `src/monitor/recorder.ts` only sets `runId` on `phase:start` events, and only records events when `runId` is set. Enqueue emits `enqueue:start` → agent events → `enqueue:complete`, but never emits `phase:start`. So **zero enqueue events are written to SQLite**.

2. **No UI representation**: The monitor dashboard has no concept of enqueue sessions — the sidebar and reducer only handle compile/build runs.

Users cannot see when formatting is happening, its progress, or its result.

## Goal

Make the formatting/enqueue phase visible in the monitor so users can see when formatting is happening, its progress, and its result — appearing as a phase within the session group alongside compile and build.

## Approach

Treat `enqueue:start`/`enqueue:complete` as lifecycle events analogous to `phase:start`/`phase:end` in the recorder. This creates a run record with `command: 'enqueue'` that the UI can display. No engine changes needed — all fixes are in the recorder (consumer) and UI layers.

For `eforge build`, the session contains enqueue + compile + build as three runs grouped under one session in the sidebar. For standalone `eforge enqueue`, the session contains just the enqueue run.

### Changes

#### 1. DB: Add `updateRunPlanSet()` method
**File**: `src/monitor/db.ts`

- Add `updateRunPlanSet(runId: string, planSet: string): void` to the `MonitorDB` interface
- Add prepared statement: `UPDATE runs SET plan_set = ? WHERE id = ?`
- Implement in the returned object

Needed because at `enqueue:start` time, we only know the source (not the PRD title). The title arrives at `enqueue:complete`.

#### 2. Recorder: Handle enqueue lifecycle events
**File**: `src/monitor/recorder.ts`

Core fix. Add handling for `enqueue:start` and `enqueue:complete`:

- Import `randomUUID` from `node:crypto`
- Track `enqueueRunId` separately from `runId`
- Buffer `session:start` event when no `runId` is set yet (it arrives before `enqueue:start`)
- On `enqueue:start`:
  - Generate a synthetic `runId` via `randomUUID()`
  - Create a run record with `command: 'enqueue'`, using `event.source` as initial `planSet`
  - Flush the buffered `session:start` event
- On `enqueue:complete`:
  - Update the run's `planSet` to `event.title` via `updateRunPlanSet()`
  - Mark run as `completed`
- On `session:end` when `runId === enqueueRunId` (enqueue-only session ending or enqueue failed):
  - If result is `failed`, mark the enqueue run as `failed`
- When `phase:start` arrives later (in `eforge build` flow), the existing logic takes over and creates a new `runId` for compile/build

#### 3. Session utils: Add enqueue to sort order
**File**: `src/monitor/ui/src/lib/session-utils.ts`

Add `enqueue: -1` to `commandOrder` so enqueue runs sort before compile/build in the session group.

#### 4. Reducer: Track enqueue state
**File**: `src/monitor/ui/src/lib/reducer.ts`

- Add to `RunState`: `enqueueStatus: 'running' | 'complete' | null`, `enqueueTitle: string | null`, `enqueueSource: string | null`
- Add to `initialRunState`: `enqueueStatus: null, enqueueTitle: null, enqueueSource: null`
- In `processEvent()`:
  - Handle `session:start`: set `startTime` if null (currently only `phase:start` sets it, breaking standalone enqueue sessions)
  - Handle `enqueue:start`: set `enqueueStatus = 'running'`, `enqueueSource = event.source`
  - Handle `enqueue:complete`: set `enqueueStatus = 'complete'`, `enqueueTitle = event.title`
- Update `BATCH_LOAD` and `RESET` cases to include new fields

#### 5. Event card: Add enqueue summaries
**File**: `src/monitor/ui/src/components/timeline/event-card.tsx`

Add cases to `eventSummary()`:
- `enqueue:start`: `Enqueuing from: ${event.source}`
- `enqueue:complete`: `Enqueued: ${event.title} -> ${event.filePath}`

Note: `classifyEvent()` already handles these via suffix matching (`:start` → blue, `:complete` → green).

#### 6. Thread pipeline: Add formatter color
**File**: `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`

Add `formatter` to `AGENT_COLORS`:
```
formatter: { bg: 'bg-cyan/30', border: 'border-cyan/50' }
```

(Already falls back to cyan via `FALLBACK_COLOR`, but explicit is better for clarity.)

#### 7. Tests

**File**: `test/monitor-recording.test.ts`

Add test: enqueue events are recorded to SQLite
- Create event stream: `session:start` → `enqueue:start` → `agent:start` (formatter) → `agent:result` → `agent:stop` → `enqueue:complete` → `session:end`
- Verify: run record created with `command: 'enqueue'`, status `completed`, `planSet` updated to title
- Verify: all events stored

**File**: `test/monitor-reducer.test.ts`

Add tests:
- `enqueue:start` sets `enqueueStatus` to `'running'`
- `enqueue:complete` sets `enqueueStatus` to `'complete'` and `enqueueTitle`
- `session:start` sets `startTime` when no `phase:start` follows

### UI Presentation

Enqueue appears as a **phase within the session group** in the sidebar (alongside compile and build). The formatter agent shows in the thread pipeline. The queue section remains unchanged (only shows fully-enqueued PRDs).

```
SIDEBAR
▼ my-cool-feature        [running]
  ● enqueue    [complete]  0.8s
  ● compile    [running]   12s
  ○ build      [pending]

THREAD PIPELINE
[formatter] ██████░░░░  0.8s
[planner]   ░░░░░░████  running...
```

### Key Files
- `src/monitor/recorder.ts` — core fix
- `src/monitor/db.ts` — new method
- `src/monitor/ui/src/lib/reducer.ts` — state tracking
- `src/monitor/ui/src/lib/session-utils.ts` — sort order
- `src/monitor/ui/src/components/timeline/event-card.tsx` — display
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — color
- `test/monitor-recording.test.ts` — recording tests
- `test/monitor-reducer.test.ts` — reducer tests

## Scope

**In scope:**
- Recorder changes to capture enqueue lifecycle events into SQLite
- DB method to update run plan set after enqueue completes
- UI reducer state tracking for enqueue status
- Sidebar sort ordering for enqueue runs
- Event card summaries for enqueue events
- Formatter agent color in thread pipeline
- Unit tests for recording and reducer changes

**Out of scope:**
- Engine changes (no modifications to event emission)
- Queue section UI changes (continues to show only fully-enqueued PRDs)

## Acceptance Criteria

- `pnpm test` passes — existing tests plus new tests for enqueue recording and reducer state
- `pnpm type-check` passes with no type errors
- `pnpm build` completes cleanly
- Running `pnpm dev -- enqueue "test feature"` results in enqueue events stored in `.eforge/monitor.db` with a run record having `command: 'enqueue'` and status `completed`
- Running `pnpm dev -- build "test feature" --foreground` shows enqueue → compile → build as three runs grouped under one session in the monitor sidebar
- Enqueue run sorts before compile and build in the sidebar session group
- `enqueue:start` and `enqueue:complete` events display descriptive summaries in the event card timeline
- Formatter agent appears with cyan coloring in the thread pipeline
- For standalone `eforge enqueue`, the session contains only the enqueue run
- For `eforge build`, the session contains enqueue + compile + build runs
- If enqueue fails, the enqueue run is marked as `failed`
