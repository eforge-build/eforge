---
id: plan-02-console-workstation-rendering
name: Render srcDoc and frameBundle workstations in sandboxed iframes and
  preserve bridge validation semantics.
branch: implement-iframe-bundled-console-workstation-sdk/console-workstation-rendering
---

# Console Workstation Rendering

## Architecture Reference

This module implements the `console-workstation-rendering` implementation guide, the `Frame shell and bridge contract` section, and the `Monitor serving -> Console rendering` integration contract from the architecture.

Key constraints from architecture:
- `@eforge-build/client` owns the workstation manifest union. Console consumes `ConsoleWorkstationManifestEntry` and related variant types from `@eforge-build/client/browser`; it must not redeclare daemon wire shapes.
- Existing `srcDoc` workstations keep the current `buildWorkstationSrcDoc()` iframe path and remain source-compatible for manifest consumers.
- Bundle-backed workstations render only as sandboxed iframes with `src={frameBundle.frameUrl + fragment}`; parent Console never injects bundle scripts, styles, React, or assets into its own DOM realm.
- The per-render bridge token is appended as a URL fragment parameter, not a route path segment or query parameter.
- Both modes keep `sandbox="allow-scripts"` and omit `allow-same-origin`.
- `handleWorkstationBridgeEvent()` keeps the existing source-window, bridge-token, JSON-object input, and manifest-allowed action validation semantics.
- Console consumes the `frameBundle.frameUrl` supplied by the manifest and must not inline `/api/...` route literals in non-test source.

## Scope

### In Scope
- Add Console-local helpers for narrowing the client-owned workstation manifest union.
- Add a Console-local helper that appends the bridge token to bundle frame URLs as `#bridgeToken=<encoded-token>`.
- Refactor `WorkstationIframe` to render either a `srcDoc` iframe or a `frameBundle` iframe source.
- Preserve delayed iframe loading until the parent message listener is registered, for both `srcDoc` and bundle modes.
- Preserve bridge invocation through `invokeExtensionAction` and `handleWorkstationBridgeEvent`.
- Update workstation view, bridge, and selector tests to cover both workstation modes and union-safe fixtures.

### Out of Scope
- Client TypeBox schemas, route constants, browser exports, and daemon API version changes.
- Extension SDK source registration types and `@eforge-build/extension-sdk/browser` helpers.
- Engine registration validation, manifest projection, asset id generation, and trust hashing.
- Monitor frame-shell generation, CSP/cache headers, asset serving, and frame-shell token parsing.
- Documentation source or generated public docs updates.
- Any parent-Console plugin model, direct React loading, private Console imports, or extension-owned HTTP routes.

## Implementation Approach

### Overview

After `client-contracts` lands, `ConsoleWorkstationManifestEntry` is a union of a `srcDoc` variant and a `frameBundle` variant. Console will narrow that union locally using imported client types, then choose a render source in `WorkstationIframe`.

The component will continue to create a fresh bridge token per workstation id. It will derive a pending source description from the selected workstation and token:

- `srcDoc` variant: call `buildWorkstationSrcDoc(workstation.srcDoc, bridgeToken)`.
- `frameBundle` variant: call `buildWorkstationFrameUrl(workstation.frameBundle.frameUrl, bridgeToken)`.

`WorkstationIframe` will keep the existing delayed-load pattern. It renders the iframe with no `src`/`srcDoc` on the first render, installs the `message` event listener in `useLayoutEffect`, then records the derived source in state. The committed iframe attributes are applied only when the loaded state matches the current workstation id, mode, and source value. This preserves the current protection against iframe scripts posting bridge messages before the parent listener exists.

Bridge handling remains mode-agnostic. The message listener still calls `handleWorkstationBridgeEvent({ event, sourceWindow: iframeRef.current?.contentWindow ?? null, workstation, bridgeToken, invokeAction: invokeExtensionAction })`. No bundle-specific action path is added.

### Key Decisions

1. Use `in`-operator type guards backed by imported client types. This narrows the client-owned manifest union without creating local daemon response interfaces.
2. Keep one `WorkstationIframe` component instead of separate exported components. The iframe shell markup, bridge listener registration, sandbox settings, and title/test id stay shared.
3. Load both modes only after `useLayoutEffect` registers the message listener. Bundle iframes can execute frame-shell JavaScript immediately after navigation, so the current delayed `srcDoc` pattern must also cover `src` mode.
4. Build the bundle iframe URL with a focused helper that strips any pre-existing fragment, preserves path and query text, and appends only `#bridgeToken=${encodeURIComponent(token)}`. This makes the no-query-token invariant testable.
5. Consume `frameBundle.frameUrl` directly from the manifest. Console does not build workstation frame routes from ids and does not import new route constants for this render path.
6. Do not render bundle `entrypoint`, `styles`, or `assets` in parent Console. Those asset refs exist for diagnostics and monitor/frame-shell consumers; Console only points the iframe at `frameUrl`.
7. Keep `handleWorkstationBridgeEvent()` logic unchanged except for test fixture updates. The source-window, token, JSON-object, and allowed-action checks already apply to both workstation modes.

## Files

### Create
- `packages/console-ui/src/views/workstations/workstation-frame-url.ts` — builds the bundle iframe `src` value from `frameBundle.frameUrl` and the current bridge token `[region: console-workstation-rendering, frame URL helper]`.
  - Export `buildWorkstationFrameUrl(frameUrl: string, bridgeToken: string): string`.
  - Remove any existing `#...` fragment from `frameUrl` before appending the bridge-token fragment.
  - Preserve existing path and query text.
  - Do not import `API_ROUTES` or include hardcoded `/api/...` route literals.
- `packages/console-ui/src/views/workstations/workstation-manifest-mode.ts` — narrow imported workstation manifest variants without declaring new wire shapes `[region: console-workstation-rendering, manifest mode guards]`.
  - Export `SrcDocWorkstationManifestEntry` and `FrameBundleWorkstationManifestEntry` type aliases from client exports or `Extract<ConsoleWorkstationManifestEntry, ...>`.
  - Export `isFrameBundleWorkstation(workstation)` and `isSrcDocWorkstation(workstation)` helpers.
  - Do not define local interfaces that repeat client-owned workstation fields.
- `packages/console-ui/src/views/workstations/__tests__/workstation-frame-url.test.ts` — unit tests for fragment construction and query preservation `[region: console-workstation-rendering, frame URL tests]`.

### Modify
- `packages/console-ui/src/views/workstations/workstation-iframe.tsx` — render `srcDoc` and `frameBundle` workstations through the same sandboxed iframe boundary `[region: console-workstation-rendering, dual-mode iframe renderer]`.
  - Import the new mode guard and frame URL helper.
  - Replace the single `srcDoc` memo with a discriminated render-source value such as `{ mode: 'srcDoc', value } | { mode: 'frameBundle', value }`.
  - Replace `loadedSrcDoc` with loaded-source state that records `{ workstationId, mode, value }`.
  - Keep the `window.addEventListener('message', ...)` registration before setting loaded-source state.
  - Set `srcDoc={...}` only for loaded `srcDoc` sources and `src={...}` only for loaded `frameBundle` sources.
  - Keep `sandbox="allow-scripts"`, `data-testid="workstation-iframe"`, the iframe ref, and the bridge call into `handleWorkstationBridgeEvent()`.
  - Use a key that includes workstation id and render mode, for example `${workstation.id}:${mode}`, so manifest refreshes that change mode remount the iframe.
- `packages/console-ui/src/views/workstations/__tests__/workstations-view.test.tsx` — update fixtures for the client manifest union and add dual-mode render tests `[region: console-workstation-rendering, workstation view tests]`.
  - Replace the single broad `workstation()` helper with `srcDocWorkstation()` and `frameBundleWorkstation()` helpers typed to the two imported/derived variants.
  - Keep the existing list, empty state, navigation, and not-found coverage.
  - Keep the existing `srcDoc` iframe test and add assertions that `srcdoc` contains the extension content and helper bootstrap while `src` is absent.
  - Add a bundle render test that asserts the iframe has `src`, lacks `srcdoc`, includes `#bridgeToken=` in the URL fragment, and lacks `bridgeToken` in `pathname` and `search`.
  - Add a bundle parent-realm test that renders a fixture with entrypoint/style asset URLs and asserts the parent document has no matching `<script src>` or `<link href>` elements.
- `packages/console-ui/src/views/workstations/__tests__/workstation-bridge.test.ts` — keep existing bridge validation tests and add bundle-mode fixtures `[region: console-workstation-rendering, bridge tests for frameBundle manifests]`.
  - Update the default fixture to use the `srcDoc` variant type.
  - Add a `frameBundleWorkstation()` fixture with the same `allowedActions`.
  - Add a bundle-mode allowed-action case that invokes `invokeExtensionAction` with the effective action id and `requestedBy.surface === 'workstation:<id>'`.
  - Add a bundle-mode disallowed-action case that posts an error with `code: 'disallowed-action'` and does not call `invokeExtensionAction`.
- `packages/console-ui/src/views/workstations/__tests__/workstation-selectors.test.ts` — update fixtures for the manifest union and cover selectors with mixed modes `[region: console-workstation-rendering, selector tests]`.
  - Use variant-specific fixture helpers instead of `Partial<ConsoleWorkstationManifestEntry>` for impossible source combinations.
  - Include at least one `frameBundle` workstation in the sort/select test input.
  - Keep the allowed-action resolution assertions unchanged.

## Shared Files and Edit Region Markers

The architecture registry assigns `packages/console-ui/src/views/workstations/*` to `console-workstation-rendering` as a single-owner area. The files listed above include `[region: console-workstation-rendering, ...]` annotations for bounded build coordination. No temporary `plan-\d{2}-...` source markers are required because no other module is assigned to these Console workstation files.

If a later split assigns another module to a file in this directory, use non-overlapping cleanup-targeted source markers with the compiled plan id format, for example `// --- eforge:region plan-05-console-workstation-rendering ---` and `// --- eforge:endregion plan-05-console-workstation-rendering ---`.

## Testing Strategy

### Unit Tests
- `packages/console-ui/src/views/workstations/__tests__/workstation-frame-url.test.ts`
  - `buildWorkstationFrameUrl('/frame', 'token one')` returns a string ending with `#bridgeToken=token%20one`.
  - A frame URL with query text keeps that query text and puts `bridgeToken` only in the fragment.
  - A frame URL with an existing fragment replaces that fragment with the bridge-token fragment.
  - Tokens containing `?`, `&`, `=`, `#`, and spaces are encoded through `encodeURIComponent`.
- `packages/console-ui/src/views/workstations/__tests__/workstations-view.test.tsx`
  - `srcDoc` workstation rendering keeps the current sandbox and bootstrap behavior.
  - `frameBundle` workstation rendering uses iframe `src`, not `srcdoc`, and carries the token in the fragment.
  - Bundle asset refs are not rendered as parent document scripts or stylesheets.
  - Route selection and navigation continue to use encoded workstation ids.
- `packages/console-ui/src/views/workstations/__tests__/workstation-bridge.test.ts`
  - Existing source-window, token, JSON-object input, allowed-action, disallowed-action, success, failure, and rejection cases remain green for the `srcDoc` fixture.
  - Added bundle fixture cases prove allowed and disallowed actions use the same parent bridge semantics.
- `packages/console-ui/src/views/workstations/__tests__/workstation-selectors.test.ts`
  - Sorting and selection operate over a mixed `srcDoc`/`frameBundle` array.

### Integration Tests
- Run `pnpm --filter @eforge-build/console-ui test -- src/views/workstations` for the focused Console workstation test set.
- Run `pnpm --filter @eforge-build/console-ui test -- src/__tests__/guards.test.ts` to verify Console source still has no hardcoded `/api/...` literals outside tests.
- Run `pnpm type-check` after `client-contracts` lands to validate all Console consumers against the manifest union.
- Run `pnpm maintainability:check` to validate file-size and region-marker gates.

## Verification

- [ ] A `srcDoc` workstation fixture renders an iframe whose `sandbox` attribute contains `allow-scripts` and does not contain `allow-same-origin`.
- [ ] A `srcDoc` workstation fixture renders an iframe whose `srcdoc` attribute contains the manifest HTML and `window.eforge` bootstrap text.
- [ ] A `srcDoc` workstation fixture renders an iframe with no `src` attribute value.
- [ ] A `frameBundle` workstation fixture renders an iframe whose `sandbox` attribute contains `allow-scripts` and does not contain `allow-same-origin`.
- [ ] A `frameBundle` workstation fixture renders an iframe whose `src` attribute starts with the manifest `frameBundle.frameUrl` value.
- [ ] A `frameBundle` workstation fixture renders an iframe whose URL fragment contains `bridgeToken=<non-empty encoded value>`.
- [ ] A parsed bundle iframe URL has `searchParams.has('bridgeToken') === false`.
- [ ] A parsed bundle iframe URL has `pathname.includes('bridgeToken') === false`.
- [ ] A `frameBundle` workstation fixture renders an iframe with no `srcdoc` attribute value.
- [ ] A bundle fixture with declared entrypoint and style asset URLs produces zero parent-document `script[src="<entrypoint url>"]` elements and zero parent-document `link[href="<style url>"]` elements.
- [ ] `handleWorkstationBridgeEvent()` invokes `invokeExtensionAction` for a manifest-allowed action from a `frameBundle` workstation fixture.
- [ ] `handleWorkstationBridgeEvent()` posts an error with `code: 'disallowed-action'` for a disallowed action from a `frameBundle` workstation fixture and does not call `invokeExtensionAction`.
- [ ] Existing bridge tests for non-selected source windows, invalid bridge tokens, cyclic input, daemon success responses, daemon failure responses, and invocation rejection pass.
- [ ] `pnpm --filter @eforge-build/console-ui test -- src/views/workstations` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test -- src/__tests__/guards.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
