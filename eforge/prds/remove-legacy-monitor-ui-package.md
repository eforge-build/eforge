---
title: Remove legacy monitor-ui package
created: 2026-06-04
depends_on: ["build-extension-platform-foundation-for-kernel-boundary-extraction"]
landing: pr
landing_auto_merge: true
stack_parent: build-extension-platform-foundation-for-kernel-boundary-extraction
---

# Remove legacy monitor-ui package

## Problem / Motivation

The legacy `packages/monitor-ui/` package is still retained even though the user clarified that `packages/console-ui` now fully replaces it. This creates stale workspace metadata, build steps, static-serving behavior, tests, and documentation that still describe or depend on the retired dashboard.

Backlog source: `.eforge/backlog/items/backlog-2026-06-03-remove-legacy-monitor-ui-package-once-console-ui-fully-repla.md`.

Evidence gathered:

- `docs/roadmap.md` names Console Observability and Control as a roadmap goal and says `console-ui` should be the canonical local-first control surface.
- `packages/console-ui/README.md` still says Console replaces `packages/monitor-ui/` while monitor-ui is retained until the port is fully baked; the user clarified that replacement is complete, so this wording is stale.
- `packages/console-ui` is healthy today: `pnpm --filter @eforge-build/console-ui test` passed with 63 files / 779 tests, and `pnpm --filter @eforge-build/console-ui type-check` exited 0.
- `packages/monitor-ui/` still exists and contains 465 files, including source, package-local tests, configs, and generated `dist`.
- Root `package.json` still builds both UIs via `build:ui`, exposes `dev:monitor`, and lists `@eforge-build/monitor-ui` as a workspace dev dependency.
- `packages/monitor/package.json` still lists `@eforge-build/monitor-ui` as a dev dependency, and `packages/monitor/tsup.config.ts` still copies `../monitor-ui/dist` into `dist/monitor-ui`.
- `packages/monitor/src/http/static-assets.ts` currently serves Console only under `/console` and falls back to `monitorUiDir` for every other non-API path.
- `packages/monitor/src/context.ts`, `packages/monitor/src/types.ts`, and `packages/monitor/src/routes/index.ts` still model both `monitorUiDir` and `consoleUiDir`.
- `packages/monitor/src/__tests__/static-ui-serving.test.ts` and `packages/monitor/src/__tests__/http-static-assets.test.ts` assert dual-root behavior with legacy monitor at `/` and Console at `/console`.
- First-party tests under `test/` import `@eforge-build/monitor-ui/...`; many have Console equivalents (`packages/console-ui/src/lib/run-state`, `src/lib/plan-content`, `src/components/graph`, `src/components/heatmap`) and should be migrated or retired.
- User-facing docs in `README.md`, `docs/architecture.md`, `web/public/docs/integrations.md`, and `web/public/docs/glossary.md` still describe the legacy monitor/dashboard split.
- `rg` in `scripts/` found active monitor-ui references in `scripts/publish-all.mjs` comments that describe private package publishing skips.
- `packages/console-ui/package.json` is currently `private: true`, `scripts/lib/lockstep-version.mjs` excludes Console from lockstep publishing, and `packages/monitor/tsup.config.ts` bundles `../console-ui/dist` into the published monitor package.

Conclusion: this is ready as removal cleanup, not a feature-completion gate. The remaining work is to delete the legacy package, route default UI traffic to Console, and remove active dependencies/references.

## Goal

Remove the retained legacy `packages/monitor-ui/` package and make Console the default browser dashboard while preserving the daemon/API root for HTTP routes. Keep `console-ui` as the canonical local-first control surface and leave the engine headless.

## Approach

Recommended profile: **Excursion**.

Rationale: this is a cohesive maintenance cleanup with clear targets across workspace metadata, monitor static serving, tests, and docs. It is broader than an Errand because package deletion will cascade through imports and lockfile/build scripts, but it does not require delegated module planning or architecture subplans. A single planner can enumerate the work and validations.

Primary implementation targets:

- `packages/monitor-ui/` — delete the legacy package directory, including `package.json`, Vite/TS/PostCSS config, source, tests, and checked-in `dist`.
- Root `package.json` — remove `@eforge-build/monitor-ui`; update `build:ui` to build Console only; remove `dev:monitor` or repoint it to Console with non-legacy naming.
- `pnpm-lock.yaml` — refresh after removing workspace dependencies and the package.
- `packages/monitor/package.json` — remove `@eforge-build/monitor-ui` from dev dependencies; keep `@eforge-build/console-ui` as the private build-time UI dependency.
- `packages/monitor/tsup.config.ts` — stop copying `../monitor-ui/dist`; copy only `../console-ui/dist` into monitor dist so Console remains bundled in the published `@eforge-build/monitor` package.
- `packages/monitor/src/context.ts`, `packages/monitor/src/types.ts`, `packages/monitor/src/routes/index.ts`, and `packages/monitor/src/http/static-assets.ts` — remove `monitorUiDir` plumbing and serve/redirect default UI traffic to Console while leaving API route dispatch unchanged.
- `packages/monitor/src/__tests__/static-ui-serving.test.ts` and `packages/monitor/src/__tests__/http-static-assets.test.ts` — update fixtures/assertions from dual-root legacy+Console behavior to Console-default behavior.
- Root-level tests currently importing `@eforge-build/monitor-ui/...` — migrate imports to Console equivalents where available:
  - reducer tests: `@eforge-build/console-ui/lib/run-state`
  - plan preview content: `@eforge-build/console-ui/lib/plan-content`
  - graph helpers: `@eforge-build/console-ui/components/graph/...`
  - heatmap helpers: `@eforge-build/console-ui/components/heatmap/...`
  - format helpers: use `@eforge-build/console-ui/lib/run-state/format` or `@eforge-build/console-ui/lib/format` where equivalent; retire tests for helpers that only existed to support the deleted legacy UI.
- `tsconfig.json` — remove the special `packages/monitor-ui` exclusion once the directory is gone.
- Documentation/comment files found by search: `README.md`, `docs/architecture.md`, `docs/llm-friendly-code.md`, `packages/console-ui/README.md`, `packages/client/src/event-registry.ts`, Console run-state comments that mention dual-reducer sync, tracked generated docs under `web/public/docs/` if docs drift checks require them, and `scripts/publish-all.mjs` comments that mention monitor-ui as an active/private package.
- `scripts/publish-all.mjs` should not publish Console directly unless the release model is intentionally changed; prefer generic private-package wording or accurate private package names.

Patterns and constraints:

- API route constants stay in `@eforge-build/client`; no new literal `/api/...` paths should be added.
- `packages/console-ui` already uses Vite `base: '/console/'`; preserving `/console/` as canonical and redirecting root UI paths avoids a risky asset-base rebase.
- `packages/monitor` is still the daemon/server package; names like `monitor.db`, `MonitorServer`, and `monitorUrl` are daemon terminology and should not be renamed in this cleanup unless they directly refer to the deleted UI package.
- After package deletion, `rg "@eforge-build/monitor-ui|packages/monitor-ui|monitor-ui"` should only show intentional historical fixtures or migration notes, not active dependencies, docs, comments, or imports.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Console already fully replaces monitor-ui. | User explicitly corrected the plan name and stated `console-ui` already fully replaces it. `pnpm --filter @eforge-build/console-ui test` passed 63 files / 779 tests; `pnpm --filter @eforge-build/console-ui type-check` exited 0. | high | low | During implementation, run Console tests/type-check/build and update any failing parity coverage. | High if wrong, but user statement plus validation makes this acceptable for readiness. |
| Console should remain canonically mounted at `/console/`, with root UI requests redirecting there, rather than rebasing Console to `/`. | `packages/console-ui/vite.config.ts` uses `base: '/console/'`; Console route helpers and tests expect `/console/...`. Changing base to `/` would touch more Console internals. | medium | low | Implementation can update `packages/monitor/src/http/static-assets.ts` and static-serving tests to verify `/` redirects to `/console/` and `/console/assets/...` still serves assets. | Medium; if product wants Console physically served at `/`, the implementation would need a broader Console routing/base update. |
| Root non-API paths can redirect to Console without breaking API routes. | `packages/monitor/src/http/router.ts` matches daemon API routes before invoking static UI serving and sends API 404s for unknown `/api` paths. | high | low | Static-serving tests should include an API path or rely on existing route tests; no static redirect should run for `/api/...`. | Medium; accidental redirect of API paths would break clients. |
| First-party monitor-ui tests can be migrated or retired without losing important coverage. | Search found Console equivalents for reducer, plan-content, graph, and heatmap helpers; Console has 779 passing package-local tests. Some legacy-only helpers (`escapeHtml`, `shortenPath`) are not direct active Console exports and may be delete-only coverage. | medium | medium | Migrate imports where equivalents exist, delete legacy-only tests, then run `pnpm test` or targeted root tests plus Console tests. | Medium; if deleted tests covered shared behavior not covered elsewhere, coverage may need to move into Console or client packages. |
| Console UI should remain private and bundled through `@eforge-build/monitor`, not published as `@eforge-build/console-ui`. | `packages/console-ui/package.json` has `private: true`; `scripts/lib/lockstep-version.mjs` does not list it in `LOCKSTEP_PACKAGE_PATHS`; `packages/monitor/tsup.config.ts` copies `../console-ui/dist` into monitor's published dist. | high | low | Keep Console private, remove monitor-ui publish comments, and run `pnpm publish-all --dry-run` if release-script behavior needs validation. | Medium; if standalone Console publishing is desired, package metadata, lockstep version propagation, and publish expectations need separate planning. |
| Historical references in old PRDs/plans/tests do not all need removal. | Search results include old `eforge/prds`, `eforge/plans`, and tests with sample strings about monitor-ui; many are historical artifacts rather than active dependencies. | high | low | Use `rg` after implementation and classify remaining hits; update active docs/code, leave historical fixture text if changing it would add noise. | Low; over-cleaning history could create unnecessary churn. |

## Scope

In scope:

- Remove the retained legacy `packages/monitor-ui/` workspace package and its package-local source, tests, config, generated `dist`, and package manifest.
- Make Console the default browser dashboard while preserving the daemon/API root for HTTP routes.
- Keep Console's canonical `/console/` base and redirect root UI requests such as `/`, `/index.html`, and old legacy SPA paths to `/console/` rather than rebasing the Vite app to `/`.
- Remove `@eforge-build/monitor-ui` from root and `packages/monitor` package dependencies/devDependencies.
- Remove pnpm lock entries for `@eforge-build/monitor-ui`.
- Stop copying `../monitor-ui/dist` during `packages/monitor` builds.
- Update root scripts so UI build/dev commands target Console only.
- Remove or repoint `dev:monitor`.
- Make `build:ui` equivalent to building Console only.
- Migrate first-party tests that import `@eforge-build/monitor-ui/...` to Console equivalents where the code still exists.
- Delete tests that only guard retired legacy UI behavior.
- Update monitor static-serving tests to assert Console is the default dashboard.
- Update monitor static-serving tests to assert `/console/` still serves correctly.
- Remove user-facing links/navigation to the legacy monitor dashboard.
- Update docs/comments that describe the legacy dashboard as retained.
- Clean generated/reference docs if they are tracked and drift gates require them.
- Align with `docs/roadmap.md` “Console Observability and Control”: make `console-ui` the canonical local-first control surface while keeping the engine headless.

Out of scope:

- Renaming `packages/monitor/`.
- Renaming `MonitorServer`.
- Renaming `monitor.db`.
- Renaming daemon SSE/API terminology.
- Renaming the low-level `monitorUrl` value used as the daemon HTTP base URL.
- Replacing the daemon HTTP API.
- Replacing SSE streams.
- Replacing queue/recovery APIs.
- Changing Console routes beyond default-dashboard routing.
- Adding new Console features.
- Treating this as a feature-parity implementation task.
- Removing historical fixture strings inside tests that intentionally mention `monitor-ui` as sample PRD text unless the reference creates an active dependency or stale user-facing guidance.

## Acceptance Criteria

- The `packages/monitor-ui/` directory does not exist.
- Root `package.json` contains no `@eforge-build/monitor-ui` dependency.
- `packages/monitor/package.json` contains no `@eforge-build/monitor-ui` dependency.
- `pnpm-lock.yaml` contains no `@eforge-build/monitor-ui` importer.
- `pnpm-lock.yaml` contains no `@eforge-build/monitor-ui` package entry.
- `packages/console-ui/package.json` remains private unless a separate explicit decision is made to publish Console as a standalone npm package.
- `scripts/publish-all.mjs` does not mention monitor-ui as a private package skipped during publish.
- Root `package.json` has no `dev:monitor` script that targets `@eforge-build/monitor-ui`.
- Root `package.json` `build:ui` builds `@eforge-build/console-ui` without building `@eforge-build/monitor-ui`.
- `packages/monitor/tsup.config.ts` copies `../console-ui/dist`.
- `packages/monitor/tsup.config.ts` does not copy `../monitor-ui/dist`.
- `packages/monitor/src/http/static-assets.ts` does not require a `monitorUiDir` fallback.
- `packages/monitor/src/http/static-assets.ts` does not serve a `monitorUiDir` fallback.
- A monitor static-serving test asserts that `GET /` redirects to `/console/` or otherwise resolves to the Console dashboard as the default UI.
- A monitor static-serving test asserts that `GET /console/` serves the Console dashboard.
- First-party source files contain no imports from `@eforge-build/monitor-ui`.
- First-party test files contain no imports from `@eforge-build/monitor-ui`.
- Active user-facing docs no longer state that the legacy monitor-ui dashboard is retained.
- Active user-facing docs no longer state that the legacy monitor-ui dashboard is served at `/`.
- `rg "@eforge-build/monitor-ui|packages/monitor-ui" package.json packages docs README.md scripts test --glob '!node_modules/**' --glob '!dist/**'` shows no active dependency references to the removed package.
- `rg "@eforge-build/monitor-ui|packages/monitor-ui" package.json packages docs README.md scripts test --glob '!node_modules/**' --glob '!dist/**'` shows no active import references to the removed package.
- `rg "@eforge-build/monitor-ui|packages/monitor-ui" package.json packages docs README.md scripts test --glob '!node_modules/**' --glob '!dist/**'` shows no active build-script references to the removed package.
- `rg "@eforge-build/monitor-ui|packages/monitor-ui" package.json packages docs README.md scripts test --glob '!node_modules/**' --glob '!dist/**'` shows no active user-facing documentation references to the removed package.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- `pnpm --filter @eforge-build/monitor test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm build` exits 0.
- `pnpm docs:check` exits 0.
- `pnpm maintainability:check` exits 0.