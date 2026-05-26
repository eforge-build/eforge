# Static Serving and Package Integration

## Architecture Reference

This module implements the **Static Serving and Package Integration Contract** from the architecture and completes the hosting/package side of the Console transition. The `console-shell` module creates `packages/console-ui`; this module wires that package into the monitor daemon build, serves it at `/console/`, adds cross-links between the two SPAs, updates root/package scripts and dependencies, adds server/navigation tests, and records a short documentation note.

Key constraints from architecture:
- Keep the legacy monitor UI available at `/` from `dist/monitor-ui`.
- Serve the new Console UI at `/console/` from `dist/console-ui`.
- Preserve API routing priority: unknown `/api/...` routes return JSON 404 and never fall through to SPA assets.
- Preserve static-serving path traversal protection, asset 404 behavior, hashed asset cache headers, and SPA fallback behavior for both roots.
- Console asset URLs are scoped by `packages/console-ui/vite.config.ts` `base: '/console/'`; server routing must map `/console/assets/...` to the Console dist.
- The two SPAs are independent transitional hosts. The legacy monitor links to `/console/`; the Console shell already links back to `/`.
- Monitor packaging copies both UI dist directories when present without failing local monitor builds when a UI dist is absent.
- Root scripts preserve `dev:monitor` and add Console dev/build entry points.
- Documentation, if changed, describes **Eforge Console** as a transitional preview at `/console/` and does not claim queue editing, stack-sync controls, or Overseer behavior.

## Scope

### In Scope
- Add `@eforge-build/console-ui` as a workspace dependency where monitor packaging/build ordering needs it.
- Add root scripts for `dev:console` and `build:console-ui`; update `build:ui` so it builds both monitor UI and Console UI.
- Generalize `packages/monitor/src/server.ts` static serving for two SPA roots: `/` and `/console/`.
- Add test-only monitor server options for temporary UI dist directories so static-serving tests do not depend on checked-in or prebuilt `dist` content.
- Add static-serving tests covering root/Console index files, root/Console assets, asset 404s, SPA fallbacks, cache headers, and encoded traversal attempts.
- Update `packages/monitor/tsup.config.ts` to copy `../console-ui/dist` into `dist/console-ui` when present, while preserving the existing monitor UI copy.
- Add a visible, accessible legacy monitor header link or button to `/console/` with accessible name containing `Console`.
- Add or update monitor UI header tests for the Console link.
- Update README and architecture documentation with a short side-by-side Console preview note.
- Update `pnpm-lock.yaml` after package/dependency changes.

### Out of Scope
- Creating `packages/console-ui`; owned by `console-shell`.
- Changing Console components, routes, shell styling, daemon SSE hooks, or active-session subscription logic; owned by `console-shell` and view modules.
- Importing Console code into the legacy monitor UI.
- Reworking legacy monitor layout, state, reducers, or SSE architecture beyond adding the header link.
- Adding daemon API routes beyond static SPA hosting.
- Changing existing API route names or daemon wire shapes.
- Deleting, renaming, or replacing `packages/monitor-ui`.
- Implementing queue editing, priority editing, stack-sync controls, or Overseer/multi-project UI.

## Implementation Approach

### Overview

Treat static hosting as a small multi-root SPA router inside the existing monitor daemon. The HTTP request handler keeps the current API route dispatch unchanged. After all API route checks, it parses the request pathname and dispatches static requests under `/console` to `dist/console-ui`, while all other non-API requests continue to use `dist/monitor-ui`.

The current `serveStaticFile(req, res, urlPath)` helper is expanded to accept a `rootDir` and `basePath`. It strips the base path, decodes URL escapes before path resolution, resolves candidates within the selected root, and falls back to that root's `index.html` for non-asset misses. Asset paths return `404 Not Found` when absent. Asset responses keep `Cache-Control: public, max-age=31536000, immutable`; HTML and fallback responses keep `Cache-Control: no-cache`.

Tests use real HTTP against `startServer()` with temporary UI directories supplied through a test-only `uiDirs` option. This avoids depending on `packages/monitor-ui/dist` or `packages/console-ui/dist` in the repository checkout. The test fixtures include distinct marker text for the legacy index, Console index, and both asset roots so tests can prove the router selects the intended SPA.

The package/build graph changes are additive: monitor adds a devDependency on `@eforge-build/console-ui`, root adds the same workspace devDependency for script discoverability/topological build ordering, and `tsup` copies both UI dist folders only when present. Existing `dev:monitor` remains unchanged.

### Key Decisions

1. **Use a parameterized static helper instead of duplicating the legacy helper.** A single `serveStaticFile(req, res, pathname, rootDir, basePath)` path keeps traversal checks, asset 404 behavior, cache headers, and SPA fallback semantics identical for both SPAs.
2. **Dispatch `/console` and `/console/` to the Console index.** Links target `/console/`, but accepting `/console` avoids a blank response when users type the path without the slash. Generated Console assets still resolve through absolute `/console/assets/...` URLs from Vite.
3. **Use URL pathnames for static routing only.** Existing API route dispatch uses `req.url` with query strings because many handlers parse query strings directly. Static fallback receives `new URL(req.url ?? '/', 'http://localhost').pathname` after API handling, so query strings do not become filesystem path segments.
4. **Decode before containment checks.** Encoded traversal such as `%2e%2e` must be checked after decoding. Malformed percent-encoding returns `400 Bad Request` from static serving rather than reaching the filesystem.
5. **Use `path.relative()` containment checks.** A candidate path is inside the root only when `relative(root, candidate)` is `''` or does not start with `..` and is not absolute. This avoids prefix collisions such as `/tmp/ui` versus `/tmp/ui-evil`.
6. **Preserve copy-if-present behavior in `tsup`.** Monitor package builds in local development do not fail when a UI dist has not been built. Release/root builds gain ordering through workspace devDependencies and scripts.
7. **Add the legacy monitor link in `Header`.** The header is always rendered and already contains right-aligned operational controls; adding a compact outline/link-style `Button asChild` anchor there satisfies the transitional navigation requirement without changing sidebar state or routing.
8. **Update existing docs only.** README and `docs/architecture.md` already describe the web monitor; add one sentence each for the Console preview rather than creating a new doc page.

## Files

### Create
- `packages/monitor/src/__tests__/static-ui-serving.test.ts` — real HTTP tests for side-by-side static serving. Creates temporary `monitor-ui` and `console-ui` fixture directories with `index.html`, `assets/legacy.js`, and `assets/console.js`; starts `startServer(openDatabase(...), 0, { cwd, uiDirs })`; verifies status, body markers, content type, cache headers, asset 404s, SPA fallback, and encoded traversal attempts for both roots.

### Modify
- `packages/monitor/src/server.ts` — add `CONSOLE_UI_DIR`, define a named `StartServerOptions` interface that extends the existing inline options with `uiDirs?: { monitorUiDir?: string; consoleUiDir?: string }`, generalize `serveStaticFile`, dispatch `/console` and `/console/...` to the Console root, and pass all other non-API requests to the legacy root `[region: static-serving-package-integration, UI dir constants, startServer options type, static helper, final non-API static dispatch]`.
- `packages/monitor/tsup.config.ts` — refactor the current monitor UI copy block into a small `copyUiDist(source, target)` helper and call it for `../monitor-ui/dist -> dist/monitor-ui` and `../console-ui/dist -> dist/console-ui` `[region: static-serving-package-integration, onSuccess UI dist copy block]`.
- `packages/monitor/package.json` — add `"@eforge-build/console-ui": "workspace:*"` to `devDependencies` while preserving `@eforge-build/monitor-ui` `[region: static-serving-package-integration, devDependencies]`.
- `package.json` — add root `dev:console` and `build:console-ui` scripts, update `build:ui` to build both UI packages, and add root devDependency `"@eforge-build/console-ui": "workspace:*"` `[region: static-serving-package-integration, scripts and devDependencies]`.
- `packages/monitor-ui/src/components/layout/header.tsx` — add a compact anchor rendered via `Button asChild` with href `/console/` and accessible text such as `Open Console`; place it in the right-side header control group before `DaemonStatusPill` `[region: static-serving-package-integration, header right-side transitional Console link]`.
- `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx` — add a jsdom assertion that rendering `Header` exposes a link with accessible name matching `/Console/i` and `href` ending in `/console/`.
- `README.md` — add a short note near the existing web monitor description: the legacy monitor remains at `/`, and the Eforge Console preview is available at `/console/` on the same daemon port.
- `docs/architecture.md` — update the Monitor section to mention two hosted SPAs during the transition: `packages/monitor-ui` at `/` and `packages/console-ui` at `/console/`; keep the wording project-local.
- `pnpm-lock.yaml` — update importers and dependency entries after adding `@eforge-build/console-ui` to root and monitor package dependencies.

## Shared File Region Declarations

`packages/monitor/src/server.ts`:
```ts
// --- eforge:region static-serving-package-integration ---
const UI_DIR = resolve(__dirname, 'monitor-ui');
const CONSOLE_UI_DIR = resolve(__dirname, 'console-ui');

export interface StartServerOptions {
  strictPort?: boolean;
  cwd?: string;
  queueDir?: string;
  planOutputDir?: string;
  workerTracker?: WorkerTracker;
  daemonState?: DaemonState;
  config?: Pick<EforgeConfig, 'monitor' | 'agents' | 'prdQueue' | 'maxConcurrentBuilds'>;
  uiDirs?: {
    monitorUiDir?: string;
    consoleUiDir?: string;
  };
}
// --- eforge:endregion static-serving-package-integration ---
```

`packages/monitor/src/server.ts` static helper and dispatch:
```ts
// --- eforge:region static-serving-package-integration ---
async function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  rootDir: string,
  basePath: '/' | '/console',
): Promise<void> {
  // strip basePath, decode, containment-check, asset 404, SPA fallback, cache headers
}

// after all API routes:
const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
if (pathname === '/console' || pathname.startsWith('/console/')) {
  await serveStaticFile(req, res, pathname, consoleUiDir, '/console');
} else {
  await serveStaticFile(req, res, pathname, monitorUiDir, '/');
}
// --- eforge:endregion static-serving-package-integration ---
```

`packages/monitor/tsup.config.ts`:
```ts
// --- eforge:region static-serving-package-integration ---
async function copyUiDist(source: string, target: string): Promise<void> {
  if (existsSync(source)) {
    await cp(source, target, { recursive: true });
  }
}

await copyUiDist('../monitor-ui/dist', 'dist/monitor-ui');
await copyUiDist('../console-ui/dist', 'dist/console-ui');
// --- eforge:endregion static-serving-package-integration ---
```

`packages/monitor-ui/src/components/layout/header.tsx`:
```tsx
// --- eforge:region static-serving-package-integration ---
<Button asChild variant="outline" size="sm" className="h-7 text-xs">
  <a href="/console/" aria-label="Open Console">
    Console
  </a>
</Button>
// --- eforge:endregion static-serving-package-integration ---
```

`package.json` and `packages/monitor/package.json` are JSON shared files owned by this module in the architecture registry. No inline region markers can be inserted into JSON. The edits are constrained to the `scripts` and `devDependencies` object keys listed in the Files section.

`pnpm-lock.yaml` is shared with the `console-shell` module because that module creates `packages/console-ui`. The architecture registry does not declare a region for the lockfile, and lockfiles cannot use inline region markers. Boundary proposal: `console-shell` may add the new package importer and its direct package dependencies; this module regenerates the lockfile after adding root and monitor workspace dependency edges. If both modules run independently, regenerate `pnpm-lock.yaml` once after both package manifests have landed rather than hand-merging importer blocks.

## Static Serving Contract Details

### Routing Matrix

| Request path | Source root | Result |
| --- | --- | --- |
| `/` | `monitorUiDir` | `index.html`, `Cache-Control: no-cache` |
| `/index.html` | `monitorUiDir` | `index.html`, `Cache-Control: no-cache` |
| `/assets/<file>` | `monitorUiDir/assets` | file if present with immutable cache, otherwise 404 |
| `/some/spa/path` | `monitorUiDir` | legacy `index.html`, `Cache-Control: no-cache` |
| `/console` | `consoleUiDir` | Console `index.html`, `Cache-Control: no-cache` |
| `/console/` | `consoleUiDir` | Console `index.html`, `Cache-Control: no-cache` |
| `/console/index.html` | `consoleUiDir` | Console `index.html`, `Cache-Control: no-cache` |
| `/console/assets/<file>` | `consoleUiDir/assets` | file if present with immutable cache, otherwise 404 |
| `/console/runs` | `consoleUiDir` | Console `index.html`, `Cache-Control: no-cache` |
| `/api/unknown` | none | JSON 404 from existing API guard |

### Traversal Handling

Static resolution must:
- Strip the selected base path before filesystem resolution.
- Decode percent escapes before resolving.
- Reject malformed percent escapes with status `400` and a plain-text body.
- Resolve with `resolve(rootDir, '.' + relativePath)`.
- Verify containment using `relative(rootDir, candidate)` and `isAbsolute()`.
- Never read a file outside the selected UI root.
- For traversal/miss requests under an asset prefix, return `404`.
- For traversal/miss requests outside an asset prefix, serve the selected root's `index.html` as the SPA fallback.

## Testing Strategy

### Unit Tests
- `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx`:
  - Render `Header` with the existing fixture props.
  - Assert `screen.getByRole('link', { name: /Console/i })` exists.
  - Assert `new URL(link.href).pathname` equals `/console/` or the raw `href` attribute equals `/console/`.

### Integration Tests
- `packages/monitor/src/__tests__/static-ui-serving.test.ts`:
  - Create a temporary working directory with `.eforge/monitor.db` and a temporary UI fixture root with separate `monitor-ui` and `console-ui` folders.
  - Start a real monitor server with `startServer(db, 0, { cwd, uiDirs: { monitorUiDir, consoleUiDir } })`.
  - Fetch `GET /` and `GET /index.html`; assert status `200`, body contains the legacy marker, body does not contain the Console marker, and cache header equals `no-cache`.
  - Fetch `GET /assets/legacy.js`; assert status `200`, body contains the legacy asset marker, and cache header equals `public, max-age=31536000, immutable`.
  - Fetch `GET /assets/missing.js`; assert status `404` and body contains `Not Found`.
  - Fetch `GET /console/` and `GET /console/index.html`; assert status `200`, body contains the Console marker, body does not contain the legacy marker, and cache header equals `no-cache`.
  - Fetch `GET /console/assets/console.js`; assert status `200`, body contains the Console asset marker, and cache header equals `public, max-age=31536000, immutable`.
  - Fetch `GET /console/assets/missing.js`; assert status `404` and body contains `Not Found`.
  - Fetch a legacy SPA route such as `/queue/deep/link`; assert the legacy index marker is returned.
  - Fetch a Console SPA route such as `/console/runs/deep/link`; assert the Console index marker is returned.
  - Place a sentinel file outside both UI roots. Fetch encoded traversal paths such as `/%2e%2e/secret.txt`, `/console/%2e%2e/secret.txt`, `/assets/%2e%2e/%2e%2e/secret.txt`, and `/console/assets/%2e%2e/%2e%2e/secret.txt`; assert response body never contains the sentinel text and asset-prefixed traversal returns `404`.
  - Fetch an unknown API route such as `/api/not-a-route`; assert status `404`, content type includes `application/json`, and neither index marker appears.
- `packages/monitor/tsup.config.ts` copy behavior:
  - Prefer verification through `pnpm --filter @eforge-build/monitor build` after both UIs are built.
  - If direct testing is added, isolate it to a small helper exported from the config only if the current tsup config can support that without side effects. Do not add a brittle test that executes the entire package build inside Vitest.

### Build and Type Checks
- Run `pnpm --filter @eforge-build/monitor-ui type-check` after adding the header link.
- Run `pnpm --filter @eforge-build/monitor type-check` after changing server options/static serving.
- Run `pnpm --filter @eforge-build/console-ui build` to generate Console dist for package-copy verification.
- Run `pnpm --filter @eforge-build/monitor-ui build` to generate legacy monitor dist for package-copy verification.
- Run `pnpm --filter @eforge-build/monitor build` and verify both `packages/monitor/dist/monitor-ui/index.html` and `packages/monitor/dist/console-ui/index.html` exist when both UI dists exist.

## Verification

- [ ] `package.json` contains `dev:console` with command `pnpm --filter @eforge-build/console-ui dev`.
- [ ] `package.json` contains `build:console-ui` with command `pnpm --filter @eforge-build/console-ui build`.
- [ ] `package.json` preserves `dev:monitor` with command `pnpm --filter @eforge-build/monitor-ui dev`.
- [ ] `package.json` `build:ui` invokes builds for both `@eforge-build/monitor-ui` and `@eforge-build/console-ui`.
- [ ] Root `devDependencies` contains `"@eforge-build/console-ui": "workspace:*"`.
- [ ] `packages/monitor/package.json` `devDependencies` contains `"@eforge-build/console-ui": "workspace:*"`.
- [ ] `packages/monitor/tsup.config.ts` copies `../monitor-ui/dist` to `dist/monitor-ui` when `../monitor-ui/dist` exists.
- [ ] `packages/monitor/tsup.config.ts` copies `../console-ui/dist` to `dist/console-ui` when `../console-ui/dist` exists.
- [ ] `packages/monitor/src/server.ts` defines `CONSOLE_UI_DIR = resolve(__dirname, 'console-ui')`.
- [ ] `startServer` accepts `uiDirs.monitorUiDir` and `uiDirs.consoleUiDir` for tests.
- [ ] `GET /` returns the legacy monitor fixture `index.html` in `static-ui-serving.test.ts`.
- [ ] `GET /index.html` returns the legacy monitor fixture `index.html` in `static-ui-serving.test.ts`.
- [ ] `GET /assets/legacy.js` returns the legacy asset fixture and `Cache-Control: public, max-age=31536000, immutable`.
- [ ] `GET /assets/missing.js` returns status `404`.
- [ ] `GET /console/` returns the Console fixture `index.html` in `static-ui-serving.test.ts`.
- [ ] `GET /console/index.html` returns the Console fixture `index.html` in `static-ui-serving.test.ts`.
- [ ] `GET /console/assets/console.js` returns the Console asset fixture and `Cache-Control: public, max-age=31536000, immutable`.
- [ ] `GET /console/assets/missing.js` returns status `404`.
- [ ] `GET /queue/deep/link` returns the legacy monitor fixture `index.html`.
- [ ] `GET /console/runs/deep/link` returns the Console fixture `index.html`.
- [ ] Encoded traversal requests under `/` do not return sentinel file contents from outside the monitor UI root.
- [ ] Encoded traversal requests under `/console/` do not return sentinel file contents from outside the Console UI root.
- [ ] Encoded traversal requests under `/assets/` return status `404` when they escape the monitor UI root.
- [ ] Encoded traversal requests under `/console/assets/` return status `404` when they escape the Console UI root.
- [ ] `GET /api/not-a-route` returns JSON status `404` and does not return either SPA index fixture.
- [ ] Legacy monitor `Header` renders a link with accessible name matching `/Console/i`.
- [ ] The legacy monitor Console link has `href="/console/"`.
- [ ] `pnpm --filter @eforge-build/monitor-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor-ui build` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor build` exits 0 after both UI builds.
- [ ] `packages/monitor/dist/monitor-ui/index.html` exists after a monitor build when `packages/monitor-ui/dist/index.html` exists.
- [ ] `packages/monitor/dist/console-ui/index.html` exists after a monitor build when `packages/console-ui/dist/index.html` exists.
- [ ] README text mentions Eforge Console preview at `/console/` and legacy monitor at `/`.
- [ ] Changed docs contain no claims for queue editing, priority editing, stack-sync controls, Overseer, multi-project, or multi-daemon Console behavior.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
