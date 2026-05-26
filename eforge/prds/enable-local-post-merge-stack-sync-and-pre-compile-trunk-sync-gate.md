---
title: Add Pre-Compile Trunk Sync Gate
created: 2026-05-26
profile: gpt-claude-combo
---

# Add Pre-Compile Trunk Sync Gate

## Problem / Motivation

The desired workflow is high-frequency plan-and-handoff usage, potentially 10+ eforge enqueues per day, where the queue and build manager absorb tedious branch/base selection work.

Today this repo can plan, build in worktrees, and land via PR. The gap is that root builds can be created from the local trunk ref without first checking whether remote trunk advanced, so if `origin/main` or live remote `main` is ahead and local refs are stale, new root builds can start from an old base.

Do **not** add `eforge stack sync` to `build.postMergeCommands` as part of this work. Running stack sync as a generic shell validation/post-merge command from an agent worktree can bypass daemon/root active-build safeguards or become ineffective. Proper engine-owned on-demand stack sync should be planned separately.

Evidence gathered:

- Root stacked PRD base resolution lives in `packages/engine/src/stacking/base-resolver.ts`: no `stack_parent` means base is `resolveTrunkBranch(...)`; child PRDs use the recorded parent artifact branch/commit.
- Compile worktree creation lives in `packages/engine/src/eforge.ts`: `compile()` uses `options.baseBranchOverride` or the current branch name, then calls `createMergeWorktree(...)` with that ref. `buildSinglePrd()` passes `stackContext.baseBranch` as `baseBranchOverride` for stacked queued PRDs.
- Trunk identity logic lives in `packages/engine/src/branch-policy.ts`; it resolves `build.trunkBranch`, then `origin/HEAD`, then `main`. It does not fetch or update refs.
- Config schema and defaults live in `packages/engine/src/config.ts`; config docs/reference generation lives in `docs/config.md` and `packages/docs-gen/src/generators/config.ts`.
- Existing tests cover branch-policy resolution in `test/branch-policy.test.ts`, stack base resolution in `test/stack-base-resolver.test.ts`, and config parsing in `test/config.test.ts`.
- `rg` found no existing `trunkSync` implementation.
- Existing compile code accepts `baseBranchOverride`, making a fetched SHA/ref integration feasible without broad worktree changes.
- `createMergeWorktree()` already verifies the supplied base ref resolves before creating the feature branch.

Early conclusion: preventing stale-root builds needs an engine feature before root PRD compile/worktree creation. The safest design is to fetch remote trunk and build root PRDs from the fetched remote-tracking ref or exact SHA without checking out, pulling, rebasing, or mutating local `main`.

## Goal

Add a first-class, non-invasive trunk freshness gate before root queued builds compile.

Root builds should avoid stale local trunk bases by fetching remote trunk and using the fetched remote-tracking ref or exact fetched SHA as the build base, without mutating local `main`.

## Approach

Recommended profile: **Excursion**.

Rationale: this touches engine config, git behavior, queue compile flow, tests, and docs. It does not need Expedition because a single cohesive plan can cover the trunk sync helper, integration point, tests, and documentation without delegated module planning.

### Trunk sync config

Add an engine-level trunk sync gate for queued root builds before compile/worktree creation.

Recommended config shape:

```yaml
build:
  trunkSync:
    enabled: true
    remote: origin
    strategy: fetchedRemoteRef
    onDiverged: warn
```

Recommended config model:

```ts
build.trunkSync?: {
  enabled?: boolean;
  remote?: string;
  strategy?: 'fetchedRemoteRef';
  onDiverged?: 'warn' | 'fail' | 'use-remote';
}
```

Rationale: users may have local-only trunk commits, forks with non-origin remotes, offline workflows, or projects where builds intentionally start from local trunk. A config gate avoids surprising behavior.

### Trunk freshness behavior

The gate should:

- Resolve the configured/detected trunk branch.
- Fetch the remote trunk.
- Compare local trunk and remote-tracking/fetched trunk.
- Choose the build base according to policy.
- For the default recommended strategy, use the fetched remote-tracking ref or exact fetched SHA as `baseBranchOverride`, without mutating local `main`.
- Prefer `git fetch <remote> <trunk>` followed by resolving `<remote>/<trunk>` or `FETCH_HEAD` to a SHA and passing that SHA as `baseBranchOverride`.

Rationale: an exact SHA makes the build base reproducible and avoids later ref movement during the compile/build lifecycle. The orchestration should persist/report the resolved base. `createMergeWorktree()` can create a branch from a SHA as long as it resolves.

### Build targeting behavior

Scope the automatic gate primarily to root builds whose resolved base is trunk.

Rationale: child stacked PRDs intentionally build from parent artifact branches/commits. Forcing them to remote trunk would break stack topology. Non-stacked feature-branch builds should not be silently rebased onto trunk.

Child stacked builds should continue using their parent artifact branch/commit as base; they should not be forced onto remote trunk by this gate.

Non-stacked builds should be considered if they are targeting trunk; the implementation should avoid breaking existing direct feature-branch builds.

### Non-mutating design

Implement trunk freshness as a non-mutating pre-compile base-selection gate, not as `git checkout main && git pull`.

The gate must not:

- Checkout local trunk.
- Pull local trunk.
- Reset local trunk.
- Rebase local trunk.
- Force-push local trunk.
- Switch the user's working tree branch.
- Require the repo root to be checked out on trunk.

### Observability

Emit observable events or at least `planning:progress`/`config:warning` style diagnostics for gate outcomes.

Users need to see whether a build used local trunk, fetched remote trunk, skipped due to no remote, or failed due to divergence/policy.

If new event types are added, they must be added in `packages/client/src/events.schemas.ts` per project convention.

Optional typed events include:

- `trunk:sync:start`
- `trunk:sync:complete`
- `trunk:sync:skipped`
- `trunk:sync:failed`

### Relationship to stack sync

Do not use `eforge stack sync` as the pre-compile trunk gate.

Do not add `eforge stack sync` to `build.postMergeCommands` in this work.

Rationale: `eforge stack sync` is git-spice-specific and globally restacks stack branches. The pre-compile gate should be a narrow git trunk freshness check that works for root builds and does not restack or mutate active stack branches.

A follow-up can design proper engine-owned, daemon/root-scoped, on-demand stack sync that is active-build-aware and safe to trigger from queue/landing workflows.

### Likely files/modules to change

- `packages/engine/src/config.ts`: add `build.trunkSync` schema, TypeScript type, defaults, and config merge/resolve handling. Existing adjacent fields are `build.trunkBranch` and `build.allowLocalMergeToTrunk`.
- `packages/engine/src/branch-policy.ts` or a new focused module such as `packages/engine/src/trunk-sync.ts`: implement fetch/compare/base-selection helpers. Keeping fetch-specific behavior separate from pure trunk identity resolution may reduce risk.
- `packages/engine/src/events.ts` and `packages/client/src/events.schemas.ts`: optionally add typed events for observability. If event surface changes, update client wire parity tests.
- `packages/engine/src/eforge.ts`: integrate the gate in `buildSinglePrd()` before `compile(...)`, after stack context is resolved and before `baseBranchOverride` is passed. Root stacked PRDs are the primary path; compile's generic fallback should remain non-invasive for direct programmatic calls.
- `packages/engine/src/stacking/base-resolver.ts`: either leave root resolution as trunk branch name and let `buildSinglePrd()` replace it with a fetched SHA/ref, or extend root stack base resolution to call the new gate. Prefer keeping sync orchestration in `buildSinglePrd()` to avoid making base resolution perform network I/O unexpectedly in tests/callers.
- `docs/config.md`, `web/content/docs/configuration.md`, and `packages/docs-gen/src/generators/config.ts`: document `build.trunkSync`.

### Tests to add or update

- `test/config.test.ts` for parsing/defaults/round-trip of `build.trunkSync`.
- `test/branch-policy.test.ts` or a new `test/trunk-sync.test.ts` for fetch/fast-forward/diverged/no-remote/no-remote-branch behavior.
- `test/stack-base-resolver.test.ts` or a focused `buildSinglePrd` test for root stacked builds receiving fetched remote base while child builds continue using parent artifact base.
- A regression test that `build.postMergeCommands` is not modified by this work.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| Root queued stacked PRDs currently build from local trunk unless a parent artifact base is involved. | `resolveStackBaseContext()` returns `resolveTrunkBranch(...)` for PRDs without `stack_parent`; `compile()` uses `baseBranchOverride` to create the merge worktree. | high | medium | Add a targeted test around `buildSinglePrd()` or root stack base resolution. | The gate might be placed in the wrong layer or miss some root-build path. |
| Passing a fetched remote SHA as `baseBranchOverride` is compatible with `createMergeWorktree()`. | `createMergeWorktree()` checks `refExists()` and runs `git worktree add -b <featureBranch> <path> <baseRef>`; git can branch from a commit SHA. | high | low | Add a unit/integration test creating a worktree from a fetched SHA. | Would need to use a remote-tracking ref instead of SHA or adjust worktree creation. |
| The safest default is non-mutating local trunk behavior. | User concern is stale local main; existing architecture keeps repoRoot untouched during builds; `mergeFeatureBranchToBase()` has guards for dirty/root branch state showing mutation is treated carefully. | high | low | Confirm with user if they prefer failing instead of using remote SHA when local trunk diverges. | A too-permissive default could surprise users who intended local trunk commits to be the base. |
| `origin` is the right default remote but should be configurable. | Existing code and docs use `origin/HEAD` and `origin/<trunk>` for trunk resolution and stack sync status. | high | low | Config tests for custom remote; manual test with a bare remote named differently. | Fork/upstream workflows may fetch the wrong remote. |
| New events may be preferable but are not strictly required for correctness. | Project convention says event schemas live in `packages/client/src/events.schemas.ts`; existing config warnings/progress events can expose diagnostics with less API surface. | medium | low | Decide during implementation whether observability requires new discriminants; update wire parity tests if added. | Too little observability makes it hard to diagnose skipped/fallback sync behavior. |

## Scope

In scope:

- Add an engine-level trunk sync gate for queued root builds before compile/worktree creation.
- Add a configurable, default-safe `build.trunkSync` config block.
- Resolve the configured/detected trunk branch.
- Fetch the remote trunk.
- Compare local trunk and remote-tracking/fetched trunk.
- Choose the build base according to policy.
- Use the fetched remote-tracking ref or exact fetched SHA as `baseBranchOverride` for the default recommended strategy, without mutating local `main`.
- Keep child stacked builds using their parent artifact branch/commit as base.
- Consider non-stacked builds if they are targeting trunk.
- Avoid breaking existing direct feature-branch builds.
- Add tests and docs for the new gate.
- Cover divergence behavior in tests and docs.
- Cover non-mutating local trunk behavior in tests and docs.

Out of scope:

- Adding `eforge stack sync` to `build.postMergeCommands`.
- Daemon periodic polling sync such as `stacking.sync.intervalSeconds`.
- Engine-owned on-demand stack restacking/sync; plan this separately.
- Force-resetting local trunk.
- Rebasing local trunk.
- Force-pushing local trunk.
- Switching the user's working tree branch.
- Requiring the repo root to be checked out on trunk.
- Changing git-spice provider semantics.
- Solving GitHub stale inline comments after restacks.
- Changing landing policy from PR to local merge.

## Acceptance Criteria

- `eforge/config.yaml` is not modified to add `eforge stack sync` to `build.postMergeCommands`.
- `build.postMergeCommands` still contains `pnpm install` when it was present before the change.
- `build.postMergeCommands` still contains `pnpm build` when it was present before the change.
- `build.postMergeCommands` still contains `pnpm type-check` when it was present before the change.
- `build.postMergeCommands` still contains `pnpm test` when it was present before the change.
- A new `build.trunkSync` config block is accepted by config parsing.
- The default value for `build.trunkSync.enabled` is documented.
- The default value for `build.trunkSync.remote` is documented.
- The default value for `build.trunkSync.strategy` is documented.
- The default divergence behavior for `build.trunkSync` is documented.
- A root queued stacked PRD with trunk sync enabled fetches the configured remote trunk before compile worktree creation.
- A root queued stacked PRD with trunk sync enabled creates its compile merge worktree from the fetched remote trunk SHA or fetched remote-tracking ref when remote trunk is ahead of stale local trunk.
- The trunk sync gate does not checkout local trunk.
- The trunk sync gate does not pull local trunk.
- The trunk sync gate does not reset local trunk.
- The trunk sync gate does not rebase local trunk.
- The trunk sync gate does not otherwise mutate local trunk.
- A child stacked PRD with a parent artifact creates its compile merge worktree from the parent artifact branch or commit.
- A non-trunk feature-branch build is not silently retargeted to remote trunk by the trunk sync gate.
- Diverged local trunk behavior follows config policy.
- Diverged local trunk behavior never force-resets local trunk.
- Trunk sync skip behavior is visible through typed events, config warnings, or progress diagnostics recorded in the run event stream.
- Trunk sync failure behavior is visible through typed events, config warnings, or progress diagnostics recorded in the run event stream.
- Trunk sync fallback behavior is visible through typed events, config warnings, or progress diagnostics recorded in the run event stream.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- Documentation explains that pre-compile trunk freshness is distinct from stack restacking/sync.
