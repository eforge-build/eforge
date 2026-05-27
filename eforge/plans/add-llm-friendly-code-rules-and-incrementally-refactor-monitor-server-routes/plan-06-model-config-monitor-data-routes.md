---
id: plan-06-model-config-monitor-data-routes
name: Extract Model, Config, Stack, and Monitor Data Routes
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-06-model-config-monitor-data-routes
agents:
  builder:
    effort: high
    rationale: This plan completes the dispatcher refactor and must reduce the
      createServer callback hotspot while preserving SSE/static/API fallthrough
      order.
  tester:
    effort: high
    rationale: Final validation spans type checking, complexity, maintainability
      ratchet, route tests, and the full test suite.
---

# Extract Model, Config, Stack, and Monitor Data Routes

## Architecture Context

This final route extraction plan leaves the `createServer` callback as an ordered dispatcher. It finishes the behavior-preserving refactor while keeping the daemon HTTP contract in `@eforge-build/client` and retaining existing projection helpers for daemon wire shapes.

Full-file replacement of `packages/monitor/src/server.ts` is forbidden. Use exact edits and contiguous movement from the remaining callback tail.

## Implementation

### Overview

Extract the remaining model, config/context/recovery-sidecar, stack, and monitor-data/SSE routes into handled-return helpers. The final callback must compute `url`/`pathname`, call route-group helpers in order, then delegate unknown API and static fallback handling.

### Key Decisions

1. Keep the final dispatcher order: CORS, keep-alive, control-plane, profile, extension, playbook/session-plan, model/config, monitor data, unknown API, static fallback.
2. Keep `/console` static fallback before legacy monitor static fallback.
3. Keep unknown `/api/` handling before any static fallback.
4. Keep wire-shape construction through existing helpers such as queue loaders, `buildRunSummary`, `autoBuildStateToWire`, and DB projection helpers.
5. Keep new route helpers nested for this build; a future module extraction can introduce an explicit `MonitorRouteContext` object.

## Scope

### In Scope

- Extract model providers/list routes.
- Extract project context, health, version, config show/validate, and recovery-sidecar routes.
- Extract stack layers, stack sync status, and stack sync routes.
- Extract queue, session metadata, runs, daemon events, run events, run summary, run state, plans, and diff routes.
- Ensure the final `createServer` callback contains only URL/pathname computation, ordered helper dispatch, unknown API handling through a helper, and static fallback delegation.
- Run final complexity, type-check, maintainability, targeted route tests, and full test validation.

### Out of Scope

- Changing daemon API version.
- Changing response shapes, status codes, headers, route constants, SSE event formats, or static UI behavior.
- Moving route helpers into `packages/monitor/src/routes/` modules in this build.
- Refactoring unrelated complexity hotspots.

## Files

### Modify

- `packages/monitor/src/server.ts` — Move the remaining route tail into handled-return helpers and finalize the dispatcher.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm complexity:scan` reports the `createServer` callback in `packages/monitor/src/server.ts` at cognitive complexity <= 80, or the callback no longer appears above 80 in the scan output.
- [ ] `pnpm vitest run test/playbook-api.test.ts test/extension-tooling-routes.test.ts test/daemon-session-plan-routes.test.ts test/stack-sync-route.test.ts test/daemon-events-stream.test.ts packages/monitor/src/__tests__/auto-build-route.test.ts packages/monitor/src/__tests__/static-ui-serving.test.ts` exits 0.
- [ ] `pnpm test` exits 0, or any unrelated pre-existing failure is documented with a current-main reproduction command and output.
- [ ] The final `createServer` callback contains no inline route body larger than URL/pathname setup, ordered helper calls, unknown API helper call, and static fallback helper call.
- [ ] Unknown `/api/` routes still return 404 before static fallback.
- [ ] `/console` static fallback still executes before the legacy monitor static fallback.