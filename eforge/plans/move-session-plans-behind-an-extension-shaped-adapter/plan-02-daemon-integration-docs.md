---
id: plan-02-daemon-integration-docs
name: Daemon Service Adapter Integration and Documentation
branch: move-session-plans-behind-an-extension-shaped-adapter/plan-02-daemon-integration-docs
agents:
  builder:
    effort: high
    rationale: Integrates the new adapter through daemon services and large CLI
      files while preserving public API compatibility and updating multiple
      documentation mirrors.
  reviewer:
    effort: high
    rationale: Route compatibility, documentation wording, and large-file bounded
      edits need thorough review.
---

# Daemon Service Adapter Integration and Documentation

## Architecture Context

Plan 01 provides the bundled session-planning workflow adapter. This plan moves monitor service code and active enqueue/profile detection paths onto that adapter while keeping route modules, route constants, request/response shapes, file locations, and path-based build handoff unchanged. The daemon remains a compatibility shim: it handles HTTP security, request validation, wire mapping, and HTTP error mapping; the adapter owns session-plan domain behavior.

## Implementation

### Overview

Refactor monitor session-plan and session-plan-set services to call `createSessionPlanningWorkflowAdapter()` from lazy `@eforge-build/input` imports. Update enqueue-time inherited profile detection and submitted-status marking to use the adapter-backed normalization/status path. Update docs to describe the bundled internal adapter and the SDK storage helper without claiming user-authored session-plan extension support.

### Key Decisions

1. Keep `packages/client/src/routes/route-map.ts`, `packages/client/src/routes/session-plan.ts`, and `packages/client/src/session-plan-set.ts` unchanged.
2. Keep `packages/monitor/src/routes/session-plans.ts` and `packages/monitor/src/routes/session-plan-sets.ts` route registration semantics unchanged unless a minimal import-only edit is unavoidable.
3. Keep `@eforge-build/input` imports lazy inside monitor services to satisfy the existing source-contract test.
4. Map adapter domain objects to client-owned wire response types in monitor services.
5. Preserve path-based enqueue handoff: workers still receive the original `.eforge/session-plans/<session>.md` path, and preprocessing still normalizes it later.

## Scope

### In Scope

- Refactor flat session-plan service functions to call the bundled adapter for list, show/load, create, set-section, skip-dimension, set-status, select-dimensions, readiness, and migrate-legacy behavior.
- Refactor session-plan-set service functions to call the bundled adapter for list, show/load, and validate behavior.
- Keep HTTP and wire response mapping in monitor services.
- Keep local-only and cross-site security enforcement in route modules.
- Use adapter-backed normalization/profile extraction in monitor enqueue prevalidation and active CLI in-process paths.
- Remove ad hoc `.eforge/session-plans` joins from monitor service code.
- Add source-contract coverage that prevents a regression back to direct helper orchestration or duplicated wire shapes.
- Update repository, SDK, input, and public extension docs.

### Out of Scope

- No native extension workflow registration API.
- No `EforgeExtensionAPI` method for session-plan workflows.
- No new daemon route names, route paths, or HTTP methods.
- No client wire shape changes.
- No Console route or top-level navigation changes.
- No Pi or Claude host command changes unless type-check exposes a compile error.
- No plan-set mutation or enqueue behavior.
- No migration of session-plan files out of `.eforge/session-plans/`.

## Files

### Create

- None expected.

### Modify

- `packages/monitor/src/routes/session-plan-service.ts` — replace direct helper orchestration with lazy adapter calls; add client-owned response type annotations; keep wire mapping and HTTP error translation in the service.
- `packages/monitor/src/routes/session-plan-set-service.ts` — replace direct helper orchestration with lazy adapter calls; keep client-owned wire type mapping.
- `packages/monitor/src/routes/enqueue-service.ts` — use the adapter for normalization/profile extraction, storage-root resolution, and submitted-status updates instead of direct `.eforge/session-plans` joins and direct helper imports.
- `packages/eforge/src/cli/run-or-delegate.ts` — replace the direct `normalizeBuildSource` call used for inherited `agent_profile` pre-detection with adapter-backed normalization. Use bounded exact edits.
- `packages/eforge/src/cli/index.ts` — replace the direct `normalizeBuildSource` call used for inherited `agent_profile` pre-detection with adapter-backed normalization. Use bounded exact edits.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` — add source-contract checks that session-plan services route through the adapter, keep `@eforge-build/input` lazy, do not redeclare client wire response types, and do not inline session-plan API paths.
- `packages/monitor/src/__tests__/routes-session-plans.test.ts` — add or adjust compatibility assertions only if route coverage needs to prove adapter-backed list/show/mutation responses retain existing fields.
- `packages/monitor/src/__tests__/routes-session-plan-sets.test.ts` — add or adjust compatibility assertions only if route coverage needs to prove read-only adapter-backed set responses retain existing fields.
- `README.md` — mention that reusable input protocols include a bundled session-planning adapter while user-facing files remain `.eforge/session-plans/` and the engine consumes normalized build source.
- `docs/extensions.md` — distinguish the shipped internal bundled session-planning adapter from future user-authored session-plan extraction and unsupported raw extension-owned HTTP routes.
- `docs/extensions-api.md` — document the SDK project-local storage helper and repeat that session-plan extraction into native extensions remains future/deferred work.
- `web/content/docs/extensions.md` — mirror the public extension guide wording from `docs/extensions.md` with web-relative links.
- `web/content/docs/extensions-api.md` — mirror the public API wording from `docs/extensions-api.md` with web-relative links.
- `web/public/docs/extensions.md` — keep the raw public mirror byte-identical to `web/content/docs/extensions.md`.
- `web/public/docs/extensions-api.md` — keep the raw public mirror byte-identical to `web/content/docs/extensions-api.md`.
- `packages/extension-sdk/README.md` — document `resolveProjectLocalStoragePath`, containment guarantees, no filesystem I/O, and use without extension runtime loading.
- `packages/input/README.md` — document the bundled session-planning workflow adapter boundary, descriptor, exported factory, and read-only plan-set adapter surface.
- `docs/architecture.md` — update the session-plan route chain description so it reads as `client -> monitor compatibility shim -> input bundled adapter -> input helpers` rather than monitor services owning helper orchestration.

## Implementation Notes

- In `session-plan-service.ts`, add return types from `@eforge-build/client` such as `SessionPlanListResponse`, `SessionPlanShowResponse`, and mutation response types. Do not declare local response interfaces.
- Use a small local async helper, for example `loadSessionPlanningAdapter()`, that performs `const { createSessionPlanningWorkflowAdapter, isSessionPlanReadinessError } = await import('@eforge-build/input')` and returns the adapter plus needed domain guards.
- `listSessionPlansWire` must call the adapter list operation with `includeSubmitted`, then map entries to `{ plans: [...] }` using client wire field names.
- `showSessionPlan` must call the adapter load/show operation and strip only `sections` from the returned plan before mapping to the wire shape.
- `setStatusWire` must map `SessionPlanReadinessError` to the existing 400 body shape: `{ error: <message>, readiness: <detail> }`.
- In `session-plan-set-service.ts`, call adapter plan-set operations and map summaries/results to existing client wire response types using casts only at the final wire boundary.
- In `enqueue-service.ts`, preserve current behavior for missing source files: missing or non-file source returns no inherited profile and does not block enqueue.
- In `markSessionPlanSubmittedAfterEnqueue`, continue to ignore non-flat, non-markdown, missing, and invalid session id paths. Use adapter storage-root/path/status methods instead of open-coded `.eforge/session-plans` joins or direct `loadSessionPlan`/`writeSessionPlan` imports.
- In CLI files, keep `preprocessBuildSource` imports unchanged; only replace the direct inherited-profile `normalizeBuildSource` call path with the adapter method.
- Do not edit `packages/client/src/routes/route-map.ts`, `packages/client/src/routes/session-plan.ts`, or `packages/client/src/session-plan-set.ts`.
- Do not change Pi, Claude MCP, Console plans view, or route registration files unless type-check reports a direct compile error.
- When updating extension docs, keep the phrase pattern required by existing tests: `session-plan extraction` must still appear near `deferred`, `future`, or `not shipped`.
- If docs generation changes raw public mirrors or generated reference artifacts, commit the generated outputs and verify `pnpm docs:check`.

## Verification

- [ ] `session-plan-service.ts` contains a lazy adapter import path and no direct references to `loadSessionPlan`, `writeSessionPlan`, `getReadinessDetail`, `setSessionPlanSection`, `skipDimension`, `setSessionPlanStatus`, `setSessionPlanDimensions`, or `migrateBooleanDimensions` outside adapter-facing names.
- [ ] `session-plan-set-service.ts` contains a lazy adapter import path and no direct references to `listSessionPlanSets`, `loadSessionPlanSet`, `validateSessionPlanSet`, or `validateLoadedSessionPlanSet` outside adapter-facing names.
- [ ] Monitor service files contain no `/api/` string literals.
- [ ] Monitor service files declare no local `*Response` interfaces or type aliases for session-plan/session-plan-set wire responses.
- [ ] `packages/client/src/routes/route-map.ts`, `packages/client/src/routes/session-plan.ts`, and `packages/client/src/session-plan-set.ts` have no diff in this plan.
- [ ] `POST /api/enqueue` still passes the original `.eforge/session-plans/<session>.md` path to the worker.
- [ ] `POST /api/enqueue` still appends `--profile <agent_profile>` when a ready session plan has `agent_profile` and the request omits `profile`.
- [ ] `POST /api/enqueue` still uses the explicit request `profile` when both request profile and inherited `agent_profile` exist.
- [ ] `POST /api/enqueue` still returns 400 and spawns no worker when an inherited `agent_profile` is missing from profiles.
- [ ] Session-plan route tests pass for list, show, create, section mutation, dimension skip, dimension selection, status mutation, readiness, and legacy migration.
- [ ] Session-plan-set route tests pass for list, show, validate, missing id, unsafe id, and local/cross-site security.
- [ ] Plan-set adapter-backed route behavior remains read-only; no POST/PUT/PATCH/DELETE plan-set route is added.
- [ ] Docs state that session plans remain `.eforge/session-plans/` files.
- [ ] Docs state that the engine receives normalized build source.
- [ ] Docs state that the bundled session-planning adapter is internal/built-in and does not ship user-authored native session-plan extraction.
- [ ] Docs state that raw extension-owned HTTP routes remain unsupported or deferred.
- [ ] `web/public/docs/extensions.md` equals `web/content/docs/extensions.md` byte-for-byte.
- [ ] `web/public/docs/extensions-api.md` equals `web/content/docs/extensions-api.md` byte-for-byte.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-session-plans.test.ts packages/monitor/src/__tests__/routes-session-plan-sets.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts test/daemon-session-plan-routes-enqueue.test.ts test/extension-platform-docs-examples.test.ts test/extension-tooling-wiring-runtime-docs.test.ts test/reference-content.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm type-check` exits 0.
