---
title: Monitor Diff Viewer - Heatmap Integration
created: 2026-03-20
status: pending
---

# Monitor Diff Viewer - Heatmap Integration

## Problem / Motivation

The monitor heatmap shows which files were changed by which plans, but there's no way to see the actual diffs. Users can see *that* a file was touched but not *what* changed - limiting the heatmap's usefulness for understanding and reviewing multi-plan builds.

## Goal

Let users click a file in the heatmap and see its diff from the base branch, turning the Heatmap tab into a "Changes" view with the heatmap grid on the left and a syntax-highlighted diff panel on the right.

## Approach

Worktrees and branches are force-deleted after squash merge, so diffs must come from git history rather than live branch state.

**Diff source**: Capture the squash-merge commit SHA in the `merge:complete` event, then serve diffs on-demand via `git show <sha> -- <file>`. This means:
- Zero event storage overhead (no diff text in SQLite)
- Works for any historical run as long as git history is intact
- Only available after merge (not during active build) - acceptable since the heatmap only populates after `build:files_changed` events

**Rendering**: Shiki (already installed) natively supports `lang: 'diff'` for syntax highlighting of unified diffs - same pattern as `plan-body-highlight.tsx`. No new dependencies needed. shadcn does not have a diff viewer component.

### Implementation Details

#### 1. Add `commitSha` to `merge:complete` event

**`src/engine/events.ts:186`** - Add optional `commitSha` field:
```
| { type: 'merge:complete'; planId: string; commitSha?: string }
```

**`src/engine/orchestrator.ts:429-443`** - After `mergeWorktree()`, capture HEAD SHA:
```typescript
await mergeWorktree(repoRoot, plan.branch, config.baseBranch, commitMessage, contextResolver);
const { stdout: commitSha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
// ... existing branch cleanup + state updates ...
yield { type: 'merge:complete', planId, commitSha: commitSha.trim() };
```

#### 2. Server diff endpoint

**`src/monitor/server.ts`** - New endpoint: `GET /api/diff/:sessionId/:planId?file=<path>`

Logic:
1. Query DB for `merge:complete` event matching the planId within the session
2. Extract `commitSha` from event data
3. Fallback for legacy events without SHA: `git log --format=%H --grep="(planId)" -1`
4. Run `git show <sha> -- <filePath>` to get the unified diff for that file
5. Return `{ diff: string, commitSha: string }` as JSON
6. Use the run's `cwd` from the DB (not the server's cwd) so historical runs resolve correctly

Also add a bulk endpoint: `GET /api/diff/:sessionId/:planId` (no `file` param) returns all file diffs for a plan at once - avoids N requests when clicking through files.

#### 3. Track commit SHAs in UI state

**`src/monitor/ui/src/lib/reducer.ts`** - Add to `RunState`:
```typescript
mergeCommits: Record<string, string>  // planId -> commitSha
```
Process `merge:complete` events to populate this map.

**`src/monitor/ui/src/lib/api.ts`** - Add:
```typescript
fetchFileDiff(sessionId: string, planId: string, filePath: string): Promise<{ diff: string; commitSha: string }>
```

#### 4. Diff viewer component

**`src/monitor/ui/src/components/heatmap/diff-viewer.tsx`** (new)

- Props: `{ sessionId, planId, filePath, onClose }`
- Fetches diff from the API
- Renders with Shiki `lang: 'diff'`, `theme: 'github-dark'` (same pattern as `plan-body-highlight.tsx`)
- File path header, plan ID subheader
- Loading spinner, empty state ("No changes"), error state ("Commit not found")
- Close button (X) or Escape key to dismiss

#### 5. Integrate into heatmap layout

**`src/monitor/ui/src/components/heatmap/file-heatmap.tsx`** - Split layout:
- Wrap in a flex row: heatmap grid on left, diff panel on right (when a file is selected)
- Add `selectedFile: { path: string; planId: string } | null` state
- Pass `sessionId` prop (threaded from `app.tsx`)

**`src/monitor/ui/src/components/heatmap/heatmap-cell.tsx`**:
- Add `onClick` callback prop
- `cursor-pointer` when `touched` is true
- Visual selected state (ring/border highlight)

**`src/monitor/ui/src/app.tsx`** - Pass `sessionId` to `FileHeatmap`

#### 6. Interaction design

- Click a **cell** (blue/yellow square) -> show diff for that specific plan + file
- Click a **file name** label on the left -> show diffs from all plans that touched it, stacked with plan headers
- Click the same cell again or press Escape -> close diff panel
- Overlap files (yellow) are the most interesting case - clicking shows each plan's diff separately

### Files to modify

| File | Change |
|------|--------|
| `src/engine/events.ts` | Add `commitSha?` to `merge:complete` |
| `src/engine/orchestrator.ts` | Capture SHA after squash merge |
| `src/monitor/server.ts` | Add `/api/diff` endpoint |
| `src/monitor/db.ts` | Helper to query merge events by planId (if needed) |
| `src/monitor/ui/src/lib/reducer.ts` | Track `mergeCommits` in state |
| `src/monitor/ui/src/lib/api.ts` | `fetchFileDiff()` |
| `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` | New component |
| `src/monitor/ui/src/components/heatmap/file-heatmap.tsx` | Split layout + selection state |
| `src/monitor/ui/src/components/heatmap/heatmap-cell.tsx` | onClick + cursor + selected ring |
| `src/monitor/ui/src/app.tsx` | Pass sessionId to FileHeatmap |

## Scope

**In scope:**
- Capturing squash-merge commit SHA in `merge:complete` events
- Server-side diff endpoint serving unified diffs via `git show`
- Bulk diff endpoint (all files for a plan in one request)
- Shiki-based diff viewer component with syntax highlighting
- Split-pane heatmap layout (grid left, diff right)
- Cell click and file-name click interactions
- Loading, empty, error, and "diff too large" states
- Legacy event fallback via `git log --grep`

**Out of scope:**
- Diffs during active builds (before merge)
- Errand mode (heatmap is gated on `isMultiPlan` - this feature follows that gate)

## Acceptance Criteria

- `pnpm build` succeeds - engine + monitor compile cleanly
- `pnpm test` - existing tests pass
- `merge:complete` events include `commitSha` after squash merge
- `GET /api/diff/:sessionId/:planId?file=<path>` returns `{ diff, commitSha }` JSON with the unified diff for the specified file
- `GET /api/diff/:sessionId/:planId` (no file param) returns all file diffs for a plan in one response
- Clicking a heatmap cell opens a diff panel on the right with Shiki-highlighted unified diff
- Clicking a file name label shows stacked diffs from all plans that touched that file, each with a plan header
- Clicking the same cell again or pressing Escape closes the diff panel
- Selected cell shows a visual highlight (ring/border)
- Cells with changes show `cursor-pointer`
- Large diffs (>500KB) show a "Diff too large" message instead of rendering
- Binary files show an appropriate "Binary files differ" message
- Missing/unreachable commit SHAs return a clear error ("Commit not found")
- Legacy `merge:complete` events without `commitSha` fall back to `git log --grep` lookup
- Diff endpoint uses the run's `cwd` from the DB, not the server's cwd, so historical runs resolve correctly
