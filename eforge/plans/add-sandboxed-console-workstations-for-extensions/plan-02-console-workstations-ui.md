---
id: plan-02-console-workstations-ui
name: Console Workstations Route and Iframe Action Bridge
branch: add-sandboxed-console-workstations-for-extensions/plan-02-console-workstations-ui
agents:
  builder:
    effort: high
    rationale: Implements a browser trust boundary with sandboxed iframes and a
      parent-owned action bridge.
  reviewer:
    effort: high
    rationale: Iframe sandboxing, postMessage validation, and daemon action
      invocation provenance are security-sensitive.
---

# Console Workstations Route and Iframe Action Bridge

## Architecture Context

Plan 01 supplies client-owned workstation manifest entries and runtime projection. This plan makes Console the sole bridge between sandboxed workstation iframe code and daemon actions. The iframe executes extension-supplied trusted HTML as `srcDoc` inside a browser sandbox; it does not receive same-origin privileges and does not import Console React internals.

Console must consume types from `@eforge-build/client/browser`, use existing browser helpers for manifest fetch/action invocation, and avoid new `/api/...` literals.

## Implementation

### Overview

Add `/console/workstations` and `/console/workstations/:workstationId`, a top-level Workstations nav item, a view that fetches the contribution manifest, a workstation list/detail layout, a sandboxed iframe renderer, and a small parent-owned postMessage bridge. The iframe receives a tiny injected browser helper at `window.eforge` with `version` and `invokeAction(actionId, input)`.

### Bridge protocol

Use these message names unless implementation discovers an existing namespacing convention:

```ts
type WorkstationInvokeActionMessage = {
  type: 'eforge:workstation:invoke-action';
  requestId: string;
  actionId: string; // local id or effective manifest id
  input: Record<string, unknown>;
};

type WorkstationActionResultMessage = {
  type: 'eforge:workstation:action-result';
  requestId: string;
  response?: ExtensionActionInvokeResponse;
  error?: { code: 'invalid-request' | 'disallowed-action' | 'bridge-error'; message: string };
};
```

The parent handler resolves a requested local action ID to `<workstation.extensionName>:<localId>` when that effective ID exists in `workstation.allowedActions`. It also accepts an already-effective ID if it exists in the allowlist. All daemon invocations use the effective ID.

### Key Decisions

1. Render iframe content with `sandbox="allow-scripts"` and never include `allow-same-origin`.
2. Validate message `source`, `type`, `requestId`, `actionId`, `input`, selected workstation id, and allowlist before invoking daemon actions.
3. Set action provenance to `{ host: 'console', surface: `workstation:${workstation.id}` }`.
4. Post typed daemon success/failure responses back to the same source frame with the original `requestId`.
5. Prefer pure helper functions for bridge validation/resolution so jsdom tests do not rely on browser sandbox enforcement.

## Scope

### In Scope

- Route parsing/canonical path generation for Workstations list/detail routes.
- Top-level Console navigation link for Workstations.
- Lazy-loaded Workstations view.
- Fetching the contribution manifest through `fetchExtensionContributionManifest`.
- Empty, loading, error, list, selected, and not-found states.
- Sandboxed iframe renderer for `ConsoleWorkstationManifestEntry.srcDoc`.
- Host-injected `window.eforge.invokeAction` helper in iframe `srcDoc`.
- Parent `postMessage` bridge using existing `invokeExtensionAction` browser helper.
- Unit tests for route parsing, empty state, list/detail rendering, sandbox attributes, bridge validation, provenance, and result posting.

### Out of Scope

- Extension asset serving or bundle path resolution.
- React component sharing or Module Federation.
- Extension-owned HTTP routes.
- Workstation-owned streaming, chat, progress, storage, or AI runtime APIs.
- CSP for all Console pages. Per-iframe `srcDoc` protections may be added if implemented inside this route.

## Files

### Create

- `packages/console-ui/src/views/workstations/index.ts` — barrel export for lazy route import.
- `packages/console-ui/src/views/workstations/workstations-view.tsx` — route-level view, fetch lifecycle, list/detail selection, empty/error states.
- `packages/console-ui/src/views/workstations/use-workstation-manifest.ts` — stale-preserving contribution manifest fetch hook using `fetchExtensionContributionManifest`.
- `packages/console-ui/src/views/workstations/workstation-selectors.ts` — pure selectors for workstation sorting, selection, and action allowlist lookup.
- `packages/console-ui/src/views/workstations/workstation-srcdoc.ts` — helper that injects the `window.eforge` bootstrap into extension `srcDoc`.
- `packages/console-ui/src/views/workstations/workstation-bridge.ts` — pure bridge validation/action-resolution/result-posting helpers.
- `packages/console-ui/src/views/workstations/workstation-iframe.tsx` — iframe component that wires sandbox attributes, `srcDoc`, ref, and bridge listener.
- `packages/console-ui/src/views/workstations/__tests__/workstation-selectors.test.ts` — selector/action resolution coverage.
- `packages/console-ui/src/views/workstations/__tests__/workstation-srcdoc.test.ts` — bootstrap injection coverage.
- `packages/console-ui/src/views/workstations/__tests__/workstation-bridge.test.ts` — source matching, allowlist, provenance, success/failure result coverage.
- `packages/console-ui/src/views/workstations/__tests__/workstations-view.test.tsx` — empty/list/detail/iframe sandbox rendering coverage.

### Modify

- `packages/console-ui/src/lib/navigation.ts` — add `workstations` and workstation detail route support, update route labels/order/nav items, encode/decode detail IDs.
- `packages/console-ui/src/app.tsx` — lazy-load Workstations view and route `/console/workstations` / detail routes to it.
- `packages/console-ui/src/components/header/control-surface-links.tsx` — update comment/test expectations if the nav item count changes; no direct hard-coded link is needed if `buildNavItems()` remains the source.
- `packages/console-ui/src/__tests__/navigation.test.ts` — route parsing/path/nav coverage for list/detail workstations.
- `packages/console-ui/src/__tests__/app.test.tsx` — mock the Workstations lazy module and assert initial render/popstate for `/console/workstations`.
- `packages/console-ui/src/__tests__/header.test.tsx` — assert the Workstations button renders and calls `onNavigate('/console/workstations')`.
- Any existing route-order or shell tests that assert exact nav counts.

## Verification

- [ ] `parseConsoleRoute('/console/workstations')` returns `workstations`.
- [ ] `parseConsoleRoute('/console/workstations/demo:board')` returns `{ id: 'workstationDetail', workstationId: 'demo:board' }` or the chosen equivalent detail object.
- [ ] `toConsolePath` maps the workstation detail route back to `/console/workstations/<encoded id>`.
- [ ] `buildNavItems()` includes a Workstations item with href `/console/workstations`.
- [ ] The Workstations view renders an empty state when `consoleWorkstations` is an empty array.
- [ ] The Workstations view lists manifest workstation titles and extension names when entries exist.
- [ ] Selecting a workstation renders an iframe with `srcDoc` derived from the manifest entry.
- [ ] The iframe `sandbox` attribute contains `allow-scripts`.
- [ ] The iframe `sandbox` attribute does not contain `allow-same-origin`.
- [ ] The injected `srcDoc` contains a `window.eforge` helper with an `invokeAction` function.
- [ ] Calling the injected `window.eforge.invokeAction('render-board-markdown', {})` helper posts an `eforge:workstation:invoke-action` message with a generated request id, action id, and input object.
- [ ] Delivering a matching bridge result message resolves or rejects the helper promise with the daemon response or bridge error.
- [ ] A bridge request from a non-selected source window results in zero `invokeExtensionAction` calls.
- [ ] A bridge request for an action absent from `workstation.allowedActions` results in zero `invokeExtensionAction` calls.
- [ ] A bridge request for an allowed local action ID invokes `invokeExtensionAction` with the effective action ID.
- [ ] A bridge request for an allowed effective action ID invokes `invokeExtensionAction` with that effective action ID.
- [ ] The invocation request carries `requestedBy.host === 'console'`.
- [ ] The invocation request carries `requestedBy.surface === `workstation:${workstation.id}``.
- [ ] A daemon success response is posted to the source frame with the original `requestId`.
- [ ] A daemon failure response is posted to the source frame with the original `requestId`.
- [ ] No Console Workstations source file declares a local daemon manifest response interface.
