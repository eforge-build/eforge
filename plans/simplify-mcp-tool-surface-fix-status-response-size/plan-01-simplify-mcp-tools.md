---
id: plan-01-simplify-mcp-tools
name: Simplify MCP Tool Surface and Fix Status Response Size
depends_on: []
branch: simplify-mcp-tool-surface-fix-status-response-size/simplify-mcp-tools
---

# Simplify MCP Tool Surface and Fix Status Response Size

## Architecture Context

The eforge MCP proxy (`src/cli/mcp-proxy.ts`) bridges Claude Code to the eforge daemon's HTTP API. It currently registers 8 tools, but 3 are redundant — Claude Code can run `git diff` directly, read plan files from disk, and `eforge_events` duplicates `eforge_status` (same `/api/run-state/:id` endpoint). Additionally, `eforge_status` returns the full event stream (potentially 1.2M+ chars), making it unusable as an MCP response.

This plan removes the 3 redundant tools, adds a compact summary endpoint to the monitor server, and points `eforge_status` at it.

## Implementation

### Overview

1. Add `GET /api/run-summary/:id` to the monitor server that computes a compact summary from DB records
2. Remove `eforge_events`, `eforge_plans`, and `eforge_diff` tool registrations from the MCP proxy
3. Change `eforge_status` to call `/api/run-summary/:id` instead of `/api/run-state/:id`
4. Bump plugin version to `0.4.0`
5. Update the status skill to remove the `eforge_events` reference

### Key Decisions

1. **Summary computation is server-side** — The monitor server already has DB access with `getSessionRuns()`, `getEventsBySession()`, and `getEventsByTypeForSession()`. Building the summary there avoids sending megabytes of events over the wire to the MCP proxy.

2. **Reuse existing DB methods** — No new DB queries needed. `getSessionRuns()` provides run metadata, `getEventsByTypeForSession()` can fetch specific event types (e.g., `build:start`, `build:complete`, `build:failed`, `phase:start`) to extract plan status and current phase/agent info. `getEventsBySession()` with no `afterId` provides the total event count.

3. **Summary shape** — The response includes session status, run list, plan progress, current phase/agent, event counts, and duration. This is sufficient for status checking without streaming the full event log.

## Scope

### In Scope
- Remove `eforge_events`, `eforge_plans`, `eforge_diff` from MCP proxy
- Add `GET /api/run-summary/:id` endpoint to monitor server
- Change `eforge_status` to use the new summary endpoint
- Bump plugin version to `0.4.0` in `eforge-plugin/.claude-plugin/plugin.json`
- Update `eforge-plugin/skills/status/status.md` to remove `eforge_events` reference

### Out of Scope
- Removing the existing `/api/run-state/:id`, `/api/plans/:runId`, `/api/diff/:sessionId/:planId` HTTP endpoints (the monitor web UI or other consumers may still use them)
- Updating `eforge-plugin/mcp/eforge-mcp-proxy.js` and `.mjs` files (stale copies not referenced by plugin config)

## Files

### Modify
- `src/monitor/server.ts` — Add `GET /api/run-summary/:id` route handler that computes a compact summary object from `db.getSessionRuns()` and `db.getEventsByTypeForSession()`. The summary includes: `sessionId`, `status` (running/completed/failed/unknown), `runs` array (id, command, status, startedAt, completedAt), `plans` array (id, status, branch, dependsOn — extracted from `build:start`/`build:complete`/`build:failed` events), `currentPhase` (from latest `phase:start`), `currentAgent` (from latest `agent:start` event without a matching `agent:stop`), `eventCounts` (total + errors via a count query on session events), and `duration` (computed from session start/end times). Insert the new route before the existing `/api/run-state/` handler in the request routing.
- `src/cli/mcp-proxy.ts` — Delete the `eforge_events` tool registration (lines 195-204), `eforge_plans` tool registration (lines 206-215), and `eforge_diff` tool registration (lines 217-232). Change the `eforge_status` handler to call `/api/run-summary/:id` instead of `/api/run-state/:id`. Update the MCP server version from `0.3.0` to `0.4.0`.
- `eforge-plugin/.claude-plugin/plugin.json` — Change `"version": "0.3.0"` to `"version": "0.4.0"`
- `eforge-plugin/skills/status/status.md` — Line 57: Replace `suggest checking events with \`mcp__eforge__eforge_events\`` with guidance to use `/eforge:status` again or check the monitor dashboard

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm build` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `src/cli/mcp-proxy.ts` contains exactly 5 `server.tool(` calls (eforge_run, eforge_enqueue, eforge_status, eforge_queue_list, eforge_config)
- [ ] `src/cli/mcp-proxy.ts` does not contain the strings `eforge_events`, `eforge_plans`, or `eforge_diff`
- [ ] `src/cli/mcp-proxy.ts` calls `/api/run-summary/` instead of `/api/run-state/`
- [ ] `src/monitor/server.ts` handles `GET /api/run-summary/:id` and returns JSON with keys: `sessionId`, `status`, `runs`, `plans`, `currentPhase`, `currentAgent`, `eventCounts`, `duration`
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has `"version": "0.4.0"`
- [ ] `eforge-plugin/skills/status/status.md` does not contain `eforge_events`
- [ ] MCP server version string in `mcp-proxy.ts` is `0.4.0`
