---
title: Plan: Feature Branch Orchestration
created: 2026-03-23
status: pending
---

# Feature Branch Orchestration

## Problem / Motivation

Currently, the orchestrator squash-merges each plan directly to `baseBranch` (main) as it completes. If plan 2 of 3 fails, plan 1's changes are already on main — leaving it in a partially-implemented state. This makes reverts messy and leaves main dirty on failures.

## Goal

Merge plans to a feature branch first, then only fast-forward merge the feature branch to main after ALL plans + validation pass. Main stays pristine until everything succeeds, and individual plan commits are preserved.

## Approach

1. **Create a feature branch** (`eforge/{set-name}`) at build start, before the main scheduling loop in `src/engine/orchestrator.ts` (around line 234). Store `featureBranch` in `EforgeState` for resume support.

   ```typescript
   const featureBranch = `eforge/${config.name}`;
   await exec('git', ['checkout', '-b', featureBranch, config.baseBranch], { cwd: repoRoot });
   await exec('git', ['checkout', config.baseBranch], { cwd: repoRoot }); // return to baseBranch
   ```

2. **Merge plans to the feature branch** instead of `baseBranch`. In `src/engine/orchestrator.ts` (merge loop, lines 402–447), change the `mergeWorktree` call (line 429):

   ```typescript
   // Before:
   await mergeWorktree(repoRoot, plan.branch, config.baseBranch, commitMessage, contextResolver);

   // After:
   await mergeWorktree(repoRoot, plan.branch, featureBranch, commitMessage, contextResolver);
   ```

   The `mergeWorktree` function in `worktree.ts:140-187` already takes `baseBranch` as a parameter — it checks out that branch and squash-merges the plan branch into it. No changes needed to `mergeWorktree` itself.

3. **Run validation on the feature branch.** Validation already runs in the main repo with whatever branch is checked out. Ensure the feature branch is checked out before validation runs (in `src/engine/orchestrator.ts`, validation section, lines 482–546):

   ```typescript
   await exec('git', ['checkout', featureBranch], { cwd: repoRoot });
   ```

   No other changes needed — validation commands run in cwd, which is the repo root.

4. **Final merge: feature branch → baseBranch.** After successful validation (after line ~546 in `src/engine/orchestrator.ts`), fast-forward merge the feature branch to baseBranch:

   ```typescript
   yield { type: 'merge:finalize:start' };
   await exec('git', ['checkout', config.baseBranch], { cwd: repoRoot });
   try {
     await exec('git', ['merge', '--ff-only', featureBranch], { cwd: repoRoot });
   } catch {
     // Fast-forward not possible (main advanced during build) — regular merge
     await exec('git', ['merge', featureBranch, '-m', `Merge eforge/${config.name}`], { cwd: repoRoot });
   }
   // Delete feature branch
   await exec('git', ['branch', '-D', featureBranch], { cwd: repoRoot });
   yield { type: 'merge:finalize:complete' };
   ```

5. **Handle failure: leave main untouched.** On build failure (any plan fails or validation fails):
   - Do NOT merge feature branch to baseBranch
   - Checkout baseBranch to leave repo in clean state: `git checkout config.baseBranch`
   - Feature branch stays for inspection (or optionally delete it)
   - Emit event: `{ type: 'merge:finalize:skipped', reason: 'build-failed' }`
   - In the finally block (lines 552–570), ensure we're back on baseBranch:
     ```typescript
     await exec('git', ['checkout', config.baseBranch], { cwd: repoRoot });
     ```

6. **Add events for feature branch lifecycle** in `src/engine/events.ts`:

   ```typescript
   | { type: 'merge:finalize:start' }
   | { type: 'merge:finalize:complete' }
   | { type: 'merge:finalize:skipped'; reason: string }
   ```

7. **Update `EforgeState` for resume support** in `src/engine/events.ts` (line ~57). Add `featureBranch?: string` to `EforgeState`. On resume, if the feature branch exists, reuse it instead of creating a new one.

8. **Errand optimization (single plan):** For errands (single plan, no dependencies), the feature branch is still created for consistency but the overhead is trivial (one extra branch + one fast-forward merge). Keep the flow uniform.

## Scope

**In scope:**

| File | Change |
|------|--------|
| `src/engine/orchestrator.ts` | Create feature branch, merge plans to it, final ff-merge to baseBranch, failure handling |
| `src/engine/events.ts` | Add `merge:finalize:*` event types, add `featureBranch` to `EforgeState` |

**Out of scope:**

- Changes to `mergeWorktree` in `worktree.ts` (it already accepts `baseBranch` as a parameter)
- Changes to the validation command runner (it already runs in cwd)
- Per-profile differentiation (errands use the same feature branch flow for uniformity)

## Acceptance Criteria

- `pnpm build` completes with no type errors
- `pnpm test` — all existing tests pass
- Running a multi-plan build (excursion) verifies:
  - Feature branch `eforge/{set-name}` is created at build start
  - Plan commits appear on the feature branch during build
  - Main is untouched until all plans + validation pass
  - After success, main has all plan commits (fast-forward merge)
  - Feature branch is deleted after successful merge
- Simulating a failure (e.g., forcing a plan to fail) verifies main is untouched
- Monitor dashboard correctly displays the new `merge:finalize:*` events
- On resume, an existing feature branch is reused rather than recreated
