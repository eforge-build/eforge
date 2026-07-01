---
id: plan-01-efficiency-analytics-foundation
name: Efficiency Metrics Contracts and Historical Aggregation
branch: console-efficiency-telemetry-and-analytics/plan-01-efficiency-analytics-foundation
agents:
  builder:
    effort: high
    rationale: This plan spans shared client formulas, daemon route contracts, and
      historical aggregation with partial-data semantics across model/profile
      dimensions.
  reviewer:
    effort: high
    rationale: API and daemon aggregation changes need careful review of
      denominators, attribution, and route ownership.
---

# Efficiency Metrics Contracts and Historical Aggregation

## Architecture Context

The engine already emits `agent:result` events with usage, cost, `durationApiMs`, `modelUsage`, harness, provider, and session profile events/metadata. This plan keeps the engine unchanged and adds the shared formula/contract foundation plus a read-only daemon aggregation over the monitor event database. All daemon wire shapes and route constants remain owned by `@eforge-build/client`; monitor and Console import those contracts instead of declaring local HTTP shapes.

## Implementation

### Overview

Add shared efficiency metric helpers and typed historical analytics response shapes to `@eforge-build/client`, then expose a daemon read route that computes recent-window rollups by model+harness/provider and by session profile. The aggregation must distinguish unavailable metrics from numeric zero and surface cost/run, cost/min, output tokens per dollar, success/failure counts, sample counts, and missing-attribution counts for sparse data.

### Key Decisions

1. Put reusable formulas and percentile helpers in `@eforge-build/client` so monitor and Console use the same denominator rules.
2. Add a dedicated read route such as `API_ROUTES.efficiencyAnalytics` with a `days` query parameter clamped to 1-90, matching the existing spend window behavior without overloading `/api/spend`.
3. For model speed percentiles, use exact samples only when an `agent:result` has exactly one `modelUsage` entry and a positive `durationApiMs`; multi-model results still contribute model tokens/cost but increment a partial/excluded sample count for speed metrics.
4. For profile rollups, resolve the profile from the first `session:profile` event and fall back to session metadata when no profile event exists, then compute one run/session-level sample before percentile rollups so a session with many agent results does not dominate p50/p95.
5. Use nearest-rank percentiles over finite samples and return `null` for p50/p95 when no valid samples exist.

## Scope

### In Scope

- Shared formula helpers for output generation rate, total token traffic rate, cost burn rate, output tokens per dollar, cache percentage, and percentile calculation.
- Client-owned wire types for historical efficiency analytics model/profile rollups, cost/run, cost/min, output tokens per dollar, success/failure counts, partial/unavailable counts, missing model/profile attribution counts, and selected window metadata.
- A monitor DB method and daemon route that aggregate recent sessions/events into model and profile rows.
- Tests for formulas, percentile behavior, model/profile grouping, multi-model partial handling, missing duration/cost/model/profile behavior, and route query clamping.

### Out of Scope

- Engine telemetry changes.
- Scheduling, model routing, profile routing, or prediction behavior.
- Benchmark-grade provider measurements.
- UI rendering for build detail, Now active summaries, or historical analytics cards; those are implemented by later plans.

## Files

### Create

- `packages/client/src/efficiency-metrics.ts` — browser-safe formula names, denominator helpers, availability metadata helpers, and nearest-rank percentile utility.
- `packages/client/src/api/efficiency-analytics.ts` — Node client helpers such as `apiGetEfficiencyAnalytics` and `apiGetEfficiencyAnalyticsIfRunning` using `API_ROUTES.efficiencyAnalytics`.
- `packages/monitor/src/analytics/efficiency.ts` — focused pure aggregation logic that parses recent run/event rows and produces client-owned `EfficiencyAnalyticsSummary` rows.
- `packages/client/src/__tests__/efficiency-metrics.test.ts` — formula and percentile tests, including zero/missing denominator cases.
- `packages/monitor/src/__tests__/efficiency-analytics-db.test.ts` — real SQLite tests covering model/profile grouping and partial data.
- `packages/monitor/src/__tests__/efficiency-analytics-route.test.ts` — route tests for response shape, days clamping, and empty-data response.

### Modify

- `packages/client/src/routes/route-map.ts` — add the new analytics route constant.
- `packages/client/src/types.ts` — add `EfficiencyAnalyticsSummary`, model/profile row types, cost/run, cost/min, output tokens per dollar, success/failure counts, sample/missing count fields, and nullable metric fields.
- `packages/client/src/index.ts` — export the shared formula module and node API helpers.
- `packages/client/src/browser.ts` — export browser-safe formula helpers and the new response types through existing type exports.
- `packages/client/src/__tests__/client-contract-public-exports.test.ts` — assert the new route/helper exports remain public.
- `packages/monitor/src/db.ts` — add `MonitorDB.getEfficiencyAnalytics(windowDays)` with bounded edits; delegate aggregation to the new helper module.
- `packages/monitor/src/routes/monitor-data.ts` — register the read-only route and parse/clamp the `days` query.
- `packages/monitor/src/routes/control-monitor.ts` — include the new route key in the control monitor route key list.

## Verification

- [ ] `computeOutputGenerationRate(600 output tokens, 4000 api ms)` returns `150` output tokens/sec.
- [ ] Formula helpers return `null` for zero, negative, `null`, or non-finite denominators and never coerce missing data to zero.
- [ ] Percentile tests demonstrate nearest-rank p50/p95 values for odd, even, one-item, and empty sample arrays.
- [ ] DB tests produce separate rows for the same model under different harness/provider values.
- [ ] DB tests produce cost/run, cost/min, output tokens/dollar, and success/failure counts for model and profile rows when source data exists.
- [ ] DB tests expose a missing model attribution count when an agent result has usage/cost but lacks model attribution.
- [ ] DB tests exclude multi-model result durations from model speed percentiles while counting their tokens/cost and excluded sample count.
- [ ] DB tests group profile rows by the first `session:profile` event, fall back to session metadata when no profile event exists, and expose an unattributed/missing profile count when profile attribution is absent.
- [ ] DB tests return `null` p50/p95, cost/min, output tokens/dollar, or cache percentage when their source numerator or denominator is absent.
- [ ] Route tests show `?days=0` maps to a 1-day window and `?days=999` maps to a 90-day window.
- [ ] No `/api/...` literal for the new route appears outside `packages/client/src/routes/route-map.ts`.

## Recovery Guidance

- Failed PRD: "console-efficiency-telemetry-and-analytics"
- Root failed plan: "plan-01-efficiency-analytics-foundation"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for console-efficiency-telemetry-and-analytics. artifact source: feature-branch; 3 landed commit(s); failing plan: plan-01-efficiency-analytics-foundation; feature branch: eforge/console-efficiency-telemetry-and-analytics. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "2 blocking issue outcome(s) remain after 2 review round(s) (2 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Failure detail: "2 blocking issue outcome(s) remain after 2 review round(s) (2 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair console-efficiency-telemetry-and-analytics`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "Repair profile attribution so first session:profile is resolved from unfiltered session profile history, including same-session/different-run cases."
  - "Replace per-run full event loading with focused bulk queries for window-limited agent results and required profile attribution rows."
  - "Add the missing regression where the first profile is on an older run sharing the same session id and a later profile is on the included run."
  - "Resume blocked plan-02-live-efficiency-surfaces and plan-03-historical-analytics-ui-docs after the foundation repair passes review."
  - "Run required validation: pnpm type-check, pnpm test, pnpm build, and pnpm maintainability:check."
- Retry/resume guidance: Continue plan-01-efficiency-analytics-foundation for failed PRD console-efficiency-telemetry-and-analytics from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-07-01T16:59:38.070Z
- Source sidecar: .eforge/queue/failed/console-efficiency-telemetry-and-analytics.recovery.json
- Source identity: prdId=console-efficiency-telemetry-and-analytics; setName=console-efficiency-telemetry-and-analytics; featureBranch=eforge/console-efficiency-telemetry-and-analytics; baseBranch=main
