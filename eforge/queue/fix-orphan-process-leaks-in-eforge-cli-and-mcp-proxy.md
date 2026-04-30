---
title: Fix orphan-process leaks in eforge CLI and MCP proxy
created: 2026-04-30
---

# Fix orphan-process leaks in eforge CLI and MCP proxy

## Problem / Motivation

Investigation of repeated "compile failed" notifications surfaced two real process leaks (separate from the in-flight auto-build-on-failure cascade fix):

**Leak A — `eforge-mcp` proxy processes.** 10+ orphaned `eforge-mcp` processes (the MCP bridge for Claude Code), ages 8–17 days. Each Claude Code session that loads the eforge plugin spawns a new bridge via `eforge-plugin/bin/eforge-mcp-proxy.mjs`, but old ones aren't reaped when Claude Code exits.

**Leak B — `eforge` CLI processes holding SQLite handles.** 13+ `eforge` CLI processes with `cwd` in another project (`eforge-build/eval/results`), ages back ~5 days. Each holds `monitor.db`, `monitor.db-wal`, `monitor.db-shm` open in state `Ss` (session leader, sleeping). They are not listening on TCP — they're CLI invocations (`eforge build` / `eforge run` / `eforge queue exec`) that exited their primary work but never released the SQLite handles. The lockfile-based reconciler in `packages/monitor/src/server-main.ts:227-235` doesn't detect them because they're not daemons.

These accumulate over time and indicate exit handling is incomplete.

## Goal

Prevent **future** orphan-process leaks via two structural fixes:

1. CLI processes (`eforge build`, `eforge run`, `eforge queue exec`) close their SQLite DB handle on abnormal termination (SIGTERM, SIGHUP from parent SSH dropping, unhandled rejection), not just on the happy path.
2. The MCP proxy detects when its parent Claude Code process dies abruptly and exits cleanly.

## Approach

**Critical files:**

- `packages/eforge/src/cli/index.ts` — entrypoints for `eforge build`, `eforge run`, `eforge queue exec`. Add `process.on('SIGTERM')`, `process.on('SIGHUP')`, and `process.on('uncaughtException')` handlers that invoke the existing `monitor.stop()` path before exiting. Currently `monitor.stop()` only runs in the `finally` of `withRunMonitor` (`packages/eforge/src/cli/run-or-delegate.ts:160`), which is bypassed by abrupt termination.
- `packages/monitor/src/index.ts:108-119` — `buildMonitor`'s `stop()` is already the single point of cleanup (calls `db.close()`). Wire process-level exit handlers to call it; no new helper needed.
- `packages/eforge/src/cli/mcp-proxy.ts` — add `process.stdin.on('close', () => process.exit(0))` and `process.stdin.on('end', () => process.exit(0))`. The MCP protocol uses stdio, so a closed stdin means the parent (Claude Code) is gone. Today there's no such handler, so the proxy lingers.

**Reuse, don't reinvent:** `killPidIfAlive` and `isPidAlive` are already exported from `@eforge-build/client`. No new helpers needed.

## Scope

**In scope:**

- Exit-handler wiring in CLI entrypoints (`packages/eforge/src/cli/index.ts`)
- stdin-close detection in MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`)
- Tests covering the new exit paths

**Out of scope:**

- Cleaning up currently-running orphan processes (separate task — will be tackled later)
- The `disable-auto-build-when-a-queued-build-fails` cascade fix (already in flight as a separate PRD)
- Adding an `eforge daemon cleanup` helper command (deferred — depends on the cleanup task being scoped)

## Acceptance Criteria

1. Sending `kill -TERM <pid>` to a running `eforge build` process closes the SQLite DB cleanly — no leftover `monitor.db-shm` handle holder, no orphan `eforge` process in `ps`.
2. Killing a Claude Code session (SIGKILL the parent) closes the corresponding `eforge-mcp` proxy within ~1 second.
3. New tests cover: (a) SIGTERM during `eforge build` triggers `monitor.stop()`; (b) closing stdin on the MCP proxy triggers `process.exit(0)`.
4. `pnpm test`, `pnpm type-check`, and `pnpm build` all pass.
