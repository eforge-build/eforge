---
id: plan-01-surface-planner-output
name: Surface planner output and persist plan strategy
branch: surface-planner-output-and-persist-plan-strategy-in-monitor-ui/main
---

# Surface planner output and persist plan strategy

## Architecture Context

The eforge monitor UI exposes orchestration data via two paths:

1. The `planning:complete` event (DB-backed, durable) — currently carries only `PlanFile[]`, which lacks `build` and `review` configs.
2. The on-disk `orchestration.yaml` file (filesystem, ephemeral) — read by `packages/monitor/src/server.ts`'s `readBuildConfigFromOrchestration` from main repo or from the merge worktree as a fallback. Once a build completes and the worktree is cleaned, this path returns nothing.

The client builds `BuildStageProgress` (`packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx:554`) from `orchestration.plans[].build`. Empty data → component returns `null` → swim-lane stage breakdown disappears for completed builds. Fixing this means making per-plan `build` + `review` durable in the event log.

In parallel, the planner already emits a `planning:pipeline` event with scope, compile pipeline, default build, default review, and rationale — but the only UI surface for this is a small mode badge in the sidebar. Adding a dedicated `Plan` tab in `ConsolePanel` lets the user inspect what the planner decided.

No new endpoints or SSE payloads are introduced — the existing event stream and `/api/orchestration/:sessionId` route already deliver everything once the engine-side payload is extended.

## Implementation

### Overview

Two changes ship together:

- **Engine + server**: Extend `EforgeEvent` `planning:complete` with an optional `planConfigs` field that mirrors per-plan `build` + `review` from `OrchestrationConfig.plans`. Populate it from `runPlanner` and `compileExpeditionStage`. In `serveOrchestration`, prefer the event payload's `planConfigs` over `readBuildConfigFromOrchestration`, falling back to filesystem only when the event lacks the field (older sessions).
- **Monitor UI**: Add a fourth `Plan` tab to `ConsolePanel` next to `Log` / `Changes` / `Graph`. The tab renders three sections (Classification, Pipeline, Plans) backed by `effectiveOrchestration` and the most recent `planning:pipeline` event in `runState.events`.

### Key Decisions

1. **Use an optional `planConfigs` field on the event, not an embedded property on `PlanFile`.** `PlanFile` is a documented file-shape type used in many places; adding optional engine-orchestration fields would muddle its meaning. A sibling `planConfigs?: Array<{ id; build; review }>` field on the `planning:complete` event keeps the responsibilities separated and means existing consumers of `event.plans` (which iterate `PlanFile`) keep working untouched.
2. **Filesystem fallback stays.** Older sessions in SQLite predate this change; their `planning:complete` rows do not have `planConfigs`. The server falls back to `readBuildConfigFromOrchestration` only when `planConfigs` is missing, so old sessions continue to render whatever the filesystem still has (often nothing post-cleanup, which is acceptable graceful degradation).
3. **The Plan tab uses the existing `effectiveOrchestration` plus `runState.events`.** No new API endpoints, no new SSE message shapes, no new reducer logic. The data is already delivered to the client; the tab simply surfaces it.
4. **Do not extract a shared `<StageBreakdown>` component upfront.** Inline a small variant of the parallel-group rendering inside `plan-tab.tsx`, mirroring the visual idiom from `BuildStageProgress` in `thread-pipeline.tsx`. The existing `BuildStageProgress` is tightly coupled to `currentStage` / `threads` for status coloring; the Plan tab needs static (planning-time) display, so a copy of the chip layout is simpler than reshaping `BuildStageProgress`.
5. **No raw-YAML view in the Plan tab.** The structured cards cover the inspection needs in the source spec, and shipping YAML over SSE is out of scope.

## Scope

### In Scope
- Add optional `planConfigs: Array<{ id: string; build: BuildStageSpec[]; review: ReviewProfileConfig }>` to the `planning:complete` event variant in `packages/engine/src/events.ts`.
- Populate `planConfigs` from `runPlanner` (errand/excursion path) using the captured `PlanSetSubmission.orchestration.plans` data the agent already returns.
- Populate `planConfigs` from `compileExpeditionStage` (expedition path) using the parsed `OrchestrationConfig.plans` produced by `compileExpedition` + `injectPipelineIntoOrchestrationYaml`.
- Update `serveOrchestration` in `packages/monitor/src/server.ts` to prefer `planConfigs` from the event payload, falling back to `readBuildConfigFromOrchestration` only when the field is missing.
- Add `'plan'` to `LowerTab` in `packages/monitor-ui/src/components/console/console-panel.tsx`, wire `{ id: 'plan', label: 'Plan' }` into `TAB_ITEMS`, and disable the tab when there is no orchestration data.
- Create `packages/monitor-ui/src/components/console/plan-tab.tsx` with three sections: Classification, Pipeline, Plans (using the existing `profileBadgeClasses` color logic from sidebar.tsx).
- Wire `effectiveOrchestration` and the latest `planning:pipeline` event into `<PlanTab />` from `packages/monitor-ui/src/app.tsx`.
- Update vitest coverage for the engine event population path and the server's prefer-event logic.
- Verify `BuildStageProgress` continues to render after build completion when `planConfigs` flows from the event log.

### Out of Scope
- Raw-YAML viewer in the Plan tab.
- New API endpoints or SSE message types beyond the existing event stream.
- Changes to `subscribeToSession` or the event reducer in `packages/monitor-ui/src/lib/reducer.ts`.
- Backfilling old SQLite rows.

## Files

### Create
- `packages/monitor-ui/src/components/console/plan-tab.tsx` — new component rendering Classification / Pipeline / Plans sections from `effectiveOrchestration` + the latest `planning:pipeline` event.

### Modify
- `packages/engine/src/events.ts` — extend the `planning:complete` event variant with optional `planConfigs: Array<{ id: string; build: BuildStageSpec[]; review: ReviewProfileConfig }>`. Leave `PlanFile` untouched.
- `packages/engine/src/agents/planner.ts` — in the planner-submission emit path (around line 322), populate `planConfigs` from `planSetPayload.orchestration.plans` (mapping each entry to `{ id, build, review }`). Preserve existing `plans: PlanFile[]` behavior.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — in `compileExpeditionStage` (around line 494), after `injectPipelineIntoOrchestrationYaml`, parse the produced orchestration config (or use the in-memory `ctx` data) to derive per-plan `build` + `review`, and emit them on the second `planning:complete` event the stage already yields. The earlier `expedition:compile:complete` event keeps its current shape.
- `packages/monitor/src/server.ts` — in `serveOrchestration` (around line 396), after parsing the latest `planning:complete` row, read `data.planConfigs`. If present, use it to enrich `orchestration.plans[].build` / `.review`. Only fall back to `readBuildConfigFromOrchestration(sessionId)` when `planConfigs` is missing or empty.
- `packages/monitor-ui/src/components/console/console-panel.tsx` — extend `LowerTab` with `'plan'`, append `{ id: 'plan', label: 'Plan' }` to `TAB_ITEMS`, and add the disabled-when-no-orchestration affordance (mirror the existing `graph` disabled pattern).
- `packages/monitor-ui/src/app.tsx` — pass `effectiveOrchestration` and the latest `planning:pipeline` event into a new `<PlanTab />` render branch in the lower-panel switch (around line 350-372). Reset `lowerTab` to `'log'` when the Plan tab becomes disabled (mirror the existing graph reset pattern around line 260).
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — verify only; no change expected. `buildStagesByPlan` derivation already keys off `orchestration.plans[].build`, so once the server returns durable data the swim-lane stage strip persists for `currentStage === 'complete'` plans.

### Tests
- `test/planner-submission.test.ts` (or a new sibling `test/planning-complete-event.test.ts`) — add a vitest case asserting the `planning:complete` event yielded by `runPlanner` includes `planConfigs` with each plan's `build` + `review` matching the submitted orchestration entries. Use real engine code; no mocks. Hand-craft the agent stream via `StubHarness` (or follow the existing planner-continuation.test.ts pattern).
- `test/orchestration-logic.test.ts` (or new sibling) — exercise the prefer-event branch in the server's enrichment logic with a unit-level helper if the logic is extracted, otherwise a higher-level test asserting the merged response.

## Verification

- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes including the new `planning:complete` event payload case and the new server prefer-event case.
- [ ] `pnpm build` completes with zero errors across all workspace packages.
- [ ] In the monitor UI, the new `Plan` tab appears in `ConsolePanel` next to `Log` / `Changes` / `Graph`.
- [ ] The `Plan` tab renders three sections (Classification, Pipeline, Plans) when `effectiveOrchestration` is non-null and a `planning:pipeline` event has been received.
- [ ] The `Plan` tab's Classification section shows the mode badge (errand=green, excursion=yellow, expedition=purple) using `profileBadgeClasses` from `packages/monitor-ui/src/components/layout/sidebar.tsx`.
- [ ] The `Plan` tab's Pipeline section lists `compile`, `defaultBuild`, and `defaultReview` from the latest `planning:pipeline` event as small chips.
- [ ] The `Plan` tab's Plans section renders one card per plan with id, name, branch, `dependsOn`, the per-plan `build` stage list (with parallel groups visually grouped, matching the `BuildStageProgress` chip layout), and the per-plan `review` profile (strategy, perspectives, maxRounds, evaluatorStrictness).
- [ ] After a build completes and the merge worktree is cleaned, `BuildStageProgress` in the swim lane still renders per-plan stages with all stages marked completed, sourced from the `planning:complete` event's `planConfigs` (verified by inspecting the SQLite event log via the daemon or by selecting the completed session in the UI).
- [ ] The SQLite `planning:complete` event row for a freshly run build contains `planConfigs` as a JSON array, with one entry per plan, each containing non-empty `build` and `review` fields matching the orchestration config.
- [ ] An older session that pre-dates this change opens in the UI without crashing; the Plan tab renders Classification + Pipeline from the `planning:pipeline` event when present and renders the Plans section using whatever `effectiveOrchestration` provides (filesystem fallback in `serveOrchestration` when applicable).
- [ ] The `Plan` tab is disabled (button non-clickable, mirrors the existing `graph` disabled pattern) when `effectiveOrchestration` is `null`.
- [ ] The lower-panel active tab resets to `'log'` when the Plan tab becomes disabled, matching the existing graph reset behavior in `app.tsx`.
