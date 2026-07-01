---
id: plan-02-live-efficiency-surfaces
name: Live Build Detail and Active Now Efficiency Surfaces
branch: console-efficiency-telemetry-and-analytics/plan-02-live-efficiency-surfaces
---

# Live Build Detail and Active Now Efficiency Surfaces

## Architecture Context

Console reduces live and per-run `EforgeEvent`s into `RunState`, then selectors and components render Build Detail and Now dashboard surfaces. This plan consumes the shared formula helpers from plan 01 and keeps existing elapsed time, turns, tokens, cache, cost, Spend, Build health, and active build cards visible while adding explicitly labeled efficiency metrics.

## Implementation

### Overview

Persist `durationApiMs` on reduced agent threads, derive reusable live efficiency metrics from `RunState`, render those metrics on Build Detail with explanatory tooltip/detail copy, and add an aggregate active-build efficiency/burn summary above the existing active build cards. Replace any ambiguous active-card token/min label with a label that identifies total token traffic rather than output generation speed.

### Key Decisions

1. Store `durationApiMs` as `number | null` on `AgentThread`; only finalized agent results with positive API duration and a finite output-token value, including zero, contribute to output generation rate.
2. Include live in-flight `agent:usage` overlays only in wall-clock traffic and cost burn metrics, never in output generation rate unless an `agent:result` supplies `durationApiMs`.
3. Represent each metric with raw value, label, formula text, sample counts, and availability (`available`, `partial`, `unavailable`) so components render partial/unavailable states without fake zeros.
4. Build Detail displays a compact row/chip group with tooltips: “output generation rate”, “token traffic”, “cost burn”, “output tokens / $”, and “cache context”.
5. Now active aggregate sums raw counts across active run states and shows a single compact summary above active cards; active cards remain in place.

## Scope

### In Scope

- `durationApiMs` persistence in run-state agent threads.
- A reusable Console run-state selector for live/build efficiency metrics.
- Build Detail summary rendering with formulas and partial/unavailable states.
- Active Now aggregate selector and component across currently running build cards/details.
- Tests for formulas, missing API duration, live overlay behavior, active aggregation, and visible labels.

### Out of Scope

- Historical model/profile analytics UI and fetching.
- Daemon DB aggregation.
- Engine telemetry emission changes.
- Cost prediction or provider benchmark claims.

## Files

### Create

- `packages/console-ui/src/lib/run-state/selectors/efficiency.ts` — derives `RunEfficiencyMetrics` from `RunState` using shared client formulas.
- `packages/console-ui/src/lib/selectors/active-efficiency.ts` — derives aggregate active-build efficiency/burn view model from active run states or active card metric payloads.
- `packages/console-ui/src/components/now/active-efficiency-summary.tsx` — compact summary shown before active build cards when running builds exist.
- `packages/console-ui/src/lib/run-state/__tests__/efficiency-selector.test.ts` — pure selector tests for denominators and partial states.
- `packages/console-ui/src/__tests__/active-efficiency-selectors.test.ts` — active aggregate selector tests.
- `packages/console-ui/src/components/now/__tests__/active-efficiency-summary.test.tsx` — UI tests for active summary labels and unavailable states.
- `packages/console-ui/src/components/common/__tests__/summary-cards.test.tsx` — Build Detail summary label/tooltip rendering tests.

### Modify

- `packages/console-ui/src/lib/run-state/types.ts` — add `durationApiMs: number | null` to `AgentThread`.
- `packages/console-ui/src/lib/run-state/handlers/handle-agent.ts` — initialize `durationApiMs` to null and copy `result.durationApiMs` on `agent:result`.
- `packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts` — assert `durationApiMs` is stored on matched result threads.
- `packages/console-ui/src/lib/run-state/selectors/summary-stats.ts` — include derived efficiency metrics alongside existing summary totals.
- `packages/console-ui/src/lib/run-state/index.ts` — export the new efficiency selector and types.
- `packages/console-ui/src/views/run-detail/summary-chips.tsx` — pass efficiency metrics into the shared summary row.
- `packages/console-ui/src/components/common/summary-cards.tsx` — render labeled efficiency metrics and tooltip/detail text without removing existing status, duration, plan, turn, token, cost, file, or review chips.
- `packages/console-ui/src/lib/selectors/now.ts` — add live efficiency fields to active build card view models while preserving existing token/cost/cache fields.
- `packages/console-ui/src/components/now/active-build-card.tsx` — replace the ambiguous rough token/min label with an explicit total token traffic label or remove it when the aggregate summary covers the metric.
- `packages/console-ui/src/components/now/active-builds-grid.tsx` — render `ActiveEfficiencySummary` above the existing active build cards.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — extend active card tests for efficiency fields without changing existing token/cost/cache assertions.

## Verification

- [ ] A reduced run with two completed agent results displays output generation rate as `sum(outputTokens) / sum(durationApiMs seconds)`.
- [ ] A completed agent result with zero output tokens and positive API duration contributes zero to the numerator and its API duration to the denominator.
- [ ] A run with output tokens but missing or zero API duration renders output generation rate as unavailable or partial with an omitted sample count.
- [ ] Wall-clock token traffic uses `(input + output tokens) / elapsed wall-clock minute` and includes live `agent:usage` overlays.
- [ ] Cost burn uses `totalCostUsd / elapsed wall-clock minute` and includes live cost overlays.
- [ ] Output tokens per dollar renders unavailable when total cost is zero or missing.
- [ ] Cache context uses `cacheRead / input tokens` and displays cache creation tokens in the tooltip/detail text when present.
- [ ] Build Detail summary tests find visible labels “output generation rate”, “token traffic”, “cost burn”, “output tokens / $”, and “cache context”.
- [ ] Now active aggregate tests sum active builds and keep connecting/missing-detail builds marked partial rather than counted as zero.
- [ ] Existing Now active build card tests still find elapsed time, tokens, cost, cache, current agent, and navigation behavior.