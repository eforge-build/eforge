---
id: plan-03-workstation-docs
name: Workstation Recommendation Status UX and Documentation
branch: maintain-recommended-backlog-implementation-order-and-next-work-plan/plan-03-workstation-docs
agents:
  builder:
    effort: high
    rationale: Updates the extension-owned React workstation, fixture/mock bridge,
      generated assets, docs, and test configuration while preserving
      iframe/action boundaries.
  tester:
    effort: high
    rationale: This plan adds a new workstation test project and must verify root
      test/type/build gates include it.
---

# Workstation Recommendation Status UX and Documentation

## Architecture Context

The eforge-plan workstation is an extension-owned frame bundle. It can call only registered extension actions through the bridge and must not import parent Console internals. Generated AI output remains read-only until the user confirms an apply action.

## Implementation

### Overview

Render recommendation freshness in the Backlog tab, add refresh controls for missing/stale recommendations, surface active refresh task status, keep apply confirmation explicit, add workstation tests/fixtures, rebuild frame assets, and update extension documentation.

### Key Decisions

1. Extend workstation data loading to consume the enriched `get-recommendations` response instead of deriving status from the model alone.
2. Use the new `refresh-recommendations` action from the Backlog tab; after starting/reusing a refresh task, reload planning tasks and recommendation status.
3. Keep generated recommendation output in `PlanningTaskResultPreview` read-only until the user clicks the existing two-step apply confirmation.
4. Show safe parallelizable groups only as planning guidance. Do not add UI actions that enqueue builds, alter queue dependencies, or create plan sets.
5. Add a package-local workstation Vitest project and include it in the root Vitest project list so `pnpm test` runs the Backlog tab status tests.

## Scope

### In Scope

- Workstation types for recommendation status, stale reasons, active refresh task, and refresh action output.
- Backlog tab rendering for missing, fresh, and stale recommendation states.
- Refresh controls for missing/stale status and visible active refresh task status.
- Fixture/mock bridge data for status states and refresh action behavior.
- Component/hook tests for fixture and live action data.
- Generated workstation assets under `workstation-assets/plans`.
- README updates for storage, status semantics, refresh/apply flow, workstation behavior, and non-goals.

### Out of Scope

- Parent Console component imports or private route imports.
- Host-specific Claude/Pi commands or skills.
- Automatic queue selection, build enqueueing, queue orchestration, or plan-set generation.
- Legacy `.backlog/recommendations.json` import/export.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/vitest.config.ts` — package-local React/jsdom test config for workstation source tests.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/__tests__/setup.ts` — workstation test setup for jsdom/React tests.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.test.tsx` — missing/fresh/stale fixture rendering, refresh control, and explicit apply affordance coverage.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — live bridge response mapping for recommendation status and active refresh task status.

### Modify

- `vitest.config.ts` — add the workstation Vitest project to the root `pnpm test` project list.
- `eforge/extensions/eforge-plan/workstation-src/plans/package.json` — add a `test` script and package-local test dev dependencies if imports require them.
- `pnpm-lock.yaml` — update the workstation package importer if `package.json` dev dependencies change.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add recommendation status, stale reason, get-recommendations response, and refresh action response types.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — store recommendation status alongside the recommendation model and map failures without blanking board data.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — pass status and refresh handlers to the recommendations panel; reload task workflows after refresh starts/reuses a task.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx` — render status badge, missing/fresh/stale copy, stale reasons, active task status, refresh button, and existing recommendation guidance.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — expose a refresh-recommendations helper or a reload hook used by `BacklogView`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — label recommendation refresh workflow entries when `entry.purpose === "recommendation-refresh"`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add missing/fresh/stale status fixtures, active refresh task fixture, and refresh response fixture data.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — return enriched `get-recommendations` mock responses and handle `refresh-recommendations`.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — rebuilt bundle output from `pnpm build:eforge-plan-workstation`.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — rebuilt stylesheet output if Vite emits changes.
- `eforge/extensions/eforge-plan/README.md` — document `current.json`, status sidecar path, missing/fresh/stale meanings, refresh action, explicit apply semantics, workstation behavior, and non-goals.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert the README documents the status sidecar, refresh action, explicit apply, no auto queue orchestration, and no legacy recommendation import/export.

## Verification

- [ ] The Backlog tab renders the missing recommendation state from fixture data and shows a refresh control.
- [ ] The Backlog tab renders the fresh recommendation state from fixture data and shows no stale reasons.
- [ ] The Backlog tab renders the stale recommendation state from fixture data, including stale reason codes/messages and a refresh control.
- [ ] A live mocked `get-recommendations` action response with status data is displayed by the Backlog tab.
- [ ] Clicking refresh for missing/stale recommendations invokes `refresh-recommendations` exactly once and reloads planning tasks.
- [ ] Active refresh task status from `get-recommendations` is visible in the recommendation panel.
- [ ] Generated recommendations in a completed planning task require the existing two-step confirmation before `apply-planning-agent-task-result` is invoked.
- [ ] The workstation tests run through root `pnpm test`.
- [ ] `pnpm build:eforge-plan-workstation` regenerates `workstation-assets/plans/index.js` without importing parent Console modules.
- [ ] The README contains the private `current.json` path, the status sidecar path, missing/fresh/stale definitions, refresh action semantics, explicit apply semantics, no unattended enqueueing, and no `.backlog/recommendations.json` import/export.