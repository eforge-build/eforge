---
id: plan-03-boundary-removal
name: Remove direct playbook daemon/client/workflow-adapter surfaces and update
  route/client tests to assert extension-owned boundaries.
branch: extract-standalone-eforge-playbooks-extension/boundary-removal
---

# Boundary Removal

## Architecture Reference

This module implements the **Integration contracts by subsystem > Client and daemon boundary** section from the architecture, plus the route/client portions of **Quality attributes > Boundary safety**.

Key constraints from architecture:
- Remove direct `/api/playbook/*` daemon routes and do not keep compatibility shims.
- Remove playbook-specific `@eforge-build/client` route keys, helpers, and wire types, including `apiPlaybook*` and `PlaybookRun*` contracts.
- Remove direct client/daemon session-plan-from-playbook API entrypoints, including `sessionPlanCreateFromPlaybook` route keys and helpers.
- Remove `createPlaybookRoutes()` from monitor route registration and delete or de-orphan playbook route handlers/services.
- Bump `DAEMON_API_VERSION` because the daemon HTTP API surface is reduced.
- Keep generic extension routes, generic contribution invocation, and generic build-queue handoff intact.
- Do not migrate CLI, MCP/Claude, Pi, or core Console callers in this module; those belong to host/console modules.

Precondition and dependency note:
- The architecture graph places `host-migration` and `console-surface` before this boundary deletion so public client export removal does not break supported consumers. The supplied plan-set dependency list currently omits those modules. Before implementation, run the preflight grep in the Verification section. If old callers remain in `packages/eforge/`, `packages/pi-eforge/`, or `packages/console-ui/`, update the plan-set dependencies or stop with a blocker; do not reintroduce playbook-specific client shims.
- The architecture assigns `packages/input/src/playbook-workflow.ts` to `input-artifact-boundary`, but this plan set has no separate `input-artifact-boundary` module and the module description includes workflow-adapter surface removal. This plan includes the bounded input cleanup. If a separate input-boundary module is added before implementation, remove the input file changes from this plan and let that module own them.

## Scope

### In Scope
- Remove playbook route keys from `API_ROUTES`.
- Remove playbook-specific client helper files, public exports, browser exports, and route-local playbook wire contracts.
- Remove the direct `sessionPlanCreateFromPlaybook` route key, client helper, request type, and response type.
- Remove monitor playbook route registration, route handlers, service code, and direct queue mutation reason used only by those routes.
- Remove or de-export the `builtin:playbooks` workflow adapter surface so `@eforge-build/input` exposes only pure playbook artifact utilities.
- Update route/client/input tests that targeted direct daemon/client/playbook-adapter APIs so they assert the boundary deletion and extension-owned handoff boundary.
- Add source-audit tests that fail if direct playbook route keys, helper exports, or workflow adapter ownership strings return.
- Bump `DAEMON_API_VERSION` and update client contract tests for the new version.

### Out of Scope
- Implementing or changing `eforge-playbooks` extension actions; `playbooks-extension` owns those actions and tests.
- Migrating CLI, MCP/Claude, Pi commands/tools, or skills to generic extension invocation.
- Removing the core Console Playbooks System section or Console playbook fetch state.
- Updating public docs, generated docs, or skills docs.
- Adding compatibility routes, compatibility client helpers, or compatibility wire types for playbooks.
- Adding producer-specific queue fields.

## Implementation Approach

### Overview

Start with a preflight audit to confirm that no direct host or Console callers remain outside this module's ownership. Once the callers are migrated or the dependency graph is corrected, delete the direct daemon/client surfaces in one boundary pass:

1. Remove playbook and create-from-playbook keys from the client route map.
2. Delete the playbook-specific client helper/route-contract files and remove all public barrel exports that referenced them.
3. Remove create-from-playbook types/helpers from the session-plan route/client files.
4. Remove monitor route registration and delete the playbook route/service files.
5. Remove playbook-only scheduler/auto-build reason strings left behind by the deleted route.
6. Remove workflow-adapter exports from `@eforge-build/input`, delete the adapter implementation, and adjust source comments to name pure artifact utilities and extension-owned behavior.
7. Replace direct-route tests with boundary tests that assert unknown route responses, missing client exports, missing route keys, and missing workflow-adapter exports.

The extension-owned behavior is not reimplemented here. Coverage for list/show/save/validate/copy/promote/demote/run semantics lives in `eforge/extensions/eforge-playbooks/__tests__/*` from the dependency module.

### Key Decisions

1. **Delete rather than deprecate direct client helpers.**
   - Rationale: acceptance criteria forbid long-lived `apiPlaybook*` compatibility helpers and route shims. Keeping wrappers around generic contribution invocation under the old names would preserve the wrong boundary.

2. **Remove `sessionPlanCreateFromPlaybook` with the playbook routes.**
   - Rationale: planning-mode playbooks now return eforge-plan planning entry metadata from the `eforge-playbooks:run-playbook` action. Direct session-plan creation from playbook is no longer a daemon/client API.

3. **Keep pure input helpers.**
   - Rationale: `packages/input/src/playbook.ts` remains the source for parse/serialize/list/load/write/move/copy/validate/compile/seed primitives used by `eforge-playbooks`. Only workflow-adapter ownership language and exports are removed.

4. **Use 404 route tests with constructed strings.**
   - Rationale: tests need to prove deleted paths are not registered without adding new hard-coded route constants. Build deleted path strings from fragments so final grep audits can distinguish test assertions from supported route literals.

5. **Remove playbook-only queue mutation reason strings.**
   - Rationale: after direct playbook enqueue routes are removed, generic extension build-queue handoff uses the existing generic enqueue path. `playbook-enqueue` no longer has a producer.

## Files

### Create
- `packages/client/src/__tests__/playbook-boundary.test.ts` — package-local contract test asserting `API_ROUTES` has no playbook/create-from-playbook keys, the main/browser client facades do not export `apiPlaybook*` helpers, and the route barrel no longer exports `PlaybookRun*` or `SessionPlanCreateFromPlaybook*` contracts.
- `test/playbook-daemon-boundary-removal.test.ts` — integration-style boundary test that starts the monitor server and asserts former `/api/playbook/{list,show,save,run,promote,demote,validate,copy}` and `/api/session-plan/create-from-playbook` paths return 404 with the normal unknown-route body.
- `test/playbook-input-boundary.test.ts` — input package boundary test asserting `@eforge-build/input` exports pure playbook helpers and does not export `createPlaybookWorkflowAdapter`, `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`, or `PlaybookWorkflow*` symbols.

### Modify
- `packages/client/src/routes/route-map.ts` — remove `playbookList`, `playbookShow`, `playbookSave`, `playbookRun`, `playbookPromote`, `playbookDemote`, `playbookValidate`, `playbookCopy`, and `sessionPlanCreateFromPlaybook` route keys `[region: boundary-removal, delete playbook and create-from-playbook route keys from API_ROUTES]`.
- `packages/client/src/routes.ts` — remove the `routes/playbook.js` type re-export block and the `SessionPlanCreateFromPlaybook*` re-exports from the session-plan block.
- `packages/client/src/api/session-plan.ts` — remove imports, re-exports, and helper functions for `apiSessionPlanCreateFromPlaybook` and `apiSessionPlanCreateFromPlaybookIfRunning`.
- `packages/client/src/routes/session-plan.ts` — remove `SessionPlanCreateFromPlaybookRequest` and `SessionPlanCreateFromPlaybookResponse` interfaces.
- `packages/client/src/index.ts` — remove `apiPlaybook*`, playbook wire-type, `PlaybookRun*`, and `apiSessionPlanCreateFromPlaybook*` public exports `[region: boundary-removal, delete playbook and create-from-playbook public exports]`.
- `packages/client/src/browser.ts` — remove browser-safe playbook type exports and create-from-playbook route types `[region: boundary-removal, delete browser playbook type exports]`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` from `74` to `75` and add a version-history note stating that v75 removes direct playbook/create-from-playbook daemon APIs.
- `packages/monitor/src/routes/extension-content.ts` — remove the `createPlaybookRoutes` import, remove playbook/create-from-playbook keys from `EXTENSION_CONTENT_ROUTE_KEYS`, and remove the `...createPlaybookRoutes(context)` spread `[region: boundary-removal, remove playbook routes from content route aggregation]`.
- `packages/monitor/src/auto-build-supervisor.ts` — remove `'playbook-enqueue'` from `AutoBuildQueueMutationReason`.
- `packages/monitor/src/server-main.ts` — remove `'playbook-enqueue'` from the `emitSchedulerMutation` reason type.
- `packages/engine/src/queue/scheduler.ts` — remove `'playbook-enqueue'` from the `SchedulerInputEvent` reason union and update the scheduler comment to list only active producers.
- `packages/input/src/index.ts` — remove public exports for `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`, `createPlaybookWorkflowAdapter`, `PlaybookWorkflow*` types/errors, and workflow adapter guards `[region: boundary-removal, remove playbook workflow adapter exports; ownership override noted in Architecture Reference]`.
- `packages/input/src/playbook.ts` — replace direct daemon-route comments with extension-owned wording while preserving pure helper API comments `[region: boundary-removal, source comments only; no pure helper behavior changes]`.
- `test/client-no-start-api-helpers.test.ts` — remove `apiPlaybook*IfRunning` and `apiSessionPlanCreateFromPlaybookIfRunning` entries from the passive helper export matrix; add a short assertion that no helper name in the matrix starts with `apiPlaybook`.
- `packages/client/src/__tests__/client-contract-public-exports.test.ts` — update the daemon API version expectation to `75` and assert the version-history note contains the removal phrase.
- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts` — remove playbook/create-from-playbook keys from `EXPECTED_ROUTE_KEYS`, `GET_ROUTE_KEYS`, and `SECURED_ROUTE_KEYS`; update the exact route count from `41` to `32`.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` — remove `playbooks.ts` and `playbook-service.ts` from `CONTENT_ROUTE_FILES`; replace the old adapter-backed service assertion with an absence assertion for playbook route/service files and `createPlaybookWorkflowAdapter` references.
- `packages/monitor/src/__tests__/routes-playbooks.test.ts` — replace direct route behavior tests with deleted-route assertions, or delete this file if `test/playbook-daemon-boundary-removal.test.ts` covers the same paths `[region: boundary-removal, shared test ownership override for direct route deletion]`.
- `test/playbook-workflow.test.ts` — replace adapter behavior tests with input-boundary assertions, or delete this file if `test/playbook-input-boundary.test.ts` covers adapter export removal and existing pure helper suites cover storage/validation/conversion `[region: boundary-removal, shared test ownership override for workflow adapter deletion]`.

### Delete
- `packages/client/src/api/playbook.ts` — remove direct playbook client helpers and wire types `[region: boundary-removal, delete file]`.
- `packages/client/src/routes/playbook.ts` — remove route-local playbook run wire contracts `[region: boundary-removal, delete file]`.
- `packages/monitor/src/routes/playbooks.ts` — remove direct playbook daemon route handlers `[region: boundary-removal, delete file]`.
- `packages/monitor/src/routes/playbook-service.ts` — remove direct playbook daemon service and queue handoff implementation `[region: boundary-removal, delete file]`.
- `packages/input/src/playbook-workflow.ts` — remove `builtin:playbooks` workflow-adapter implementation and ownership language `[region: boundary-removal, delete file; ownership override noted in Architecture Reference]`.
- `test/playbook-api-crud.test.ts` — remove direct `/api/playbook/*` CRUD route behavior tests after replacement coverage is added by `test/playbook-daemon-boundary-removal.test.ts` and the `eforge-playbooks` package tests.
- `test/playbook-api-run-profile.test.ts` — remove direct `/api/playbook/run` route behavior tests after replacement coverage is added by `eforge-playbooks` run-action tests and generic enqueue tests.
- `test/playbook-api-run-landing-auto-merge.test.ts` — remove direct playbook route landing tests after replacement coverage is added by generic enqueue/extension build-queue tests.
- `test/daemon-session-plan-routes-playbook.test.ts` — remove direct create-from-playbook route tests after replacement 404 coverage is added by `test/playbook-daemon-boundary-removal.test.ts`; pure session-plan seed coverage remains in `test/session-plan-from-playbook.test.ts`.

## Testing Strategy

### Unit Tests
- Client boundary tests:
  - `Object.keys(API_ROUTES)` excludes the eight `playbook*` keys and `sessionPlanCreateFromPlaybook`.
  - `Object.values(API_ROUTES)` contains no value including the dynamic fragment `play` + `book`.
  - Main and browser client facades expose generic extension contribution helpers but no runtime export whose name starts with `apiPlaybook`.
  - Source reads of `packages/client/src/index.ts`, `browser.ts`, and `routes.ts` contain no `apiPlaybook`, `PlaybookRun`, or `SessionPlanCreateFromPlaybook` tokens.
- Monitor route registration tests:
  - `EXTENSION_CONTENT_ROUTE_KEYS` equals the 32 non-playbook extension/session-plan/session-plan-set keys.
  - `createExtensionContentRoutes()` returns no route key matching `/^playbook/` and no `sessionPlanCreateFromPlaybook` key.
  - Source contract tests verify no `playbooks.ts`, no `playbook-service.ts`, and no `createPlaybookWorkflowAdapter` reference under `packages/monitor/src/routes`.
- Input boundary tests:
  - `@eforge-build/input` exports `parsePlaybook`, `serializePlaybook`, `listPlaybooks`, `loadPlaybook`, `writePlaybook`, `movePlaybook`, `copyPlaybookToScope`, `validatePlaybook`, `playbookToBuildSource`, and `playbookToPlanSeed`.
  - `@eforge-build/input` runtime exports do not include `createPlaybookWorkflowAdapter` or `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`.
  - Source reads of `packages/input/src/index.ts` and `packages/input/src/playbook.ts` contain no `builtin:playbooks`, `createPlaybookWorkflowAdapter`, `PLAYBOOK_WORKFLOW`, or direct daemon route strings.

### Integration Tests
- Deleted route tests:
  - Start a real monitor server with a temp project.
  - Request former GET paths for list/show and former POST paths for save/run/promote/demote/validate/copy/create-from-playbook using strings assembled from fragments.
  - Assert every response status is `404` and every JSON body has `error` beginning with `Unknown route:`.
- Generic extension routes unaffected:
  - Existing extension contribution route tests continue to pass with `extensionContributionManifest` and `extensionActionInvoke` registered.
  - Existing `eforge-playbooks` package action tests continue to pass and cover playbook management/run semantics through extension-owned actions.
- Scheduler/auto-build reason cleanup:
  - Existing auto-build supervisor and scheduler tests compile with `AutoBuildQueueMutationReason` excluding `playbook-enqueue`.

## Verification

- [ ] Preflight: `rg -n "apiPlaybook|API_ROUTES\.playbook|API_ROUTES\.sessionPlanCreateFromPlaybook|PlaybookRunRequest|PlaybookListResponse" packages/eforge packages/pi-eforge packages/console-ui --glob '!node_modules/**' --glob '!dist/**'` returns zero matches before this module removes client exports; otherwise implementation stops and records the missing upstream migration.
- [ ] `packages/client/src/routes/route-map.ts` has no key beginning with `playbook` and no `sessionPlanCreateFromPlaybook` key.
- [ ] `packages/client/src/api/playbook.ts` and `packages/client/src/routes/playbook.ts` are absent.
- [ ] `packages/client/src/index.ts`, `packages/client/src/browser.ts`, and `packages/client/src/routes.ts` contain no `apiPlaybook`, `PlaybookRun`, or `SessionPlanCreateFromPlaybook` tokens.
- [ ] `packages/monitor/src/routes/playbooks.ts` and `packages/monitor/src/routes/playbook-service.ts` are absent.
- [ ] `packages/monitor/src/routes/extension-content.ts` contains no `createPlaybookRoutes`, no route key starting with `playbook`, and no `sessionPlanCreateFromPlaybook` key.
- [ ] `packages/input/src/playbook-workflow.ts` is absent and `packages/input/src/index.ts` contains no `createPlaybookWorkflowAdapter`, `PLAYBOOK_WORKFLOW`, or `PlaybookWorkflow` exports.
- [ ] `rg -n "playbook-enqueue" packages/monitor/src packages/engine/src test --glob '!node_modules/**' --glob '!dist/**'` returns zero matches.
- [ ] `DAEMON_API_VERSION` equals `75` in both main and browser client contract tests.
- [ ] Deleted-route tests return 404 for all former direct playbook and create-from-playbook paths.
- [ ] Targeted tests pass: `pnpm vitest run packages/client/src/__tests__/playbook-boundary.test.ts packages/client/src/__tests__/client-contract-public-exports.test.ts packages/monitor/src/__tests__/routes-extension-content-registration.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts test/playbook-daemon-boundary-removal.test.ts test/playbook-input-boundary.test.ts test/client-no-start-api-helpers.test.ts`.
- [ ] Extension package tests from the dependency still pass: `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__/registration.test.ts eforge/extensions/eforge-playbooks/__tests__/actions-crud.test.ts eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts`.
- [ ] `pnpm --filter @eforge-build/client type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/input type-check` exits 0.
- [ ] `pnpm type-check` exits 0 after upstream host/console caller migrations are present.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
