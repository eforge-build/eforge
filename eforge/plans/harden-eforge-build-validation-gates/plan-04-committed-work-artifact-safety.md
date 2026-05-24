---
id: plan-04-committed-work-artifact-safety
name: Committed Work Enforcement and Artifact Safety
branch: harden-eforge-build-validation-gates/plan-04-committed-work-artifact-safety
agents:
  builder:
    effort: high
    rationale: Git worktree state checks affect merge semantics and artifact
      recording, including the single-plan builtOnMerge path.
  reviewer:
    effort: high
    rationale: Worktree merge behavior needs careful review to avoid false positives
      that block valid builds.
  tester:
    effort: high
    thinking:
      type: enabled
      budgetTokens: 6000
    rationale: Tests need real git repositories and artifact registry assertions
      around dirty tracked and untracked work.
---

# Committed Work Enforcement and Artifact Safety

## Architecture Context

`recordArtifact(ctx)` records the current merge worktree `HEAD` as the durable provider-neutral artifact commit. If a single-plan `builtOnMerge` build leaves dirty changes in the merge worktree, validation can inspect work that is absent from the recorded commit. Worktree merge completion must therefore prove that the implementation is committed and the worktree contains no tracked or untracked implementation changes before a plan is marked merged.

## Implementation

### Overview

Add WorktreeManager safeguards for the `builtOnMerge` path and final artifact recording. Verify worktree cleanliness and committed HEAD movement where a plan produced changes. Fail with actionable merge/build errors when dirty work remains, and assert artifact records are not written for such failures.

### Key Decisions

1. Enforce dirty-state checks at `WorktreeManager.mergePlan()` for `builtOnMerge` plans, because this is the transition that marks a plan merged and returns the commit SHA.
2. Check both tracked and untracked files using `git status --porcelain` so generated/untracked implementation files cannot be validated but omitted from the artifact commit.
3. Compare `managed.baseSha` with `HEAD` after drift recovery to detect no committed changes for plans that were expected to mutate the repository.
4. Do not reject intentional no-op plans by default when there is no dirty work; instead emit or preserve a clear path for a future explicit no-op waiver if existing tests reveal legitimate no-op builds.

## Scope

### In Scope

- Add helper(s) in `packages/engine/src/worktree-manager.ts` to inspect `git status --porcelain` and compare `HEAD` with the managed base SHA.
- In the `builtOnMerge` branch of `mergePlan()`, run drift recovery, then reject dirty tracked/untracked changes before returning the SHA.
- Include dirty file names in the thrown merge error so users can identify uncommitted work.
- Add a pre-recording defensive check in `recordArtifact(ctx)` or a shared helper so queued artifact recording also fails if the merge worktree is dirty.
- Ensure plan/build failure propagation marks the run failed before artifact recording and landing.
- Add tests with real git repositories for dirty tracked work, dirty untracked work, committed changes passing, and no artifact record after dirty-work failure.

### Out of Scope

- Redesigning builder commit behavior or forcing every no-op plan to fail.
- Changing landing action vocabulary or stack provider behavior.
- Replacing existing drift recovery logic beyond adding post-recovery safety checks.

## Files

### Modify

- `packages/engine/src/worktree-manager.ts` — add dirty-status helpers and enforce builtOnMerge post-build clean/committed-state checks.
- `packages/engine/src/orchestrator/phases.ts` — add a final dirty-work guard before `upsertArtifact` if the guard is not already centralized in WorktreeManager.
- `packages/engine/src/worktree-ops.ts` — add reusable git status helper only if WorktreeManager-local implementation would duplicate existing worktree operations.
- `test/worktree-manager.test.ts` — add builtOnMerge dirty tracked/untracked failure cases and committed-change success case.
- `test/stack-artifact-recording.test.ts` — add no-artifact-record assertion when merge worktree status is dirty before artifact recording.
- `test/orchestration-logic.test.ts` — assert merge failure from dirty builtOnMerge work prevents validate/PRD/artifact phases.
- `docs/architecture.md` or `README.md` — mention that validation and artifact recording operate on committed merge-worktree state, if not already covered by plan-02 docs.

## Verification

- [ ] A builtOnMerge plan with a modified tracked file not committed by the builder causes `mergePlan()` to throw an error containing the dirty file path.
- [ ] A builtOnMerge plan with an untracked implementation file causes `mergePlan()` to throw an error containing the untracked file path.
- [ ] A builtOnMerge plan whose changes are committed returns the `HEAD` SHA and marks the managed worktree merged.
- [ ] When a dirty builtOnMerge merge fails, orchestration emits `plan:build:failed` and does not emit `validation:start`.
- [ ] `recordArtifact(ctx)` refuses to write `.eforge/artifacts/builds.json` when the merge worktree has dirty tracked or untracked files.
- [ ] Existing drift recovery test still passes when the recovered worktree has no dirty changes.
- [ ] Landing-related tests continue to assert `landingAction` values `pr`, `merge`, and `leave` only.