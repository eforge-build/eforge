---
title: Surface planner output and persist plan strategy in monitor UI
created: 2026-04-27
---

# Surface planner output and persist plan strategy in monitor UI

## Problem / Motivation

The eforge monitor UI has two gaps that hurt visibility into how a build was planned and executed:

1. **No planner-output surface.** The planner produces an orchestration config (mode classification — `errand` / `excursion` / `expedition`, scope rationale, pipeline composition, per-plan `build` / `review` stages). The data is fully produced, persisted in events + `orchestration.yaml`, and exposed through `/api/orchestration/:sessionId`, but the only thing the UI renders is a colored mode badge in the sidebar. There is no place to inspect the planner's actual decisions and rationale.
2. **Per-plan strategy disappears for completed builds.** While a plan is running, `BuildStageProgress` (`packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx:326`) draws the parallel stage breakdown, e.g. `implement → [test, review] → evaluate`. Once the build finishes, that breakdown vanishes from the swim lane.

   Root cause: `BuildStageProgress` is keyed off `buildStagesByPlan` (line 554), which is built from `orchestration.plans[].build`. The server's `serveOrchestration` (`packages/monitor/src/server.ts:384`) gets per-plan `build` / `review` *only* by reading `orchestration.yaml` from the filesystem (main repo, then merge-worktree fallback). After a successful build the worktree is cleaned up, and if the YAML wasn't merged into the main repo, those configs return empty — so the client's `buildStagesByPlan` map is empty and `BuildStageProgress` returns `null`. The `planning:complete` event in the DB only carries `PlanFile` (`packages/engine/src/events.ts:43`), which has no `build` / `review` fields.

The fix is to make per-plan build/review configs durable in the event log (so they outlive the worktree), and to add a dedicated UI surface that exposes the planner's decisions.

## Goal

Make per-plan build/review configs durable in the event log so they survive worktree cleanup, and add a dedicated `Plan` tab in the monitor UI that exposes the planner's classification, rationale, pipeline composition, and per-plan strategy.

## Approach

### Part A — Make per-plan build/review configs durable in events

The events database is the canonical record. Extending the `planning:complete` payload to include per-plan `build` + `review` removes the dependency on a filesystem file that may have been cleaned up.

Files:
- `packages/engine/src/events.ts:169` — extend the `planning:complete` event so its `plans` array carries `build: BuildStageSpec[]` and `review: ReviewProfileConfig` per plan (matching the shape already in `OrchestrationConfig.plans` at line 63). Easiest path: add an optional `planConfigs: Array<{ id: string; build: BuildStageSpec[]; review: ReviewProfileConfig }>` field to the event, leaving `PlanFile` untouched.
- `packages/engine/src/agents/planner.ts:322` and `packages/engine/src/pipeline/stages/compile-stages.ts:494` — populate the new field from the orchestration config the agents already produce.
- `packages/monitor/src/server.ts:386-419` — in `serveOrchestration`, prefer the new event payload for `build` / `review` and fall back to `readBuildConfigFromOrchestration` (filesystem) only when the event lacks it. Old sessions that pre-date this change will still degrade to the filesystem path.

Once per-plan build configs flow from the event log, the existing `BuildStageProgress` component already keeps rendering for `currentStage === 'complete'` plans — no UI change is needed for issue 2 beyond verifying.

### Part B — Add a "Plan" tab to ConsolePanel

The bottom panel already has a `Log` / `Changes` / `Graph` tab pattern (`packages/monitor-ui/src/components/console/console-panel.tsx:7,23`). Adding a fourth `Plan` tab matches the established UX, is discoverable, and has room for structured content.

Files:
- `packages/monitor-ui/src/components/console/console-panel.tsx` — extend `LowerTab` with `'plan'` and add `{ id: 'plan', label: 'Plan' }` to `TAB_ITEMS`. The tab is enabled whenever `effectiveOrchestration` is non-null.
- `packages/monitor-ui/src/components/console/plan-tab.tsx` — new component. Sections:
  - **Classification** — mode badge (reuse the color logic from `packages/monitor-ui/src/components/layout/sidebar.tsx` `profileBadgeClasses`), and the scope rationale pulled from the latest `planning:pipeline` event in `runState.events`.
  - **Pipeline** — `compile` / `defaultBuild` / `defaultReview` stages from the `planning:pipeline` event, rendered as small stage chips.
  - **Plans** — one card per plan with: id, name, branch, `dependsOn`, the per-plan `build` stage list (rendered with the same parallel-group visual `BuildStageProgress` uses so it reads consistently with the swim lane), and the `review` profile.
- `packages/monitor-ui/src/app.tsx:319,367` — pass `effectiveOrchestration` and the `planning:pipeline` event into `<PlanTab />`, render it as the new tab body, and bump `LowerTab` handling.

Data sources (all already on the client — no new API calls):
- `effectiveOrchestration` (`packages/monitor-ui/src/app.tsx:188`) — once Part A lands, this carries per-plan `build` / `review`.
- `runState.events` — find the most recent `planning:pipeline` event for scope + rationale + pipeline composition.

### Critical files

- `packages/engine/src/events.ts` — event payload extension
- `packages/engine/src/agents/planner.ts` — emit new field
- `packages/engine/src/pipeline/stages/compile-stages.ts` — emit new field
- `packages/monitor/src/server.ts` — prefer event payload over filesystem for build/review
- `packages/monitor-ui/src/components/console/console-panel.tsx` — add `Plan` tab
- `packages/monitor-ui/src/components/console/plan-tab.tsx` — new tab component
- `packages/monitor-ui/src/app.tsx` — wire the tab and data flow
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — verify `BuildStageProgress` persists once data flows; no change expected

### Reused utilities / patterns

- `BuildStageSpec` / `ReviewProfileConfig` types from `packages/engine/src/events.ts`
- `profileBadgeClasses` color mapping from `packages/monitor-ui/src/components/layout/sidebar.tsx`
- `BuildStageProgress` rendering from `thread-pipeline.tsx` for plan-card stage visualization (consider extracting a shared `<StageBreakdown>` if the call site needs adapting; otherwise inline a smaller variant)
- `ConsolePanel` tab infrastructure (no new tab framework needed)
- `subscribeToSession` / event reducer — no change

## Scope

**In scope:**
- Extending the `planning:complete` event payload with per-plan `build` + `review` configs.
- Populating the new field from the planner agent and the compile-stages pipeline stage.
- Updating `serveOrchestration` to prefer the event payload, with filesystem fallback for pre-existing sessions.
- Adding a `Plan` tab to `ConsolePanel` with Classification, Pipeline, and Plans sections.
- Wiring `effectiveOrchestration` and the latest `planning:pipeline` event into the new tab.
- Verifying that `BuildStageProgress` continues to render after build completion and worktree cleanup once durable data flows.
- Graceful degradation for older sessions that pre-date the event-payload change.

**Out of scope:**
- A raw-YAML view in the `Plan` tab — the structured cards already cover what the user wants to inspect, and we avoid building a new endpoint or shipping the YAML over SSE.
- New API endpoints or SSE payloads beyond the existing event stream.
- Changes to `subscribeToSession` / event reducer.

## Acceptance Criteria

1. `pnpm type-check` and `pnpm test` clean.
2. `pnpm build` clean.
3. Run the monitor UI locally (`pnpm dev` in `packages/monitor-ui/`) against the daemon:
   - Trigger a fresh `errand` build → open the **Plan** tab and confirm mode badge, rationale, pipeline, and per-plan `build` / `review` render.
   - Repeat with an `excursion` and an `expedition` build to confirm all three classifications render correctly.
   - During the active build, confirm `BuildStageProgress` (the `implement → [test, review] → evaluate` strip) is visible — this is unchanged.
   - **After the build completes and the worktree is cleaned**, confirm `BuildStageProgress` is still visible per plan with all stages marked completed, and the `Plan` tab still renders per-plan `build` / `review` (this is the regression we are fixing).
4. Click into an *older* session that pre-dates the event-payload change → the `Plan` tab degrades gracefully (filesystem fallback in `serveOrchestration` may or may not have data; tab should render what it can without crashing).
5. Spot-check the SQLite event log for a recent build (`packages/monitor/src/...`) and confirm the `planning:complete` event payload contains the new `planConfigs` field for each plan.
