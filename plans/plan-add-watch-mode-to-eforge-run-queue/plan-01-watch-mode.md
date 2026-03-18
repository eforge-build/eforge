---
id: plan-01-watch-mode
name: Add Watch Mode to Queue Processing
depends_on: []
branch: plan-add-watch-mode-to-eforge-run-queue/watch-mode
---

# Add Watch Mode to Queue Processing

## Architecture Context

The engine uses an `AsyncGenerator<EforgeEvent>` pattern where methods on `EforgeEngine` yield typed events consumed by the CLI display layer. `runQueue()` is the existing one-shot queue processor - it loads pending PRDs, processes them sequentially, and yields `queue:complete` at the end. Watch mode wraps this in a polling loop without modifying `runQueue()` itself.

The config system uses a Zod schema → TypeScript type → DEFAULT_CONFIG → resolveConfig chain. New config fields follow this same path. CLI flags override config values, and Commander handles parsing.

## Implementation

### Overview

Add a `watchQueue()` async generator method on `EforgeEngine` that wraps `runQueue()` in an outer polling loop. Three new `queue:watch:*` event types communicate watch-mode state to consumers. A configurable poll interval (default 5s) controls how often the engine checks for new PRDs. The CLI gets `--watch` and `--poll-interval` flags on both queue entry points.

### Key Decisions

1. **Wrapper, not modification** - `watchQueue()` delegates to `runQueue()` per cycle, intercepting `queue:complete` to yield `queue:watch:cycle` instead. `runQueue()` stays untouched.
2. **abortableSleep as module-level helper** - A private function in `eforge.ts` that returns a Promise resolving to `true` (aborted) or `false` (timer completed). Uses AbortSignal listener + setTimeout with cleanup on both paths.
3. **Intercept queue:complete mid-watch** - During active watch cycles, `queue:complete` events from `runQueue()` are swallowed and replaced with `queue:watch:cycle`. A final `queue:complete` is emitted only after the watch loop exits.

## Scope

### In Scope
- Three new `queue:watch:*` event types in the `QueueEvent` union
- `watchQueue()` engine method wrapping `runQueue()` with polling
- `abortableSleep` helper with abort signal support
- `watchPollIntervalMs` config field in `prdQueue` section (Zod schema, interface, default, resolver)
- `watch` and `pollIntervalMs` optional fields on `QueueOptions`
- `--watch` and `--poll-interval <ms>` CLI flags on `eforge run --queue` and `eforge queue run`
- CLI routing to `watchQueue()` when `--watch` is set
- Minimal `renderEvent()` cases for the three new event types
- Plugin skill definition update for `--watch`

### Out of Scope
- Monitor UI changes for watch mode (separate PRD)
- Retry logic for failed PRDs
- Filesystem watching via `fs.watch`/inotify
- Changes to `runQueue()` itself

## Files

### Modify
- `src/engine/events.ts` — Add three `queue:watch:*` variants to the `QueueEvent` union type (after line 232): `queue:watch:waiting`, `queue:watch:poll`, `queue:watch:cycle`
- `src/engine/eforge.ts` — Add `watch` and `pollIntervalMs` fields to `QueueOptions` interface. Add module-level `abortableSleep(ms, signal?)` helper. Add `watchQueue()` async generator method on `EforgeEngine` that wraps `runQueue()` in a polling loop with abort support.
- `src/engine/config.ts` — Add `watchPollIntervalMs` to the prdQueue Zod schema (`z.number().int().positive().optional()`), the `EforgeConfig.prdQueue` interface, `DEFAULT_CONFIG.prdQueue` (5000), and `resolveConfig()`.
- `src/cli/index.ts` — Add `--watch` and `--poll-interval <ms>` flags to `eforge run` and `eforge queue run` commands. Route to `engine.watchQueue()` when `--watch` is set. In watch mode, treat Ctrl+C abort as clean exit (code 0).
- `src/cli/display.ts` — Add three cases to `renderEvent()` for `queue:watch:waiting`, `queue:watch:poll`, and `queue:watch:cycle` event types.
- `eforge-plugin/skills/run/run.md` — Update argument-hint, add `--watch` to arguments section, add watch-mode launch and monitor variants.

## Verification

- [ ] `pnpm type-check` passes with zero errors - the exhaustive switch in `display.ts` covers all three new event types
- [ ] `pnpm test` passes - existing tests remain green
- [ ] New unit tests for `abortableSleep`: timer completion returns `false`, abort before timer fires returns `true` without waiting for the full interval
- [ ] New unit tests for `watchQueue`: emits `queue:watch:cycle` (not `queue:complete`) at end of each cycle, emits `queue:watch:waiting` before sleeping, emits `queue:watch:poll` after polling, emits final `queue:complete` after loop exits
- [ ] New unit test for `watchQueue` abort: aborting during idle sleep causes the loop to exit and emit `queue:complete`
- [ ] `QueueOptions.watch` and `QueueOptions.pollIntervalMs` are optional fields that do not break existing callers
- [ ] `eforge.yaml` `prdQueue.watchPollIntervalMs` is accepted by config validation (`eforge config validate`)
- [ ] `--watch` flag is listed in `eforge run --help` and `eforge queue run --help`
- [ ] `--poll-interval` flag is listed in `eforge run --help` and `eforge queue run --help`
- [ ] `eforge-plugin/skills/run/run.md` argument-hint includes `--watch`
