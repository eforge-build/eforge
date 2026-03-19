---
id: plan-01-per-agent-tokens
name: Per-Agent Token Usage Display
dependsOn: []
branch: per-agent-token-usage-display/per-agent-tokens
---

# Per-Agent Token Usage Display

## Architecture Context

The monitor dashboard already tracks per-agent threads via `AgentThread` in `reducer.ts` and renders Gantt bars in `thread-pipeline.tsx`. Token data flows through `agent:result` events with full `AgentResultData` (usage, cost, turns) - the reducer accumulates aggregate totals but discards per-agent breakdowns. Similarly, the eval harness in `build-result.ts` already computes `metrics.agents` and `metrics.tokens.cacheRead` per-scenario, but `eval/run.sh` omits `cacheRead` from summary totals and never prints the per-agent breakdown.

## Implementation

### Overview

Wire existing per-agent token data into two display surfaces: (1) monitor dashboard Gantt bar labels and tooltips, (2) eval summary output with `cacheRead` in totals and a per-agent breakdown table.

### Key Decisions

1. Store token fields directly on `AgentThread` rather than in a side map - keeps the data colocated with the thread for straightforward rendering. Fields are `null` until `agent:result` fires, so running agents naturally show no token info.
2. Use `formatNumber` from `@/lib/format` (already exists, formats 1234 → "1.2k") for compact bar labels.
3. For eval, aggregate `metrics.agents` across all scenarios in the summary node script rather than per-scenario - gives a single cross-scenario agent breakdown.

## Scope

### In Scope
- `AgentThread` interface: add token/cost/turn fields
- `processEvent()` in reducer: populate fields from `agent:result`
- `thread-pipeline.tsx` tooltip: show tokens (with cache %), cost, duration
- `thread-pipeline.tsx` bar label: append compact token count
- `eval/run.sh` summary totals: add `cacheRead`
- `eval/run.sh` `print_summary()`: add per-agent breakdown table

### Out of Scope
- Changes to `AgentResultData` or engine event types
- Changes to `build-result.ts` (already extracts all needed data)
- New monitor dashboard pages or components

## Files

### Modify
- `src/monitor/ui/src/lib/reducer.ts` — extend `AgentThread` with `inputTokens`, `outputTokens`, `totalTokens`, `cacheRead`, `costUsd`, `numTurns` (all `number | null`); initialize as `null` in `agent:start` handler; populate from `event.result.usage` and `event.result.totalCostUsd` in `agent:result` handler
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — import `formatNumber` from `@/lib/format`; add token count, cache %, and cost to `PlanRow` tooltip after duration line; append compact token count (`formatNumber(totalTokens)`) after agent name in bar label
- `eval/run.sh` — add `totalCacheRead` accumulator in summary aggregation (~line 216); include `cacheRead` in `totals.tokens` object; add per-agent breakdown table in `print_summary()` after scenario table, aggregating `metrics.agents` across scenarios, sorted by total tokens descending

## Verification

- [ ] `pnpm type-check` exits 0 with no errors
- [ ] `pnpm build` exits 0
- [ ] `AgentThread` interface has 6 new fields: `inputTokens`, `outputTokens`, `totalTokens`, `cacheRead`, `costUsd`, `numTurns` - all typed `number | null`
- [ ] `processEvent()` initializes all 6 new fields as `null` in the `agent:start` branch
- [ ] `processEvent()` populates all 6 new fields from `event.result` in the `agent:result` branch
- [ ] Tooltip in `thread-pipeline.tsx` renders token count with cache % when `totalTokens != null`
- [ ] Tooltip renders cost as `$X.XXXX` when `costUsd != null && costUsd > 0`
- [ ] Bar label in `thread-pipeline.tsx` appends `formatNumber(totalTokens)` after agent name when `totalTokens != null`
- [ ] Bar label omits token count when `totalTokens` is `null` (running agents)
- [ ] `eval/run.sh` summary totals object includes `cacheRead` field
- [ ] `eval/run.sh` `print_summary()` prints a per-agent breakdown table with columns: Agent, Count, Tokens, Cache, Cost, Duration
- [ ] Per-agent breakdown table rows are sorted by total tokens descending
