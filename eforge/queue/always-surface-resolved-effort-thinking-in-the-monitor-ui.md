---
title: Always surface resolved effort/thinking in the monitor UI
created: 2026-04-18
---

# Always surface resolved effort/thinking in the monitor UI

## Problem / Motivation

The planner can override per-agent `effort` and `thinking`, and events already carry those values (`agent:start` emits `effort`, `thinking`, `effortSource`, `effortClamped`, `effortOriginal` - shipped in `f618a48` and surfaced in UI via `ad78ea7`). But in practice users see effort on at most one agent per run, with no label, and no way to tell an override from a default.

Three specific gaps explain the behavior:

1. **Effort/thinking are omitted when no layer sets them.** `resolveAgentConfig` in `packages/engine/src/pipeline.ts:642` only stamps `effortSource` inside an `if (result.effort !== undefined)` guard. Most roles in `AGENT_ROLE_DEFAULTS` don't set effort, so there's nothing to emit, so the UI row never renders. Same issue for thinking.
2. **No label in the tooltip.** `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx:852-870` renders the bare value ("low") with no "effort:" prefix, so users don't know what they're looking at.
3. **No `thinkingSource`.** Effort has provenance tracking (`planner`/`role-config`/`global-config`/`default`); thinking does not, so overrides to thinking are invisible even when they happen.

## Goal

Every agent row in the monitor UI shows `effort: <value> (<source>)` and `thinking: <value> (<source>)`, always, with a clear visual signal when the source is `planner` (overridden) vs `default`.

## Approach

### 1. Engine: always resolve a value and a source for both effort and thinking

**File: `packages/engine/src/pipeline.ts`** (`resolveAgentConfig`, ~lines 495-656)

- Track `thinkingSource` alongside `effortSource` using the same precedence chain already implemented at lines 527-550.
- Move the source stamping out of the `if (result.effort !== undefined)` guard. Always record the source, even when the resolved value is undefined; in that case `effortSource: 'default'` means "no layer set it; backend picks its own default."
- When `result.effort` / `result.thinking` is undefined after the precedence walk, leave the value undefined but still emit the source so the UI can render "unset (default)."

**File: `packages/engine/src/config.ts`** (`ResolvedAgentConfig`, lines 234-254)

- Add `thinkingSource?: 'planner' | 'role-config' | 'global-config' | 'default'`.
- No other field changes.

### 2. Event + backend: pass `thinkingSource` through to `agent:start`

**File: `packages/engine/src/events.ts`** (line 231)

- Add `thinkingSource?: string` to the `agent:start` event type, mirroring `effortSource`.

**File: `packages/engine/src/backends/claude-sdk.ts:48`**
**File: `packages/engine/src/backends/pi.ts:252, 258, 265`**

- Pass `thinkingSource` through in each `agent:start` yield, matching the `effortSource` spread pattern already present.

**File: wherever `AgentRunOptions` is defined** (likely `packages/engine/src/backends/types.ts` - needs a quick grep)

- Add `thinkingSource?: string` so the resolver-to-backend plumbing can carry it.

### 3. Reducer: capture `thinkingSource`

**File: `packages/monitor-ui/src/lib/reducer.ts:12-31`** (`AgentThread`), `:268-293` (agent:start handler)

- Add `thinkingSource?: string` to `AgentThread`.
- Read it from the event payload in the same pattern as `effortSource` (line 292).

### 4. Tooltip: always render both rows, with labels and override styling

**File: `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx:849-886`**

Current rendering shows bare `{thread.effort}` with source in parens; the row is hidden when the field is undefined.

Change to:

- **Always render** an `effort:` row and a `thinking:` row for every agent thread. If the value is undefined, show `unset` (source will be `default`). If source is undefined too (older events, pre-migration), fall back to just `unset`.
- **Prefix with a label**: `effort: low (planner)` instead of bare `low (planner)`. Same for thinking.
- **Visual override indicator**: when `source === 'planner'`, style the row with an accent color or bold weight (not just parenthetical text) so it's scannable across many agents. Keep the dim `opacity-50 text-[10px]` treatment for non-override rows to preserve the existing visual density.
- Preserve the existing clamp display: `low (clamped from high) (planner)`.

Source label mapping (already present for effort, extend to thinking):
- `planner` → "planner"
- `role-config` / `global-config` → "config"
- `default` → "default"

### Files to modify

- `packages/engine/src/pipeline.ts` - resolver: always stamp sources, track thinkingSource
- `packages/engine/src/config.ts` - `ResolvedAgentConfig.thinkingSource`
- `packages/engine/src/events.ts` - `agent:start.thinkingSource`
- `packages/engine/src/backends/claude-sdk.ts` - emit thinkingSource
- `packages/engine/src/backends/pi.ts` - emit thinkingSource (3 yield sites)
- `packages/engine/src/backends/types.ts` (or wherever `AgentRunOptions` lives) - accept thinkingSource
- `packages/monitor-ui/src/lib/reducer.ts` - `AgentThread.thinkingSource` + capture from event
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` - always render, labels, override styling
- Tests: update any pipeline/resolver tests that assert the shape of resolved config; update any event-shape tests for `agent:start`.

## Scope

**In scope:**

- Adding `thinkingSource` provenance tracking to match existing `effortSource` tracking
- Always stamping source fields in `resolveAgentConfig`, even when no layer sets effort/thinking
- Passing `thinkingSource` through events and backend plumbing
- Updating the monitor UI tooltip to always render effort and thinking rows with labels and override styling
- Updating reducer to capture `thinkingSource` from events
- Updating relevant tests

**Out of scope:**

- No change to how the planner decides to override (the recent planner addition is fine; it already emits `planEntry.agents[role]`).
- No new surfaces beyond the existing thread-bar tooltip.
- No data migration for old `agent:start` events - the reducer already uses `'X' in event` guards, so older events degrade gracefully (rows will show "unset").

## Acceptance Criteria

1. **Engine unit test**: `resolveAgentConfig` returns `effortSource: 'default'` and `thinkingSource: 'default'` when no layer configures them, and returns the correct provenance when a layer does.
2. **Always-visible rows**: every agent bar tooltip in the monitor UI shows both an `effort:` and a `thinking:` row, regardless of whether any config layer set them.
3. **Labeled values**: rows display as `effort: <value> (<source>)` and `thinking: <value> (<source>)` (e.g., `effort: low (planner)`, `thinking: unset (default)`).
4. **Override visual signal**: planner-overridden rows are visually distinct (accent color or bold weight) from default rows across the same pipeline.
5. **Clamp display preserved**: clamped effort still renders as `effort: low (clamped from high) (planner)`.
6. **Graceful degradation**: older `agent:start` events (pre-migration) render rows as "unset" without errors.
7. **Type-check**: `pnpm type-check` passes clean across the workspace.
8. **Local verification**: enqueue a simple PRD that exercises planner overrides on at least one role, open the monitor UI, hover each agent bar, and confirm every bar shows effort and thinking rows with correct values and sources.
