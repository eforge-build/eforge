---
title: Add backend and model info to monitor UI
created: 2026-03-29
status: pending
---

# Add backend and model info to monitor UI

## Problem / Motivation

eforge now supports two backends (`claude-sdk` and `pi`), but the monitor UI has no visibility into which backend or model is being used. `agent:start` events carry no model or backend info, and `agent:result.modelUsage` only has model names after completion. Users need this information earlier and more prominently - both at the session level (which backend) and per-agent (which model).

## Goal

Surface backend and model information in the monitor UI so users can see which backend a session is using and which model each agent is running, without waiting for agent completion.

## Approach

Add required `model` and `backend` fields to the `agent:start` event. Both backends know this info before yielding the event. The monitor reducer captures it into `AgentThread.model` and `RunState.backend`, and the UI displays it in tooltips and the summary bar. No backward compatibility handling in the engine - this is greenfield and the monitor DB is ephemeral. The monitor reducer uses `?? 'unknown'` fallbacks when parsing old DB events that lack these fields; these fallbacks should be removed after 2026-04-29 (1 month).

### Detailed changes

1. **Engine: Add fields to `agent:start` event type** (`src/engine/events.ts`) - Add `model: string` and `backend: string` (required) to the `agent:start` event variant.

2. **Engine: Emit model/backend from claude-sdk backend** (`src/engine/backends/claude-sdk.ts`) - Add `model: options.model ?? 'auto', backend: 'claude-sdk'` to the `agent:start` yield at line 46. The `?? 'auto'` covers the theoretical case where model class is `auto` (no role currently uses it). All current roles use `max`/`balanced`/`fast` which resolve to concrete model strings.

3. **Engine: Emit model/backend from pi backend** (`src/engine/backends/pi.ts`) - Move `resolveModel()` call (currently line 328) to BEFORE the `agent:start` yield (line 319). Add `model: model.id, backend: 'pi'` to the `agent:start` yield. If model resolution fails, `agent:start` won't be emitted (fine - the error propagates as `agent:stop` with error).

4. **Monitor reducer: Track model per agent and backend per session** (`src/monitor/ui/src/lib/reducer.ts`) - Add `model: string` to `AgentThread` interface. Add `backend: string | null` to `RunState` and `initialRunState`. In `processEvent` for `agent:start`: capture `model` (with `?? 'unknown'` fallback for old DB data) and `backend` (same fallback, first one wins for session-level).

5. **Monitor UI: Show model in pipeline thread tooltips** (`src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`) - In the thread bar `TooltipContent` (around line 636-653), add model name below the agent name when available.

6. **Monitor UI: Show backend in summary bar** (`src/monitor/ui/src/components/common/summary-cards.tsx`) - Accept `backend?: string | null` prop. Display as a small dimmed label next to the status, e.g. "Running - claude-sdk" or a subtle badge. Update `src/monitor/ui/src/app.tsx` to pass `backend={runState.backend}` to `SummaryCards`.

7. **Monitor DB: Add backend to session metadata for sidebar** (`src/monitor/db.ts`) - Add `backend: string | null` to `SessionMetadata` interface. Add `'agent:start'` to the `getSessionMetadataEvents` SQL `IN` clause. Extract backend from `agent:start` data in `getSessionMetadataBatch()` (first match per session). Update `src/monitor/ui/src/lib/types.ts` with `backend: string | null` on `SessionMetadata`. Update `src/monitor/ui/src/components/layout/sidebar.tsx` to show backend as a small dimmed label in session items when available (not a badge - keep it subtle since most users will use one backend).

8. **Mock server: Update synthetic events** (`src/monitor/mock-server.ts`) - Add `model` and `backend` fields to all synthetic `agent:start` events.

## Scope

### In scope
- Adding `model` and `backend` fields to `agent:start` events in the engine
- Emitting these fields from both `claude-sdk` and `pi` backends
- Tracking model per agent thread and backend per session in the monitor reducer
- Displaying model in pipeline thread tooltips
- Displaying backend in the summary bar
- Displaying backend in the sidebar session metadata
- Updating the mock server synthetic events
- Temporary `?? 'unknown'` fallbacks in the reducer for old DB data (remove after 2026-04-29)

### Out of scope
- Backward compatibility handling in the engine (event fields are required)
- Long-term support for old DB data (DB is ephemeral/gitignored)

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm test` passes (existing tests)
- `pnpm build` produces a clean bundle
- Starting the monitor with mock server shows:
  - Backend label visible in the summary bar (e.g. "Running - claude-sdk")
  - Agent tooltips in the pipeline view display model names
  - Sidebar session items show backend as a small dimmed label
- `agent:start` events from both `claude-sdk` and `pi` backends include `model` and `backend` fields
- Pi backend resolves the model before emitting `agent:start` (moved `resolveModel()` call)
- Monitor reducer captures `model` on `AgentThread` and `backend` on `RunState` (first `agent:start` wins for session-level backend)
- Reducer fallbacks (`?? 'unknown'`) handle old DB events gracefully; these fallbacks are marked for removal after 2026-04-29
