---
title: Restack git-spice branches before stacked PR submit
created: 2026-05-26
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Restack git-spice branches before stacked PR submit

## Problem / Motivation

Evidence from the failed build `stack-sync-daemon-cli-surface-and-integration-parity` shows implementation and validation completed successfully before landing failed.

The monitor database recorded:

- All three plans as completed and merged.
- Final validation commands exiting 0:
  - `pnpm install`
  - `pnpm build`
  - `pnpm type-check`
  - `pnpm test`
  - `pnpm docs:check`
- PRD validation passing at 100% with no gaps.

The terminal failure was in stacked PR landing, not implementation or validation.

The failing landing sequence was:

1. `git-spice branch track --base main` exited 0.
2. eforge cleanup ran and committed cleanup artifacts.
3. `git-spice branch submit --fill --no-web --no-prompt` exited 1 with `ERR Branch ... needs to be restacked` and suggested `git-spice branch restack --branch=eforge/stack-sync-daemon-cli-surface-and-integration-parity`.

Manual recovery succeeded by running:

```bash
git-spice branch restack --branch=eforge/stack-sync-daemon-cli-surface-and-integration-parity
git-spice branch submit --fill --no-web --no-prompt
```

This created PR #45.

Stacked PR landing can fail after a successful build because eforge submits the git-spice branch without first restacking the final artifact branch. In the observed failed run, all implementation, validation, and PRD acceptance checks passed, but `git-spice branch submit --fill --no-web --no-prompt` failed with `ERR Branch ... needs to be restacked`.

Affected users are developers using `stacking.enabled: true` with `landing.action: pr` through the git-spice provider.

Non-stacked PR workflows, direct merge workflows, and leave workflows are not affected because `stackLanding(ctx)` exits when no stack context/provider exists and only delegates to `executeStackLanding` for stacked PR landing.

Classification: this is a bugfix / focused change. The defect is localized to the stacked PR landing path and should not affect non-stacked PR, direct merge, or leave workflows.

## Goal

Make stacked PR landing robust by restacking the current artifact branch immediately before submit.

The proper fix is to make stacked PR landing restack the current artifact branch after eforge's final cleanup commit and before `git-spice branch submit`, then preserve the existing failure and persistence semantics if restack or submit fails.

## Approach

Code evidence:

- `packages/engine/src/stacking/landing.ts` currently performs stacked PR landing in this order: emit started, call `provider.trackBranch`, optionally run cleanup, call `provider.submitBranch`, discover PR URL, persist complete state, then handle PR auto-merge.
- `packages/engine/src/stacking/provider.ts` already exposes `restackBranch(cwd)` and `restackStack(cwd)` on `StackProviderAdapter`.
- `packages/engine/src/stacking/git-spice.ts` implements `restackBranch` as `git-spice branch restack` in the current branch worktree.
- `test/stack-runtime-landing.test.ts` and `test/stack-landing-cleanup.test.ts` already use stub stack providers with `restackBranch`, but existing landing tests assert only the current `trackBranch → submitBranch` provider command sequence.
- `docs/roadmap.md` has a broader future item for automated post-merge restack/sync. This bugfix is narrower: make the already-attempted stacked PR landing robust by restacking the current artifact branch immediately before submit.

Confirmed root cause: `executeStackLanding` does not call the existing provider restack operation before submitting the branch.

Root-cause evidence:

- `packages/engine/src/stacking/landing.ts` currently calls `provider.trackBranch(mergeWorktreePath, resolvedBase)`, then optionally `runCleanup(...)`, then `provider.submitBranch(mergeWorktreePath)`.
- The code comment for cleanup explicitly says cleanup runs before `provider.submitBranch`; cleanup can create a new commit after branch tracking.
- `packages/engine/src/stacking/provider.ts` already includes `restackBranch(cwd)` as a provider operation.
- `packages/engine/src/stacking/git-spice.ts` implements `restackBranch(cwd)` as `git-spice branch restack` in the current branch worktree.
- The failing git-spice error message directly identified the missing operation: `git-spice branch restack --branch=<branch>`.
- Manual recovery by running branch restack followed by branch submit succeeded and created PR #45.

Design decisions:

- Add a pre-submit restack step in `executeStackLanding` after optional cleanup and before `submitBranch`.
- Use `provider.restackBranch(mergeWorktreePath)` rather than `performStackSync` or `restackStack`, because landing is operating on one artifact branch checked out in the merge worktree and should not globally mutate unrelated stack branches during a single build's landing.
- Emit `stack:provider:command` for the restack invocation using the same helper used for track and submit so monitor/session logs preserve the complete provider command sequence.
- If `restackBranch` throws, emit a failed provider command event when possible, persist stack layer landing as failed, emit `stack:landing:update` with `status: 'failed'`, and do not call `submitBranch`.
- Preserve existing non-PR behavior: `merge` and `leave` landing actions still skip provider calls, and non-stacked builds still no-op in `stackLanding(ctx)`.

Optional hardening if implementation scope allows:

- If `submitBranch` still fails with a git-spice `needs to be restacked` message after the pre-submit restack, perform at most one additional `restackBranch` and one retry of `submitBranch`.
- The optional retry should be narrowly gated by the error text/typed `GitSpiceCommandError`.
- The optional retry should be covered by tests to avoid retrying unrelated submit failures.

Evidence-backed reproduction:

1. Configure/run eforge in stacked PR mode with git-spice as the stack provider and PR landing enabled.
2. Let a build complete implementation and validation successfully.
3. During stacked PR landing, observe eforge calling `git-spice branch track --base main` successfully.
4. Observe eforge running cleanup after tracking, creating a final cleanup commit on the artifact branch.
5. Observe eforge calling `git-spice branch submit --fill --no-web --no-prompt` without an intervening branch restack.
6. Actual result: git-spice exits 1 with `ERR Branch ... needs to be restacked` and suggests `git-spice branch restack --branch=<branch>`.
7. Expected result: eforge restacks the final branch state before submit, so `git-spice branch submit --fill --no-web --no-prompt` can create or update the PR without manual intervention.

Cheap static reproduction path for tests:

1. Use the existing `executeStackLanding` stub-provider tests.
2. Configure `shouldCleanup: true` so cleanup occurs between tracking and submission.
3. Record provider method call order.
4. Assert the order is `trackBranch → cleanup → restackBranch → submitBranch` for PR landing.
5. Add a failure test where `restackBranch` throws and assert `submitBranch` is not called and landing state is marked failed.

Runtime-dependent reproduction with real git-spice is not required for the fix because the monitor database already captured the real git-spice failure and the provider adapter exposes the exact branch restack operation needed.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| Branch-specific restack is the right operation for single-artifact stacked PR landing. | `StackProviderAdapter` exposes `restackBranch(cwd)`, `GitSpiceAdapter.restackBranch` runs `git-spice branch restack`, and manual recovery succeeded with branch restack followed by branch submit. | high | low | Stub tests can assert `restackBranch` is invoked in the merge worktree before submit. A manual end-to-end stacked PR build can validate against real git-spice. | If wrong, landing may still fail or may require stack-wide restack; fallback would be to use `restackStack` or a targeted git-spice CLI argument. |
| Restacking after cleanup is safer than restacking before cleanup. | The observed failed sequence had cleanup after tracking and before submit; cleanup can create a final commit, so restacking must account for the final branch tip. | high | low | Add an ordering test with `shouldCleanup: true` asserting cleanup events precede restack and submit follows restack. | If wrong, git-spice may still consider the branch outdated after cleanup and submit can fail. |
| Adding restack only in `executeStackLanding` will not affect non-stacked workflows. | `stackLanding(ctx)` returns when `stackContext` or `stackProvider` is missing, and `executeStackLanding` skips provider calls for non-PR actions. Existing tests cover non-stacked no-op and non-PR skip behavior. | high | low | Keep/extend tests asserting no provider calls for non-stacked and no restack call for `merge`/`leave` actions. | If wrong, non-stacked users could unexpectedly run git-spice commands. |
| Failing restack should fail landing rather than falling through to submit. | The landing helper already fails closed for `trackBranch` and `submitBranch` provider failures, persists failed state, and emits failed landing updates. Restack is another required provider step in the same sequence. | high | low | Add tests where `restackBranch` throws generic and provider-command errors. | If wrong, eforge could attempt submit from a known invalid branch state and produce confusing failures. |
| The proper fix does not require changing the manual `eforge stack sync` daemon/CLI surface. | Static inspection shows manual sync is implemented through `performStackSync`, while the defect is in stacked PR landing's direct `track → cleanup → submit` path. | high | medium | Run a full build in stacked PR mode after implementation. | If wrong, the manual sync route may need integration into landing or additional docs updates. |

No low-confidence/high-impact assumptions remain.

The runtime end-to-end validation with real git-spice is useful but not required before planning because the failing monitor evidence and successful manual recovery already validate the missing operation.

Recommended profile: Excursion.

Rationale: this is a focused engine bugfix touching the stacked PR landing helper and existing stack landing tests. It is not an errand because the provider command ordering, cleanup interaction, landing persistence, and failure semantics need coordinated changes. It is not an expedition because one cohesive plan can fully specify the affected modules and tests without delegated module planning.

## Scope

In scope:

- Update `executeStackLanding` in `packages/engine/src/stacking/landing.ts`.
- Add a pre-submit `provider.restackBranch(mergeWorktreePath)` step after optional cleanup and before `provider.submitBranch(mergeWorktreePath)`.
- Emit `stack:provider:command` events for the branch restack operation.
- Preserve existing PR URL discovery, landing persistence, and PR auto-merge behavior after a successful restack and submit.
- Preserve existing failure semantics when restack fails.
- Preserve existing failure semantics when submit fails.
- Update `test/stack-runtime-landing.test.ts`.
- Update `test/stack-landing-cleanup.test.ts`.
- Use existing `restackBranch(cwd)` on `StackProviderAdapter`.
- Use existing `GitSpiceAdapter.restackBranch(cwd)` behavior, which runs `git-spice branch restack` in the current branch worktree.
- Validate with targeted Vitest tests and `pnpm type-check`.

Out of scope:

- Changing non-stacked PR workflows.
- Changing direct merge workflows.
- Changing leave workflows.
- Changing non-PR stack landing actions to call provider restack.
- Instantiating or calling git-spice for non-stacked builds.
- Implementing the broader `docs/roadmap.md` future item for automated post-merge restack/sync.
- Requiring runtime-dependent reproduction with real git-spice before fixing this defect.
- Changing the manual `eforge stack sync` daemon/CLI surface.

Optional in scope if implementation scope allows:

- Retry `submitBranch` at most once after one additional `restackBranch` when submit still fails with a git-spice `needs to be restacked` message after the pre-submit restack.
- Gate the optional retry narrowly by the error text/typed `GitSpiceCommandError`.
- Add tests for the optional retry to avoid retrying unrelated submit failures.

## Acceptance Criteria

- `executeStackLanding` calls `provider.restackBranch(mergeWorktreePath)` after optional cleanup completes and before `provider.submitBranch(mergeWorktreePath)` for stacked PR landing.
- `executeStackLanding` emits a `stack:provider:command` event for the successful pre-submit branch restack.
- The PR landing provider command event order is `branch track`, `branch restack`, `branch submit` when cleanup is disabled.
- The PR landing provider command event order is `branch track`, cleanup progress events, `branch restack`, `branch submit` when cleanup is enabled.
- `executeStackLanding` marks stack landing failed when `provider.restackBranch` throws.
- `executeStackLanding` does not call `provider.submitBranch` when `provider.restackBranch` throws.
- `executeStackLanding` emits a failing `stack:provider:command` event with the restack exit code when `provider.restackBranch` throws a provider command error.
- Non-PR stack landing actions do not call `provider.restackBranch`.
- Non-stacked builds do not instantiate or call git-spice because `stackLanding(ctx)` still no-ops when `stackContext` or `stackProvider` is missing.
- Existing PR URL discovery still runs after a successful restack and submit.
- Existing landing persistence still runs after a successful restack and submit.
- Existing PR auto-merge behavior still runs after a successful restack and submit.
- `test/stack-runtime-landing.test.ts` verifies successful restack ordering.
- `test/stack-runtime-landing.test.ts` verifies restack failure handling.
- `test/stack-runtime-landing.test.ts` verifies non-PR stack landing actions do not call `provider.restackBranch`.
- `test/stack-landing-cleanup.test.ts` verifies cleanup occurs before restack when cleanup is enabled.
- `test/stack-landing-cleanup.test.ts` verifies restack occurs before submit when cleanup is enabled.
- `pnpm exec vitest run test/stack-runtime-landing.test.ts test/stack-landing-cleanup.test.ts test/git-spice-provider.test.ts` exits 0.
- `pnpm type-check` exits 0.
