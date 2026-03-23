---
id: plan-01-feature-branch-orchestration
name: Feature Branch Orchestration
depends_on: []
branch: plan-feature-branch-orchestration/feature-branch-orchestration
---

# Feature Branch Orchestration

## Architecture Context

Currently, `orchestrator.ts` squash-merges each completed plan directly into `config.baseBranch` (main). If plan 2 of 3 fails, plan 1's changes are already on main — leaving it in a partially-implemented state. This plan adds an intermediate feature branch (`eforge/{set-name}`) so plans merge there first, and main only receives changes after all plans and validation pass.

The `mergeWorktree` function in `worktree.ts` already accepts a `baseBranch` parameter — it checks out that branch and squash-merges the plan branch into it. No changes to `mergeWorktree` are needed; we just pass the feature branch name instead of `config.baseBranch`.

## Implementation

### Overview

1. Add `merge:finalize:start`, `merge:finalize:complete`, `merge:finalize:skipped` event types and `featureBranch` field to `EforgeState`.
2. In the orchestrator's `execute()` method, create `eforge/{set-name}` feature branch before scheduling, redirect plan merges to it, run validation on it, and fast-forward merge to baseBranch after success.
3. On failure, checkout baseBranch and leave feature branch for inspection.
4. Add CLI display and monitor UI rendering for the new events.

### Key Decisions

1. **Feature branch created from baseBranch at build start** — `git checkout -b eforge/{name} {baseBranch}` then immediately checkout baseBranch again. The feature branch exists as a merge target; the orchestrator stays on baseBranch for worktree operations.
2. **mergeWorktree receives featureBranch instead of baseBranch** — No change to `mergeWorktree` signature or implementation. Just pass the feature branch name as the `baseBranch` argument.
3. **Fast-forward merge preferred, regular merge as fallback** — After validation, `git merge --ff-only featureBranch` is attempted. If main advanced during the build (unlikely but possible), falls back to a regular merge commit.
4. **Uniform flow for errands** — Even single-plan errands use a feature branch for consistency. The overhead is one extra branch + one fast-forward merge (trivial).
5. **Feature branch cleanup** — On success, the feature branch is deleted after merge. On failure, it stays for inspection. The finally block ensures baseBranch is checked out regardless.
6. **Feature branch persisted in `EforgeState`** — Enables resume support. On resume, if the feature branch already exists, reuse it.

## Scope

### In Scope
- `featureBranch` field in `EforgeState`
- `merge:finalize:start`, `merge:finalize:complete`, `merge:finalize:skipped` events
- Feature branch creation in orchestrator `execute()`
- Redirect plan merges to feature branch
- Ensure validation runs on feature branch
- Final merge of feature branch to baseBranch after success
- Failure handling: checkout baseBranch, leave feature branch, emit `merge:finalize:skipped`
- Feature branch cleanup in finally block (delete on success, leave on failure)
- CLI display for new events
- Monitor UI event card labels for new events

### Out of Scope
- Changes to `worktree.ts` `mergeWorktree` function (already parameterized)
- Changes to worktree creation logic
- Push behavior (local-only)

## Files

### Modify
- `src/engine/events.ts` — Add `merge:finalize:start`, `merge:finalize:complete`, `merge:finalize:skipped` to `EforgeEvent` union. Add `featureBranch?: string` to `EforgeState`.
- `src/engine/orchestrator.ts` — Create feature branch before scheduling loop, pass feature branch to `mergeWorktree` instead of `config.baseBranch`, checkout feature branch before validation, add final ff-merge to baseBranch after validation, handle failure by checking out baseBranch and emitting skip event, add feature branch to state initialization, ensure finally block checks out baseBranch and cleans up feature branch on success.
- `src/cli/display.ts` — Add case handlers for `merge:finalize:start`, `merge:finalize:complete`, `merge:finalize:skipped` events.
- `src/monitor/ui/src/components/timeline/event-card.tsx` — Add label mappings for `merge:finalize:*` events.
- `test/orchestration-logic.test.ts` — Update `makeState` helper if needed to support `featureBranch` field. Add tests for feature branch state initialization.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 — all existing tests pass
- [ ] `EforgeState` interface includes `featureBranch?: string`
- [ ] `EforgeEvent` union includes `merge:finalize:start`, `merge:finalize:complete`, and `merge:finalize:skipped` (with `reason: string`)
- [ ] `orchestrator.ts` `execute()` creates branch `eforge/{config.name}` before the scheduling loop
- [ ] `mergeWorktree` call in orchestrator passes the feature branch name, not `config.baseBranch`
- [ ] After all plans merge and validation passes, `git merge --ff-only` (or regular merge fallback) merges feature branch to baseBranch
- [ ] On build failure, orchestrator checks out baseBranch and emits `merge:finalize:skipped`
- [ ] The finally block checks out baseBranch regardless of success/failure
- [ ] CLI display renders `merge:finalize:start` with a spinner, `merge:finalize:complete` with success message, and `merge:finalize:skipped` with skip reason
- [ ] Monitor event-card returns label strings for all three `merge:finalize:*` event types
