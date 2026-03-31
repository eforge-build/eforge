---
title: Fix PRD files not removed after build
created: 2026-03-31
status: pending
---

# Fix PRD files not removed after build

## Problem / Motivation

After a successful build, PRD queue files should be removed from git. The cleanup commit on the feature branch correctly deletes them, but the feature branch fails to merge back to main because `updatePrdStatus()` modifies the PRD file in the main repo working tree (changing `status: pending` to `running` then `completed`), creating uncommitted changes that block `git merge --no-ff`:

```
error: Your local changes to the following files would be overwritten by merge:
    eforge/queue/build-failure-banner-in-monitor-ui.md
Please commit your changes or stash them before you merge.
```

The root cause is that PRD status is tracked by mutating a git-tracked file's frontmatter without committing. This creates dirty working tree state that conflicts with the merge.

## Goal

Eliminate mutable `status` field from PRD frontmatter and use file system location as the source of truth for PRD state, so that feature branches merge cleanly back to main after build completion.

## Approach

Replace the mutable `status` frontmatter field with a file-location-based state model:

| State | Representation |
|-------|---------------|
| Pending | File in `eforge/queue/` (no lock) |
| Running | File in `eforge/queue/` + lock in `.eforge/queue-locks/<id>.lock` |
| Completed | File deleted (cleanup commit on feature branch, merged to main) |
| Failed | File moved to `eforge/queue/failed/` via committed `git mv` |
| Skipped | File moved to `eforge/queue/skipped/` via committed `git mv` |

The lock file mechanism (`claimPrd`/`releasePrd`) already prevents double-processing - the `status: running` write was redundant.

### File changes

#### 1. `src/engine/prd-queue.ts` - Remove status field and add move helpers

- Remove `PRD_STATUSES` const, `PrdStatus` type
- Remove `status` from `prdFrontmatterSchema`
- Remove `updatePrdStatus()` function
- Update `resolveQueueOrder()`: remove status filter (all PRDs in queue dir are pending by definition)
- Update `enqueuePrd()`: stop writing `status: pending` to frontmatter
- Add `movePrdToSubdir(filePath: string, subdir: 'failed' | 'skipped', cwd: string)` - does `git mv` to the subdir, commits
- Update `cleanupCompletedPrd()` or remove it (the feature branch cleanup handles deletion)
- Add `isPrdRunning(prdId: string, cwd: string): Promise<boolean>` - checks lock file existence for display purposes

#### 2. `src/engine/eforge.ts` - Remove all `updatePrdStatus` calls

- **Line 779**: `updatePrdStatus(prd.filePath, 'skipped')` -> `movePrdToSubdir(prd.filePath, 'skipped', cwd)`
- **Line 819**: `updatePrdStatus(prd.filePath, 'running')` -> **delete** (lock file is the running indicator)
- **Line 888**: `updatePrdStatus(prd.filePath, prdResult.status)` -> for `failed`: `movePrdToSubdir(prd.filePath, 'failed', cwd)`, for `skipped`: `movePrdToSubdir(prd.filePath, 'skipped', cwd)`, for `completed`: **do nothing** (cleanup commit handles it)
- Remove `updatePrdStatus` from import

#### 3. `src/engine/index.ts` - Update exports

- Remove `PrdStatus` type export
- Keep or update `cleanupCompletedPrd` export as needed

#### 4. `src/cli/display.ts` - Update queue list rendering

- Replace status-based grouping with location-based grouping
- Show PRDs in `queue/` as pending (check lock files for running indicator)
- Show PRDs in `queue/failed/` and `queue/skipped/` separately
- Load failed/skipped PRDs from their subdirectories

#### 5. `src/engine/events.ts` - No change needed

- `queue:prd:complete` event status field stays (it's the event result, not file state)

#### 6. Tests

- `test/prd-queue.test.ts`: Remove status validation tests, update ordering tests to not use status field, remove `updatePrdStatus` tests, add tests for `movePrdToSubdir`
- `test/prd-queue-enqueue.test.ts`: Remove status assertions from enqueue output
- `test/greedy-queue-scheduler.test.ts`: Update to not rely on status field for filtering

### Post-deploy: merge orphaned feature branches

After deploying the fix, manually merge or rebase the two orphaned feature branches to main:
- `eforge/build-failure-banner-in-monitor-ui`
- `eforge/add-build-metrics-to-monitor-ui-summary-cards`

## Scope

**In scope:**
- Removing `status` field from PRD frontmatter and all related types/functions
- Adding `movePrdToSubdir` helper for failed/skipped state transitions via `git mv`
- Adding `isPrdRunning` helper using lock file existence
- Updating `resolveQueueOrder` to no longer filter by status
- Updating `enqueuePrd` to stop writing `status: pending`
- Removing all `updatePrdStatus` calls from the build engine
- Updating CLI display to use location-based grouping
- Updating all affected tests
- Merging orphaned feature branches after fix is deployed

**Out of scope:**
- Changes to `src/engine/events.ts` (event result status field is unrelated to file state)
- Changes to the lock file mechanism (`claimPrd`/`releasePrd`)

## Acceptance Criteria

- `pnpm build` produces no type errors
- `pnpm test` passes all tests
- Enqueued PRD files contain no `status` field in frontmatter
- While a build is running, a lock file exists in `.eforge/queue-locks/`
- On successful build: PRD is deleted from `eforge/queue/` and the feature branch merges cleanly to main with no dirty working tree errors
- On failed build: PRD is moved to `eforge/queue/failed/` via a committed `git mv`
- On skipped build: PRD is moved to `eforge/queue/skipped/` via a committed `git mv`
- `eforge queue list` displays correct grouping by location (pending, running, failed, skipped)
- `PRD_STATUSES` const, `PrdStatus` type, and `updatePrdStatus()` function are fully removed
- Orphaned feature branches (`eforge/build-failure-banner-in-monitor-ui`, `eforge/add-build-metrics-to-monitor-ui-summary-cards`) are merged or rebased to main
