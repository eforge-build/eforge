---
id: plan-01-agent-usage-event
name: Real-time Agent Usage Events and Monitor Integration
depends_on: []
branch: real-time-token-usage-updates-in-monitor-ui/agent-usage-event
---

# Real-time Agent Usage Events and Monitor Integration

## Architecture Context

Token metrics in the monitor dashboard only update on `agent:result`, which fires once at agent completion. For long-running agents (builder), this means minutes of stale counters. Both backends already track per-turn usage internally but don't surface it. This plan adds a new `agent:usage` event emitted per-turn, plus UI reducer logic to overlay live usage onto summary stats without double-counting.

## Implementation

### Overview

Add an `agent:usage` event type to the engine event system, emit it from both backends on each turn, and update the monitor UI reducer to track live agent usage as an overlay on finalized stats.

### Key Decisions

1. **Cumulative values, not deltas** - `agent:usage` carries cumulative token counts for the current agent run. This simplifies the reducer (just overwrite per agent) and avoids accumulation bugs from missed events during batch-load.
2. **Live overlay pattern** - `liveAgentUsage` map in `RunState` holds in-flight agent usage. `getSummaryStats()` sums finalized + live. On `agent:result`, the live entry is deleted and finalized totals absorb the final counts. No double-counting.
3. **Best-effort Claude SDK handling** - `SDKTaskProgressMessage` only provides `total_tokens` (no input/output split). We emit `agent:usage` with `total` set and `input`/`output` as 0. These messages may not fire during direct `query()` calls (they're for spawned subtasks), so this is defensive.
4. **`agent:usage` bypasses verbose gating** - Added to `isAlwaysYieldedAgentEvent()` so it always reaches the monitor regardless of verbose setting.

## Scope

### In Scope
- New `agent:usage` event type in `EforgeEvent` union
- Emitting `agent:usage` from Pi backend `turn_end` handler
- Handling `SDKTaskProgressMessage` in Claude SDK backend `mapSDKMessages()` default case
- UI type re-export of updated `EforgeEvent`
- Reducer: `liveAgentUsage` state, `agent:usage`/`agent:result`/`agent:stop` handling, `getSummaryStats()` overlay
- AgentThread live updates on `agent:usage`

### Out of Scope
- Changes to `summary-cards.tsx`, `thread-pipeline.tsx`, `server.ts`, or `recorder.ts` (they consume reducer state which already updates reactively)
- Per-plan cost breakdown in the UI
- Throttling/debouncing of `agent:usage` events

## Files

### Modify
- `src/engine/events.ts` - Add `agent:usage` to `EforgeEvent` union after `agent:stop` (line 224). Add `'agent:usage'` to `isAlwaysYieldedAgentEvent()` (line 281-287). The event carries: `type`, `planId?`, `agentId`, `agent`, `usage` (input/output/total/cacheRead/cacheCreation), `costUsd`, `numTurns`.

- `src/engine/backends/pi.ts` - In the `turn_end` handler (lines 384-399), after updating local accumulators from `session.getSessionStats()`, push an `agent:usage` event into `eventQueue`. All required data (`totalInputTokens`, `totalOutputTokens`, `totalCacheRead`, `totalCacheWrite`, `totalCost`, `numTurns`, `agent`, `agentId`, `planId`) is already in scope.

- `src/engine/backends/claude-sdk.ts` - Replace the `default` case in `mapSDKMessages()` (lines 223-225) with a handler that checks for `type === 'system'` and `subtype === 'task_progress'`. When matched, yield `agent:usage` with `total` from `usage.total_tokens`, `input`/`output` as 0, `cacheRead`/`cacheCreation` as 0, `costUsd` as 0, and `numTurns` from `usage.tool_uses`. Import `SDKTaskProgressMessage` type from the SDK. Fall through to break for other unhandled types.

- `src/monitor/ui/src/lib/types.ts` - No changes needed: it re-exports `EforgeEvent` directly from the engine. The new `agent:usage` variant is automatically included.

- `src/monitor/ui/src/lib/reducer.ts` - Four changes:
  1. Add `liveAgentUsage: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number; turns: number }>` to `RunState` interface (after `backend`). Initialize to `{}` in the `initialRunState` const.
  2. In `processEvent()`, add `agent:usage` handler: set `state.liveAgentUsage[event.agentId]` to the event's cumulative values. Also find the matching `AgentThread` by `agentId` and update its `inputTokens`, `outputTokens`, `totalTokens`, `cacheRead`, `costUsd`, `numTurns`.
  3. In `processEvent()`, on existing `agent:result` handler: add `delete state.liveAgentUsage[agentId]` where `agentId` is found from the matched thread (search threads in reverse for matching agent/planId). On existing `agent:stop` handler: add `delete state.liveAgentUsage[event.agentId]`.
  4. In `getSummaryStats()`: compute `liveExtra` by reducing `Object.values(state.liveAgentUsage)`, then add to returned `tokensIn`, `tokensOut`, `cacheRead`, `cacheCreation`, `totalCost`, `totalTurns`.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `agent:usage` event type exists in `EforgeEvent` union with fields: `type`, `planId?`, `agentId`, `agent`, `usage` (object with `input`, `output`, `total`, `cacheRead`, `cacheCreation`), `costUsd`, `numTurns`
- [ ] `isAlwaysYieldedAgentEvent()` returns `true` for events with `type === 'agent:usage'`
- [ ] Pi backend `turn_end` handler pushes an `agent:usage` event into `eventQueue` after updating accumulators
- [ ] Claude SDK backend `mapSDKMessages()` yields `agent:usage` for messages with `type === 'system'` and `subtype === 'task_progress'`
- [ ] `RunState` interface includes `liveAgentUsage` field initialized to `{}` in `createInitialState()`
- [ ] `processEvent()` sets `liveAgentUsage[agentId]` on `agent:usage` events
- [ ] `processEvent()` deletes `liveAgentUsage` entries on `agent:result` and `agent:stop` events
- [ ] `getSummaryStats()` returns finalized totals plus live overlay from `liveAgentUsage` values
- [ ] Replaying events in order (agent:start, agent:usage, agent:usage, agent:result) produces correct final totals with no double-counting: the last `agent:usage` overlay is cleared by `agent:result`, and only `agent:result` values persist in finalized counters
