---
id: plan-01-planner-guard-and-loop-reset
name: Planner Guard and Compile Loop Reset
depends_on: []
branch: fix-planner-stage-ignoring-pipeline-composer-s-prd-passthrough-selection/planner-guard-and-loop-reset
---

# Planner Guard and Compile Loop Reset

## Architecture Context

The default compile pipeline is `['planner', 'plan-review-cycle']`. The planner stage runs `composePipeline()` first, which may replace `ctx.pipeline.compile` with a different set of stages (e.g., `['prd-passthrough']`). Two bugs prevent the new stages from executing:

1. The planner stage proceeds to `runPlanner()` unconditionally after the composer returns, even when `ctx.pipeline.compile` no longer includes `'planner'`.
2. `runCompilePipeline` uses an index-based loop that increments `i` after each stage. When the planner stage replaces the compile list, `i` is already 0 and increments to 1 - but the new list (e.g., `['prd-passthrough']`) has length 1, so the loop exits without executing it.

## Implementation

### Overview

Add an early-return guard in the planner stage after `composePipeline()`, and reset the loop index in `runCompilePipeline` when a stage mutates the compile list.

### Key Decisions

1. **Guard in planner stage rather than prd-passthrough**: The planner stage is responsible for running the composer, so it owns the decision to abort when the composer selects a different path. This keeps prd-passthrough unaware of how it was invoked.
2. **Snapshot-and-compare in runCompilePipeline**: Capture `ctx.pipeline.compile` before each stage runs. After the stage completes, compare the reference. If it changed, reset `i = 0` instead of incrementing. This is a generic mechanism that handles any stage mutating the compile list, not just the planner-to-passthrough case.

## Scope

### In Scope
- Early-return guard in planner stage after composePipeline()
- Compile loop index reset in runCompilePipeline when stages change
- Test: stage that mutates ctx.pipeline.compile causes new stages to run
- Test: planner stage returns early when composer selects prd-passthrough

### Out of Scope
- Changes to prd-passthrough stage logic
- Changes to composer or planner prompts
- Changes to the build phase

## Files

### Modify
- `src/engine/pipeline.ts` - Two changes:
  1. After `composePipeline()` loop (line ~793): Add guard that returns early if `ctx.pipeline.compile` no longer includes `'planner'`, yielding a `plan:progress` event explaining the delegation.
  2. In `runCompilePipeline` (line ~1994-2008): Before each stage, snapshot `ctx.pipeline.compile`. After the stage completes, if the compile list changed, reset `i = 0` instead of `i++`.
- `test/pipeline.test.ts` - Two new tests:
  1. `runCompilePipeline` test: a stage that replaces `ctx.pipeline.compile` causes the loop to restart and execute the new stages.
  2. `runCompilePipeline` test: verify that when the compile list is replaced mid-pipeline, the old remaining stages do not run.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] New test: a registered stage that sets `ctx.pipeline.compile = ['stage-x']` causes `stage-x` to execute (verifying loop reset)
- [ ] New test: after compile list replacement, original subsequent stages are not executed
- [ ] In `pipeline.ts`, after the `composePipeline()` for-await loop, there is a conditional that checks `ctx.pipeline.compile.includes('planner')` and returns early if false
- [ ] In `runCompilePipeline`, the loop captures a snapshot of `ctx.pipeline.compile` before each stage and resets `i = 0` when the snapshot differs after the stage completes
