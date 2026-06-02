---
id: plan-02-console-review-fix-stage
name: Console Review-Fix Stage Mapping
branch: add-review-cycle-round-metadata-and-review-fix-stage-mapping/plan-02-console-review-fix-stage
---

# Console Review-Fix Stage Mapping

## Architecture Context

Console run-state owns local `PipelineStage` modeling and resolves raw agent stages into build stages with `resolveBuildStage`. `AGENT_TO_STAGE` already maps `review-fixer` to `review-fix`, but the stage union and `review-cycle` composite omit `review-fix`. This plan makes `review-fix` visible in the active console pipeline while still resolving it to the `review-cycle` composite when the plan build config contains `review-cycle`.

`packages/monitor-ui/` is legacy. Keep this plan focused on `packages/console-ui/` unless type-check exposes a shared-type break.

## Implementation

### Overview

Add `review-fix` as a console `PipelineStage`, handle review-fix start events in the run-state reducer, and include `review-fix` in the `review-cycle` composite mapping.

### Key Decisions

1. Treat `review-fix` as a first-class raw pipeline stage.
2. Resolve `review-fix` to `review-cycle` when `review-cycle` appears in a plan build pipeline.
3. Continue ignoring review-fix completion and continuation events for reducer state unless a later inspector feature consumes them.

## Scope

### In Scope

- Add `review-fix` to console `PipelineStage`.
- Register `plan:build:review:fix:start` as a handled run-state event that sets the visible stage to `review-fix`.
- Add `review-fix` to `COMPOSITE_STAGES['review-cycle']`.
- Add visual status support for `review-fix` where `PipelineStage` is used as a keyed status.
- Update console tests for stage resolution, build-stage statuses, and reducer behavior.

### Out of Scope

- No review-cycle inspector sheet.
- No clickable stage pills.
- No changes to monitor-ui unless type-check requires a small mirrored type/style update.
- No changes to event persistence or daemon routes.

## Files

### Create

- None.

### Modify

- `packages/console-ui/src/lib/run-state/types.ts` — add `review-fix` to `PipelineStage`.
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-build.ts` — add `handlePlanBuildReviewFixStart` and update stage-advancement comments.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — import/register the new handler and remove `plan:build:review:fix:start` from ignored event types while leaving complete/continuation ignored.
- `packages/console-ui/src/components/pipeline/agent-stage-map.ts` — change `COMPOSITE_STAGES['review-cycle']` to `['review', 'review-fix', 'evaluate']`.
- `packages/console-ui/src/components/graph/graph-status.ts` — add a `review-fix` status style so `Record<GraphNodeStatus, StatusStyle>` remains exhaustive.
- `packages/console-ui/src/components/now/mini-plan-swimlane.tsx` — add an optional fallback label for `review-fix`.
- `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts` — update the running-stage comment to include `review-fix`.
- `packages/console-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts` — add `resolveBuildStage('review-fix', ['implement', 'review-cycle'])` and `getBuildStageStatuses(..., 'review-fix')` coverage.
- `packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts` — add a test that `plan:build:review:fix:start` sets `planStatuses[planId]` to `review-fix`.

## Verification

- [ ] `resolveBuildStage('review-fix', ['implement', 'review-cycle'])` returns `review-cycle`.
- [ ] `getBuildStageStatuses(['implement', 'review-cycle'], 'review-fix')` marks `review-cycle` active and `implement` completed.
- [ ] The console run-state handler for `plan:build:review:fix:start` sets `planStatuses[planId]` to `review-fix`.
- [ ] `plan:build:review:fix:complete` and `plan:build:review:fix:continuation` remain ignored reducer events.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.