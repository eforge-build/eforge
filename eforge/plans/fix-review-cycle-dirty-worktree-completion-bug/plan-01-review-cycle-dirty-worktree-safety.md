---
id: plan-01-review-cycle-dirty-worktree-safety
name: Review Cycle Dirty Worktree Safety
branch: fix-review-cycle-dirty-worktree-completion-bug/plan-01-review-cycle-dirty-worktree-safety
agents:
  builder:
    effort: high
    rationale: Multi-file engine orchestration bugfix across evaluator, pipeline
      runner, and plan lifecycle event ordering with regression tests in
      oversized files requiring bounded edits.
  reviewer:
    effort: high
    rationale: Safety-critical orchestration changes must verify terminal event
      semantics, dirty-worktree handling, and no regression to accepted/rejected
      evaluator flows.
  tester:
    effort: high
    rationale: Targeted tests exercise asynchronous event ordering and git worktree
      state; failures may require careful diagnosis.
---

# Review Cycle Dirty Worktree Safety

## Architecture Context

The engine owns build orchestration and emits all build/plan lifecycle events. Review-cycle uses `review -> review-fix -> evaluate`; review-fixer changes are candidate worktree changes that must be accepted by evaluator verdicts before they become committed implementation work. `executePlans()` consumes `runBuildPipeline()` events, mutates plan state through `transitionPlan()`, and triggers merge when a plan reaches `completed`.

Current code can emit `plan:build:complete` after evaluator no-verdict outcomes because `evaluateStageInner()` restores the candidate diff, emits only `agent:warning`, and does not set `ctx.buildFailed`. `reviewCycleStage()` also emits max-round termination metadata without failing unresolved cycles. A downstream merge dirty-worktree guard catches the dirty state, but too late and with possible completed/failed event interleaving.

## Implementation

### Overview

Make unsafe review-cycle outcomes terminal before a plan can complete. Then add a final pipeline dirty-worktree guard as defense-in-depth and tighten orchestration event queuing so stale completed status events are not emitted after a plan has failed during merge.

### Key Decisions

1. Treat evaluator no-verdict or failed-result outcomes with candidate files as build failures, not warning-only outcomes. The candidate changed files are already known via the evaluation snapshot; include them in the failure message or adjacent observable event so recovery can identify the stranded diff.
2. Preserve existing no-op behavior when there are no evaluator candidate changes: `evaluateStageInner()` must still return without a failure when `hasEvaluationCandidateChanges()` is false or the prepared snapshot has zero files.
3. Do not auto-commit final dirty worktree state. A final sequential dirty-worktree guard must emit `plan:build:failed`, set `ctx.buildFailed = true`, list porcelain dirty files, and skip `plan:build:complete`.
4. Max-round review-cycle termination is terminal when unresolved issues remain or when a review-fix pass happened but no final evaluation ran. Continue to permit successful max-round metadata where the final evaluation ran and no issues remain after accepted verdicts.
5. Prevent stale completion transitions in `executePlans()` by checking current plan state before queuing `completed` and/or by dropping queued completed transitions once the same plan reaches `failed` during merge. Preserve all state mutations through `transitionPlan()`/`mutateState()`.

## Scope

### In Scope

- Update evaluator no-verdict and failed-result behavior in `packages/engine/src/pipeline/stages/build-stages.ts`.
- Update review-cycle max-round terminal failure behavior in `packages/engine/src/pipeline/stages/build-stages.ts`.
- Add helper(s) near `lastBuildEvaluationNotRun()` / evaluation helpers to keep complexity bounded.
- Add a final dirty-worktree guard before `plan:build:complete` in `packages/engine/src/pipeline/runners.ts`.
- Update `packages/engine/src/orchestrator/phases.ts` to avoid emitting completed status events after a failed status for the same plan.
- Revise and add regression tests in `test/build-evaluator-enforcement.test.ts`.
- Add a pipeline-level sequential dirty-worktree regression in `test/pipeline.test.ts`.
- Strengthen merge failure event-ordering coverage in `test/orchestration-logic.test.ts`.

### Out of Scope

- Pi integration changes.
- Claude Code plugin changes.
- Auto-committing review-fixer candidate changes without evaluator acceptance.
- Database migrations.
- Public documentation changes.

## Files

### Create

- None.

### Modify

- `packages/engine/src/pipeline/stages/build-stages.ts` — Change `evaluateStageInner()` so candidate snapshots with no verdicts or failed evaluator results restore/report candidate state, emit `plan:build:failed`, set `ctx.buildFailed = true`, and do not continue as warning-only. Add helper(s) for formatting missing-verdict failures with snapshot file paths. Change `reviewCycleStage()` so max-round exhaustion emits `cycle-terminated` metadata and then fails when `issuesRemaining > 0` or `finalEvaluationRan === false` after a review-fix/evaluate pass.
- `packages/engine/src/pipeline/runners.ts` — Reuse `getWorktreeDirtyFiles()` or equivalent porcelain status logic for a final guard before `plan:build:complete`; fail and list dirty files when a real git worktree is dirty. Keep non-git unit-test contexts from producing extra events.
- `packages/engine/src/orchestrator/phases.ts` — After plan runner drain, queue `completed` only if no plan build failure was observed and the plan is still in `running`; during merge failure, ensure later queued completed status for that plan is not yielded after a failed status. Preserve `transitionPlan()` as the state mutation path.
- `test/build-evaluator-enforcement.test.ts` — Revise the existing no-verdict test so dirty candidate changes fail with no evaluation commit. Add or split a no-candidate no-op test that remains non-terminal. Add a `review-cycle` maxRounds 1 regression with a reviewer issue, a review-fixer mutation, and evaluator output with no verdicts; assert `plan:build:failed`, `ctx.buildFailed === true`, no `plan:build:complete`, no evaluation commit, and candidate files are preserved or reported for recovery. Add max-round failure assertions for unresolved issues / `finalEvaluationRan === false`.
- `test/pipeline.test.ts` — Add a real temporary git repo test where a sequential build stage writes an uncommitted file; assert `runBuildPipeline()` emits `plan:build:failed` with porcelain dirty files and does not emit `plan:build:complete`.
- `test/orchestration-logic.test.ts` — Strengthen the dirty builtOnMerge merge-failure test to assert no `plan:status:change` with `status: completed` appears after a failed status event for `plan-a`.

## Verification

- [ ] Evaluator no-verdict with candidate changes emits `plan:build:failed` and sets `ctx.buildFailed` to `true`.
- [ ] Evaluator no-verdict with no candidate changes emits no `plan:build:failed`.
- [ ] No-verdict paths do not create an evaluation commit.
- [ ] Review-cycle max-round exhaustion with `issuesRemaining > 0` emits `plan:build:failed`.
- [ ] Review-cycle max-round exhaustion with `finalEvaluationRan === false` after a review-fix pass emits `plan:build:failed`.
- [ ] Successful accepted verdict flows still create evaluation commits containing accepted changes.
- [ ] Rejected/review verdict flows still discard rejected candidate changes.
- [ ] Sequential dirty worktree state at pipeline end emits `plan:build:failed`, includes porcelain dirty file lines in the error, and does not emit `plan:build:complete`.
- [ ] Dirty builtOnMerge merge failure produces no `plan:status:change` to `completed` after the failed status event for the same plan.
- [ ] `pnpm test -- test/build-evaluator-enforcement.test.ts test/orchestration-logic.test.ts test/pipeline.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.