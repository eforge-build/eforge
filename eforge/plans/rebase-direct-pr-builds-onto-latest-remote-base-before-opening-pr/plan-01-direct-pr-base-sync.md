---
id: plan-01-direct-pr-base-sync
name: Direct PR Base Sync and Freshness Guard
branch: rebase-direct-pr-builds-onto-latest-remote-base-before-opening-pr/plan-01-direct-pr-base-sync
agents:
  builder:
    effort: high
    rationale: Cross-phase engine change spanning git rebase primitives,
      orchestrator validation loops, and landing behavior.
  tester:
    effort: high
    rationale: Requires real-git integration tests with remote advancement, rebase
      conflicts, and final freshness retry scenarios.
  reviewer:
    effort: high
    rationale: Subprocess git argument validation and fail-closed landing behavior
      need detailed review.
---

# Direct PR Base Sync and Freshness Guard

## Architecture Context

Direct non-stacked `landing.action: pr` builds currently publish through `executeLandingAction()` → `WorktreeManager.issuePr()` → `git push` + `gh pr create`. Validation runs earlier in `orchestrator.ts`, so the PR path has no mutating base synchronization before validation and no final remote-base check immediately before PR creation.

This plan adds a direct-PR-only freshness layer while leaving stacked PR landing delegated to git-spice. It must not introduce new daemon/client event variants; use existing `planning:progress`, validation events, merge-resolver events, and `landing:skipped`/`landing:complete`.

## Implementation

### Overview

Create a focused `direct-pr-base-sync` helper for fetching, validating, rebasing, conflict recovery, and final freshness checks. Wire it into orchestration in two places:

1. After all plans merge and before command validation starts.
2. Immediately before direct `gh pr create`, with a bounded retry loop that reruns base sync, command validation, PRD/acceptance validation, and artifact recording when the remote base advances after validation.

### Key Decisions

1. Use `origin` for direct PR base fetches to match the current direct PR publish path. Do not add a new config field.
2. Reuse/extract the safe remote and branch validation from `trunk-sync.ts`; invalid remote or branch input fails before `git fetch`.
3. Keep direct PR base sync out of stacked PR, `merge`, and `leave` landing paths.
4. Reuse the existing `MergeResolver` callback for rebase conflicts. The helper gathers conflicted files and conflict diff, calls the resolver, verifies no unmerged paths remain, then runs `git rebase --continue` with a bounded attempt count. On unrecoverable failure it runs `git rebase --abort`.
5. Add the final freshness check inside the `issuePr`/landing path immediately before `gh pr create`. Also run the same guard before the push to avoid publishing a stale branch when the base has already advanced; the pre-create guard remains the last gate before `gh pr create`.
6. Use `--force-with-lease` for direct PR artifact branch pushes after direct base sync is active, because rebasing intentionally rewrites the engine-owned artifact branch and retry attempts can replace a previously pushed stale tip.
7. Keep retry budgets hard-bounded: use a small exported/default constant for final freshness retries and a separate small constant for rebase conflict-resolution attempts. Tests assert the budget stops PR creation.

### Direct PR Base Sync Helper

Create `packages/engine/src/direct-pr-base-sync.ts` with:

- `DIRECT_PR_REMOTE = 'origin'`.
- `DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS = 3`.
- `DEFAULT_DIRECT_PR_FRESHNESS_RETRIES = 2`.
- Types for sync points and results, for example:
  - `DirectPrBaseSyncPoint` with `remote`, `baseBranch`, `baseSha`, `featureSha`, and `rebased`.
  - `DirectPrBaseSyncResult` with success/failure variants and a failure `reason`.
  - `DirectPrFreshnessCheckResult` with fresh, base-advanced, and failure variants.
- `syncDirectPrBase(options)`:
  - Check out `featureBranch` in the merge worktree.
  - Validate `remote` and `baseBranch` before `git fetch`.
  - Verify the remote is registered.
  - Fetch `remote baseBranch` with `--no-tags --no-recurse-submodules` and non-interactive git env.
  - Resolve `FETCH_HEAD` to the remote base SHA.
  - Return success without rebasing when fetched base SHA is already an ancestor of `HEAD`.
  - Run `git rebase <fetchedBaseSha>` when the fetched base is not an ancestor.
  - On conflicts, gather unmerged paths and `git diff`, call `MergeResolver`, verify no unmerged paths remain, and run `git rebase --continue` until rebase completion or attempt budget exhaustion.
  - Abort on resolver failure, remaining unmerged paths, failed continue without active conflicts, fetch failure, invalid branch/remote, or budget exhaustion.
- `checkDirectPrBaseFreshness(options)`:
  - Validate and fetch the same remote/base.
  - Compare the fetched base SHA to the `DirectPrBaseSyncPoint.baseSha` captured after the last successful validation.
  - Return `base-advanced` when the fetched SHA differs, with the validated and fetched SHAs in the result.
  - Fail closed when fetch or ref resolution fails.

### Orchestration Changes

Modify `packages/engine/src/orchestrator/phases.ts`:

- Extend `PhaseContext` with `directPrBaseSync?: DirectPrBaseSyncPoint`.
- Add `isDirectPrBaseSyncApplicable(ctx)` for `ctx.landingAction === 'pr' && ctx.stackContext === undefined`.
- Add `syncDirectPrBaseBeforeValidation(ctx)` as an async generator:
  - No-op when not applicable.
  - Run after all plans are merged.
  - On success, store `ctx.directPrBaseSync` and emit `planning:progress` with remote/base/SHA details.
  - On failure, emit `landing:skipped` with a reason containing `baseBranch`, set run status failed, and do not proceed to validation.
- Add a helper inside phases to run the validation cycle used by final freshness retries:
  - `validate(ctx)`.
  - `prdValidate(ctx)` when command validation passes.
  - If PRD gap closing was triggered in that cycle, rerun `validate(ctx)` and `prdValidate(ctx)` the same way the main orchestrator does.
- In `finalize(ctx)`, for non-stacked direct PR only, wrap the PR landing attempt in a bounded final freshness retry loop:
  - Pass a pre-PR guard into `executeLandingAction`/`WorktreeManager.issuePr` that calls `checkDirectPrBaseFreshness` using `ctx.directPrBaseSync`.
  - If the guard reports the base advanced, do not call `gh pr create` for that attempt.
  - If retry budget remains, run `syncDirectPrBaseBeforeValidation(ctx)`, rerun command validation and PRD/acceptance validation, rerun `recordArtifact(ctx)` when queued artifact metadata exists, then retry PR landing.
  - If the retry budget is exhausted, emit one terminal `landing:skipped` reason that includes the base branch and retry count, set state failed, and do not call `gh pr create`.
  - If sync or validation fails during a retry, preserve the existing failure events and do not call `gh pr create`.
- Preserve generic merge/leave and stacked PR finalize behavior.

Modify `packages/engine/src/orchestrator.ts`:

- Insert `syncDirectPrBaseBeforeValidation(ctx)` after `executePlans(ctx)` and before the first `validate(ctx)` call.
- Keep the existing gap-close revalidation sequence.

### Landing and Worktree Changes

Modify `packages/engine/src/landing.ts`:

- Add an optional PR freshness guard callback to `LandingActionOptions`.
- Extend `LandingResult` with an internal retryable freshness result, for example `freshnessRetry?: { reason: string; fetchedBaseSha?: string }`.
- For retryable base-advanced guard failures, yield a `planning:progress` event and return the retryable result without emitting terminal `landing:skipped`.
- For non-retryable guard failures, emit `landing:skipped` and return failed.
- Keep cleanup, provenance collection, metadata rendering, existing PR detection, PR metadata repair, and auto-merge behavior.

Modify `packages/engine/src/worktree-manager.ts` and `packages/engine/src/worktree-ops.ts`:

- Add push options for `forceWithLease` while keeping current default push behavior for call sites that do not request it.
- Add an optional `beforePushFreshnessGuard` and `beforeCreateFreshnessGuard` or equivalent to `issuePr()`.
- Call the pre-create guard immediately before `createPullRequestOp()` and before the existing-PR fallback path can accept a PR.
- Keep existing PR URL lookup and `gh pr edit` metadata repair after the freshness guard passes.

Modify `packages/engine/src/trunk-sync.ts`:

- Export `validateBranchName` if the direct helper reuses it.
- Avoid behavior changes to `prepareTrunkSyncBase()`.

### Documentation

Modify `docs/config.md`:

- In the `landing.action: pr` comments/section, state that direct non-stacked PR landing fetches and rebases the artifact branch onto the latest remote PR base before validation.
- State that a final pre-PR freshness guard fetches the base again immediately before PR creation, and a late base advance triggers bounded resync plus validation retry.
- Clarify that stacked PR landing remains delegated to git-spice restacking.
- In the `build.trunkSync` section, clarify that trunk sync selects the initial compile base and direct PR base sync is a later mutating rebase/freshness gate for PR publication.

Modify `README.md` with a short note in the landing/provenance or queue-and-merge area that direct PR landing validates and opens PRs against the latest fetched remote base.

## Scope

### In Scope

- Direct non-stacked `landing.action: pr` builds targeting trunk or non-trunk feature bases.
- Fetching and rebasing onto `origin/<baseBranch>` before command validation.
- Final pre-PR fetch guard immediately before `gh pr create`.
- Bounded resync plus command validation and PRD/acceptance validation retries.
- MergeResolver-based direct rebase conflict recovery.
- Fail-closed `landing:skipped` behavior for sync, conflict, fetch, and retry exhaustion failures.
- Existing PR fallback, PR metadata repair, and PR auto-merge after the final guard passes.
- Documentation updates in `docs/config.md` and `README.md`.
- New focused regression tests instead of growing `test/landing-actions.test.ts`.

### Out of Scope

- Stacked PR restacking changes.
- `landing.action: merge` or `landing.action: leave` base sync.
- New direct PR remote configuration.
- Daemon/client event schema additions.
- Broad changes to pre-compile `build.trunkSync` semantics.

## Files

### Create

- `packages/engine/src/direct-pr-base-sync.ts` — Direct PR base fetch, freshness compare, rebase, conflict recovery, and retry-budget primitives.
- `test/direct-pr-base-sync.test.ts` — Real-git regression tests for direct PR base sync, final guard retries, conflict recovery, existing PR fallback, and stacked exclusion.

### Modify

- `packages/engine/src/trunk-sync.ts` — Export reusable branch validation while preserving trunk-sync behavior.
- `packages/engine/src/worktree-ops.ts` — Add force-with-lease push option and any reusable conflict/fetch helpers needed by direct PR sync.
- `packages/engine/src/worktree-manager.ts` — Thread PR freshness guards and push options through `issuePr()`.
- `packages/engine/src/landing.ts` — Run final freshness guard in the PR landing path and return retryable base-advanced results to orchestration.
- `packages/engine/src/orchestrator.ts` — Insert the pre-validation direct PR base-sync phase.
- `packages/engine/src/orchestrator/phases.ts` — Add direct PR sync phase, sync-point state, final freshness retry loop, and validation-cycle reuse.
- `docs/config.md` — Document direct PR base sync and distinguish it from trunk sync.
- `README.md` — Add the high-level direct PR freshness note.

## Testing Guidance

In `test/direct-pr-base-sync.test.ts`, use temporary real git repositories with bare `origin` remotes and fake `gh` shims, following `test/landing-actions.test.ts` patterns. Keep the file under 1,200 lines.

Cover these scenarios:

1. Trunk direct PR: advance `origin/main`, run pre-validation sync, assert validation observes a file from the advanced base, and assert the feature branch contains the advanced remote SHA.
2. Non-trunk direct PR: target `origin/feature/parent`, advance that remote branch, run pre-validation sync, and assert validation observes the parent advance.
3. Rebase conflict success: create conflicting base/feature commits, use a stub `MergeResolver` that edits and stages the conflicted file, assert rebase completes and fake `gh pr create` is invoked after the final guard passes.
4. Rebase conflict failure: return `false` from the resolver, assert `landing:skipped`, assert `git rebase --abort` leaves no active rebase, and assert fake `gh pr create` has no log entry.
5. Final pre-PR guard retry: run initial sync and validation, advance remote base before finalize, assert finalize reruns command validation and PRD validation before fake `gh pr create`.
6. Final freshness retry exhaustion: advance remote before every final guard attempt, assert a terminal `landing:skipped` with retry count and assert fake `gh pr create` has no log entry.
7. Existing PR fallback: fake `gh pr create` failure plus `gh pr view` success after guard pass, assert returned URL and metadata edit invocation.
8. Auto-merge preservation: fake `gh pr merge --auto --merge` after guard pass, assert auto-merge events are emitted.
9. Stacked exclusion: create a `PhaseContext` with `stackContext`, call the pre-validation sync phase or orchestrator flow, and assert no direct fetch/rebase progress event and no direct sync failure.
10. Merge/leave exclusion: run applicability checks or phase tests for `landingAction: merge` and `landingAction: leave`, and assert no direct fetch/rebase progress event.
11. Invalid branch validation: use an invalid `baseBranch` and assert the sync result fails before any fetch log can be written.
12. Unavailable remote base: target a missing remote branch and assert `landing:skipped` reason includes the base branch name.

If `test/landing-actions.test.ts` receives any edits, keep them bounded and run its targeted vitest command.

## Verification

- [ ] `pnpm vitest run test/direct-pr-base-sync.test.ts` exits 0.
- [ ] `pnpm vitest run test/landing-actions.test.ts` exits 0 when that file changes.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] Fake `gh` logs in the new tests contain no `pr create` invocation for conflict-resolution failure and final retry exhaustion cases.
- [ ] New docs text in `docs/config.md` contains both phrases `direct PR base sync` and `build.trunkSync` in the section that distinguishes the two gates.
