---
title: Implement iframe-bundled Console workstation SDK
created: 2026-06-06
depends_on: ["reduce-complexity-in-top-eforge-hotspots"]
landing: pr
landing_auto_merge: true
stack_parent: reduce-complexity-in-top-eforge-hotspots
---

# Implement iframe-bundled Console workstation SDK

## Problem / Motivation

eforge needs a post-V1 Console workstation model for rich extension-authored browser UI. Current V1 workstations use sandboxed iframe `srcDoc` plus an action bridge, while separately served bundles, direct React loading, arbitrary Console JavaScript outside `srcDoc`, independent frontend plugins, and extension-owned HTTP routes remain deferred.

This work uses backlog item `.backlog/items/backlog-2026-06-01-explore-arbitrary-console-workstation-frontend-extension-bun.md` as the source rationale.

Validated context:

- The backlog item is still open and narrowed post-V1.
- `docs/roadmap.md` aligns this work with **Extension Platform** deferred phases and **Console Observability and Control**, not with engine-kernel expansion.
- `packages/console-ui/README.md` documents `/console/workstations` and says extension-registered workstations use `registerConsoleWorkstation`, manifest discovery, trusted iframe `srcDoc`, and manifest-allowed action invocation.
- `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` document the current V1 workstation model and explicitly defer arbitrary frontend bundles, direct React component loading, private Console React imports, raw extension-owned HTTP routes, and independent frontend plugins.
- `packages/console-ui/src/views/workstations/workstation-iframe.tsx` renders an iframe with `sandbox="allow-scripts"` and `srcDoc`, without `allow-same-origin`.
- `packages/console-ui/src/views/workstations/workstation-srcdoc.ts` injects `window.eforge.invokeAction` into workstation HTML.
- `packages/console-ui/src/views/workstations/workstation-bridge.ts` validates source window, bridge token, JSON-object input, and manifest-allowed action ids before invoking extension actions.
- `packages/client/src/extension-contributions.ts` defines the workstation manifest as `srcDoc` plus `allowedActions`; no asset-bundle or React-component wire fields are present.
- `packages/engine/src/extensions/hash.ts` excludes broad built-output directories such as `dist/`, so bundle support must add a deliberate hash-covered asset convention rather than serving arbitrary build output.
- `packages/monitor/src/http/static-assets.ts` has reusable first-party static-serving patterns for MIME types, realpath containment, symlink rejection, immutable cache headers, and no-cache shell responses.

## Goal

Implement iframe-scoped Console workstation asset bundles plus a minimal versioned workstation browser SDK.

Existing `srcDoc` workstations must remain source-compatible, while bundle-backed workstations must execute inside the workstation iframe boundary and communicate with parent Console through a versioned bridge/SDK.

## Approach

This is an **architecture / deep** change and should use an **Expedition** build profile.

The implementation spans client wire contracts, extension SDK API, engine registration/manifest/trust hashing, monitor routes/static security, Console iframe rendering, docs, and tests.

The core architectural rule is that rich extension browser UI may be bundled, but it executes inside the workstation iframe boundary and talks to parent Console through a versioned bridge/SDK.

### Current architecture to build on

- Native extensions run as trusted, unsandboxed Node modules in the daemon/worker process.
- Project/team extension loading is controlled by local trust records.
- Console rich extension UI currently uses `registerConsoleWorkstation` with iframe `srcDoc` plus `window.eforge.invokeAction`.
- Console renders current workstations with `<iframe sandbox="allow-scripts" srcDoc={...}>` and intentionally omits `allow-same-origin`.
- The workstation bridge validates source window, per-iframe bridge token, JSON-object input, and manifest-allowed action ids before invoking daemon-side extension actions.
- `ConsoleWorkstationManifestEntrySchema` currently carries `srcDoc` and `allowedActions`, with no asset bundle fields.
- Existing monitor static serving only covers first-party Console assets under `/console/assets`.
- Existing monitor static serving already has useful path containment, symlink rejection, MIME mapping, immutable asset caching, and SPA fallback patterns.
- Current project-team extension trust hashing excludes `dist/` and only includes `package.json` plus supported source files.

### Target architecture

- Add a dual-mode workstation source contract.
- `srcDoc` mode remains the existing source-compatible authoring path.
- `frameBundle` mode lets an extension declare a relative bundle root plus declared entrypoint, styles, and assets.
- Browser execution remains isolated in an iframe for both modes.
- For bundle mode, Console renders an iframe `src` pointing at a daemon-generated frame shell route.
- For bundle mode, the bridge token is carried in the URL fragment so it is available to iframe JavaScript but is not sent as a server-side route parameter.
- The daemon-generated frame shell injects or references the bridge bootstrap.
- The daemon-generated frame shell loads declared bundle assets.
- The daemon-generated frame shell is served with a restrictive CSP appropriate for same-origin daemon assets plus the bridge bootstrap.
- Declared bundle assets are served from eforge-owned daemon routes, not extension-owned routes.
- Asset route lookup uses manifest metadata and stable asset ids rather than arbitrary relative path request parameters.
- Bundle assets are required to live under the hash-included conventional directory `workstation-assets/`.
- `@eforge-build/client` remains the owner of daemon route constants and manifest wire schemas.
- Console must not inline `/api/...` routes.
- Console must not redeclare daemon response shapes.
- `@eforge-build/extension-sdk/browser` exposes a small browser-safe helper layer for bundled workstation code.
- `@eforge-build/extension-sdk/browser` must not import Node-only code.
- `@eforge-build/extension-sdk/browser` must not import TypeBox-heavy server APIs.
- `@eforge-build/extension-sdk/browser` must not import private Console modules.
- Engine/build orchestration remains unchanged.
- This feature lives in extension SDK types, engine extension registration/manifest projection, monitor daemon routes, client/browser contracts, Console workstation rendering, tests, and docs.

### Design decisions

1. Support iframe bundle workstations, not parent-Console plugins.
2. Bundle JavaScript executes only inside a workstation iframe.
3. Parent Console never imports extension React, CSS, or JavaScript into its own realm.
4. Keep `srcDoc` source-compatible.
5. Existing `registerConsoleWorkstation({ srcDoc })` extensions continue to work.
6. Add an explicit bundle declaration named `frameBundle`.
7. `frameBundle.root` is a relative directory under the extension directory.
8. `frameBundle.entrypoint` is a relative path inside `root` for the primary JavaScript module.
9. `frameBundle.styles` is an optional list of relative CSS paths inside `root`.
10. `frameBundle.assets` is an optional list of additional relative asset paths inside `root`.
11. `frameBundle.browserSdkVersion` is initially literal `1` or omitted to mean v1.
12. `srcDoc` and `frameBundle` are mutually exclusive in a single workstation registration.
13. Use stable asset ids in the manifest and routes.
14. The daemon manifest should expose URLs or route-addressable ids for the generated frame shell and declared assets.
15. Asset serving should map stable asset ids back to validated registration metadata.
16. Asset serving should not accept arbitrary filesystem paths from the browser.
17. Require hash-covered bundle roots.
18. Bundle roots should be constrained to the conventional hash-included directory `workstation-assets/`.
19. Update extension directory hashing to include `workstation-assets/` files needed for browser bundles while continuing to avoid broad `dist/` hashing.
20. Avoid a project-team trust record covering only source while serving mutable untrusted built assets.
21. Serve bundle workstations through daemon-generated frame shells.
22. Console iframe uses `src` for bundle workstations instead of `srcDoc`.
23. The `src` URL includes a fragment carrying the per-render bridge token.
24. The frame shell reads the token from `location.hash`.
25. The frame shell installs `window.eforge`.
26. The frame shell loads declared bundle JS/CSS from eforge-owned asset routes.
27. Preserve the bridge security model.
28. Console still checks source window.
29. Console still checks bridge token.
30. Console still resolves only manifest-allowed action ids.
31. Bundle mode does not get direct daemon API access beyond ordinary browser fetch capabilities and the supported bridge/SDK.
32. Add a browser SDK as the supported integration surface.
33. Add `@eforge-build/extension-sdk/browser` with browser-safe helpers such as `getEforgeConsoleBridge()` or `invokeAction()`.
34. The SDK wraps the injected `window.eforge` bridge.
35. The SDK provides TypeScript types for browser bundle authors.
36. The SDK starts minimal with action invocation and bridge version checks.
37. Theme, resize, subscriptions, and richer lifecycle hooks are follow-up capabilities.
38. Use CSP/cache headers on frame and asset routes.
39. Frame route should be no-cache.
40. Frame route should include a restrictive CSP compatible with the generated shell and same-origin declared assets.
41. Asset routes should use content-addressed asset ids.
42. Asset routes should use immutable cache headers.
43. Document direct React loading as intentionally unsupported.
44. Extension authors may use React inside their iframe bundle if they bundle it themselves.
45. Extension authors must not import private Console React/components.
46. Extension authors must not expect to share parent Console context.

### Breaking and migration implications

- The daemon API version must be bumped because the extension contribution manifest and workstation routes change.
- Existing source extensions using `srcDoc` must continue to validate and render.
- First-party clients should reject stale daemons through the existing daemon API version check before relying on bundle workstation manifest fields or routes.

### Code impact

- `packages/extension-sdk/src/contributions.ts`
  - Add source types for bundle workstations while keeping `srcDoc` source-compatible.
  - Define `ConsoleWorkstationFrameBundle` or equivalent.
  - Ensure `defineConsoleWorkstation` accepts either `srcDoc` or `frameBundle`, not both.

- `packages/extension-sdk/src/browser.ts` or equivalent new browser-safe SDK entrypoint
  - Add a minimal browser SDK for iframe workstation bundles.
  - Export helpers/types without Node-only imports or private Console imports.
  - Update `packages/extension-sdk/package.json` exports to include `./browser`.

- `packages/client/src/extension-contributions.ts`
  - Add client-owned TypeBox schemas/types for dual-mode workstation manifest entries.
  - Add frame-bundle manifest fields such as render source, frame URL, asset metadata, and browser SDK version.
  - Keep parsing helpers authoritative.

- `packages/client/src/routes/route-map.ts`
  - Add route constants for eforge-owned workstation frame and asset routes.
  - Bump `DAEMON_API_VERSION` in `packages/client/src/api-version-const.ts` with migration notes.

- `packages/engine/src/extensions/types.ts`
  - Add engine registration shape for `frameBundle` workstations.

- `packages/engine/src/extensions/contribution-validation.ts`
  - Validate exactly one of `srcDoc` or `frameBundle`.
  - Validate `frameBundle.root`, `entrypoint`, `styles`, and `assets` as safe relative paths.
  - Reject absolute paths.
  - Reject traversal.
  - Reject separators that escape the root.
  - Reject empty segments.
  - Reject null bytes.
  - Validate browser SDK version if present.

- `packages/engine/src/extensions/manifest.ts`
  - Project bundle workstations into the client-owned manifest shape with frame/asset route references.
  - Keep `allowedActions` projection unchanged.

- `packages/engine/src/extensions/hash.ts`
  - Include the conventional bundle asset root `workstation-assets/` in project-team extension content hashes.
  - Preserve symlink rejection and deterministic path/content hashing.

- `packages/monitor/src/routes/extensions/` and route registration
  - Add route handlers/services for workstation frame shell serving.
  - Add route handlers/services for declared asset serving.
  - Reuse shared response/static-asset utilities where appropriate instead of duplicating JSON or text response helpers.
  - Route handlers must not redeclare client-owned wire response shapes.
  - Route handlers must not inline route constants outside the route map pattern.

- `packages/monitor/src/http/static-assets.ts` or a new focused helper
  - Reuse MIME, cache, path containment, realpath, and symlink rejection behavior for extension workstation assets.
  - Keep new implementation files under 600 lines.
  - Add balanced region markers if any large existing files are touched.

- `packages/console-ui/src/views/workstations/`
  - Update `WorkstationIframe` or split into source-specific renderers.
  - Keep existing `srcDoc` path using `buildWorkstationSrcDoc`.
  - Add bundle iframe `src` path with fragment-carried bridge token.
  - Keep `handleWorkstationBridgeEvent` source-window/token/action validation semantics.
  - Add tests for `srcDoc` mode.
  - Add tests for bundle mode.
  - Add tests for bridge validation.
  - Add tests for disallowed actions.

- `eforge/extensions/eforge-plan/` or examples
  - Add or update a small dogfood/example bundle workstation only if it stays small and helps validate the API.
  - Do not make the full eforge-plan workstation UX part of this slice.

### Likely tests to add or update

- `packages/client/src/__tests__/extension-contributions.test.ts`
- `packages/monitor/src/__tests__/routes-extension-contributions.test.ts`
- `packages/monitor/src/__tests__/routes-extensions.test.ts` or new focused workstation asset route tests
- `packages/monitor/src/__tests__/http-static-assets.test.ts` patterns if shared static helpers change
- `packages/console-ui/src/views/workstations/__tests__/workstations-view.test.tsx`
- `packages/console-ui/src/views/workstations/__tests__/workstation-srcdoc.test.ts`
- `packages/console-ui/src/views/workstations/__tests__/workstation-bridge.test.ts`
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` if the dogfood extension changes

### Documentation impact

- Update `docs/extensions.md`.
- `docs/extensions.md` must describe both `srcDoc` and iframe bundle workstation modes.
- `docs/extensions.md` must state that bundle workstations execute inside sandboxed iframes and use the versioned browser SDK/action bridge.
- `docs/extensions.md` must keep direct React/private Console imports and parent-Console plugins explicitly unsupported.
- Update `docs/extensions-api.md`.
- `docs/extensions-api.md` must update `registerConsoleWorkstation` reference with the new `frameBundle` source shape and manifest/runtime status.
- `docs/extensions-api.md` must update SDK stability/migration guidance to mention browser SDK versioning and daemon API version implications.
- Update `packages/extension-sdk/README.md`.
- `packages/extension-sdk/README.md` must add a concise bundle workstation example using `frameBundle` and `@eforge-build/extension-sdk/browser`.
- `packages/extension-sdk/README.md` must clarify that authors may bundle React or another browser framework inside the iframe.
- `packages/extension-sdk/README.md` must clarify that authors must not import private Console code.
- Update `packages/console-ui/README.md`.
- `packages/console-ui/README.md` must update the Workstations data flow to include bundle frame/asset serving.
- `packages/console-ui/README.md` must update `Adding a new control surface` guidance to distinguish first-party Console routes, declarative System contributions, `srcDoc` workstations, and bundle workstations.
- Update `eforge/extensions/eforge-plan/README.md` or examples if a small dogfood/example bundle is added.
- Run `pnpm docs:generate` if source docs require generated public docs updates.
- Run `pnpm docs:check` and include generated changes needed for it to pass.

### Risks and mitigations

- **Trust gap for built assets**: current project-team extension hashes exclude `dist/`, so serving arbitrary built assets could bypass trust review. Mitigation: constrain bundle roots to a hash-included conventional directory such as `workstation-assets/` and update hashing/tests accordingly.
- **Path traversal or symlink escape**: browser asset routes may expose extension filesystem paths if implemented naively. Mitigation: route by stable asset id, resolve only declared assets, use realpath containment, reject symlinks, reject traversal, and test encoded traversal.
- **Parent Console coupling**: authors may try to import private Console React/components. Mitigation: do not expose parent React loading; document iframe-only browser SDK; add no APIs that pass parent Console internals into bundles.
- **CSP fragility**: iframe shell needs script/style loading while staying restrictive. Mitigation: start with a generated shell and same-origin declared asset routes; test CSP header presence and keep policy documented. If strict nonce/hash CSP proves too large for this slice, implement a conservative policy and document the follow-up.
- **Bridge token leakage**: bundle iframe needs a token but the daemon route should not receive it as a query parameter. Mitigation: pass token in URL fragment and have the frame shell read `location.hash`.
- **Route/wire drift**: manifest and route changes can break stale clients. Mitigation: define schemas/routes in `@eforge-build/client`, bump daemon API version, and update first-party parse tests.
- **Scope creep into package lifecycle**: installing/building frontend bundles can become a package manager problem. Mitigation: this slice supports serving declared, already-present static assets; it does not add install/update/remove/build pipelines for frontend packages.
- **Oversized files**: extension/monitor/Console files are already sizable in places. Mitigation: add focused helper modules where needed and keep new implementation files under 600 lines per project policy.
- **Browser SDK overreach**: adding theme, resize, subscriptions, or AI APIs now could delay core bundle support. Mitigation: v1 browser SDK is action invocation plus version check only; richer lifecycle hooks are follow-ups.

## Scope

This is a runtime implementation plan, not a design-only note.

In scope:

- Keep the existing `srcDoc` workstation model source-compatible for extension authors.
- Add a second workstation render mode for iframe-scoped asset bundles.
- Render bundle workstations inside Console-owned sandboxed iframes.
- Continue using the same parent action bridge semantics for bundle workstations.
- Add a minimal browser-safe SDK export for workstation code at `@eforge-build/extension-sdk/browser`.
- Let bundle authors call the parent bridge without importing private Console code.
- Add client-owned manifest and route contracts for bundle-backed workstations.
- Add client-owned manifest and route contracts for eforge-owned workstation asset/frame serving.
- Add engine extension validation/manifest projection for the new bundle declaration.
- Add daemon routes that serve only eforge-owned generated workstation frame shells.
- Add daemon routes that serve only declared bundle assets.
- Enforce path containment for daemon asset serving.
- Enforce MIME handling for daemon asset serving.
- Enforce symlink rejection for daemon asset serving.
- Enforce cache/CSP headers for daemon frame and asset serving.
- Update Console workstation rendering to choose between existing `srcDoc` rendering and new iframe bundle frame rendering.
- Update trust hashing so project-team bundle assets are covered by local trust review rather than being mutable untrusted files outside the hash.
- Update docs and examples to describe `srcDoc` vs bundle workstations.
- Update docs and examples to explicitly reject parent-Console React/plugin loading.

Out of scope:

- Do not support direct React component loading into parent Console.
- Do not support private imports from `packages/console-ui`.
- Do not support parent Console shadcn/Radix/components as an extension API.
- Do not support parent Console components as an extension API.
- Do not support Module Federation.
- Do not support arbitrary independently loaded parent-Console plugins.
- Do not add raw extension-owned HTTP routes.
- Do not add extension-owned AI planning/chat APIs.
- Do not remove existing `srcDoc` workstation registrations.
- Do not break existing `srcDoc` workstation registrations.
- Do not add install/update/remove/build pipelines for frontend packages.

Design stance:

- Rich extension browser UI may be bundled and independently authored, but it must execute inside an iframe workstation boundary.
- Parent Console remains a first-party React app.
- Extension browser JavaScript does not run in the parent realm.
- Browser bundle capabilities are exposed through a versioned bridge/SDK, not through private Console imports.

## Acceptance Criteria

- Existing `registerConsoleWorkstation({ id, title, srcDoc, allowedActions })` source registrations validate successfully.
- Existing `registerConsoleWorkstation({ id, title, srcDoc, allowedActions })` source registrations render through the current sandboxed iframe `srcDoc` path.
- Extension authors can register a bundle-backed workstation with a `frameBundle.root` declaration.
- Extension authors can register a bundle-backed workstation with a `frameBundle.entrypoint` declaration.
- Extension authors can register a bundle-backed workstation with optional `frameBundle.styles`.
- Extension authors can register a bundle-backed workstation with optional `frameBundle.assets`.
- Extension authors can register a bundle-backed workstation with `frameBundle.browserSdkVersion` set to `1`.
- Omitting `frameBundle.browserSdkVersion` is treated as browser SDK version 1.
- Workstation registration validation rejects registrations that provide both `srcDoc` and `frameBundle`.
- Workstation registration validation rejects registrations that provide neither `srcDoc` nor `frameBundle`.
- Workstation registration validation rejects absolute `frameBundle` paths.
- Workstation registration validation rejects empty `frameBundle` paths.
- Workstation registration validation rejects `frameBundle` paths that contain traversal.
- Workstation registration validation rejects `frameBundle` paths that contain null bytes.
- Workstation registration validation rejects `frameBundle` paths that escape the declared bundle root.
- Workstation registration validation rejects `frameBundle` paths with separators that escape the declared bundle root.
- Workstation registration validation rejects unsupported browser SDK versions.
- Bundle roots are constrained to the conventional hash-included directory `workstation-assets/`.
- Project-team extension content hashing includes declared workstation bundle assets under the supported hash-included bundle root.
- Project-team extension content hashing continues to avoid broad `dist/` hashing.
- Project-team extension content hashing preserves symlink rejection.
- Project-team extension content hashing preserves deterministic path/content hashing.
- The extension contribution manifest exposes client-owned metadata for Console to distinguish `srcDoc` workstations from bundle-backed workstations.
- The extension contribution manifest exposes client-owned metadata for bundle frame route references.
- The extension contribution manifest exposes client-owned metadata for declared bundle asset references.
- `DAEMON_API_VERSION` is bumped for bundle workstation manifest and route support.
- The daemon API version bump includes a migration note for bundle workstation manifest and route support.
- First-party clients reject stale daemons through the existing daemon API version check before relying on bundle workstation manifest fields.
- First-party clients reject stale daemons through the existing daemon API version check before relying on bundle workstation routes.
- The monitor daemon serves bundle workstation frame shells from an `API_ROUTES` route owned by `@eforge-build/client`.
- The monitor daemon serves declared bundle assets from an `API_ROUTES` route owned by `@eforge-build/client`.
- The monitor daemon does not serve undeclared bundle asset ids.
- Bundle asset route lookup maps stable asset ids back to validated registration metadata.
- Bundle asset route lookup does not accept arbitrary filesystem paths from the browser.
- Bundle asset serving rejects missing assets.
- Bundle asset serving rejects undeclared asset ids.
- Bundle asset serving rejects traversal attempts.
- Bundle asset serving rejects malformed encoding.
- Bundle asset serving rejects symlink escapes.
- Bundle asset serving enforces realpath containment.
- Bundle frame shell responses include a `Content-Security-Policy` header.
- Bundle frame shell responses use no-cache semantics.
- Bundle asset responses use correct MIME types for JavaScript assets.
- Bundle asset responses use correct MIME types for CSS assets.
- Bundle asset responses use content-addressed URLs or ids.
- Bundle asset responses use immutable cache semantics.
- Console renders `srcDoc` workstations with the existing `srcDoc` iframe behavior.
- Console renders bundle-backed workstations with iframe `src` pointing at the daemon frame shell.
- Console does not execute bundle-backed extension JavaScript in the parent Console realm.
- Console passes the per-render bridge token to bundle-backed workstation frames in the iframe URL fragment.
- Console does not send the per-render bridge token as a daemon route query parameter.
- Bundle frame shell JavaScript reads the bridge token from `location.hash`.
- Bundle frame shell JavaScript installs `window.eforge`.
- Bundle frame shell JavaScript loads declared bundle JavaScript from eforge-owned asset routes.
- Bundle frame shell JavaScript loads declared bundle CSS from eforge-owned asset routes.
- Bundle-backed workstation frames can invoke manifest-allowed extension actions through the existing parent bridge.
- Bundle-backed workstation frames receive a disallowed-action error when invoking an action outside the manifest allowlist.
- Console bridge handling continues to validate source window.
- Console bridge handling continues to validate bridge token.
- Console bridge handling continues to validate JSON-object input.
- Console bridge handling continues to validate manifest-allowed action ids.
- `@eforge-build/extension-sdk/browser` exports a browser-safe helper for invoking workstation actions through the injected bridge.
- `@eforge-build/extension-sdk/browser` exports a browser-safe helper for bridge version checks.
- `@eforge-build/extension-sdk/browser` provides TypeScript types for browser bundle authors.
- `@eforge-build/extension-sdk/browser` has no Node-only imports.
- `@eforge-build/extension-sdk/browser` does not import `packages/console-ui` modules.
- `@eforge-build/extension-sdk/browser` does not import private Console modules.
- The v1 browser SDK does not expose theme APIs.
- The v1 browser SDK does not expose resize APIs.
- The v1 browser SDK does not expose subscription APIs.
- The v1 browser SDK does not expose richer lifecycle hooks.
- Documentation states that extension authors may bundle React inside an iframe workstation.
- Documentation states that extension authors may bundle another browser framework inside an iframe workstation.
- Documentation states that extension authors must not import private Console React components.
- Documentation states that extension authors must not import parent Console context.
- Documentation states that extension authors must not import private Console CSS as an extension API.
- Documentation states that parent-Console plugins are intentionally unsupported.
- Documentation describes `srcDoc` workstation authoring.
- Documentation describes bundle-backed workstation authoring.
- Documentation describes the trust boundary for bundle-backed workstations.
- Documentation describes the CSP boundary for bundle-backed workstations.
- Documentation describes asset-serving boundaries for bundle-backed workstations.
- Documentation describes the browser SDK boundary for bundle-backed workstations.
- Documentation describes the iframe lifecycle boundary for bundle-backed workstations.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0 after any generated documentation updates.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Informational validation notes from planning:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Existing V1 workstations use iframe `srcDoc` with a parent action bridge and no same-origin sandbox permission. | Read `packages/console-ui/src/views/workstations/workstation-iframe.tsx`, `workstation-srcdoc.ts`, and `workstation-bridge.ts`. The iframe uses `sandbox="allow-scripts"`; the helper injects `window.eforge.invokeAction`; bridge validation checks source window, token, JSON input, and allowed action. | high | low | Run workstation Console tests. | Bundle implementation could accidentally weaken or duplicate the wrong boundary. |
| Current manifest/wire contract has no bundle asset model. | Read `packages/client/src/extension-contributions.ts`; `ConsoleWorkstationManifestEntrySchema` currently has `srcDoc` and `allowedActions`. | high | low | Re-run client contribution tests after schema changes. | The implementation could duplicate an existing hidden contract; validated absent. |
| Current extension source API has only `srcDoc` for workstations. | Read `packages/extension-sdk/src/contributions.ts`; `ConsoleWorkstation` requires `srcDoc`. | high | low | Re-run extension SDK type-check. | Source compatibility requirements would differ if bundle support already existed. |
| Current project-team trust hashing does not cover broad built asset directories. | Read `packages/engine/src/extensions/hash.ts`; directory hashes include `package.json` and supported source extensions and exclude `node_modules`, `dist`, and `.git`. | high | low | Add tests for hash inclusion/exclusion after implementation. | Serving bundle assets without hash changes would bypass trust review. |
| Monitor static serving has reusable containment/MIME/cache patterns. | Read `packages/monitor/src/http/static-assets.ts` and static UI tests. It uses realpath containment, symlink rejection, MIME mapping, and immutable cache for first-party assets. | high | low | Reuse or adapt helpers and run monitor static tests. | New asset serving could regress security or duplicate logic. |
| Route and manifest contracts must be client-owned. | Project AGENTS instructions and existing guard tests require route constants and daemon wire shapes in `@eforge-build/client`; existing Console guard tests reject hardcoded `/api/` literals. | high | low | Run guard tests and `pnpm type-check`. | Route drift or local wire shape declarations would violate project policy. |
| Passing bridge tokens in URL fragments is acceptable for this local-first iframe shell. | Browser fragments are not sent in HTTP requests, and iframe script can read `location.hash`. This was not runtime-tested during planning. | medium | low | Add a Console/JS DOM test or focused browser test that builds the bundle iframe URL and frame shell script reads fragment token. | If fragment access behaves unexpectedly in sandboxed iframes, bridge initialization would fail; fallback is generated `srcDoc` shell with module asset scripts. |
| A minimal browser SDK should start with action invocation only. | The selected implementation is intentionally pragmatic, and the existing bridge only supports action invocation. Theme/resize/subscription APIs require additional design. | high | low | Keep SDK API small in code review; record follow-up backlog items for richer lifecycle if needed. | Over-scoping SDK v1 could delay bundle support or create unstable commitments. |

No low-confidence/high-impact assumptions remain unresolved.

The main medium-confidence detail is fragment-carried bridge-token behavior in sandboxed frame routes; the implementation plan includes tests and an obvious fallback path.