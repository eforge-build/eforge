---
id: plan-02-api-cli
name: Resume API, Daemon, and CLI Surfaces
branch: resume-failed-compiled-builds/plan-02-api-cli
agents:
  builder:
    effort: high
    rationale: Adds a new daemon route, shared client contract, CLI worker entry
      point, and MCP proxy tool that must stay aligned.
---

# Resume API, Daemon, and CLI Surfaces

## Architecture Context

Daemon HTTP routes and wire request/response shapes are owned by `@eforge-build/client`. The daemon must use `API_ROUTES` rather than inline `/api/...` literals. The CLI already exposes `recover` and `apply-recovery`; resume belongs near those recovery commands and must invoke the engine resume primitive from plan 01.

## Implementation

### Overview

Expose compiled-build resume through the shared client package, daemon route, CLI command, and Claude MCP proxy tool. The route starts a resume worker, while direct CLI execution streams the engine resume events through the existing monitor/session wrapping.

### Key Decisions

1. Add a distinct route such as `API_ROUTES.resumeBuild = '/api/recover/resume-build'` rather than overloading `applyRecovery`.
2. Use a request shape with `prdId` required and `setName` optional, allowing set name resolution from the recovery sidecar when present.
3. Let the daemon spawn `eforge resume <prdId> [--set-name <setName>]` so resume events are recorded like other worker sessions.
4. Keep `apply-recovery retry` unchanged; it continues to requeue PRDs and can still recompile.

## Scope

### In Scope

- Shared client request/response types for triggering a compiled-build resume.
- A typed client API helper and exports from `@eforge-build/client`.
- A daemon POST endpoint using `API_ROUTES` and path-segment validation.
- A CLI command such as `eforge resume <prdId> --set-name <setName>` with `--cwd`, `--verbose`, and `--no-monitor` options.
- A Claude MCP proxy tool such as `eforge_resume_build` that calls the typed client helper.
- Route, helper, CLI, and MCP tests.

### Out of Scope

- Console UI workflow beyond the daemon route and events needed for future UI rendering.
- API version bump for additive route changes.
- Modifying recovery verdict selection.

## Files

### Create

- `packages/client/src/api/resume-build.ts` — typed daemon helper for the resume route.
- `test/resume-build-route.test.ts` — daemon route tests for request validation and worker spawning.
- `test/resume-build-cli-mcp.test.ts` — CLI and MCP registration/handler tests for the resume command and tool.

### Modify

- `packages/client/src/routes.ts` — add `ResumeBuildRequest`, `ResumeBuildResponse`, and the resume route constant.
- `packages/client/src/index.ts` — export resume request/response types and API helpers.
- `packages/monitor/src/server.ts` — add the resume route handler, parse and validate request JSON, spawn the resume worker, and return the typed response.
- `packages/eforge/src/cli/index.ts` — add the `resume` command near `recover` and `apply-recovery`; call `engine.resumeBuild()` for direct CLI use.
- `packages/eforge/src/cli/mcp-proxy.ts` — register `eforge_resume_build` and call the typed client helper.
- `test/daemon-client-guard.test.ts` or relevant client route tests — include the resume helper in no-inline-route guard coverage if the existing guard enumerates helpers.
- `test/mcp-tool-factory.test.ts` or existing MCP proxy tests — assert the new MCP tool is registered and sends the expected request body.

## Verification

- [ ] `apiResumeBuild({ cwd, body: { prdId } })` posts to `API_ROUTES.resumeBuild` and returns `{ sessionId, pid }`.
- [ ] The daemon route returns 400 for missing `prdId`.
- [ ] The daemon route returns 400 for `prdId` or `setName` containing path traversal or path separators.
- [ ] The daemon route calls `spawnWorker('resume', ...)` with `prdId` and optional `--set-name` arguments.
- [ ] `eforge resume <prdId> --set-name <setName> --no-monitor` streams resume events from `EforgeEngine.resumeBuild()`.
- [ ] The MCP proxy exposes `eforge_resume_build` and returns the daemon response JSON.
- [ ] Existing `eforge recover` and `eforge apply-recovery` tests keep passing without behavior changes.
- [ ] `pnpm vitest run test/resume-build-route.test.ts test/resume-build-cli-mcp.test.ts test/apply-recovery-route.test.ts test/apply-recovery.test.ts` exits 0.
