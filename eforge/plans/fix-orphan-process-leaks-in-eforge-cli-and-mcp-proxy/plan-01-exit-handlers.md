---
id: plan-01-exit-handlers
name: CLI and MCP proxy exit handlers
branch: fix-orphan-process-leaks-in-eforge-cli-and-mcp-proxy/exit-handlers
---

# CLI and MCP proxy exit handlers

## Architecture Context

The eforge CLI's `setupSignalHandlers` in `packages/eforge/src/cli/index.ts:34-49` currently registers handlers only for `SIGINT` and `SIGTERM`. The handler aborts the in-flight engine work, stops spinners, and calls `activeMonitor.stop()` (which is `db.close()` in `packages/monitor/src/index.ts:115-117`). It then arms a 5s `process.exit(130)` watchdog timer.

Two gaps cause the orphan-process leaks documented in the PRD:

1. **CLI process leaks (Leak B).** `SIGHUP` (sent when the controlling terminal/SSH session drops), `uncaughtException`, and `unhandledRejection` are not registered. When any of these fires, the process can exit without ever running `monitor.stop()`, which leaves SQLite WAL/shm handles open and a zombie `eforge` process lingering in `Ss` state. The same gap also covers the `eforge queue exec` (`packages/eforge/src/cli/index.ts:368-436`) and `eforge build`/`eforge run` paths, which all funnel through `setupSignalHandlers` via `run()` -> `createProgram()`.
2. **MCP proxy leaks (Leak A).** `packages/eforge/src/cli/index.ts:836-843` registers the `mcp-proxy` command which calls `runMcpProxy(process.cwd())`. `runMcpProxy` (in `packages/eforge/src/cli/mcp-proxy.ts`, lines 92-1004) connects an `StdioServerTransport` to the `McpServer` but never observes `process.stdin` lifecycle events. When Claude Code (the parent) is killed, our stdin half-closes, but Node keeps the proxy alive because the MCP SDK has no reaper for orphaned-parent. Result: 10+ `eforge-mcp` processes accumulate with ages 8-17 days.

The fix is purely additive: extend the existing handler installation with the three missing process-level events, and add two stdin listeners in the MCP proxy. No new helpers are needed - `monitor.stop()` is already the single point of cleanup in `buildMonitor()` and is wired through `activeMonitor` in `setupSignalHandlers`.

## Implementation

### Overview

- Rename and extend `setupSignalHandlers` to register handlers for `SIGINT`, `SIGTERM`, `SIGHUP`, `uncaughtException`, and `unhandledRejection`. The handler body is shared, but exception/rejection variants must log the underlying error to stderr (so the cause is not silently swallowed) before invoking the same teardown path.
- Guard against re-entry: if the handler fires twice (e.g. `SIGHUP` followed by an `uncaughtException` from in-flight teardown), the second invocation must be a no-op so we do not double-close the DB.
- Adjust the watchdog exit code: `SIGINT/SIGTERM/SIGHUP` exit with 130; `uncaughtException`/`unhandledRejection` exit with 1.
- In `packages/eforge/src/cli/mcp-proxy.ts`, attach `process.stdin.on('close', ...)` and `process.stdin.on('end', ...)` listeners inside `runMcpProxy`, after `server.connect(transport)` returns. Both call `process.exit(0)`.

### Key Decisions

1. **Reuse `setupSignalHandlers` rather than introducing a new lifecycle module.** The handler body already does the right thing (abort + stopAllSpinners + activeMonitor.stop + watchdog). The minimum-surface change is to register the three missing events against the same closure. Keeping all process-level wiring in one helper preserves the existing single-source-of-truth invariant.
2. **Re-entry guard via a closed-over boolean flag.** A simple `let teardownStarted = false;` inside `setupSignalHandlers` is sufficient; the watchdog timer already handles the case where teardown hangs. We do not need a second `AbortController` or external mutex.
3. **Log exception cause before teardown.** For `uncaughtException` and `unhandledRejection`, write the error to `process.stderr` before invoking the shared teardown so operators can diagnose the underlying crash. The shared teardown path remains identical otherwise.
4. **Stdin listeners in `runMcpProxy`, not at module scope.** Attaching the listeners inside `runMcpProxy` keeps the proxy's lifecycle co-located with its `StdioServerTransport` and avoids leaking listeners if (theoretically) the proxy were ever invoked from another entrypoint.
5. **`process.exit(0)` from the stdin listeners.** A closed stdin from Claude Code is a clean parent-shutdown, not a crash, so 0 is the right exit code. We do not attempt to drain in-flight tool calls - the daemon HTTP API tolerates abandoned MCP requests.

## Scope

### In Scope
- `packages/eforge/src/cli/index.ts` - extend `setupSignalHandlers` with `SIGHUP`, `uncaughtException`, `unhandledRejection`; add re-entry guard; surface exception cause to stderr.
- `packages/eforge/src/cli/mcp-proxy.ts` - add `process.stdin.on('close', ...)` and `process.stdin.on('end', ...)` handlers inside `runMcpProxy`, wired to `process.exit(0)`.
- `test/cli-exit-handlers.test.ts` (new) - covers (a) SIGTERM during a simulated `eforge build` triggers `monitor.stop()`; (b) closing stdin on the MCP proxy triggers `process.exit(0)`. See `Verification` for shape.

### Out of Scope
- Cleaning up currently-running orphan processes - the PRD explicitly defers this.
- The `disable-auto-build-when-a-queued-build-fails` cascade fix (separate in-flight PRD).
- Adding an `eforge daemon cleanup` helper command.
- Any change to `packages/monitor/src/index.ts` - `buildMonitor.stop()` is already the single cleanup point and needs no modification.
- Any change to `withMonitor` / `withRunMonitor` - their `finally` blocks remain the happy-path cleanup; the new exit handlers cover the abrupt-termination paths only.

## Files

### Create
- `test/cli-exit-handlers.test.ts` - vitest covering the new SIGTERM-driven `monitor.stop()` invocation and the MCP proxy stdin-close exit. Test approach below.

### Modify
- `packages/eforge/src/cli/index.ts` - extend `setupSignalHandlers` with SIGHUP / uncaughtException / unhandledRejection and a re-entry guard; surface exception cause to stderr; choose exit code per signal vs exception. Keep `SIGINT`/`SIGTERM` behavior byte-identical.
- `packages/eforge/src/cli/mcp-proxy.ts` - register `process.stdin.on('close')` and `process.stdin.on('end')` listeners inside `runMcpProxy`, after `server.connect(transport)` resolves; both call `process.exit(0)`.

## Test Approach

The new test file uses the project's standing convention: no mocks, real code, fixtures only for I/O. Two test groups:

1. **`setupSignalHandlers` group.** Import `setupSignalHandlers` (export it from `packages/eforge/src/cli/index.ts` if not already exported - verify before edit). For each of `SIGTERM`, `SIGHUP`, and a synthetic `uncaughtException` emit, assert: the returned `AbortController` is aborted; a stub `Monitor` whose `stop()` is a `vi.fn()` (constructed inline, cast through `unknown` per project convention) has its `stop()` called exactly once even when the handler fires twice. Use `process.emit('SIGTERM')` / `process.emit('SIGHUP')` / `process.emit('uncaughtException', new Error('boom'))` to drive the handlers in-process. Stub `process.exit` to capture the exit code without terminating the test runner. Restore listeners in `afterEach` to keep the test file isolated.
2. **`runMcpProxy stdin close` group.** Spawn `runMcpProxy` against a `cwd` pointing at a `mkdtempSync` fixture so daemon discovery is inert. Pipe `process.stdin` from a `PassThrough`-based fixture (or fork a child node process via `child_process.fork` running a tiny harness script that imports `runMcpProxy`). After `runMcpProxy` returns, emit `end` then `close` on the proxy's stdin and assert the child exits with code 0 within ~1s. If forking proves too heavyweight, the test may instead extract the stdin-handler installation into a tiny exported helper (`installStdinExitHandlers(stdin)`) and test that helper directly with a `PassThrough` - decide during implementation. Either approach is acceptable as long as the assertion proves stdin `close` and `end` each cause `process.exit(0)`.

## Verification

- [ ] `packages/eforge/src/cli/index.ts` registers handlers for `SIGINT`, `SIGTERM`, `SIGHUP`, `uncaughtException`, and `unhandledRejection` in `setupSignalHandlers`.
- [ ] On any of those events, `activeMonitor.stop()` is invoked exactly once even if the handler fires more than once (verified via vitest `toHaveBeenCalledTimes(1)` after emitting two events).
- [ ] `uncaughtException` and `unhandledRejection` paths write the error message to `process.stderr` (verified by spying on `process.stderr.write` in vitest).
- [ ] Signal-driven exits use code 130; exception/rejection-driven exits use code 1 (verified by stubbing `process.exit`).
- [ ] `packages/eforge/src/cli/mcp-proxy.ts` `runMcpProxy` attaches listeners to `process.stdin` for both `close` and `end` events, each invoking `process.exit(0)`.
- [ ] Test asserting that emitting `end` on the proxy's stdin triggers `process.exit(0)` passes.
- [ ] Test asserting that emitting `close` on the proxy's stdin triggers `process.exit(0)` passes.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0 with the new test file passing.
- [ ] `pnpm build` exits 0 and produces `packages/eforge/dist/cli.js`.