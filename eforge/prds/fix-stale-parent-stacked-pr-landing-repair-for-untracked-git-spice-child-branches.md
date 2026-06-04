---
title: Fix stale-parent stacked PR landing repair for untracked git-spice child branches
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Fix stale-parent stacked PR landing repair for untracked git-spice child branches

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-04-fix-stale-parent-stacked-pr-landing-repair-for-untracked-git.md`.

This aligns with the roadmap's Optional Stacked PR Expansion goal, specifically stack workflow polish and recovery affordances for `stacking.enabled: true` plus `landing.action: pr` workflows backed by git-spice. It also supports Kernel Resilience and Typed Recovery by making landing failure behavior more fail-closed and recoverable.

Classification: this is a **bugfix / deep** plan. The code change is likely contained to stack landing preflight/orchestration and tests, but the affected path is build publication/landing and needs strong regression coverage.

Recommended profile: **Excursion**.

Rationale: this is a cohesive bugfix in one subsystem (`packages/engine/src/stacking/*`) with targeted regression tests. It is not an Errand because it changes landing orchestration and provider command ordering for a high-impact publication path. It is not an Expedition because a single planner can fully enumerate the implementation targets, risks, and tests; no delegated module planning is needed.

A stacked child build can complete implementation and validation, then fail during PR landing when its parent PR has already merged and the parent artifact branch has been deleted by GitHub branch auto-delete.

Observed symptom:

- `remove-legacy-monitor-ui-package` and `complete-queue-rollback-failure-finalization-for-failed-resumed-builds` both failed at the synthetic `landing` plan.
- Both depended on `build-extension-platform-foundation-for-kernel-boundary-extraction`; after PR #128 merged, GitHub deleted the parent head branch.
- Their terminal error was `git-spice command failed: git-spice branch onto main --branch <child> ... FTL git-spice: branch not tracked: <child>`.
- The parent build `build-extension-platform-foundation-for-kernel-boundary-extraction` had completed and opened PR #128, which was merged to trunk; the parent remote branch was no longer present.

Why it matters:

- This turns a valid completed build into a failed queue item even though the parent integration proof succeeded.
- It makes GitHub's normal auto-delete-merged-branches setting unsafe for eforge stacked PR recovery.
- It leaves users to manually rebase and open direct PRs for child builds that eforge should be able to land automatically.

Evidence:

- The backlog item records the two observed landing-only failures and monitor event sequence.
- Recovery sidecars from the observed builds showed completed implementation plans and landing failure.
- `packages/engine/src/stacking/landing-base.ts` currently runs `provider.retargetBranch(mergeWorktreePath, stackContext.branch, trunkBranch)` inside `preflightLandingBase()` when the parent remote branch is missing and the parent artifact commit is proven integrated into trunk.
- `packages/engine/src/stacking/landing.ts` currently calls `preflightLandingBase()` before it runs `provider.syncRepo(...)` and before it calls `provider.trackBranch(mergeWorktreePath, baseDecision.effectiveBaseBranch)`.
- `git-spice branch track --help` says a branch must be tracked to run git-spice operations on it.
- `git-spice branch onto --help` describes branch movement for tracked stack topology and accepts `--branch` for targeting another branch.
- Calling `branch onto` before tracking a manually-created eforge artifact branch can fail with `branch not tracked`.
- Existing tests in `test/stack-runtime-landing-metadata-preflight.test.ts` encode the failing missing-parent ordering as `retarget -> sync -> track -> restack -> submit` for an already-integrated deleted parent.
- The stub provider does not model git-spice's tracked-branch precondition.
- Existing implementation already uses `stackContext.trunkBranch ?? 'main'` in `preflightLandingBase()` and `baseDecision.effectiveBaseBranch` in landing; the fix must preserve configured trunk names such as `master` instead of introducing hard-coded `main`.

Confirmed reproduction steps:

1. Enable stacked PR landing with git-spice (`stacking.enabled: true`, `landing.action: pr`).
2. Queue a parent PRD and one or more child PRDs that depend on the parent and use the parent artifact branch as `stack_parent` / resolved stack base.
3. Let the parent build complete, submit a PR, and merge the parent PR to trunk.
4. Let GitHub delete the merged parent branch, or otherwise remove the parent remote branch.
5. Let a child build complete implementation and validation.
6. During child landing, eforge proves the missing parent artifact commit is integrated into trunk.
7. Current behavior calls `git-spice branch onto <resolved-trunk> --branch <child>` before tracking the child branch.
8. git-spice fails with `branch not tracked: <child>`, and eforge marks landing failed.

Confirmed root cause:

- `executeStackLanding()` in `packages/engine/src/stacking/landing.ts` runs `runBasePreflight()` immediately after emitting `stack:landing:update started`.
- `runBasePreflight()` calls `preflightLandingBase()` in `packages/engine/src/stacking/landing-base.ts`.
- `preflightLandingBase()` checks whether the effective base branch exists on the configured remote.
- For a child stack layer, when the parent artifact branch is missing remotely and the parent artifact commit is proven integrated into remote trunk, it creates a repaired decision with `effectiveBaseBranch: trunkBranch` and immediately calls `provider.retargetBranch(mergeWorktreePath, stackContext.branch, trunkBranch)`.
- `executeStackLanding()` only calls `provider.trackBranch(mergeWorktreePath, baseDecision.effectiveBaseBranch)` after the preflight returns successfully and after `provider.syncRepo(...)`.
- The git-spice adapter implements `retargetBranch()` as `git-spice branch onto <target> --branch <branch>`.
- The git-spice adapter implements `trackBranch()` as `git-spice branch track --base <base>`.
- git-spice requires a branch to be tracked before branch topology operations.
- The eforge child artifact branch is created by eforge/git, not by `git-spice branch create`, so it can be untracked when initial stale-parent repair runs.

Related latent behavior:

- The existing parent-disappears-during-landing test is different from the observed failure.
- In the parent-disappears-during-landing scenario, the child was first tracked against the parent base, then a later preflight performs `branch onto <trunk>` after tracking.
- The parent-disappears-during-landing ordering is valid and should be preserved.
- The initial missing-parent scenario is the failing path.
- In the initial missing-parent path, the child has not yet been tracked.
- The repair should not call `retargetBranch()` before tracking.
- The code already resolves trunk branch names through `stackContext.trunkBranch ?? 'main'` and `baseDecision.effectiveBaseBranch`; the fix must continue using these values so repositories using `master`, `develop`, or another configured trunk are supported.

## Goal

When the parent remote branch is missing but the parent artifact commit is proven integrated into the configured/resolved remote trunk, eforge should repair the child landing topology without requiring manual intervention.

The child should be tracked, restacked, and submitted against the configured/resolved trunk branch rather than a hard-coded `main`, and landing should continue to fail closed with existing manual repair guidance when the parent integration proof cannot be established.

## Approach

Recommended fix shape:

- Separate stale-parent effective-base decision-making from the provider retarget side effect.
- For the first preflight before tracking, allow `preflightLandingBase()` to return the repaired decision (`effectiveBaseBranch` set to the resolved trunk and `baseRepairReason: parent-artifact-already-integrated`) without calling `provider.retargetBranch()`.
- Let the existing landing sequence then run `provider.syncRepo(...)`, `provider.trackBranch(..., baseDecision.effectiveBaseBranch)`, and `provider.restackBranch()`.
- For an initially untracked child with a missing integrated parent, tracking against the resolved trunk followed by restack should establish the topology without pre-track `branch onto`.
- For later preflight checks after the branch has been tracked, keep branch-scoped retargeting available so a parent branch that disappears during landing can still be moved from the parent base to trunk with `provider.retargetBranch()` followed by another restack.
- A simple implementation option is to add a preflight option such as `allowRetarget: boolean` / `repairMode: 'decision-only' | 'retarget'`.
- Use decision-only mode for the initial pre-track preflight.
- Use retarget mode for post-track/final preflight inside the freshness loop.

Implementation targets:

- `packages/engine/src/stacking/landing-base.ts`
  - Change `preflightLandingBase()` so initial missing-parent repair can return a repaired base decision without invoking `provider.retargetBranch()`.
  - Preserve existing fail-closed proof behavior: missing parent branch repair is only allowed when `verifyParentIntegratedIntoRemoteTrunk()` proves the parent artifact commit is an ancestor of current remote trunk.
  - Preserve configured trunk handling by continuing to use `stackContext.trunkBranch ?? 'main'` and `stackContext.trunkRemote ?? 'origin'` as the fallback/resolved values; do not introduce literal `main` outside existing fallback semantics.

- `packages/engine/src/stacking/landing.ts`
  - Call the initial base preflight in decision-only mode before tracking.
  - Keep later/final base preflights in retarget-capable mode after the child has been tracked.
  - Ensure emitted `stack:provider:command` event ordering changes for initial missing integrated parent from `branch onto -> repo sync -> branch track -> branch restack -> branch submit` to `repo sync -> branch track --base <resolved-trunk> -> branch restack -> branch submit`.
  - Preserve the existing parent-disappears-during-landing behavior that emits `branch onto <resolved-trunk> --branch <child>` after a prior `branch track --base <parent>` event.

- `test/stack-runtime-landing-metadata-preflight.test.ts`
  - Update the existing `repairs a missing integrated parent base and reports effective trunk metadata` test to expect no pre-track `retargetBranch` call and no `branch onto` event.
  - Add or update a stub provider that fails if `retargetBranch()` is called before `trackBranch()` for the initial missing-parent scenario, so the regression would reproduce the observed `branch not tracked` class of failure.
  - Add non-main trunk coverage by setting the child stack context's `trunkBranch` and `effectiveBaseBranch` to a configured trunk such as `master` or `develop`, creating/fetching the corresponding remote trunk in the test repo, and asserting `trackBranch()` receives that branch name.
  - Keep the existing parent-disappears-during-landing test asserting retarget occurs after initial tracking.

- `test/stack-runtime-landing-helpers.ts` if needed
  - Extend `setupStackRepo()` or add a local helper to support non-main trunk branches for metadata-preflight tests.
  - Keep helper changes small and test-scoped.

- `docs/stacking.md` if needed
  - If implementation behavior changes documented command ordering, update wording from "retargets and restacks" to wording that covers "tracks/restacks against trunk" for initially missing integrated parents and "retargets" for already-tracked disappearing parents.

Documentation impact is likely minimal. Search found docs that describe stale-parent landing repair in `docs/stacking.md` and `docs/architecture.md`; most describe behavior at a high level rather than exact command order.

Risks and mitigations:

- `git-spice branch track --base <trunk>` followed by `git-spice branch restack` is expected to establish and rebase an initially untracked child onto trunk, but this exact runtime behavior has not been executed against a real git-spice repo during planning. Mitigation: add a regression test that models the tracked/untracked invariant, and if feasible during implementation, run a small local git-spice integration smoke test.
- Moving retarget side effects out of initial preflight could accidentally remove needed retarget behavior for branches already tracked against a parent that disappears mid-landing. Mitigation: keep the existing parent-disappears-during-landing test and assert `retarget` still occurs after `track`.
- Non-main trunk support can regress if tests only assert `main`. Mitigation: add a test using a configured/resolved trunk branch such as `master` or `develop` and assert provider calls use that branch name.
- Preflight currently combines proof and mutation. Refactoring it into decision-only versus retarget-capable modes may affect event ordering. Mitigation: update event-order expectations intentionally and preserve `stack:landing:update` metadata (`originalBaseBranch`, `effectiveBaseBranch`, `baseRepairReason`).
- If `git-spice branch track` fails when the child already contains the merged parent commits and the base is trunk, the selected implementation may need to fall back to a different sequence. Mitigation: this is recorded as a medium-confidence assumption with low-to-medium validation cost; implementation can validate with a real git-spice smoke test or adjust after failing tests.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The observed failures were landing-only failures caused by pre-track `git-spice branch onto`, not implementation defects. | Backlog records the failed build IDs, terminal landing messages, and monitor event ordering. Recovery sidecars from the observed builds showed completed implementation plans and landing failure. | high | low | Re-query monitor DB events for the two build IDs if more audit evidence is needed. | If wrong, this plan would fix a symptom but leave an implementation issue in the failed builds. |
| `git-spice branch onto <trunk> --branch <child>` requires the child branch to already be tracked. | `git-spice branch track --help` states a branch must be tracked to run git-spice operations. The observed stderr was `branch not tracked`. | high | low | Create a temporary git-spice repo and run `branch onto` on an untracked branch. | If wrong, the root cause would be elsewhere, but observed stderr and help text make this unlikely. |
| For an initially untracked child whose parent artifact is already integrated into trunk, `git-spice branch track --base <resolved-trunk>` followed by `git-spice branch restack` is the preferred repair sequence. | git-spice help says `branch track --base` explicitly tracks a branch against a base, and landing already restacks after tracking. Code inspection shows this avoids pre-track retarget. | medium | low-to-medium | During implementation, run a local git-spice smoke test or strengthen the stub provider to model track/restack topology semantics. | If wrong, implementation may need an alternative sequence, such as tracking against the old parent first then retargeting, or passing a branch argument to track if checkout assumptions fail. |
| Later parent-disappears-during-landing repair should continue to use `retargetBranch()` after the child has been tracked. | Existing test `repairs a parent base that disappears during landing and submits against trunk` models this valid order: sync, track parent, restack, retarget trunk, restack, submit. | high | low | Preserve and update the existing test so it fails if retarget is removed from post-track repair. | If wrong, eforge may regress a scenario that current tests cover and users may still need manual repair when a parent branch disappears mid-landing. |
| The fix can be branch-name agnostic using existing resolved trunk fields. | `preflightLandingBase()` already reads `stackContext.trunkBranch ?? 'main'`; `landing.ts` already tracks `baseDecision.effectiveBaseBranch`; stack base resolver tests cover configured trunk/remote for non-main values. | high | low | Add a runtime landing test with `trunkBranch: 'master'` or `develop` and assert provider calls use that value. | If wrong, repositories with trunk names other than `main` will still fail or submit against the wrong base. |
| Documentation changes are limited to stacking troubleshooting/docs if command ordering wording is now inaccurate. | Search found docs that describe stale-parent landing repair in `docs/stacking.md` and `docs/architecture.md`; most describe behavior at a high level rather than exact command order. | medium | low | Re-run `rg "retargets and restacks|stale-parent landing repair|parent branch" docs web/content web/public` after implementation. | If wrong, docs may continue to describe an inaccurate repair sequence. |

## Scope

In scope:

- Stack landing preflight/orchestration changes in `packages/engine/src/stacking/*`.
- Strong regression coverage for the high-impact build publication/landing path.
- Decision-only initial stale-parent preflight before tracking.
- Retarget-capable later/final preflights after tracking.
- Preservation of fail-closed parent integration proof behavior.
- Preservation of configured trunk and remote handling through existing resolved values.
- Updates to `test/stack-runtime-landing-metadata-preflight.test.ts`.
- Small, test-scoped helper changes in `test/stack-runtime-landing-helpers.ts` if needed.
- Documentation wording updates only if implementation behavior changes documented command ordering.

Out of scope:

- Broad Expedition-style delegated module planning.
- Replacing the existing git-spice provider abstraction.
- Making missing-parent repair succeed when the parent artifact commit is not proven to be an ancestor of the configured remote trunk.
- Introducing a hard-coded `main` outside existing fallback semantics.

## Acceptance Criteria

- In the initial missing-integrated-parent landing scenario, `executeStackLanding()` does not call `provider.retargetBranch()` before `provider.trackBranch()`.
- In the initial missing-integrated-parent landing scenario, emitted `stack:provider:command` events include `git-spice repo sync` before `git-spice branch track --base <resolved-trunk>`.
- In the initial missing-integrated-parent landing scenario, emitted `stack:provider:command` events include `git-spice branch track --base <resolved-trunk>` before `git-spice branch restack`.
- In the initial missing-integrated-parent landing scenario, emitted `stack:provider:command` events do not include `git-spice branch onto <resolved-trunk> --branch <child>` before the first `git-spice branch track` event.
- In the initial missing-integrated-parent landing scenario, `stack:landing:update` complete events include `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason: parent-artifact-already-integrated`.
- A regression test fails if a stub git-spice provider throws on pre-track `retargetBranch()` and the implementation calls `retargetBranch()` before tracking the child.
- A regression test proves the repaired initial missing-parent path uses a non-main resolved trunk branch such as `master` or `develop` in `trackBranch()` and landing metadata.
- The existing parent-disappears-during-landing scenario still emits `git-spice branch onto <resolved-trunk> --branch <child>` after a prior `git-spice branch track --base <parent>` event.
- The existing parent-disappears-during-landing scenario still emits a second `git-spice branch restack` after retargeting.
- Missing-parent repair still fails closed before submit when the parent artifact commit is not proven to be an ancestor of the configured remote trunk.
- `pnpm test -- stack-runtime-landing-metadata-preflight stack-runtime-landing-failures stack-base-resolver git-spice-provider` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- If implementation changes stale-parent repair wording, `pnpm docs:check` exits 0 after generated docs are refreshed.

## Manual Verification Notes

Cheap validation performed during planning:

- `git-spice branch track --help` confirms tracking is the operation that makes a branch available to git-spice branch operations.
- `git-spice branch onto --help` confirms `branch onto` is a stack branch movement operation and accepts `--branch` for targeting another branch.
- Existing test `test/stack-runtime-landing-metadata-preflight.test.ts` already models both initial missing-parent repair and parent-disappears-during-landing repair scenarios.
- The initial missing-parent test currently expects the broken `retarget` before `track` ordering.

Further validation paths:

- Re-query monitor DB events for the two build IDs if more audit evidence is needed.
- Create a temporary git-spice repo and run `branch onto` on an untracked branch.
- During implementation, run a local git-spice smoke test or strengthen the stub provider to model track/restack topology semantics.
- Preserve and update the existing parent-disappears-during-landing test so it fails if retarget is removed from post-track repair.
- Add a runtime landing test with `trunkBranch: 'master'` or `develop` and assert provider calls use that value.
- Re-run `rg "retargets and restacks|stale-parent landing repair|parent branch" docs web/content web/public` after implementation if documentation wording may be stale.