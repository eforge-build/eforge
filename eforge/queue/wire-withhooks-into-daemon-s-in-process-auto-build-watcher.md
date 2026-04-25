---
title: Wire `withHooks` into daemon's in-process auto-build watcher
created: 2026-04-25
---

# Wire `withHooks` into daemon's in-process auto-build watcher

## Problem / Motivation

User-configured hooks for `session:start` (and any other events emitted by the daemon's in-process auto-build watcher) don't fire for daemon-driven auto-builds.

Investigation showed:
- The watcher in `packages/monitor/src/server-main.ts:387-397` wraps `engine.watchQueue()` only in `withRecording` (DB persistence), not in `withHooks`.
- The `session:start` event for each queued PRD is emitted from the watcher's parent process at `packages/engine/src/eforge.ts:1236-1240` (and `:1485`), so it bypasses the user's hook scripts entirely.
- The CLI flows (`enqueue`, `build`, `queue exec`) wire `withHooks` correctly via `wrapEvents` in `packages/eforge/src/cli/index.ts:74-86` and `packages/eforge/src/cli/run-or-delegate.ts:112-124`, so child subprocesses fire `session:end`, `agent:start`, `agent:stop`, `agent:tool_use` as expected.
- The parent-side `session:start` for daemon-driven auto-builds is silently dropped.

## Goal

User-configured hooks fire for events emitted by the daemon's in-process auto-build watcher, matching the behavior already present in CLI flows.

## Approach

In `packages/monitor/src/server-main.ts` `startWatcher()`, wrap the watcher event stream in `withHooks(events, config.hooks, cwd)` after `withRecording`.

- Import `withHooks` from `@eforge-build/engine/hooks`.
- The resolved `config` is already loaded at module scope in `server-main.ts` and passed to `startServer` (line 446) — make it available to `startWatcher`'s closure (e.g. via the `config` param threaded into the function or via the existing closure).
- The order should be `withHooks(withRecording(events, db, cwd, pid), config.hooks, cwd)` so DB recording happens first and hooks see the same stream that was persisted.

## Scope

**In scope:**
- Wire `withHooks` into the daemon's in-process watcher in `packages/monitor/src/server-main.ts`.
- Add a hooks integration test that verifies a `session:start` hook fires when the daemon watcher schedules a queued PRD (extend `test/hooks.test.ts` or add a daemon-watcher-specific test).

**Out of scope:**
- CLI flows — already wired correctly via `wrapEvents`.
- Child subprocess flows — already wired correctly via `wrapEvents` in `cli/index.ts`.
- Refactoring the parent/child split for session events.
- Changes to the `withHooks` middleware itself or to event names.

## Acceptance Criteria

- A user-configured `session:start` hook fires when the daemon's auto-build watcher schedules a queued PRD.
- All other hooks (`session:end`, `agent:start`, `agent:stop`, `agent:tool_use`) continue to fire from the child subprocess as before.
- Existing `test/hooks.test.ts` passes.
- A new test verifies the daemon watcher's hook dispatch (a hook configured for `session:start` is invoked when the watcher emits the event).
- No regression in DB recording: events are still persisted exactly as before.
- Plugin version bump is NOT required because this change touches `packages/monitor/` and `packages/engine/`, not `eforge-plugin/` — confirm during implementation.
