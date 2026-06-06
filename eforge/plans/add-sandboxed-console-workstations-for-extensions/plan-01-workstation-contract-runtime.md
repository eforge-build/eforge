---
id: plan-01-workstation-contract-runtime
name: Workstation Contract, SDK, and Runtime Projection
branch: add-sandboxed-console-workstations-for-extensions/plan-01-workstation-contract-runtime
agents:
  builder:
    effort: high
    rationale: Adds a new cross-package extension contribution family and required
      client-owned manifest field; all existing typed consumers and fixtures
      must move together.
  reviewer:
    effort: high
    rationale: The plan changes public SDK/client contracts and daemon manifest
      projection, requiring careful API and compatibility review.
---

# Workstation Contract, SDK, and Runtime Projection

## Architecture Context

Console workstation metadata must flow through the existing extension contribution manifest instead of adding extension-owned HTTP routes. `@eforge-build/client` remains the source of truth for daemon wire shapes; the extension SDK exposes author-facing types; the engine only records and projects extension registrations. The existing contribution manifest route continues to serve all families and the existing action invocation route remains the only browser-to-daemon action path.

V1 workstation content is manifest-carried iframe `srcDoc` HTML. No extension static asset route, bundle serving, shared React import, Module Federation, or raw extension HTTP route is part of this plan.

## Implementation

### Overview

Add a new `consoleWorkstations` contribution family across the client schema, SDK, engine recorder/registry/projection, daemon route fixtures, and existing Console System consumers. The manifest entry produced for Console has effective, namespaced action IDs in `allowedActions`, while extension authors can declare local action IDs in the SDK. When `allowedActions` is omitted, projection derives the allowlist from actions registered by the same extension path/name.

### Contract shape

Use this V1 shape unless implementation discovers an existing naming convention that requires a minor rename:

```ts
interface ConsoleWorkstationManifestEntry {
  id: string;
  localId: string;
  extensionName: string;
  extensionPath: string;
  title: string;
  description?: string;
  schemaVersion: 1;
  srcDoc: string;
  allowedActions: string[]; // effective manifest action ids
}

interface ConsoleWorkstation {
  id: string;
  title: string;
  description?: string;
  srcDoc: string;
  allowedActions?: string[]; // local action ids registered by the same extension
}
```

`allowedActions` is intentionally local-author-facing in the SDK and effective-wire-facing in the manifest. This keeps author examples stable while letting Console validate without duplicating engine ID rules.

### Key Decisions

1. Keep workstations as a new top-level manifest family. They are not `ConsoleContributionBlockSchema` entries and do not add an `iframe` renderer to the closed System block union.
2. Make `consoleWorkstations` a required array in `ExtensionContributionManifestResponseSchema`, with existing tests and fixtures updated to include `[]` where no workstations exist.
3. Bump `DAEMON_API_VERSION` because first-party Console will depend on the required manifest field.
4. Validate explicit workstation `allowedActions` against same-extension action registrations during registry merge. Omitted `allowedActions` derives all same-extension action registrations during manifest projection.
5. Add the rough eforge-plan workstation in this plan after SDK/runtime support exists; Console rendering lands in the next plan.

## Scope

### In Scope

- Client schema/type/export additions for workstation manifest entries.
- Browser-safe client exports for workstation schemas/types.
- Required `consoleWorkstations` manifest array and API version bump.
- Extension SDK `ConsoleWorkstation`, bridge-related author-facing types if needed, `defineConsoleWorkstation`, and `EforgeExtensionAPI.registerConsoleWorkstation`.
- Engine recorder state, validation, duplicate diagnostics, same-extension allowed-action validation, manifest projection, registry projection/details/counts, loader/replay empty-state support.
- Daemon contribution route tests proving the enlarged manifest returns workstations through `API_ROUTES.extensionContributionManifest`.
- Existing Console System consumers updated to handle the required array and registration count/details without declaring daemon wire interfaces.
- eforge-plan proof-of-concept workstation registration that renders visible status/hello content and calls `window.eforge.invokeAction('render-board-markdown', {})` through the documented helper name.
- Targeted test or fixture proving the eforge-plan workstation registration includes the documented action call and allowlist.

### Out of Scope

- Console Workstations route, iframe renderer, and postMessage bridge implementation; those land in plan 02.
- Extension asset bundle serving, cache invalidation, trust hashing for generated assets, or extension HTTP routes.
- Direct React component loading from extensions.
- New Pi, Claude Code, MCP, or CLI workstation discovery UX.

## Files

### Create

- `test/eforge-plan-workstation.test.ts` — targeted dogfood test that invokes the eforge-plan factory with a stub API and asserts one workstation is registered, `allowedActions` includes `render-board-markdown`, and `srcDoc` calls `window.eforge.invokeAction('render-board-markdown'`.

### Modify

- `packages/client/src/extension-contributions.ts` — add `ConsoleWorkstationManifestEntrySchema`, exported type, required `consoleWorkstations` array on `ExtensionContributionManifestResponseSchema`, and parse coverage.
- `packages/client/src/browser.ts` — export workstation schema/type through the browser-safe entry point.
- `packages/client/src/types.ts` — add `consoleWorkstations` to `ExtensionRegistrationSummary`, add `ConsoleWorkstationDetail`, add optional `consoleWorkstationDetails`, and include the family in extension test deferred registration types.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` with a v57 note for required workstation manifest support.
- `packages/client/src/__tests__/extension-contributions.test.ts` — accept valid workstation manifests, reject invalid workstation entries, retain rejection of `iframe` System blocks, and add `consoleWorkstations: []` to no-workstation fixtures.
- `packages/extension-sdk/src/contributions.ts` — add `ConsoleWorkstation`, optional `allowedActions`, `defineConsoleWorkstation`, and any minimal browser bridge type aliases needed by docs.
- `packages/extension-sdk/src/api.ts` — import `ConsoleWorkstation` and add `registerConsoleWorkstation(workstation: ConsoleWorkstation): void`.
- `packages/extension-sdk/src/index.ts` — export workstation types and helper.
- `packages/engine/src/extensions/types.ts` — add workstation spec/registration types, recorder state field, API shape method, loaded registration counts, and registry field.
- `packages/engine/src/extensions/contribution-validation.ts` — add `validateConsoleWorkstationSpec` with local ID, title, description, non-empty `srcDoc`, JSON-safe shape, and optional local action-id allowlist validation.
- `packages/engine/src/extensions/recorder.ts` — record `registerConsoleWorkstation`, merge duplicate IDs, validate explicit allowed action IDs against accepted same-extension actions, and emit invalid/duplicate diagnostics.
- `packages/engine/src/extensions/manifest.ts` — project workstation registrations into client-owned manifest entries, resolve explicit allowed actions to effective IDs, derive same-extension allowed actions when omitted, and expose `buildConsoleWorkstationDetails`.
- `packages/engine/src/extensions/projector.ts` — include workstation details and totals in extension registry projection.
- `packages/engine/src/extensions/loader.ts` — initialize/diff workstation registration counts.
- `packages/engine/src/extensions/replay.ts` — include the family in empty counts, deferred registration summaries, and replay projection.
- `packages/engine/src/extensions/index.ts` — export workstation spec/registration/detail helpers needed by monitor/tests.
- `packages/engine/src/eforge.ts` — add the empty registry field used by engine fallback state.
- `packages/monitor/src/routes/extensions/discovery-service.ts` — add `consoleWorkstations: 0` to empty registration summaries and attach `consoleWorkstationDetails` from projections.
- `packages/monitor/src/routes/extensions/trust-service.ts` — inherit the updated empty registration summary.
- `packages/monitor/src/__tests__/routes-extension-contributions.test.ts` — seed a workstation in the test extension and assert the manifest route returns it in a schema-valid body.
- `packages/console-ui/src/views/system/system-types.ts` — re-export workstation manifest/detail types from `@eforge-build/client/browser` only.
- `packages/console-ui/src/views/system/use-system-surfaces.ts` — include `consoleWorkstations` in contribution-empty detection.
- `packages/console-ui/src/views/system/extension-contribution-rendering.ts` — include `consoleWorkstations` in `manifestHasEntries`.
- `packages/console-ui/src/lib/selectors/system.ts` — include workstation counts in contribution summary selectors.
- `packages/console-ui/src/views/system/extension-contributions-section.tsx` — show workstation family counts while keeping System declarative cards unchanged.
- `packages/console-ui/src/views/system/extensions-section.tsx` and `packages/console-ui/src/views/system/extension-management-details.tsx` — display workstation registration counts/details alongside other extension families.
- `eforge/extensions/eforge-plan/index.ts` — import `defineConsoleWorkstation` and register the rough `board-workstation` proof-of-concept after actions are registered.
- Existing tests with manifest or registration fixtures — add `consoleWorkstations: []` and `consoleWorkstations: 0` where needed. Start with the files returned by `rg -l "consoleContributions: \\[|consoleContributions: 0|deepLinks: \\[|deepLinks: 0|registrations: \\{" packages/console-ui/src test packages/monitor/src packages/client/src packages/engine/src`.

## Verification

- [ ] `safeParseExtensionContributionManifest` returns success for a manifest containing one `consoleWorkstations` entry with `srcDoc` and effective `allowedActions`.
- [ ] `safeParseExtensionContributionManifest` returns failure when a workstation entry omits `srcDoc`, has an invalid `schemaVersion`, or carries non-string `allowedActions`.
- [ ] `ConsoleContributionBlockSchema` still rejects `{ rendererId: 'iframe' }`.
- [ ] `EforgeExtensionAPI` accepts `registerConsoleWorkstation(defineConsoleWorkstation(...))` in TypeScript tests.
- [ ] Engine registration capture stores a valid workstation with effective id `<extensionName>:<localId>`.
- [ ] Engine registration capture emits `extension:invalid-registration` for an invalid workstation local ID.
- [ ] Engine registration merge emits `extension:duplicate-registration` for duplicate workstation IDs and keeps the first registration.
- [ ] Manifest projection outputs `consoleWorkstations` sorted by id and omits handlers/module objects from serialized JSON.
- [ ] A workstation with explicit local `allowedActions` projects effective action IDs.
- [ ] A workstation without `allowedActions` projects same-extension action IDs and no actions from another extension.
- [ ] The daemon contribution manifest route returns `consoleWorkstations` through `API_ROUTES.extensionContributionManifest` and the body validates with the client schema.
- [ ] Existing Console System tests pass with no local workstation daemon wire interface.
- [ ] The eforge-plan test observes one proof-of-concept workstation whose HTML calls `window.eforge.invokeAction('render-board-markdown'`.
- [ ] `pnpm type-check` exits 0 after the required manifest/count fields update all consumers.
