---
id: plan-03-static-serving-package-integration
name: Integrate Console Static Serving and Packaging
branch: complete-eforge-console-recovery-after-partial-expedition-build/plan-03-static-serving-package-integration
agents:
  builder:
    effort: high
    rationale: This plan changes server static routing, path traversal handling,
      package build edges, lockfile state, legacy UI navigation, and docs.
  reviewer:
    effort: high
    rationale: Review must focus on API route priority, traversal containment,
      package-copy behavior, dependency drift, and documentation claims.
---

# Integrate Console Static Serving and Packaging

## Architecture Context

This plan fills the original failed `plan-06-static-serving-package-integration` scope. The monitor daemon temporarily hosts two independent SPAs: legacy monitor UI at `/` and Eforge Console preview at `/console/`. API route priority, static traversal protection, asset 404 behavior, SPA fallback behavior, and cache headers must remain valid for both roots.

## Implementation

### Overview

Generalize monitor static serving so requests under `/console` use `dist/console-ui` while all other non-API requests use `dist/monitor-ui`. Add package build edges and root scripts, copy Console dist during monitor packaging when present, add a legacy monitor header link to `/console/`, and update README/architecture docs with a project-local transitional preview note.

### Key Decisions

1. **API routes keep priority.** The existing `/api/...` dispatch and unknown API JSON 404 remain before static serving.
2. **One parameterized static helper.** Use a single static resolver that accepts `rootDir` and `basePath` so traversal checks, asset 404s, cache headers, and SPA fallback logic stay equivalent across both SPAs.
3. **Decode before containment checks.** Percent-decoded paths are resolved and checked with `path.relative()` containment before any file is read.
4. **Copy UI dist directories only when present.** `packages/monitor/tsup.config.ts` copies legacy monitor and Console dist folders if they exist, preserving local monitor builds when a UI dist is absent.
5. **Docs remain modest.** Mention Console as a transitional project-local preview at `/console/`; do not claim queue editing, stack sync controls, multi-project behavior, or legacy monitor removal.

## Scope

### In Scope

- Add monitor server support for `dist/console-ui` at `/console` and `/console/...`.
- Add test-only `uiDirs` start-server options for fixture roots.
- Add static-serving tests for both roots, assets, SPA fallbacks, traversal attempts, and unknown API 404s.
- Add root Console dev/build scripts while preserving legacy monitor scripts.
- Add `@eforge-build/console-ui` as a workspace devDependency where build ordering/package copying requires it.
- Update monitor package `tsup` copy behavior for both UI dist directories.
- Add a visible legacy monitor header link with accessible name containing `Console` and `href="/console/"`.
- Add/update legacy monitor header tests for the Console link.
- Update README and `docs/architecture.md` with side-by-side hosting language.
- Regenerate `pnpm-lock.yaml` after package manifest edits.

### Out of Scope

- Creating `packages/console-ui`.
- Changing Queue view behavior.
- Importing Console code into the legacy monitor app.
- Reworking monitor reducers, event streams, or layout beyond adding the header link.
- Adding daemon API routes beyond static hosting.
- Deleting or renaming `packages/monitor-ui`.
- Queue editing, priority editing, stack-sync controls, or multi-project Overseer behavior.

## Files

### Create

- `packages/monitor/src/__tests__/static-ui-serving.test.ts` — real HTTP tests using temporary monitor and Console UI fixture directories with distinct index and asset markers.

### Modify

- `packages/monitor/src/server.ts` — add `CONSOLE_UI_DIR`, introduce a named `StartServerOptions` type with `uiDirs?: { monitorUiDir?: string; consoleUiDir?: string }`, generalize `serveStaticFile`, dispatch `/console` and `/console/...` to the Console root after API handling, and dispatch all other non-API requests to the legacy root.
- `packages/monitor/tsup.config.ts` — add a small `copyUiDist(source, target)` helper and call it for `../monitor-ui/dist -> dist/monitor-ui` and `../console-ui/dist -> dist/console-ui`.
- `packages/monitor/package.json` — add `"@eforge-build/console-ui": "workspace:*"` to `devDependencies`.
- `package.json` — add `dev:console`, add `build:console-ui`, update `build:ui` to build both UIs, preserve `dev:monitor`, and add root devDependency `"@eforge-build/console-ui": "workspace:*"` if required by workspace ordering.
- `packages/monitor-ui/src/components/layout/header.tsx` — add a compact anchor or `Button asChild` link to `/console/` with accessible name containing `Console`.
- `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx` — assert the Console link exists and targets `/console/`.
- `README.md` — mention legacy monitor at `/` and Eforge Console preview at `/console/` on the same daemon port.
- `docs/architecture.md` — mention the monitor daemon temporarily hosts `packages/monitor-ui` at `/` and `packages/console-ui` at `/console/`.
- `pnpm-lock.yaml` — update importers and dependency entries after package manifest edits.

## Static Serving Contract

Routing matrix to test:

| Request path | Source root | Expected result |
| --- | --- | --- |
| `/` | monitor UI | legacy `index.html`, `Cache-Control: no-cache` |
| `/index.html` | monitor UI | legacy `index.html`, `Cache-Control: no-cache` |
| `/assets/<file>` | monitor UI assets | file with immutable cache or 404 |
| `/queue/deep/link` | monitor UI | legacy SPA fallback |
| `/console` | Console UI | Console `index.html`, `Cache-Control: no-cache` |
| `/console/` | Console UI | Console `index.html`, `Cache-Control: no-cache` |
| `/console/index.html` | Console UI | Console `index.html`, `Cache-Control: no-cache` |
| `/console/assets/<file>` | Console UI assets | file with immutable cache or 404 |
| `/console/runs/deep/link` | Console UI | Console SPA fallback |
| `/api/not-a-route` | none | JSON 404, no SPA fallback |

Traversal handling:

- Strip the selected base path before filesystem resolution.
- Decode percent escapes before resolving.
- Return `400` for malformed percent escapes.
- Resolve candidates with `resolve(rootDir, '.' + relativePath)`.
- Confirm containment using `relative(rootDir, candidate)` and `isAbsolute()`.
- Never read files outside the selected UI root.
- Return `404` for asset-prefixed traversal or misses.
- Use the selected SPA index fallback for non-asset misses that do not read outside the root.

## Verification

- [ ] `package.json` contains `dev:console` with command `pnpm --filter @eforge-build/console-ui dev`.
- [ ] `package.json` contains `build:console-ui` with command `pnpm --filter @eforge-build/console-ui build`.
- [ ] `package.json` preserves `dev:monitor` with command `pnpm --filter @eforge-build/monitor-ui dev`.
- [ ] `package.json` `build:ui` invokes builds for both `@eforge-build/monitor-ui` and `@eforge-build/console-ui`.
- [ ] `packages/monitor/package.json` `devDependencies` contains `"@eforge-build/console-ui": "workspace:*"`.
- [ ] `packages/monitor/tsup.config.ts` copies `../monitor-ui/dist` to `dist/monitor-ui` when `../monitor-ui/dist` exists.
- [ ] `packages/monitor/tsup.config.ts` copies `../console-ui/dist` to `dist/console-ui` when `../console-ui/dist` exists.
- [ ] `packages/monitor/src/server.ts` defines `CONSOLE_UI_DIR = resolve(__dirname, 'console-ui')`.
- [ ] `startServer` accepts `uiDirs.monitorUiDir` and `uiDirs.consoleUiDir` for tests.
- [ ] Static-serving tests cover `GET /`, `GET /index.html`, `GET /assets/legacy.js`, `GET /assets/missing.js`, `GET /console`, `GET /console/`, `GET /console/index.html`, `GET /console/assets/console.js`, `GET /console/assets/missing.js`, `GET /queue/deep/link`, `GET /console/runs/deep/link`, and `GET /api/not-a-route`.
- [ ] Static-serving tests assert asset responses use `Cache-Control: public, max-age=31536000, immutable`.
- [ ] Static-serving tests assert HTML responses use `Cache-Control: no-cache`.
- [ ] Static-serving tests assert malformed percent escapes under `/` and `/console/` return status `400` and no SPA marker body.
- [ ] Static-serving tests assert encoded traversal requests under `/` do not return sentinel file contents outside the monitor UI root.
- [ ] Static-serving tests assert encoded traversal requests under `/console/` do not return sentinel file contents outside the Console UI root.
- [ ] Static-serving tests assert encoded traversal requests under `/assets/` return status `404` when they escape the monitor UI root.
- [ ] Static-serving tests assert encoded traversal requests under `/console/assets/` return status `404` when they escape the Console UI root.
- [ ] `GET /api/not-a-route` returns status `404`, a JSON content type, and no SPA marker body.
- [ ] Legacy monitor `Header` renders a link with accessible name matching `/Console/i`.
- [ ] The legacy monitor Console link has path `/console/`.
- [ ] README describes the Console as a preview at `/console/` and keeps legacy monitor at `/`.
- [ ] `docs/architecture.md` describes the daemon as hosting two project-local SPAs during the transition.
- [ ] Changed docs do not claim queue editing, stack-sync controls, multi-project Overseer behavior, or legacy monitor removal.
- [ ] `pnpm --filter @eforge-build/monitor-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor-ui build` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor build` exits 0 after both UI builds.
