---
title: Complete Eforge Console Recovery After Partial Expedition Build
created: 2026-05-26
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Complete Eforge Console Recovery After Partial Expedition Build

## Problem / Motivation

The partial Expedition build `add-eforge-console-side-by-side-with-legacy-monitor-ui` failed after completing five plans and failing two plans due to transient Claude API 529 overloaded errors before tool-use events were recorded for the failed plans. The feature branch already contains completed Console work and original planning artifacts, so recovery must preserve that work, implement the missing plans, reconcile with current `main`, and validate the full feature.

Evidence-backed current state:

- `.eforge/monitor.db` run `03ea77d4-8b69-4774-ba3e-0ac30635468b` shows the original build failed after completing five plans and failing two plans.
- Completed plans are `plan-01-console-shell`, `plan-02-activity-audit-view`, `plan-03-now-dashboard`, `plan-05-runs-build-entrypoints`, and `plan-07-system-configuration-view`.
- Failed plans are `plan-04-queue-view` and `plan-06-static-serving-package-integration`.
- Both failed plans failed due to Claude API 529 overloaded errors before any tool-use events were recorded for those plans.
- The automatic recovery sidecar at `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.recovery.md` is partial and only lists `plan-06-static-serving-package-integration`; treat it as incomplete evidence, not as the source of truth.
- The local branch `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui` contains the five completed implementation commits and the original Expedition planning artifacts.
- Current `main` has advanced beyond the failed feature branch; recovery must reconcile the feature branch with current `main` before final validation.
- `docs/roadmap.md` still reserves multi-project observability for future Overseer work, so this recovery remains project-local and must not introduce multi-project UI semantics.

Risks:

- The existing feature branch is behind current `main`; rebasing or merging may reveal conflicts, especially around stack-related files, package manifests, or lockfile entries.
- Starting from clean `main` instead of the existing feature branch would lose or duplicate the five completed plan implementations.
- The partial recovery sidecar omits `plan-04-queue-view`; relying on it directly would ship without the Queue route.
- Static SPA routing can accidentally let `/api/...` paths fall through to HTML responses if API route priority is changed incorrectly.
- Static traversal protection can regress if URL decoding and root containment checks are not applied consistently to both `/` and `/console/` roots.
- Console Queue can accidentally imply unsupported mutation features if disabled edit controls or future stack-sync controls are rendered.
- Browser-side code can drift from typed daemon contracts if new local queue/run/config response interfaces are introduced instead of importing client wire types.
- Lockfile changes can be noisy because `packages/console-ui` already exists on the feature branch while root and monitor package dependency edges are still missing.
- Full `pnpm test` may surface unrelated flake or environment issues; failures should be triaged and not waived without evidence.

## Goal

Complete the existing Eforge Console side-by-side recovery by implementing the missing Queue view and static serving/package integration plans while preserving the completed work already on the feature branch.

The recovered feature must be reconciled with current `main`, remain project-local, keep the legacy monitor UI at `/`, serve the new Console UI at `/console/`, and satisfy the original final acceptance criteria plus recovery-specific validation.

## Approach

Continue from the existing feature branch instead of starting from clean `main`.

Rationale: the feature branch already contains five completed implementation plans and the original Expedition planning artifacts. Starting from clean `main` would risk duplicating or losing that completed work.

Treat `.eforge/monitor.db` as the source of truth for recovery state.

Rationale: the recovery sidecar is explicitly partial and omits `plan-04-queue-view`; the DB contains lifecycle events for all seven plans.

Implement exactly the two failed plan scopes.

Rationale: `plan-04-queue-view` and `plan-06-static-serving-package-integration` failed from transient 529 API errors before tool execution. The completed plans already passed their plan-local tests and merged into the feature branch.

Preserve existing completed Console code unless a minimal compatibility fix is required.

Rationale: broad rewrites would invalidate prior completed-plan review and increase merge risk. Compatibility changes are acceptable when needed to integrate the Queue route or side-by-side serving.

Keep Queue read-only.

Rationale: the roadmap says queue reordering and priority mutation remain future work. The Queue view should display status, priority, dependencies, and recovery verdicts but must not render mutation controls without typed client APIs.

Use shared Console state for Queue data.

Rationale: the original architecture requires Queue to consume the daemon-wide snapshot/deltas already managed by the Console shell, avoiding duplicate daemon-wide SSE subscriptions.

Preserve static-serving semantics for both SPAs.

Rationale: side-by-side serving should be a routing/package extension, not a behavior regression. Asset cache headers, SPA fallback, asset 404s, API 404s, and path traversal checks must remain correct for both roots.

Carry over the original final acceptance criteria verbatim and add recovery-specific criteria only as additional checks.

Rationale: the user explicitly requested that the final acceptance criteria be carried over from the original plan; added recovery criteria should not weaken or replace the original completion bar.

Recommend Excursion execution for the follow-on build.

Rationale: Expedition-level module planning is already present in the original branch. The follow-on work is bounded to two known plans plus integration validation, so a single cohesive plan should be enough.

Existing architecture direction to preserve:

- `packages/console-ui` is a new browser-only package for the project-local Eforge Console.
- Console consumes daemon/client contracts through `@eforge-build/client/browser` and must not import `@eforge-build/engine`.
- The Console app uses one daemon-wide stream as authoritative project state and bounded per-active-session streams for active build detail.
- The legacy monitor UI remains served at `/`.
- The new Console UI is served side-by-side at `/console/`.
- Vite asset paths for Console are scoped with `base: '/console/'`.
- The monitor server static-serving layer must route `/console` and `/console/...` to the Console SPA root without changing API route behavior.
- `packages/monitor/tsup.config.ts` must package both monitor UI and Console UI dist directories when they exist.

Architectural impact of the remaining work:

- `plan-04-queue-view` completes the Console's route/view architecture by replacing the Queue placeholder with a read-only, live-data route that derives data from the shared Console project state.
- `plan-04-queue-view` should add queue selectors and presentation components within `packages/console-ui` only; it should not add daemon APIs or duplicate daemon queue wire interfaces.
- `plan-06-static-serving-package-integration` completes the deployment boundary by making the monitor daemon host two independent SPAs.
- `plan-06-static-serving-package-integration` changes static routing, package build ordering, package copy behavior, and transitional navigation between the two SPAs.
- API route priority must remain unchanged; unknown `/api/...` requests must continue to return JSON API 404 responses instead of falling through to an SPA.
- Path traversal protections must remain equivalent for both static roots.

No intended architecture impact:

- No new daemon queue mutation API is introduced.
- No new stack-sync operation API is introduced.
- No multi-project or Overseer runtime surface is introduced.
- No shared runtime state is introduced between the legacy monitor SPA and the Console SPA.
- No engine import is introduced into either browser UI.

Primary existing branch/artifacts:

- Branch: `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`.
- Original PRD source: `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.md`.
- Original plan artifacts on feature branch: `eforge/plans/add-eforge-console-side-by-side-with-legacy-monitor-ui/`.
- Missing plan files on feature branch: `plan-04-queue-view.md` and `plan-06-static-serving-package-integration.md`.

Likely files for `plan-04-queue-view`:

- `packages/console-ui/src/lib/selectors/queue.ts`.
- `packages/console-ui/src/lib/selectors/index.ts`.
- `packages/console-ui/src/views/queue/queue-view.tsx`.
- `packages/console-ui/src/views/queue/queue-summary-cards.tsx`.
- `packages/console-ui/src/views/queue/queue-status-filter.tsx`.
- `packages/console-ui/src/views/queue/queue-status-group.tsx`.
- `packages/console-ui/src/views/queue/queue-item-row.tsx`.
- `packages/console-ui/src/views/queue/dependency-chips.tsx`.
- `packages/console-ui/src/views/queue/recovery-verdict-chip.tsx`.
- `packages/console-ui/src/views/queue/queue-state-panels.tsx`.
- `packages/console-ui/src/views/queue/index.ts`.
- `packages/console-ui/src/app.tsx`.
- `packages/console-ui/src/__tests__/queue-selectors.test.ts`.
- `packages/console-ui/src/__tests__/queue-view.test.tsx`.

Likely files for `plan-06-static-serving-package-integration`:

- `packages/monitor/src/server.ts`.
- `packages/monitor/src/__tests__/static-ui-serving.test.ts`.
- `packages/monitor/tsup.config.ts`.
- `packages/monitor/package.json`.
- `package.json`.
- `packages/monitor-ui/src/components/layout/header.tsx`.
- `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx`.
- `README.md`.
- `docs/architecture.md`.
- `pnpm-lock.yaml`.

Files to avoid broad rewrites in unless required by integration:

- Existing completed Console shell files from `plan-01-console-shell`.
- Existing Activity, Now, Runs, and System view implementations from plans 02, 03, 05, and 07.
- Engine internals.
- Daemon API route contracts, except if a browser-safe client export is missing and already exists in typed client code.

Validation commands to run before completion:

- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- `pnpm --filter @eforge-build/monitor-ui type-check` exits 0.
- `pnpm --filter @eforge-build/monitor type-check` exits 0.
- `pnpm --filter @eforge-build/console-ui build` exits 0.
- `pnpm --filter @eforge-build/monitor-ui build` exits 0.
- `pnpm --filter @eforge-build/monitor build` exits 0.
- `pnpm test` exits 0.

Documentation changes are modest and should stay aligned with the original phase-1 preview scope.

Likely documentation updates:

- `README.md` should mention that the legacy monitor remains available at `/` and the Eforge Console preview is available at `/console/` on the same daemon port.
- `docs/architecture.md` should mention that the monitor daemon temporarily hosts two SPAs during the transition: `packages/monitor-ui` at `/` and `packages/console-ui` at `/console/`.

Documentation constraints:

- Documentation must describe Console as project-local, not multi-project Overseer.
- Documentation must not claim queue editing, priority editing, stack-sync controls, or multi-project behavior.
- Documentation should not imply the legacy monitor UI has been removed.
- Documentation should be changed only where it describes monitor UI access, hosting, or architecture relevant to side-by-side serving.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The original build truly completed plans 01, 02, 03, 05, and 07 and failed plans 04 and 06. | Queried `.eforge/monitor.db` run `03ea77d4-8b69-4774-ba3e-0ac30635468b`; final status events show five completed plans and two failed plans. | high | low | Re-run the DB status query or inspect the monitor UI run detail. | Wrong plan targeting could omit required work or duplicate completed work. |
| The failures were transient API 529 failures before meaningful implementation for plans 04 and 06. | DB events for plans 04 and 06 show `doc-author` and `builder` results with API 529, zero usage, and no tool-use events. | high | low | Inspect `agent:result`, `agent:usage`, and `agent:tool_use` rows for the two failed plan IDs. | If agents changed files before failing, recovery might accidentally ignore partial work. |
| The recovery sidecar is incomplete and should not be used as the sole recovery plan. | Sidecar says partial/manual and lists only `plan-06-static-serving-package-integration`; DB shows both `plan-04-queue-view` and `plan-06-static-serving-package-integration` failed. | high | low | Compare `.recovery.md` and `.recovery.json` against monitor DB events. | Following the sidecar directly would miss the Queue view. |
| The existing local feature branch is the correct base for recovery. | `git branch --list` shows `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`; `git log` shows it contains the five completed implementation commits. | high | low | Check `git log eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui` and `git diff` against main before building. | Starting from main would lose completed plan work and cause duplicate implementation. |
| The feature branch is behind current `main` and must be reconciled. | `git merge-base main eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui` is older than current `main`; current `main` includes PR #46 after the branch point. | high | low | Rebase or merge current `main` into the recovery branch and resolve conflicts. | Final landing could conflict or reintroduce stale changes. |
| The original final acceptance criteria are complete enough to remain the final recovery bar. | Extracted the original final acceptance criteria from `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.md` and carried them into this plan. | high | low | Compare this session plan's acceptance criteria against the original PRD acceptance criteria block. | A missed original criterion could allow an incomplete recovery. |
| Excursion is sufficient for the follow-on build. | The original Expedition already produced detailed module plans; only two known plan scopes remain. | medium | low | If eforge compile finds unresolved cross-module ambiguity, escalate the build profile to Expedition. | If too small, the follow-on build might under-plan static serving or Queue integration. |
| Full `pnpm test` is expected to be runnable in this repository after recovery. | The original orchestration validation list includes `pnpm test`; project `AGENTS.md` lists `pnpm test` as the standard test command. | high | medium | Run `pnpm test` after type-check and package builds. | If environmental or unrelated test failures appear, recovery may need triage notes before landing. |

## Scope

In scope:

- Continue from the existing branch `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`, preserving the completed work already on that branch.
- Bring the recovery branch up to date with current `main` before final validation or landing.
- Implement the missing Queue view work described by `eforge/plans/add-eforge-console-side-by-side-with-legacy-monitor-ui/plan-04-queue-view.md` on the feature branch.
- Implement the missing static serving and package integration work described by `eforge/plans/add-eforge-console-side-by-side-with-legacy-monitor-ui/plan-06-static-serving-package-integration.md` on the feature branch.
- Preserve completed Console shell, Now dashboard, Activity/audit, Runs/build entrypoints, and System configuration implementations unless a minimal compatibility fix is required by the recovered Queue or static-serving work.
- Carry forward the original final acceptance criteria from `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.md`.
- Validate the full recovered feature, not only the two newly implemented plans.

Out of scope:

- Re-running the original Expedition from scratch.
- Replacing or broadly rewriting completed plans 01, 02, 03, 05, or 07.
- Adding queue reordering, priority editing, stack-sync controls, or multi-project Overseer UI.
- Trusting the partial recovery sidecar as a complete plan inventory.
- Deleting the legacy monitor UI.
- Changing daemon wire shapes unless an existing typed client export must be surfaced to the browser package for already-implemented APIs.

## Acceptance Criteria

- The recovered work starts from or preserves all commits currently on branch `eforge/add-eforge-console-side-by-side-with-legacy-monitor-ui`.
- The recovered work includes an implementation for `plan-04-queue-view`.
- The recovered work includes an implementation for `plan-06-static-serving-package-integration`.
- The recovered work does not remove the completed implementations for `plan-01-console-shell`, `plan-02-activity-audit-view`, `plan-03-now-dashboard`, `plan-05-runs-build-entrypoints`, or `plan-07-system-configuration-view`.
- The recovered branch is reconciled with current `main` before final validation.
- `.eforge/monitor.db` evidence for failed run `03ea77d4-8b69-4774-ba3e-0ac30635468b` is reflected in implementation notes or commit context for the recovery.
- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- `pnpm --filter @eforge-build/monitor-ui type-check` exits 0.
- `pnpm --filter @eforge-build/monitor type-check` exits 0.
- `pnpm --filter @eforge-build/console-ui build` exits 0.
- `pnpm --filter @eforge-build/monitor-ui build` exits 0.
- `pnpm --filter @eforge-build/monitor build` exits 0.
- `pnpm test` exits 0.
- `packages/console-ui/package.json` exists and declares package name `@eforge-build/console-ui`.
- `pnpm --filter @eforge-build/console-ui build` exits 0.
- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- The root `package.json` contains a developer script that starts the Console UI dev server.
- The root `package.json` preserves the existing developer script that starts the legacy monitor UI dev server.
- The root `package.json` contains a developer script that builds the Console UI.
- `packages/monitor/package.json` declares `@eforge-build/console-ui` as a workspace devDependency or otherwise guarantees the Console UI package is built before monitor packaging copies its dist output.
- A monitor package build copies `packages/console-ui/dist` into `packages/monitor/dist/console-ui` when the Console UI dist directory exists.
- A monitor package build continues to copy `packages/monitor-ui/dist` into `packages/monitor/dist/monitor-ui` when the legacy monitor UI dist directory exists.
- The daemon/monitor server returns the legacy monitor SPA HTML for `GET /`.
- The daemon/monitor server returns the Console SPA HTML for `GET /console/`.
- The daemon/monitor server serves Console built asset requests under `/console/assets/` from `packages/monitor/dist/console-ui/assets/`.
- The daemon/monitor server serves legacy monitor built asset requests under `/assets/` from `packages/monitor/dist/monitor-ui/assets/`.
- Static-serving tests cover `GET /`, `GET /index.html`, `GET /assets/<asset>`, `GET /console/`, `GET /console/index.html`, and `GET /console/assets/<asset>`.
- Static-serving tests verify path traversal attempts under both `/` and `/console/` do not read files outside the configured UI dist directories.
- The legacy monitor UI renders a visible link or button whose accessible name contains `Console` and whose target is `/console/`.
- The Console UI renders a visible link or button whose accessible name contains `Monitor` and whose target is `/`.
- `packages/console-ui/vite.config.ts` sets Vite `base` to `/console/`.
- A built Console `index.html` references generated assets with `/console/assets/` URLs.
- The Console UI displays the eforge logo in its primary shell.
- The Console UI global styles include a near-black application background token or CSS value.
- The Console UI global styles include the green eforge accent `#67f553` or a documented project token that resolves to that color.
- The Console UI shell includes a compact sidebar navigation area.
- The Console UI uses bordered card or table surfaces for primary dashboard content.
- The Console UI uses Inter and JetBrains Mono fonts, or explicitly documented local/system fallbacks when those fonts are unavailable.
- Console source does not render controls for queue reordering, priority editing, multi-project Overseer navigation, or stack-sync operations unless matching implemented typed client APIs exist in `@eforge-build/client` at implementation time.
- Console source establishes the daemon-wide SSE stream through `subscribeWithSnapshot` from `@eforge-build/client/browser`.
- Console source references the daemon-wide SSE route through `API_ROUTES` or `buildPath` from `@eforge-build/client/browser`.
- The Console dashboard renders queue information derived from the daemon stream snapshot or subsequent daemon stream events.
- The Console dashboard renders run information derived from the daemon stream snapshot or subsequent daemon stream events.
- The Console dashboard renders auto-build or liveness information derived from the daemon stream snapshot or subsequent daemon stream events.
- The Console dashboard renders recent activity information when `recentActivity` is present in the daemon stream snapshot or subsequent daemon stream events.
- The Console dashboard renders stack layer information when `stackLayers` is present in the daemon stream snapshot or subsequent daemon stream events.
- Console REST fetches for config, profiles, extensions, playbooks, session plans, models, recovery, or stack layers use typed helpers or route constants exported by `@eforge-build/client/browser`.
- Console source does not duplicate daemon API response interfaces for queue items, runs, session metadata, auto-build state, or stack layers.
- Console source imports shared wire types from `@eforge-build/client` or `@eforge-build/client/browser`.
- Console source does not import `@eforge-build/engine`.
- A Console guard test fails when a source file outside an explicitly allowed test fixture contains a hardcoded `/api/` route literal.
- A Console guard test fails when a source file imports `@eforge-build/engine`.
- Console selector or state-projection tests cover active build derivation from daemon run state.
- Console selector or state-projection tests cover queue summary derivation from daemon queue state.
- Console active-build subscription logic subscribes to each currently active build session shown on the dashboard.
- Console active-build subscription logic unsubscribes from a build session when that build leaves the active dashboard set.
- Console active-build subscription logic does not subscribe to every historical run by default.
- When daemon state contains two concurrent active builds, the Console dashboard displays live status or detail surfaces for both active builds.
- The Expedition build plan contains separate implementation subplans or equivalent plan sections for the Console shell, Now dashboard, Queue view, Runs/build entry points, System configuration view, Activity/audit view, and static serving/package integration before code implementation begins.
- Each Console view implementation includes an empty state for the case where its primary data collection is empty.
- Each Console view implementation includes a loading or connecting state for the case where required daemon data has not arrived yet.
- Each Console view implementation includes an error or unavailable state for the case where the daemon stream or an on-demand typed fetch fails.
- Console top-level copy uses project-local terminology and does not describe the UI as a multi-project or multi-daemon Overseer.
- Existing monitor UI type-checks after adding the Console link.
- Monitor server type-checks after adding side-by-side static serving.
- If documentation is changed, the changed documentation describes Console as a transitional preview at `/console/`.
- If documentation is changed, the changed documentation does not claim queue editing, stack-sync controls, multi-project Overseer behavior, or other unimplemented capabilities.
