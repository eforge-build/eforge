---
title: Console efficiency telemetry and analytics
created: 2026-07-01
---

# Console efficiency telemetry and analytics

## Executive Summary

Creates a feature/deep session plan for console efficiency telemetry across Build Detail, the Now dashboard, and historical analytics. The plan extends Console/daemon read surfaces to compute clearly labeled output generation rate, total token traffic, cost burn, cache context, and model/profile rollups while preserving existing elapsed time, turns, tokens, cost, and cache displays. It keeps the engine as the telemetry emitter only, avoids scheduling/routing changes, and calls for typed client-owned wire shapes, selector/API tests, UI tests, type-check, build, and maintainability validation.

## Problem Statement

Console currently shows useful build totals such as elapsed time, turns, tokens, cache, and cost, but it does not clearly answer how efficiently model calls are generating output, how much total token traffic is moving through a build, or how cost is burning over time. Existing rough token/minute-style indicators risk conflating input/cache traffic and wall-clock elapsed time with model output generation speed. Users also lack a historical view for comparing models and runtime profiles over recent builds.

## Scope

Implement a coherent efficiency telemetry layer for Console:

- Build Detail: add an output generation throughput metric and supporting detail/tooltip metrics for total token traffic rate, cost burn rate, output tokens per dollar, and cache context.
- Now dashboard: add an aggregate active-build throughput/burn summary across currently running builds, using the same labels and formulas.
- Historical analytics: expose recent-window rollups by model and profile with p50/p95 output tokens/sec, cost/run, cost/min, output tokens/dollar, and success/failure counts where data exists.
- Shared definitions: keep metric names and formulas consistent across live, per-run, and historical surfaces.
- Documentation: update Console/user-facing docs where dashboard metrics are described, including metric formulas and caveats.

Out of scope: changing engine scheduling/model routing, adding cost prediction, treating telemetry proxies as benchmark-grade provider measurements, or replacing existing token/cost/cache summary displays.

## Acceptance Criteria

- Build Detail summary shows LLM output generation rate as `sum(output tokens) / sum(API duration)` from completed agent results with valid usage and API duration.
- Build Detail exposes supporting efficiency context: total token traffic per wall-clock time, cost per minute, output tokens per dollar, cache percentage, and enough tooltip/detail copy to explain denominators.
- Now dashboard shows an aggregate active-build efficiency/burn summary across running builds without removing existing active build cards, queue, spend, health, or history widgets.
- Historical analytics provides selectable recent windows and rollups by model and by profile, including p50/p95 output tokens/sec, cost/run, cost/min, output tokens/dollar, and success/failure counts when source data supports them.
- Labels distinguish output generation rate from total token traffic and cost burn rate.
- Missing usage, cost, wall-clock duration, API duration, model attribution, or profile attribution renders as unavailable/partial rather than zero or misleading precision.
- Existing elapsed time, turns, tokens, cost, cache, Spend card, Build health, and active-build displays remain intact.
- Unit tests cover metric formulas, missing-data behavior, percentile calculations, active aggregate selectors, and historical model/profile grouping; UI tests cover the new visible labels/states.
- `pnpm type-check`, `pnpm test`, `pnpm build`, and `pnpm maintainability:check` pass.

## Code Impact

Likely implementation touch points:

- `packages/console-ui/src/lib/run-state/types.ts` and `handlers/handle-agent.ts`: persist `durationApiMs` from `agent:result` on reduced agent threads or otherwise expose it to selectors.
- `packages/console-ui/src/lib/run-state/selectors/summary-stats.ts` plus a new focused metrics helper/selector: derive reusable efficiency metrics from reduced run state.
- `packages/console-ui/src/components/common/summary-cards.tsx` and `views/run-detail/summary-chips.tsx`: render Build Detail efficiency metrics and explanatory tooltip/detail text.
- `packages/console-ui/src/lib/selectors/now.ts`, `components/now/active-build-card.tsx`, and/or Now rail components: compute and display active aggregate throughput/burn.
- `packages/client/src/routes/route-map.ts`, `packages/client/src/types.ts`, and possibly `packages/client/src/api/*`: own any new daemon route constants and wire response types; do not inline `/api/...` path literals.
- `packages/monitor/src/db.ts` and `packages/monitor/src/routes/monitor-data.ts`: add or extend read-only historical aggregation over persisted runs/events for model/profile efficiency.
- `packages/console-ui/src/hooks`, `lib/selectors`, and `components/now` or a new analytics view/card: fetch and render historical rollups.
- Tests under `packages/console-ui/src/**/__tests__`, `packages/monitor/src/__tests__`, and `packages/client/src/__tests__` as needed.

The architecture should preserve the project boundary that the engine emits typed telemetry and consumers render it. Live and per-run metrics can be derived in Console from reduced `EforgeEvent`s; historical metrics should be served through typed daemon/client read models backed by the monitor event database.

## Design Decisions

- Primary throughput label: use “output generation rate” for `output tokens / API second`; do not label it as generic “tokens/sec”.
- Supporting live/build metrics:
  - total token traffic rate = `(input + output tokens) / wall-clock minute`;
  - cost burn rate = `totalCostUsd / wall-clock minute`;
  - output tokens per dollar = `output tokens / totalCostUsd`;
  - cache context = `cacheRead / input tokens` with cache creation shown where useful.
- Active builds may include completed agent-result data in output generation rate; live in-flight usage can contribute to traffic/cost burn only when the denominator is honest. Mark partial metrics when API duration is unavailable.
- Historical model rows should group by model plus harness/provider. If a result has exactly one modelUsage entry, attribute the result API duration exactly; for multi-model results, either distribute duration by output-token share with an approximation note or exclude from model-speed percentiles and show a missing/partial count.
- Historical profile rows should group by session profile from `session:profile`/session metadata and compute run-level aggregates before percentile rollups.
- Percentiles should ignore samples missing numerator or denominator and expose sample counts so p95 with tiny samples is not over-read.
- Keep UI compact: prefer summary metrics plus tooltip/detail copy rather than large permanent panels on every surface.
- Keep daemon/client route discipline: any new route or response type belongs in `@eforge-build/client`, with monitor and Console importing the shared contract.

## Assumptions And Validation

Assumptions:

- Existing persisted events contain enough `agent:result` duration, usage, cost, modelUsage, and profile metadata for both per-run and historical analytics.
- Historical analytics can be implemented as a read-only daemon aggregation without altering build-engine behavior.
- UI copy can describe metrics as telemetry proxies rather than objective provider benchmarks.

Risks and mitigations:

- Misleading metrics if labels blur output speed, traffic, and burn; mitigate with explicit names and tooltip formulas.
- Sparse or missing historical data can make p95 or profile comparisons noisy; mitigate with sample counts and unavailable/partial states.
- Model attribution may be approximate for multi-model agent results; mitigate with exact-only handling or visible approximation notes.
- Historical SQL/aggregation could grow complex in `db.ts`; keep helpers focused and add tests before UI work.

Validation plan:

- Add pure selector tests for all formulas, denominator selection, unavailable states, active aggregation, and percentile rollups.
- Add daemon DB/route tests with realistic event rows covering model, profile, missing duration, missing cost, failed run, and multi-model cases.
- Add Console component tests asserting the Build Detail, Now, and historical analytics labels distinguish output generation, traffic, and burn.
- Run `pnpm type-check`, `pnpm test`, `pnpm build`, and `pnpm maintainability:check`.