---
title: Fix Review-Cycle Dirty-Worktree Completion Bug
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Fix Review-Cycle Dirty-Worktree Completion Bug

## Problem / Motivation

A build can reach plan completion with uncommitted review-fixer changes still present in the plan/merge worktree when the evaluator produces no verdicts after a review-fix pass. The downstream merge dirty-worktree guard correctly refuses to merge, but the failure happens too late and the event stream can contain contradictory completed/failed status transitions.

This is a daemon/engine orchestration safety bug discovered while recovering a failed build. The roadmap's Daemon & MCP Server section emphasizes the daemon as the single orchestration authority with safety checks, so the fix belongs in engine orchestration rather than Pi/Claude integration code.

Observed failure from run `40a51307-a596-4d63-92e9-58785b253c56` / plan `plan-01-actionable-planning-playbooks`:

- `review-cycle` found 4 reviewer issues.
- `review-fixer` edited `README.md`, `web/content/docs/playbooks.md`, `packages/pi-eforge/skills/eforge-plan/SKILL.md`, and `eforge-plugin/skills/plan/plan.md`.
- The evaluator returned no verdicts; the engine emitted `agent:warning` with code `evaluation-verdicts-missing` and message `Evaluator produced no verdicts; no review-fixer changes were committed.`
- The build then emitted `plan:build:complete` and a completed status event.
- Merge immediately failed because `WorktreeManager.mergePlan()` detected uncommitted changes in the merge worktree.

Why it matters:

- Plan completion should mean all implementation and review-fixer work is committed or intentionally discarded.
- Review-fixer changes must not be stranded as dirty work until merge.
- Recovery summaries and console state become confusing when a plan emits both completion and later merge failure state.
- This is a daemon orchestration safety issue, aligned with the roadmap goal that the daemon is the single orchestration authority with richer safety checks.

Concrete recorded evidence:

- Event `356677`: `plan:build:review:fix:complete` after review-fixer edits.
- Event `356678`: `agent:activity` lists 4 dirty files from review-fixer.
- Event `356702`: `agent:warning` code `evaluation-verdicts-missing`.
- Event `356707`: `cycle-terminated` with `reason: max-rounds`, `issuesRemaining: 4`, `finalEvaluationRan: false`.
- Event `356708`: `plan:build:complete`.
- Event `356709`: `plan:status:change` to `completed`.
- Events `356704`-`356706`: merge failure transitions the same plan to failed due to dirty worktree.

Confirmed root causes:

- `packages/engine/src/pipeline/stages/build-stages.ts` `evaluateStageInner()` prepares an evaluation snapshot after review-fixer changes.
- When `!result || result.failed || result.verdicts.length === 0`, `evaluateStageInner()` calls `restoreOriginalBuilderCommitStateUnlessDrifted(ctx, snapshot)`, emits `agent:warning`, calls `setLastBuildEvaluation(ctx, lastBuildEvaluationNotRun())`, and returns without setting `ctx.buildFailed`.
- `restoreOriginalBuilderCommitState()` intentionally restores `snapshot.candidatePatch` back into the worktree after failure, leaving review-fixer candidate changes dirty when no verdicts are produced.
- The warning text says `no review-fixer changes were committed`, but no terminal failure is raised and no discard happens.
- `reviewCycleStage()` emits a `cycle-terminated` decision after max rounds, including `issuesRemaining`, `lastReviewIssueCount`, and `finalEvaluationRan`, but it does not set `ctx.buildFailed` when `issuesRemaining > 0` or `finalEvaluationRan === false`.
- `runBuildPipeline()` only stops when `ctx.buildFailed` is true, so the pipeline emits `plan:build:complete`.
- `executePlans()` pushes all plan runner events into `eventQueue`, then after the runner finishes it pushes `transitionPlan(..., 'completed')` if no `plan:build:failed` event was observed.
- The event loop yields `plan:build:complete`, sees the state already transitioned to completed, and performs merge immediately.
- If merge fails, it yields failed transition events, but the previously queued completed transition event can still be yielded afterward, producing observed `failed`/`completed` interleaving.

## Goal

Prevent review-cycle builds from completing when review-fixer candidate changes remain uncommitted due to missing evaluator verdicts or unresolved max-round termination.

Ensure engine orchestration emits clear terminal failures, preserves or reports recovery-relevant dirty candidate changes, and avoids contradictory completed/failed plan status events.

## Approach

This is a **bugfix** / **focused** change with high classification confidence. The defect is confirmed by recorded events and code inspection, and the scope is cohesive across engine pipeline/orchestration tests.

Code inspection validated these primary paths:

- `packages/engine/src/pipeline/stages/build-stages.ts` owns evaluator no-verdict behavior and review-cycle max-round termination.
- `packages/engine/src/pipeline/runners.ts` owns final `plan:build:complete` emission and currently lacks a final dirty-worktree guard for sequential stages.
- `packages/engine/src/orchestrator/phases.ts` owns plan state transitions, merge scheduling, and the observed completed/failed event interleaving.
- `test/build-evaluator-enforcement.test.ts` already covers evaluator no-verdict and review-cycle metadata behavior, including a test that currently encodes warning-only no-verdict behavior.
- `test/orchestration-logic.test.ts` already covers dirty builtOnMerge merge failure but does not assert absence of stale completed status events.

Implementation direction:

- Make no-verdict evaluator outcomes terminal when candidate changes exist.
- Fail the build after restoring the original dirty candidate state, so recovery preserves the uncommitted candidate diff for analysis.
- Do not let missing evaluator verdicts proceed to merge.
- In `review-cycle`, treat max-round exhaustion with unresolved issues or `finalEvaluationRan === false` as a terminal plan failure.
- Emit a `plan:build:failed` event with a clear message and set `ctx.buildFailed = true`.
- Add a final dirty-worktree guard in `runBuildPipeline()` before emitting `plan:build:complete`.
- If `git status --porcelain` is non-empty at the end of sequential stages, emit `plan:build:failed`, set `ctx.buildFailed = true`, and do not emit completion.
- Tighten `executePlans()` so a completed transition is not queued blindly after all runner events if the state has since been moved to failed.
- Alternatively, avoid merge-triggering off mutable state until the completed status event itself is processed.
- The minimal fix is to have the plan runner mark failed earlier, but the event-ordering bug should still get a regression test.
- Prefer adding small helpers near the existing `lastBuildEvaluationNotRun()` / evaluation helpers to keep complexity bounded.
- The existing auto-commit defense only runs after parallel stage groups, which is not enough for sequential `review-cycle`.
- The final dirty-worktree guard should fail rather than auto-commit at pipeline end, because review-fixer candidate changes must pass evaluator acceptance before they are committed.
- Existing successful evaluation verdict flows should continue to commit accepted changes.
- Existing rejected evaluation verdict flows should continue to discard rejected changes.
- Existing no-verdict tests should be revised or split so no-candidate no-op remains non-terminal, while candidate changes with no verdicts fail.

Reproduction steps from recorded production event stream:

1. Run a PRD whose build pipeline includes `review-cycle` and whose review phase reports actionable issues.
2. Have `review-fixer` apply fixes that leave unstaged/uncommitted working-tree changes.
3. Have the evaluator agent return text without `submit_evaluation_verdicts` / parseable verdicts.
4. Observe `evaluateStageInner()` emit only `agent:warning` with code `evaluation-verdicts-missing`.
5. Observe `reviewCycleStage()` emit `plan:build:decision` with `kind: cycle-terminated`, `reason: max-rounds`, `issuesRemaining: 4`, and `finalEvaluationRan: false`.
6. Observe `runBuildPipeline()` emit `plan:build:complete` because `ctx.buildFailed` remains false.
7. Observe `executePlans()` transition the plan to `completed` and attempt merge.
8. Observe `WorktreeManager.mergePlan()` fail with `builtOnMerge plan ... has uncommitted changes in the merge worktree`.

Targeted test reproduction to add:

- In `test/build-evaluator-enforcement.test.ts`, create a `review-cycle` with maxRounds 1, a reviewer issue, a review-fixer that mutates a file, and an evaluator response with no verdicts.
- Assert the stage emits `plan:build:failed`.
- Assert the stage sets `ctx.buildFailed = true`.
- Assert the stage fails before completion/merge and preserves or reports the uncommitted candidate changes for recovery.
- Assert the stage does not emit a successful completion path.
- In `test/orchestration-logic.test.ts`, cover event-ordering/terminal-state behavior so a merge failure does not leave a later queued `plan:status:change` to `completed` after a failure for the same plan.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Review-fixer changes should not be auto-committed unless evaluator verdicts accept them. | `evaluateStageInner()` currently prepares an evaluation snapshot and `applyEvaluationVerdicts()` commits accepted verdicts; project behavior centers evaluator acceptance as the gate for review-fixer changes. | high | low | Run existing build evaluator tests after implementation. | Auto-committing at pipeline end would bypass the evaluator and could land bad reviewer fixes. |
| Candidate changes should be preserved or at least reported when the build fails for missing verdicts. | Recovery for the observed failure needed the dirty diff; `restoreOriginalBuilderCommitState()` currently restores the candidate patch after evaluator failure. | medium | low | Decide in implementation whether to preserve dirty state until recovery capture or include diffs in failure event before cleanup. | Discarding changes silently would make recovery harder and could lose useful reviewer fixes. |
| Failing earlier in `evaluateStageInner()` and `reviewCycleStage()` will prevent the stale completed transition observed at merge time. | `executePlans()` only queues completed status when no `plan:build:failed` event is observed from the runner. | high | low | Add a regression test covering event order. | If insufficient, console/recovery can still show contradictory completed/failed states. |
| A final dirty-worktree guard in `runBuildPipeline()` is appropriate even if evaluator/review-cycle are fixed. | Existing parallel-group path already has a post-group dirty-worktree defense; sequential stages currently lack an equivalent terminal guard. | high | low | Add a pipeline-level test for sequential dirty state. | Future sequential stages could repeat the same class of bug. |
| `review-cycle` max-round exhaustion should be terminal when unresolved issues remain or final evaluation did not run after fixes. | The observed decision had `issuesRemaining: 4` and `finalEvaluationRan: false`, yet the plan completed; this contradicts the safety semantics of review-fix-evaluate. | high | low | Run targeted review-cycle tests. | Builds may fail more often where they previously limped to merge; this is desired safety behavior but could expose flaky evaluator output. |
| Some existing tests intentionally encode warning-only behavior for evaluator no-verdict cases. | `test/build-evaluator-enforcement.test.ts` has `does not create an evaluation commit when no verdict submission or XML fallback is produced` expecting warning-only behavior with a dirty candidate diff. | high | low | Update/split that test during implementation. | If overlooked, tests will fail or worse preserve the buggy contract. |

Recommended profile: **Excursion**.

Rationale: this is a cohesive bugfix across the engine pipeline and orchestration layers. It touches multiple files and requires careful regression tests, but a single plan can enumerate the behavior, file impact, and acceptance criteria without delegated module planning. Expedition is not needed because there are no independent subsystem plans to coordinate.

## Scope

In scope:

- Update `packages/engine/src/pipeline/stages/build-stages.ts`.
- Update `evaluateStageInner()` no-verdict / failed-result behavior so candidate review-fixer changes do not proceed as a warning-only condition.
- Update `reviewCycleStage()` max-round exhaustion handling so unresolved issues or missing final evaluation become terminal failures.
- Add small helpers near the existing `lastBuildEvaluationNotRun()` / evaluation helpers if needed to keep complexity bounded.
- Update `packages/engine/src/pipeline/runners.ts`.
- Add a final dirty-worktree guard before `plan:build:complete` for sequential pipelines.
- Fail rather than auto-commit at pipeline end when review-fixer candidate changes have not passed evaluator acceptance.
- Update `packages/engine/src/orchestrator/phases.ts`.
- Add a regression fix/test support for completed/failed event ordering if needed.
- Update `test/build-evaluator-enforcement.test.ts`.
- Update existing no-verdict expectations if intended behavior changes from warning-only to terminal failure for candidate changes.
- Add a review-cycle regression where review-fixer writes a change and evaluator produces no verdicts.
- Assert `ctx.buildFailed` is true and no completion path occurs.
- Add a max-round regression where `finalEvaluationRan: false` after fixer changes emits `plan:build:failed`.
- Update `test/orchestration-logic.test.ts`.
- Strengthen the dirty builtOnMerge merge-failure test to assert no stale completed status event appears after the failed status event for the same plan.
- Potentially update `test/pipeline.test.ts`.
- Add or update a pipeline-level test that dirty sequential-stage worktree state prevents `plan:build:complete`.
- Revise or split `test/build-evaluator-enforcement.test.ts` test `does not create an evaluation commit when no verdict submission or XML fallback is produced`, because it currently expects warning-only behavior with a dirty candidate diff and encodes the current bug.
- Preserve no-candidate no-op as non-terminal while making candidate changes with no verdicts fail.

Out of scope:

- Pi integration changes.
- Claude integration changes.
- Delegated module planning.
- Auto-committing review-fixer candidate changes at pipeline end without evaluator acceptance.

## Acceptance Criteria

- `review-cycle` emits `plan:build:failed` when review-fixer candidate changes exist and the evaluator produces zero verdicts.
- `review-cycle` sets `ctx.buildFailed` to `true` when review-fixer candidate changes exist and the evaluator produces zero verdicts.
- `review-cycle` does not emit `plan:build:complete` when review-fixer candidate changes exist and the evaluator produces zero verdicts.
- `review-cycle` emits `plan:build:failed` when max rounds are exhausted with `issuesRemaining` greater than zero.
- `review-cycle` emits `plan:build:failed` when max rounds are exhausted after a review-fix pass and `finalEvaluationRan` is false.
- `runBuildPipeline()` emits `plan:build:failed` instead of `plan:build:complete` when the final sequential-stage worktree has uncommitted changes.
- `runBuildPipeline()` final dirty-worktree failure message lists the dirty files reported by `git status --porcelain`.
- `executePlans()` does not emit a `plan:status:change` event with `status: completed` after emitting a `plan:status:change` event with `status: failed` for the same plan.
- The dirty builtOnMerge merge-failure regression test asserts that no stale completed status event appears after the failed status event for the same plan.
- The no-verdict evaluator regression test asserts that no evaluation commit is created when no verdicts are produced.
- The no-verdict evaluator regression test asserts that review-fixer candidate changes are preserved or reported for recovery after the build fails.
- Existing successful evaluation verdict flows continue to commit accepted changes.
- Existing rejected evaluation verdict flows continue to discard rejected changes.
- `test/build-evaluator-enforcement.test.ts` includes a `review-cycle` regression with maxRounds 1, a reviewer issue, a review-fixer that mutates a file, and an evaluator response with no verdicts.
- The `review-cycle` no-verdict regression emits `plan:build:failed`.
- The `review-cycle` no-verdict regression sets `ctx.buildFailed = true`.
- The `review-cycle` no-verdict regression does not proceed to completion/merge while candidate changes remain uncommitted, and preserves or reports those changes for recovery.
- The `review-cycle` no-verdict regression does not emit a successful completion path.
- `test/orchestration-logic.test.ts` covers event-ordering/terminal-state behavior so a merge failure does not leave a later queued `plan:status:change` to `completed` after a failure for the same plan.
- The existing `test/build-evaluator-enforcement.test.ts` no-verdict test is revised or split so no-candidate no-op remains non-terminal.
- The existing `test/build-evaluator-enforcement.test.ts` no-verdict test is revised or split so candidate changes with no verdicts fail.
- `pnpm test -- test/build-evaluator-enforcement.test.ts test/orchestration-logic.test.ts test/pipeline.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
