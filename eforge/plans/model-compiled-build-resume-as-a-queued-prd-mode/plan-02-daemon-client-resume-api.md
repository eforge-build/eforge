---
id: plan-02-daemon-client-resume-api
name: Daemon and Client Queued Resume API
branch: model-compiled-build-resume-as-a-queued-prd-mode/plan-02-daemon-client-resume-api
agents:
  builder:
    effort: high
    rationale: Breaking route-contract change across daemon, client, CLI, MCP, Pi
      extension, Console UI, and tests.
  reviewer:
    effort: high
    rationale: API response migration and daemon queue mutation require
      route-contract and integration review.
---

# Daemon and Client Queued Resume API

## Architecture Context

After plan 1, the engine can mark a failed PRD for queued compiled resume and queue execution can run the compiled resume path. This plan replaces the daemon resume route's immediate `workerTracker.spawnWorker('resume', ...)` behavior with the new queue mutation and updates typed clients plus first-party integrations in the same type-change plan.

Route constants and response types remain owned by `@eforge-build/client`. Do not inline `/api/...` paths outside the shared client package.

## Implementation

### Overview

Change `POST API_ROUTES.resumeBuild` to validate the request, validate explicit profile overrides, call the engine queued-resume helper, notify the scheduler, and return queued metadata instead of `{ sessionId, pid }`. Update client types, browser helpers, CLI/MCP/Pi integrations, Console UI copy, and tests.

### Key Decisions

1. Make `ResumeBuildResponse` an explicit queued response, not a spawned-worker response. This is a breaking daemon wire change, so bump `DAEMON_API_VERSION`.
2. Validate explicit profile overrides in the daemon route, but leave existing failed PRD `profile:` frontmatter untouched when the caller omits `profile`.
3. Keep consumer integrations thin: CLI, MCP, Pi, and Console call the daemon route and render the queued result.
4. Return no `sessionId` or `pid` from resume build. The scheduler will create a session only when it dispatches the queued PRD.

## Scope

### In Scope

- Change `POST /api/recover/resume-build` from worker spawning to queued resume mutation.
- Update `ResumeBuildResponse` and any downstream TypeScript consumers.
- Bump `DAEMON_API_VERSION` with a concise v51 history comment.
- Update `eforge resume <prdId>` to queue resume through the daemon route rather than running `EforgeEngine.resumeBuild()` locally.
- Update the MCP proxy `eforge_resume_build` tool and Pi `eforge_resume_build` tool to describe and return queued resume metadata.
- Update Console UI recovery dialog state and tests to render a queued result instead of session/PID.
- Add route tests for metadata preservation, profile override precedence, scheduler notification, and no worker spawn.

### Out of Scope

- Engine queue execution internals already handled by plan 1.
- Skill markdown and public documentation updates handled by plan 3.
- Adding a compatibility union that still returns spawned workers.

## Files

### Modify

- `packages/client/src/routes.ts` — replace `ResumeBuildResponse` with a queued response shape such as `{ kind: 'queued'; prdId; setName; featureBranch; baseBranch; movedDescendantIds; profile?: string }`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` from 50 to 51 and document the breaking resume-build response change.
- `packages/client/src/api/resume-build.ts` — keep the typed helper and update comments if they mention spawning.
- `packages/client/src/browser-recovery.ts` — update `startResumeBuild()` comment from spawned worker to queued resume.
- `packages/monitor/src/routes/resume.ts` — remove `workerTracker` requirement and spawn path; call the service helper and send queued JSON.
- `packages/monitor/src/routes/resume-service.ts` — replace `prepareResumeBuildArgs()` with a service helper that validates body/profile, calls the engine queued-resume helper, maps blocked/ineligible results to HTTP errors, and returns `ResumeBuildResponse`.
- `packages/eforge/src/cli/index.ts` — change the top-level `resume` command to call `apiResumeBuild()` and print queued metadata; remove or ignore worker-only `--session-id` behavior.
- `packages/eforge/src/cli/mcp-proxy.ts` — update `eforge_resume_build` description and ensure the handler returns the queued response unchanged.
- `packages/pi-eforge/extensions/eforge/index.ts` — update `eforge_resume_build` description and ensure returned JSON matches the queued response.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — render `Resume queued`, PRD id, set name, and branch/profile metadata instead of session id and PID; refresh the queue after success.
- `test/resume-build-route.test.ts` — rewrite happy-path route tests around queue mutation, no worker spawn, queued response, metadata preservation, explicit profile override, and no-workerTracker success.
- `test/resume-build-cli-mcp.test.ts` — update API helper and MCP expectations for queued response.
- `test/browser-recovery-helpers.test.ts` — update fixture response and comments for queued resume.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — update rendered success assertions from session/PID to queued metadata.
- `packages/monitor/src/__tests__/routes-recovery.test.ts` — update route-module smoke test so resume requeue does not expect `spawnWorker('resume', ...)`.

## Implementation Notes

- The route service should require `context.cwd`; return 503 when no working directory is configured.
- Request validation should keep existing path-segment checks for `prdId` and `setName`.
- If the engine helper reports ineligible or blocked, return a non-2xx response with the engine reason. Use 409 for eligible-state conflicts such as missing artifacts, existing target files, or already blocked transitions.
- If the engine helper reports `already-queued`, return 200 with `kind: 'queued'` and a status/detail field that lets clients render the idempotent state.
- Call `context.notifyQueueMutation('external')` only after a queued or already-queued result.
- `eforge resume` should not stream build events. It should print the queued PRD id/set name and let users follow progress through the queue/monitor.

## Verification

- [ ] `POST ${API_ROUTES.resumeBuild}` returns a queued response with `kind: 'queued'`, `prdId`, `setName`, `featureBranch`, and `baseBranch`.
- [ ] The resume-build response contains no `sessionId` field and no `pid` field.
- [ ] The resume-build route does not call `workerTracker.spawnWorker('resume', ...)`.
- [ ] A server started without `workerTracker` can serve an eligible resume-build request.
- [ ] The route calls `context.notifyQueueMutation('external')` after the requeue mutation succeeds.
- [ ] Invalid `prdId`, invalid `setName`, missing `prdId`, empty `profile`, missing profile, and invalid profile file cases return non-2xx responses and leave queue files unmoved.
- [ ] An explicit `profile` request field is written to the requeued PRD frontmatter.
- [ ] Omitting `profile` preserves an existing failed PRD `profile:` field.
- [ ] Omitting `profile` on a failed PRD with no `profile:` leaves the requeued PRD without `profile:` so profile routers and active/default profile fallback can run.
- [ ] `apiResumeBuild()` and `startResumeBuild()` compile against the new response type.
- [ ] The MCP proxy `eforge_resume_build` handler returns the queued response JSON.
- [ ] The Pi `eforge_resume_build` tool returns the queued response JSON.
- [ ] Console UI displays `Resume queued` and does not render session id or PID for the resume action.
- [ ] `eforge resume <prdId>` calls the daemon route and prints the queued PRD id and set name.
