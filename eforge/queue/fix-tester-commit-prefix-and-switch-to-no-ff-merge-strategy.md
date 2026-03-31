---
title: Fix Tester Commit Prefix and Switch to --no-ff Merge Strategy
created: 2026-03-31
status: pending
---

# Fix Tester Commit Prefix and Switch to --no-ff Merge Strategy

## Problem / Motivation

Two issues exist with how eforge builds produce commits on the base branch:

1. **Incorrect commit prefix**: The tester agent prompt uses `fix(...)` for all test-related commits, including new test coverage additions. These appear on main as `fix(plan-01-config-and-agent): add dependency detector agent wiring tests` when the content is purely test additions. The prefix should be `test(...)` to match the convention already used by the test-writer prompt.

2. **Cluttered main history**: For `builtOnMerge` builds (sequential plans), individual agent commits (builder, tester, etc.) live directly on the feature branch and get fast-forwarded to main via `--ff-only`. This clutters main's first-parent history. A `--no-ff` merge strategy would preserve individual commits on the branch for traceability while keeping main's first-parent history clean with merge commits.

## Goal

Align tester commit prefixes with conventional commit semantics (`test(...)` instead of `fix(...)`) and switch the feature-branch-to-base merge strategy from `--ff-only` to `--no-ff` so that main's first-parent history contains only clean merge commits while preserving full branch history for traceability.

## Approach

### 1. Fix tester prompt prefix

**File**: `src/engine/prompts/tester.md` (line 35)

Change commit template from `fix({{plan_id}})` to `test({{plan_id}})`. This aligns with the test-writer prompt which already uses `test(...)`.

### 2. Simplify `mergeFeatureBranchToBase` to always use `--no-ff`

**File**: `src/engine/worktree-ops.ts`

Replace the entire function body (keeping the branch guard at lines 254-261) with a single `--no-ff` path:

- Remove the squash merge path (lines 264-301)
- Remove the `--ff-only` attempt (lines 304-308)
- Remove the detached-worktree fallback (lines 310-381) - no longer needed since `--no-ff` handles diverged histories directly
- Rename parameter `squashCommitMessage?: string` to `commitMessage: string` (required). Move it before `mergeResolver` since it's now required.
- Keep conflict resolution via `mergeResolver` callback (adapted for `--no-ff`)
- Update JSDoc to describe the new `--no-ff` behavior

New core logic:

```typescript
await exec('git', ['merge', '--no-ff', featureBranch, '-m', commitMessage], { cwd: repoRoot });
```

With conflict resolution fallback using `gatherConflictInfo` + `mergeResolver` + `git commit --no-edit`.

### 3. Update `WorktreeManager.mergeToBase` signature

**File**: `src/engine/worktree-manager.ts` (line 205)

Update parameter order: `mergeToBase(baseBranch, commitMessage, mergeResolver?)` to match new `mergeFeatureBranchToBase` signature.

### 4. Update `finalize()` to always pass a merge commit message

**File**: `src/engine/orchestrator/phases.ts` (lines 518-523)

Currently single-plan passes a squash message, multi-plan passes `undefined`. Change to always produce a merge commit message with format that varies by plan count:

**Single-plan** (simple conventional commit):

```
feat(plan-01-fix-typo): Fix typo in auth module

Co-Authored-By: forged-by-eforge <noreply@eforge.build>
```

**Multi-plan** (conventional commit + plan summary in body):

```
feat(auth-refactor): Refactor authentication module

Profile: excursion
Plans:
- plan-01-auth-middleware: Auth middleware
- plan-02-token-validation: Token refresh

Co-Authored-By: forged-by-eforge <noreply@eforge.build>
```

- Single-plan uses `planId` and `planName` (same as before, just no longer squashed)
- Multi-plan uses `config.name` and `config.description` as subject, body lists profile name and each plan's id + name
- Respect `config.mode === 'errand'` for `fix` prefix (consistent with `mergePlan`)
- Update call to new `mergeToBase` signature

### 5. Update tests

**File**: `test/worktree-integration.test.ts`

Five tests need updating:

| Test | Change |
|------|--------|
| `mergeFeatureBranchToBase fast-forwards base branch` (line 171) | Pass required `commitMessage`. Assert merge commit (2 parents), not ff (sha !== feature HEAD) |
| `squashes commits when squashCommitMessage` (line 346) | Rename to test `--no-ff` behavior. Assert merge commit preserves branch history. `git log --first-parent` shows 2 commits (initial + merge), `git log` shows all |
| `preserves individual commits without squashCommitMessage` (line 409) | Pass required `commitMessage`. Assert merge commit at HEAD with 2 parents. Individual commits visible in full log |
| `squash with conflict invokes resolver` (line 452) | Update param order: `commitMessage` before `resolver`. Assert conflict resolution produces merge commit |
| `squash resets on failure without resolver` (line 510) | Update param order: `commitMessage` before `undefined` resolver. Assert reset still works |

### 6. Update documentation

Three files reference the merge strategy:

**`CLAUDE.md`** (line 83, Orchestration paragraph) - Update sentence about merge strategy. Currently says branches are "force-deleted after squash merge". Change to describe two-level merge: plan branches squash-merge to feature branch (unchanged), feature branch merges to base via `--no-ff` creating a merge commit.

**`README.md`** - Two sections to update:

- Line 46: "merging in topological dependency order" - add that the feature branch merges to base with a merge commit
- Line 50: "Completed builds merge back to the branch as ordered commits" - update to reflect merge commit strategy

**`docs/architecture.md`** - Three areas to update:

- Lines 168-174: Mermaid diagram - update the `FB -->|"all plans merged"| Base` arrow label to indicate `--no-ff` merge
- Line 183: Prose description - update "the feature branch merges to the base branch" to mention `--no-ff` merge commit that preserves branch history while keeping base branch first-parent history clean

## Scope

**In scope:**

- Tester prompt commit prefix fix (`fix` to `test`)
- Replacing all merge strategies in `mergeFeatureBranchToBase` with a single `--no-ff` path
- Updating the `WorktreeManager.mergeToBase` signature to match
- Updating `finalize()` to always produce a merge commit message (single-plan and multi-plan formats)
- Updating five existing integration tests to match new behavior
- Updating documentation in `CLAUDE.md`, `README.md`, and `docs/architecture.md`

**Out of scope:**

- Plan-to-feature-branch merge strategy (squash merge remains unchanged)
- Changes to any other agent prompts beyond the tester prompt
- New test additions beyond updating existing tests

## Acceptance Criteria

- Tester prompt in `src/engine/prompts/tester.md` uses `test({{plan_id}})` prefix instead of `fix({{plan_id}})`
- `mergeFeatureBranchToBase` exclusively uses `--no-ff` merge strategy with a required `commitMessage` parameter
- The squash merge path and `--ff-only` attempt are fully removed from `mergeFeatureBranchToBase`
- The detached-worktree fallback is removed from `mergeFeatureBranchToBase`
- `WorktreeManager.mergeToBase` signature is `mergeToBase(baseBranch, commitMessage, mergeResolver?)`
- `finalize()` always passes a merge commit message: simple conventional commit for single-plan, conventional commit with plan summary body for multi-plan
- Single-plan merge commit uses `planId` and `planName` for subject
- Multi-plan merge commit uses `config.name` and `config.description` for subject, with profile name and plan list in body
- Errand mode (`config.mode === 'errand'`) uses `fix` prefix in merge commit messages
- All five specified tests in `test/worktree-integration.test.ts` are updated to assert merge commits (2 parents) and correct messages
- `CLAUDE.md`, `README.md`, and `docs/architecture.md` are updated to reflect the `--no-ff` merge strategy
- `pnpm test` passes
- `pnpm type-check` passes
- Merge commits on the base branch have 2 parents and correct commit messages
