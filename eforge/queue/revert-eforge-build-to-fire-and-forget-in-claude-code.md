---
title: Revert `/eforge:build` to fire-and-forget in Claude Code
created: 2026-04-22
depends_on: ["hardening-10-plugin-and-pi-skill-parity"]
---

# Revert `/eforge:build` to fire-and-forget in Claude Code

## Problem / Motivation

Plan-02 added `mcp__eforge__eforge_follow` and updated the Claude Code build skill (`eforge-plugin/skills/build/build.md`) and the Pi build skill to call it after enqueue. The intent: stream phase / files-changed / review-issue events as MCP `notifications/progress` so the user sees inline progress, and return a final summary to the conversation.

In practice, inside Claude Code this looks broken:

1. **No progress is visible.** Claude Code's documented MCP behavior does not include surfacing `notifications/progress` inline. The tool emits them (mcp-proxy.ts:275-289) but they go nowhere visible to the user.
2. **The tool blocks the main agent thread.** `eforge_follow` waits for `session:end` from the daemon SSE stream (session-stream.ts:285-301) with a 30-minute internal timeout (mcp-proxy.ts:247).
3. **It often "completes" as a timeout, not a completion.** Two plausible causes, both bad UX either way:
   - Claude Code's own MCP transport has an undocumented per-tool-call timeout that fires before our 30-minute one. The outer `AbortSignal` propagates into `subscribeToSession`, which rejects with `AbortError`, which we map to `{ status: "aborted", message: "..." }` and `isError: true` (mcp-proxy.ts:314-328).
   - The build's `session:end` event is consumed correctly, but happens just after the transport times out.

The eforge daemon and SSE replay (monitor/server.ts:199-260) are working - the issue is the skill's decision to block in the agent loop on a 30-min stream when:

- the conversation can't see progress notifications anyway,
- the monitor URL already gives a live web UI,
- the daemon is fully async by design (auto-build, queue-first).

Pi is a different story: Pi's UI does surface `notifications/progress` and the transport doesn't impose a hidden tool timeout, so `eforge_follow` works there. This change keeps Pi's build skill untouched.

## Goal

Revert the Claude Code `/eforge:build` skill to fire-and-forget behavior so the tool call returns quickly and points users at the monitor URL / `/eforge:status` for progress, while leaving the Pi path and the `eforge_follow` MCP tool registration intact.

## Approach

Revert the **Claude Code** build skill to fire-and-forget. Keep the `eforge_follow` MCP tool registered (Pi consumes it; users can call it explicitly) - only the skill stops auto-invoking it.

This is the simplest fix. The "background task / subagent" alternative was considered: spawn an Agent that runs `eforge_follow` and reports back. Rejected as overkill - a full subagent context (with its own model, system prompt, and tool budget) just to await a daemon event is expensive, and it doesn't fix the core issue that progress isn't visible in Claude Code anyway. If we later want inline summaries without blocking, we can revisit (e.g., a tiny background hook rather than a full agent).

### Changes

#### `eforge-plugin/skills/build/build.md`

- **Remove Step 6 ("Follow the Build")** entirely (lines 127-141).
- **Update Step 5's success message** to point at the monitor URL and `/eforge:status` for progress, since the skill no longer blocks for completion. Restore wording similar to pre-plan-02: "PRD enqueued. Watch live at {monitorUrl} or run `/eforge:status` for progress."
- Leave the related-skills row pointing at `/eforge:status` as-is (already there at line 162).

#### `eforge-plugin/.claude-plugin/plugin.json`

- Bump the plugin version. Per AGENTS.md: "always bump the plugin version when changing anything in the plugin." This is a behavior change for `/eforge:build`, so the bump is required.

## Scope

### In scope

- `eforge-plugin/skills/build/build.md` - remove Step 6, update Step 5 message.
- `eforge-plugin/.claude-plugin/plugin.json` - bump plugin version.

### Out of scope (files **not** changed)

- `packages/eforge/src/cli/mcp-proxy.ts` - keep `eforge_follow` registered. Pi uses it; advanced Claude Code users can call it explicitly.
- `packages/client/src/session-stream.ts` - no change. The subscriber is correct.
- `packages/monitor/src/server.ts` - no change. SSE endpoint is correct.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` - keep `eforge_follow` step. Pi surfaces progress notifications and doesn't have the transport-timeout problem.

### Open question (optional, not blocking)

If we later decide we *do* want inline build summaries in Claude Code without blocking, the cleanest path is probably a stop-hook that polls `/api/sessions/{sessionId}` and posts a one-line summary into the conversation when the build settles - not a subagent, not a long-blocking tool. Out of scope for this fix.

## Acceptance Criteria

1. `pnpm build` - bundles the plugin and CLI.
2. `pnpm test` - confirms nothing relying on the skill's text content broke (none expected; skill is markdown).
3. Restart the eforge daemon via the `/eforge:daemon-restart` skill so the rebuilt MCP server is live.
4. In a Claude Code session in this repo, invoke `/eforge:build` with a small inline source. Confirm:
   - The tool call returns within seconds (no 30-min block).
   - The user-facing message includes the monitor URL.
   - The daemon picks up the build (verify with `/eforge:status` or by visiting the monitor URL).
5. In a Pi session, invoke the equivalent build skill. Confirm `eforge_follow` is still wired and works there (regression check on the unchanged Pi path).
