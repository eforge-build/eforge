---
title: Move Console Plans into the eforge-plan Workstation
created: 2026-06-06
depends_on: ["fix-eforge-plan-list-board-json-safe-output"]
landing: pr
landing_auto_merge: true
stack_parent: fix-eforge-plan-list-board-json-safe-output
---

# Move Console Plans into the eforge-plan Workstation

## Problem / Motivation

The first-party Console still owns a top-level `Plans` route/page, while the backlog item and linked epic state that session-plan interaction, management, readiness, creation, editing, and build handoff UX should move into the `eforge-plan` extension workstation.

Backlog source: `.backlog/items/backlog-2026-06-06-move-built-in-console-plans-into-the-eforge-plan-workstation.md`.

Validated facts from static inspection:

- The backlog item and linked epic state the desired boundary: remove the first-party Console `Plans` route/page and move session-plan interaction/management/readiness/creation/editing/build handoff UX into the `eforge-plan` extension workstation.
- `docs/roadmap.md` supports engine boundary discipline and extension-owned workflow UX, but the `Console Observability and Control` section still says planning artifact browsing should be available in Console. That roadmap wording is now stale relative to this backlog claim and should be updated.
- `packages/console-ui/README.md` and `packages/console-ui/src/lib/navigation.ts` still document and implement `/console/plans` as a top-level first-party Planning Workspace, with a `Plans` nav item.
- `packages/console-ui/src/App.tsx` lazy-loads `PlansView` and renders it when `parseConsoleRoute()` returns `plans`.
- `packages/console-ui/src/views/plans/*` implements the current read-only Plans route by fetching flat session plans and session plan sets.
- `packages/console-ui/src/views/system/session-plans-section.tsx` and `use-system-surfaces.ts` still expose a first-party System summary of session plans via `API_ROUTES.sessionPlanList`.
- `eforge/extensions/eforge-plan/index.ts` currently registers backlog/board/promotion actions, an input source, declarative System contribution, integration commands, deep links, and a small `srcDoc` board workstation that only invokes `render-board-markdown`.
- `eforge/extensions/eforge-plan/README.md` explicitly says the full eforge-plan bundle workstation UX is deferred and that the current workstation is a proof-of-concept board.
- `packages/extension-sdk/README.md`, `packages/console-ui/README.md`, and `packages/monitor/src/routes/extensions/workstations.ts` confirm frame-bundle workstations are now supported through daemon-owned frame/asset routes and sandboxed iframes; extension JavaScript must run inside the workstation iframe and invoke allowed actions through `window.eforge.invokeAction`.
- `@eforge-build/input` already exposes a bundled session-planning workflow adapter in `packages/input/src/session-planning-workflow.ts`, covering flat session-plan list/load/create/set-section/skip/set-status/select-dimensions/readiness/migrate/normalize plus read-only plan-set list/load/validate operations.
- `packages/client/src/routes/session-plan.ts`, `packages/client/src/api/session-plan.ts`, `packages/monitor/src/routes/session-plans.ts`, and `packages/monitor/src/routes/session-plan-sets.ts` still own compatibility daemon/client routes. These routes should not be removed in this slice; they remain compatibility plumbing for Pi/Claude/CLI and for any extension-owned workflow needing the same artifact protocol.
- The related backlog item `.backlog/items/backlog-2026-06-06-fix-eforge-plan-list-board-action-json-safe-output.md` reports that `eforge-plan:list-board` currently returns non-JSON-safe output. A richer workstation that consumes structured board/planning data must fix or avoid that output bug.

Classification: this is an **architecture / deep** change with high confidence. It changes Console route ownership and extension workflow boundaries while preserving daemon/client compatibility routes.

## Goal

Move planning product UX out of the core Console and into the `eforge-plan` extension workstation, while preserving daemon/client session-plan compatibility routes for existing Pi, Claude, CLI, and extension workflows.

## Approach

Target boundary after this change:

```mermaid
flowchart LR
  Console[Core Console shell] --> Workstations[/console/workstations]
  Workstations --> PlanFrame[eforge-plan workstation iframe]
  PlanFrame --> Bridge[window.eforge.invokeAction]
  Bridge --> Actions[eforge-plan extension actions]
  Actions --> InputAdapter[@eforge-build/input session-planning adapter]
  Actions --> Backlog[.backlog items and epics]
  InputAdapter --> SessionPlans[.eforge/session-plans]
  InputAdapter --> PlanSets[session plan sets]
  Actions --> Queue[compat enqueue route when handoff queues work]
  SessionPlans --> Engine[existing normalize/build-source boundary]
```

Architecture effects:

- Core Console remains the shell, build observability/control surface, System diagnostics/config surface, and workstation host. It no longer owns a first-party planning product route.
- The `eforge-plan` extension becomes the owner of project planning UX: backlog board, session-plan browsing, session-plan mutation/readiness, promotion, and handoff flows.
- Extension workstation UI runs inside the existing sandboxed iframe boundary. It must communicate through allowed extension actions via the bridge and must not import private Console React/components/CSS or depend on parent Console context.
- Session-plan daemon/client routes remain compatibility plumbing. They are not the user-facing first-party planning product surface after this change.
- `@eforge-build/input` remains the domain adapter for session-plan and plan-set artifact semantics. The extension should call this adapter or the package's public session-plan helpers rather than reimplementing parsing/readiness logic.
- Any queue-affecting handoff from the workstation should use a declared extension action with `build-queue` side effects and an explicit confirmation in the workstation UI.
- If direct enqueue from an extension action exposes a concrete daemon reentrancy problem during implementation, the fallback must still keep the handoff UX extension-owned by returning/copying the session-plan source path and explaining the compatibility command.
- Core Console tests and docs should treat `/console/plans` as deleted. The existing route parser behavior for removed paths already returns `now`; this change should extend that deleted-route behavior to `plans`.
- Removing the core Plans route may allow deletion of `packages/console-ui/src/views/plans/*` and its tests.
- If implementation chooses to keep reusable presentation helpers temporarily, they must not be reachable as a core route and should not be documented as a Console product surface.
- System's first-party Session Plans section should be removed or reduced to an extension/workstation pointer so planning artifact readiness does not remain a core Console-owned product surface.

Public API impact:

- No breaking daemon HTTP API change is intended.
- No `DAEMON_API_VERSION` bump is required unless the implementation changes daemon/client wire contracts.
- No engine event schema change is intended.
- No Pi or Claude plugin parity change is required unless user-facing commands or MCP tools are changed beyond documentation wording.

Design decisions:

1. Workstation ownership
   - Decision: Make `eforge-plan` the owner of the planning workstation and planning workflow actions.
   - Rationale: The backlog claim explicitly says the kernel/core Console should not own a first-party planning product surface now that extension workstations exist.
   - Consequence: Core Console hosts the workstation list/detail route only; planning-specific UI and interaction logic lives under `eforge/extensions/eforge-plan/`.

2. Workstation implementation mode
   - Decision: Prefer a `frameBundle` workstation over a large inline `srcDoc` string for the real planning workstation.
   - Rationale: `frameBundle` support is now shipped, and a create/edit/readiness/handoff UI will be more maintainable as declared assets under `workstation-assets/` than as embedded HTML in `index.ts`.
   - Consequence: Add extension-owned browser assets such as `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` and optional CSS. Keep them vanilla or prebuilt browser code that uses `window.eforge.invokeAction`; do not require a new bundler step unless the implementation explicitly wires and tests it.

3. Action-backed data model
   - Decision: The workstation should invoke extension actions for all reads and mutations instead of directly fetching daemon routes from the iframe.
   - Rationale: Workstation iframes are sandboxed without same-origin privileges, and the supported API is the parent bridge with manifest-allowed actions.
   - Consequence: Register focused actions for planning artifacts and include them in `allowedActions` for the workstation.

4. Session-plan operation source
   - Decision: Implement flat session-plan and plan-set extension actions by delegating to `createSessionPlanningWorkflowAdapter()` from `@eforge-build/input` where possible.
   - Rationale: This adapter already owns the compatibility semantics for list/load/create/set-section/skip/set-status/select-dimensions/readiness/migrate and read-only plan-set operations.
   - Consequence: Avoid duplicating readiness, acceptance-criteria diagnostics, plan-set validation, or `.eforge/session-plans` path resolution in the extension.

5. Extension-local metadata helpers
   - Decision: Add small extension-local helpers only for metadata that the adapter does not currently expose, such as setting `profile`, updating open questions, or composing workstation view models.
   - Rationale: The implementation should not expand compatibility daemon routes solely for workstation convenience.
   - Consequence: When direct session-plan load/write helpers are used, reuse `@eforge-build/input` parsing/serialization and keep path containment intact.

6. Structured output hygiene
   - Decision: Normalize extension action outputs through a JSON-safe serializer/helper before returning them through action invocation.
   - Rationale: The related backlog item shows `list-board` currently fails because action output contains `undefined`; a richer workstation cannot depend on invalid action results.
   - Consequence: Add tests that invoke or directly validate action outputs for no `undefined` values and schema compatibility.

7. Planning artifact view model
   - Decision: Return a single extension-owned artifact list model combining flat session plans and plan sets, with stable keys such as `plan:<session>` and `plan-set:<planSetId>`.
   - Rationale: The current core Plans route already models this union; the workstation needs the same user behavior without retaining a core Console page.
   - Consequence: Implement the union in `eforge-plan`, not in `packages/console-ui/src/views/plans`.

8. Build handoff behavior
   - Decision: Provide a workstation handoff action for ready session plans that either enqueues the session-plan file through existing compatibility enqueue plumbing or returns an explicit source-path handoff result if direct queueing is not safe.
   - Rationale: The user asked for build handoff UX inside the workstation, but daemon/client session-plan routes should remain compatibility plumbing rather than a core Console product page.
   - Consequence: The UI must clearly show readiness status before handoff and confirm before any queue-affecting action. A direct queueing action must declare `build-queue` side effects.

9. Core Console route deletion
   - Decision: Remove `plans` from `ConsoleRouteBaseId`, `ConsoleRouteId`, `consoleRouteOrder`, route labels, `toConsolePath`, `parseConsoleRoute`, and `buildNavItems`.
   - Rationale: Keeping a route ID while hiding nav would preserve a first-party Plans surface.
   - Consequence: `/console/plans` should parse to `now`, matching deleted-route behavior.

10. System session-plan summary
    - Decision: Remove the core System `Session Plans` section or replace it with a non-product pointer to the `eforge-plan` workstation/contribution.
    - Rationale: Readiness and planning artifact management should be extension-owned.
    - Consequence: System surface fetching/tests should no longer load `API_ROUTES.sessionPlanList` solely for a first-party Session Plans section.

11. Documentation
    - Decision: Update `packages/console-ui/README.md`, `eforge/extensions/eforge-plan/README.md`, and `docs/roadmap.md` to describe the new boundary.
    - Rationale: Current docs still say `/console/plans` exists and that the full eforge-plan workstation is deferred.
    - Consequence: Documentation should describe compatibility routes as plumbing and extension workstations as the product surface.

Primary extension targets:

- `eforge/extensions/eforge-plan/index.ts`: replace the proof-of-concept `srcDoc` board workstation registration with a richer planning workstation registration, add new action registrations, update allowed actions, and keep existing backlog/promotion actions available.
- `eforge/extensions/eforge-plan/README.md`: update current/deferred capability documentation.
- `eforge/extensions/eforge-plan/schema.ts`: add TypeBox schemas for planning artifact list/show/create/update/readiness/handoff action inputs and outputs.
- `eforge/extensions/eforge-plan/*`: add focused helpers as needed for session-plan action mapping, JSON-safe output normalization, workstation view models, and handoff results. Keep new implementation files under 600 lines.
- `eforge/extensions/eforge-plan/workstation-assets/...`: add frame-bundle browser assets for the planning workstation. The asset code should use `window.eforge.invokeAction` only and must not import private Console modules.
- `eforge/extensions/eforge-plan/__tests__/*`: update existing registration/workstation tests and add coverage for planning action outputs, JSON-safe board/list results, session-plan adapter delegation behavior, and workstation manifest metadata.
- `test/eforge-plan-workstation.test.ts`: remove or update if the colocated extension tests supersede it; avoid duplicate stale assertions that expect only a board `srcDoc` workstation.

Primary Console targets:

- `packages/console-ui/src/lib/navigation.ts`: delete the `plans` route ID, label, path mapping, parser branch, and nav item.
- `packages/console-ui/src/App.tsx`: remove `PlansView` lazy import and route branch.
- `packages/console-ui/src/views/plans/*`: delete if unused after route removal, or leave only if implementation extracts no reusable code and no imports remain. Prefer deletion to avoid a hidden core product surface.
- `packages/console-ui/src/views/system/session-plans-section.tsx`: remove the first-party section or replace it with a pointer that does not fetch/manage session plans in core Console.
- `packages/console-ui/src/views/system/use-system-surfaces.ts`, `system-fetches.ts`, `system-types.ts`, `system-view-content.tsx`, and related tests: remove Session Plans state/fetch/rendering if the section is deleted.
- `packages/console-ui/src/__tests__/navigation.test.ts`, `app.test.tsx`, `header.test.tsx`, and System tests: update expectations so `Plans` nav/route are gone and `/console/plans` resolves to Now.

Compatibility targets to inspect but not remove:

- `packages/client/src/routes/session-plan.ts`, `packages/client/src/api/session-plan.ts`, and `packages/client/src/api/session-plan-set.ts` should remain available.
- `packages/monitor/src/routes/session-plans.ts` and `packages/monitor/src/routes/session-plan-sets.ts` should remain compatibility routes.
- `packages/pi-eforge/extensions/eforge/plan-command.ts`, `build-command.ts`, and MCP tool definitions should continue working without command removal.
- `eforge-plugin/` should be inspected only if user-facing command behavior changes. No plugin version bump is needed if the implementation only changes Console UI and project-team extension source.

Expected tests and validation:

- `pnpm test -- eforge/extensions/eforge-plan/__tests__/*.test.ts test/eforge-plan-workstation.test.ts packages/console-ui/src/__tests__/navigation.test.ts packages/console-ui/src/__tests__/app.test.tsx packages/console-ui/src/__tests__/header.test.tsx`
- `pnpm type-check`
- `pnpm maintainability:check`
- `pnpm docs:check` if generated documentation inputs or generated docs are touched.

Documentation impact:

- `packages/console-ui/README.md` must remove `/console/plans` from the route table and delete or rewrite the Planning Workspace data-flow section.
- `packages/console-ui/README.md` should describe `/console/workstations` as the host for extension-owned planning workstations and mention that session-plan routes remain compatibility plumbing when needed.
- `eforge/extensions/eforge-plan/README.md` must be updated from proof-of-concept board wording to the new workstation capabilities: backlog board, session-plan/plan-set browsing, create/edit/readiness/status/profile/handoff workflows, action list, trust model, and frame-bundle asset model.
- `docs/roadmap.md` should update the Console Observability and Control planning bullet so it no longer says planning artifact browsing is a first-party Console surface.
- `docs/roadmap.md` wording should keep build observability in Console and put richer planning/workflow UX under extension workstations.
- `docs/extensions.md` or `docs/extensions-api.md` should be touched only if the implementation changes extension APIs or if a concise reference-extension note improves discoverability.
- Documentation must not overclaim raw extension HTTP routes or parent-Console plugin support.
- Pi/Claude skill docs can continue to document `/eforge:plan` and `/eforge:build` compatibility workflows unless implementation changes host commands.
- Client route reference docs should not change unless daemon/client route contracts actually change.
- Documentation should use Mermaid for diagrams.
- Documentation should clearly distinguish extension-owned planning product UX from daemon/client compatibility routes.
- Documentation should avoid documenting private Console internals as extension author APIs.
- Documentation should not describe direct parent-Console React/component imports as supported.

Risks and mitigations:

- Risk: Deleting `/console/plans` breaks old bookmarks. Mitigation: route parsing for deleted paths should return `now`; update tests to assert `/console/plans` lands on Now rather than throwing.
- Risk: Compatibility routes are removed too aggressively and break Pi/Claude/CLI workflows. Mitigation: keep client/monitor session-plan and session-plan-set routes in place and frame them as plumbing, not product UI.
- Risk: The workstation duplicates session-plan semantics and drifts from daemon readiness behavior. Mitigation: delegate to `@eforge-build/input` session-planning adapter and session-plan helpers.
- Risk: Workstation action outputs fail bridge validation because they include `undefined`. Mitigation: add a JSON-safe output normalization helper and tests for board/planning action outputs.
- Risk: A frame-bundle workstation grows into a private Console plugin. Mitigation: keep all browser code inside `workstation-assets/`, use only `window.eforge.invokeAction`, and do not import private Console modules.
- Risk: Queue-affecting handoff from an extension action may be unsafe if implemented via same-daemon HTTP recursion. Mitigation: validate cheaply during implementation; if unsafe, keep the handoff UX extension-owned by returning the canonical session-plan source path and requiring `/eforge:build` compatibility submission rather than leaving a core Console button.
- Risk: Removing System's Session Plans section may hide diagnostics users still need. Mitigation: surface equivalent status/readiness in the extension workstation and optionally keep a System pointer to the workstation rather than a first-party session-plan list.
- Risk: The eforge-plan extension becomes too large. Mitigation: split helpers by action/schema/view-model/storage/handoff, keep new files under 600 lines, and avoid putting browser asset source inside `index.ts`.
- Risk: Documentation remains stale and tells users to use the removed Plans route. Mitigation: update Console README, eforge-plan README, and roadmap in the same build.
- Risk: Tests continue to mock a `PlansView` route and mask route deletion. Mitigation: update app/navigation/header tests to assert the absence of Plans and route fallback behavior.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Core Console still owns a first-party Plans route that must be removed. | Read `packages/console-ui/README.md`, `packages/console-ui/src/lib/navigation.ts`, and `packages/console-ui/src/App.tsx`; all still include `plans` and `/console/plans`. | high | low | Update route tests and run Console navigation/app/header tests. | High: if missed, the core planning surface remains. |
| The current `eforge-plan` workstation is only a proof-of-concept board, not the required session-plan workstation. | Read `eforge/extensions/eforge-plan/index.ts`, `eforge/extensions/eforge-plan/README.md`, and `test/eforge-plan-workstation.test.ts`; it registers `board-workstation` with inline `srcDoc` that only invokes `render-board-markdown`. | high | low | Update workstation registration tests to assert new planning capabilities and allowed actions. | High: migration would not actually move plan workflows. |
| Frame-bundle workstations are available and appropriate for a richer extension-owned UI. | Read `packages/extension-sdk/README.md`, `packages/console-ui/README.md`, and workstation frame/asset route code; frame-bundle workstations are documented and tested. | high | low | Register a frameBundle workstation and run extension/workstation manifest tests. | Medium: fallback would be a larger `srcDoc` implementation. |
| Session-plan and plan-set daemon/client routes should remain compatibility plumbing in this slice. | Read client route/types/helpers, monitor route modules, Pi command/tool references, and previous session-planning adapter plan. Many consumers still rely on the compatibility routes. | high | low | Run type-check and existing route/tool tests after Console route deletion. | High: removing routes would break non-Console workflows. |
| The extension can reuse `@eforge-build/input` for session-plan and plan-set semantics. | Read `packages/input/src/session-planning-workflow.ts`; it exposes the needed flat and plan-set operations. | high | low | Import the adapter from the extension and test representative action handlers with temp project files. | Medium: duplicate logic would be needed if package resolution fails in extension runtime. |
| Core System's Session Plans section is part of the first-party planning surface and should be removed or reduced to a pointer. | Read `packages/console-ui/src/views/system/session-plans-section.tsx` and `use-system-surfaces.ts`; it fetches and renders session-plan readiness/list data as core UI. This is an interpretation of the user's boundary claim. | medium | low | Confirm during implementation by checking whether tests/docs still present a core Session Plans product surface. | Medium: leaving it might undercut the boundary; deleting it might remove useful diagnostics. |
| Direct queueing from an extension action may be feasible but needs implementation validation. | Extension actions support `build-queue` side effects, and client `apiEnqueue` exists, but action context does not expose monitor `workerTracker`; a direct self-HTTP call may or may not be desirable. | medium | medium | Prototype a small `enqueue-session-plan` action or inspect daemon action invocation reentrancy; if unsafe, return a source-path handoff result instead. | Medium: build handoff may be a copy/compat command flow rather than one-click queueing. |
| `list-board` or related structured output needs JSON-safe normalization before the workstation can consume it. | Read related backlog item reporting `invalid-output` from `eforge-plan:list-board`; read current `ListBoardOutput` uses unknown items and current helpers may return `undefined` fields. | high | low | Add tests asserting no `undefined` appears in action outputs. | Medium: workstation structured rendering would fail through the bridge. |
| Updating roadmap wording is required for plan completeness. | Read `docs/roadmap.md`; current Console planning bullet says planning artifact browsing remains available in Console, conflicting with the new backlog claim. | high | low | Edit the roadmap and run docs checks if relevant. | Low/medium: docs would contradict shipped behavior. |

No low-confidence, high-impact assumption remains unresolved. The main medium-confidence implementation assumption is direct queueing from an extension action; the accepted fallback still keeps build handoff UX extension-owned and avoids preserving a core Console Plans surface.

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is cross-cutting but cohesive work across the project-team `eforge-plan` extension, Console route removal, tests, and documentation.
- A single planner can enumerate the files and sequence without delegated module planning.
- Expedition is not warranted because the implementation does not require independently planned subsystem subplans.
- Errand is too light because boundary discipline, compatibility routes, workstation actions, and route deletion all need coordinated review.

## Scope

In scope:

- Replace the current `eforge-plan` proof-of-concept board workstation with a first usable planning workstation owned by the `eforge-plan` extension.
- The workstation must cover session-plan artifact browsing for flat session plans and grouped session plan sets.
- The workstation must cover session-plan creation, editing dimension sections, selecting planning type/depth dimensions, skipping dimensions, readiness review, status changes to `ready`, and profile/handoff metadata needed before build submission.
- The workstation must continue to support backlog/epic board workflows and backlog-item-to-session-plan promotion.
- Add extension actions in `eforge/extensions/eforge-plan/` for the workstation to invoke session-plan and plan-set workflow operations through the existing `@eforge-build/input` session-planning adapter and focused extension-local helpers.
- Fix or bypass the current `eforge-plan:list-board` JSON-safe output issue so workstation data returned through action invocation contains no `undefined` values.
- Add a workstation build-handoff flow that lets an operator submit or otherwise hand off a ready session plan from the extension-owned workstation, with confirmation inside the workstation before any queue-affecting action.
- Remove the first-party Console `Plans` top-level route/nav/page from `packages/console-ui`; `/console/plans` should no longer resolve to a core Plans route.
- Remove or replace first-party System session-plan management/summary UI that makes the core Console own a planning product surface; extension contributions/workstations may still present this information.
- Keep daemon/client session-plan and session-plan-set routes as compatibility plumbing unless the implementation finds a small, non-breaking documentation/label cleanup is useful.
- Update Console docs and roadmap wording so planning product UX is described as extension-owned, not a first-party Console route.
- Update tests to lock in that core Console navigation no longer includes `Plans`, `/console/plans` redirects/canonicalizes to `Now`, and the eforge-plan workstation/action manifest owns the planning workflow surface.

Out of scope:

- Do not delete `API_ROUTES.sessionPlan*` or `API_ROUTES.sessionPlanSet*` compatibility routes in this slice.
- Do not remove Pi/Claude/CLI `/eforge:plan`, `eforge_session_plan`, or `/eforge:build` compatibility workflows.
- Do not move session-plan files out of `.eforge/session-plans/`.
- Do not add parent-Console React plugin loading or private Console component imports into extension UI.
- Do not add raw extension-owned HTTP routes.
- Do not add an extension-owned AI planning/chat runtime API in this slice.
- Do not replace the engine enqueue normalization boundary; the engine should continue to consume normalized build source.

Roadmap alignment:

- Aligns with the roadmap's engine boundary discipline and Extension Platform goals.
- Requires updating the roadmap's stale Console planning-visibility bullet so it no longer implies a first-party core Planning Workspace.

## Acceptance Criteria

- `packages/console-ui/src/lib/navigation.ts` no longer includes `plans` in `ConsoleRouteBaseId`.
- `packages/console-ui/src/lib/navigation.ts` no longer includes `plans` in `ConsoleRouteId`.
- `packages/console-ui/src/lib/navigation.ts` no longer includes `plans` in `consoleRouteOrder`.
- `packages/console-ui/src/lib/navigation.ts` no longer includes a `plans` route label.
- `buildNavItems()` output no longer includes `plans`.
- `parseConsoleRoute('/console/plans')` returns `now`.
- `toConsolePath('now')` returns `/console/`.
- `packages/console-ui/src/App.tsx` does not import `PlansView`.
- `packages/console-ui/src/App.tsx` does not render `PlansView`.
- Console header/navigation tests assert that no nav item has label `Plans`.
- Console header/navigation tests assert that no nav item has href `/console/plans`.
- Console app tests assert that initial render at `/console/plans` mounts the Now dashboard instead of a Plans view.
- The first-party System view no longer fetches `API_ROUTES.sessionPlanList` solely to render a core `Session Plans` section.
- No reachable core Console route renders `Planning Workspace` as a first-party page.
- `eforge/extensions/eforge-plan/index.ts` registers a Console workstation whose manifest title or description identifies it as the eforge-plan planning workstation.
- The eforge-plan planning workstation is registered as a `frameBundle` workstation.
- The eforge-plan planning workstation has assets under `eforge/extensions/eforge-plan/workstation-assets/`.
- The eforge-plan planning workstation allowed actions include an action for listing planning artifacts.
- The eforge-plan planning workstation allowed actions include an action for showing a selected flat session plan.
- The eforge-plan planning workstation allowed actions include an action for showing a selected session plan set.
- The eforge-plan planning workstation allowed actions include an action for creating a session plan.
- The eforge-plan planning workstation allowed actions include an action for editing a session-plan section.
- The eforge-plan planning workstation allowed actions include an action for checking session-plan readiness.
- The eforge-plan planning workstation allowed actions include an action for setting a session plan to `ready`.
- The eforge-plan planning workstation allowed actions include an action for build handoff of a ready session plan.
- The planning artifact list action returns JSON-safe output with no `undefined` values for a fixture project containing backlog items, flat session plans, and session plan sets.
- The existing `eforge-plan:list-board` action returns JSON-safe output with no `undefined` values for a fixture project containing backlog items and epics.
- The flat session-plan show action returns the plan body for a fixture `.eforge/session-plans/<session>.md` file.
- The flat session-plan show action returns frontmatter metadata for a fixture `.eforge/session-plans/<session>.md` file.
- The flat session-plan show action returns readiness detail for a fixture `.eforge/session-plans/<session>.md` file.
- The flat session-plan show action returns the path for a fixture `.eforge/session-plans/<session>.md` file.
- The session plan-set show action returns manifest metadata for a fixture plan set.
- The session plan-set show action returns validation detail for a fixture plan set.
- The session plan-set show action returns anchor summary for a fixture plan set.
- The session plan-set show action returns child summary metadata for a fixture plan set.
- The session-plan create action writes a valid `.eforge/session-plans/<session>.md` file using the existing session-plan file format.
- The session-plan section edit action updates or creates exactly one `## <Dimension>` section in the target session plan.
- The readiness action reports acceptance-criteria diagnostics when fixture acceptance criteria contain a grouping label.
- The readiness action reports acceptance-criteria diagnostics when fixture acceptance criteria contain a bare command fragment.
- The readiness action reports acceptance-criteria diagnostics when fixture acceptance criteria contain a vague criterion.
- The readiness action reports acceptance-criteria diagnostics when fixture acceptance criteria contain a manual-only criterion.
- The set-ready action rejects a session plan whose readiness detail is not ready.
- The set-ready action sets `status: ready` for a fixture session plan whose required dimensions are complete and acceptance criteria pass diagnostics.
- The handoff action rejects a session plan whose readiness detail is not ready.
- The handoff action returns a JSON-safe result.
- The handoff action returns `kind: enqueued` and an eforge session id when direct enqueueing is used.
- The handoff action returns `kind: source-path` and a session-plan source path when source-path fallback is used.
- A queue-affecting handoff action declares `build-queue` in its extension action side effects.
- The workstation browser asset does not import from `packages/console-ui/src`.
- The workstation browser asset does not import from any private Console module alias.
- The workstation browser asset invokes extension actions through `window.eforge.invokeAction` or the workstation browser SDK bridge.
- The workstation browser asset contains an explicit confirmation step before invoking a queue-affecting handoff action.
- `packages/client/src/routes/session-plan.ts` still exports the existing session-plan wire type names.
- `packages/client/src/api/session-plan.ts` still exports the existing session-plan client helper names.
- `packages/client/src/api/session-plan-set.ts` still exports the existing session plan-set client helper names.
- `packages/monitor/src/routes/session-plans.ts` still registers the existing session-plan compatibility routes.
- `packages/monitor/src/routes/session-plan-sets.ts` still registers the existing session plan-set compatibility routes.
- `API_ROUTES.sessionPlan*` compatibility route constants remain available.
- `API_ROUTES.sessionPlanSet*` compatibility route constants remain available.
- Pi/Claude/CLI `/eforge:plan`, `eforge_session_plan`, and `/eforge:build` compatibility workflows are not removed.
- Session-plan files continue to be written under `.eforge/session-plans/`.
- The eforge-plan implementation adds no raw extension-owned HTTP routes.
- The extension UI does not add parent-Console React plugin loading.
- The extension UI does not import private Console components.
- The implementation does not add an extension-owned AI planning/chat runtime API.
- The engine enqueue normalization boundary remains in place.
- `packages/console-ui/README.md` route table does not list `/console/plans`.
- `packages/console-ui/README.md` describes planning workflow UX as extension-workstation-owned.
- `eforge/extensions/eforge-plan/README.md` documents the planning workstation capabilities.
- `eforge/extensions/eforge-plan/README.md` no longer describes the full workstation UX as deferred.
- `docs/roadmap.md` no longer says first-party Console should keep planning artifact browsing as a core route/page.
- `test/eforge-plan-workstation.test.ts` no longer contains stale assertions that expect only a board `srcDoc` workstation.
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/*.test.ts test/eforge-plan-workstation.test.ts packages/console-ui/src/__tests__/navigation.test.ts packages/console-ui/src/__tests__/app.test.tsx packages/console-ui/src/__tests__/header.test.tsx` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm docs:check` exits 0 if generated documentation inputs or generated docs are touched.