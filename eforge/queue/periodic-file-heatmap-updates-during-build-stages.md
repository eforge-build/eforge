---
title: Periodic File Heatmap Updates During Build Stages
created: 2026-03-31
status: pending
---



# Periodic File Heatmap Updates During Build Stages

## Problem / Motivation

The monitor's File Heatmap only updates when a build stage completes, not during execution. `build:files_changed` events are emitted by `emitFilesChanged()` only at stage boundaries (after implement, review-fix, doc-update, test-write). During the long-running `implement` stage (builder agent), the heatmap shows nothing for that plan for minutes until the builder finishes and commits. Users lack near-real-time visibility into which files are being modified.

## Goal

Provide near-real-time file heatmap updates during long-running build stages by periodically checking for changed files and emitting `build:files_changed` events every 15 seconds, without requiring changes to event types, the frontend reducer, or the heatmap UI.

## Approach

Add a `withPeriodicFileCheck` async generator wrapper that interleaves periodic `build:files_changed` events into any agent event stream:

- Uses `Promise.race` between the next agent event and a 15-second timer
- When the timer fires, runs `git diff --name-only` against the base branch in `ctx.worktreePath` and yields a file change event if the file list has changed since the last emission
- On agent event: yields it, clears unused timer, checks if interval elapsed and emits if so
- `finally` block calls `iterator.return()` for cleanup
- Timer uses `.unref()` to not keep the process alive

Applied to all long-running agent `for await` loops in build stages. The existing `yield* emitFilesChanged(ctx)` calls at stage end remain - they are idempotent (frontend overwrites the same Map key, and the wrapper deduplicates by comparing file lists).

### Changes

#### `src/engine/pipeline.ts`

1. Add constant `FILE_CHECK_INTERVAL_MS = 15_000` near existing `emitFilesChanged` (~line 950)
2. Add `arraysEqual(a: string[], b: string[]): boolean` helper (private)
3. Add `withPeriodicFileCheck(inner, ctx)` async generator wrapper (private) with the behavior described above
4. Wrap agent generators in these stages:
   - **Implement stage** (line ~995): `withPeriodicFileCheck(builderImplement(...), ctx)`
   - **Review-fix** (`reviewFixStageInner`, line ~1149): `withPeriodicFileCheck(runReviewFixer(...), ctx)`
   - **Doc-update** (line ~1248): `withPeriodicFileCheck(runDocUpdater(...), ctx)`
   - **Test-write** (line ~1294): `withPeriodicFileCheck(runTestWriter(...), ctx)`
   - **Test** (`testStageInner`, line ~1330): `withPeriodicFileCheck(runTester(...), ctx)`

#### `test/periodic-file-check.test.ts` (new)

Test the wrapper in isolation:
- Inner events pass through unchanged
- File change events emitted when timer fires and file list differs
- Deduplication: same file list not re-emitted
- Silent on git failure
- Cleanup: `iterator.return()` called on early termination

Use `vi.useFakeTimers()` for time control and mock `exec` for git diff output. Use `StubBackend` pattern or hand-crafted async generators for inner event sources.

#### `src/monitor/mock-server.ts` (optional)

Add progressive `build:files_changed` events during implement phases so the mock monitor demo shows the progressive heatmap fill.

## Scope

**In scope:**
- `src/engine/pipeline.ts` - main changes (constant, helpers, wrapper, wrapping agent generators)
- `test/periodic-file-check.test.ts` - new test file
- `src/monitor/mock-server.ts` - optional demo improvement

**Out of scope:**
- Changes to event types
- Changes to the frontend reducer
- Changes to the heatmap UI

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm test` passes - all existing tests plus new tests in `test/periodic-file-check.test.ts`
- `pnpm build` builds cleanly
- New tests verify: inner events pass through unchanged, file change events emitted when timer fires and file list differs, same file list is not re-emitted (deduplication), silent on git failure, `iterator.return()` called on early termination
- Running a multi-plan build shows the monitor heatmap updating during the implement stage before the builder commits
