---
id: plan-06-build-detail-base
name: Build detail route with Log tab and ported pipeline
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-06-build-detail-base
agents:
  builder:
    effort: xhigh
    rationale: Ports the largest chunk of monitor-ui (pipeline family, timeline,
      summary/failure components, console-panel), wires the new route, handles
      live + terminal data sources via the hybrid pattern, and stands up the
      bottom tab panel with react-resizable-panels.
---

---
id: plan-06-build-detail-base
name: Build detail route with Log tab and ported pipeline
depends_on: [plan-03-hook-signature-and-consumers, plan-04-shell-and-routes]
---

# Build detail route with Log tab and ported pipeline

## Architecture Context

The build detail route at `/console/runs/:detailId` is the shareable, full-viewport view for a single build. Layout: a summary chip strip (status, profile, tokens, cost, plan progress, duration), the full `ThreadPipeline` Gantt visualization, and a resizable bottom tab panel with four tabs (`Log`, `Changes`, `Graph`, `Plan`). This plan lands the route, the summary strip, the pipeline, and the Log tab fully functional; the remaining three tabs land in plan-07.

Data source: hybrid live + historical (D11). The detail view checks whether the session ID is in `activeSessionIds`; if yes, the live stream hook supplies `runState`; if no, fetch `/api/run-state/:id` once, reduce the events client-side through the plan-01 reducer, and render with `isComplete === true`. Both paths produce the same `RunState`.

The `react-resizable-panels` library (added in plan-02) provides the upper/lower split.

## Implementation

### Overview

1. **Port pipeline component family** from `packages/monitor-ui/src/components/pipeline/` to `packages/console-ui/src/components/pipeline/`:
   - `thread-pipeline.tsx`, `plan-row.tsx`, `agent-detail-sheet.tsx`, `decision-timeline.tsx`, `stage-overview.tsx`, `activity-overlay.tsx`, `pipeline-colors.ts`, `agent-stage-map.ts`, `compute-depth-map.ts`.
   - Adjust imports to use `@/lib/run-state` instead of monitor-ui paths.
   - Port co-located tests under `__tests__/`.
2. **Port timeline family** to `packages/console-ui/src/components/timeline/`:
   - `timeline.tsx`, `event-card.tsx`, `timeline-controls.tsx`.
   - Used as the Log tab body.
3. **Port common components** to `packages/console-ui/src/components/common/`:
   - `summary-cards.tsx` (used inside the bottom tab panel), `failure-banner.tsx` (rendered when `runState.resultStatus === 'failed'`).
4. **Port console-panel** to `packages/console-ui/src/components/console/console-panel.tsx`. This houses the tabbed log/console scroll surface used as the Log tab body or wrapper.
5. **`useRunDetail` hook update.** Existing `src/hooks/use-run-detail.ts` already fetches detail data; extend it to:
   - Accept a `detailId` and an `isLive` flag (computed from `activeSessionIds`).
   - When live: read `runState` from `useActiveSessionStreams`.
   - When terminal: fetch `/api/run-state/:id` once via `subscribeWithSnapshot` (or one-shot fetch), reduce all snapshot events into a `RunState`, and return.
   - Return `{ runState, isLive, isComplete, error }`.
6. **Build detail view.** Create `src/views/run-detail/` containing:
   - `index.ts` — exports.
   - `run-detail-view.tsx` — top-level layout (summary chips → pipeline → bottom panel).
   - `summary-chips.tsx` — six chips: `status`, `profile`, `tokens` (input/output + cache %), `cost`, `plan progress`, `duration`.
   - `pipeline-section.tsx` — wraps `ThreadPipeline` and `FailureBanner`.
   - `bottom-tab-panel.tsx` — `react-resizable-panels` upper/lower split with four tabs. Tabs: `Log`, `Changes` ("Loading..." stub), `Graph` (disabled when no edges), `Plan` (disabled when no orchestration).
7. **Route wiring.** Update `src/app.tsx` to replace the placeholder runDetail branch with `<RunDetailView detailId={...} />`. Pass the navigation handler so the back button restores Now state.
8. **Browser back behavior.** Verify `popstate` already returns the user to the previous route (Now); add a test asserting the back button restores Now.
9. **Terminal fallback.** If reducer cleanly covers terminal sessions, delete the old `src/views/runs/run-detail-panel.tsx`. Otherwise repurpose it as the `Log` tab fallback (per PRD note). Decide at implementation time based on whether `run-events-preview.tsx`/`run-plans-preview.tsx` are still useful surfaces.

### Key Decisions

1. **Hybrid data source via one hook** (`useRunDetail`) — keep the view ignorant of live-vs-terminal sourcing.
2. **Tabs ship stubbed for Changes/Graph/Plan in this plan**; plan-07 fills them in. The bottom panel renders all four tab triggers, but only the Log tab content is rich.
3. **Code-split the detail route via dynamic import** in `app.tsx` (R4 mitigation): `const RunDetailView = React.lazy(() => import('@/views/run-detail'))` with a `Suspense` boundary.
4. **`SummaryCards` ported but `summary-chips.tsx` is net-new** — `SummaryCards` is the bottom-tab summary block; `summary-chips.tsx` is the top-of-detail compact strip.

## Scope

### In Scope
- Port pipeline/timeline/common/console components.
- Create `src/views/run-detail/`.
- Update `useRunDetail` to hybrid live+terminal source.
- Wire `/console/runs/:detailId` route.
- Log tab fully functional.
- Changes/Graph/Plan tab triggers render (content stubbed).
- Dynamic import for code splitting.
- Browser back returns to Now.

### Out of Scope
- File heatmap (plan-07).
- Dependency graph (plan-07).
- Plan tab / Plan preview panel (plan-07).
- Shiki integration (plan-07).

## Files

### Create
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx`
- `packages/console-ui/src/components/pipeline/plan-row.tsx`
- `packages/console-ui/src/components/pipeline/agent-detail-sheet.tsx`
- `packages/console-ui/src/components/pipeline/decision-timeline.tsx`
- `packages/console-ui/src/components/pipeline/stage-overview.tsx`
- `packages/console-ui/src/components/pipeline/activity-overlay.tsx`
- `packages/console-ui/src/components/pipeline/pipeline-colors.ts`
- `packages/console-ui/src/components/pipeline/agent-stage-map.ts`
- `packages/console-ui/src/components/pipeline/compute-depth-map.ts`
- `packages/console-ui/src/components/pipeline/__tests__/thread-pipeline.test.tsx` (and other ported pipeline tests)
- `packages/console-ui/src/components/timeline/timeline.tsx`
- `packages/console-ui/src/components/timeline/event-card.tsx`
- `packages/console-ui/src/components/timeline/timeline-controls.tsx`
- `packages/console-ui/src/components/timeline/__tests__/timeline.test.tsx`
- `packages/console-ui/src/components/common/summary-cards.tsx`
- `packages/console-ui/src/components/common/failure-banner.tsx`
- `packages/console-ui/src/components/console/console-panel.tsx`
- `packages/console-ui/src/views/run-detail/index.ts`
- `packages/console-ui/src/views/run-detail/run-detail-view.tsx`
- `packages/console-ui/src/views/run-detail/summary-chips.tsx`
- `packages/console-ui/src/views/run-detail/pipeline-section.tsx`
- `packages/console-ui/src/views/run-detail/bottom-tab-panel.tsx`
- `packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx`

### Modify
- `packages/console-ui/src/hooks/use-run-detail.ts` — hybrid live+terminal source returning `{ runState, isLive, isComplete }`.
- `packages/console-ui/src/app.tsx` — replace runDetail placeholder with `<RunDetailView />`; wrap in lazy + Suspense for code splitting.
- `packages/console-ui/src/lib/selectors/` — add detail-route selectors if needed (`selectDetailSummaryChips` etc.).
- `packages/console-ui/src/views/runs/index.ts` — strip list exports; keep what plan-06 imports.

### Delete
- `packages/console-ui/src/views/runs/run-detail-panel.tsx` — only if `RunDetailView` subsumes its responsibilities. Otherwise keep as Log-tab fallback.
- `packages/console-ui/src/views/runs/run-events-preview.tsx` — only if no longer referenced.
- `packages/console-ui/src/views/runs/run-plans-preview.tsx` — only if not consumed by Plan tab (plan-07 may still need this).

## Verification

- [ ] Visiting `/console/runs/{detailId}` for an active session mounts a `RunDetailView` component.
- [ ] The rendered detail view contains, in top-to-bottom order: a summary chip row, a `ThreadPipeline` element, and a `bottom-tab-panel` element.
- [ ] The summary chip row renders six chips with labels matching `status`, `profile`, `tokens`, `cost`, `plan progress`, and `duration`.
- [ ] The bottom tab panel uses `react-resizable-panels` for the upper/lower split.
- [ ] The bottom tab panel exposes four tab triggers labeled `Log`, `Changes`, `Graph`, `Plan`.
- [ ] The `Log` tab renders a `Timeline` component with the session's events.
- [ ] The `Graph` tab trigger is disabled when `runState.earlyOrchestration` has no dependency edges.
- [ ] The `Plan` tab trigger is disabled when `runState.earlyOrchestration` is null.
- [ ] Visiting `/console/runs/{detailId}` for a terminal session fetches `/api/run-state/:id` once, reduces events through `@/lib/run-state`, and renders the same surfaces with `isComplete === true`.
- [ ] Clicking the browser back button on the detail route returns to `/console/` and restores the Now page state.
- [ ] `RunDetailView` is loaded via `React.lazy` / dynamic import in `app.tsx`.
- [ ] `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/timeline/timeline.tsx` exists on disk.
- [ ] `packages/console-ui/src/components/common/failure-banner.tsx` exists on disk.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
