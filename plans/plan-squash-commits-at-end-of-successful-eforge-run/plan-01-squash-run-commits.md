---
id: plan-01-squash-run-commits
name: Squash Run Commits
depends_on: []
branch: plan-squash-commits-at-end-of-successful-eforge-run/squash-run-commits
---

# Squash Run Commits

## Architecture Context

The engine emits typed `EforgeEvent`s through `AsyncGenerator` and consumers (CLI, monitor) render them. The `build()` method in `EforgeEngine` already has a post-orchestration section where cleanup runs on success. Squashing slots in right before cleanup in that same section. The CLI `run` command and `runQueue()` are the two callers of `build()` - both need to capture the pre-enqueue HEAD hash and thread it through `BuildOptions`.

## Implementation

### Overview

Add a squash step that collapses all intermediate commits from a successful eforge run into one content commit, then consolidate plan file + PRD removal into a single cleanup commit. Two new event types (`squash:start`, `squash:complete`) follow the existing event pattern. The CLI captures HEAD before enqueue and passes it through to `build()`.

### Key Decisions

1. **Squash uses `git reset --soft` + `git commit`** - safe, non-destructive approach that preserves the working tree. The `--soft` reset moves HEAD back to the base hash while keeping all changes staged, then a single commit captures everything.
2. **`squashBaseHash` and `prdFilePath` are optional on `BuildOptions`** - the engine's `build()` is a public API. Making these optional means external callers don't break. When `squashBaseHash` is absent, squash is skipped. When `prdFilePath` is absent, cleanup omits PRD removal.
3. **PRD cleanup moves into `cleanupPlanFiles()`** - currently the CLI calls `cleanupCompletedPrd()` separately after `build()` completes. Moving it inside `cleanupPlanFiles()` consolidates two cleanup commits into one. The `cleanupCompletedPrd()` function in `prd-queue.ts` still exists for other callers (like `runQueue()` standalone) but the CLI `run` handler no longer calls it.
4. **`composeSquashMessage()` derives prefix from `mode`** - `errand` maps to `fix`, everything else maps to `feat`. Scope comes from `orchConfig.name`, subject from `orchConfig.description`, body lists plan names.
5. **Guard for single-commit runs** - when `commitCount <= 1`, squash is a no-op. This handles trivial errands that produce only one commit.

## Scope

### In Scope
- New `squash:start` and `squash:complete` event types in the `EforgeEvent` union
- New `squashBaseHash` and `prdFilePath` fields on `BuildOptions`
- `squashRunCommits()` and `composeSquashMessage()` private functions in `eforge.ts`
- Modified `cleanupPlanFiles()` to accept optional `prdFilePath` for consolidated cleanup
- Modified `build()` to run squash before cleanup when `squashBaseHash` is provided
- Modified `runQueue()` to capture HEAD before compile and pass `squashBaseHash` + `prdFilePath` to `build()`
- CLI `run` handler captures HEAD before enqueue, passes both fields to `build()`, removes separate `cleanupCompletedPrd()` call
- CLI display rendering for squash events

### Out of Scope
- Squash on failed runs
- Changes to the monitor or other event consumers
- New unit tests for squash (pure git ops)

## Files

### Modify
- `src/engine/events.ts` — Add `squash:start` and `squash:complete` to the `EforgeEvent` union. Add `squashBaseHash?: string` and `prdFilePath?: string` to `BuildOptions`.
- `src/engine/eforge.ts` — Add `squashRunCommits()` async generator (counts commits from base hash, yields `squash:start`, runs `git reset --soft` + `git commit`, yields `squash:complete`). Add `composeSquashMessage()` (builds commit message from `OrchestrationConfig` fields: mode → prefix, name → scope, description → subject, plan names → body). Modify `cleanupPlanFiles()` to accept optional `prdFilePath` parameter - when provided, also `git rm` the PRD file and its empty parent dir before committing, and adjust commit message to include "and PRD". Modify `build()` to call `squashRunCommits()` after orchestrator succeeds and before cleanup when `options.squashBaseHash` is present. Modify `runQueue()` to capture HEAD via `getHeadHash()` before `this.compile()`, then pass `squashBaseHash` and `prdFilePath` (from `prd.filePath`) to `this.build()`, and remove the separate `cleanupCompletedPrd()` call for successful builds (cleanup is now inside `build()`).
- `src/cli/index.ts` — In the `run` command handler: capture `const squashBaseHash = await getHeadHash(process.cwd())` before `engine.enqueue()`, pass `squashBaseHash` and `prdFilePath: enqueuedFilePath` to `engine.build()`. Remove the post-build `cleanupCompletedPrd()` call at lines 362-368 and the `updatePrdStatus` fallback. Import `getHeadHash` from `../engine/prd-queue.js`.
- `src/cli/display.ts` — Add `case 'squash:start':` (calls `startSpinner('squash', ...)`) and `case 'squash:complete':` (calls `succeedSpinner('squash', ...)`) in the `renderEvent` switch, placed between the `cleanup:complete` case and the `plan:profile` case.

## Verification

- [ ] `pnpm type-check` exits 0 with the new event types and extended `BuildOptions`
- [ ] `pnpm build` exits 0
- [ ] `pnpm test` — all existing tests pass with 0 failures
- [ ] The `renderEvent` switch in `display.ts` still has an exhaustive `never` default (no TypeScript errors from unhandled event types)
- [ ] `squashRunCommits()` returns early (no events yielded) when `commitCount <= 1`
- [ ] `squashRunCommits()` yields `squash:start` with `commitCount` before `git reset --soft`
- [ ] `squashRunCommits()` yields `squash:complete` with the short hash of the new squashed commit
- [ ] `composeSquashMessage()` returns `fix(name): description` when mode is `errand`, `feat(name): description` otherwise
- [ ] `composeSquashMessage()` includes a body listing plan names with their IDs
- [ ] `cleanupPlanFiles()` commits with message `cleanup(planSet): remove plan files and PRD` when `prdFilePath` is provided
- [ ] `cleanupPlanFiles()` commits with message `cleanup(planSet): remove plan files after successful build` when `prdFilePath` is absent
- [ ] In the CLI `run` handler, `squashBaseHash` is captured before `engine.enqueue()` (not after)
- [ ] In the CLI `run` handler, `cleanupCompletedPrd()` and `updatePrdStatus()` calls after `consumeEvents` for the build phase are removed
- [ ] In `runQueue()`, `squashBaseHash` is captured before `this.compile()` for each PRD
- [ ] In `runQueue()`, the separate `cleanupCompletedPrd()` call is removed - cleanup flows through `build()` via `prdFilePath`
- [ ] `build()` only calls `squashRunCommits()` when `status === 'completed'` and `options.squashBaseHash` is truthy
- [ ] `build()` passes `options.prdFilePath` to `cleanupPlanFiles()` when cleanup runs
