---
id: plan-01-stack-foundation-sync
name: Synchronize Existing Stack Foundation and Provider Baseline
branch: stacked-pr-support-plan-03-artifact-aware-queue-and-stack-parent-aware-base-resolution/plan-01-stack-foundation-sync
---

# Synchronize Existing Stack Foundation and Provider Baseline

## Architecture Context

The Plan 03 PRD states that stack contracts, stack config/state/events, PRD stack frontmatter fields, the git-spice provider adapter, and git ref helpers already exist on branch `eforge/add-first-class-stacked-pr-support-with-optional-git-spice-integration`. The inspected checkout does not contain `packages/engine/src/stacking/`, and `561e65c0` / `75c4b7c1` are not ancestors of the current branch. This plan brings that existing baseline into the implementation branch without re-authoring it. Plan 03 implementation depends on these contracts and helpers.

Do not import or cherry-pick abandoned Plan 03 commit `ef083ddc6568e6da6274fdb3fd9e28703d3bf266` in this plan. That commit is only reference material for Plan 03.

## Implementation

### Overview

Fast-forward or merge the existing Plan 01/02 stack baseline from `eforge/add-first-class-stacked-pr-support-with-optional-git-spice-integration` into this plan branch. Preserve the existing contracts and tests from that branch.

### Key Decisions

1. Use the existing branch as the source of truth for Plan 01/02. This satisfies the PRD constraint to avoid re-implementing stack contracts, config, state, events, provider adapter, and git primitives.
2. Keep this plan limited to baseline synchronization. Artifact-aware scheduling and base resolution belong to Plan 02 in this plan set.
3. Exclude abandoned commit `ef083ddc6568e6da6274fdb3fd9e28703d3bf266`; its attempted Plan 03 implementation has known gaps and belongs only in the inspection notes for the next plan.

## Scope

### In Scope

- Bring in stack domain types, stack state helpers, stack config schema, stack wire events, PRD stack frontmatter fields, git-spice provider adapter, and git ref helpers from the existing Plan 01/02 branch.
- Bring in the existing Plan 01/02 tests from that branch.
- Verify the resulting baseline builds and type-checks before Plan 03 work begins.

### Out of Scope

- Artifact-aware dependency readiness changes.
- Stack-parent inference and dispatch blocking changes.
- Stack-aware compile/build base resolution.
- Artifact recording after validation.
- Landing refactors, daemon API or monitor UI updates, consumer surface updates, and documentation.

## Files

### Create

- `packages/engine/src/stacking/types.ts` — existing stack/layer domain types.
- `packages/engine/src/stacking/state.ts` — existing stack state load/save/upsert/lookup helpers.
- `packages/engine/src/stacking/provider.ts` — existing stack provider interface and factory.
- `packages/engine/src/stacking/git-spice.ts` — existing git-spice adapter.
- `packages/engine/src/stacking/index.ts` — existing stacking module exports.
- `test/stack-config.test.ts` — existing stack config tests.
- `test/stack-events.test.ts` — existing stack wire event tests.
- `test/stack-state.test.ts` — existing stack state tests.
- `test/git-spice-provider.test.ts` — existing git-spice adapter tests.
- `test/stack-git-helpers.test.ts` — existing git ref helper tests.

### Modify

- `packages/engine/src/config.ts` — bring in existing stacking and landing config fields and resolved config defaults.
- `packages/engine/src/prd-queue.ts` — bring in existing `stack_id`, `stack_parent`, `stack_provider`, and `landing` PRD frontmatter fields.
- `packages/engine/src/worktree-ops.ts` — bring in existing `branchExists`, `refExists`, and `getRefSha` git helper functions.
- `packages/engine/src/events.ts` — re-export existing stack-related shared event types.
- `packages/client/src/events.schemas.ts` — bring in existing stack/layer/artifact wire schemas and event variants.
- `packages/client/src/event-registry.ts` — bring in existing stack event registry entries.

## Implementation Notes

1. Confirm the working tree has no local modifications before starting: `git status --short` must print no lines.
2. Prefer `git merge --ff-only eforge/add-first-class-stacked-pr-support-with-optional-git-spice-integration` from the plan branch when possible. Current inspection shows the current branch is an ancestor of that branch, so this path is expected to apply without conflict.
3. If the branch is already present in the plan branch, leave these files unchanged and record that no baseline sync was needed.
4. If a non-fast-forward merge is required due to later upstream changes, inspect conflicts and preserve the branch's existing Plan 01/02 contracts. Do not copy code from `ef083ddc6568e6da6274fdb3fd9e28703d3bf266` in this plan.

## Verification

- [ ] `packages/engine/src/stacking/state.ts`, `packages/engine/src/stacking/provider.ts`, and `packages/engine/src/stacking/git-spice.ts` exist after the sync.
- [ ] `packages/engine/src/prd-queue.ts` accepts `stack_id`, `stack_parent`, `stack_provider`, and `landing` in PRD frontmatter.
- [ ] `packages/engine/src/worktree-ops.ts` exports `branchExists`, `refExists`, and `getRefSha`.
- [ ] `pnpm vitest run test/stack-config.test.ts test/stack-events.test.ts test/stack-state.test.ts test/git-spice-provider.test.ts test/stack-git-helpers.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0 after the sync.
