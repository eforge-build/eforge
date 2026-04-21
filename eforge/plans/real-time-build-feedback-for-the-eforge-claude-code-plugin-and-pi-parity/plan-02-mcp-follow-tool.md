---
id: plan-02-mcp-follow-tool
name: Add eforge_follow MCP tool and deprecate logging forwarder
depends_on:
  - plan-01-client-subscribe-helper
branch: real-time-build-feedback-for-the-eforge-claude-code-plugin-and-pi-parity/mcp-follow-tool
---

# Add eforge_follow MCP tool and deprecate logging forwarder

## Architecture Context

`eforge_build` is fire-and-forget: it POSTs to `/api/enqueue` and returns `{ sessionId, monitorUrl }`. The MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`) currently maintains a daemon-wide SSE subscriber (`startSseSubscriber`, lines 135-278) that auto-discovers new sessions every 10s and forwards every daemon event as an MCP `logging` notification. Claude Code renders those as a side-channel log, not inline in the conversation, so users perceive silence until they manually run `/eforge:status`.

The MCP SDK (`@modelcontextprotocol/sdk` v1.29) supports `notifications/progress` tied to a tool call's `progressToken` from `RequestHandlerExtra._meta.progressToken`. Claude Code renders that as inline live tool progress. This plan adds a new long-running tool, `eforge_follow`, that blocks for the lifetime of a session and streams high-signal events as progress notifications, returning a final summary as the tool result so the outcome lands in the conversation transcript.

Once `eforge_follow` pushes the same information inline via progress, the daemon-wide logging forwarder and 10s auto-discovery poll become redundant. Per the project's "no backward compatibility cruft" rule (`.claude/projects/.../feedback_no_backward_compat.md`), rip them out rather than keep both paths.

Plan-01 landed the shared `subscribeToSession()` helper in `@eforge-build/client`.

## Implementation

### Overview

1. **Register `eforge_follow`** via `server.tool()` in `mcp-proxy.ts` with params `{ sessionId: z.string(), timeoutMs?: z.number().optional() }`. Default timeout 30 minutes (`1_800_000` ms).
2. **Read `extra._meta.progressToken`** from the tool handler's `RequestHandlerExtra`. If absent, still complete the tool call and return the final summary, but skip emitting progress notifications (callers without progress support still get the final result).
3. **Call `subscribeToSession(sessionId, { onEvent, signal })`** from `@eforge-build/client` (introduced in plan-01). The `AbortSignal` comes from `extra.signal` (MCP SDK surfaces tool-call cancellation there) combined with the timeout.
4. **Map events to progress** via a new `eventToProgress(event, counters)` helper kept in the same file. Mapping covers ONLY high-signal events per the source doc:
   - `phase:start` -> `Phase: <phase> starting`
   - `phase:end` -> `Phase: <phase> complete`
   - `build:files_changed` -> `Files changed: N` (also updates running totals)
   - `review:issue` with severity `high` or `critical` -> `Issue (<severity>): <summary>` (lower severities are skipped)
   - `build:failed` / `phase:error` (if present) -> emit progress + let the subscriber resolve naturally; the tool returns with an error-shaped summary
   - Noisy `agent:*` events are deliberately excluded
5. **Emit `notifications/progress`** via `server.server.notification({ method: 'notifications/progress', params: { progressToken, progress, total?, message } })`. Use a monotonically increasing `progress` counter. `total` is left undefined (we don't know total phases in advance).
6. **Return the final summary** from the helper's resolved `SessionSummary` as the tool result: `{ status, phaseCounts, filesChanged, issueCounts, monitorUrl, durationMs }`.
7. **Remove the daemon-wide logging forwarder and 10s auto-discovery poll** entirely: delete `startSseSubscriber`, `buildLoggingData`, `LIST_CHANGED_EVENTS`/`INFO_EVENTS`/`ERROR_EVENTS` filter constants, and its lifecycle wiring at lines 1055-1066. Keep `parseSseChunk` consumers on the plan-01 helper. Remove the call that registers the logging capability if it's no longer needed; if `server.capabilities.logging` is set purely for the forwarder, remove it too.
8. **Update skills** in `eforge-plugin/skills/build/build.md` and `eforge-plugin/skills/status/status.md` to chain `eforge_follow` after enqueue / after detecting a running session, and to report the final summary inline. Skill edits must be project-generic per the `feedback_plugin_candidate_skills` memory.
9. **Bump plugin version** in `eforge-plugin/.claude-plugin/plugin.json` from `0.5.31` to `0.5.32` per the AGENTS.md rule.

### Key Decisions

1. **Keep `eforge_build` fire-and-forget**: source doc is explicit. Queue-first semantics preserved - the tool returns immediately with the sessionId, and the skill chains `eforge_follow` as a follow-up tool call.
2. **Progress without a token is a no-op, not an error**: MCP clients are not required to supply `progressToken`. Silently skip emission; still return the final summary.
3. **Rip out the logging forwarder in the same plan as adding follow**: the source doc calls this out as item 5, and per `feedback_no_backward_compat` there should be no parallel paths. Doing it in the same plan ensures no transient state where both fire.
4. **Map only high-signal events**: the source doc explicitly excludes `agent:*` events from the progress stream. The mapping is a narrow switch on event `type`.
5. **Default timeout 30 minutes, cancellable via abort**: gives long builds room while still bounded. Cancellation propagates through the abort signal to `subscribeToSession`.
6. **Skill updates must be generic**: instructions tell Claude to call `eforge_follow` with the returned sessionId - no project-specific assumptions.

## Scope

### In Scope
- Register `eforge_follow` MCP tool in `packages/eforge/src/cli/mcp-proxy.ts`
- `eventToProgress()` mapping function co-located with the tool (small switch on event `type`)
- Emit `notifications/progress` tied to `progressToken`; skip cleanly when absent
- Return `SessionSummary`-shaped final tool result
- Default 30-minute timeout; honor `extra.signal` for cancellation
- Delete `startSseSubscriber`, its 10s auto-discovery poll, `buildLoggingData`, and the `sendLoggingMessage` fan-out
- Delete the `LIST_CHANGED_EVENTS` / `INFO_EVENTS` / `ERROR_EVENTS` filter constants used only by the forwarder
- Update `eforge-plugin/skills/build/build.md` to instruct Claude to call `eforge_follow` with the returned `sessionId` after `eforge_build` and report the final summary
- Update `eforge-plugin/skills/status/status.md` to offer `eforge_follow` when a session is currently running
- Bump `eforge-plugin/.claude-plugin/plugin.json` version from `0.5.31` to `0.5.32`
- Tests covering `eventToProgress()` output shape for each mapped event type

### Out of Scope
- Pi extension wiring (plan-03)
- Changes to `/api/events/{sessionId}` SSE endpoint
- Changes to `EforgeEvent` definitions
- `DAEMON_API_VERSION` bump (endpoint shape unchanged)
- `eforge_build` contract changes (still fire-and-forget)
- CHANGELOG edits (managed by release flow per project memory)

## Files

### Create
- `test/mcp-follow-event-mapping.test.ts` - unit tests for `eventToProgress()` covering all 6 mapped event types and verifying noisy `agent:*` events are filtered

### Modify
- `packages/eforge/src/cli/mcp-proxy.ts` - register `eforge_follow`; add `eventToProgress()` helper; wire `notifications/progress` via `server.server.notification(...)`; delete `startSseSubscriber`, `buildLoggingData`, SSE filter constants, and 10s auto-discovery call at lines 1055-1066; import `subscribeToSession` from `@eforge-build/client`
- `eforge-plugin/skills/build/build.md` - after the enqueue step, add a step instructing Claude to call `mcp__eforge__eforge_follow` with the returned `sessionId` and render the final summary inline
- `eforge-plugin/skills/status/status.md` - if `eforge_status` reports a running session, offer to call `mcp__eforge__eforge_follow` with that `sessionId`
- `eforge-plugin/.claude-plugin/plugin.json` - bump `version` from `0.5.31` to `0.5.32`

## Verification

- [ ] `pnpm build` completes with zero errors across the workspace
- [ ] `pnpm type-check` returns zero errors
- [ ] `pnpm test -- mcp-follow-event-mapping` passes; tests assert `phase:start` -> message starts with `Phase:`, `build:files_changed` -> message contains `Files changed:`, `review:issue` with `severity: 'low'` returns null (filtered)
- [ ] `grep -n startSseSubscriber packages/eforge/src/cli/mcp-proxy.ts` returns no matches (forwarder deleted)
- [ ] `grep -n LIST_CHANGED_EVENTS packages/eforge/src/cli/mcp-proxy.ts` returns no matches
- [ ] `grep -n eforge_follow packages/eforge/src/cli/mcp-proxy.ts` returns at least one match in a `server.tool(` registration
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.5.32`
- [ ] `eforge-plugin/skills/build/build.md` references `eforge_follow` by exact tool name
- [ ] `eforge-plugin/skills/status/status.md` references `eforge_follow` by exact tool name
- [ ] Running `node packages/eforge/dist/cli.js mcp` after `pnpm build` does not throw at startup (tool registry loads)
