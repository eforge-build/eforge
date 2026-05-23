---
id: plan-01-direct-pr-landing
name: Replace Non-Trunk PR Aggregation with Direct PR Landing
branch: complete-first-class-stacked-pr-and-git-spice-support/plan-01-direct-pr-landing
agents:
  builder:
    effort: high
    rationale: This plan changes core landing semantics and shared event workflow
      literals used by tests and generated docs.
  reviewer:
    effort: high
    rationale: Review must verify the old aggregation path is fully removed from
      runtime and tests.
---

# Replace Non-Trunk PR Aggregation with Direct PR Landing

## Architecture Context

The current `issue-pr` path treats a non-trunk base branch as an aggregation target: it merges the eforge artifact branch into the base branch locally, pushes the base branch, then opens a PR from base to trunk. First-class stacked PRs require the opposite: the artifact branch remains the PR head and the resolved base branch is the PR base. For a child layer this yields `eforge/child -> eforge/parent`.

This plan removes the aggregation semantics while keeping legacy non-stacked `gh pr create` publication for direct PR landing. git-spice runtime publication is added later in plan-02.

## Implementation

### Overview

Change `issue-pr` so `executeLandingAction()` always publishes `featureBranch -> baseBranch` and `WorktreeManager.issuePr()` has no option to merge into the base branch before PR creation. Update the landing workflow vocabulary and tests so any use of `feature-pr-after-local-merge` or `mergeIntoBaseFirst` fails.

### Key Decisions

1. Use a direct non-trunk workflow name such as `feature-pr` or `direct-pr` in `landing:start`; remove the `feature-pr-after-local-merge` literal from runtime and schemas.
2. Keep `merge-to-base-branch` behavior unchanged in this plan; only `issue-pr` changes.
3. Keep `gh` as the non-stacked direct PR publisher until plan-02 introduces the stacked git-spice publisher.

## Scope

### In Scope

- Remove non-trunk `issue-pr` local aggregation from engine runtime.
- Simplify `WorktreeManager.issuePr()` to push/open PR for `this.featureBranch` against `opts.baseBranch`.
- Update shared event schemas for landing workflow literals.
- Update tests that currently expect base-to-trunk aggregation.

### Out of Scope

- git-spice provider runtime calls.
- stack landing persistence.
- monitor UI stack rendering.
- docs generation.

## Files

### Create

- None.

### Modify

- `packages/engine/src/landing.ts` — remove `feature-pr-after-local-merge` workflow classification and call `worktreeManager.issuePr({ baseBranch })` for every `issue-pr` action.
- `packages/engine/src/worktree-manager.ts` — remove `trunkBranch`, `mergeIntoBaseFirst`, `commitMessage`, and `mergeResolver` options from `issuePr()` and delete the aggregation branch.
- `packages/engine/src/worktree-ops.ts` — update `createPullRequest()` comments to describe direct `--head featureBranch --base baseBranch`; keep `headBranch` only if another caller still needs it, otherwise remove it with all callers updated in the same change.
- `packages/client/src/events.schemas.ts` — remove the `feature-pr-after-local-merge` landing workflow literal and add the chosen direct non-trunk PR literal.
- `packages/client/src/__tests__/events-schemas.test.ts` — update landing workflow schema coverage.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — update sample landing event payloads if they reference the removed workflow.
- `test/landing-actions.test.ts` — replace aggregation expectations with direct `gh pr create --base <non-trunk-base> --head eforge/<set>` assertions; add a regression assertion that no local merge into the base branch occurs.

## Verification

- [ ] `rg "feature-pr-after-local-merge|mergeIntoBaseFirst" packages/engine packages/client test --glob '!dist/**'` returns no matches outside changelog-style comments intentionally retained by docs later.
- [ ] `test/landing-actions.test.ts` contains a non-trunk `issue-pr` case asserting PR head is the eforge feature/artifact branch and PR base is the resolved non-trunk base branch.
- [ ] `pnpm vitest run test/landing-actions.test.ts test/stack-events.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-wire-parity.test.ts` passes.
- [ ] `pnpm type-check` passes after the workflow literal change.