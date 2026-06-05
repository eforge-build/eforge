---
title: Move Playbooks Behind the Bundled Workflow Adapter
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Move Playbooks Behind the Bundled Workflow Adapter

## Problem / Motivation

Playbooks remain direct first-party scoped input artifacts, while session plans have already moved behind a bundled workflow-shaped adapter. This creates an ownership-boundary mismatch in the input/monitor/client integration stack.

The backlog item `.backlog/items/backlog-2026-06-01-move-playbooks-behind-the-same-bundled-workflow-extension-pa.md` is now unblocked because the session-plan adapter path shipped.

Current evidence:

- `packages/input/src/session-planning-workflow.ts` exports `SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR` with `{ id: 'builtin:session-planning', kind: 'workflow-input-adapter', sourceScope: 'project-local' }` and `createSessionPlanningWorkflowAdapter()` with `flat` and `planSets` surfaces.
- `packages/monitor/src/routes/session-plan-service.ts` lazily calls `createSessionPlanningWorkflowAdapter()` and dispatches session-plan list/load/create/mutate/readiness/migrate operations through `adapter.flat.*`.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` enforces the session-plan pattern.
- `packages/monitor/src/routes/playbook-service.ts` still directly imports and calls lower-level playbook/session-plan helpers from `@eforge-build/input`.
- `packages/client/src/routes/route-map.ts` still exposes compatibility routes for playbook operations and `sessionPlanCreateFromPlaybook`.
- `packages/input/src/playbook.ts` owns the current playbook protocol and is already 731 lines.
- Existing docs describe session planning as using a bundled internal adapter while playbook extraction remains deferred or first-party scoped.
- `docs/roadmap.md` aligns this work with Extension Platform and Console Observability goals.

## Goal

Move playbook domain operations behind a bundled workflow-shaped adapter in `@eforge-build/input`, matching the shipped session-planning adapter pattern.

Preserve public daemon/client route contracts and engine input-agnostic behavior while refactoring ownership boundaries behind compatibility routes.

## Approach

- Add a new playbook workflow adapter in `@eforge-build/input`, likely `packages/input/src/playbook-workflow.ts`.
- Define a descriptor such as `id: 'builtin:playbooks'`, `kind: 'workflow-input-adapter'`, and a source-scope representation for the three scoped playbook tiers.
- Expose adapter surfaces for list, load, save/write, move/promote/demote, copy, raw validation, autonomous build-source compilation, and planning-mode session-plan seeding.
- Refactor `packages/monitor/src/routes/playbook-service.ts` to lazily obtain `createPlaybookWorkflowAdapter()` and call adapter methods for playbook domain behavior.
- Keep route security, JSON validation, error mapping, landing-action validation, queue dependency handling, profile lookup, acceptance-criteria inventory derivation, and scheduler notification in the daemon service layer.
- Keep `packages/client/src/routes/route-map.ts` and existing route names stable as compatibility shims.
- Keep the engine receiving normalized build source only.
- Do not import `@eforge-build/client`, `@eforge-build/engine`, monitor route helpers, or daemon HTTP clients from `@eforge-build/input`.
- Keep `packages/input/src/playbook.ts` as the lower-level protocol implementation and avoid broad rewrites.
- Add source-contract tests comparable to the existing session-plan source-contract tests.
- Update docs to distinguish shipped bundled playbook adapter support from future unsupported user-authored workflow registration APIs.

Target flow:

- Client-owned routes and host tools remain compatibility surfaces.
- Monitor routes remain thin HTTP shims.
- `playbook-service.ts` becomes a compatibility/orchestration layer that calls the bundled playbook workflow adapter.
- The new playbook adapter wraps lower-level playbook helpers behind a descriptor-bearing workflow boundary.
- Autonomous playbook run compiles through the adapter, then the monitor service performs profile validation, AC inventory derivation, queue dependency classification, `enqueuePrd()`, and scheduler notification.
- Planning-mode `sessionPlanCreateFromPlaybook` is adapter-owned because it is input-domain artifact conversion/creation.
- Planning-mode seed creation still writes only to `.eforge/session-plans/` through existing session-plan path safety helpers.
- `POST /api/playbook/run` preserves current planning-mode behavior by returning `requires-agent`.

Key implementation targets:

- `packages/input/src/playbook-workflow.ts`
- `packages/input/src/index.ts`
- `packages/input/README.md`
- `packages/monitor/src/routes/playbook-service.ts`
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts`
- `test/playbook-workflow.test.ts` or `test/session-planning-workflow.test.ts`
- `README.md`
- `docs/architecture.md`
- `docs/config.md`
- `docs/extensions.md`
- `docs/extensions-api.md`
- `packages/extension-sdk/README.md`

Files intentionally not targeted for behavior changes:

- `packages/client/src/routes/route-map.ts`
- `packages/client/src/api/playbook.ts`
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
- `packages/pi-eforge/extensions/eforge/index.ts`
- `packages/eforge/src/cli/playbook.ts`
- `packages/eforge/src/cli/mcp-proxy.ts`
- `eforge-plugin/skills/playbook/playbook.md`

Design decisions:

- Implement a bundled playbook workflow adapter in `@eforge-build/input`, not a native extension SDK registration.
- Keep existing daemon/client route contracts as compatibility shims.
- Let the adapter own playbook input-domain behavior while the monitor service owns daemon orchestration.
- Use a new adapter file rather than moving or rewriting `playbook.ts`.
- Add source-contract tests to prevent regression to direct daemon ownership.
- Document the bundled playbook adapter as shipped while keeping custom/user-authored workflow extraction as future work.
- Preserve planning-mode run behavior.

## Scope

In scope:

- Add a playbook workflow adapter in `@eforge-build/input`.
- Export `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`, `createPlaybookWorkflowAdapter()`, adapter interfaces, and adapter types.
- Add adapter methods for list, load, save/write, move/promote/demote, copy, raw validation, autonomous build-source compilation, and planning-mode session-plan seeding.
- Refactor `packages/monitor/src/routes/playbook-service.ts` to delegate playbook domain behavior through the adapter.
- Preserve daemon orchestration concerns in `playbook-service.ts`.
- Add or update tests enforcing the adapter boundary.
- Update `packages/input` exports and documentation.
- Preserve the statement that the engine only consumes normalized build source.
- Keep the new adapter file under 600 lines.
- Keep new or moved functions at Cognitive Complexity <= 30 unless justified inline.
- Keep edits to `packages/input/src/index.ts` bounded because it is already 291 lines.
- Keep edits to `packages/input/src/playbook.ts` small and bounded if required.
- Preserve current playbook Markdown frontmatter/body format.
- Preserve scope precedence and shadowing semantics.
- Preserve autonomous and planning mode behavior.

Out of scope:

- Do not remove or rename `/api/playbook/*`.
- Do not remove or rename `/api/session-plan/create-from-playbook`.
- Do not remove or rename `eforge_playbook`.
- Do not remove or rename `eforge playbook`.
- Do not remove or rename `/eforge:playbook`.
- Do not add a user-authored native extension registration API for playbook extraction.
- Do not change playbook Markdown frontmatter/body format.
- Do not change scope precedence.
- Do not change shadowing semantics.
- Do not change autonomous/planning mode behavior.
- Do not change session-plan adapter behavior except where needed to call it from the playbook adapter for planning-mode seed creation.
- Do not rewrite large host integration files unless a compile/test failure requires a bounded compatibility edit.
- Do not make the build engine depend on playbooks.
- Do not make `@eforge-build/input` import `@eforge-build/client`.
- Do not make `@eforge-build/input` import `@eforge-build/engine`.
- Do not make `@eforge-build/input` import monitor route helpers.
- Do not make `@eforge-build/input` import daemon HTTP clients.

## Acceptance Criteria

- `packages/input/src/playbook-workflow.ts` exports a descriptor for the bundled playbook workflow adapter.
- The bundled playbook workflow adapter descriptor has `kind: 'workflow-input-adapter'`.
- The bundled playbook workflow adapter descriptor has an id such as `builtin:playbooks`.
- The bundled playbook workflow adapter descriptor represents the three scoped playbook tiers.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for listing playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for loading playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for saving or writing playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for moving playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for promoting playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for demoting playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for copying playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for raw playbook validation.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for compiling autonomous playbooks.
- `createPlaybookWorkflowAdapter()` exposes an adapter method for seeding planning-mode session plans.
- `packages/input/src/index.ts` re-exports the playbook workflow adapter factory.
- `packages/input/src/index.ts` re-exports the playbook workflow adapter descriptor.
- `packages/input/src/index.ts` re-exports the public playbook workflow adapter types.
- `packages/monitor/src/routes/playbook-service.ts` calls `createPlaybookWorkflowAdapter()` for playbook domain operations.
- `packages/monitor/src/routes/playbook-service.ts` does not directly import lower-level playbook helper functions from `@eforge-build/input`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `listPlaybooks`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `loadPlaybook`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `writePlaybook`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `movePlaybook`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `copyPlaybookToScope`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `validatePlaybook`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `playbookToBuildSource`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `createSessionPlanFromPlaybookSeed`.
- `packages/monitor/src/routes/playbook-service.ts` does not directly call `resolveSessionPlanPath`.
- `packages/monitor/src/routes/playbook-service.ts` keeps autonomous playbook queue enqueueing outside the input adapter.
- `packages/monitor/src/routes/playbook-service.ts` keeps queue dependency handling outside the input adapter.
- `packages/monitor/src/routes/playbook-service.ts` keeps landing-action validation outside the input adapter.
- `packages/monitor/src/routes/playbook-service.ts` keeps scheduler notification outside the input adapter.
- `packages/monitor/src/routes/playbook-service.ts` keeps profile validation outside the input adapter.
- `packages/monitor/src/routes/playbook-service.ts` keeps acceptance-criteria inventory derivation outside the input adapter.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` fails if `playbook-service.ts` stops using the playbook workflow adapter for playbook domain operations.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` fails if `playbook-service.ts` directly calls lower-level playbook helper functions that the adapter should own.
- A direct adapter test verifies the playbook workflow adapter descriptor.
- A direct adapter test verifies playbook list behavior through the adapter.
- A direct adapter test verifies playbook load behavior through the adapter.
- A direct adapter test verifies playbook save behavior through the adapter.
- A direct adapter test verifies playbook move behavior through the adapter.
- A direct adapter test verifies playbook copy behavior through the adapter.
- A direct adapter test verifies raw validation behavior through the adapter.
- A direct adapter test verifies autonomous playbook compilation through the adapter returns the same build-source content semantics as the existing helper path.
- A direct adapter test verifies planning-mode playbook seed creation writes a session plan with seeded playbook content.
- A direct adapter test verifies planning-mode playbook seed creation inherits `agent_profile` when the playbook declares `profile`.
- A direct adapter test verifies `packages/input/src/playbook-workflow.ts` does not import `@eforge-build/client`.
- A direct adapter test verifies `packages/input/src/playbook-workflow.ts` does not import `@eforge-build/engine`.
- Existing playbook route tests for list pass without changing public route names.
- Existing playbook route tests for show pass without changing public route names.
- Existing playbook route tests for save pass without changing public route names.
- Existing playbook route tests for run pass without changing public route names.
- Existing playbook route tests for promote pass without changing public route names.
- Existing playbook route tests for demote pass without changing public route names.
- Existing playbook route tests for validate pass without changing public route names.
- Existing playbook route tests for copy pass without changing public route names.
- Existing playbook route tests for profile handling pass without changing public route names.
- Existing `sessionPlanCreateFromPlaybook` route tests pass without changing public route names.
- `README.md` describes playbooks as owned by the bundled playbook workflow adapter before the engine receives normalized build source.
- `docs/architecture.md` describes the playbook route flow as `client` to `monitor compatibility shim` to `input bundled adapter` to lower-level input helpers.
- `docs/config.md` describes playbooks as scoped artifacts managed through the bundled playbook workflow adapter.
- `docs/extensions.md` no longer describes bundled playbook extraction as deferred.
- `docs/extensions-api.md` no longer describes bundled playbook extraction as deferred.
- `packages/extension-sdk/README.md` no longer describes bundled playbook extraction as deferred.
- Documentation still states that user-authored native extension workflow registration for custom playbook extraction is future or unsupported.
- `packages/input/README.md` includes a bundled playbook workflow adapter section analogous to the bundled session-planning workflow adapter section.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookList`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookShow`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookSave`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookRun`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookPromote`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookDemote`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookValidate`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `playbookCopy`.
- `packages/client/src/routes/route-map.ts` keeps the direct compatibility route for `sessionPlanCreateFromPlaybook`.
- `POST /api/playbook/run` returns `requires-agent` for planning playbooks.
- Planning-mode seed creation writes only to `.eforge/session-plans/` through existing session-plan path safety helpers.
- The engine continues to receive normalized build source only.
- `@eforge-build/input` does not import `@eforge-build/client`.
- `@eforge-build/input` does not import `@eforge-build/engine`.
- `@eforge-build/input` does not import monitor route helpers.
- `@eforge-build/input` does not import daemon HTTP clients.
- `pnpm test -- test/playbook-workflow.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts packages/monitor/src/__tests__/routes-playbooks.test.ts test/daemon-session-plan-routes-playbook.test.ts` exits 0.
- `pnpm type-check` exits 0.

## Manual Verification Notes

Cheap/static validations already performed:

- Read the backlog item and confirmed it is unblocked after the session-plan adapter shipped.
- Read `packages/input/src/session-planning-workflow.ts`, `packages/monitor/src/routes/session-plan-service.ts`, and `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` to validate the session-plan adapter pattern.
- Read `packages/monitor/src/routes/playbook-service.ts`, `packages/input/src/playbook.ts`, and `packages/client/src/routes/route-map.ts` to validate that playbooks still use direct helper imports behind compatibility routes.
- Searched for `createPlaybookWorkflowAdapter`, `PLAYBOOK_WORKFLOW`, and `builtin:playbook` and found no existing playbook workflow adapter.
- Read `docs/roadmap.md`, `README.md`, `docs/architecture.md`, `docs/config.md`, `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` snippets to validate roadmap alignment and stale documentation wording.
- Checked line counts for likely implementation targets; `packages/input/src/playbook.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, and `packages/pi-eforge/extensions/eforge/index.ts` are oversized and should only receive bounded edits.

Assumptions and validation notes:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The intended "same bundled workflow-extension pattern" is the internal `@eforge-build/input` adapter pattern, not a user-authored native extension registration API. | Current session-plan implementation uses `createSessionPlanningWorkflowAdapter()`; docs explicitly say user-authored session-plan/playbook extraction is deferred; roadmap says bundled reference workflow extensions are the next step. | high | low | Re-read PR #141 discussion if available, or ask the maintainer before implementation starts. | High: implementing an SDK registration API would expand scope and likely require API design beyond this backlog item. |
| Existing playbook daemon/client routes should remain compatibility surfaces for this slice. | Session-plan routes remained after adapter extraction; client route constants are used by CLI, MCP, Pi, Console, and tests. | high | low | Run `rg` for `API_ROUTES.playbook` and keep route names unchanged during implementation. | High: route removal would break integrations and turn a refactor into a migration. |
| A playbook adapter can be implemented without importing `@eforge-build/client` or `@eforge-build/engine`. | Existing lower-level playbook and session-plan helpers live in `@eforge-build/input`; queue/profile/landing behavior can stay in monitor service. | high | low | Add adapter source tests that assert no client or engine imports. | High: engine/client imports in input would violate architecture boundaries. |
| Planning-mode `sessionPlanCreateFromPlaybook` can be adapter-owned while investigation-first `playbook run` remains agent-owned. | `createSessionPlanFromPlaybookSeed`, `writeSessionPlan`, and `resolveSessionPlanPath` already live in `@eforge-build/input`; `POST /api/playbook/run` currently returns `requires-agent` for planning playbooks. | high | low | Preserve existing `daemon-session-plan-routes-playbook` and playbook run tests. | Medium: wrong ownership could accidentally bypass interactive planning or duplicate session-plan logic. |
| Host integrations do not need user-facing behavior changes if daemon route contracts stay stable. | Pi, Claude MCP, CLI, and Console use client helpers and route constants; the planned changes are behind daemon services. | medium | low | Run targeted CLI/Pi/playbook tests if type-check or route tests indicate surface drift. | Medium: a hidden response-shape or error-text change could require bounded integration updates. |
| Documentation can mark bundled playbook extraction as shipped while still saying custom user-authored workflow registration is future work. | Docs currently distinguish bundled session-planning adapter from future user-authored extraction; the same distinction can be applied to playbooks. | high | low | Search docs for broad `playbook extraction` deferred wording after edits. | Medium: stale wording would make backlog rechecks incorrectly consider the item unshipped. |

No low-confidence/high-impact assumptions remain.

The only medium-confidence assumption is host-integration no-op scope, and it has a cheap validation path through type-check plus targeted playbook/host tests.

Recommended profile: **Excursion**.

Profile rationale: this is a cohesive architecture-boundary refactor across `@eforge-build/input`, monitor route services, tests, and documentation. A single planner can enumerate the adapter, service, test, and documentation changes without requiring delegated subsystem planning. It is broader than an Errand because it touches package boundaries and compatibility-route ownership. It does not need Expedition because there is one central design axis and the work should not require independently planned submodules.