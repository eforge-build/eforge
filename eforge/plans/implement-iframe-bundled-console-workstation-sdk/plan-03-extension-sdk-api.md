---
id: plan-03-extension-sdk-api
name: Add source-level frameBundle workstation types and the browser-safe v1
  workstation SDK entrypoint.
branch: implement-iframe-bundled-console-workstation-sdk/extension-sdk-api
---

# Extension SDK API

## Architecture Reference

This module implements the `extension-sdk-api` implementation guide and the architecture sections `Source registration shape`, `Browser SDK contract`, and `Extension SDK -> engine validation`.

Key constraints from architecture:
- Existing `registerConsoleWorkstation({ id, title, srcDoc, allowedActions })` source registrations remain valid.
- Source workstations become an XOR union: exactly one of `srcDoc` or `frameBundle` at the type level, with runtime validation owned by the engine module.
- `frameBundle.browserSdkVersion` is source-level literal `1` when present; omission means v1 at engine projection time.
- `@eforge-build/extension-sdk/browser` is a browser-safe subpath with action invocation and bridge version checks only.
- The browser SDK subpath must not import Node-only modules, TypeBox-heavy server APIs, private Console modules, or `packages/console-ui` code.
- The browser SDK does not expose theme, resize, subscription, lifecycle, AI, daemon, or parent-Console React APIs.
- The browser SDK version constant must stay aligned with the client-owned v1 workstation manifest contract from `client-contracts`.

## Scope

### In Scope
- Add source-level `ConsoleWorkstationFrameBundle` types for native extension authors.
- Change `ConsoleWorkstation` to accept either `srcDoc` or `frameBundle`, not both.
- Preserve `defineConsoleWorkstation({ srcDoc })` as an identity helper for existing source registrations.
- Make `defineConsoleWorkstation()` generic so literal workstation objects keep their inferred variant shape.
- Add `@eforge-build/extension-sdk/browser` with v1 bridge types, `getEforgeConsoleBridge()`, `assertEforgeConsoleBridgeVersion()`, and `invokeAction()`.
- Add the `./browser` package export and tsup entrypoint.
- Add source/type tests for `srcDoc`, `frameBundle`, mutual exclusion, SDK version literal support, browser helper behavior, and browser entrypoint import discipline.

### Out of Scope
- Engine runtime validation for unsafe `frameBundle` paths, conventional `workstation-assets/` roots, and unsupported SDK versions.
- Engine manifest projection and asset id generation.
- Monitor frame shell and declared asset routes.
- Console iframe rendering and bridge event handling changes.
- Documentation updates in `docs/`, `web/`, `packages/extension-sdk/README.md`, or `packages/console-ui/README.md`; the `docs-and-examples` module owns those files.
- Dogfood extension changes.
- Package version changes.

## Implementation Approach

### Overview

Update the authoring surface in `packages/extension-sdk/src/contributions.ts` by splitting the current `ConsoleWorkstation` interface into a base type plus two variant types. The `srcDoc` variant keeps the current fields. The bundle variant adds `frameBundle` with `root`, `entrypoint`, optional `styles`, optional `assets`, and optional `browserSdkVersion: 1`. The TypeScript union uses `never` on the opposite source field so type-checking rejects objects with both source modes or neither source mode.

Create a standalone `packages/extension-sdk/src/browser.ts` entrypoint for iframe bundle code. This file contains no imports. It reads the injected bridge from `window.eforge`, verifies the bridge shape and minimum version, normalizes omitted action input to `{}`, and delegates action invocation to the injected bridge. The implementation validates only bridge presence/version/function shape; bridge message validation and action allowlist enforcement remain in Console and monitor/engine modules.

Expose the browser entrypoint through `packages/extension-sdk/package.json` and `packages/extension-sdk/tsup.config.ts`. Keep runtime browser helpers out of the package root. The root re-exports the `EforgeConsoleBridge` type from `src/browser.ts` as a type-only export so the existing `sdk.EforgeConsoleBridge` type name remains available without pulling browser runtime helpers into the root entrypoint.

### Key Decisions

1. Model source exclusivity with `srcDoc?: never` and `frameBundle?: never`. This gives authors immediate TypeScript feedback while keeping runtime rejection cases in engine validation.
2. Keep `frameBundle` path fields as strings in the SDK. The SDK does not enforce path containment or `workstation-assets/`; engine validation is the runtime authority and emits diagnostics.
3. Use a generic identity signature for `defineConsoleWorkstation<TWorkstation extends ConsoleWorkstation>(workstation: TWorkstation): TWorkstation`. This preserves literal inference for `frameBundle` declarations and leaves existing `srcDoc` calls valid.
4. Define the strict v1 browser bridge type in `src/browser.ts` with `version: number` and `invokeAction()`. Remove the local `EforgeConsoleBridge` definition from `contributions.ts` and export the browser type from the root with `export type { EforgeConsoleBridge } from './browser.js';`.
5. Keep `src/browser.ts` import-free. Tests compare `EFORGE_WORKSTATION_BROWSER_SDK_VERSION` with the client-owned v1 constant introduced by `client-contracts`, but production browser code does not import `@eforge-build/client/browser` and does not pull TypeBox schemas into browser bundles.
6. Treat `getEforgeConsoleBridge({ minVersion: 1 })` as a minimum-version check. A bridge with version `0` throws; a bridge with version `1` returns the bridge. Future bridge versions can remain backward-compatible with v1 without changing this helper.
7. Limit v1 browser SDK runtime behavior to action invocation and version checks. No theme, resize, subscription, lifecycle, direct daemon fetch wrapper, parent Console context, React, CSS, or component APIs are added in this module.

## Files

### Create
- `packages/extension-sdk/src/browser.ts` — browser-safe v1 workstation SDK subpath with no imports.
  - Export `EFORGE_WORKSTATION_BROWSER_SDK_VERSION = 1 as const`.
  - Export `EforgeWorkstationBrowserSdkVersion = typeof EFORGE_WORKSTATION_BROWSER_SDK_VERSION`.
  - Export `EforgeConsoleBridge` with `version: number` and `invokeAction<TOutput = unknown>(actionId: string, input?: Record<string, unknown>): Promise<TOutput>`.
  - Export `GetEforgeConsoleBridgeOptions` with `minVersion?: 1`.
  - Export `getEforgeConsoleBridge(options?)`, `assertEforgeConsoleBridgeVersion(bridge?, expectedVersion?)`, and `invokeAction<TOutput = unknown>(actionId, input?)`.
  - Add a global `Window` augmentation for optional `eforge?: EforgeConsoleBridge`.
  - Throw deterministic `Error` messages for missing `window.eforge`, non-function `invokeAction`, non-numeric bridge `version`, and bridge versions below the requested minimum.
- `test/extension-sdk-browser.test.ts` — runtime and source-discipline tests for the browser subpath.
  - Stub `globalThis.window` with configurable property descriptors and restore the original descriptor in `afterEach`.
  - Test missing bridge errors, incompatible version errors, bridge return value, omitted-input normalization to `{}`, explicit input forwarding, and client/SDK version constant alignment.
  - Read `packages/extension-sdk/src/browser.ts` and assert import/export-from lines contain none of `node:`, `@sinclair/typebox`, `./schema`, `./api`, `./context`, `./project-paths`, `@eforge-build/client`, `packages/console-ui`, or `@eforge-build/console-ui`.

### Modify
- `packages/extension-sdk/src/contributions.ts` — add source workstation bundle types and replace the current `ConsoleWorkstation` interface with the XOR union `[region: extension-sdk-api, workstation source types and define helper]`.
  - Add `ConsoleWorkstationBase`, `ConsoleWorkstationFrameBundle`, `ConsoleWorkstationSrcDoc`, and `ConsoleWorkstationFrameBundleWorkstation` types or equivalent exported names.
  - Keep `id`, `title`, `description`, and `allowedActions` semantics unchanged.
  - Keep `allowedActions?: string[]` on the shared base.
  - Remove the local `EforgeConsoleBridge` definition; `src/browser.ts` owns that type.
  - Change `defineConsoleWorkstation()` to return the generic input type rather than the widened union.
- `packages/extension-sdk/src/index.ts` — export the new source types and keep the existing public root type names available `[region: extension-sdk-api, root contribution and browser type exports]`.
  - Add `ConsoleWorkstationFrameBundle`, `ConsoleWorkstationSrcDoc`, and `ConsoleWorkstationFrameBundleWorkstation` to the type export block when those names are used.
  - Keep `ConsoleWorkstation` exported from `./contributions.js`.
  - Export `EforgeConsoleBridge` type-only from `./browser.js`.
  - Do not export `getEforgeConsoleBridge()`, `assertEforgeConsoleBridgeVersion()`, `invokeAction()`, or `EFORGE_WORKSTATION_BROWSER_SDK_VERSION` from the package root.
- `packages/extension-sdk/package.json` — add the browser subpath export `[region: extension-sdk-api, browser package export]`.
  - Add `"./browser": { "types": "./dist/browser.d.ts", "import": "./dist/browser.js" }`.
  - Do not add dependencies and do not change the package version.
- `packages/extension-sdk/tsup.config.ts` — add `src/browser.ts` to the entry list `[region: extension-sdk-api, browser tsup entry]`.
  - Keep ESM output and declaration generation.
  - Do not change the target or add Node polyfills for the browser entrypoint.
- `test/extension-sdk-example.test.ts` — extend compile-time SDK surface tests.
  - Add a `srcDoc` workstation fixture that still type-checks through `defineConsoleWorkstation()`.
  - Add a bundle workstation fixture with `frameBundle.root`, `entrypoint`, `styles`, `assets`, and `browserSdkVersion: 1`.
  - Add a bundle workstation fixture that omits `browserSdkVersion`.
  - Add `@ts-expect-error` cases for both `srcDoc` and `frameBundle`, neither source field, and `browserSdkVersion: 2`.
  - Add new exported source types to the existing `_TypeExports` list.

## Shared Files and Edit Region Markers

The architecture registry assigns `packages/extension-sdk/src/contributions.ts`, `packages/extension-sdk/src/index.ts`, `packages/extension-sdk/package.json`, and `packages/extension-sdk/tsup.config.ts` to this module as single-owner edits. The `[region: extension-sdk-api, ...]` annotations above identify bounded edit locations for build coordination.

No source file in this module requires temporary `plan-\d{2}-...` region markers because no planned file is split with another module. If a later split assigns docs or examples to this module, declare non-overlapping plan-id markers before implementation.

## Testing Strategy

### Unit Tests
- `test/extension-sdk-browser.test.ts`
  - Missing `window.eforge` throws from `getEforgeConsoleBridge()`.
  - A bridge with version `0` throws from `getEforgeConsoleBridge({ minVersion: 1 })`.
  - A bridge with version `1` and function-valued `invokeAction` is returned by `getEforgeConsoleBridge()`.
  - `invokeAction('say-hi')` calls the injected bridge with `('say-hi', {})`.
  - `invokeAction('say-hi', { name: 'Ada' })` forwards the exact input object.
  - `EFORGE_WORKSTATION_BROWSER_SDK_VERSION` equals the client-owned v1 workstation browser SDK version constant from `@eforge-build/client/browser`.
  - `src/browser.ts` contains no forbidden runtime imports or export-from lines.
- `test/extension-sdk-example.test.ts`
  - Type-check stubs cover old `srcDoc` source, new `frameBundle` source, omitted SDK version, mutual exclusion failures, missing source failure, unsupported SDK version failure, and exported type names.

### Integration Tests
- `pnpm --filter @eforge-build/extension-sdk build` verifies `dist/browser.js` and `dist/browser.d.ts` are emitted by tsup.
- `pnpm type-check` verifies the package root, `@eforge-build/extension-sdk/browser`, TypeScript XOR source shapes, and `@ts-expect-error` fixtures.
- Existing extension loading and registry tests continue to exercise runtime `srcDoc` registrations; engine-specific bundle validation tests belong to `engine-registration-manifest-trust`.

## Verification

- [ ] `defineConsoleWorkstation({ id: 'hello', title: 'Hello', srcDoc: '<h1>Hello</h1>' })` type-checks.
- [ ] `defineConsoleWorkstation({ id: 'bundle', title: 'Bundle', frameBundle: { root: 'workstation-assets/demo', entrypoint: 'index.js' } })` type-checks.
- [ ] `defineConsoleWorkstation({ id: 'bundle', title: 'Bundle', frameBundle: { root: 'workstation-assets/demo', entrypoint: 'index.js', browserSdkVersion: 1 } })` type-checks.
- [ ] A `defineConsoleWorkstation()` fixture containing both `srcDoc` and `frameBundle` is covered by `@ts-expect-error`.
- [ ] A `defineConsoleWorkstation()` fixture containing neither `srcDoc` nor `frameBundle` is covered by `@ts-expect-error`.
- [ ] A `defineConsoleWorkstation()` fixture containing `frameBundle.browserSdkVersion: 2` is covered by `@ts-expect-error`.
- [ ] `@eforge-build/extension-sdk/browser` exports `EFORGE_WORKSTATION_BROWSER_SDK_VERSION`, `getEforgeConsoleBridge`, `assertEforgeConsoleBridgeVersion`, and `invokeAction`.
- [ ] `EFORGE_WORKSTATION_BROWSER_SDK_VERSION` equals the client-owned v1 workstation browser SDK version constant.
- [ ] `getEforgeConsoleBridge()` throws when `window.eforge` is absent.
- [ ] `getEforgeConsoleBridge({ minVersion: 1 })` throws when `window.eforge.version` is `0`.
- [ ] `getEforgeConsoleBridge({ minVersion: 1 })` returns the injected bridge when `window.eforge.version` is `1`.
- [ ] `invokeAction('say-hi')` calls the injected bridge with `{}` as the second argument.
- [ ] `invokeAction('say-hi', { name: 'Ada' })` calls the injected bridge with the same input object.
- [ ] `packages/extension-sdk/src/browser.ts` import/export-from lines contain none of `node:`, `@sinclair/typebox`, `./schema`, `./api`, `./context`, `./project-paths`, `@eforge-build/client`, `packages/console-ui`, or `@eforge-build/console-ui`.
- [ ] `packages/extension-sdk/package.json` contains an `./browser` export with `./dist/browser.d.ts` and `./dist/browser.js`.
- [ ] `packages/extension-sdk/tsup.config.ts` includes `src/browser.ts` in the entry list.
- [ ] `pnpm --filter @eforge-build/extension-sdk build` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/extension-sdk-browser.test.ts test/extension-sdk-example.test.ts` exits 0, or `pnpm test` exits 0 when targeted Vitest paths are not supported.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["api", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
