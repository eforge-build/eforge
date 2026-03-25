---
title: Fix activity indicators not showing in pipeline bars
created: 2026-03-25
status: pending
---

# Fix activity indicators not showing in pipeline bars

## Problem / Motivation

The activity heatmap overlay was recently moved from a standalone row into the pipeline agent bars (commit `7fb7976`). The `ActivityOverlay` component renders but shows nothing — the bars appear flat with no activity indicators.

The root cause is that `ActivityOverlay` (at `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx:200`) filters events with `'timestamp' in event`. Streaming events (`agent:message`, `agent:tool_use`, `agent:tool_result`) emitted by `mapSDKMessages` in `src/engine/backends/claude-sdk.ts` do **not** carry timestamps — only `agent:start` and `agent:stop` do. Since none of the activity events have timestamps, every event is skipped and the overlay renders nothing.

## Goal

Make `timestamp` a required field on the base `EforgeEvent` type so every event is self-timestamped, ensuring the activity overlay renders correctly for all event types. The TypeScript compiler should enforce that no emission site is missed, and any future event types must include a timestamp.

## Approach

### 1. Add `timestamp: string` to the base `EforgeEvent` type

**File**: `src/engine/events.ts` (line 123)

Change:
```typescript
export type EforgeEvent = { sessionId?: string; runId?: string } & (
```
To:
```typescript
export type EforgeEvent = { sessionId?: string; runId?: string; timestamp: string } & (
```

Then remove the per-variant `timestamp` declarations from the 6 event types that already have them:
- `session:start` (line 125) — remove `timestamp: string`
- `session:end` (line 126) — remove `timestamp: string`
- `phase:start` (line 129) — remove `timestamp: string`
- `phase:end` (line 130) — remove `timestamp: string`
- `agent:start` (line 204) — remove `timestamp?: string`
- `agent:stop` (line 205) — remove `timestamp?: string`

### 2. Add `timestamp: new Date().toISOString()` to every event yield site

After step 1, `pnpm type-check` will report every yield site missing a timestamp. Add `timestamp: new Date().toISOString()` to each one. The sites span these files:

- **`src/engine/eforge.ts`** (~20 yields): enqueue, queue, cleanup, build:failed events
- **`src/engine/orchestrator.ts`** (~17 yields): schedule, merge, validation, finalize events
- **`src/engine/pipeline.ts`** (~30 yields): all compile and build stage events
- **`src/engine/agents/planner.ts`** (~13 yields): plan:start/progress/skip/profile/clarification/complete
- **`src/engine/agents/builder.ts`** (~7 yields): build:implement/evaluate events
- **`src/engine/agents/reviewer.ts`** (~2 yields): build:review:start/complete
- **`src/engine/agents/parallel-reviewer.ts`** (~6 yields): parallel review events
- **`src/engine/agents/review-fixer.ts`** (~2 yields): build:review:fix events
- **`src/engine/agents/plan-reviewer.ts`** (~2 yields): plan:review events
- **`src/engine/agents/plan-evaluator.ts`** (~3 yields): plan/architecture/cohesion evaluate events
- **`src/engine/agents/doc-updater.ts`** (~2 yields): build:doc-update events
- **`src/engine/agents/module-planner.ts`** (~2 yields): expedition:module events
- **`src/engine/agents/cohesion-reviewer.ts`** (~2 yields): plan:cohesion events
- **`src/engine/agents/architecture-reviewer.ts`** (~2 yields): plan:architecture:review events
- **`src/engine/agents/merge-conflict-resolver.ts`** (~3 yields): merge:resolve events
- **`src/engine/agents/validation-fixer.ts`** (~2 yields): validation:fix events
- **`src/engine/agents/staleness-assessor.ts`** (~1 yield): queue:prd:stale
- **`src/engine/agents/tester.ts`** (~4 yields): build:test events
- **`src/engine/backends/claude-sdk.ts`** (~5 yields): agent:message, agent:tool_use, agent:tool_result (the streaming events that caused the original bug)

Event re-yield sites in `src/engine/session.ts` and `src/engine/eforge.ts` that spread existing events with added `sessionId`/`runId` will automatically carry through the timestamp from the original event — no changes needed there.

### 3. Hydrate legacy events from the DB timestamp column

**File**: `src/monitor/server.ts`

Add a helper that injects the DB `timestamp` into the event JSON if missing:

```typescript
function hydrateTimestamp(record: EventRecord): string {
  const parsed = JSON.parse(record.data);
  if (!parsed.timestamp) {
    parsed.timestamp = record.timestamp;
    return JSON.stringify(parsed);
  }
  return record.data;
}
```

Apply at all three serving paths:
- **SSE historical replay** (line ~185): use `hydrateTimestamp(event)` instead of `event.data`
- **SSE poll loop** (line ~216): same
- **Batch API** (line ~1153): hydrate each event's `data` field before serializing the response

This ensures legacy events stored without timestamps in their JSON get the DB-level timestamp injected at read time, maintaining backward compatibility with events already in SQLite.

### 4. Simplify the recorder's timestamp handling

**File**: `src/monitor/recorder.ts` (line 88)

The fallback `'timestamp' in event ? (event as ...).timestamp : new Date().toISOString()` can be simplified to just `event.timestamp` since it is now always present.

## Scope

**In scope:**
- Making `timestamp` required on the base `EforgeEvent` type
- Adding timestamps to all existing event yield sites across the engine
- Hydrating legacy DB events with timestamps at the server layer
- Simplifying recorder timestamp handling

**Out of scope:**
- Changes to the `ActivityOverlay` component rendering logic itself (the fix is entirely on the data/event side)
- Schema migrations for the SQLite database (legacy events are hydrated at read time)

## Acceptance Criteria

1. `pnpm type-check` passes — the compiler enforces all yield sites include a `timestamp` field.
2. `pnpm build` completes with a clean build.
3. `pnpm test` passes — all existing tests continue to work.
4. Running a build with the monitor open shows activity indicators as colored overlays within the agent bars.
5. Legacy events (stored before this change) display correctly in the monitor, with timestamps hydrated from the DB column.
