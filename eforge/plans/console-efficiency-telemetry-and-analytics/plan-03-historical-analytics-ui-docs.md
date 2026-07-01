---
id: plan-03-historical-analytics-ui-docs
name: Historical Efficiency Analytics UI and Documentation
branch: console-efficiency-telemetry-and-analytics/plan-03-historical-analytics-ui-docs
---

# Historical Efficiency Analytics UI and Documentation

## Architecture Context

Plan 01 exposes typed historical analytics data through the daemon/client contract. This plan adds a compact Console view over that read model and updates user-facing docs. Console must fetch through `API_ROUTES`, use client-owned response types, and present sparse data with sample counts and partial/unavailable states.

## Implementation

### Overview

Add a Now rail analytics card with selectable recent windows and model/profile rollups. The card consumes the daemon analytics route, maps wire rows into compact display rows, and labels every metric denominator. Documentation explains formulas and caveats so users do not confuse output generation rate, total token traffic, and cost burn.

### Key Decisions

1. Implement historical analytics as a Now rail card rather than a new top-level Console route, keeping the UI compact and colocated with Spend, Build health, and Build history.
2. Use a small fixed window selector such as 1d, 7d, 14d, 30d, and 90d; the hook refetches when the selected window changes and preserves the last successful payload across transient fetch failures.
3. Show model rows grouped by model+harness/provider and profile rows grouped by session profile; each row includes p50/p95 output generation rate, cost/run, cost/min, output tokens/$, success/failure counts, and sample counts when present.
4. Render `—`, “partial”, or sample-count copy for missing data instead of zero values or high-precision placeholders.
5. Document metrics as telemetry proxies from eforge event data, not provider benchmark measurements.

## Scope

### In Scope

- Browser hook for the historical efficiency analytics route.
- Pure selector that maps `EfficiencyAnalyticsSummary` into card-ready rows and unavailable states.
- Now rail analytics card with selectable windows, model/profile sections, and visible formula/denominator copy.
- UI tests for window selection, model/profile labels, partial/unavailable states, and no-data state.
- User-facing docs for metric formulas and caveats.

### Out of Scope

- New top-level navigation route.
- Engine, scheduler, routing, or profile selection changes.
- Replacing the existing Spend, Build health, or Build history widgets.
- Export/download workflows.

## Files

### Create

- `packages/console-ui/src/hooks/use-efficiency-analytics.ts` — fetches `API_ROUTES.efficiencyAnalytics` with `days`, polling/refetch behavior comparable to `useSpend`.
- `packages/console-ui/src/lib/selectors/efficiency-analytics.ts` — maps client wire rows into compact card view models and display availability flags.
- `packages/console-ui/src/components/now/efficiency-analytics-card.tsx` — Now rail card with window selector and model/profile rollup sections.
- `packages/console-ui/src/__tests__/efficiency-analytics-selectors.test.ts` — selector tests for grouping display, null metrics, sample counts, and partial labels.
- `packages/console-ui/src/components/now/__tests__/efficiency-analytics-card.test.tsx` — component tests for visible labels, window controls, no-data state, and partial state text.

### Modify

- `packages/console-ui/src/views/now-dashboard.tsx` — add selected analytics window state, call the new hook, select the view model, and render the analytics card in the rail without removing Spend, Build health, or Build history.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — assert the new analytics card coexists with existing Now rail widgets.
- `packages/console-ui/README.md` — document the new Console data flow and formulas for live and historical efficiency metrics.
- `web/content/docs/integrations.md` — update the Console dashboard section with metric names, formulas, and caveats.

## Verification

- [ ] The analytics card renders selectable 1d, 7d, 14d, 30d, and 90d window controls.
- [ ] Selecting a different window issues a request using `API_ROUTES.efficiencyAnalytics` with the selected `days` query.
- [ ] Model rows display model, harness/provider, p50 and p95 output generation rate, cost/run, cost/min, output tokens/$, success/failure counts, and speed sample count when supplied.
- [ ] Profile rows display profile name or an unattributed label, p50 and p95 output generation rate, cost/run, cost/min, output tokens/$, success/failure counts, and run sample count when supplied.
- [ ] Rows with null metric values render `—` or an explicit partial/unavailable label instead of `0`.
- [ ] The no-data state renders when both model and profile rollup arrays are empty.
- [ ] Now dashboard tests still find Spend, Build health, Build history, Queue, and active-build surfaces.
- [ ] Documentation includes formulas for output generation rate, token traffic, cost burn, output tokens/$, and cache context, plus caveats for sparse data and multi-model attribution.