---
id: plan-04-console-contribution-rendering
name: Render declarative extension Console contributions in the System route and
  invoke bound actions through browser-safe client helpers.
branch: build-extension-platform-foundation-for-kernel-boundary-extraction/console-contribution-rendering
---

# Console Contribution Rendering

## Architecture Reference

This module implements the architecture sections **Console contribution model**, **Console renderer contract**, **Runtime flow**, and the Console-owned portion of **Client to daemon route contract**.

Key constraints from architecture:
- Console consumes only browser-safe exports from `@eforge-build/client/browser`; it must not import monitor route modules, engine extension helpers, Node daemon-client helpers, or raw `/api/...` literals.
- Contributions render inside the existing `/console/system` route near the current Extensions section; no new top-level Console route is added in this slice.
- Console renders a closed declarative renderer set only: `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Markdown blocks use the existing sanitized `SafeMarkdown` pattern.
- Action buttons and forms invoke actions through the browser-safe `invokeExtensionAction` helper with `requestedBy.host: 'console'` and visible success/failure state.
- Extension-authored frontend JavaScript, React bundles, and raw HTTP routes remain out of scope.
- `packages/console-ui/src/views/system/extensions-section.tsx` is shared; this module owns new registration-count rendering and any delegation to a contribution section.

## Scope

### In Scope
- Fetch `ExtensionContributionManifestResponse` as an independent System surface using the browser-safe manifest helper from `@eforge-build/client/browser`.
- Add load/error/empty state for the manifest under `SystemSurfacesState.extensions`.
- Render an `ExtensionContributionsSection` in `/console/system` immediately after `ExtensionsSection`.
- Render all initial Console renderer IDs: `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Invoke action-bound button and form blocks through `invokeExtensionAction` with Console provenance and per-action in-flight/result UI.
- Generate simple form controls from top-level object-root TypeBox/JSON-schema properties for strings, numbers, integers, booleans, and enums; use JSON textareas for nested or unsupported fields.
- Display manifest diagnostics and family counts for actions, Console contributions, integration commands, and deep links.
- Add Extensions section badges for new registration totals and safe detail counts added by `engine-registry-runtime`.
- Add Console tests for manifest fetching, System state integration, renderer coverage, sanitized markdown, link URL filtering, action invocation success/failure, and form submission.
- Update `packages/console-ui/README.md` control-surface guidance to distinguish source-owned routes from daemon-manifest declarative contributions.

### Out of Scope
- SDK registration contracts, client wire schemas, route constants, browser helper implementation, and API version bump.
- Engine registry recording, manifest projection, and action runtime dispatch.
- Daemon route registration, HTTP status mapping, action lifecycle event persistence, and reducer handling for `extension:action:*` events.
- Pi, Claude/MCP, and CLI contribution discovery or invocation surfaces.
- Public docs, SDK README, generated docs, and extension examples outside `packages/console-ui/README.md`.
- Arbitrary extension-owned HTTP routes.
- Extension-supplied browser JavaScript, React components, or independently bundled Console plugins.
- Session-plan or playbook extraction.

## Implementation Approach

### Overview

Extend the existing System route data flow instead of creating a new route. `useSystemSurfaces()` starts a manifest request alongside the existing health/config/extensions/playbook/model requests. `SystemViewContent` passes `state.extensions.contributions` to a new `ExtensionContributionsSection`, rendered next to the existing Extensions panel.

The contribution section uses manifest entries and action entries from `@eforge-build/client/browser` types. It builds an action lookup keyed by effective action ID, renders each Console contribution card, and routes action-bound blocks to `invokeExtensionAction`. It never constructs daemon URLs directly.

Expected page composition after implementation:

```tsx
{/* --- eforge:region plan-04-console-contribution-rendering --- */}
<ExtensionsSection
  list={state.extensions.list}
  validate={state.extensions.validate}
/>

<ExtensionContributionsSection
  manifest={state.extensions.contributions}
/>
{/* --- eforge:endregion plan-04-console-contribution-rendering --- */}
```

The exact `ConsoleContributionBlock` field names come from `packages/client/src/extension-contributions.ts` after dependency modules land. Implement the render switch against the client-owned discriminant (`rendererId` per the platform plan) and make the switch exhaustive so future renderer IDs create a TypeScript error until Console support is added.

### Renderer Behavior

- `text`: render plain text with React text nodes only.
- `markdown`: render through `SafeMarkdown` from `@/components/recovery/safe-markdown`; do not use `dangerouslySetInnerHTML` in new contribution components.
- `status-badge`: map manifest tone/status metadata to existing `Badge` variants; unknown tones render as `outline` with the raw label text.
- `link`: render an `<a>` only when `sanitizeContributionHref()` accepts the URL. Allow `http:`, `https:`, `mailto:`, and Console-relative paths beginning with `/console/`. Render a disabled row with `Blocked unsafe link` for `javascript:`, `data:`, `vbscript:`, invalid URLs, and other schemes.
- `action-button`: invoke the bound effective action ID with `binding.inputDefaults ?? {}`. Disable the button while that block has an in-flight request.
- `action-form`: find the bound action entry by effective action ID, render form controls from `action.inputSchema`, merge submitted values over `binding.inputDefaults`, then invoke the same browser helper.

### Action Invocation UI

For each action-bound block, store local invocation state keyed by `contribution.id`, block index/id, and action ID:

- `idle`
- `running`
- `success` with `invocationId` and optional compact JSON output preview
- `failure` with error code/message from a typed action response or transport error message

Every terminal state is rendered in an `aria-live="polite"` region. Failures also use `role="alert"`. Success output may be shown in a collapsed `<details>` block and truncated to a fixed display limit (for example 4 KiB) to keep large JSON responses from expanding the System page.

All invocation requests include Console provenance. Use only fields accepted by `ExtensionActionRequestedBySchema`; the minimum request metadata is:

```ts
// --- eforge:region plan-04-console-contribution-rendering ---
const requestedBy = {
  host: 'console',
  contributionId: contribution.id,
} satisfies ExtensionActionRequestedBy;
// --- eforge:endregion plan-04-console-contribution-rendering ---
```

### Form Generation Rules

`action-form` rendering uses the action manifest `inputSchema`:

- Read top-level `properties` and `required` from the object-root schema.
- `type: 'string'`: text input, or `<select>` when `enum` is present.
- `type: 'number'` and `type: 'integer'`: number input; reject `NaN` before invoking and show a field error.
- `type: 'boolean'`: checkbox.
- Nested objects, arrays, nullable unions, and unsupported schema shapes: textarea containing JSON; parse before invoking and show a field error when JSON parsing fails.
- Optional empty primitive fields are omitted from the submitted input object unless a default value exists.
- Browser-side form validation remains a convenience layer; daemon TypeBox validation remains authoritative.

### Key Decisions

1. **Render in System as a sibling section.** The System route already owns extensions and diagnostics, and a sibling section avoids bloating `ExtensionsSection` with manifest/action UI.
2. **Keep `ExtensionsSection` edits limited to totals.** New registration-count badges belong in the existing Extensions section; contribution cards and action UI live in new focused files.
3. **Use browser-safe client helpers only.** `fetchExtensionContributionManifest` and `invokeExtensionAction` centralize route constants, parsing, and typed non-2xx action failure bodies.
4. **Sanitize markdown and filter link protocols in Console.** Engine validation keeps metadata JSON-safe, but Console still treats rendered markdown and URLs as untrusted content.
5. **Use local per-block invocation state.** Action invocations are daemon-scoped operations, not build-session state; the System page shows immediate request results without mutating run-state reducers.
6. **No automatic top-level navigation changes.** Declarative contributions ship as System panels; future top-level contribution routing requires a separate navigation and renderer-compatibility design.
7. **Split renderer files before they exceed policy thresholds.** Keep each new TS/TSX file under 300 lines where feasible; if a file grows past 300 lines, add durable semantic region markers and keep it below the 600-line new implementation limit.

## Files

### Create
- `packages/console-ui/src/views/system/extension-contributions-section.tsx` — System section wrapper for manifest loading/error/empty states, family count badges, manifest diagnostics, and contribution card list.
- `packages/console-ui/src/views/system/extension-contribution-card.tsx` — renders one `ConsoleContributionManifestEntry`, performs exhaustive renderer dispatch, and delegates action-bound blocks to shared action controls.
- `packages/console-ui/src/views/system/extension-action-form.tsx` — primitive schema-driven form renderer, input/default merging, field-level parse errors, submit handling, and visible invocation results.
- `packages/console-ui/src/views/system/extension-contribution-rendering.ts` — pure helpers for action lookup, requested-by metadata, URL filtering, status tone-to-badge mapping, JSON preview formatting, and form value coercion.
- `packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx` — component coverage for renderer IDs, empty/error states, sanitized markdown, safe/unsafe links, action button invocation, typed action failure display, and form submission.

### Modify
- `packages/console-ui/src/views/system/system-types.ts` — import/export contribution manifest and invocation-related browser types; add `extensions.contributions: Loadable<ExtensionContributionManifestResponse>` and `SystemSurfaceKey` entry `extensions.contributions`.
- `packages/console-ui/src/views/system/system-fetches.ts` — add `fetchSystemExtensionContributionManifest(signal?)` that calls `fetchExtensionContributionManifest({ signal })` or the dependency module's equivalent browser-helper signature; do not call `fetchJson` with a raw route.
- `packages/console-ui/src/views/system/use-system-surfaces.ts` — initialize, load, preserve stale data for, and error-handle `extensions.contributions` independently from `extensions.list` and `extensions.validate`.
- `packages/console-ui/src/views/system/system-view-content.tsx` — import and render `ExtensionContributionsSection` immediately after `ExtensionsSection`.
- `packages/console-ui/src/views/system/extensions-section.tsx` — add badges for `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks`; optionally show compact safe detail counts when `ExtensionEntry` detail arrays exist `[region: console-contribution-rendering, inside the existing registration totals block and extension-row metadata only]`.
- `packages/console-ui/src/lib/selectors/system.ts` — change local extension registration totals to derive from `ExtensionListResponse['totals']`; add manifest summary selectors for renderer counts, family counts, and diagnostics count.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — cover `fetchSystemExtensionContributionManifest` and update extension totals fixtures for the four new fields.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — add manifest fixtures to `SystemSurfacesState`, assert the contribution section appears after Extensions, and cover stale-data-with-error rendering.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — add selector coverage for manifest family counts and renderer counts.
- `packages/console-ui/README.md` — update **Adding a new control surface** guidance. Shared-file issue: the architecture also lists this file under `docs-examples-compat` without a Shared File Registry entry. Proposed boundary: this module edits only the `Adding a new control surface` section; `docs-examples-compat` owns broader docs wording, generated docs, examples, and integration docs.

## Testing Strategy

### Unit Tests
- `extension-contribution-rendering.ts` helper coverage through `extension-contributions-section.test.tsx` or a focused helper test:
  - `sanitizeContributionHref()` accepts `https://example.test`, `http://example.test`, `mailto:user@example.test`, and `/console/system`.
  - `sanitizeContributionHref()` rejects `javascript:alert(1)`, `data:text/html,...`, `vbscript:...`, `file:///tmp/x`, and malformed URLs.
  - Status tone mapping returns deterministic badge variants for success, warning, danger/error, neutral, and unknown tone values.
  - JSON preview formatting truncates output beyond the chosen display limit.
  - Form value coercion omits optional empty fields and rejects invalid numbers/JSON before invoking.
- `selectExtensionContributionManifestSummary()` returns counts for actions, Console contributions, integration commands, deep links, diagnostics, and each renderer ID.

### Component Tests
- Empty manifest renders `No Console contributions discovered` and still shows family counts when actions/commands/deep links exist.
- Manifest load error without stale data renders an alert in the contribution section and does not hide the existing Extensions section.
- Manifest load error with stale data renders the alert plus stale contribution cards.
- A manifest containing `text`, `markdown`, `status-badge`, and `link` blocks renders their labels/content.
- Markdown containing `<script>` or inline event handler markup renders no executable/script HTML in the DOM.
- Unsafe link renderer blocks display `Blocked unsafe link` and contain no anchor with the unsafe `href`.
- `action-button` click calls the browser helper with the effective action ID, `inputDefaults`, and `requestedBy.host === 'console'` plus `contributionId`.
- A successful action response displays the invocation ID and a success message.
- A typed failure response displays the failure code/message with `role="alert"`.
- A rejected helper promise displays the transport/schema error message with `role="alert"`.
- `action-form` renders primitive fields from an action input schema, merges edited values over defaults, and sends the resulting object to the browser helper.
- `action-form` blocks submission and displays a field error when a number field contains `NaN` text or a JSON textarea contains invalid JSON.

### Integration Tests
- `system-fetches.test.ts` stubs `globalThis.fetch` through the real browser helper and asserts the request uses `API_ROUTES.extensionContributionManifest`.
- `useSystemSurfaces` behavior is covered by rendering `SystemViewContent` with representative `SystemSurfacesState` fixtures; add assertions that the contribution section coexists with daemon/config/profile/model sections.
- Existing Planning Workspace tests remain unchanged; this module does not modify session-plan or playbook fetchers.

## Verification

- [ ] `SystemSurfacesState.extensions.contributions` exists and uses `Loadable<ExtensionContributionManifestResponse>`.
- [ ] `SystemSurfaceKey` contains `extensions.contributions`.
- [ ] `fetchSystemExtensionContributionManifest` imports a browser-safe client helper and contains no `/api/` string literal.
- [ ] `useSystemSurfaces()` sets `extensions.contributions.status` to `success` when the manifest helper resolves with at least one family entry or diagnostic.
- [ ] `useSystemSurfaces()` sets `extensions.contributions.status` to `empty` when all manifest family arrays and diagnostics are empty.
- [ ] `useSystemSurfaces()` preserves previous manifest data when a refresh fails.
- [ ] `SystemViewContent` renders `ExtensionContributionsSection` immediately after `ExtensionsSection`.
- [ ] `ExtensionsSection` renders nonzero badges for `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` totals.
- [ ] `ExtensionContributionsSection` renders manifest family count badges for actions, Console contributions, integration commands, and deep links.
- [ ] `ExtensionContributionsSection` renders manifest diagnostics with severity text and messages.
- [ ] Renderer dispatch covers `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form` literals with an exhaustive TypeScript switch.
- [ ] Markdown contribution blocks render through `SafeMarkdown`; new contribution components contain no `dangerouslySetInnerHTML` usage.
- [ ] The markdown sanitization test finds no `<script>` element after rendering malicious markdown.
- [ ] Link contribution blocks reject `javascript:` URLs in the component test.
- [ ] `action-button` invokes `invokeExtensionAction` with `requestedBy.host` equal to `console` and `requestedBy.contributionId` equal to the effective contribution ID.
- [ ] `action-button` disables its button while the invocation promise is pending.
- [ ] Successful action invocation renders a success message and invocation ID.
- [ ] Typed action failure invocation renders the failure code and message with `role="alert"`.
- [ ] Transport/helper rejection renders the thrown error message with `role="alert"`.
- [ ] `action-form` renders controls for string, number, integer, boolean, and enum fields from an object-root action input schema.
- [ ] `action-form` submits an input object that merges `inputDefaults` with user-entered values.
- [ ] `action-form` displays a field error and does not invoke the helper when a JSON textarea contains invalid JSON.
- [ ] `packages/console-ui/README.md` states that daemon-manifest declarative contributions belong under System and do not require edits to `src/lib/navigation.ts`.
- [ ] `packages/console-ui/README.md` states that arbitrary extension-supplied frontend bundles are deferred beyond this slice.
- [ ] `pnpm --filter @eforge-build/console-ui test -- src/views/system/__tests__/extension-contributions-section.test.tsx src/views/system/__tests__/system-fetches.test.ts src/views/system/__tests__/system-view-content.test.tsx src/views/system/__tests__/system-selectors.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
