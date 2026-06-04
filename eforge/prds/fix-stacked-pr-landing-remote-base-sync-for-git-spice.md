---
title: Fix stacked PR landing remote-base sync for git-spice
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Fix stacked PR landing remote-base sync for git-spice

## Problem / Motivation

Stacked `landing.action: pr` builds can submit PRs that are behind `origin/<baseBranch>` and therefore not mergeable in GitHub. The direct non-stacked PR path already fetches, rebases, and freshness-checks the remote base before opening the PR, but stacked landing delegates to git-spice without an equivalent landing-time remote-base sync or freshness proof.

This affects users running `stacking.enabled: true` with PR landing and makes auto-merge unreliable even when the build itself completed successfully. This bugfix aligns with the roadmap’s **Optional Stacked PR Expansion** goal, especially:

> Improve setup guidance, sync visibility, and recovery affordances for `stacking.enabled: true` plus `landing.action: pr` workflows backed by git-spice.

It also supports the kernel resilience goal by failing closed instead of producing stale or unmergeable PRs.

Evidence gathered:

- The previous direct-PR freshness backlog item is shipped: `backlog-2026-06-01-rebase-direct-pr-builds-onto-latest-remote-base-before-openi`.
- That backlog item added `packages/engine/src/direct-pr-base-sync.ts`, `syncDirectPrBaseBeforeValidation()` in `packages/engine/src/orchestrator/phases.ts`, and final freshness guards in the direct non-stacked PR path.
- `docs/architecture.md` explicitly says direct non-stacked PRs fetch, rebase, and freshness-check, while stacked PR landing remains delegated to git-spice and does not use direct PR base sync.
- The most recent observed run `7cfe884b-c4fd-4669-abb6-c1faeaaf8d0b` created PR `#123` through stacked landing.
- Monitor events for run `7cfe884b-c4fd-4669-abb6-c1faeaaf8d0b` show `git-spice branch track --base main`, `git-spice branch restack`, and `git-spice branch submit`.
- Monitor events for run `7cfe884b-c4fd-4669-abb6-c1faeaaf8d0b` show no `git-spice repo sync` and no direct PR base-sync event.
- `packages/engine/src/stacking/landing.ts` implements stacked landing by preflighting the base, calling `provider.trackBranch(...)`, optionally running cleanup, then calling `provider.restackBranch(...)` and `provider.submitBranch(...)`.
- `packages/engine/src/stacking/landing.ts` does not call `provider.syncRepo(...)` before restack or submit.
- `packages/engine/src/stacking/provider.ts` and `packages/engine/src/stacking/git-spice.ts` already expose `syncRepo(cwd)` for `git-spice repo sync`.
- `packages/engine/src/stacking/sync.ts` uses `syncRepo(cwd)` for manual stack sync.
- Existing stack landing tests in `test/stack-runtime-landing-pr.test.ts`, `test/stack-runtime-landing-failures.test.ts`, and related helpers assert the current provider-call sequence is track/restack/submit and will need targeted updates.

Observed reproduction:

1. Enable stacked PR landing with `stacking.enabled: true` and `landing.action: pr`.
2. Run an eforge build from a local branch or worktree whose local stack/base refs are stale relative to `origin/main`.
3. Let stacked landing submit the PR through git-spice.
4. Inspect the created GitHub PR.

Expected behavior:

- Before PR submission, eforge updates the stacked landing base from the remote and restacks/rebases the artifact branch so the PR head contains the current remote base tip.
- If eforge cannot prove that the PR head contains the current remote base tip, landing fails closed instead of submitting or reporting a successful stale PR.

Actual observed behavior:

- Run `7cfe884b-c4fd-4669-abb6-c1faeaaf8d0b` created PR `#123` through stacked landing.
- The recorded provider commands were `git-spice branch track --base main`, `git-spice branch restack`, and `git-spice branch submit`.
- No `git-spice repo sync` command or direct PR base-sync event was recorded before submit.
- The resulting PR was reported by the user as not mergeable because it was behind `origin/main`.

Root cause:

- Direct non-stacked PR landing is guarded by `syncDirectPrBaseBeforeValidation(ctx)` in `packages/engine/src/orchestrator/phases.ts`.
- `syncDirectPrBaseBeforeValidation(ctx)` calls `syncDirectPrBase(...)`.
- `syncDirectPrBase(...)` fetches `origin/<baseBranch>`, rebases the artifact branch before validation, and later uses freshness guards before push/PR creation.
- Stacked PR landing uses a different path: `stackLanding(ctx)` delegates to `executeStackLanding(...)` in `packages/engine/src/stacking/landing.ts`.
- `executeStackLanding(...)` currently performs base preflight/repair, then calls `provider.trackBranch(...)`, optional cleanup, `provider.restackBranch(...)`, and `provider.submitBranch(...)`.
- The stack provider already exposes `syncRepo(cwd)` for `git-spice repo sync`.
- The manual stack-sync path uses `syncRepo(cwd)`.
- Stacked landing does not call `syncRepo(cwd)`.
- Stacked landing restacks against whatever base/topology git-spice and local refs currently know about.
- If local base refs are stale, `branch restack` can produce a branch that is behind the latest remote base.
- If local base refs are stale, `branch submit` can open a PR that GitHub marks unmergeable.
- There is no stacked equivalent of the direct path’s final freshness proof immediately before PR creation.

## Goal

Stacked `landing.action: pr` builds should synchronize and prove freshness against the latest remote effective base before submitting PRs through git-spice. If eforge cannot prove that the PR head contains the current remote base tip, landing should fail closed and skip PR submission.

## Approach

Keep this inside the stack provider boundary:

- Use provider methods for git-spice commands.
- Use existing stack base-repair helpers for remote base proof.
- Add a landing-time stack base sync/freshness cycle in `packages/engine/src/stacking/landing.ts` before submit.
- Preserve existing restack conflict recovery behavior for recoverable `branch restack` conflicts.
- Preserve existing non-recoverable `branch restack` failure behavior.

Preferred sequence for `landingAction === 'pr'`:

1. Preflight the effective base.
2. Call `provider.syncRepo(mergeWorktreePath)`.
3. Call `provider.trackBranch(...)`.
4. Run cleanup once if configured.
5. Call `provider.restackBranch(...)`.
6. Fetch/prove that `origin/<effectiveBaseBranch>` is an ancestor of `HEAD`.
7. Retry sync/restack on bounded stale-base detection.
8. Call `provider.submitBranch(...)` only after freshness proof succeeds.

Failure behavior:

- On sync failure, emit existing `stack:provider:command` events when available.
- On restack failure, emit existing `stack:provider:command` events when available.
- On freshness-proof failure, emit existing `stack:provider:command` events when available.
- On sync, restack, or freshness-proof failure, persist `stack:landing:update` with `status: failed`.
- On sync, restack, or freshness-proof failure, do not call `submitBranch(...)`.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The observed non-mergeable PR was produced by stacked landing rather than the direct PR path. | Monitor DB events for run `7cfe884b-c4fd-4669-abb6-c1faeaaf8d0b` show `stack:landing:update` and git-spice provider commands for PR `#123`; direct PR base-sync events were absent. | high | low | Inspect the GitHub PR branch/base and the run event stream if more confirmation is needed. | If wrong, the fix would target the wrong landing path, but current evidence strongly identifies stacked landing. |
| Stale local base/topology refs are sufficient to explain a git-spice `branch restack` that leaves the PR behind `origin/main`. | Code inspection confirms no landing-time `repo sync` or remote-base freshness proof in `executeStackLanding(...)`; the user observed the PR behind `origin/main`. | medium | medium | Reproduce with a temporary repo or integration fixture where `origin/main` advances after local refs are stale, then run stacked landing. | If wrong, sync/freshness proof may prevent stale submissions but may not address all GitHub mergeability failures. |
| Calling `provider.syncRepo(mergeWorktreePath)` before branch restack is the correct provider-boundary way to refresh git-spice’s view of remote bases. | `StackProviderAdapter` already exposes `syncRepo`; `GitSpiceAdapter.syncRepo()` maps to `git-spice repo sync`; manual stack sync uses this command before stack restack. | medium | low | Add provider-order tests and, if needed, run a manual git-spice landing in a test repository. | If wrong, the post-restack freshness proof should still fail closed before submit, but the implementation may need explicit git fetch or a provider-specific fetch method. |
| A post-restack ancestor check of latest fetched `origin/<effectiveBaseBranch>` against `HEAD` is a valid freshness proof for mergeability with respect to being behind the base branch. | Direct PR freshness logic uses remote fetch and commit comparison; GitHub’s behind-base condition is addressed when the PR head contains the base tip. Existing stack base-repair helpers can fetch remote branch heads and test ancestry. | high | low | Add tests that advance a remote base and assert submit is skipped until HEAD contains the fetched base commit. | If wrong, eforge could still submit a PR that GitHub marks behind or fail closed unnecessarily. |
| `git-spice repo sync` during landing will not unexpectedly mutate unrelated active eforge build worktrees. | Existing manual sync code avoids global stack restack during active builds; this plan calls only repo sync from the active build’s merge worktree and keeps branch restack scoped to the current branch. This is partially inferred from git-spice semantics. | medium | medium | Review git-spice behavior or test with multiple artifact branches before broad rollout. | If wrong, landing could perturb unrelated stack branches; fallback is to replace repo sync with a narrower explicit remote fetch/freshness helper. |

Recommended profile: **Excursion**.

Rationale: this is a focused engine bugfix with clear target files and test seams, but it touches landing control flow, provider command ordering, retry/fail-closed behavior, and documentation. A single cohesive implementation plan should be sufficient; delegated module planning is not needed.

## Scope

In scope:

- Stacked PR landing with `stacking.enabled: true` and `landing.action: pr`.
- git-spice-backed stacked PR landing.
- `packages/engine/src/stacking/landing.ts`.
- Existing stack provider methods in `packages/engine/src/stacking/provider.ts`.
- Existing git-spice adapter behavior in `packages/engine/src/stacking/git-spice.ts`.
- Existing manual stack sync behavior in `packages/engine/src/stacking/sync.ts` as a reference for `syncRepo(cwd)`.
- Existing stack base-repair helpers for remote base proof.
- Provider-command event ordering for `git-spice repo sync`, `git-spice branch restack`, and `git-spice branch submit`.
- Landing-time freshness proof that `origin/<effectiveBaseBranch>` is an ancestor of `HEAD`.
- Bounded retry when the remote effective base advances after restack and before submit.
- Fail-closed behavior when sync, restack, or freshness proof fails.
- Persisting failed `stack:landing:update` events.
- Preserving recoverable `branch restack` conflict recovery.
- Preserving non-recoverable `branch restack` failure behavior.
- Targeted test updates in `test/stack-runtime-landing-pr.test.ts`, `test/stack-runtime-landing-failures.test.ts`, and related helpers.
- Documentation updates in `docs/architecture.md`.
- Documentation updates in `docs/stacking.md`.

Out of scope:

- Replacing stacked landing’s git-spice delegation with the direct non-stacked PR base-sync path.
- Changing the already-shipped direct non-stacked PR freshness path.
- Adding broad workflow orchestration beyond stacked PR landing-time sync/freshness.
- Mutating unrelated active eforge build worktrees.

## Acceptance Criteria

- `executeStackLanding(...)` for stacked `landingAction: 'pr'` performs a remote-base synchronization before submitting the PR.
- A stack landing provider-command event records `git-spice repo sync` before `git-spice branch restack` for stacked PR landing.
- `executeStackLanding(...)` does not call `submitBranch(...)` when `syncRepo(...)` throws.
- `executeStackLanding(...)` persists a failed `stack:landing:update` event when `syncRepo(...)` throws.
- `executeStackLanding(...)` verifies after restack that the current `HEAD` contains the latest fetched remote effective base commit before calling `submitBranch(...)`.
- `executeStackLanding(...)` does not call `submitBranch(...)` when the post-restack remote-base freshness proof fails after the retry budget is exhausted.
- `executeStackLanding(...)` retries the sync/restack/freshness cycle at least once when the remote effective base advances after restack and before submit.
- Recoverable `branch restack` conflict recovery still submits the PR after successful conflict recovery and freshness proof.
- A non-recoverable `branch restack` failure still fails landing.
- A non-recoverable `branch restack` failure skips `submitBranch(...)`.
- `docs/architecture.md` describes the stacked PR landing-time remote-base sync/freshness behavior.
- `docs/stacking.md` describes how automatic stacked landing sync differs from manual `eforge stack sync`.
- `pnpm test -- stack-runtime-landing` exits 0.
- `pnpm type-check` exits 0.