---
id: plan-02-worktree-integration-tests
name: Worktree Integration Test Baseline
depends_on: [plan-01-plan-lifecycle-guards]
branch: refactor-worktree-management/worktree-integration-tests
---

# Worktree Integration Test Baseline

## Architecture Context

Before extracting worktree operations into a `WorktreeManager` (plan-03), we need integration tests that exercise the full worktree lifecycle against real git repos. These tests lock in current behavior so that plan-03's refactoring can be verified by running the same tests against the new `WorktreeManager` API.

The existing `test/worktree-drift.test.ts` only covers `recoverDriftedWorktree()`. There are no tests for `createWorktree`, `removeWorktree`, `mergeWorktree`, `createMergeWorktree`, `mergeFeatureBranchToBase`, or `cleanupWorktrees`.

## Implementation

### Overview

Create `test/worktree-integration.test.ts` that tests the full worktree lifecycle using real git repos created in temp directories. Each test creates a bare repo, clones it, and exercises worktree operations against the clone.

### Key Decisions

1. **Real git repos, not mocks** - following the project convention of "no mocks". Each test creates an isolated git repo via `useTempDir()`.
2. **Helper function `setupRepo()`** - creates a git repo with an initial commit and a feature branch, returns `{ repoRoot, featureBranch, baseBranch }`. Similar pattern to `test/worktree-drift.test.ts`.
3. **Test the public functions from `worktree.ts` directly** - these tests validate the current implementation. In plan-03, the same scenarios will be adapted to test `WorktreeManager` methods.
4. **Merge conflict test uses overlapping file edits** - two branches modify the same line of the same file, verifying that `mergeWorktree` surfaces the conflict and that a `MergeResolver` callback can resolve it.

## Scope

### In Scope
- Integration tests covering: createWorktree, removeWorktree, mergeWorktree (squash merge), createMergeWorktree, mergeFeatureBranchToBase, cleanupWorktrees, computeWorktreeBase
- Multi-plan scenario: two plan worktrees, both merge to feature branch
- Concurrency=1 scenario: plan builds on merge worktree, drift recovery path
- Cleanup verification: all worktrees removed, plan branches deleted, worktree base dir removed
- Resume simulation: leave worktree in place, re-create (verifying the existing branch fallback in `createWorktree`)
- Merge conflict scenario with MergeResolver callback

### Out of Scope
- Testing orchestrator logic (that's in `test/orchestration-logic.test.ts`)
- Performance or stress testing
- Testing `recoverDriftedWorktree` in isolation (already covered in `test/worktree-drift.test.ts`)

## Files

### Create
- `test/worktree-integration.test.ts` - Integration test suite for worktree lifecycle operations

### Modify
(none)

## Verification

- [ ] `pnpm test` passes with all new tests green
- [ ] Test file contains at least 7 test cases covering the scenarios listed in scope
- [ ] Each test creates an isolated git repo using `useTempDir()` - no shared repo state between tests
- [ ] Multi-plan test creates 2 plan worktrees from the same feature branch, commits on both, squash-merges both into the feature branch, and verifies both commits exist in feature branch history
- [ ] Cleanup test verifies: `git worktree list` in repoRoot shows only the main worktree, the worktree base directory does not exist on disk, plan branches are not in `git branch --list` output
- [ ] Resume test creates a worktree, then calls `createWorktree` again with the same branch, and verifies it returns the same path without error
- [ ] Merge conflict test provides a `MergeResolver` that stages resolved files, and verifies the merge commit exists after resolution
