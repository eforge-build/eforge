---
title: Fix: Allow diff viewer to show diffs before merge
created: 2026-03-25
status: pending
---



# Fix: Allow diff viewer to show diffs before merge

## Problem / Motivation

Clicking a changed file in the Changes tab during the build phase shows "Commit not found" instead of the actual diff. The server already supports a branch-based fallback (`git diff baseBranch..planBranch`, added in commit `5e0f67c`), but the client-side `DiffViewer` component short-circuits before making the API call when `mergeCommits[planId]` is undefined. This means diffs only work after the merge phase completes — not during the build phase when users most want to inspect changes.

## Goal

Allow users to view file diffs at any point during the build phase, not only after merge completes, by removing the client-side guards that prevent the API call when merge commit data is unavailable.

## Approach

The server already has the branch-based diff fallback in place. The fix is purely client-side — remove the `mergeCommits` guards in `DiffViewer` so the component always calls `fetchFileDiff()` and lets the server handle commit resolution.

**File: `src/monitor/ui/src/components/heatmap/diff-viewer.tsx`**

1. **Remove the `mergeCommits` early-exit guard** (lines 62-66). Always call `fetchFileDiff()` and let the server handle commit resolution via its branch-based fallback.
2. **Remove the `mergeCommits` filter** on line 75. Use all `planIds` instead of only those with merge commits: `const relevantPlanIds = planIds ?? [];`
3. **Remove the `mergeCommits` prop entirely** from `DiffViewerProps` since it is no longer needed in this component. Also remove the `mergeCommitsKey` memo (lines 32-36) and its usage in the effect dependency array (line 134).

**File: `src/monitor/ui/src/components/heatmap/file-heatmap.tsx`**

4. Stop passing `mergeCommits` to the `DiffViewer` component.

## Scope

**In scope:**
- Removing `mergeCommits` guards and prop from `DiffViewer` (`diff-viewer.tsx`)
- Updating `file-heatmap.tsx` to stop passing `mergeCommits` to `DiffViewer`

**Out of scope:**
- Server-side changes (branch-based fallback already exists)
- Any other diff-related features or refactors

## Acceptance Criteria

- `pnpm build` completes with no type errors.
- During the build phase (before merge), clicking a changed file in the Changes tab shows a diff instead of "Commit not found."
- After merge completes, diffs continue to work correctly (regression check).
- The `mergeCommits` prop, `mergeCommitsKey` memo, and all related guards are fully removed from `DiffViewer`.
