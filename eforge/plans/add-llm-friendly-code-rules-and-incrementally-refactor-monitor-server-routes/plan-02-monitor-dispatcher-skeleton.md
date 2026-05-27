---
id: plan-02-monitor-dispatcher-skeleton
name: Extract Monitor Dispatcher Skeleton and Fallback Routes
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-02-monitor-dispatcher-skeleton
agents:
  builder:
    effort: high
    rationale: This is the first bounded edit to a 4,869-line server file and must
      preserve route fallthrough behavior.
---

# Extract Monitor Dispatcher Skeleton and Fallback Routes

## Architecture Context

`packages/monitor/src/server.ts` currently hosts the daemon HTTP route surface. This plan introduces the handled-return helper convention before extracting larger route groups. The server remains in the same file and uses the existing `API_ROUTES` constants.

Full-file replacement of `packages/monitor/src/server.ts` is forbidden. Use small exact edits and contiguous movement of the CORS, keep-alive, unknown API, and static fallback blocks only.

## Implementation

### Overview

Add route helper markers and helper functions for CORS preflight, keep-alive, unknown API routes, and static fallback serving. Update the `createServer` callback to call these helpers while leaving the middle route blocks inline for later plans.

### Key Decisions

1. Helpers return `boolean` or `Promise<boolean>`; `true` means a response was written or delegated to a response writer.
2. The `/console` static fallback remains before the legacy monitor UI fallback.
3. Unknown `/api/` routes remain before static fallback.
4. Helpers stay nested in `startServer`/`createMonitorServer` scope so this plan avoids a new dependency object.

## Scope

### In Scope

- Add route helper seam markers using `// --- eforge:region monitor-route-dispatch ---` and matching end markers.
- Extract CORS preflight handling for `OPTIONS /api/*`.
- Extract `POST ${API_ROUTES.keepAlive}` handling.
- Extract unknown API 404 handling.
- Extract static fallback handling with `/console` evaluated before the legacy monitor root.
- Keep all other route blocks in their current order inside the callback.

### Out of Scope

- Extracting control-plane, profile, extension, playbook, session-plan, model/config, or monitor-data routes.
- Moving route code into `packages/monitor/src/routes/` modules.
- Changing response bodies, headers, status codes, or static file resolution.

## Files

### Modify

- `packages/monitor/src/server.ts` — Add handled-return helper convention and extract only the small fallback/sentinel route blocks.

## Verification

- [ ] `pnpm vitest run packages/monitor/src/__tests__/static-ui-serving.test.ts` exits 0.
- [ ] `GET /api/not-a-route` still returns a JSON 404 body and does not serve either SPA marker.
- [ ] `/console`, `/console/`, and `/console/*` still serve from the Console UI root before the legacy monitor UI root.
- [ ] `POST ${API_ROUTES.keepAlive}` still returns `{ "status": "ok" }` with `Access-Control-Allow-Origin: *`.
- [ ] The `createServer` callback still computes `url` and `pathname` once at the top.