---
title: Rebase direct PR builds onto latest remote base before opening PR
created: 2026-06-02
depends_on: ["handle-stale-stacked-pr-parent-branches-during-git-spice-landing"]
landing: pr
landing_auto_merge: true
stack_parent: handle-stale-stacked-pr-parent-branches-during-git-spice-landing
---

# Rebase direct PR builds onto latest remote base before opening PR

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-01-rebase-direct-pr-builds-onto-latest-remote-base-before-openi.md`.

Roadmap alignment: this fits **Kernel Resilience and Typed Recovery** because direct PR landing should be an honest, fail-closed gate that validates the branch against the base users will actually review. It also relates to **Optional Stacked PR Expansion** by borrowing the same freshness/conflict-recovery philosophy already present in stacked landing, while keeping direct PR behavior separate from git-spice.

Classification: **bugfix / deep**. The current behavior can publish stale PRs even after validation passes on an outdated base. The fix is cross-phase because the first base sync must happen before validation, while the final freshness guard must run immediately before PR creation and can force bounded revalidation.

Recommended profile: **Excursion**.

Rationale: this is a cohesive engine correctness fix spanning git primitives, direct PR landing orchestration, and tests. It is too cross-phase for Errand, but it does not need Expedition because a single plan can cover the direct PR base-sync helper, orchestration retry loop, documentation updates, and regression tests without delegated module planning.

Direct non-stacked `landing.action: pr` builds can validate and publish a pull request against a stale base branch. The engine may compile from a fetched trunk SHA at the start of a root trunk build, but the direct PR landing path does not fetch the PR base immediately before validation or immediately before `gh pr create`. If the target branch advances while eforge is building, eforge can open a PR whose artifact branch is behind the latest remote base, or fail late without using the existing conflict-resolution machinery.

Affected users are team/solo PR workflows using `landing.action: pr` without stacked PR mode. The risk is highest for long builds and active base branches, including direct feature-branch PRs where `build.trunkSync` intentionally does not apply.

Post-merge validation and PRD validation should certify the exact branch state reviewers will see. A stale direct PR undermines the honest-gate model, can hide conflicts until GitHub/CI/review time, and makes direct PR landing less reliable than stacked PR landing even though the engine already has merge-conflict resolver support.

Validated findings from the current working tree:

- Direct non-stacked PR landing is implemented in `packages/engine/src/landing.ts` and `packages/engine/src/worktree-manager.ts`. `executeLandingAction({ action: 'pr' })` runs cleanup/provenance collection, then calls `worktreeManager.issuePr()`.
- `WorktreeManager.issuePr()` in `packages/engine/src/worktree-manager.ts` calls `ensureGhAvailable()`, then pushes the feature branch and calls `createPullRequest()` with `--base <baseBranch> --head <featureBranch>`. Existing-PR detection/editing happens only after `gh pr create` fails.
- `pushFeatureBranch()` and `createPullRequest()` in `packages/engine/src/worktree-ops.ts` are simple `git push -u origin <branch>` and `gh pr create --base ... --head ...` wrappers. They do not fetch the PR base, compare remote base freshness, or rebase the feature branch.
- `packages/engine/src/trunk-sync.ts` provides a pre-compile freshness gate for root trunk builds, but it is intentionally non-mutating and explicitly does not rebase or move refs. Docs in `docs/config.md` state feature-branch builds are not retargeted by trunk sync.
- Current orchestration order in `packages/engine/src/orchestrator.ts` is `executePlans` → `validate` → `prdValidate` → possible gap-close revalidation → `recordArtifact` → `stackLanding` → `finalize`. Direct PR publication happens in `finalize` after validation already passed.
- `validate()` in `packages/engine/src/orchestrator/phases.ts` runs the combined `build.postMergeCommands` and planner `validate` commands in the merge worktree. It can use the existing validation fixer retry loop when command validation fails.
- `mergeResolver` is already threaded through `EforgeEngine` → `EforgeOrchestrator` → `WorktreeManager.mergePlan()`/`mergeToBase()` and stacked landing conflict recovery. `runMergeConflictResolver()` emits `plan:merge:resolve:*` events and can resolve/stage conflicts in the supplied cwd.
- Stacked PR landing in `packages/engine/src/stacking/landing.ts` restacks before submitting and `packages/engine/src/stacking/landing-conflict-recovery.ts` already uses the same `MergeResolver` plus bounded attempts and post-recovery validation for provider-classified restack conflicts.
- Existing direct PR tests live primarily in `test/landing-actions.test.ts`, using real temporary git repositories and a fake `gh` shim. They cover trunk PR, non-trunk direct PR, existing PR detection, PR metadata, and auto-merge behavior.
- User-stated requirement: direct `landing.action: pr` builds should fetch the PR base, rebase the eforge feature branch onto the latest remote base before validation/PR creation, invoke the existing merge-conflict resolver on rebase conflicts, and add a final pre-PR freshness guard that retries sync/rebase plus validation when the base advances after validation.

Evidence-backed reproduction path:

1. Configure or enqueue a non-stacked build with `landing.action: pr`.
2. Ensure the build targets a branch that has a remote counterpart, such as `origin/main` or `origin/feature/parent`.
3. Let eforge compile/build from the current base and merge all plans into the artifact branch in the merge worktree.
4. Advance the remote base branch after the build started but before eforge runs `gh pr create`.
5. Let the direct PR landing path continue.

Actual behavior from code inspection:

- `executeLandingAction()` for `action === 'pr'` in `packages/engine/src/landing.ts` performs cleanup/provenance work and then calls `worktreeManager.issuePr()`.
- `WorktreeManager.issuePr()` pushes the feature branch and runs `gh pr create --base <baseBranch> --head <featureBranch>`.
- No current direct PR code path fetches `<remote>/<baseBranch>`, rebases `featureBranch` onto the fetched base, or checks whether the base changed after validation.
- If a rebase conflict would occur against the latest base, the direct PR path does not invoke `mergeResolver`; conflict handling is only wired for plan merges, final local merge, and stacked landing restack recovery.

Confirmed root cause:

- Direct PR landing is currently implemented as publish-only. `packages/engine/src/worktree-manager.ts` `issuePr()` calls `pushFeatureBranchOp()` and then `createPullRequestOp()`; `packages/engine/src/worktree-ops.ts` implements those as `git push -u origin <branch>` and `gh pr create --base <baseBranch> --head <featureBranch>`.
- `packages/engine/src/landing.ts` calls `worktreeManager.issuePr()` after the main validation phases have already run. There is no direct PR-specific base freshness phase before `validate()` and no final freshness guard immediately before `gh pr create`.
- `packages/engine/src/trunk-sync.ts` only handles pre-compile root trunk freshness. It is intentionally read-only/non-mutating and skips feature-branch bases, so it cannot guarantee that a direct PR artifact branch is rebased onto the latest remote base before validation or PR creation.
- The existing `mergeResolver` capability is present and threaded through the engine, but direct PR rebase is not implemented, so there is no point where the resolver can be called for rebase conflicts.
- Current orchestration is linear: once `validate()`/`prdValidate()` pass, `recordArtifact()` and `finalize()` run. There is no bounded loop that can detect a final pre-PR base advance, resynchronize the feature branch, rerun validation, and then retry PR creation.

The defect is not missing GitHub CLI support or missing merge-conflict resolver support. The defect is missing direct PR base-sync orchestration and missing git primitives for fetch/rebase/final pre-PR freshness in the direct PR path.

## Goal

Direct non-stacked `landing.action: pr` builds should fetch the PR base, rebase the eforge feature branch onto the latest remote base before validation and PR creation, invoke the existing merge-conflict resolver on rebase conflicts, and use a final pre-PR freshness guard that retries sync/rebase plus validation when the base advances after validation.

If retries are exhausted, the fetch/rebase fails unrecoverably, or conflicts cannot be resolved, direct PR landing should fail with a clear `landing:skipped` reason instead of opening a stale PR.

## Approach

Expected behavior:

- Before command/PRD validation for a direct PR build, eforge fetches the PR base and rebases the artifact branch onto the latest fetched remote base when needed.
- Rebase conflicts invoke the existing `mergeResolver` / `runMergeConflictResolver` path with conflict context for the feature branch and PR base.
- Validation runs after the feature branch has been synchronized to the latest fetched base.
- Immediately before `gh pr create`, eforge fetches the PR base again and confirms it has not advanced since the validated sync point.
- If the base advanced after validation, eforge retries the base-sync/rebase plus validation path within a bounded retry budget.
- If retries are exhausted, the fetch/rebase fails unrecoverably, or conflicts cannot be resolved, direct PR landing fails with a clear `landing:skipped` reason instead of opening a stale PR.

Implementation targets:

- `packages/engine/src/worktree-ops.ts` and/or a new focused helper such as `packages/engine/src/direct-pr-base-sync.ts`
  - Add git primitives for direct PR base freshness: fetch the PR base remote ref, resolve the fetched SHA, compare it with the artifact branch ancestry/sync point, and rebase the artifact branch when the fetched base is not already an ancestor.
  - Use the same remote as the current direct PR publish path unless the implementation intentionally introduces a documented config field. The current direct PR push path defaults to `origin`.
  - Validate the base branch name before using it in `git fetch`/`git rebase` arguments. Prefer reusing or extracting the existing branch/remote validation approach from `trunk-sync.ts` rather than duplicating unsafe assumptions.
  - On rebase conflicts, gather conflict files/diff and call the existing `MergeResolver`. If the resolver succeeds, continue the interrupted rebase; if it fails or conflicts remain, abort the rebase and fail landing.
  - Bound repeated conflict-resolution/rebase-continue attempts so multi-commit rebases or repeated base advances cannot loop forever.

- `packages/engine/src/orchestrator/phases.ts`
  - Add a direct PR base-sync phase after all plans are merged and before post-merge validation for non-stacked `landing.action: pr` builds.
  - Add a bounded final freshness retry path for direct PR builds: if the base advances after validation, resync/rebase, rerun validation/PRD validation as needed, update artifact/landing metadata consistently, and retry PR creation within the retry budget.
  - Keep stacked PR behavior delegated to `stackLanding()`/git-spice; do not run the direct PR rebase path when `ctx.stackContext` is present.
  - Preserve existing validation failure semantics: command validation failures still use `validationFixer`; PRD/acceptance validation failures still fail through the current gates; direct PR base-sync failures should surface as landing/finalization failures rather than silent success.

- `packages/engine/src/landing.ts`
  - Add the final pre-PR freshness guard immediately before the `worktreeManager.issuePr()`/`gh pr create` path, or accept a pre-validated guard result from orchestration only if the check remains immediately before PR creation.
  - Preserve current cleanup, provenance, existing-PR detection/editing, and auto-merge behavior.
  - Ensure `landing:complete` is emitted only after the PR is opened/found against a branch that passed the final freshness guard.

- `packages/engine/src/worktree-manager.ts`
  - Thread any new direct PR sync/freshness helper through the manager if implementation keeps git operations encapsulated there.
  - Preserve existing `issuePr()` behavior for already-existing PR metadata repair and auto-merge call sites.

- `packages/engine/src/trunk-sync.ts`
  - Potentially extract shared safe remote/branch validation helpers if the direct PR sync helper needs them.
  - Avoid broad changes to pre-compile trunk-sync semantics.

- Tests
  - Prefer a new focused test file for direct PR base sync/freshness rather than growing already-oversized `test/landing-actions.test.ts` unless only small bounded edits are needed.
  - Extend direct PR tests with real temporary git repositories and fake `gh` shims, following the existing pattern in `test/landing-actions.test.ts`.
  - Cover trunk direct PR and non-trunk direct feature PR bases.
  - Cover conflict resolver invocation on rebase conflicts using a stub `MergeResolver` that edits/stages conflicted files.
  - Cover final pre-PR base advancement causing validation to run again before `gh pr create`.
  - Cover bounded retry exhaustion producing `landing:skipped` and no `gh pr create` call.

Documentation targets:

- `docs/config.md`
  - Update direct `landing.action: pr` behavior to state that non-stacked direct PR builds fetch/rebase onto the latest remote PR base before validation and run a final pre-PR freshness guard.
  - Clarify the relationship to `build.trunkSync`: trunk sync selects the initial compile base; direct PR base sync is a later mutating rebase/freshness gate for PR publication.

- `README.md` if the high-level landing/provenance description needs a short note that direct PR landing now synchronizes with the latest remote base before opening the PR.

Risks and constraints:

- Orchestration risk: direct PR freshness is cross-phase. The first sync must happen before validation, while the final guard must happen immediately before PR creation and may require revalidation. A landing-only fix would not satisfy the requirement.
- Validation risk: after a final pre-PR base advance, both command validation and PRD/acceptance validation may need to rerun because the diff and behavior relative to the base changed.
- Conflict recovery risk: `MergeResolver` currently emits merge-oriented event names (`plan:merge:resolve:*`). Reusing it for rebase conflicts is acceptable, but tests should assert behavior rather than require new event variants unless implementation intentionally updates the wire schema.
- Rebase continuation risk: a multi-commit rebase can surface more than one conflict. The implementation needs bounded attempts and should run `git rebase --abort` on unrecoverable failure.
- Remote/base ambiguity risk: current direct PR push uses `origin`, while `build.trunkSync.remote` is the only remote config field. The implementation should either use the same `origin` assumption as direct PR push or intentionally document/configure a landing remote.
- Existing PR risk: direct PR landing can return an existing PR URL after `gh pr create` fails. The freshness guard should still run before deciding that an existing PR is acceptable, otherwise stale branches can remain published.
- Cleanup/provenance risk: PR cleanup currently happens after validation and before PR creation. If a final guard triggers a rebase/revalidation after cleanup, artifact record commit SHAs and PR metadata must remain consistent.
- Stack interaction risk: stacked PR landing already has restack/recovery behavior. The direct PR sync path must not duplicate or interfere with git-spice stacked PR workflows.
- File-size risk: `packages/engine/src/orchestrator/phases.ts`, `packages/engine/src/worktree-ops.ts`, and `test/landing-actions.test.ts` are oversized or near the project maintainability thresholds. Prefer new focused helper/test files and bounded exact edits to legacy files.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Direct PR landing currently publishes without fetching or rebasing the PR base. | Re-read `packages/engine/src/landing.ts`, `packages/engine/src/worktree-manager.ts`, and `packages/engine/src/worktree-ops.ts`; the path is cleanup/provenance → `pushFeatureBranchOp()` → `createPullRequestOp()` with no fetch/rebase. | high | low | Add regression test that advances remote base before PR creation and observes stale behavior/fix. | The planned fix would target the wrong path. |
| The first base sync must happen before post-merge command validation to satisfy the requirement. | Current `validate()` runs before `finalize()`; PR publication happens in `finalize()`. User explicitly requested rebase before validation/PR creation. | high | low | Add test that records validation command execution after the feature branch contains the advanced remote-base commit. | Validation could still certify an outdated base. |
| The final freshness guard must be close to `gh pr create`, not only before validation. | User explicitly requested fetching the base again immediately before `gh pr create`; current cleanup/provenance/PR publication happens after validation. | high | low | Add fake-`gh` test that advances remote base after validation and before PR creation. | Eforge could still open stale PRs when the base advances late. |
| Retrying after final guard requires rerunning post-merge command validation. | User requested retrying the base-sync/rebase + validation path when possible; `validate()` is the command gate that certifies merged code. | high | low | Test final guard advancement with a validation command that increments a counter and assert it runs twice before PR creation. | Retried PR branch could be published without validation on the new base. |
| Retrying after final guard should rerun PRD/acceptance validation when available. | PRD validation compares implementation diff/evidence against the base; a rebase onto new base can change the diff and acceptance evidence. | medium | low | Unit/integration test with a stub `prdValidator` counting invocations during a final-guard retry. | Acceptance evidence could refer to the stale diff/base. |
| The existing `MergeResolver` can be reused for direct PR rebase conflicts. | `MergeResolver` accepts cwd plus `MergeConflictInfo` with branch/base/conflicted files/diff, and `runMergeConflictResolver()` edits/stages conflicted files without relying on squash-merge-specific state. Stacked landing recovery already reuses `MergeResolver` for rebase/restack conflicts. | high | low | Add rebase-conflict test with a stub resolver and verify `git rebase --continue` succeeds. | Implementation might need a new resolver interface or event variants. |
| Direct PR base fetch should use `origin` unless a documented landing remote is added. | Current `issuePr()` calls `pushFeatureBranchOp()` without a remote override, and `pushFeatureBranch()` defaults to `origin`. No `landing.remote` config exists in `packages/engine/src/config.ts`. | medium | low | During implementation, either keep `origin` consistent with push or add a documented config/schema update with tests. | Fetching a different remote than push/PR head could produce surprising behavior. |
| The new direct PR path should not run for stacked PR builds. | `stackLanding()` already delegates `landing.action: pr` stacked builds to git-spice and has restack/conflict recovery logic. `finalize()` skips duplicate PR publication when stacked PR landing completed. | high | low | Add test with `ctx.stackContext` or stack landing helper spy ensuring direct sync helper is not called. | Stacked workflows could be double-rebased or double-submitted. |
| Existing PR detection should still happen after freshness checks. | `WorktreeManager.issuePr()` currently treats existing PR detection as a fallback after `gh pr create` fails and applies metadata edits. | high | low | Existing PR regression test plus new final-guard pass case. | Existing PR workflows could regress or accept stale artifact branches. |
| No new daemon/client wire event variant is required. | Existing `planning:progress`, `config:warning`, `validation:*`, `plan:merge:resolve:*`, `landing:skipped`, and `landing:complete` events can describe the new flow. | medium | low | Verify implementation does not introduce new event discriminants; if it does, update `@eforge-build/client` schemas and `DAEMON_API_VERSION`. | Event/schema drift could break client validation. |
| `test/landing-actions.test.ts` should not absorb a large new scenario suite. | `wc -l` shows `test/landing-actions.test.ts` is 1,324 lines, above the project new-test threshold and a legacy oversized file. | high | low | Prefer a new focused test file or bounded exact edits. Run `pnpm maintainability:check`. | The implementation could violate maintainability policy. |

## Scope

In scope:

- Direct non-stacked `landing.action: pr` builds.
- Fetching the configured direct PR remote base before post-merge command validation starts.
- Rebasing the eforge feature branch onto the fetched remote base before post-merge command validation starts when the fetched base is not already an ancestor of the feature branch.
- Running post-merge command validation and PRD validation after the feature branch has been synchronized to the fetched remote base.
- Invoking the existing `MergeResolver` when direct PR rebase conflicts occur.
- Continuing interrupted rebases after successful conflict resolution.
- Aborting interrupted rebases after failed conflict resolution.
- Emitting `landing:skipped` when direct PR base-sync or freshness failure prevents safe PR creation.
- Running a final pre-PR freshness guard immediately before `gh pr create`.
- Retrying base sync, post-merge command validation, and PRD validation when the final pre-PR fetch detects that the base advanced after validation.
- Preserving existing PR detection and metadata editing after the final pre-PR freshness guard passes.
- Preserving PR auto-merge behavior after a PR is created or found against a fresh base.
- Validating direct PR base branch and remote arguments before running `git fetch`.
- Handling unavailable direct PR remote bases with `landing:skipped` and a reason that includes the base branch name.
- Using bounded retry counts for final freshness retries.
- Using bounded retry counts for repeated rebase conflict-resolution attempts.
- Updating `docs/config.md`.
- Updating `README.md` if the high-level landing/provenance description needs a short note.
- Adding regression tests for trunk direct PR builds, non-trunk direct feature PR bases, conflict resolution success, conflict resolution failure, final pre-PR base advancement, retry exhaustion, existing PR detection, and stacked PR exclusion.

Out of scope:

- Running the new direct PR rebase path for stacked `landing.action: pr` builds.
- Running the new direct PR rebase path for `landing.action: merge` builds.
- Running the new direct PR rebase path for `landing.action: leave` builds.
- Duplicating or interfering with git-spice stacked PR workflows.
- Broad changes to pre-compile trunk-sync semantics.
- Growing already-oversized files when a new focused helper or test file can be used.
- Introducing new daemon/client wire event variants unless the implementation intentionally updates `@eforge-build/client` schemas and `DAEMON_API_VERSION`.

## Acceptance Criteria

- A non-stacked `landing.action: pr` build fetches the configured direct PR remote base before post-merge command validation starts.
- A non-stacked `landing.action: pr` build rebases the eforge feature branch onto the fetched remote base before post-merge command validation starts when the fetched base is not already an ancestor of the feature branch.
- A non-stacked `landing.action: pr` build runs post-merge command validation after the feature branch has been synchronized to the fetched remote base.
- A non-stacked `landing.action: pr` build runs PRD validation after the feature branch has been synchronized to the fetched remote base.
- A non-stacked `landing.action: pr` build invokes the existing `MergeResolver` when the pre-validation rebase reports conflicted files.
- A non-stacked `landing.action: pr` build continues the interrupted rebase after `MergeResolver` resolves and stages all conflicted files.
- A non-stacked `landing.action: pr` build aborts the interrupted rebase when `MergeResolver` returns `false`.
- A non-stacked `landing.action: pr` build emits `landing:skipped` when pre-validation rebase conflict resolution fails.
- A non-stacked `landing.action: pr` build does not call `gh pr create` when pre-validation rebase conflict resolution fails.
- A non-stacked `landing.action: pr` build fetches the direct PR remote base again immediately before calling `gh pr create`.
- A non-stacked `landing.action: pr` build calls `gh pr create` only when the final pre-PR fetch resolves the same base SHA that was validated.
- A non-stacked `landing.action: pr` build retries base sync and post-merge command validation when the final pre-PR fetch detects that the base advanced after validation.
- A non-stacked `landing.action: pr` build retries PRD validation when the final pre-PR fetch detects that the base advanced after validation.
- A non-stacked `landing.action: pr` build calls `gh pr create` after a successful retry when the base remains fresh after the retry validation.
- A non-stacked `landing.action: pr` build emits `landing:skipped` when the final pre-PR freshness retry budget is exhausted.
- A non-stacked `landing.action: pr` build does not call `gh pr create` after the final pre-PR freshness retry budget is exhausted.
- A non-stacked `landing.action: pr` build preserves existing PR detection and metadata editing after the final pre-PR freshness guard passes.
- A non-stacked `landing.action: pr` build preserves PR auto-merge behavior after a PR is created or found against a fresh base.
- A stacked `landing.action: pr` build continues to use the git-spice stacked landing path and does not run the new direct PR rebase path.
- A `landing.action: merge` build does not run the new direct PR rebase path.
- A `landing.action: leave` build does not run the new direct PR rebase path.
- Direct PR base branch and remote arguments are validated before running `git fetch`.
- An invalid direct PR base branch causes the build to fail before `git fetch` runs.
- An unavailable direct PR remote base causes `landing:skipped` with a reason that includes the base branch name.
- The implementation uses bounded retry counts for final freshness retries.
- The implementation uses bounded retry counts for repeated rebase conflict-resolution attempts.
- `docs/config.md` documents that direct non-stacked `landing.action: pr` builds fetch/rebase onto the latest remote PR base before validation and run a final pre-PR freshness guard.
- `docs/config.md` documents that `build.trunkSync` selects the initial compile base and direct PR base sync is a later mutating PR-publication freshness gate.
- Regression tests cover a trunk direct PR build rebasing onto an advanced `origin/main` before validation.
- Regression tests cover a non-trunk direct PR build rebasing onto an advanced `origin/feature/parent` before validation.
- Regression tests cover `MergeResolver` resolving a direct PR rebase conflict and `gh pr create` running after the resolved rebase.
- Regression tests cover `MergeResolver` failing a direct PR rebase conflict and `gh pr create` not running.
- Regression tests cover the final pre-PR guard detecting a base advance after validation and rerunning validation before `gh pr create`.
- Regression tests cover final pre-PR freshness retry exhaustion and assert that `gh pr create` is not called.
- Regression tests cover that existing PR detection still returns the existing PR URL after the final pre-PR freshness guard passes.
- Regression tests cover that stacked PR landing does not execute the direct PR base-sync helper.
- The targeted direct PR landing/base-sync regression test exits 0.
- `pnpm vitest run test/landing-actions.test.ts` exits 0 if that file is modified.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm test` exits 0.
