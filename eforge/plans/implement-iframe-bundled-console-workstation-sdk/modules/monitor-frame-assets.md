# Monitor Frame Assets

## Architecture Reference

This module implements the `monitor-frame-assets` implementation guide plus the architecture sections `Client-owned routes`, `Frame shell and bridge contract`, `Engine manifest/trust -> monitor serving`, and `Monitor serving -> Console rendering`.

Key constraints from architecture:
- `@eforge-build/client` owns the workstation frame and asset route constants, workstation manifest wire schemas, and asset-id pattern. Monitor route source must not inline `/api/...` literals or redeclare client-owned response shapes.
- `engine-registration-manifest-trust` owns validated workstation registrations and the shared asset catalog/id lookup algorithm. Monitor must use the exported engine helper for asset lookup instead of deriving paths from browser request parameters.
- Bundle workstation frames are eforge-owned generated HTML shells served by the daemon. The bridge token is read by frame JavaScript from `location.hash`; the route must not require the token in path or query parameters.
- Bundle assets are served only by stable content-addressed asset ids that map back to validated registration metadata. The browser never supplies a filesystem-relative path.
- Asset serving must enforce MIME mapping, immutable cache headers, missing-file rejection, symlink rejection, realpath containment, and hash/id consistency at send time.
- Frame shell responses use no-cache semantics and a restrictive CSP that permits the nonce-bearing bridge bootstrap plus same-origin declared script/style assets.
- Existing `srcDoc` workstations are not served by the new frame route; they continue through the Console `srcDoc` renderer owned by `console-workstation-rendering`.

This module depends on `client-contracts` for `API_ROUTES.extensionWorkstationFrame`, `API_ROUTES.extensionWorkstationAsset`, client manifest types, and the client-owned bundle asset id pattern. It depends on `engine-registration-manifest-trust` for `findConsoleWorkstationBundleAsset()` and the catalog shape returned by that helper. `console-workstation-rendering` consumes the `frameBundle.frameUrl` that these routes serve.

## Scope

### In Scope
- Add monitor GET routes for eforge-owned bundle workstation frame shells and declared bundle assets.
- Register the new route keys in the extension content route aggregation and route ownership tests.
- Generate frame shell HTML from client-owned bundle manifest metadata.
- Install the v1 `window.eforge` bridge bootstrap in the frame shell.
- Read the bridge token from `location.hash` inside the frame shell bootstrap.
- Load the declared CSS styles and primary JavaScript entrypoint from manifest asset URLs.
- Send frame shell responses with `Content-Security-Policy`, `Cache-Control: no-cache`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer` headers.
- Serve declared bundle assets through stable asset ids returned by the engine catalog helper.
- Reject malformed asset ids, unknown workstation ids, non-bundle workstation ids, undeclared asset ids, missing files, path traversal-shaped ids, malformed percent encoding, symlink escapes, and realpath escapes.
- Reuse monitor HTTP response helpers and shared MIME mappings instead of duplicating JSON/text response helpers.
- Keep engine extension imports lazy inside route services so existing source-contract tests keep extension discovery behind service functions.

### Out of Scope
- Client TypeBox schemas, route constants, browser exports, or daemon API version changes.
- Extension SDK source registration types or `@eforge-build/extension-sdk/browser`.
- Engine validation, manifest projection, asset id generation, or trust hashing.
- Console iframe rendering, fragment URL construction, parent bridge validation, or React tests.
- Documentation source or generated public docs updates.
- Extension-owned HTTP routes, frontend package installation/build pipelines, parent-Console plugin loading, or direct Console React/component imports.

## Implementation Approach

### Overview

Add a focused extension workstation route module under `packages/monitor/src/routes/extensions/`. The route module registers two GET endpoints using client-owned route keys:

- `extensionWorkstationFrame` returns generated HTML for a bundle workstation frame shell.
- `extensionWorkstationAsset` returns declared bundle asset bytes by stable asset id.

Frame serving loads the contribution runtime through the existing `loadContributionRuntime(context)` service, finds the selected `frameBundle` manifest entry by `ctx.params.workstationId`, and renders the shell from that manifest entry. The frame shell includes a nonce-bearing inline bootstrap before the module entrypoint script, so bundle JavaScript can call `window.eforge.invokeAction()` immediately after loading.

Asset serving validates the asset id against the client-owned asset-id pattern before loading extension runtime. It then dynamically imports `findConsoleWorkstationBundleAsset()` from `@eforge-build/engine/extensions/index`, passes the runtime registry plus route params, and serves only the returned asset path. A new monitor HTTP helper performs a second lstat/realpath containment check and reads the file for the response. The helper compares the served content SHA-256 to the catalog asset hash so an old immutable URL does not serve changed file content after a race or mutation.

The new route module is added to `createExtensionRoutes()`, and both route keys are added to `EXTENSION_CONTENT_ROUTE_KEYS`. Existing monitor route registration and source-contract tests then cover route ownership, method, security declaration, route-key coverage, and the no-embedded-`/api/` discipline.

### Key Decisions

1. Use generated HTML rather than extension-authored HTML for bundle mode. The daemon controls the bootstrap, CSP, declared asset tags, and cache behavior.
2. Use a nonce-based CSP for the inline bridge bootstrap. The CSP will include `script-src 'self' 'nonce-<nonce>'`, `style-src 'self'`, `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'self'`, `img-src 'self' data: blob:`, `font-src 'self' data:`, and `connect-src 'none'`.
3. Keep `window.parent.postMessage(..., '*')` in the frame bootstrap to match the existing `srcDoc` bridge behavior. Parent Console still validates the source window, bridge token, JSON-object input, and allowed action id.
4. Reject non-record action input in the frame bootstrap instead of coercing it. Omitted input becomes `{}`, but strings, arrays, `null`, and other non-record values reject before `postMessage`.
5. Protect frame reads with `localOnly()` plus `rejectCrossSiteBrowser()`. Protect asset reads with `localOnly()` only, because declared CSS/JS subresource requests originate from a sandboxed iframe without `allow-same-origin` and can carry opaque-origin fetch metadata in some browsers.
6. Map malformed asset ids to HTTP 400 and unknown/undeclared/non-bundle/missing/escape cases to HTTP 404 with generic text bodies. Do not leak extension absolute paths in route responses.
7. Validate content hash at send time. If the catalog says `asset.sha256` but the bytes read for the response hash to another value, return 404 so immutable content-addressed URLs do not serve mutable content.
8. Keep new implementation files under 600 lines and avoid expanding `server.ts` or the top-level router.

## Files

### Create
- `packages/monitor/src/http/contained-static-file.ts` — shared monitor helper for serving an already-resolved file under a containing root.
  - Export `sendContainedStaticFile({ res, rootDir, filePath, cacheControl, expectedSha256 })`.
  - Import `MIME_TYPES` from `./static-assets.js` and `sendText` from `./response.js`.
  - Use `lstat()` to reject a final-path symlink and non-file targets.
  - Use `realpath(rootDir)`, `realpath(filePath)`, and `relative()`/`isAbsolute()` to reject realpath escapes.
  - Use `readFile()` for response content, set `Content-Length`, `Cache-Control`, `X-Content-Type-Options: nosniff`, and the MIME type derived from the file extension.
  - When `expectedSha256` is provided, compute SHA-256 over the bytes being sent and return 404 on mismatch.
  - Return 404 for missing files, non-files, symlinks, realpath escapes, and hash mismatches; return 500 for unexpected read errors after containment checks.
- `packages/monitor/src/routes/extensions/workstation-frame-shell.ts` — pure frame-shell HTML/CSP generation.
  - Export `buildWorkstationFrameShell(workstation, nonce)` and `buildWorkstationFrameCsp(nonce)`.
  - Accept only the imported client-owned bundle workstation manifest type, for example `ConsoleWorkstationFrameBundleManifestEntry` or `Extract<ConsoleWorkstationManifestEntry, { frameBundle: unknown }>` from `@eforge-build/client`.
  - Escape all HTML text and attribute values.
  - Add `<link rel="stylesheet" href="...">` tags for `frameBundle.styles` in manifest order.
  - Add a nonce-bearing inline bootstrap that reads `bridgeToken` from `new URLSearchParams(window.location.hash.slice(1))`, installs `window.eforge = Object.freeze({ version: 1, invokeAction })`, rejects invalid `actionId`/input, tracks pending requests by id, and resolves/rejects on `eforge:workstation:action-result` messages.
  - Add `<script type="module" src="..."></script>` for `frameBundle.entrypoint.url` after the bootstrap.
- `packages/monitor/src/routes/extensions/workstations.ts` — route registration and handlers for bundle workstation frames/assets.
  - Export `createExtensionWorkstationRoutes(context)`.
  - Register `extensionWorkstationFrame` and `extensionWorkstationAsset` with `defineRoute()` and client-owned route keys.
  - Generate a per-response nonce with `randomBytes(16).toString('base64')` for frame shell responses.
  - Use `loadContributionRuntime(context)` from `contribution-service.js` for both routes.
  - For frame requests, find a manifest entry whose `id` equals `ctx.params.workstationId` and that has `frameBundle`; return 404 for missing ids or `srcDoc` entries.
  - For asset requests, validate `ctx.params.assetId` against the client-owned bundle asset id pattern before loading runtime.
  - Dynamically import `findConsoleWorkstationBundleAsset()` from `@eforge-build/engine/extensions/index` inside the asset handler.
  - Call `sendContainedStaticFile()` with the returned catalog root, returned asset absolute path, immutable cache header, and returned asset SHA-256.
  - Do not import `@eforge-build/engine/extensions/index` at module top level.
- `packages/monitor/src/__tests__/routes-extension-workstation-assets.test.ts` — focused integration tests for frame and asset routes.
  - Seed a directory-layout extension with `workstation-assets/board/index.js`, `style.css`, `logo.svg`, and an action allowed by the workstation.
  - Fetch `API_ROUTES.extensionContributionManifest` to discover `frameBundle.frameUrl` and asset URLs.
  - Assert frame HTML, CSP, no-cache, bootstrap, fragment-token parsing text, stylesheet tag, and module entrypoint tag.
  - Assert asset response bytes, MIME types, immutable cache headers, malformed-id rejection, malformed percent encoding rejection, traversal-shaped id rejection, unknown-id rejection, missing-file rejection, symlink rejection, and realpath-escape rejection.

### Modify
- `packages/monitor/src/routes/extensions/index.ts` — include workstation frame/asset routes in the extension route group `[region: monitor-frame-assets, extension route aggregation]`.
  - Import `createExtensionWorkstationRoutes` from `./workstations.js`.
  - Add `...createExtensionWorkstationRoutes(context)` immediately after `...createExtensionContributionRoutes(context)` so contribution manifest, action bridge, and workstation content routes stay adjacent.
- `packages/monitor/src/routes/extension-content.ts` — add new route keys to the extension content route registry `[region: monitor-frame-assets, extension content route keys]`.
  - Add `'extensionWorkstationFrame'` and `'extensionWorkstationAsset'` after `'extensionContributionManifest'`/`'extensionActionInvoke'`.
- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts` — update route registration expectations.
  - Add the two new route keys to `EXPECTED_ROUTE_KEYS` in the same order used by `EXTENSION_CONTENT_ROUTE_KEYS`.
  - Change the expected count from 36 to 38.
  - Add both keys to `GET_ROUTE_KEYS`.
  - Add both keys to `SECURED_ROUTE_KEYS`.
  - Keep the assertion that every route pattern equals `API_ROUTES[route.routeKey]`.

## Shared Files and Edit Region Markers

The architecture registry assigns `packages/monitor/src/routes/extension-content.ts` and `packages/monitor/src/routes/extensions/index.ts` to this module. The `Files > Modify` entries above include `[region: monitor-frame-assets, ...]` annotations for bounded build coordination.

`packages/monitor/src/http/static-assets.ts` is not modified by this plan. The module creates `packages/monitor/src/http/contained-static-file.ts` instead, so the existing Console static UI serving code remains untouched.

No temporary `plan-\d{2}-...` source markers are required because no planned source file is split with another module. If a later split assigns another module to one of these files, use non-overlapping cleanup-targeted markers with the compiled plan id format, for example `// --- eforge:region plan-04-monitor-frame-assets ---` and `// --- eforge:endregion plan-04-monitor-frame-assets ---`.

## Testing Strategy

### Unit Tests
- `packages/monitor/src/routes/extensions/workstation-frame-shell.ts`
  - Frame shell builder output contains the nonce on the inline bootstrap and the same nonce in the CSP string.
  - Frame shell builder escapes workstation titles and asset URLs in HTML contexts.
  - Frame shell builder emits stylesheet links in manifest order and a module script for the entrypoint.
  - Bootstrap source contains `location.hash`, `bridgeToken`, `window.eforge`, `version: 1`, `invokeAction`, and the existing bridge message type strings.
- `packages/monitor/src/http/contained-static-file.ts`
  - Covered through route tests. Add direct helper tests only if route tests cannot exercise hash mismatch or realpath containment deterministically.

### Integration Tests
- `packages/monitor/src/__tests__/routes-extension-workstation-assets.test.ts`
  - Frame route serves generated HTML for a bundle workstation and returns 404 for a legacy `srcDoc` workstation.
  - Frame response headers include `Content-Type: text/html`, `Cache-Control: no-cache`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
  - Frame body contains no bridge token when fetched with a URL fragment such as `#bridgeToken=secret-token`.
  - Asset route serves JavaScript with `application/javascript` and CSS with `text/css`.
  - Asset route serves `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`.
  - Asset route rejects invalid asset ids before loading extension runtime.
  - Asset route rejects valid-format but undeclared ids after runtime lookup.
  - Asset route returns 404 when a declared asset is deleted after manifest discovery.
  - Asset route returns 404 when a declared final path is replaced with a symlink.
  - Asset route returns 404 when a declared asset path resolves through a symlinked parent directory outside the bundle root.
  - Route security rejects non-loopback Host headers for frame and asset requests.
- Existing route coverage tests:
  - `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts` verifies route-key ownership, method, and security declarations.
  - `packages/monitor/src/__tests__/routes-index-coverage.test.ts` verifies every client route key is registered by monitor.
  - `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` verifies route modules contain no `/api/...` literals, no duplicated response helpers, no client-owned response shape declarations, and no static engine extension imports.

## Verification

- [ ] `createExtensionContentRoutes(context)` includes `extensionWorkstationFrame` and `extensionWorkstationAsset` exactly once.
- [ ] `EXTENSION_CONTENT_ROUTE_KEYS` contains 38 entries after adding the two workstation routes.
- [ ] `routeMethodsByKey(routes).get('extensionWorkstationFrame')` equals `'GET'`.
- [ ] `routeMethodsByKey(routes).get('extensionWorkstationAsset')` equals `'GET'`.
- [ ] Every registered workstation route has `route.pattern === API_ROUTES[route.routeKey]`.
- [ ] A bundle workstation frame URL from the contribution manifest returns HTTP 200.
- [ ] A legacy `srcDoc` workstation id on the frame route returns HTTP 404.
- [ ] A missing workstation id on the frame route returns HTTP 404.
- [ ] A frame response header `cache-control` equals `no-cache`.
- [ ] A frame response header `content-security-policy` contains `default-src 'none'`, `script-src 'self' 'nonce-`, `style-src 'self'`, and `frame-ancestors 'self'`.
- [ ] A frame response header `x-content-type-options` equals `nosniff`.
- [ ] A frame response header `referrer-policy` equals `no-referrer`.
- [ ] A frame response body contains `location.hash`, `bridgeToken`, `window.eforge`, `version: 1`, and `eforge:workstation:invoke-action`.
- [ ] A frame response body contains a stylesheet link for each manifest `frameBundle.styles[].url`.
- [ ] A frame response body contains a module script tag for `frameBundle.entrypoint.url`.
- [ ] A frame request URL with `#bridgeToken=secret-token` returns a response body that does not contain `secret-token`.
- [ ] A JavaScript asset URL from the manifest returns HTTP 200 with `content-type` containing `application/javascript`.
- [ ] A CSS asset URL from the manifest returns HTTP 200 with `content-type` containing `text/css`.
- [ ] An asset response header `cache-control` equals `public, max-age=31536000, immutable`.
- [ ] An asset response header `x-content-type-options` equals `nosniff`.
- [ ] An asset route request with an asset id not matching the client-owned pattern returns HTTP 400.
- [ ] An asset route request with malformed percent encoding returns HTTP 400.
- [ ] An asset route request with an encoded traversal-shaped asset id returns HTTP 400.
- [ ] An asset route request with a valid-format undeclared asset id returns HTTP 404.
- [ ] An asset route request for a missing declared asset returns HTTP 404.
- [ ] An asset route request for a declared asset replaced by a symlink returns HTTP 404.
- [ ] An asset route request for a declared asset reached through a symlinked parent directory outside the bundle root returns HTTP 404.
- [ ] An asset route request for a declared asset whose bytes no longer match the requested content hash returns HTTP 404.
- [ ] Frame and asset route responses do not include extension absolute filesystem paths in their text bodies.
- [ ] `packages/monitor/src/routes/extensions/*.ts` contains no static import from `@eforge-build/engine/extensions/index`.
- [ ] `packages/monitor/src/routes/**/*.ts` contains no string literal matching `/api/` outside imports from client route constants.
- [ ] `pnpm test -- packages/monitor/src/__tests__/routes-extension-workstation-assets.test.ts packages/monitor/src/__tests__/routes-extension-content-registration.test.ts packages/monitor/src/__tests__/routes-index-coverage.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` exits 0, or `pnpm test` exits 0 when targeted Vitest paths are not supported.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
