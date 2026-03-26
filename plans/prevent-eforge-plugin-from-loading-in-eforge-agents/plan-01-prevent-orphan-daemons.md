---
id: plan-01-prevent-orphan-daemons
name: Prevent Orphan Daemons
depends_on: []
branch: prevent-eforge-plugin-from-loading-in-eforge-agents/prevent-orphan-daemons
---

# Prevent Orphan Daemons

## Architecture Context

eforge agents inherit all loaded Claude Code plugins, including the eforge plugin itself. The eforge plugin provides MCP tools (`eforge_build`, `eforge_status`, etc.) that, when invoked, call `ensureDaemon()`. When an agent running in a worktree invokes an eforge MCP tool, a new daemon spawns in the worktree (which has no `.eforge/daemon.lock`), creating an orphaned process. Additionally, daemons that never receive events hang forever because the `hasSeenActivity` gate blocks the idle shutdown transition indefinitely.

Two independent fixes: (1) auto-exclude the eforge plugin from agents so its tools are never available, and (2) add a max-wait timeout to the shutdown state machine as a safety net.

## Implementation

### Overview

Three changes across three files:
1. Skip `eforge@*` plugins in `loadPlugins()` before applying include/exclude filters
2. Add `maxWaitForActivityMs` field to `StateCheckContext` and enforce it in `evaluateStateCheck()`
3. Add tests for the new timeout behavior and update existing `makeContext` helper

### Key Decisions

1. Use prefix match (`eforge@`) rather than exact ID match (`eforge@eforge`) - robust against marketplace name changes since the eforge marketplace name is unlikely to be shared by other plugins.
2. Place the self-exclusion check at the top of the plugin loop (before scope filtering) for clarity and early exit.
3. Set `MAX_WAIT_FOR_ACTIVITY_MS = 300_000` (5 minutes) - long enough that a slow-starting build won't trigger it, short enough that orphaned daemons clean up reasonably fast.
4. `maxWaitForActivityMs: 0` disables the timeout, preserving backward compatibility and keeping existing tests passing with minimal changes.

## Scope

### In Scope
- Auto-exclude `eforge@*` plugins in `loadPlugins()` loop
- Add `maxWaitForActivityMs` to `StateCheckContext` interface and `evaluateStateCheck()` logic
- Wire `MAX_WAIT_FOR_ACTIVITY_MS` into both ephemeral and persistent mode `setupStateMachine()` callers
- Add tests for the max-wait timeout (triggers COUNTDOWN, stays WATCHING, disabled when 0)
- Update existing `makeContext` helper to include `maxWaitForActivityMs: 0`

### Out of Scope
- Killing already-orphaned daemons
- Changes to the eforge plugin itself

## Files

### Modify
- `src/engine/eforge.ts` - Add `eforge@` prefix skip at line ~961, inside the `for (const [id, entries] of Object.entries(data.plugins))` loop, before scope filtering. Add a `continue` to the outer loop when `id.startsWith('eforge@')`.
- `src/monitor/server-main.ts` - (1) Add `maxWaitForActivityMs` field to `StateCheckContext` interface. (2) In `evaluateStateCheck()`, inside the `if (!hasSeenActivity)` block (line 79), check if `maxWaitForActivityMs > 0` and `Date.now() - ctx.serverStartedAt >= ctx.maxWaitForActivityMs` - if so, call `ctx.transitionToCountdown()` and set `state = 'COUNTDOWN'`. (3) Add `MAX_WAIT_FOR_ACTIVITY_MS = 300_000` constant. (4) Pass `maxWaitForActivityMs: MAX_WAIT_FOR_ACTIVITY_MS` in both `evaluateStateCheck` call sites inside `setupStateMachine()`.
- `test/monitor-shutdown.test.ts` - (1) Update `makeContext` helper to include `maxWaitForActivityMs: 0` as default (preserves all existing test behavior). (2) Add 3 new tests in a `describe('maxWaitForActivityMs')` block: elapsed exceeds max wait with no activity triggers COUNTDOWN, elapsed below max wait stays WATCHING, and `maxWaitForActivityMs: 0` disables the timeout.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0, including the 3 new `maxWaitForActivityMs` tests
- [ ] `pnpm build` exits with code 0
- [ ] In `loadPlugins()`, a plugin ID starting with `eforge@` hits the `continue` before reaching scope or include/exclude filtering
- [ ] `evaluateStateCheck()` returns `state: 'COUNTDOWN'` when `maxWaitForActivityMs > 0`, `hasSeenActivity` is false, and elapsed time since `serverStartedAt` exceeds `maxWaitForActivityMs`
- [ ] `evaluateStateCheck()` returns `state: 'WATCHING'` when `maxWaitForActivityMs > 0`, `hasSeenActivity` is false, and elapsed time since `serverStartedAt` is below `maxWaitForActivityMs`
- [ ] `evaluateStateCheck()` does not check the timeout when `maxWaitForActivityMs` is 0 (existing behavior preserved)
- [ ] All existing tests in `test/monitor-shutdown.test.ts` pass without modification (the `makeContext` default of `maxWaitForActivityMs: 0` preserves their behavior)
