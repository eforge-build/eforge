---
id: plan-01-remove-monitor-ui-code
name: Remove Monitor UI Package and Route Dashboard Traffic to Console
branch: remove-legacy-monitor-ui-package/plan-01-remove-monitor-ui-code
agents:
  builder:
    effort: high
    rationale: This plan deletes a workspace package, refreshes lockfile/config
      metadata, updates static HTTP routing, and migrates root tests to Console
      equivalents.
  reviewer:
    effort: high
    rationale: The review must inspect package removal, HTTP static serving
      behavior, path traversal safeguards, and build/test configuration changes.
  tester:
    effort: high
    rationale: Targeted monitor static-serving tests, Console package tests,
      workspace type-checking, and root tests all exercise different parts of
      the removal.
---

# Remove Monitor UI Package and Route Dashboard Traffic to Console

## Architecture Context

`packages/monitor/` remains the daemon/server package. It records events, exposes daemon HTTP/SSE APIs, and serves the bundled browser UI. `packages/console-ui/` is now the only dashboard package and keeps its Vite base at `/console/`. This plan removes the retired `packages/monitor-ui/` workspace package and redirects default non-API browser requests at the monitor daemon root to Console without changing API route dispatch or daemon wire contracts.

No database migration is required. Do not bump `DAEMON_API_VERSION`; the daemon API routes and wire shapes are unchanged.

## Implementation

### Overview

Delete the legacy UI workspace package, remove its workspace metadata, make monitor static serving depend only on `consoleUiDir`, and migrate first-party tests from `@eforge-build/monitor-ui` imports to Console equivalents. Root UI paths such as `/`, `/index.html`, and old legacy SPA paths must produce a redirect to `/console/`; `/console/` and `/console/assets/...` continue to serve Console files from the bundled `console-ui` dist directory. Unknown `/api/...` paths must keep the JSON API 404 path in the router rather than falling through to static redirects.

### Key Decisions

1. Keep Console mounted at `/console/` and redirect root UI traffic there. This avoids rebasing the Vite app away from its existing `base: '/console/'` configuration.
2. Keep `packages/console-ui/package.json` private. The monitor package bundles Console from `../console-ui/dist`; Console is not published as a standalone npm package in this cleanup.
3. Migrate tests to Console source through `@eforge-build/console-ui/...` subpaths. Add a Console subpath export and test aliases so root tests can import the private workspace package without depending on the deleted package.
4. Retire tests that only covered helpers owned by the deleted legacy UI, such as the exported legacy `shortenPath` helper. Keep or migrate tests for helpers still used by Console.

## Scope

### In Scope

- Delete `packages/monitor-ui/`, including source, config, tests, package manifest, and checked-in `dist` artifacts.
- Remove `@eforge-build/monitor-ui` from root and monitor package metadata and from `pnpm-lock.yaml`.
- Update root UI build/dev scripts so UI build targets Console only and the legacy `dev:monitor` script is absent.
- Update monitor build packaging to copy only `../console-ui/dist` into `packages/monitor/dist/console-ui`.
- Remove `monitorUiDir` from monitor context/types/routes/static-serving code.
- Redirect root non-API UI requests to `/console/` while preserving Console asset serving, SPA fallback, malformed-path handling under `/console`, symlink rejection, traversal rejection, and `/api` JSON 404 behavior.
- Remove the Console header link that navigates users back to the retired root dashboard.
- Migrate first-party root tests from `@eforge-build/monitor-ui` imports to Console equivalents.
- Remove test config includes and aliases for `packages/monitor-ui`.
- Refresh `pnpm-lock.yaml` with pnpm after package metadata changes.

### Out of Scope

- Renaming `packages/monitor/`, `MonitorServer`, `monitor.db`, or daemon `monitorUrl` terminology.
- Changing daemon API route constants or SSE wire shapes.
- Publishing `@eforge-build/console-ui` as a public package.
- Rebasing Console routes from `/console/` to `/`.
- Adding new Console features.
- Rewriting historical PRD fixture strings in tests that mention `monitor-ui` only as sample text.

## Files

### Create

None.

### Delete

- `packages/monitor-ui/` — remove the retired legacy UI workspace package and all package-local artifacts.
- `test/shorten-path.test.ts` — delete tests for the legacy-only exported `shortenPath` helper unless the implementation intentionally moves that helper into Console as a public export.

### Modify

- `package.json` — remove `@eforge-build/monitor-ui`; add `@eforge-build/console-ui` as a root dev dependency if root tests import it by package name; change `build:ui` to build only Console; remove `dev:monitor` and keep `dev:console`.
- `pnpm-lock.yaml` — refresh via `pnpm install --lockfile-only` so the root importer, monitor importer, and removed workspace importer no longer reference `@eforge-build/monitor-ui`.
- `packages/console-ui/package.json` — keep `private: true`; add subpath exports such as `"./*": "./src/*"` if needed for root test imports.
- `packages/console-ui/src/components/header/control-surface-links.tsx` — remove the Monitor back-link to `/`; keep Now, Plans, and System Console navigation.
- `packages/console-ui/src/__tests__/header.test.tsx` — update or add assertions for the header navigation set after the Monitor back-link is removed.
- `packages/monitor/package.json` — remove `@eforge-build/monitor-ui` from `devDependencies`; keep `@eforge-build/console-ui` as the build-time private UI dependency.
- `packages/monitor/tsup.config.ts` — remove the `../monitor-ui/dist` copy and copy only `../console-ui/dist`.
- `packages/monitor/src/types.ts` — change `StartServerOptions.uiDirs` and `MonitorUiRoots` to model only `consoleUiDir`.
- `packages/monitor/src/context.ts` — remove the default `monitorUiDir` root and construct `uiRoots` with only `consoleUiDir`.
- `packages/monitor/src/routes/index.ts` — stop passing `monitorUiDir` into static serving.
- `packages/monitor/src/http/static-assets.ts` — remove the legacy fallback root, keep `/console` static serving, and redirect non-API non-Console UI requests to `/console/` with a 302 `Location` header.
- `packages/monitor/src/__tests__/http-static-assets.test.ts` — replace dual-root fixtures with Console-only fixtures; assert root redirects, `/console/` serves Console, Console assets cache immutably, Console SPA fallback serves index, asset misses return 404, malformed Console paths return 400, and Console symlink/path traversal is rejected.
- `packages/monitor/src/__tests__/static-ui-serving.test.ts` — update real HTTP server tests to pass only `consoleUiDir`; assert `GET /`, `GET /index.html`, and a former legacy SPA path redirect to `/console/`; assert `GET /console/` serves Console; keep unknown `/api/not-a-route` JSON 404 coverage.
- `tsconfig.json` — remove the special `packages/monitor-ui` exclusion.
- `tsconfig.base.json` — remove the `@eforge-build/monitor-ui/*` path mapping and add `@eforge-build/console-ui/*` if root tests need typed package subpaths.
- `vitest.config.ts` — update the project comment so the main project no longer names monitor-ui tests.
- `vitest.main.config.ts` — remove monitor-ui test include globs and aliases; add aliases for `@eforge-build/console-ui/(.*)` and `@/(.*)` to `packages/console-ui/src/$1`; include `packages/console-ui/node_modules` in module resolution if root tests import Console component helpers that depend on Console-local dependencies.
- `test/monitor-plan-preview.test.ts` — import `splitPlanContent` and `parseFrontmatterFields` from `@eforge-build/console-ui/lib/plan-content`.
- `test/monitor-reducer-helpers.ts` — import `eforgeReducer` and `RunState` from `@eforge-build/console-ui/lib/run-state`.
- `test/monitor-reducer-core.test.ts` — migrate reducer imports to `@eforge-build/console-ui/lib/run-state`.
- `test/monitor-reducer-batch-stats.test.ts` — migrate reducer imports to `@eforge-build/console-ui/lib/run-state`.
- `test/monitor-reducer-agent-usage.test.ts` — migrate reducer imports to `@eforge-build/console-ui/lib/run-state`.
- `test/monitor-reducer-run-projection.test.ts` — migrate reducer imports to `@eforge-build/console-ui/lib/run-state`.
- `test/monitor-format.test.ts` — keep tests for `formatDuration`, `formatNumber`, and any Console-owned equivalent helpers by importing from `@eforge-build/console-ui/lib/run-state/format` or `@eforge-build/console-ui/lib/format`; remove cases for legacy-only `formatTime` and `escapeHtml` if no Console export exists.
- `test/heatmap-data.test.ts` — import `computeHeatmapData` from `@eforge-build/console-ui/components/heatmap/use-heatmap-data`.
- `test/monitor-graph-layout.test.ts` — import `computeGraphLayout` from `@eforge-build/console-ui/components/graph/use-graph-layout`; use Console/client `OrchestrationConfig` types if the existing engine type import no longer matches.
- `test/monitor-graph-status.test.ts` — import graph status helpers from `@eforge-build/console-ui/components/graph/graph-status`.

## Verification

- [ ] The directory `packages/monitor-ui/` is absent.
- [ ] `package.json`, `packages/monitor/package.json`, and `pnpm-lock.yaml` contain zero `@eforge-build/monitor-ui` matches.
- [ ] `pnpm-lock.yaml` contains zero `packages/monitor-ui` importer entries.
- [ ] `packages/console-ui/package.json` still contains `"private": true`.
- [ ] `package.json` has `build:ui` targeting `@eforge-build/console-ui` and no `dev:monitor` script.
- [ ] `packages/monitor/tsup.config.ts` copies `../console-ui/dist` and contains zero `../monitor-ui/dist` matches.
- [ ] `packages/monitor/src/http/static-assets.ts` contains no `monitorUiDir` field, parameter, or fallback call.
- [ ] A monitor static-serving test asserts `GET /` returns a 302 redirect with `Location: /console/`.
- [ ] A monitor static-serving test asserts `GET /console/` returns the Console index marker with `Cache-Control: no-cache`.
- [ ] A monitor static-serving test asserts an unknown `/api/not-a-route` returns JSON 404 and does not return the Console index marker.
- [ ] `rg "from '@eforge-build/monitor-ui|@eforge-build/monitor-ui" test packages --glob '!node_modules/**' --glob '!dist/**'` exits 1.
- [ ] `rg "monitorUiDir|../monitor-ui/dist|packages/monitor-ui" packages/monitor package.json pnpm-lock.yaml tsconfig*.json vitest*.config.ts --glob '!node_modules/**' --glob '!dist/**'` exits 1.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts packages/monitor/src/__tests__/http-static-assets.test.ts packages/monitor/src/__tests__/static-ui-serving.test.ts test/monitor-plan-preview.test.ts test/heatmap-data.test.ts test/monitor-graph-layout.test.ts test/monitor-graph-status.test.ts test/monitor-reducer-core.test.ts test/monitor-reducer-batch-stats.test.ts test/monitor-reducer-agent-usage.test.ts test/monitor-reducer-run-projection.test.ts` exits 0.
