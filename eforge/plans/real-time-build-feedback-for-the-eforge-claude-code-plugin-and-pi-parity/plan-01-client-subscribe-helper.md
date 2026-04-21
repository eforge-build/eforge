---
id: plan-01-client-subscribe-helper
name: Extract subscribeToSession helper into @eforge-build/client
depends_on: []
branch: real-time-build-feedback-for-the-eforge-claude-code-plugin-and-pi-parity/client-subscribe-helper
---

# Extract subscribeToSession helper into @eforge-build/client

## Architecture Context

The daemon already streams every `EforgeEvent` over SSE at `GET /api/events/{sessionId}` (`packages/monitor/src/server.ts`, lines 199-231). The MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`, lines 55-291) implements its own SSE subscriber (`startSseSubscriber`) that connects, parses SSE blocks, handles reconnect/backoff, and auto-discovers new sessions via a 10s poll.

Two upcoming consumers need a single-session subscribe capability: the new MCP `eforge_follow` tool (plan-02) and the new Pi `eforge_follow` tool (plan-03). Pi does not use MCP. To avoid duplicating SSE plumbing, extract the per-session piece into a reusable helper in `packages/client/src/` and export it from `@eforge-build/client`, which both consumers already import.

The daemon-wide "auto-discover + forward every event as MCP logging notification" behavior in `mcp-proxy.ts` is being removed in plan-02. This plan only extracts the per-session subscribe primitive; it does not change `mcp-proxy.ts` behavior yet.

## Implementation

### Overview

Add a new file `packages/client/src/session-stream.ts` exporting:

- `SessionSummary` interface (mirrors what the daemon emits on `session:end` plus the session status) - derived from the existing `/api/run-summary/{sessionId}` response shape in `packages/monitor/src/server.ts` lines 1162-1299 and the `session:end` event payload (`{ result: EforgeResult }`) defined in `packages/engine/src/events.ts` line 145.
- `subscribeToSession(sessionId, opts): Promise<SessionSummary>` where `opts` = `{ onEvent(event: EforgeEvent): void; onEnd?(summary: SessionSummary): void; signal?: AbortSignal; baseUrl?: string; cwd?: string }`. Resolves with the final summary when `session:end` arrives. Rejects if `signal.aborted` fires, if a terminal fetch error occurs after max reconnects, or if the daemon returns a non-2xx status that is not retryable.
- Internally reuses `parseSseChunk()` logic (currently in `mcp-proxy.ts` lines 95-118) by factoring it into the new module. The `mcp-proxy.ts` wrapper will be updated in plan-02 to import from here.
- Reuses the existing reconnect/backoff shape from `startSseSubscriber` (1s initial, doubling, max 30s) with a retry cap so unrecoverable failures surface instead of looping forever.

Add tests in `test/session-stream.test.ts` that exercise the helper against a real `http.createServer()` instance (not a mock) emitting hand-crafted SSE lines cast through `unknown`, per AGENTS.md testing conventions.

### Key Decisions

1. **Place in `packages/client/`, not `packages/engine/`**: the engine never imports from the monitor HTTP API and is transport-agnostic. The client package is already the home of `daemonRequest()` and lockfile helpers - SSE consumption belongs here.
2. **Resolve on `session:end`, reject on abort**: lets the caller treat the subscription as a lifecycle-bound promise rather than an event emitter. Matches how the MCP tool handler in plan-02 wants to await completion.
3. **`SessionSummary` is a new type, not a re-export of `EforgeResult`**: the tool result needs fields the engine doesn't surface (monitor URL, phase counts, files changed total). Compose from `EforgeResult` + derived aggregates computed by the helper as it streams.
4. **Keep the daemon-wide auto-discovery poll in `mcp-proxy.ts` for plan-01**: this plan only extracts the per-session primitive. Removing the 10s poll happens in plan-02.
5. **No change to `DAEMON_API_VERSION`**: we consume existing endpoints with no shape change. Per source doc, bump only if shapes change.

## Scope

### In Scope
- New `packages/client/src/session-stream.ts` with `subscribeToSession()` and `SessionSummary`
- Export from `packages/client/src/index.ts`
- Move `parseSseChunk()` + SSE block parsing logic from `mcp-proxy.ts` into the new module (mcp-proxy rewires import in plan-02)
- New `test/session-stream.test.ts` covering: event callback invocation per SSE line, resolution on `session:end`, rejection on `AbortSignal`, reconnect+backoff on mid-stream disconnect, aggregation of `SessionSummary` fields
- Handle network errors with bounded retry (e.g. max 10 reconnects) before rejecting

### Out of Scope
- Changes to `/api/events/{sessionId}` SSE endpoint in `packages/monitor/src/server.ts`
- Changes to `EforgeEvent` definitions in `packages/engine/src/events.ts`
- The MCP `eforge_follow` tool itself (plan-02)
- Pi consumer wiring (plan-03)
- Removing the daemon-wide logging forwarder or 10s auto-discovery poll in `mcp-proxy.ts` (plan-02)
- Any `DAEMON_API_VERSION` bump

## Files

### Create
- `packages/client/src/session-stream.ts` - `subscribeToSession()` helper, `SessionSummary` interface, private `parseSseBlock()` and `connectWithBackoff()` utilities
- `test/session-stream.test.ts` - vitest tests against an in-process `http.createServer()` that emits synthetic SSE event lines

### Modify
- `packages/client/src/index.ts` - re-export `subscribeToSession`, `SessionSummary`, and the event types needed by callers (import `EforgeEvent` type from `@eforge-build/engine` at the call site; do not re-export the full engine surface from client)

## Verification

- [ ] `pnpm --filter @eforge-build/client build` completes with zero TypeScript errors
- [ ] `pnpm type-check` completes with zero errors across the workspace
- [ ] `pnpm test -- session-stream` runs the new test file and all cases pass
- [ ] Running `subscribeToSession()` against a test HTTP server that emits three events followed by `{ "type": "session:end", "result": { "status": "completed" } }` resolves the promise with `SessionSummary.status === 'completed'` and `onEvent` was invoked exactly 4 times (3 preceding events + the session:end event itself, unless we choose to suppress it - document the choice in the helper's JSDoc)
- [ ] Aborting the `AbortSignal` mid-stream rejects the promise with an `AbortError` within 100ms and closes the underlying HTTP response
- [ ] When the test server closes the connection mid-session, the helper reconnects (verifiable via a second `request` on the test server) and resumes; after exceeding the retry cap the promise rejects with a non-AbortError
- [ ] `packages/client/src/index.ts` exports `subscribeToSession` and `SessionSummary` (grep-verifiable)
