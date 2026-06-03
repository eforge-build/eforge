---
title: Build Extension Platform Foundation for Kernel-Boundary Extraction
created: 2026-06-03
landing: pr
landing_auto_merge: true
---

# Build Extension Platform Foundation for Kernel-Boundary Extraction

## Problem / Motivation

This is a fresh `origin/main`-based foundation plan that supersedes the failed queue item `add-extension-platform-capabilities-for-kernel-boundary-extraction`.

Confirmed evidence:

- Current base is `origin/main` at `74aae9c9c17e2d1605f4ee1a67562517e326a482` (`Merge pull request #121 from eforge-build/feat/console-ui-improvements`).
- The failed build queue artifact is `.eforge/queue/failed/add-extension-platform-capabilities-for-kernel-boundary-extraction.md`.
- The underlying submitted session plan is `.eforge/session-plans/2026-06-01-add-extension-capability-gaps-for-kernel-boundary-extraction.md`.
- The recovery sidecar says `plan-01-sdk-registry-contracts` completed on feature branch `eforge/add-extension-platform-capabilities-for-kernel-boundary-extraction`, `plan-02-daemon-action-runtime` failed without a concrete error message, and dependent Console/host/docs plans were blocked.
- `git merge-base --is-ancestor 1aaa7b002166109c55aac29d3ab6870a7add45fc origin/main` returned false, so even the completed SDK/registry commit from the failed build is not in current main.
- The failed build's orchestration used `diff_base_ref: 0b8f4f7cdbbed075d58a4702647673de96f896a5`; current `origin/main` has since shipped recovery semantics, acceptance-criteria lifecycle hardening, queued compiled-build resume, Console recovery/Planning Workspace changes, daemon API v51, test consolidation work, and Console Now/dashboard/shell improvements from PR #121.
- Current `origin/main:packages/extension-sdk/src/api.ts` still exposes event hooks, agent-run hooks, policy gates, profile routers, input sources, PRD enrichers, reviewer perspectives, validation providers, and tools, but no extension action, Console contribution, integration command, or deep-link registration methods.
- Current `origin/main:packages/engine/src/extensions/types.ts`, `recorder.ts`, and `projector.ts` still record/project `eventHooks`, `agentRunHooks`, `policyGates`, `profileRouters`, `inputSources`, `reviewerPerspectives`, `validationProviders`, `tools`, and `prdEnrichers`, but no action/contribution/command/deep-link registry families.
- Current `origin/main:packages/client/src/routes.ts` still contains only extension management routes under `/api/extensions/list|show|validate|test|trust|untrust|new|reload|install|update|remove|promote|demote`; no daemon-owned contribution manifest or action invocation route exists.
- Current `origin/main:packages/console-ui/src/lib/navigation.ts` is still source-owned/static (`now`, `plans`, `buildDetail`, `system`), and `origin/main:packages/console-ui/README.md` still says top-level control surfaces require source edits in navigation while System route entries belong under `src/views/system/`.
- Current Console System surfaces include `packages/console-ui/src/views/system/extensions-section.tsx` and selectors in `packages/console-ui/src/lib/selectors/system.ts`, making the System route a low-risk first place to render extension contribution metadata.
- Current `origin/main:docs/roadmap.md` still calls for a small build-engine kernel, Console as the canonical local-first control surface, thin integrations, broader extension-surface clarification, and bundled reference workflow extensions for session plans/playbooks.
- Current `origin/main:docs/extensions.md` and `docs/extensions-api.md` still document shipped native hooks and explicitly leave broader extension platform phases/future workflow extraction unshipped.
- Revalidation after PR #121 found no `registerAction`, Console contribution, integration command, deep-link, extension action, contribution manifest, or extension contribution matches in current SDK/engine extension/client/Console/docs paths.

Conclusion:

- The old session plan remains directionally valid, but the failed build is stale as an implementation artifact.
- A fresh build should start from `origin/main`, treat the failed feature branch and `plan-01` commit as reference material only, and avoid resuming or merging the stale branch wholesale.
- The fresh scope should still target the same foundational gap: typed extension-owned actions, daemon/client invocation routes, declarative Console contribution metadata/rendering, and shared host command/deep-link discovery/invocation.
- User confirmed on 2026-06-03 that this fresh foundation plan should fully supersede the failed queue item rather than resuming its compiled artifacts.

Risks:

- The failed `plan-02-daemon-action-runtime` did not record a concrete error, so there may be an unresolved design or implementation trap in action runtime/daemon route work.
- Resuming the failed branch risks conflicts with current `origin/main`'s API v51, queued resume, recovery route, Console recovery, and test consolidation changes.
- The action invocation route increases the blast radius of trusted unsandboxed extensions, so validation, timeout, provenance, and docs must be strict.
- Breaking early SDK shapes can be healthy now, but incomplete migration would leave docs/examples/guardrails/tests inconsistent.
- Scope can creep into full workflow extraction, approval UI, raw HTTP routing, or arbitrary Console plugins; those should remain future work.
- Declarative Console primitives may be too limited for future workflow extensions; manifests should reserve schema versions and renderer ids.
- Pi supports richer dynamic UX than Claude Code plugins; the shared manifest should support parity without requiring identical host experiences.
- New events/routes must obey client ownership and route literal discipline, or source-contract tests will fail.
- Current large files and consolidated tests make maintainability important; use focused modules, bounded edits, and run the maintainability gate.

## Goal

Build the foundation for typed extension-owned actions, daemon/client invocation routes, declarative Console contribution metadata/rendering, and shared host command/deep-link discovery/invocation.

This work should supersede the failed stale build, start from current `origin/main`, preserve existing playbook/session-plan workflows, and establish the platform seams needed for future kernel-boundary extraction without extracting workflows in this slice.

## Approach

Recommended profile: **Expedition**.

Rationale: this is foundational platform architecture crossing independent subsystems: public SDK contracts, engine extension registry/runtime, daemon/client wire routes, Console rendering, Pi/Claude/CLI host exposure, docs/examples, and compatibility with existing planning/playbook surfaces. The fresh build should let an architecture planner coordinate shared action/contribution contracts and then delegate module-specific implementation plans. This is Expedition because multiple subsystems need coherent contract design and subsystem-specific execution, not merely because many files are touched.

Architecture impact:

- This is an architecture change across four boundaries: extension SDK/engine registry, daemon/client wire contract, Console rendering, and host integrations.
- The SDK should gain coherent public contracts for `registerAction`, Console contribution registration, integration command registration, and deep-link registration or equivalent names.
- Compatibility with the early extension API may break when that produces a cleaner long-term model, but in-repo extensions/examples/tests/docs must migrate in the same build.
- The engine extension recorder should store action/contribution/command/deep-link registrations separately from existing build-pipeline hooks.
- Registry records should preserve extension name/path, local name, effective namespaced id, public metadata, TypeBox schemas, handler references where applicable, and diagnostics.
- The engine projector should expose safe metadata for list/show/validate/test output without leaking handler source code or non-serializable extension module objects.
- `@eforge-build/client` should own route constants, TypeBox wire schemas, derived response/request types, Node helpers, passive `IfRunning` helpers, browser helpers, and exported manifests for contribution listing and action invocation.
- The daemon should own exactly one manifest route and one action invocation route for this slice.
- Route handlers should live under current monitor route modules, not in old monolithic server code.
- Action invocation should be fail-closed for explicit caller errors and handler failures while keeping the daemon alive.
- Unknown actions and invalid input should return typed 4xx bodies.
- Handler errors, timeouts, and invalid outputs should return documented failure bodies.
- Action events, if added, must live in `packages/client/src/events.schemas.ts` and `packages/client/src/event-registry.ts`.
- Action events, if added, must be persisted as daemon-scoped events where useful.
- Action events, if added, must be ignored or rendered intentionally by both active Console and legacy monitor reducers.
- Console should consume browser-safe client helpers and render declarative contribution primitives only.
- Initial Console renderer support should cover text/markdown, status/badge, link/deep link, action button, and a simple form/action binding.
- Pi, Claude Code/MCP, and CLI should discover integration command/deep-link manifests from the daemon/client contract and expose a generic invocation path.
- Host-specific command UX may differ, but metadata and invocation should not fork.
- Because current `origin/main` is daemon API v51 and first-party clients will depend on new routes/events, the implementation should evaluate whether adding these routes requires bumping `DAEMON_API_VERSION` to v52 under the existing version policy.

Compatibility and migration impact:

- Breaking SDK changes are acceptable for this early platform slice only when the committed guardrails extension, examples, tests, generated docs, and user-facing docs migrate together.
- Current session-plan/playbook first-party workflows must continue to pass their existing tests unless the build provides equivalent contribution-backed replacements in the same slice.
- The failed branch's completed `plan-01` work can be used as design reference, but every change must be replayed against current `origin/main` because tests, API version, recovery routes, Console recovery UI, and acceptance-criteria validation have changed since the old diff base.

Design decisions:

- Start from `origin/main`, not from the failed feature branch.
- Treat the failed build artifacts as reference material only.
- Keep action HTTP boundaries daemon-owned.
- Use TypeBox for public action input/output schemas and manifest wire schemas.
- Use stable namespaced ids for actions, Console contributions, integration commands, and deep links.
- Model Console contributions declaratively for this slice.
- Prefer rendering extension contributions inside the existing Console System route first unless implementation proves a top-level route is necessary.
- Keep extension-management actions separate from extension-provided action invocation.
- Emit action diagnostics/provenance without raw input or raw output payloads.
- Keep existing build-pipeline extension seams documented as shipped rather than replanning them.

Design rationale:

- Current main has moved to API v51 and contains recovery, queued-resume, Console, and test-structure changes that make the failed branch stale.
- `plan-01` has useful contracts and test ideas, but its commit is not an ancestor of main and its branch diff includes unrelated old-main deletions.
- Project policy centralizes daemon route constants and wire types in `@eforge-build/client`, and native extensions are trusted unsandboxed code.
- The roadmap names TypeBox as canonical for eforge-owned domain schemas, and current extension tool schemas already use TypeBox.
- Console and hosts need collision-free references independent of local extension file names.
- Arbitrary browser plugin bundles require separate architecture for bundling, dependency isolation, CSP/trust, versioning, and renderer compatibility.
- System is already the home for configuration/extension diagnostic surfaces and avoids expanding static navigation prematurely.
- `packages/client/src/api/extension-tool-dispatch.ts` dispatches extension-management operations; extension-authored commands should use a distinct manifest/action contract.
- Events should support observability without leaking user data or large payloads into logs.
- Current `origin/main` supports input sources, PRD enrichers, reviewer perspectives, validation providers, policy gates, profile routers, event hooks, and agent context/tools.

Likely implementation targets on current `origin/main`:

- `packages/extension-sdk/src/api.ts`, `packages/extension-sdk/src/hooks.ts`, and likely a new `packages/extension-sdk/src/contributions.ts`: add public action/contribution/command/deep-link contracts and export them from `packages/extension-sdk/src/index.ts`.
- `packages/engine/src/extensions/types.ts`: add registry record types, API recorder shape methods, recorder state arrays, registry arrays, and loaded-extension registration counts for actions, Console contributions, integration commands, and deep links.
- `packages/engine/src/extensions/recorder.ts`: validate and record new registration methods, reject invalid object-root schemas/ids/bindings, and detect duplicate names or effective ids.
- `packages/engine/src/extensions/projector.ts`: include safe contribution metadata and registration totals in list/show projections without handler leakage.
- `packages/engine/src/extensions/replay.ts`, `loader.ts`, and `index.ts`: include new registration families in validation/test/replay summaries and public engine extension exports.
- New focused engine helpers under `packages/engine/src/extensions/`: likely helpers for contribution ids, binding validation, manifest projection, JSON-safe action output validation, and action runtime dispatch.
- `eforge/extensions/eforge-guardrails.ts`: migrate to any new SDK naming/exports while preserving its prompt guardrails, reviewer perspective, and validation provider behavior.
- `examples/extensions/*`, `packages/extension-sdk/README.md`, and extension authoring tests: migrate examples and documentation to the new contracts.
- `packages/client/src/routes.ts`: add client-owned route constants for contribution manifest and action invocation.
- A new client wire module such as `packages/client/src/extension-contributions.ts`: define TypeBox schemas and `Static<>`-derived types for manifest entries, action invoke requests/responses, contribution blocks, requested-by values, side-effect metadata, errors, and schema versions.
- A new client API helper such as `packages/client/src/api/extension-contributions.ts`: add Node helpers and passive `IfRunning` helpers.
- A browser-safe helper module or existing `packages/client/src/browser.ts`: export browser manifest fetch and action invocation helpers.
- `packages/client/src/index.ts`, `packages/client/src/browser.ts`, and possibly `packages/client/src/types.ts`: export the new helpers/types without duplicating shapes.
- `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, and event tests: add `extension:action:*` events only if runtime emits typed action lifecycle diagnostics.
- `packages/client/src/api-version-const.ts`: bump from v51 to v52 if new first-party clients require daemon support for the new routes/events.
- `packages/monitor/src/routes/extensions/*` and `packages/monitor/src/routes/extension-content.ts`: add route handlers and route-key registration using `API_ROUTES` and current route-module patterns.
- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts`, `routes-extension-content-source-contract.test.ts`, route coverage tests, and route helper tests: cover registration, source discipline, security classification, manifest listing, and invoke responses.
- `packages/console-ui/src/views/system/*`, `packages/console-ui/src/lib/selectors/system.ts`, and Console tests: render at least one declarative contribution surface and invoke actions via browser helpers.
- Add a dedicated `packages/console-ui/src/views/extensions/*` only if System route composition becomes unwieldy.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` and `packages/monitor-ui/src/lib/reducer/index.ts`: account for action lifecycle events if those become persisted/streamed event variants.
- `packages/pi-eforge/extensions/eforge/index.ts` and helper modules: add generic extension command/deep-link discovery/invocation using non-starting client helpers where appropriate.
- `eforge-plugin/`, `packages/eforge/src/cli/mcp-proxy.ts`, and CLI command modules: expose equivalent generic action/command/deep-link discovery/invocation when technically feasible, and bump `eforge-plugin/.claude-plugin/plugin.json` if plugin files change.
- `docs/extensions.md`, `docs/extensions-api.md`, `docs/config.md`, `web/content/docs/integrations.md`, `packages/console-ui/README.md`, docs generation sources, and generated references: document new capability families, safety boundaries, migration notes, and deferred arbitrary UI/raw-route/workflow-extraction work.
- Tests should account for current `origin/main` test consolidation.
- Prefer adding focused tests to current consolidated files when that is now the project pattern rather than recreating deleted split test files from the stale branch.

Documentation updates:

- `docs/extensions.md` describes extension actions, declarative Console contributions, integration commands, deep links, action safety, daemon-owned route boundaries, and the no-raw-route/no-arbitrary-frontend-bundle rule.
- `docs/extensions-api.md` documents the new SDK methods and runtime support status.
- `packages/extension-sdk/README.md` includes concise examples for registering an action and binding Console/host metadata to it.
- `examples/extensions/README.md` and extension examples include a minimal action/contribution sample.
- `web/content/docs/integrations.md` explains how Pi, Claude Code/MCP, CLI, and Console expose generic extension-provided commands/actions.
- `packages/console-ui/README.md` updates the "Adding a new control surface" guidance to distinguish source-owned routes, daemon-manifest declarative contributions, and future frontend plugin bundles.
- `docs/config.md` only changes if a new extension config field is introduced; otherwise it should clarify reused timeout behavior.
- `docs/roadmap.md` should only be pruned if this build actually ships the corresponding extension platform item.
- `docs/roadmap.md` should not claim session-plan/playbook extraction or arbitrary Console plugin bundles are shipped.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed build should be superseded by a fresh origin/main plan rather than resumed from stale artifacts. | Recovery sidecar shows no concrete plan-02 root cause; completed `plan-01` commit is not in origin/main; failed branch diff was based on old main and includes unrelated old-main deletions. User confirmed full supersession on 2026-06-03. | high | low | Supersession confirmed; abandon/archive failed queue item separately if desired. | Resuming could waste time on conflicts or reintroduce stale test/route assumptions. |
| The original goal remains platform foundation, not immediate session-plan/playbook extraction. | Original session plan, backlog item, and roadmap all frame this as enabling future extraction; old plan explicitly scoped extraction out. User clarified on 2026-06-03 that this is a plan to lay the foundation. | high | low | Confirmed by user; re-open only if extraction is explicitly requested later. | Scope becomes too broad if extraction is included implicitly. |
| Current origin/main still lacks extension actions, Console contribution registry/rendering, and host command/deep-link contributions. | Searched/read `origin/main` SDK API, engine extension types/recorder/projector, client routes, Console navigation/README, and docs. | high | low | Re-run `git grep` for `registerAction`, `consoleContribution`, `integrationCommand`, `deepLink`, and `extensionAction` before implementation. | Plan could duplicate work if a hidden or recently merged surface exists. |
| The only committed project/team native extension requiring migration is `eforge/extensions/eforge-guardrails.ts`. | Existing session plan and backlog evidence found only that project/team extension; current scope search still centers there. | medium | low | Re-run `find eforge/extensions -type f` on origin/main and inspect config `extensions.paths`. | Migration work may be underestimated if other configured extensions exist. |
| System route is the safest first Console contribution render target. | Current Console has static routes and System owns extensions/config/diagnostic surfaces; `packages/console-ui/src/views/system/extensions-section.tsx` exists. | medium | low | Inspect System view composition during implementation and choose a dedicated route only if necessary. | A dedicated route may be more appropriate if contributions need navigation identity. |
| Adding first-party manifest/action routes may require daemon API v52 even though route addition is not always breaking. | Current version history bumps for new first-party routes when stale daemons would 404 and first-party clients require support; origin/main is v51. | medium | low | Apply `packages/client/src/api-version-const.ts` policy during implementation. | Stale daemon/client diagnostics could be misleading if version is not bumped. |
| Declarative contributions are sufficient for this slice. | Roadmap asks for platform boundary work; old plan and current docs defer arbitrary frontend plugin bundles; Console is a browser bundle and extensions run in daemon/worker Node. | medium | medium | Prototype one meaningful System contribution with an action button/form. | Future extraction may still need a richer frontend plugin architecture. |
| Existing playbook/session-plan workflows must continue working. | They are current first-party routes/tools and Console Planning Workspace depends on them. | high | low | Run current session-plan/playbook route tests and Console Planning Workspace tests. | Breaking planning workflows would regress a core user-facing flow. |

## Scope

In scope:

- Supersede the failed build with a new `origin/main`-based implementation plan for extension platform capabilities.
- Add typed native extension registration contracts for extension actions, declarative Console/workstation contributions, integration commands, and deep links.
- Update engine extension registry recording, duplicate detection, projection, replay/test summaries, and loaded-extension registration counts for the new contribution families.
- Add daemon-owned, client-typed contribution manifest and extension action invocation routes.
- Ensure extensions do not register raw HTTP routes.
- Add action invocation runtime behavior with TypeBox input validation, bounded execution, JSON-safe output validation, optional output-schema validation, typed responses, and diagnostic/provenance events.
- Render at least one safe declarative Console contribution surface from daemon manifests, preferably inside the existing System route first unless implementation evidence supports a dedicated `/console/extensions` route.
- Add generic extension command/deep-link discovery and invocation surfaces for Pi, Claude Code/MCP, and CLI where technically feasible, using the shared client contract instead of host-specific metadata shapes.
- Migrate the committed project/team extension `eforge/extensions/eforge-guardrails.ts` and extension examples/tests to the new SDK shape when the SDK changes.
- Update docs, examples, generated references, and public docs to distinguish shipped seams from still-deferred arbitrary UI bundles/raw routes/workflow extraction.
- Preserve current playbook/session-plan routes, Pi/Claude tools, and Console Planning Workspace unless equivalent contribution-backed replacements ship in the same build.

Out of scope:

- Do not resume or merge `eforge/add-extension-platform-capabilities-for-kernel-boundary-extraction` as the implementation base.
- Do not extract session plans, playbooks, or other built-in workflow implementations out of core in this build.
- Do not add arbitrary extension-owned raw HTTP route registration.
- Do not load arbitrary extension-supplied browser JavaScript, React bundles, or independently bundled Console/workstation frontend plugins in this slice.
- Do not add approval workflow/state/UI, `beforeEnqueue`, `beforeValidation`, or `modify` policy decisions unless a small naming reservation is needed in documentation.
- Do not reimplement shipped input-source fetching, PRD enrichment, reviewer perspectives, validation providers, profile routers, policy gates, agent context/tool injection, or session-plan normalization.
- Do not duplicate daemon route literals or daemon wire shapes outside `@eforge-build/client`.

## Acceptance Criteria

- `packages/extension-sdk/src/api.ts` exposes a typed registration method for extension actions or an equivalent coherent name.
- `packages/extension-sdk/src/api.ts` exposes a typed registration method for declarative Console contributions or an equivalent coherent name.
- `packages/extension-sdk/src/api.ts` exposes a typed registration method for integration commands or an equivalent coherent name.
- `packages/extension-sdk/src/api.ts` exposes a typed registration method for deep links or an equivalent coherent name.
- Public SDK types for extension actions are exported from `@eforge-build/extension-sdk`.
- Public SDK types for Console contributions are exported from `@eforge-build/extension-sdk`.
- Public SDK types for integration commands are exported from `@eforge-build/extension-sdk`.
- Public SDK types for deep links are exported from `@eforge-build/extension-sdk`.
- New action input schemas require object-root TypeBox-compatible schemas.
- New contribution ids are namespaced or resolved to stable effective ids that avoid cross-extension collisions.
- New command ids are namespaced or resolved to stable effective ids that avoid cross-extension collisions.
- New deep-link ids are namespaced or resolved to stable effective ids that avoid cross-extension collisions.
- `packages/engine/src/extensions/types.ts` includes registry record types and recorder state arrays for extension actions.
- `packages/engine/src/extensions/types.ts` includes registry record types and recorder state arrays for Console contributions.
- `packages/engine/src/extensions/types.ts` includes registry record types and recorder state arrays for integration commands.
- `packages/engine/src/extensions/types.ts` includes registry record types and recorder state arrays for deep links.
- `packages/engine/src/extensions/recorder.ts` records valid action registrations.
- `packages/engine/src/extensions/recorder.ts` records valid Console contribution registrations.
- `packages/engine/src/extensions/recorder.ts` records valid integration command registrations.
- `packages/engine/src/extensions/recorder.ts` records valid deep-link registrations.
- Invalid new extension registrations produce extension diagnostics instead of crashing extension loading.
- Duplicate action ids produce deterministic diagnostics.
- Duplicate contribution ids produce deterministic diagnostics.
- Duplicate command ids produce deterministic diagnostics.
- Duplicate deep-link ids produce deterministic diagnostics.
- Extension list projections include safe counts and metadata for action, Console contribution, integration command, and deep-link registrations.
- Extension show projections include safe counts and metadata for action, Console contribution, integration command, and deep-link registrations.
- Extension validate projections include safe counts and metadata for action, Console contribution, integration command, and deep-link registrations.
- Extension test projections include safe counts and metadata for action, Console contribution, integration command, and deep-link registrations.
- Projection responses do not expose handler functions.
- Projection responses do not expose extension module objects.
- `eforge/extensions/eforge-guardrails.ts` compiles against the new SDK exports.
- `eforge/extensions/eforge-guardrails.ts` preserves its agent-run prompt guardrail behavior.
- `eforge/extensions/eforge-guardrails.ts` preserves its architecture reviewer perspective behavior.
- `eforge/extensions/eforge-guardrails.ts` preserves its maintainability validation provider behavior.
- `@eforge-build/client` owns route constants for listing extension contribution manifests.
- `@eforge-build/client` owns route constants for invoking extension actions.
- `@eforge-build/client` owns TypeBox schemas for extension contribution manifests.
- `@eforge-build/client` owns derived TypeScript wire types for extension contribution manifests.
- `@eforge-build/client` owns TypeBox schemas for extension action invocation requests.
- `@eforge-build/client` owns TypeBox schemas for extension action invocation responses.
- `@eforge-build/client` owns derived TypeScript wire types for extension action invocation requests.
- `@eforge-build/client` owns derived TypeScript wire types for extension action invocation responses.
- A Node client helper exists for fetching the contribution manifest.
- A Node client helper exists for invoking an extension action.
- A passive `IfRunning` client helper exists for fetching the contribution manifest without starting the daemon.
- A passive `IfRunning` client helper exists for invoking an extension action without starting the daemon.
- A browser-safe client helper exists for fetching the contribution manifest.
- A browser-safe client helper exists for invoking an extension action.
- The daemon exposes a manifest route that returns loaded extension actions without handler source code.
- The daemon exposes a manifest route that returns loaded Console contributions without handler source code.
- The daemon exposes a manifest route that returns loaded integration commands without handler source code.
- The daemon exposes a manifest route that returns loaded deep links without handler source code.
- The daemon exposes a single action invocation route that resolves actions by effective action id.
- The action invocation route returns a typed 404 response for an unknown action id.
- The action invocation route returns a typed 400 response for invalid request envelopes.
- The action invocation route returns a typed 400 response when action input fails the registered TypeBox schema.
- The action invocation route returns a typed failure response when an action handler throws.
- The action invocation route returns a typed timeout response when an action handler exceeds the configured timeout.
- The action invocation route rejects non-JSON-safe action output with a typed failure response.
- Action lifecycle diagnostics or events include invocation id.
- Action lifecycle diagnostics or events include action id.
- Action lifecycle diagnostics or events include extension name.
- Action lifecycle diagnostics or events include extension path.
- Action lifecycle diagnostics or events include requested-by metadata.
- Action lifecycle diagnostics or events include duration metadata.
- Action lifecycle diagnostics or events include error metadata.
- Action lifecycle diagnostics or events include no raw input payloads.
- Action lifecycle diagnostics or events include no raw output payloads.
- `packages/client/src/api-version-const.ts` is bumped from v51 if first-party clients require new route or event support from the daemon.
- Console renders at least one declarative extension contribution from the daemon manifest.
- Console invokes a registered extension action through the browser-safe client helper.
- Console contribution manifests include a schema version or renderer id for future renderer evolution.
- Pi exposes a generic way to discover extension-provided integration commands or action-backed deep links.
- Pi exposes a generic way to invoke extension-provided integration commands or action-backed deep links.
- Claude Code/MCP or CLI exposes an equivalent generic way to discover extension-provided integration commands or action-backed deep links when technically feasible.
- Claude Code/MCP or CLI exposes an equivalent generic way to invoke extension-provided integration commands or action-backed deep links when technically feasible.
- Extension-management command dispatch remains separate from extension-provided action dispatch.
- Existing session-plan list routes continue to work.
- Existing session-plan show routes continue to work.
- Existing session-plan create routes continue to work.
- Existing session-plan set-section routes continue to work.
- Existing session-plan readiness routes continue to work.
- Existing session-plan Pi tools continue to work.
- Existing session-plan Claude tools continue to work.
- Existing playbook list routes continue to work.
- Existing playbook show routes continue to work.
- Existing playbook save routes continue to work.
- Existing playbook run routes continue to work.
- Existing playbook Pi tools continue to work.
- Existing playbook Claude tools continue to work.
- Existing Console Planning Workspace behavior continues to work.
- Documentation states that input-source fetching is an existing shipped seam.
- Documentation states that PRD enrichment is an existing shipped seam.
- Documentation states that reviewer perspectives are an existing shipped seam.
- Documentation states that validation providers are existing shipped seams.
- Documentation states that profile routers are existing shipped seams.
- Documentation states that policy gates are existing shipped seams.
- Documentation states that event hooks are existing shipped seams.
- Documentation states that agent context/tool injection is an existing shipped seam.
- Documentation states that arbitrary extension-owned raw HTTP routes are not supported by this slice.
- Documentation states that arbitrary extension-supplied Console JavaScript is deferred beyond this slice.
- Documentation states that arbitrary extension-supplied React bundles are deferred beyond this slice.
- Documentation states that independently loaded frontend plugins are deferred beyond this slice.
- Documentation states that session-plan extraction is deferred beyond this slice unless equivalent contribution-backed replacements actually ship.
- Documentation states that playbook extraction is deferred beyond this slice unless equivalent contribution-backed replacements actually ship.
- Tests cover successful extension action registration.
- Tests cover successful extension action manifest projection.
- Tests cover invalid action registrations.
- Tests cover invalid contribution registrations.
- Tests cover invalid command registrations.
- Tests cover invalid deep-link registrations.
- Tests cover duplicate action registrations.
- Tests cover duplicate contribution registrations.
- Tests cover duplicate command registrations.
- Tests cover duplicate deep-link registrations.
- Tests cover daemon manifest route success.
- Tests cover daemon action invocation success.
- Tests cover daemon action invocation with an unknown action id.
- Tests cover daemon action invocation with invalid input.
- Tests cover daemon action invocation when an action handler throws.
- Tests cover daemon action invocation when an action handler times out.
- Tests cover daemon action invocation when an action returns invalid output.
- Tests cover browser helper invocation against the daemon route or a real route-compatible test server.
- Tests cover Console rendering of a declarative extension contribution.
- Tests cover Console invoking a bound action for a declarative extension contribution.
- Tests cover at least one generic host integration command/deep-link discovery path.
- Tests cover at least one generic host integration command/deep-link invocation path.
- Tests cover migration of `eforge/extensions/eforge-guardrails.ts` to the new SDK shape.
- `pnpm maintainability:check` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0.