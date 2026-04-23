---
title: Hardening 08: Monitor UI Consumes @eforge-build/client for SSE
created: 2026-04-23
---

# Hardening 08: Monitor UI Consumes @eforge-build/client for SSE

## Metadata

- **title:** "Hardening 08: monitor UI consumes @eforge-build/client for SSE"
- **scope:** excursion

## Problem / Motivation

`@eforge-build/client` already exports a battle-tested SSE subscriber (`subscribeToSession` in `packages/client/src/session-stream.ts`) with reconnect, backoff, and session lifecycle handling. The CLI MCP proxy uses it correctly.

The monitor UI does not. `packages/monitor-ui/src/hooks/use-eforge-events.ts` instantiates `new EventSource(...)` directly and reimplements its own reconnect and HTTP-fallback logic. Two implementations means:

- Bug fixes (e.g., reconnect timeout tuning) only land in one place.
- Adding a new event type requires touching both.
- The UI has no reason to diverge - the client package works in browsers (EventSource is a browser API).

**Note:** `packages/monitor-ui/src/lib/api.ts` already uses `API_ROUTES` typed helpers exclusively with no raw URLs - that work is complete and out of scope.

## Goal

- `useEforgeEvents` is a thin wrapper around `subscribeToSession`.
- `subscribeToSession` supports `baseUrl: ''` relative-URL mode for same-origin browser use.
- Clear guidance in a short comment block or README on when to use SSE (`useEforgeEvents`) vs on-demand fetch (`useApi`).
- The reducer has a top-of-file JSDoc block enumerating action types.

## Approach

### 1. Extend `subscribeToSession` for relative-URL mode

`packages/client/src/session-stream.ts` currently requires either a full URL or reads from a lockfile. Add minimal support for `baseUrl: ''` (empty string) to mean same-origin relative URLs. This is a browser-only path - do not fork a second implementation.

Check the `resolveBaseUrl()` function and handle the empty-string case explicitly, e.g.:

```ts
if (baseUrl === '') {
  // browser relative-URL mode: use empty string prefix
  return '';
}
```

### 2. Refactor `useEforgeEvents`

Replace the direct `new EventSource(...)` and reconnect/fallback logic in `packages/monitor-ui/src/hooks/use-eforge-events.ts` with a call to `subscribeToSession`. Preserve the reducer integration (`BATCH_LOAD` vs `ADD_EVENT` dispatches) exactly as-is.

Sketch:

```ts
useEffect(() => {
  const abort = new AbortController();
  subscribeToSession<DaemonStreamEvent>(sessionId, {
    baseUrl: '',
    signal: abort.signal,
    onEvent: (event) => dispatch({ type: 'ADD_EVENT', event }),
    onBatchLoad: (events) => dispatch({ type: 'BATCH_LOAD', events }),
  });
  return () => abort.abort();
}, [sessionId]);
```

Delete all `new EventSource(...)` instantiation and bespoke reconnect/HTTP-fallback logic. Keep the reducer dispatch calls intact.

### 3. Document the choice

Add a short comment block at the top of `packages/monitor-ui/src/hooks/` (or a `README.md` in that directory if preferred):

> - `useEforgeEvents(sessionId)` - subscribe to a single session's live event stream. Use for per-session dashboards, pipeline views, timelines.
> - `useApi(endpoint)` - one-shot typed fetch for resource data (queue list, backend list, runs). Use when the data is not session-scoped or is a snapshot.

### 4. Document the reducer

Add a top-of-file JSDoc block to `packages/monitor-ui/src/lib/reducer.ts` enumerating the action types (`ADD_EVENT`, `BATCH_LOAD`, `RESET`) and their effects on state. Not a rewrite - just a comment for the next contributor.

## Scope

### In scope

- Extending `packages/client/src/session-stream.ts` with minimal support for `baseUrl: ''` (same-origin relative-URL mode).
- Refactoring `useEforgeEvents` to be a thin wrapper around `subscribeToSession`.
- Documenting SSE vs on-demand fetch choice via comment or `README.md` in `packages/monitor-ui/src/hooks/`.
- Adding a top-of-file JSDoc block to `packages/monitor-ui/src/lib/reducer.ts`.

### Already complete (do not re-implement)

- `packages/monitor-ui/src/lib/api.ts` - already uses `API_ROUTES` typed helpers with no raw URLs.

### Files touched

- `packages/client/src/session-stream.ts` (small addition for relative-URL support)
- `packages/monitor-ui/src/hooks/use-eforge-events.ts`
- `packages/monitor-ui/src/hooks/README.md` (new) or comment block at top of hooks
- `packages/monitor-ui/src/lib/reducer.ts` (JSDoc only)

### Out of scope

- Redesigning the reducer.
- Adding new event types.
- Shadcn sweep (PRD 09).
- Changes to `api.ts` or `useApi` (already aligned).

## Acceptance Criteria

- `useEforgeEvents` is implemented as a thin wrapper around `subscribeToSession` from `@eforge-build/client`.
- The old `new EventSource(...)` and bespoke reconnect/HTTP-fallback logic in `use-eforge-events.ts` is deleted.
- The reducer integration (`BATCH_LOAD` vs `ADD_EVENT` dispatches) is preserved exactly as-is.
- `subscribeToSession` supports `baseUrl: ''` relative-URL mode (extended minimally, not forked).
- Guidance on when to use `useEforgeEvents(sessionId)` vs `useApi(endpoint)` is documented via a comment block at the top of `packages/monitor-ui/src/hooks/` or a `README.md` in that directory, matching the specified wording.
- A top-of-file JSDoc block in `packages/monitor-ui/src/lib/reducer.ts` enumerates the action types and their effects on state.
- `pnpm build` produces a working monitor UI bundle.
- `pnpm --filter monitor-ui dev` renders without errors.
- Manual verification: opening the monitor UI during an active build, killing the daemon, and restarting it triggers reconnect and events resume (handled by `subscribeToSession` post-refactor).
- Network tab shows one EventSource per active session (no duplicate connections).
- `rg "new EventSource" packages/monitor-ui/src` returns zero hits.