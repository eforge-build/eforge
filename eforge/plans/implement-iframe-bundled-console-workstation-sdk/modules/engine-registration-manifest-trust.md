# Engine Registration Manifest Trust

## Architecture Reference

This module implements the `engine-registration-manifest-trust` implementation guide and the architecture sections `Source registration shape`, `Client-owned manifest shape`, `Engine manifest/trust -> monitor serving`, and `Shared data model`.

Key constraints from architecture:
- Runtime validation in the engine is the authority for workstation source-mode exclusivity, safe `frameBundle` paths, conventional `workstation-assets/` roots, and browser SDK version support.
- Existing `srcDoc` workstation registrations remain valid, retain existing allowed-action semantics, and still project as `srcDoc` manifest entries.
- Bundle workstation manifest projection must use client-owned schemas, route constants, and browser SDK version constants introduced by `client-contracts`.
- Bundle asset ids must use the shared deterministic format `sha256-<content-sha256>-path-<relative-path-sha256>`.
- Bundle asset URLs and frame URLs must be built with `API_ROUTES` + `buildPath()`; engine code must not inline `/api/...` route strings.
- Bundle roots are limited to `workstation-assets` or a child directory under `workstation-assets/` so project-team trust hashing covers served browser assets.
- Trust hashing must include browser bundle files under `workstation-assets/`, keep broad `dist/` excluded, keep symlink rejection, and keep deterministic path/content hashing.
- Monitor frame/asset serving depends on this module for the same asset catalog and lookup algorithm used by manifest projection.

## Scope

### In Scope
- Add engine-side source types for `ConsoleWorkstationFrameBundleSpec` and `srcDoc`/`frameBundle` workstation variants.
- Validate exactly one workstation source mode at registration time.
- Validate `frameBundle.root`, `entrypoint`, `styles`, `assets`, and `browserSdkVersion` with deterministic diagnostics.
- Add shared lexical path helpers for workstation bundle roots and bundle-relative asset paths.
- Generate bundle workstation manifest metadata with frame route URLs and declared asset refs.
- Generate asset ids from file content SHA-256 plus normalized bundle-relative path SHA-256.
- Dedupe duplicate declared asset paths deterministically across entrypoint, styles, and additional assets.
- Add engine asset catalog and lookup helpers for downstream monitor route handlers.
- Include all regular files under `workstation-assets/` in directory extension trust hashes.
- Preserve existing directory hash behavior for `package.json`, source files, top-level `dist/`, `node_modules/`, `.git/`, and symlink rejection.
- Add tests for validation, manifest projection, asset id generation, asset lookup, and hashing behavior.

### Out of Scope
- Client TypeBox schemas, route constants, and daemon API version bump; the `client-contracts` module owns those files.
- Author-facing extension SDK types and `@eforge-build/extension-sdk/browser`; the `extension-sdk-api` module owns those files.
- Monitor HTTP route handlers, CSP headers, MIME headers, cache headers, and static asset responses.
- Console iframe rendering, bridge token fragment handling, and workstation React tests.
- Documentation and generated public docs.
- Dogfood/example workstation changes.
- Frontend package install, build, watch, update, or removal workflows.

## Implementation Approach

### Overview

Add two focused engine helpers and keep existing large files on bounded edits:

1. `workstation-bundle-paths.ts` owns pure source-path validation and normalization for bundle roots and bundle-relative paths.
2. `workstation-assets.ts` owns filesystem resolution, asset catalog construction, content hashing, manifest frame/asset URL construction, and route lookup helpers for monitor consumers.

`contribution-validation.ts` calls the path helper during `registerConsoleWorkstation()` validation. `manifest.ts` uses the asset helper to project bundle registrations into the client-owned manifest union. `hash.ts` treats `workstation-assets/` as a hash-included root and hashes every regular file below it, including CSS/images/JS and nested directories that would otherwise be skipped outside that root.

The implementation keeps `buildExtensionContributionManifest()` synchronous by using synchronous filesystem reads inside the asset catalog helper. If a bundle asset cannot be cataloged during manifest projection, the manifest builder records an `extension:invalid-workstation-bundle` diagnostic for that workstation and omits the invalid bundle entry from `consoleWorkstations`; `srcDoc` entries continue to project unchanged.

### Key Decisions

1. Use a dedicated pure path helper instead of duplicating path checks in validation, manifest projection, and monitor lookup. This keeps source validation and catalog lookup aligned.
2. Reject `.` segments, `..` segments, empty segments, absolute paths, backslashes, null bytes, and Windows drive-style absolute paths before filesystem resolution. These checks cover both POSIX and Windows-style escape forms independent of the host OS.
3. Treat `frameBundle.entrypoint`, `styles[]`, and `assets[]` as paths relative to `frameBundle.root`, not paths relative to the extension directory.
4. Materialize omitted `frameBundle.browserSdkVersion` as the client-owned v1 constant in manifest projection.
5. Dedupe asset declarations by normalized bundle-relative path. Entrypoint wins first, styles retain first occurrence order, and `assets` excludes duplicates already declared by entrypoint or styles.
6. Use synchronous filesystem APIs in the manifest/catalog helper to avoid changing the public synchronous `buildExtensionContributionManifest()` API and its current monitor call sites.
7. Export catalog and lookup helpers from `@eforge-build/engine/extensions/index` so monitor routes can use the same asset-id algorithm as manifest projection.
8. Hash every regular file under `workstation-assets/`, not only files declared by currently loaded registrations. Trust records then cover mutable browser files even before a workstation declaration starts referencing them.
9. Keep top-level `dist/` excluded from hash collection; only files placed under `workstation-assets/` opt into browser-asset trust hashing.
10. Continue using `lstat` before directory traversal so symlinks under hash-included paths remain rejected.

## Files

### Create
- `packages/engine/src/extensions/workstation-bundle-paths.ts` — pure helpers for bundle source validation.
  - Export `WORKSTATION_ASSETS_DIR = 'workstation-assets'`.
  - Export `normalizeWorkstationBundleRoot(value: unknown)` returning `{ ok: true; value: string }` or `{ ok: false; message: string }`.
  - Export `normalizeWorkstationBundleAssetPath(value: unknown, fieldName: string)` returning the same result shape for entrypoint/style/asset paths.
  - Export `validateWorkstationFrameBundleSource(value: unknown)` returning a normalized `ConsoleWorkstationFrameBundleSpec` when the object shape, path fields, optional arrays, and SDK version pass validation.
  - Use only lexical validation; no filesystem reads in this file.
- `packages/engine/src/extensions/workstation-assets.ts` — manifest and monitor-facing asset catalog helpers.
  - Export `ConsoleWorkstationAssetCatalogError` with typed codes such as `not-frame-bundle`, `invalid-bundle-source`, `extension-root-unavailable`, `bundle-root-missing`, `bundle-root-not-directory`, `asset-missing`, `asset-not-file`, `asset-symlink`, `asset-realpath-escape`, and `asset-read-failed`.
  - Export `buildConsoleWorkstationAssetCatalog(registration)` that returns the resolved extension root, bundle root, entrypoint asset, style assets, additional assets, and `allAssets`.
  - Export `buildConsoleWorkstationFrameBundleManifest(registration)` that returns the client-owned `ConsoleWorkstationFrameBundleManifest` with `browserSdkVersion: 1`, `frameUrl`, `entrypoint`, `styles`, and `assets`.
  - Export `findConsoleWorkstationBundleAsset(registry, workstationId, assetId)` that validates the shared asset-id pattern, finds the workstation registration, rejects non-bundle workstations, builds the current catalog, and returns either `{ ok: true, registration, asset, catalog }` or a typed `{ ok: false, reason, message }` result.
  - Build frame and asset URLs with `buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId })` and `buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId, assetId })`.
  - Generate asset ids as `sha256-${contentSha256}-path-${relativePathSha256}`, with both digests lowercase hex SHA-256 values.

### Modify
- `packages/engine/src/extensions/types.ts` — add bundle workstation source types and change `ConsoleWorkstationSpec` to a discriminated-by-presence union `[region: engine-registration-manifest-trust, workstation source type declarations]`.
  - Add `ConsoleWorkstationBaseSpec`, `ConsoleWorkstationFrameBundleSpec`, `ConsoleWorkstationSrcDocSpec`, and `ConsoleWorkstationFrameBundleWorkstationSpec` or equivalent exported names.
  - Keep `id`, `title`, `description`, and `allowedActions` semantics unchanged.
  - Keep `allowedActions?: string[]` on the shared base.
  - Model source exclusivity with optional `never` fields: `srcDoc` variant has `frameBundle?: never`; bundle variant has `srcDoc?: never`.
- `packages/engine/src/extensions/contribution-validation.ts` — validate workstation source union and frame bundle fields `[region: engine-registration-manifest-trust, console workstation validation]`.
  - Keep existing `srcDoc` validation for legacy registrations.
  - Reject both `srcDoc` and `frameBundle` with a message containing `requires exactly one of srcDoc or frameBundle`.
  - Reject neither `srcDoc` nor `frameBundle` with the same source-mode message.
  - Reject non-object `frameBundle` values.
  - Reject invalid roots with a message that names `frameBundle.root` and `workstation-assets`.
  - Reject invalid entrypoint/style/asset paths with messages that name the failing field.
  - Reject `styles` and `assets` when present but not arrays.
  - Reject `frameBundle.browserSdkVersion` values other than `1`.
  - Keep `allowedActions` validation and JSON-safe validation behavior.
- `packages/engine/src/extensions/manifest.ts` — project dual-mode workstation manifest entries and add bundle catalog diagnostics `[region: engine-registration-manifest-trust, console workstation manifest projection]`.
  - Import bundle manifest helpers from `workstation-assets.ts`.
  - Keep `srcDoc` workstation projection byte-for-byte equivalent except for surrounding union-safe branching.
  - For bundle workstations, omit `srcDoc`, include `frameBundle`, and keep `allowedActions: projectAllowedActions(reg, registry)`.
  - Keep `allowedActions` defaulting to same-extension actions and `[]` mapping to an empty list.
  - Add per-workstation catch handling for `ConsoleWorkstationAssetCatalogError` in collection helpers. Convert catalog errors to manifest diagnostics with code `extension:invalid-workstation-bundle`, severity `error`, `name: reg.id`, `path: reg.extensionPath`, and `extensionName: reg.extensionName`.
  - Keep `buildConsoleWorkstationManifestEntry(reg, registry)` exported for direct callers; it may throw the typed catalog error for invalid bundle files. Use a private safe collector in `buildExtensionContributionManifest()` and `buildConsoleWorkstationDetails()`.
  - Continue importing route constants only from `@eforge-build/client`; do not add `/api/` string literals.
- `packages/engine/src/extensions/hash.ts` — include the conventional browser asset root in trust hashes `[region: engine-registration-manifest-trust, workstation-assets hash inclusion]`.
  - Import or define the shared `WORKSTATION_ASSETS_DIR` constant from `workstation-bundle-paths.ts`.
  - Track whether traversal is under `workstation-assets/`.
  - Include every regular file when under that root, regardless of file extension.
  - Do not skip nested `dist/`, `node_modules/`, or `.git/` directories once traversal is already under `workstation-assets/`.
  - Keep top-level `dist/`, top-level `node_modules/`, and top-level `.git/` skipped outside `workstation-assets/`.
  - Keep symlink rejection before directory/file inclusion decisions.
- `packages/engine/src/extensions/index.ts` — export new source types, path constants, catalog helpers, lookup helpers, and catalog error types for monitor consumers.
  - Export types added to `types.ts` in the existing type export block.
  - Export `WORKSTATION_ASSETS_DIR`, `normalizeWorkstationBundleRoot`, `normalizeWorkstationBundleAssetPath`, `buildConsoleWorkstationAssetCatalog`, `buildConsoleWorkstationFrameBundleManifest`, `findConsoleWorkstationBundleAsset`, and `ConsoleWorkstationAssetCatalogError`.
- `test/extension-hash.test.ts` — extend hash behavior coverage.
  - Add a test that modifying `workstation-assets/index.css` changes `hashExtensionDirectory()`.
  - Add a test that modifying `workstation-assets/app.bundle.js` changes `hashExtensionDirectory()` even when the file extension would already be source-like, proving the root is included as browser assets.
  - Add a test that modifying `workstation-assets/dist/bundle.js` changes the hash while modifying top-level `dist/bundle.js` still does not.
  - Add a test that a symlink under `workstation-assets/` rejects with `unsupported symbolic link`.
- `test/extension-workstation-bundles.test.ts` — new focused runtime/manifest tests for this module.
  - Test `validateConsoleWorkstationSpec()` accepts a legacy `srcDoc` workstation.
  - Test validation accepts a `frameBundle` workstation with root, entrypoint, styles, assets, and `browserSdkVersion: 1`.
  - Test validation accepts a `frameBundle` workstation that omits `browserSdkVersion`.
  - Table-test rejections for both source modes, neither source mode, absolute root, absolute entrypoint, empty root, empty entrypoint, traversal segments, `.` segments, empty segments, null bytes, backslashes, non-array styles, non-array assets, and `browserSdkVersion: 2`.
  - Build a directory-layout extension fixture with `workstation-assets/board/index.js`, `style.css`, and an additional asset; load it through `loadNativeExtensions()`; assert manifest projection produces a bundle variant with `browserSdkVersion: 1`, a frame URL from `API_ROUTES.extensionWorkstationFrame`, asset URLs from `API_ROUTES.extensionWorkstationAsset`, and no `srcDoc` field.
  - Assert generated asset ids match the client-owned asset-id regex and that `entrypoint.sha256` equals the SHA-256 of the fixture file content.
  - Assert same-content different-path files produce different asset ids because the path hash suffix differs.
  - Assert duplicate style/asset declarations appear once in the projected arrays.
  - Assert a bundle workstation with omitted `allowedActions` projects same-extension actions and `allowedActions: []` projects an empty array.
  - Assert `safeParseExtensionContributionManifest(buildExtensionContributionManifest(registry)).success` is `true` for a valid bundle fixture.
  - Assert `findConsoleWorkstationBundleAsset()` returns the absolute asset path for a declared id, returns `malformed-asset-id` for an invalid id string, returns `unknown-asset-id` for a valid-format undeclared id, returns `unknown-workstation` for a missing workstation id, and returns `not-frame-bundle` for a legacy `srcDoc` workstation.
  - Assert a missing declared file causes manifest projection to include an `extension:invalid-workstation-bundle` diagnostic and excludes that bundle workstation from `consoleWorkstations`.

## Shared Files and Edit Region Markers

The architecture registry assigns `packages/engine/src/extensions/types.ts`, `packages/engine/src/extensions/contribution-validation.ts`, `packages/engine/src/extensions/manifest.ts`, and `packages/engine/src/extensions/hash.ts` to this module as single-owner edits. The `[region: engine-registration-manifest-trust, ...]` annotations above identify bounded edit locations for build coordination.

`packages/engine/src/extensions/index.ts` is not listed in the architecture shared file registry, but this module must update it to expose monitor-facing helpers. No other module plan in the provided dependency set modifies that file.

No temporary `plan-\d{2}-...` source markers are required because no planned source file is split between modules. If a later split assigns one of these files to another module, use non-overlapping cleanup-targeted markers with the compiled plan id, for example:

```ts
// --- eforge:region plan-03-engine-registration-manifest-trust ---
export { buildConsoleWorkstationAssetCatalog } from './workstation-assets.js';
// --- eforge:endregion plan-03-engine-registration-manifest-trust ---
```

## Testing Strategy

### Unit Tests
- `test/extension-workstation-bundles.test.ts`
  - Direct validation tests for source-mode XOR, path validation, array validation, and SDK version validation.
  - Direct catalog tests for asset id format, content SHA-256, path SHA-256 disambiguation, duplicate declaration handling, and lookup failure reasons.
  - Manifest projection tests for legacy `srcDoc` compatibility, bundle frame/asset metadata, default browser SDK version, allowed-action projection, and client schema parsing.
- `test/extension-hash.test.ts`
  - Directory hash tests for `workstation-assets/` inclusion, top-level `dist/` exclusion, nested browser asset inclusion, deterministic repeated hashes, and symlink rejection.

### Integration Tests
- Existing extension loader and contribution registry tests continue to cover registration recording, duplicate workstation handling, allowed-action filtering, and registry projection.
- `pnpm type-check` verifies the engine source union, client-owned bundle manifest types, and exported monitor-facing helper types across package boundaries.
- `pnpm test -- test/extension-workstation-bundles.test.ts test/extension-hash.test.ts` verifies this module when targeted Vitest paths are supported; otherwise run `pnpm test`.

## Verification

- [ ] `validateConsoleWorkstationSpec({ id: 'workspace', title: 'Workspace', srcDoc: '<h1>Workspace</h1>' }).ok` is `true`.
- [ ] `validateConsoleWorkstationSpec()` returns `ok: true` for `frameBundle: { root: 'workstation-assets/board', entrypoint: 'index.js', styles: ['style.css'], assets: ['logo.svg'], browserSdkVersion: 1 }`.
- [ ] `validateConsoleWorkstationSpec()` returns `ok: true` when the same `frameBundle` omits `browserSdkVersion`.
- [ ] A workstation value containing both `srcDoc` and `frameBundle` returns `ok: false`.
- [ ] A workstation value containing neither `srcDoc` nor `frameBundle` returns `ok: false`.
- [ ] Absolute, empty, traversal, dot-segment, empty-segment, null-byte, and backslash-containing `frameBundle` paths each return `ok: false`.
- [ ] `frameBundle.root: 'assets'` returns `ok: false`.
- [ ] `frameBundle.browserSdkVersion: 2` returns `ok: false`.
- [ ] A valid bundle manifest entry has `frameBundle.browserSdkVersion === 1`.
- [ ] A valid bundle manifest entry contains `frameBundle.frameUrl === buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId })`.
- [ ] Each valid bundle asset ref URL equals `buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId, assetId })` for its generated `assetId`.
- [ ] Each valid bundle asset id matches the client-owned `sha256-<64-hex>-path-<64-hex>` pattern.
- [ ] Two declared assets with identical content and different normalized bundle-relative paths have different ids.
- [ ] Duplicate declared asset paths appear once in the projected `styles` and `assets` arrays.
- [ ] A bundle workstation with omitted `allowedActions` projects only same-extension action ids.
- [ ] A bundle workstation with `allowedActions: []` projects `allowedActions: []`.
- [ ] `safeParseExtensionContributionManifest()` returns `success: true` for a manifest containing a valid bundle workstation.
- [ ] `buildExtensionContributionManifest()` includes an `extension:invalid-workstation-bundle` diagnostic and omits the bundle workstation when a declared bundle file is missing.
- [ ] `findConsoleWorkstationBundleAsset()` returns `ok: true` with an absolute file path for a declared asset id.
- [ ] `findConsoleWorkstationBundleAsset()` returns `malformed-asset-id`, `unknown-asset-id`, `unknown-workstation`, and `not-frame-bundle` in the corresponding lookup tests.
- [ ] Changing a CSS file under `workstation-assets/` changes `hashExtensionDirectory()`.
- [ ] Changing a file under top-level `dist/` leaves `hashExtensionDirectory()` unchanged.
- [ ] Changing a file under `workstation-assets/dist/` changes `hashExtensionDirectory()`.
- [ ] A symlink under `workstation-assets/` makes `hashExtensionDirectory()` reject with a message containing `unsupported symbolic link`.
- [ ] `packages/engine/src/extensions/manifest.ts` contains no `/api/` string literal.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/extension-workstation-bundles.test.ts test/extension-hash.test.ts` exits 0, or `pnpm test` exits 0 when targeted Vitest paths are not supported.
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
