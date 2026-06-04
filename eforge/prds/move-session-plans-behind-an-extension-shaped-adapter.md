---
title: Move Session Plans Behind an Extension-Shaped Adapter
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Move Session Plans Behind an Extension-Shaped Adapter

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-01-move-session-plans-behind-an-extension-shaped-adapter.md`.

Session-plan handling currently works, but its ownership is not shaped like the future workflow-extension model. Monitor route services directly orchestrate many `@eforge-build/input` helpers, while the roadmap calls for bundled reference workflow extensions and keeps user-authored session-plan extraction deferred. This work should create the first compatibility-preserving extraction slice: move session-plan domain behavior behind a bundled adapter/facade while keeping all public routes, wire shapes, files, and build handoff behavior unchanged.

Confirmed facts from static inspection:

- The roadmap explicitly wants bundled reference workflow extensions and says session-plan extraction remains deferred in the Extension Platform section of `docs/roadmap.md`.
- `README.md` describes session plans as driver-side local files in `.eforge/session-plans/`, says the engine consumes normalized build source, and names `@eforge-build/input` as the reusable input-artifact protocol package.
- `docs/extensions.md` and `docs/extensions-api.md` show current native extension runtime support for input sources, PRD enrichers, validation providers, policy gates, actions, declarative Console contributions, and host commands/deep links, but they still list session-plan extraction and raw extension-owned HTTP routes as deferred or unsupported.
- Client route constants still expose compatibility routes for flat session plans and read-only session plan sets in `packages/client/src/routes/route-map.ts` and client-owned wire shapes in `packages/client/src/routes/session-plan.ts` plus `packages/client/src/session-plan-set.ts`.
- Monitor routes currently own session-plan and session-plan-set HTTP behavior in `packages/monitor/src/routes/session-plans.ts`, `session-plan-service.ts`, `session-plan-sets.ts`, and `session-plan-set-service.ts`.
- The broader content route aggregator already groups extensions, playbooks, session plans, and plan sets in `packages/monitor/src/routes/extension-content.ts`.
- Domain parsing, mutation, readiness, normalization, and plan-set read helpers live in `@eforge-build/input`, especially `packages/input/src/session-plan.ts`, `packages/input/src/session-plan-set.ts`, and `packages/input/src/extension-normalize.ts`.
- `normalizeBuildSource` is the enqueue boundary that converts `.eforge/session-plans/*.md` into ordinary build source and preserves inherited `agent_profile`.
- Console `/console/plans` is read-only and fetches both `API_ROUTES.sessionPlanList` / `sessionPlanShow` and `API_ROUTES.sessionPlanSetList` / `sessionPlanSetShow` from `packages/console-ui/src/views/plans/*`.
- `packages/console-ui/README.md` documents the Console planning workspace data flow.
- Pi and Claude host surfaces expose `/eforge:plan`, `/eforge:build`, and the `eforge_session_plan` MCP/Pi tool against the current daemon routes.
- Pi's build selector passes a ready session-plan file path to `/eforge:build`; the daemon/CLI normalizes the path.

Validated assumptions:

- This should be an internal/bundled adapter migration, not a user-loadable native extension in this slice, because raw extension-owned HTTP routes and session-plan extraction are still documented as unsupported/deferred.
- Preserving route keys, wire shapes, file layout, and path-based build handoff is necessary for compatibility because Console, Pi, Claude, and CLI code all consume those surfaces today.

## Goal

Implement the first compatibility-preserving extraction slice for session-plan handling, including the minimal project-local storage SDK helper needed to dogfood the future workflow-extension shape.

External behavior must remain compatible: session plans stay in `.eforge/session-plans/`, existing daemon/client routes and wire shapes remain unchanged, and path-based build handoff with `agent_profile` inheritance continues to work.

## Approach

### Boundary shift

Today, monitor route services call individual `@eforge-build/input` functions directly for each session-plan operation, while `normalizeBuildSource` separately owns path detection and build-source conversion.

After this slice, monitor services should depend on a single bundled session-planning workflow adapter interface for session-plan and session-plan-set behavior. The adapter implementation should delegate to existing `@eforge-build/input` helpers, so behavior remains stable while ownership is shaped like a bundled workflow extension.

The adapter should resolve its project-local storage through a minimal `@eforge-build/extension-sdk` path/storage helper rather than open-coded `.eforge` joins. This dogfoods the same convention that future public workflow extensions should use.

The engine kernel remains unchanged: it continues to receive normalized build source and should not learn about session-plan authoring semantics.

The public daemon/client API remains unchanged: route constants and wire shapes stay owned by `@eforge-build/client`, and Console, Pi, Claude, and CLI callers keep using the existing routes and file paths.

No breaking architecture changes are intended for native extension loading, client route definitions, Console top-level routing, or host command registration.

### SDK helper shape

Add a small exported helper in `@eforge-build/extension-sdk` for resolving and containing project-local `.eforge` storage paths from a project `cwd`.

The helper should be sufficient for a workflow adapter to manage a subdirectory such as `.eforge/session-plans` without ad hoc path joins.

The helper should be small and IO-free. An acceptable shape is a helper that takes `{ cwd, segments }` or a `cwd` plus path segments, returns an absolute path under `<cwd>/.eforge/`, and rejects traversal or escaping paths.

The helper should not require extension runtime loading, daemon route ownership, or a new workflow registration API.

A richer future `ctx.paths` or scoped storage API can build on this primitive later.

### Adapter shape

Introduce a bundled session-planning workflow adapter/facade owned by `@eforge-build/input` or a similarly reusable input/workflow boundary package.

The adapter should expose domain-level operations for flat session plans and read-only session plan sets that map to the existing helper behavior.

The adapter should use the new SDK/project-local storage helper so the internal implementation dogfoods the same path convention future workflow extensions should use.

A descriptor such as `id: 'builtin:session-planning'`, `kind: 'workflow-input-adapter'`, and `sourceScope: 'project-local'` should make the implementation extension-shaped without implying user-installable native-extension support.

Flat-plan operations should cover list, show/load, create, set section, skip dimension, set status, select dimensions, readiness, migrate legacy, path resolution, and build-source normalization/profile extraction.

Plan-set operations should cover list, show/load, and validate only, preserving the current read-only protocol documented in `packages/input/src/session-plan-set.ts`.

Monitor services should perform wire mapping and HTTP error mapping only. Adapter code should own domain semantics.

### Design decisions

Decision 1: Use a bundled adapter/facade rather than a new public native-extension registration API.

Rationale: `docs/extensions.md` and `docs/extensions-api.md` explicitly say session-plan extraction and raw extension-owned HTTP routes are deferred. A bundled adapter gives the desired boundary shape now without promising unsupported third-party extension ownership.

Decision 2: Keep client-owned route and wire contracts unchanged.

Rationale: `packages/client/src/routes/route-map.ts`, Pi/Claude MCP tools, Pi TUI commands, and Console plans views already depend on the existing route keys and response types. Compatibility is the central requirement in the backlog claim.

Decision 3: Put domain operations behind an adapter in or near `@eforge-build/input`.

Rationale: README and `packages/input/src/index.ts` already describe `@eforge-build/input` as the package for reusable input-artifact protocols, and the current session-plan/session-plan-set helper implementations already live there. Keeping the adapter there avoids moving workflow semantics into the engine kernel.

Decision 4: Keep monitor route modules as compatibility shims.

Rationale: The daemon still needs to serve existing routes, enforce local security wrappers, parse/validate HTTP request bodies, and map domain data to client-owned wire responses. Route modules should not own session-plan domain behavior after this refactor.

Decision 5: Include read-only session plan sets in the adapter boundary.

Rationale: Console `/console/plans` displays flat session plans and grouped session plan sets as one planning workspace, and the backlog evidence calls out both route families. Plan sets should stay read-only in this slice because `packages/input/src/session-plan-set.ts` explicitly documents that protocol as read-only.

Decision 6: Preserve existing path-based normalization as the build handoff contract.

Rationale: `/eforge:build` and daemon enqueue currently pass session-plan paths through to enqueue preprocessing, where `normalizeBuildSource` converts them to ordinary build source and extracts `agent_profile`. Changing that handoff would be user-visible and unnecessary for the adapter migration.

Decision 7: Dogfood the future workflow-extension shape where doing so is cheap and compatible.

Rationale: If bundled session-planning/playbook adapters are meant to prove the extension model, they should use the same small project-context/path abstraction that future public workflow extensions would use, even if that abstraction is initially internal or marked experimental. The adapter should not scatter ad hoc `resolve(cwd, '.eforge', ...)` path joins through service code when the long-term goal is extension-owned workflow storage.

### Code impact

Primary implementation targets:

- `packages/extension-sdk/src/*` and `packages/extension-sdk/src/index.ts`: add and export the minimal project-local storage/path helper for resolving contained paths under `<cwd>/.eforge/`; add tests for traversal rejection and normal segment resolution.
- `packages/extension-sdk/package.json`: add any dependency only if necessary. Prefer an implementation that does not force a large dependency; if `@eforge-build/scopes` is needed, add it deliberately and keep the SDK surface small.
- `packages/input/src/session-plan.ts` and/or a new nearby file such as `packages/input/src/session-planning-workflow.ts`: introduce the bundled adapter contract and default implementation that wraps existing flat session-plan helpers and uses the SDK helper for project-local storage resolution.
- `packages/input/src/session-plan-set.ts` and/or the new adapter file: expose read-only plan-set adapter operations for list, show/load, and validate by delegating to existing helpers.
- `packages/input/src/index.ts`: export the adapter contract/default implementation and update package-level comments so the input package advertises the bundled workflow adapter boundary.
- `packages/monitor/src/routes/session-plan-service.ts`: replace direct piecemeal helper imports with calls through the bundled adapter, leaving wire response mapping in the service.
- `packages/monitor/src/routes/session-plan-set-service.ts`: replace direct helper imports with calls through the bundled adapter, leaving wire response mapping in the service.
- `packages/monitor/src/routes/enqueue-service.ts` and CLI in-process paths such as `packages/eforge/src/cli/run-or-delegate.ts` and `packages/eforge/src/cli/index.ts` if still active: keep or lightly adapt `agent_profile` detection so it uses the same adapter-backed normalization path and remains compatible.
- `packages/monitor/src/__tests__/routes-session-plans.test.ts` and `routes-session-plan-sets.test.ts`: keep route compatibility coverage passing and add assertions if needed for adapter-backed behavior.
- Add or update input-level tests for adapter behavior, likely under `test/` if the repo keeps package tests there or under package-local test files if an existing pattern is found during implementation.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts`: extend or add a source-contract test only if useful to prevent services from re-expanding direct session-plan helper orchestration.

Secondary compatibility targets to inspect during implementation:

- `packages/pi-eforge/extensions/eforge/index.ts`, `packages/pi-eforge/extensions/eforge/plan-command.ts`, and `packages/pi-eforge/extensions/eforge/build-command.ts` should not require behavioral changes if routes and wire shapes remain unchanged.
- `packages/eforge/src/cli/mcp-proxy.ts` should not require behavioral changes if daemon route compatibility remains unchanged.
- `packages/console-ui/src/views/plans/*` and `packages/console-ui/src/views/system/*` should not require behavioral changes if route compatibility remains unchanged.

Patterns to preserve:

- Use client-owned `API_ROUTES` and wire types; do not inline `/api/...` path literals or duplicate wire response interfaces in monitor services.
- Keep monitor imports of `@eforge-build/input` lazy where the existing source-contract test requires it.
- Keep route modules responsible for HTTP validation/security and adapter/service modules responsible for domain execution.
- Keep the SDK helper small, deterministic, and safe-by-default; it should not imply general route ownership or public workflow-extension registration support.

### Documentation impact

Likely affected documentation:

- `README.md`: update the session-plan/input-artifact wording only if implementation changes the ownership description. Keep user-facing behavior the same: session plans remain `.eforge/session-plans/` files and the engine receives normalized build source.
- `docs/extensions.md`: replace or qualify the statement that session-plan extraction is fully deferred. Suggested wording: the bundled session-planning adapter exists as an internal compatibility-preserving workflow boundary, while user-authored native session-plan workflow extensions and raw extension-owned HTTP routes remain deferred.
- `docs/extensions-api.md`: update the runtime-support status table or deferred-work paragraph only if the adapter is exported as an SDK/public type. If it remains internal to `@eforge-build/input`, document it conceptually rather than as a native extension API.
- `packages/input/src/index.ts` package comments: update to describe the bundled session-planning workflow adapter boundary.
- `packages/console-ui/README.md`: likely no change is needed unless implementation changes the Console planning workspace data-flow description. If updated, it must continue to document the same REST routes.

Generated documentation may need regeneration if these docs feed generated references; run the existing docs check/generation command if touched files indicate drift.

### Risks and mitigations

Compatibility risks:

- Route or wire drift would break Console, Pi, Claude MCP, or CLI callers. Mitigation: keep `API_ROUTES` keys and response types unchanged and rely on existing route tests plus added compatibility assertions.
- Changing path normalization could break `/eforge:build` handoff from ready session plans or inherited `agent_profile` behavior. Mitigation: keep `.eforge/session-plans/*.md` path matching and add or retain tests for normalization/profile extraction.
- Plan-set behavior could accidentally become mutable or enqueue-capable. Mitigation: keep plan-set adapter operations read-only and add tests/doc comments that preserve the read-only contract.
- A too-public adapter contract could imply third-party session-plan extension support before the runtime supports route ownership or workflow extraction. Mitigation: name and document the adapter as bundled/internal or input-package-level, not as an `EforgeExtensionAPI` registration method.
- A mechanical wrapper that simply adds indirection without source-contract coverage could regress back to route-owned behavior later. Mitigation: add source-contract or adapter-level tests that make the new boundary explicit.

Implementation risks:

- The adapter may introduce circular imports if it is placed in `session-plan.ts` while wrapping helpers from the same file. Mitigation: prefer a separate module that imports existing helper modules and exports a default adapter, or split helper internals only if needed.
- Monitor source-contract tests already require lazy `@eforge-build/input` dependencies in content route modules. Mitigation: continue lazy imports inside service functions rather than adding static input imports to route modules.
- Documentation wording must not overclaim that user-authored native workflow extensions are supported. Mitigation: explicitly distinguish bundled adapter foundation from future external extension APIs.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The correct first slice is a bundled/internal adapter rather than public third-party native workflow-extension support. | `docs/extensions.md` and `docs/extensions-api.md` list session-plan extraction, raw extension-owned HTTP routes, and arbitrary frontend extension bundles as deferred or unsupported. The roadmap asks for bundled reference workflow extensions. | high | low | Re-read extension docs during implementation and avoid adding an `EforgeExtensionAPI` method unless a separate PRD explicitly scopes it. | Overclaiming public extension support would create API obligations and likely require more runtime infrastructure than this slice should build. |
| Existing public routes and wire shapes must remain unchanged. | `packages/client/src/routes/route-map.ts`, `packages/client/src/routes/session-plan.ts`, `packages/client/src/session-plan-set.ts`, Pi command/tool code, Claude MCP tool code, and Console plans code all use the current route families and wire types. | high | low | Run type-check and route/Console tests; inspect generated route references if docs are regenerated. | Route drift would break current Console, Pi, Claude, or CLI users. |
| Session-plan sets should stay read-only in this slice. | `packages/input/src/session-plan-set.ts` documents the session plan-set protocol as read-only and Console only displays summaries/detail. | high | low | Keep adapter operations for plan sets limited to list/show/validate and preserve route methods. | Adding mutation/enqueue semantics could expand scope and create unplanned product behavior. |
| Path-based session-plan build handoff should remain the compatibility contract. | Pi build selector passes ready plan paths, build skills tell agents to use session-plan file paths, and `normalizeBuildSource` currently converts `.eforge/session-plans/*.md` files to ordinary build source. | high | low | Add/retain normalization tests for content conversion and `agent_profile` extraction. | Changing handoff would break existing `/eforge:build` behavior. |
| Monitor route services can be refactored to the adapter without changing route modules or client code. | Services already lazily import `@eforge-build/input` and mostly map domain helper results to client wire responses. Existing source-contract tests encourage this boundary. | medium | low | Implement one service path first, run route tests, and adjust adapter shape if wire mapping exposes missing domain fields. | If wrong, scope may require additional mapper functions but should not require public API changes. |

No low-confidence, high-impact assumption remains unresolved. The highest-impact assumptions were validated through static inspection of docs, route constants, service code, input helpers, Console data flow, and Pi/Claude host surfaces.

### Profile signal

Recommended profile: `excursion`.

Rationale: This is a cross-package architecture refactor, but it is a cohesive boundary migration with a clear sequence: introduce adapter, route services through it, preserve compatibility tests, and update docs. A single planner can enumerate the affected modules and dependencies without requiring delegated module planning. Expedition is not warranted because there is no need for independently planned submodules or a multi-wave dependency graph.

## Scope

In scope:

- Add a small exported helper in `@eforge-build/extension-sdk` for resolving and containing project-local `.eforge` storage paths from a project `cwd`, sufficient for a workflow adapter to manage a subdirectory such as `.eforge/session-plans` without ad hoc path joins.
- Introduce a bundled session-planning workflow adapter/facade owned by `@eforge-build/input` or a similarly reusable input/workflow boundary package.
- Expose adapter domain-level operations for flat session plans and read-only session plan sets that map to the existing helper behavior.
- Make the bundled session-planning adapter use the new SDK/project-local storage helper so the internal implementation dogfoods the same path convention future workflow extensions should use.
- Update monitor session-plan and session-plan-set services to call the bundled adapter instead of directly orchestrating many individual `@eforge-build/input` helpers.
- Keep existing daemon route keys, HTTP methods, route paths, request/response wire shapes, security wrappers, and route registration order compatible for current clients.
- Keep `.eforge/session-plans/*.md` path-based build handoff and `agent_profile` inheritance behavior compatible at enqueue time.
- Add tests that lock in the SDK helper, adapter boundary, and public compatibility behavior.
- Update documentation to describe session plans as backed by a bundled workflow/input adapter.
- Update documentation to document the new minimal project-local storage helper.
- Update documentation to note that user-authored native session-plan workflow extensions and raw extension-owned HTTP routes remain future work.

Out of scope:

- Do not add a full public workflow-extension registration API in this slice.
- Do not add `ctx.paths` to every extension hook context unless implementation finds it cheaper than a standalone SDK helper; a standalone helper is sufficient for this plan.
- Do not remove or rename `API_ROUTES.sessionPlan*` or `API_ROUTES.sessionPlanSet*` in this slice.
- Do not require Console, Pi, Claude, or CLI users to use new route names, URI schemes, or commands.
- Do not implement arbitrary extension-owned HTTP routes.
- Do not implement arbitrary Console frontend bundles.
- Do not implement a user-authored session-plan native extension registration API.
- Do not migrate session-plan files out of `.eforge/session-plans/`.
- Do not change current session-plan frontmatter fields.
- Do not change current session-plan wire fields.
- Do not change playbook extraction beyond any minimal compile fixes needed because `sessionPlanCreateFromPlaybook` depends on the session-plan creation path.

## Acceptance Criteria

- `@eforge-build/extension-sdk` exports a minimal project-local storage/path helper.
- The project-local storage/path helper resolves absolute paths under `<cwd>/.eforge/` from safe path segments.
- The project-local storage/path helper rejects empty segment inputs.
- The project-local storage/path helper rejects traversal segment inputs.
- The project-local storage/path helper rejects absolute segment inputs.
- The project-local storage/path helper rejects separator-escaping segment inputs that would escape `<cwd>/.eforge/`.
- The project-local storage/path helper does not perform filesystem I/O.
- The project-local storage/path helper can be used without extension runtime loading.
- SDK helper tests prove normal segment resolution.
- SDK helper tests prove traversal rejection.
- `@eforge-build/input` exports a bundled session-planning workflow adapter contract, factory, or both.
- TypeScript consumers can import the bundled session-planning workflow adapter boundary from `@eforge-build/input`.
- The bundled session-planning adapter exposes flat session-plan operations without importing `@eforge-build/client`.
- The bundled session-planning adapter exposes read-only session-plan-set operations without importing `@eforge-build/client`.
- The bundled session-planning adapter descriptor includes `id: 'builtin:session-planning'`.
- The bundled session-planning adapter descriptor includes `kind: 'workflow-input-adapter'`.
- The bundled session-planning adapter descriptor includes `sourceScope: 'project-local'`.
- The bundled session-planning adapter exposes a flat session-plan list operation.
- The bundled session-planning adapter exposes a flat session-plan show/load operation.
- The bundled session-planning adapter exposes a flat session-plan create operation.
- The bundled session-planning adapter exposes a flat session-plan set-section operation.
- The bundled session-planning adapter exposes a flat session-plan skip-dimension operation.
- The bundled session-planning adapter exposes a flat session-plan set-status operation.
- The bundled session-planning adapter exposes a flat session-plan select-dimensions operation.
- The bundled session-planning adapter exposes a flat session-plan readiness operation.
- The bundled session-planning adapter exposes a flat session-plan migrate-legacy operation.
- The bundled session-planning adapter exposes a flat session-plan path-resolution operation.
- The bundled session-planning adapter exposes build-source normalization/profile extraction behavior.
- The bundled session-planning adapter exposes a session-plan-set list operation.
- The bundled session-planning adapter exposes a session-plan-set show/load operation.
- The bundled session-planning adapter exposes a session-plan-set validate operation.
- The bundled session-planning adapter does not expose session-plan-set mutation operations.
- The bundled session-planning adapter delegates flat session-plan behavior to the existing `@eforge-build/input` helper behavior.
- The bundled session-planning adapter delegates session-plan-set behavior to the existing `@eforge-build/input` helper behavior.
- The bundled session-planning adapter uses the new SDK project-local storage/path helper to resolve its session-plan storage root.
- The bundled session-planning adapter does not scatter ad hoc `.eforge/session-plans` path joins through monitor service code.
- Monitor session-plan service code invokes the bundled session-planning adapter for list behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for show behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for create behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for set-section behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for skip-dimension behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for set-status behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for select-dimensions behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for readiness behavior.
- Monitor session-plan service code invokes the bundled session-planning adapter for legacy migration behavior.
- Monitor session-plan-set service code invokes the bundled session-planning adapter for list behavior.
- Monitor session-plan-set service code invokes the bundled session-planning adapter for show behavior.
- Monitor session-plan-set service code invokes the bundled session-planning adapter for validate behavior.
- Monitor session-plan service code keeps wire response mapping in the service layer.
- Monitor session-plan-set service code keeps wire response mapping in the service layer.
- Monitor session-plan service code keeps HTTP error mapping in the service layer.
- Monitor session-plan-set service code keeps HTTP error mapping in the service layer.
- Monitor route modules continue to enforce existing local security wrappers for session-plan and session-plan-set routes.
- Monitor route modules continue to parse and validate HTTP request bodies for session-plan and session-plan-set routes.
- Monitor imports of `@eforge-build/input` remain lazy where the existing source-contract test requires lazy imports.
- `packages/client/src/routes/route-map.ts` keeps the existing `sessionPlan*` route keys unchanged.
- `packages/client/src/routes/route-map.ts` keeps the existing `sessionPlan*` path strings unchanged.
- `packages/client/src/routes/route-map.ts` keeps the existing `sessionPlanSet*` route keys unchanged.
- `packages/client/src/routes/route-map.ts` keeps the existing `sessionPlanSet*` path strings unchanged.
- Existing session-plan HTTP methods remain unchanged.
- Existing session-plan-set HTTP methods remain unchanged.
- Existing session-plan route registration order remains compatible with current clients.
- Existing session-plan-set route registration order remains compatible with current clients.
- `packages/client/src/routes/session-plan.ts` keeps the existing exported session-plan request interface names available to TypeScript consumers.
- `packages/client/src/routes/session-plan.ts` keeps the existing exported session-plan response interface names available to TypeScript consumers.
- `packages/client/src/session-plan-set.ts` keeps the existing exported session-plan-set request interface names available to TypeScript consumers.
- `packages/client/src/session-plan-set.ts` keeps the existing exported session-plan-set response interface names available to TypeScript consumers.
- Monitor services use client-owned `API_ROUTES` and wire types for session-plan and session-plan-set APIs.
- Monitor services do not inline `/api/...` path literals for session-plan or session-plan-set APIs.
- Monitor services do not duplicate client-owned session-plan response interfaces.
- Monitor services do not duplicate client-owned session-plan-set response interfaces.
- Existing session-plan route tests pass against the adapter-backed implementation.
- Existing session-plan-set route tests pass against the adapter-backed implementation.
- A test proves `.eforge/session-plans/<session>.md` build-source normalization still returns ordinary build-source content for a valid session plan.
- A test proves session-plan `agent_profile` frontmatter still flows through normalization as the inherited agent profile.
- `.eforge/session-plans/*.md` path-based build handoff remains compatible at enqueue time.
- `/eforge:build` continues to accept ready session-plan file paths through the existing daemon/CLI normalization path.
- Plan-set behavior remains read-only.
- Plan-set behavior does not become enqueue-capable.
- The implementation does not add a full public workflow-extension registration API.
- The implementation does not add an `EforgeExtensionAPI` method for user-authored session-plan workflow extensions.
- The implementation does not add arbitrary extension-owned HTTP routes.
- The implementation does not add arbitrary Console frontend bundles.
- The implementation does not migrate session-plan files out of `.eforge/session-plans/`.
- The implementation does not change current session-plan frontmatter fields.
- The implementation does not change current session-plan wire fields.
- Playbook extraction remains unchanged except for any minimal compile fixes needed because `sessionPlanCreateFromPlaybook` depends on the session-plan creation path.
- A source-contract or adapter test prevents monitor content route modules from re-declaring client-owned response wire shapes for the session-plan APIs.
- A source-contract or adapter test prevents monitor content route modules from re-declaring client-owned response wire shapes for the session-plan-set APIs.
- Documentation distinguishes the shipped bundled session-planning adapter boundary from future user-authored native session-plan extensions.
- Documentation distinguishes the shipped bundled session-planning adapter boundary from unsupported raw extension-owned HTTP routes.
- Documentation describes the new SDK project-local storage/path helper.
- Documentation describes the project-local storage/path helper containment guarantees.
- User-facing documentation continues to state that session plans remain `.eforge/session-plans/` files.
- User-facing documentation continues to state that the engine receives normalized build source.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.

## Manual Verification Notes

- Re-read `docs/extensions.md` and `docs/extensions-api.md` during implementation and avoid adding an `EforgeExtensionAPI` method unless a separate PRD explicitly scopes it.
- Inspect generated route references if documentation is regenerated.
- Run the existing docs check/generation command if touched files indicate generated documentation drift.
- Implement one monitor service path first, run route tests, and adjust adapter shape if wire mapping exposes missing domain fields.