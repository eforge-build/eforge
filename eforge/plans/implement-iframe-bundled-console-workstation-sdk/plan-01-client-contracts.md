---
id: plan-01-client-contracts
name: Add client-owned workstation bundle manifest schemas, route constants,
  browser exports, and daemon API version bump.
branch: implement-iframe-bundled-console-workstation-sdk/client-contracts
---

# Client Contracts

## Architecture Reference

This module implements the `client-contracts` implementation guide and the architecture sections `Shared data model`, `Client-owned routes`, and `Client contracts -> all consumers`.

Key constraints from architecture:
- `@eforge-build/client` owns daemon route constants, TypeBox wire schemas, public parse helpers, and browser-safe exports for Console consumers.
- Existing `srcDoc` workstation manifest entries remain valid and keep the same required fields that Console already consumes.
- Bundle-backed workstations are represented by a mutually exclusive `frameBundle` manifest variant; parent Console distinguishes modes by `srcDoc` versus `frameBundle` presence.
- Bundle asset ids use the shared deterministic format `sha256-<64-hex>-path-<64-hex>` and routes never model arbitrary browser-supplied filesystem paths.
- New frame and asset route constants are additive, but first-party Console relies on them, so `DAEMON_API_VERSION` must be bumped.
- The browser entrypoint must stay free of Node-only daemon, lockfile, and filesystem imports.

## Scope

### In Scope
- Add client-owned TypeBox schemas and exported TypeScript types for bundle-backed workstation manifest metadata.
- Convert `ConsoleWorkstationManifestEntrySchema` from a single object shape to a closed union of `srcDoc` and `frameBundle` variants.
- Add route constants for eforge-owned workstation frame and asset serving.
- Export new schemas, constants, and types from the browser-safe client entrypoint.
- Bump `DAEMON_API_VERSION` and update its hardcoded guard test.
- Extend client tests for route constants, old `srcDoc` acceptance, bundle manifest acceptance, mutual exclusion, asset id/hash validation, and browser exports.

### Out of Scope
- Extension source authoring types in `@eforge-build/extension-sdk`.
- Browser workstation SDK helpers in `@eforge-build/extension-sdk/browser`.
- Engine registration validation, trust hashing, asset id generation, or manifest projection logic.
- Monitor frame-shell or asset-serving handlers.
- Console iframe rendering changes.
- Documentation source or generated public docs updates.
- Package version changes.

## Implementation Approach

### Overview

Update `packages/client/src/extension-contributions.ts` to define the new workstation wire contract while keeping existing manifest parse helpers as the authoritative validation entrypoints. The workstation schema will become a union of two complete object variants that repeat common fields rather than using an intersected base object. This avoids TypeBox `additionalProperties: false` interactions where a shared base rejects variant-specific fields.

Add route constants to `API_ROUTES` beside the existing extension contribution and action routes. No new fetch helper is needed for frame or asset routes because the engine will place built URLs into the manifest and browsers will load those URLs directly.

Bump `DAEMON_API_VERSION` to `60` unless another concurrent change has already advanced it. If it has advanced, increment from the then-current value and preserve the new bundle workstation migration note as the first note in the version comment.

### Key Decisions

1. Use a closed TypeBox union with repeated common workstation fields. Each variant has `additionalProperties: false`, so entries with both `srcDoc` and `frameBundle`, entries with neither, and entries with stray workstation fields fail schema validation.
2. Keep the manifest mode discriminator implicit. `srcDoc` remains present only on the legacy variant, and `frameBundle` remains present only on the bundle variant, preserving the current manifest field name for existing Console code.
3. Require `frameBundle.browserSdkVersion` in the manifest as literal `1`. Source registration may omit the version, but engine projection is responsible for materializing version `1` before emitting the client-owned manifest.
4. Export an asset id pattern constant from client contracts. Downstream monitor code can import the same pattern used by the manifest schema instead of duplicating the `sha256-...-path-...` format.
5. Validate asset metadata shape in client schemas, not filesystem safety. Client schemas enforce wire shape, id/hash format, and required URL/reference fields; engine and monitor modules own source path validation and route containment.
6. Do not add specialized route-builder functions. Existing `buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId })` and `buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId, assetId })` satisfy the route ownership rule.
7. Do not edit `packages/client/src/index.ts` unless implementation reveals an export gap. The existing `export * from './extension-contributions.js'` already exposes new root-entrypoint symbols.

## Files

### Create
- None.

### Modify
- `packages/client/src/extension-contributions.ts` — add bundle workstation constants, schemas, and types; replace the current workstation object schema with the `srcDoc`/`frameBundle` union `[region: client-contracts, workstation manifest schema/type declarations]`.
  - Add exported constants for the v1 workstation browser SDK manifest version and asset id regex, for example names in the style of `CONSOLE_WORKSTATION_BROWSER_SDK_VERSION` and `CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN`.
  - Add schemas for asset refs and frame bundle metadata: asset `id`, `url`, `relativePath`, `sha256`, `browserSdkVersion`, `frameUrl`, `entrypoint`, `styles`, and `assets`.
  - Add explicit variant schemas and types for `ConsoleWorkstationSrcDocManifestEntry` and `ConsoleWorkstationFrameBundleManifestEntry`.
  - Keep `allowedActions` required and unchanged in both variants.
  - Keep `ExtensionContributionManifestResponseSchema.consoleWorkstations` as an array of `ConsoleWorkstationManifestEntrySchema`.
  - Keep existing parse/safe-parse function names unchanged.
- `packages/client/src/routes/route-map.ts` — add `extensionWorkstationFrame` and `extensionWorkstationAsset` route constants next to the existing extension contribution routes `[region: client-contracts, extension route constants]`.
  - Use exact patterns `/api/extensions/workstations/:workstationId/frame` and `/api/extensions/workstations/:workstationId/assets/:assetId`.
- `packages/client/src/api-version-const.ts` — bump the constant and prepend a migration note `[region: client-contracts, DAEMON_API_VERSION constant and comment]`.
  - New note must state that the bump gates bundle workstation manifest metadata plus eforge-owned workstation frame/asset routes for first-party clients.
- `packages/client/src/browser.ts` — add browser-safe exports for the new workstation constants, schemas, and types in the existing extension-contributions export blocks `[region: client-contracts, extension contribution browser exports]`.
  - Export only from `./extension-contributions.js`; do not introduce imports from `daemon-client`, `lockfile`, `api-version.js`, `node:*`, monitor, engine, or Console packages.
- `packages/client/src/__tests__/extension-contributions.test.ts` — extend manifest and route contract tests.
  - Keep the current manifest fixture using `srcDoc` as the default compatibility fixture.
  - Add a bundle workstation fixture with `frameBundle.browserSdkVersion: 1`, a `frameUrl`, an `entrypoint` asset ref, one CSS style asset ref, and one additional asset ref.
  - Add rejection cases for both source fields, neither source field, missing `browserSdkVersion`, unsupported `browserSdkVersion`, malformed asset id, malformed `sha256`, missing `entrypoint`, non-array `styles`, non-array `assets`, and extra fields inside `frameBundle` or asset refs.
  - Extend the route test to assert both new `API_ROUTES` entries and `buildPath()` encoding for a workstation id containing `:`.
  - Add a browser export smoke assertion by importing at least one new schema or constant from `../browser.js` and comparing it with the source export.
- `test/daemon-api-version.test.ts` — update the hardcoded version assertion and test name to the new version and bundle workstation rationale.

## Shared Files and Edit Region Markers

The architecture registry assigns all planned client files to this module as single-owner edits. No other module is expected to modify the same source files during this expedition, so no temporary `plan-\d{2}-...` source markers are required. The `[region: client-contracts, ...]` annotations above identify bounded edit locations for any parallel build coordination.

## Testing Strategy

### Unit Tests
- `packages/client/src/__tests__/extension-contributions.test.ts`
  - Route constants and `buildPath()` output for frame and asset routes.
  - Existing full contribution manifest with a `srcDoc` workstation validates successfully.
  - Full contribution manifest with a `frameBundle` workstation validates successfully.
  - Workstation manifest variants reject both/neither source fields and unexpected properties.
  - Bundle manifest metadata rejects malformed asset ids, malformed content hashes, missing required fields, and unsupported browser SDK versions.
  - Browser entrypoint re-exports at least one new schema/constant by identity.
- `test/daemon-api-version.test.ts`
  - Hardcoded version guard expects the new `DAEMON_API_VERSION` value and names the bundle workstation feature gate.

### Integration Tests
- No daemon integration route test belongs to this module. Existing root tests that exercise `verifyApiVersion()` continue to use the exported constant and will cover the stale-daemon mismatch path after the bump.
- `pnpm type-check` verifies that `@eforge-build/client` root and browser barrels expose the new public types without manual redeclaration in consumers.

## Verification

- [ ] `safeParseExtensionContributionManifest(srcDocManifest).success` returns `true` for the existing `srcDoc` workstation fixture.
- [ ] `safeParseExtensionContributionManifest(bundleManifest).success` returns `true` for a fixture with `frameBundle.browserSdkVersion: 1`, frame URL, entrypoint, styles, assets, and allowed actions.
- [ ] A workstation entry containing both `srcDoc` and `frameBundle` returns `success: false`.
- [ ] A workstation entry containing neither `srcDoc` nor `frameBundle` returns `success: false`.
- [ ] A bundle asset id outside `^sha256-[a-f0-9]{64}-path-[a-f0-9]{64}$` returns `success: false`.
- [ ] A bundle asset `sha256` outside `^[a-f0-9]{64}$` returns `success: false`.
- [ ] A bundle manifest with `browserSdkVersion: 2` returns `success: false`.
- [ ] `API_ROUTES.extensionWorkstationFrame` equals `/api/extensions/workstations/:workstationId/frame`.
- [ ] `API_ROUTES.extensionWorkstationAsset` equals `/api/extensions/workstations/:workstationId/assets/:assetId`.
- [ ] `buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'demo:board' })` contains `demo%3Aboard`.
- [ ] `DAEMON_API_VERSION` equals `60` unless a concurrent module has already advanced the value; in that case it equals the next integer and the newest migration note mentions bundle workstation manifests and frame/asset routes.
- [ ] `packages/client/src/browser.ts` import/export lines contain none of `daemon-client`, `lockfile`, `./api-version.js`, `node:`, `packages/console-ui`, or `@eforge-build/console-ui`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- packages/client/src/__tests__/extension-contributions.test.ts test/daemon-api-version.test.ts` exits 0, or `pnpm test` exits 0 when targeted Vitest paths are not supported.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["api"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
