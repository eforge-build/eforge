---
title: Fix Changes UI: Capture Diffs at Source, Eliminate Git Query-Time Resolution
created: 2026-03-31
status: pending
---

# Fix Changes UI: Capture Diffs at Source, Eliminate Git Query-Time Resolution

## Problem / Motivation

The Changes/Heatmap UI shows files as changed but clicking them shows "No changes" for source files modified during builds. The root cause is a fundamental design flaw: the heatmap captures file lists via working-tree diff (sees uncommitted changes), but the diff viewer tries to reconstruct diffs from git history at query time using a fragile chain of 4 fallback strategies (`resolveCommitSha` -> `resolvePlanBranch` -> `resolveFeatureBranch` -> 404). Each strategy has failure modes, and during active builds none can see uncommitted changes.

**Before (complex, broken):**
- Heatmap: `git diff --name-only baseBranch` from worktree (working tree diff)
- Diff viewer: try commit SHA -> try plan branch -> try feature branch -> fail
- 4 resolution strategies, each with failure modes
- Depends on git branch/commit state at query time

The recent `--no-ff` merge strategy change does not affect this design - the dependency on git state at query time is the core issue.

## Goal

Replace the fragile git-query-time diff resolution with a simpler design: capture per-file diffs at the same time we detect file changes, store them in SQLite, and serve them with a simple DB query. No git operations at query time. A retention policy manages storage growth.

## Approach

**After (simple, reliable):**
- Heatmap + diffs: captured together at emission time, stored in SQLite
- Diff viewer: `SELECT` from `file_diffs` table
- Single source of truth, no git at query time
- Retention policy manages DB size

### 1. Extend event type (`src/engine/events.ts:183`)

Add optional `diffs` and `baseBranch` fields to `build:files_changed`:
```ts
| { type: 'build:files_changed'; planId: string; files: string[]; diffs?: Array<{ path: string; diff: string }>; baseBranch?: string }
```
Optional for backward compat with old events already in DBs.

### 2. Add diff capture utility (`src/engine/pipeline.ts`)

New helper function `captureFileDiffs(cwd: string, baseBranch: string): Promise<Array<{path: string, diff: string}>>`:
- Runs single `git diff <baseBranch>` command from the worktree
- Splits output on `diff --git a/` headers to get per-file chunks
- Returns array of `{path, diff}` pairs
- Non-critical - returns empty array on failure (same as existing `emitFilesChanged` error handling)

### 3. Update event emission sites (`src/engine/pipeline.ts`)

**`emitFilesChanged()` (~line 1026)**: After getting the file list, call `captureFileDiffs()` and include the result:
```ts
const diffs = await captureFileDiffs(ctx.worktreePath, ctx.orchConfig.baseBranch);
yield { ..., files, diffs, baseBranch: ctx.orchConfig.baseBranch };
```

**`withPeriodicFileCheck()` (~line 993)**: Same - when file list changes and we emit an event, also capture diffs. The dedup logic already ensures we only emit when files actually change, so this doesn't run every 15s unnecessarily.

### 4. New `file_diffs` table (`src/monitor/db.ts`)

Add to schema:
```sql
CREATE TABLE IF NOT EXISTS file_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  plan_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  diff_text TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_diffs_plan_file ON file_diffs(plan_id, file_path);
```

New query methods on `MonitorDB`:
- `insertFileDiffs(runId, planId, diffs: Array<{path, diff}>, timestamp)` - bulk insert
- `getFileDiff(sessionId, planId, filePath)` - latest diff for one file
- `getFileDiffs(sessionId, planId)` - all file diffs for a plan (for bulk endpoint)
- `cleanupOldSessions(keepCount)` - retention policy

### 5. Recorder extracts diffs into separate table (`src/monitor/recorder.ts`)

When recording a `build:files_changed` event:
- If the event has a `diffs` array, insert each into `file_diffs` table via `db.insertFileDiffs()`
- Strip `diffs` from the event object before `JSON.stringify()` for the events table
- This keeps the events table and SSE stream lean while storing diffs separately

The recorder already does event-type-specific processing (session:start buffering, phase:start run creation, etc.) so this is consistent with existing patterns.

### 6. Simplified diff endpoint (`src/monitor/server.ts`)

Replace the entire `serveDiff()` function body. New logic:

**Single-file** (`/api/diff/:sessionId/:planId?file=path`):
```ts
const record = db.getFileDiff(sessionId, planId, file);
if (!record) {
  sendJson(res, { diff: null });
  return;
}
sendJson(res, { diff: record.diffText });
```

**Bulk** (`/api/diff/:sessionId/:planId`):
```ts
const records = db.getFileDiffs(sessionId, planId);
const files = records.map(r => ({ path: r.filePath, diff: r.diffText }));
sendJson(res, { files });
```

### 7. Remove dead code (`src/monitor/server.ts`)

Delete these functions (only used by the old diff endpoint):
- `resolveCommitSha()` (~lines 619-643)
- `resolvePlanBranch()` (~lines 645-680)
- `resolveFeatureBranch()` (~lines 683-731)
- `resolveCwd()` (~lines 738-764)
- The `serveWorktreeDiff` / branch-based diff / commit-based diff blocks in old `serveDiff()`

Keep `candidateOrchestrationPaths()` - still used by `readBuildConfigFromOrchestration()`.

### 8. Retention policy

**Config** (`src/engine/config.ts`): Add `monitor` section to config schema and defaults:
```yaml
monitor:
  retentionCount: 20    # Number of sessions to keep in the monitor DB
```
- Add `monitor: z.object({ retentionCount: z.number().int().positive().optional() }).optional()` to `eforgeConfigSchema`
- Add `monitor: { retentionCount: number }` to `EforgeConfig`
- Add `monitor: Object.freeze({ retentionCount: 20 })` to `DEFAULT_CONFIG`
- Wire through `mergePartialConfigs` with the same shallow-merge pattern as other object sections

**DB cleanup** (`src/monitor/db.ts`): `cleanupOldSessions(keepCount: number)`:
1. Query distinct `session_id` from runs ordered by `started_at DESC`
2. Sessions beyond `keepCount` are candidates for deletion
3. Delete from `file_diffs` (join on run_id), `events` (join on run_id), then `runs`

**Trigger**: On monitor server startup in `createMonitorServer()`. The server already receives config - pass `retentionCount` through.

**Docs** (`docs/config.md`): Add `monitor` section between `daemon` and `pi`:
```yaml
monitor:
  retentionCount: 20    # Max sessions retained in monitor DB. Older sessions are pruned on startup.
```
Also update the Config Layers paragraph to include `monitor` in the list of object sections that shallow-merge.

**CLAUDE.md**: Add `monitor` to the merge strategy docs and mention `retentionCount` in the Monitor section.

### 9. Update tests

**`test/files-changed-event.test.ts`**: Add test for event with optional `diffs` and `baseBranch` fields.

**`test/periodic-file-check.test.ts`**: Mock the diff capture and verify diffs are present in emitted events when file list changes.

**New: `test/file-diffs-db.test.ts`**: Test `insertFileDiffs`, `getFileDiff`, `getFileDiffs`, and `cleanupOldSessions` against a temp SQLite DB.

### 10. No UI changes required

The diff viewer already handles `{ diff: string | null }` responses. The simplified endpoint returns the same shape.

## Scope

### In scope

| File | Change |
|------|--------|
| `src/engine/events.ts` | Add optional `diffs`, `baseBranch` to event type |
| `src/engine/pipeline.ts` | New `captureFileDiffs()`, update emission sites |
| `src/engine/config.ts` | New `monitor.retentionCount` config field + defaults |
| `src/monitor/db.ts` | New table, queries, retention policy |
| `src/monitor/recorder.ts` | Extract diffs into `file_diffs` table on recording |
| `src/monitor/server.ts` | Replace `serveDiff()`, remove 4 resolve functions, trigger cleanup |
| `docs/config.md` | Document `monitor.retentionCount` |
| `CLAUDE.md` | Add `monitor` to config merge docs |
| `test/files-changed-event.test.ts` | Test new optional fields |
| `test/periodic-file-check.test.ts` | Test diff capture in events |
| `test/file-diffs-db.test.ts` | New: test DB queries and retention |

### Out of scope

- UI changes (the diff viewer already handles the response shape)
- Changes related to the `--no-ff` merge strategy (independent concern)

## Acceptance Criteria

1. `pnpm type-check` passes - type safety across all changes
2. `pnpm test` passes - all existing and new tests pass
3. `build:files_changed` events include optional `diffs` and `baseBranch` fields; old events without these fields remain compatible
4. `captureFileDiffs()` returns per-file diff content from a single `git diff <baseBranch>` call and returns an empty array on failure
5. `file_diffs` table is created in SQLite with proper schema and indexes
6. Recorder extracts diffs into `file_diffs` on `build:files_changed` events and strips them from the serialized event
7. `/api/diff/:sessionId/:planId?file=path` returns `{ diff: string | null }` from a DB query with no git operations
8. `/api/diff/:sessionId/:planId` (bulk) returns `{ files: Array<{ path, diff }> }` from a DB query with no git operations
9. Dead code removed: `resolveCommitSha()`, `resolvePlanBranch()`, `resolveFeatureBranch()`, `resolveCwd()`, and related diff resolution blocks in `serveDiff()`
10. `candidateOrchestrationPaths()` is retained (still used elsewhere)
11. Retention policy: `monitor.retentionCount` config (default 20) triggers cleanup of old sessions on monitor server startup
12. Docs updated: `docs/config.md` documents `monitor.retentionCount`; `CLAUDE.md` includes `monitor` in config merge docs
13. Manual: during an active build, clicking source files in the heatmap shows actual diffs
14. Manual: viewing a completed build's diffs works from the DB with no dependency on git state
