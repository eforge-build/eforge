# Implement iframe-bundled Console workstation SDK

## Vision and goals

eforge will support rich extension-authored browser UI without turning Console into an extension plugin host. The new model adds a second Console workstation source mode, `frameBundle`, while preserving the existing `srcDoc` authoring path.

The resulting architecture is:

- Native extensions still register workstations during daemon/worker extension loading.
- `srcDoc` workstations keep the current Console-owned sandboxed iframe flow.
- Bundle-backed workstations run in the same iframe boundary, but Console renders them with an iframe `src` that points at an eforge-owned daemon frame-shell route.
- The frame shell loads only manifest-declared assets from eforge-owned routes.
- The frame shell installs the v1 bridge (`window.eforge`) and reads the per-render bridge token from `location.hash`, so the token is not sent to the daemon route.
- Browser bundle authors import `@eforge-build/extension-sdk/browser` for the small supported browser SDK surface instead of importing private Console code.

This is not a parent-Console plugin system. Parent Console never imports extension JavaScript, React, CSS, or components into its own realm.

## Current-state gaps found during exploration

The source is not fully implemented. Current code only supports iframe `srcDoc` workstations:

- `packages/extension-sdk/src/contributions.ts` defines `ConsoleWorkstation` with required `srcDoc` and no `frameBundle`.
- `packages/client/src/extension-contributions.ts` defines `ConsoleWorkstationManifestEntrySchema` with `srcDoc` and `allowedActions` only.
- `packages/client/src/routes/route-map.ts` has contribution manifest/action routes but no workstation frame or asset routes.
- `packages/client/src/api-version-const.ts` is at `DAEMON_API_VERSION = 59` and must be bumped for this first-party manifest/route feature gate.
- `packages/engine/src/extensions/contribution-validation.ts`, `types.ts`, and `manifest.ts` validate/project `srcDoc` only.
- `packages/engine/src/extensions/hash.ts` excludes `dist/` and only includes `package.json` plus source extensions; non-source bundle assets under a conventional directory are not hash-covered yet.
- `packages/monitor/src/routes/extensions/contributions.ts` serves only the contribution manifest and action invocation; no frame/asset routes exist.
- `packages/console-ui/src/views/workstations/workstation-iframe.tsx` always renders `srcDoc`; bundle `src` rendering is absent.
- `@eforge-build/extension-sdk/browser` does not exist.

## Core architectural principles

1. **Iframe boundary is mandatory.** Bundle-backed workstation JavaScript runs only inside the workstation iframe.
2. **Parent Console remains first-party.** Console never imports extension React/components/CSS/JS or provides parent React context to extensions.
3. **Client owns daemon contracts.** Route constants, manifest schemas, parse helpers, and browser-safe exports live in `@eforge-build/client`.
4. **SDK owns authoring contracts.** Native extension authors use `@eforge-build/extension-sdk` for source registration types and `@eforge-build/extension-sdk/browser` inside bundled iframe code.
5. **Engine validates registrations.** The engine recorder/validation layer rejects invalid source shapes and unsafe bundle paths before projection.
6. **Declared assets only.** Daemon asset routes map stable asset ids back to validated registration metadata; they never accept arbitrary relative path parameters from the browser.
7. **Trust hash covers served bundle files.** Project/team bundle assets must live under `workstation-assets/`, and that directory is included in extension content hashing while broad `dist/` remains excluded.
8. **Bridge semantics stay narrow.** Console continues to validate source window, bridge token, JSON-object input, and manifest-allowed action ids before invoking daemon-side actions.
9. **No frontend lifecycle scope creep.** v1 browser SDK exposes action invocation plus version checks only; theme, resize, subscriptions, and lifecycle hooks remain follow-ups.
10. **Engine/build orchestration unchanged.** This feature is extension SDK/types, extension registration/projection, daemon HTTP serving, Console rendering, tests, and docs.

## Shared data model

### Source registration shape

`ConsoleWorkstation` becomes a mutually exclusive union. Existing source remains valid:

```ts
interface ConsoleWorkstationBase {
  id: string;
  title: string;
  description?: string;
  allowedActions?: string[];
}

type ConsoleWorkstation = ConsoleWorkstationBase & (
  | { srcDoc: string; frameBundle?: never }
  | { srcDoc?: never; frameBundle: ConsoleWorkstationFrameBundle }
);

interface ConsoleWorkstationFrameBundle {
  root: string;              // relative directory under extension root; must be workstation-assets or workstation-assets/...
  entrypoint: string;        // relative path inside root for primary JS module
  styles?: string[];         // relative CSS paths inside root
  assets?: string[];         // additional relative asset paths inside root
  browserSdkVersion?: 1;     // omitted means 1
}
```

Validation contract:

- Exactly one of `srcDoc` or `frameBundle` is required.
- `root`, `entrypoint`, `styles[]`, and `assets[]` must be non-empty safe relative paths.
- Reject absolute paths, traversal (`.`/`..` segments), empty segments, null bytes, backslash separators, and any segment pattern that resolves outside the declared root.
- `frameBundle.root` must equal `workstation-assets` or start with `workstation-assets/` after normalization.
- `frameBundle.browserSdkVersion` may be omitted or `1`; all other values are rejected.
- `allowedActions` retains current behavior: omitted means same-extension actions in manifest projection; `[]` exposes no actions.

### Client-owned manifest shape

Keep `srcDoc` source-compatible at the extension-authoring level and use a dual-mode wire union. Prefer preserving the existing `srcDoc` manifest variant shape and adding a mutually exclusive `frameBundle` manifest variant:

```ts
interface ConsoleWorkstationManifestBase {
  id: string;
  localId: string;
  extensionName: string;
  extensionPath: string;
  title: string;
  description?: string;
  schemaVersion: 1;
  allowedActions: string[];
}

type ConsoleWorkstationManifestEntry = ConsoleWorkstationManifestBase & (
  | { srcDoc: string; frameBundle?: never }
  | { srcDoc?: never; frameBundle: ConsoleWorkstationFrameBundleManifest }
);

interface ConsoleWorkstationFrameBundleManifest {
  browserSdkVersion: 1;
  frameUrl: string;                       // no bridge token; Console appends URL fragment
  entrypoint: ConsoleWorkstationBundleAssetRef;
  styles: ConsoleWorkstationBundleAssetRef[];
  assets: ConsoleWorkstationBundleAssetRef[];
}

interface ConsoleWorkstationBundleAssetRef {
  id: string;                             // stable opaque id, e.g. sha256-<content-hex>-path-<relative-path-hex>
  url: string;                            // eforge-owned asset route
  relativePath: string;                   // normalized path inside frameBundle.root for diagnostics/display only
  sha256: string;                         // full content hash of the served file
}
```

Notes:

- `srcDoc` and `frameBundle` must be mutually exclusive in schemas and parse helpers.
- Route URLs must be built from `API_ROUTES` + `buildPath()` in producers; Console consumes the manifest URL and must not inline `/api/...` literals.
- The manifest may expose normalized relative paths for diagnostics/display, but asset route lookup must use only `workstationId` + `assetId` and validated registry metadata.
- Asset ids must have a single deterministic format shared by manifest projection and route lookup: `sha256-${contentSha256}-path-${relativePathSha256}`, where both digests are lowercase hex SHA-256 values and `relativePathSha256` is computed from the normalized path inside `frameBundle.root`. This preserves content-addressed cache invalidation while avoiding collisions between same-content declared assets that need different metadata, MIME handling, or diagnostics.

### Client-owned routes

Add route constants to `API_ROUTES`:

```ts
extensionWorkstationFrame: '/api/extensions/workstations/:workstationId/frame'
extensionWorkstationAsset: '/api/extensions/workstations/:workstationId/assets/:assetId'
```

Route parameters:

- `workstationId` is the effective manifest id such as `demo:board`; callers use `buildPath()` so `:` is encoded.
- `assetId` is an opaque content-addressed id with the format `sha256-<64-hex>-path-<64-hex>`; handlers reject ids that do not match the selected id format and never treat it as a filesystem path.

Bump `DAEMON_API_VERSION` from the current `59` to the next integer (`60` unless another concurrent change lands first) with a migration note for bundle workstation manifest fields and frame/asset routes. First-party clients must reject stale daemons before relying on these fields/routes.

### Frame shell and bridge contract

The daemon-generated frame shell:

- is served from `API_ROUTES.extensionWorkstationFrame`;
- uses no-cache headers;
- includes a restrictive CSP;
- reads the token from `location.hash`, for example `#bridgeToken=<encoded-token>`;
- installs `window.eforge = Object.freeze({ version: 1, invokeAction(...) })`;
- normalizes omitted `invokeAction` input to `{}` and rejects non-record inputs before posting to the parent, so every request carries a JSON-object input;
- loads declared CSS with `<link rel="stylesheet" href="asset.url">`;
- loads the primary JS bundle with `<script type="module" src="entrypoint.url">`.

The message protocol remains the existing Console bridge protocol:

- Child posts `{ type: 'eforge:workstation:invoke-action', requestId, bridgeToken, actionId, input }` to parent, where `input` is always a non-null, non-array JSON object.
- Parent posts `{ type: 'eforge:workstation:action-result', requestId, response | error }` back to child.
- Parent validation stays in `packages/console-ui/src/views/workstations/workstation-bridge.ts`.

### Browser SDK contract

`@eforge-build/extension-sdk/browser` is browser-safe and minimal:

```ts
export const EFORGE_WORKSTATION_BROWSER_SDK_VERSION = 1;

export interface EforgeConsoleBridge {
  version: number;
  invokeAction<TOutput = unknown>(actionId: string, input?: Record<string, unknown>): Promise<TOutput>;
}

export function getEforgeConsoleBridge(options?: { minVersion?: 1 }): EforgeConsoleBridge;
export function assertEforgeConsoleBridgeVersion(bridge?: EforgeConsoleBridge, expectedVersion?: 1): EforgeConsoleBridge;
export function invokeAction<TOutput = unknown>(actionId: string, input?: Record<string, unknown>): Promise<TOutput>;
```

Behavior and constraints:

- `invokeAction()` delegates to the injected bridge, uses `{}` when `input` is omitted, and relies on the injected bridge/runtime checks to reject non-record inputs before `postMessage`.
- no Node-only imports;
- no TypeBox-heavy server APIs;
- no `packages/console-ui` imports;
- no theme, resize, subscriptions, or lifecycle hooks in v1.

## Integration contracts between modules

### Client contracts -> all consumers

`client-contracts` owns route constants, TypeBox schemas, parse helpers, browser exports, and daemon API version. Other modules consume these exports; they must not redeclare route strings or wire shapes.

### Extension SDK -> engine validation

`extension-sdk-api` and `engine-registration-manifest-trust` must keep source authoring types aligned:

- `ConsoleWorkstationFrameBundle` field names and SDK version literal match in SDK and engine internal `ConsoleWorkstationSpec`.
- SDK TypeScript exclusivity (`srcDoc` XOR `frameBundle`) is a compile-time authoring aid; engine validation remains the runtime authority.

### Engine manifest/trust -> monitor serving

`engine-registration-manifest-trust` owns validated registration metadata and asset catalog helpers. `monitor-frame-assets` should reuse the same catalog/id algorithm used by manifest projection so asset route ids cannot drift from manifest ids.

The catalog helper should resolve the extension root as:

- directory-layout extension: `extensionPath` when it is a directory;
- file-layout extension: `dirname(extensionPath)`.

Then resolve `frameBundle.root` and declared asset paths under that root with containment checks. Asset ids must be generated as `sha256-${contentSha256}-path-${relativePathSha256}` using the full content SHA-256 and the SHA-256 of the normalized path inside `frameBundle.root`. This id format avoids ambiguous lookups for same-content files while preserving content-addressed cache invalidation. If duplicate declarations map to the same normalized path, dedupe deterministically.

### Monitor serving -> Console rendering

`monitor-frame-assets` serves:

- frame shell HTML at `frameBundle.frameUrl` with no bridge token in query/path;
- declared assets at `asset.url` with immutable cache headers.

`console-workstation-rendering` appends only the fragment token to `frameBundle.frameUrl` and preserves `sandbox="allow-scripts"` without `allow-same-origin`.

### Docs -> generated web docs

`docs-and-examples` updates source docs and runs `pnpm docs:generate` when the docs generator requires web content drift to be committed. `pnpm docs:check` is the drift gate.

## Shared file registry

The expedition is intentionally split so each implementation file has one owning module. No file is expected to require concurrent multi-module edits. The table below records ownership for aggregation files and likely touchpoints so module planners do not collide.

| File | Owner module | Region strategy |
|------|--------------|-----------------|
| `packages/client/src/extension-contributions.ts` | `client-contracts` | Single-owner full-file targeted edits; no other module edits schemas/types here. |
| `packages/client/src/routes/route-map.ts` | `client-contracts` | Single-owner append route constants near existing extension routes. |
| `packages/client/src/api-version-const.ts` | `client-contracts` | Single-owner version bump and migration note. |
| `packages/client/src/browser.ts` | `client-contracts` | Single-owner export updates for new manifest/route types. |
| `packages/extension-sdk/src/contributions.ts` | `extension-sdk-api` | Single-owner source type union update. |
| `packages/extension-sdk/src/index.ts` | `extension-sdk-api` | Single-owner root export updates only if new source types need explicit re-export. |
| `packages/extension-sdk/package.json` and `packages/extension-sdk/tsup.config.ts` | `extension-sdk-api` | Single-owner `./browser` export/build entry updates. |
| `packages/engine/src/extensions/types.ts` | `engine-registration-manifest-trust` | Single-owner internal registration shape update. |
| `packages/engine/src/extensions/contribution-validation.ts` | `engine-registration-manifest-trust` | Single-owner validation helpers for `frameBundle` paths/version. |
| `packages/engine/src/extensions/manifest.ts` | `engine-registration-manifest-trust` | Single-owner workstation manifest projection updates. |
| `packages/engine/src/extensions/hash.ts` | `engine-registration-manifest-trust` | Single-owner `workstation-assets/` hash inclusion. |
| `packages/monitor/src/routes/extension-content.ts` | `monitor-frame-assets` | Single-owner route-key list/count updates. |
| `packages/monitor/src/routes/extensions/index.ts` | `monitor-frame-assets` | Single-owner route aggregation update for frame/asset routes. |
| `packages/monitor/src/http/static-assets.ts` or new focused helper | `monitor-frame-assets` | Single-owner static serving helper edits. Prefer a new helper if changes would make this file broad. |
| `packages/console-ui/src/views/workstations/*` | `console-workstation-rendering` | Single-owner UI/bridge/rendering updates. |
| `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, `packages/console-ui/README.md`, generated `web/content/docs/*` | `docs-and-examples` | Single-owner docs updates after implementation symbols stabilize. |

### Region declarations

No temporary `plan-\d{2}-...` region markers are required by the architecture because no shared file is assigned to multiple modules.

If module planners later split a single owner module into multiple plans that both edit one file, they must declare non-overlapping temporary regions in their module plan using plan-id markers, for example `// --- eforge:region plan-01-client-contracts ---` / `// --- eforge:endregion plan-01-client-contracts ---`, and remove those markers during cleanup. Do not use non-plan slugs as temporary markers.

## Module implementation guide

### `client-contracts`

Implement the daemon/browser wire foundation:

- Add workstation bundle asset and frame-bundle manifest TypeBox schemas/types.
- Convert `ConsoleWorkstationManifestEntrySchema` to a closed union of `srcDoc` and `frameBundle` variants.
- Keep `allowedActions` unchanged and required in both variants.
- Add `extensionWorkstationFrame` and `extensionWorkstationAsset` route constants.
- Export new schemas/types from `packages/client/src/browser.ts` and `packages/client/src/index.ts` if the root index currently mirrors these types.
- Bump `DAEMON_API_VERSION` with a migration note.
- Update client tests for route constants, old `srcDoc` manifest acceptance, bundle manifest acceptance, and mutual-exclusion rejection.

### `extension-sdk-api`

Implement author-facing SDK contracts:

- Add `ConsoleWorkstationFrameBundle` and make `ConsoleWorkstation` a `srcDoc` XOR `frameBundle` union.
- Preserve existing `defineConsoleWorkstation({ srcDoc })` behavior and inference.
- Add `src/browser.ts` with the minimal browser SDK helpers/types.
- Add `./browser` to package exports and tsup entrypoints.
- Ensure `src/browser.ts` has no Node imports, no TypeBox imports, and no Console imports.
- Add targeted tests or type-check fixtures that prove `srcDoc` workstations still type-check and browser SDK helper behavior throws when `window.eforge` is absent or version-incompatible.

### `engine-registration-manifest-trust`

Implement runtime source validation and manifest/trust projection:

- Update engine `ConsoleWorkstationSpec` and registration shapes for the source union.
- Validate exactly one source mode, safe bundle paths, conventional `workstation-assets/` roots, and SDK version `1`/omitted.
- Keep unknown `allowedActions` diagnostics and allowed-action projection unchanged.
- Add asset catalog/projection helpers that produce client-owned manifest `frameBundle` metadata and build frame/asset URLs from `API_ROUTES` + `buildPath()`.
- Generate asset ids with the shared `sha256-${contentSha256}-path-${relativePathSha256}` format so manifest metadata and monitor lookup cannot diverge.
- Include `workstation-assets/` files in project/team extension directory hashes while keeping `dist/`, `node_modules/`, and `.git` exclusions.
- Preserve symlink rejection and deterministic path/content hashing.
- Update engine/root tests covering validation rejection cases, manifest projection, default SDK version, allowed action behavior, hash inclusion/exclusion, and symlink rejection.

### `monitor-frame-assets`

Implement daemon routes and static security:

- Add route definitions for `extensionWorkstationFrame` and `extensionWorkstationAsset` under the extensions route group.
- Register route keys in `EXTENSION_CONTENT_ROUTE_KEYS`; update route coverage/method/security tests.
- Implement a focused frame/asset service under `packages/monitor/src/routes/extensions/`.
- Reuse or extract static-serving helpers for MIME mapping, realpath containment, symlink rejection, immutable cache headers, and no-cache shell responses.
- Frame route returns generated HTML with `Content-Security-Policy` and `Cache-Control: no-cache`.
- Asset route rejects unknown workstation ids, undeclared asset ids, malformed ids, traversal/malformed encoding, missing files, and symlink/realpath escapes.
- Asset route only accepts asset ids matching `sha256-<64-hex>-path-<64-hex>` and maps them back to validated registration metadata.
- Asset route sends JS/CSS MIME types from shared MIME mapping and immutable cache headers.
- Do not redeclare client-owned response shapes or route strings.

### `console-workstation-rendering`

Implement dual-mode Console rendering:

- Keep the `srcDoc` path using `buildWorkstationSrcDoc()` and current iframe sandbox behavior.
- Add bundle rendering that sets iframe `src` to `${frameBundle.frameUrl}#bridgeToken=${encodeURIComponent(token)}`.
- Ensure the bridge token never appears in route query parameters.
- Keep `sandbox="allow-scripts"` and omit `allow-same-origin` for both modes.
- Keep `handleWorkstationBridgeEvent()` source-window, token, JSON input, and manifest-allowed action validation semantics.
- Update workstation selectors/tests for union-safe access to `srcDoc`/`frameBundle`.
- Add Console tests for `srcDoc` mode, bundle mode, fragment token, no parent-realm execution, allowed actions, and disallowed-action errors.

### `docs-and-examples`

Document the new supported boundary:

- Update `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, and `packages/console-ui/README.md`.
- Add a concise `frameBundle` example and browser SDK usage example.
- State that bundle workstations execute inside sandboxed iframes and use the versioned browser SDK/action bridge.
- State that authors may bundle React or another browser framework inside the iframe.
- State that private Console React/components/CSS, parent Console context, parent-Console plugins, Module Federation, raw extension-owned HTTP routes, and direct React loading remain unsupported.
- Explain `workstation-assets/`, trust hashing, frame/asset routes, CSP/cache boundaries, and iframe lifecycle boundaries.
- Update generated public docs via `pnpm docs:generate` if source-doc changes require it.
- Only add or alter `eforge/extensions/eforge-plan` dogfood if the implementation stays small; otherwise keep the full eforge-plan workstation UX out of this slice.

## Technical decisions and rationale

1. **Use `frameBundle` as the source field name.** Matches the source requirement and makes iframe scope explicit.
2. **Use mutually exclusive source modes instead of replacing `srcDoc`.** Existing source registrations remain valid.
3. **Use eforge-owned frame and asset routes.** Avoids raw extension-owned HTTP routes and keeps local daemon security checks centralized.
4. **Use URL fragments for tokens.** Fragments are available to iframe JavaScript but are not sent in HTTP requests.
5. **Use content-addressed asset ids with path disambiguation.** The id embeds the content SHA-256 for immutable cache invalidation and a normalized-relative-path SHA-256 so same-content declared files cannot collide in route lookup or MIME handling.
6. **Constrain bundle roots to `workstation-assets/`.** Prevents a trust gap where built output under broad excluded directories changes without invalidating project/team trust.
7. **Keep route/wire definitions in client.** Satisfies project policy and prevents Console/monitor route drift.
8. **Keep browser SDK minimal.** The existing bridge only supports action invocation; adding lifecycle/theme/resize/subscription APIs now would create premature stability commitments.
9. **Prefer nonce-based CSP for generated shell.** A per-response nonce permits the inline bootstrap while keeping `script-src` restricted to same-origin assets plus the nonce. If implementation cost grows, document the conservative fallback and keep tests checking CSP presence.
10. **No package build pipeline.** This slice serves already-present declared assets; it does not install, bundle, watch, or rebuild frontend packages.

## Quality attributes

### Compatibility

- Existing `registerConsoleWorkstation({ srcDoc })` registrations validate and render.
- First-party clients reject stale daemons through the daemon API version check before using new bundle fields/routes.

### Security

- Bundle JavaScript runs in sandboxed iframes without `allow-same-origin`.
- Parent bridge validates source window, token, JSON-object input, and allowed action ids.
- Asset routes use stable ids, not relative path request parameters.
- Asset serving enforces lexical path validation, realpath containment, symlink rejection, missing-file rejection, and MIME controls.
- Frame shell uses CSP and no-cache headers; assets use immutable cache headers.

### Maintainability

- New implementation files stay below 600 lines.
- Existing large files are edited with bounded exact edits.
- Route constants and wire shapes are not redeclared outside `@eforge-build/client`.
- Monitor route services are focused modules rather than expanding server/router files.

### Testability

Expected test coverage includes:

- Client manifest schema union acceptance/rejection and route constants.
- Extension SDK source type and browser helper behavior.
- Engine registration validation for all path/version/mutual-exclusion cases.
- Engine hash inclusion for `workstation-assets/` and continued `dist/` exclusion.
- Monitor frame/asset route security, MIME, cache, CSP, malformed encoding, traversal, missing id/file, and symlink/realpath escape cases.
- Console `srcDoc` and bundle iframe rendering, fragment token handling, and bridge validation/disallowed action behavior.
- Documentation drift via `pnpm docs:check`.

## Validation commands

Run after all modules merge:

```bash
pnpm type-check
pnpm maintainability:check
pnpm docs:check
pnpm test
```
