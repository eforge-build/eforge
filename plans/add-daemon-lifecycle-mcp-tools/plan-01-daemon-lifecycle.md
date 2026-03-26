---
id: plan-01-daemon-lifecycle
name: Add daemon lifecycle MCP tools and update restart skill
depends_on: []
branch: add-daemon-lifecycle-mcp-tools/daemon-lifecycle
---

# Add daemon lifecycle MCP tools and update restart skill

## Architecture Context

The eforge daemon runs as a detached process managed via `server-main.ts`. It currently accepts SIGTERM for graceful shutdown (handled in the `shutdown()` function). The MCP proxy (`src/cli/mcp-proxy.ts`) bridges tool calls to daemon HTTP endpoints via `daemonRequest()`. The restart skill currently shells out to `eforge daemon stop/start` CLI commands - it should use MCP tools instead.

The shutdown endpoint needs to live in `server.ts` (where all HTTP routes are defined) and trigger the same graceful shutdown path that SIGTERM uses. The MCP tool needs to check for active builds before stopping, matching the safety behavior of `eforge daemon stop`.

## Implementation

### Overview

1. Add `POST /api/daemon/stop` endpoint to `server.ts` that triggers graceful daemon shutdown
2. Add `eforge_daemon` MCP tool to `mcp-proxy.ts` with `start`, `stop`, and `restart` actions
3. Update `restart.md` to call the new MCP tool instead of shell commands
4. Bump plugin version

### Key Decisions

1. **Single `eforge_daemon` tool with action parameter** rather than three separate tools - follows the existing pattern of `eforge_auto_build` which uses an `action` enum. Keeps the tool namespace clean.

2. **Shutdown via HTTP endpoint + process.exit** - The `POST /api/daemon/stop` endpoint will call `process.exit(0)` after cleanup (or use the same shutdown path triggered by SIGTERM). Since the daemon's `server-main.ts` already handles SIGTERM gracefully (kills watcher, removes lockfile, stops server, closes DB), the endpoint should invoke the same `shutdown()` function. The simplest approach: add a callback `onShutdown` to the server options (like `onSpawnWatcher`/`onKillWatcher`) that `server-main.ts` sets to its local `shutdown()` function. The endpoint calls it.

3. **Active build check in the MCP tool, not the endpoint** - The MCP proxy already has the pattern for checking builds via `GET /api/latest-run` + `GET /api/run-summary/{sessionId}` (used by `eforge_status`). The `stop` action reuses this same check before sending the stop request. The endpoint itself accepts a `force` boolean but does no build checking - it just stops. This keeps the endpoint simple and reusable.

4. **Restart = stop + wait for lockfile removal + ensureDaemon()** - After sending stop, the MCP proxy polls for lockfile removal (like the CLI does with 250ms intervals, up to 5s), then calls `ensureDaemon()` which auto-starts a fresh daemon. This avoids race conditions.

## Scope

### In Scope
- `POST /api/daemon/stop` endpoint with `force` parameter
- `onShutdown` callback in server options interface
- `eforge_daemon` MCP tool with `start`/`stop`/`restart` actions
- Updated restart skill using MCP tool
- Plugin version bump

### Out of Scope
- `src/cli/daemon-client.ts` - no modifications
- `eforge-plugin/mcp/eforge-mcp-proxy.mjs` - no modifications
- CLI `daemon stop` command - unchanged, continues to work via SIGTERM

## Files

### Modify
- `src/monitor/server.ts` - Add `onShutdown` callback to options interface. Add `POST /api/daemon/stop` endpoint that validates daemon mode is active, parses optional `{ force: boolean }` body, and calls `options.onShutdown()`. Returns `{ status: 'stopping' }` before shutdown proceeds.
- `src/monitor/server-main.ts` - Pass `onShutdown: shutdown` in the server options so the HTTP endpoint can trigger the same graceful shutdown path.
- `src/cli/mcp-proxy.ts` - Add `eforge_daemon` tool with three actions:
  - `start`: calls `ensureDaemon(cwd)`, returns port
  - `stop`: checks for active builds via `/api/latest-run` + `/api/run-summary/{sessionId}`, rejects if running and `force` is not true, then calls `POST /api/daemon/stop`, polls for lockfile removal
  - `restart`: runs stop logic then `ensureDaemon(cwd)` for fresh start
- `eforge-plugin/skills/restart/restart.md` - Replace multi-step shell workflow with single `mcp__eforge__eforge_daemon` tool call using action `restart`
- `eforge-plugin/.claude-plugin/plugin.json` - Bump version from `0.5.6` to `0.5.7`

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `eforge_daemon` tool is registered in `mcp-proxy.ts` with `start`, `stop`, and `restart` actions
- [ ] `POST /api/daemon/stop` endpoint exists in `server.ts` and returns 503 when daemon mode is not active
- [ ] `stop` action returns an error message containing "active" or "running" when builds are in progress and `force` is not true
- [ ] `restart.md` references `mcp__eforge__eforge_daemon` and does not contain `eforge daemon stop` or `eforge daemon start` shell commands
- [ ] Plugin version in `plugin.json` is higher than `0.5.6`
