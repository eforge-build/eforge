---
id: plan-01-plan-set-api-contracts
name: Plan-Set API Contracts and Daemon Routes
branch: add-read-only-session-plan-set-apis-and-console-browsing/plan-01-plan-set-api-contracts
---

# Plan-Set API Contracts and Daemon Routes

## Architecture Context

`@eforge-build/input` already owns read-only session plan-set manifest parsing, safe path resolution, loading, validation, and JSON-safe summary helpers. This plan exposes those helpers through the daemon HTTP API with route constants, request/response wire shapes, and typed client helpers owned by `@eforge-build/client`.

Keep the daemon thin: it must call `listSessionPlanSets`, `loadSessionPlanSet`, `validateSessionPlanSet`, and `summarizeSessionPlanSet` rather than re-parsing manifests or resolving paths locally. Add a focused monitor route module so `packages/monitor/src/server.ts` only wires the handler.

## Implementation

### Overview

Add read-only `GET` routes for session plan-set list/show/validate, plus client helper functions and tests. Extend the existing input summary to carry external references because Console detail must display child external references while still consuming JSON-safe summary data.

### Key Decisions

1. Use `API_ROUTES.sessionPlanSetList`, `API_ROUTES.sessionPlanSetShow`, and `API_ROUTES.sessionPlanSetValidate` with paths under `/api/session-plan-set/*` to avoid colliding with the existing flat-plan mutation routes such as `sessionPlanSetSection`.
2. Put new plan-set wire types in a focused `packages/client/src/session-plan-set.ts` module instead of expanding `routes.ts`; `routes.ts` stays the route-constant owner and remains below its no-growth ceiling.
3. Return summary-shaped data plus optional umbrella anchor content from show. The response must not expose raw child content or parser internals.
4. Bump `DAEMON_API_VERSION` because new first-party client helpers and Console code require daemon support for the new routes; stale daemons must fail version verification before returning route-level 404s.

## Scope

### In Scope

- Client-owned route constants for session plan-set list, show, and validate.
- Client-owned request/response wire types for the three read-only operations.
- Node client helpers and `IfRunning` variants for the three operations.
- Browser-safe type exports for Console usage.
- Daemon read-only handlers backed by `@eforge-build/input` helpers.
- Input summary additions for manifest and child external references.
- Route/client/input tests and generated API reference drift updates.

### Out of Scope

- Creating or mutating plan sets.
- Adding, updating, submitting, or enqueueing nested child plans.
- Changing `normalizeBuildSource` behavior.
- Pi or Claude Code creation workflows.
- Database schema changes.

## Files

### Create

- `packages/client/src/session-plan-set.ts` — wire enums, diagnostics, summary, request, and response types for read-only session plan-set APIs.
- `packages/client/src/api/session-plan-set.ts` — `apiSessionPlanSetList`, `apiSessionPlanSetShow`, `apiSessionPlanSetValidate`, and `IfRunning` variants using `API_ROUTES`.
- `packages/monitor/src/session-plan-set-routes.ts` — focused daemon route handler for read-only plan-set operations.
- `test/session-plan-set-client.test.ts` — client helper URL construction, export, and browser type reachability tests.
- `test/daemon-session-plan-set-routes.test.ts` — in-process daemon route tests for list/show/validate and unsafe ids.

### Modify

- `packages/input/src/session-plan-set/schema.ts` — add external-reference arrays to JSON-safe summary types.
- `packages/input/src/session-plan-set/validate.ts` — include manifest and child `externalRefs` in `summarizeSessionPlanSet` output.
- `test/session-plan-set.test.ts` — assert summary JSON preserves external references.
- `packages/client/src/routes.ts` — add the three plan-set route constants only.
- `packages/client/src/index.ts` — export plan-set API helpers and wire types.
- `packages/client/src/browser.ts` — export browser-safe plan-set wire types.
- `packages/client/src/api-version-const.ts` — bump and document the daemon API version for the new read-only routes.
- `test/client-no-start-api-helpers.test.ts` — include the new `IfRunning` helpers in the passive no-start export coverage.
- `packages/monitor/src/server.ts` — import and call the focused plan-set route handler before the existing flat session-plan handler.
- `web/content/reference/api.md` — regenerated route reference after route constants change.
- `web/public/reference/api.md` — regenerated public route reference after route constants change.
- `web/public/llms-full.txt` — regenerated LLM reference bundle after route constants change.

## Route Contract Details

- `GET API_ROUTES.sessionPlanSetList` accepts optional `includeSubmitted=true|1` and returns `{ planSets }`.
  - The daemon calls `listSessionPlanSets({ cwd })`.
  - Filter out `abandoned` plan sets.
  - Filter out `submitted` plan sets unless `includeSubmitted` is true.
  - Each entry carries `id`, `planSetId`, `title`, `status`, `strategy`, `dir`, `manifestPath`, and `childCount`.
- `GET API_ROUTES.sessionPlanSetShow?planSetId=<id>` returns `{ planSet, validation, dir, manifestPath, anchorContent? }`.
  - The daemon calls `validateSessionPlanSet({ cwd, planSetId })` for diagnostics and summary.
  - The daemon calls `loadSessionPlanSet({ cwd, planSetId })` for `dir`, `manifestPath`, and optional umbrella anchor content.
  - Do not return raw child markdown content.
- `GET API_ROUTES.sessionPlanSetValidate?planSetId=<id>` returns the validation helper result `{ ok, diagnostics, summary }`.
- Missing `planSetId` returns HTTP 400.
- Unsafe `planSetId` values return HTTP 400 through input path-resolution errors.
- Missing plan-set directories or manifests return HTTP 404.

## Database Migration

None.

## Verification

- [ ] `API_ROUTES` exposes `sessionPlanSetList`, `sessionPlanSetShow`, and `sessionPlanSetValidate`.
- [ ] `apiSessionPlanSetList`, `apiSessionPlanSetShow`, `apiSessionPlanSetValidate`, and their `IfRunning` variants compile from `@eforge-build/client`.
- [ ] `test/client-no-start-api-helpers.test.ts` covers all three new `IfRunning` helpers returning null with no daemon lockfile.
- [ ] Input summary JSON preserves manifest `externalRefs` and child `externalRefs` after `JSON.stringify`/`JSON.parse`.
- [ ] Daemon list route returns fixture plan-set title, status, strategy, directory, manifest path, and child count.
- [ ] Daemon list route excludes `submitted` plan sets with no `includeSubmitted` query and includes them with `includeSubmitted=true`.
- [ ] Daemon show route returns umbrella `anchorContent` for a fixture with an existing anchor.
- [ ] Daemon show route response omits raw child markdown content.
- [ ] Daemon validate route returns `ok: false` and a `missing-anchor` diagnostic for a fixture with a missing declared anchor.
- [ ] Missing `planSetId` returns HTTP 400, unsafe `planSetId` returns HTTP 400, and unknown plan-set id returns HTTP 404.
- [ ] Generated route reference files include the three new route constants.
