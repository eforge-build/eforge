---
id: plan-01-platform-contracts
name: Define SDK registration methods plus client-owned TypeBox manifest/action
  wire contracts, helpers, exports, and daemon API v52 bump.
branch: build-extension-platform-foundation-for-kernel-boundary-extraction/platform-contracts
---

# Platform Contracts

## Architecture Reference

This module implements the SDK registration families and client-to-daemon route contract described in the architecture sections **SDK registration families**, **Manifest wire shape**, **Action invocation wire shape**, and **Client to daemon route contract**.

Key constraints from architecture:
- Public SDK and daemon/client wire contracts land before runtime consumers.
- `@eforge-build/client` owns route constants, TypeBox schemas, derived wire types, Node helpers, passive `IfRunning` helpers, browser helpers, and the daemon API version bump.
- Action input schemas are TypeBox object-root schemas at the SDK boundary.
- The manifest route and action invocation route use client-owned route constants: `extensionContributionManifest` and `extensionActionInvoke`.
- Manifest wire entries expose safe metadata only and never expose handler functions, handler source text, imported module objects, or raw secrets.
- Browser-safe exports must not import Node-only daemon client modules.
- Do not edit `packages/client/src/types.ts` unless the new manifest module cannot carry the required types; this plan keeps all new contribution/invocation wire shapes in `packages/client/src/extension-contributions.ts`.

## Scope

### In Scope
- Add public SDK types for extension actions, Console contributions, integration commands, deep links, action bindings, and action handler context.
- Add `EforgeExtensionAPI` methods named `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`.
- Add SDK identity helpers for action/contribution/command/deep-link type inference.
- Add client-owned TypeBox schemas and `Static<>`-derived types for contribution manifests and action invocation request/response envelopes.
- Add client-owned route constants for `GET /api/extensions/contributions` and `POST /api/extensions/actions/invoke`.
- Add Node client helpers and passive `IfRunning` variants for fetching the manifest and invoking actions.
- Add browser-safe helpers for fetching the manifest and invoking actions.
- Add parse/safe-parse helpers for the new client schemas.
- Bump `DAEMON_API_VERSION` from 51 to 52 and update the version guard test.
- Add focused SDK and client contract tests.

### Out of Scope
- Engine registry recording, ID resolution, duplicate detection, manifest projection, action dispatch, and runtime timeout handling.
- Daemon route handler registration, HTTP status mapping, and action lifecycle event emission.
- Console rendering of contribution blocks.
- Pi, Claude/MCP, and CLI user-facing command surfaces.
- Documentation, examples, generated docs, and plugin manifest changes; those belong to `docs-examples-compat` and `host-integration-surfaces`.
- Raw extension-owned HTTP routes or browser plugin bundle contracts.

## Implementation Approach

### Overview

Implement this as an additive public contract layer. The SDK gains author-facing registration methods and type inference helpers, while `@eforge-build/client` gains the closed wire protocol consumed by all later modules. The engine and daemon modules will consume these contracts without redefining request/response shapes.

Keep the contract split explicit:

- SDK spec types describe what extension authors register and include handler functions.
- Client manifest types describe what the daemon returns and exclude handlers.
- Client invocation types describe daemon request/response envelopes and caller provenance.

### Contract Shape

Use the following shape as the implementation target; exact comments can be shorter in source.

```ts
// --- eforge:region plan-01-platform-contracts ---
export interface EforgeExtensionAPI {
  registerAction<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
    action: ExtensionAction<TInput, TOutput>,
  ): void;
  registerConsoleContribution(contribution: ConsoleContribution): void;
  registerIntegrationCommand(command: IntegrationCommand): void;
  registerDeepLink(deepLink: ExtensionDeepLink): void;
}

export interface ExtensionAction<TInput extends TObject = TObject, TOutput extends TSchema | undefined = undefined> {
  id: string;
  title: string;
  description?: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  sideEffects?: ExtensionActionSideEffect[];
  handler: (
    input: Static<TInput>,
    ctx: ExtensionActionContext,
  ) => ExtensionActionOutput<TOutput> | Promise<ExtensionActionOutput<TOutput>>;
}
// --- eforge:endregion plan-01-platform-contracts ---
```

In the SDK, action bindings reference extension-local action IDs. The engine module resolves these to effective manifest IDs.

In `@eforge-build/client`, use `id` as the effective namespaced ID on all manifest entries and include `localId` plus `extensionName`/`extensionPath` for provenance. Do not include `effectiveId` on the wire unless a downstream module proves a compatibility need; keeping one wire ID avoids host confusion.

### Key Decisions

1. **Additive SDK methods keep existing extensions compiling.** Existing native extension methods remain available, and the committed guardrails extension requires no forced migration in this module.
2. **SDK action input uses `TInput extends TObject`.** This enforces object-root TypeBox input schemas at compile time; runtime validation is still implemented by `engine-registry-runtime`.
3. **Output schemas use `TOutput extends TSchema | undefined`.** Actions without an output schema can return unknown JSON values; actions with an output schema infer the handler return type from `Static<TOutput>`.
4. **Client manifest schemas use closed object shapes.** Set `additionalProperties: false` on manifest entries, action invocation request/response envelopes, action bindings, and requested-by objects so handler-like fields are rejected by schema tests.
5. **Manifest schema version is `1`.** Export `EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION = 1` and require `schemaVersion: 1` on the manifest response and Console contribution entries.
6. **Action invocation failures remain typed on non-2xx responses.** The browser helper and Node action helper parse a valid `ExtensionActionInvokeResponse` body even when `Response.ok` is false. Transport failures, non-JSON bodies, and schema-invalid bodies still throw.
7. **Create a small daemon-client status helper if needed.** If the existing `daemonRequest` helper would discard typed non-2xx action failure bodies, add an internal exported helper in `packages/client/src/daemon-client.ts` such as `daemonRequestWithStatus` and `daemonRequestWithStatusIfRunning`; keep existing helper behavior unchanged.
8. **Route additions get API v52.** The architecture requires first-party stale-daemon detection for these routes even though the constant comments classify some additions as non-breaking.
9. **No `packages/client/src/types.ts` edits.** The manifest module imports or redefines any needed TypeBox diagnostic wire schema locally inside `@eforge-build/client`; existing extension-management projections are a downstream engine concern.

## Files

### Create

- `packages/extension-sdk/src/contributions.ts` — SDK author-facing contracts for `ExtensionAction`, `ExtensionActionContext`, `ExtensionActionSideEffect`, `ExtensionActionBinding`, `ConsoleContribution`, `ConsoleContributionBlock`, `ConsoleContributionRendererId`, `IntegrationCommand`, `ExtensionDeepLink`, and identity helpers `defineExtensionAction`, `defineConsoleContribution`, `defineIntegrationCommand`, and `defineExtensionDeepLink`.
- `packages/client/src/extension-contributions.ts` — TypeBox schemas, constants, derived `Static<>` types, and parse/safe-parse helpers for manifest entries, requested-by metadata, action invocation requests, action invocation responses, JSON-safe values, and failure codes.
- `packages/client/src/api/extension-contributions.ts` — Node helpers `apiGetExtensionContributionManifest`, `apiGetExtensionContributionManifestIfRunning`, `apiInvokeExtensionAction`, and `apiInvokeExtensionActionIfRunning`.
- `packages/client/src/browser-extension-contributions.ts` — browser-safe `fetchExtensionContributionManifest` and `invokeExtensionAction` helpers using `API_ROUTES`, `fetch`, and the new schema parse helpers.
- `packages/client/src/__tests__/extension-contributions.test.ts` — schema and export tests for manifest/invocation TypeBox contracts.
- `test/browser-extension-contributions-helpers.test.ts` — fetch-stub route/method/body tests for browser helpers, including typed non-2xx action failure parsing.
- `test/extension-contribution-client-helpers.test.ts` — real ephemeral HTTP server tests for Node helpers and `IfRunning` behavior if these cases do not fit in `test/client-no-start-api-helpers.test.ts`.

### Modify

- `packages/extension-sdk/src/api.ts` — import contribution types from `./contributions.js` and add `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` to `EforgeExtensionAPI`.
- `packages/extension-sdk/src/index.ts` — export new contribution types and identity helpers from `./contributions.js`.
- `packages/client/src/routes.ts` — add `API_ROUTES.extensionContributionManifest = '/api/extensions/contributions'` and `API_ROUTES.extensionActionInvoke = '/api/extensions/actions/invoke'` beside existing extension-management routes.
- `packages/client/src/daemon-client.ts` — add non-breaking status-preserving daemon request helpers only if `apiInvokeExtensionAction` cannot preserve typed non-2xx response bodies through existing helpers.
- `packages/client/src/index.ts` — export new schemas/types/parse helpers from `./extension-contributions.js` and Node helpers from `./api/extension-contributions.js` `[region: platform-contracts, after existing extension API exports and before optional host dispatcher exports]`.
- `packages/client/src/browser.ts` — export browser-safe contribution manifest/action helpers and all browser-safe contribution wire types/schemas `[region: platform-contracts, after existing browser-safe recovery/queue helper exports]`.
- `packages/client/src/api-version-const.ts` — set `DAEMON_API_VERSION` to `52` and prepend a concise v52 rationale for contribution manifest and action invocation routes.
- `test/extension-sdk-example.test.ts` — add compile-time SDK smoke coverage for the four new API methods, exported types, and identity helpers.
- `test/client-no-start-api-helpers.test.ts` — add the new `IfRunning` helpers to the passive no-daemon helper matrix, unless covered by the new focused client-helper test.
- `test/daemon-api-version.test.ts` — expect `52` with a test name that states the extension contribution/action route rationale.

## Detailed Contract Requirements

### SDK Contributions

`packages/extension-sdk/src/contributions.ts` must:

- Import `TObject`, `TSchema`, and `Static` from `./schema.js`.
- Import `ExtensionLogger` from `./context.js`.
- Import or re-export `ExtensionActionRequestedBy` and `ExtensionActionRequestedByHost` from `@eforge-build/client` so SDK consumers can type action context provenance from one package.
- Define `ExtensionActionSideEffect` as a closed string union matching the client side-effect schema. Use this initial set unless implementation evidence requires a smaller set: `none`, `local-read`, `local-write`, `network`, `daemon-state`, `build-queue`.
- Define `ExtensionActionContext` with `invocationId`, `actionId`, `requestedBy`, `cwd`, and `logger`.
- Define `ExtensionActionBinding` with `actionId` and optional `inputDefaults: Record<string, unknown>`.
- Define Console renderer blocks for `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Define `IntegrationCommand` with `id`, `label`, optional `description`, optional object-root `inputSchema`, and an action binding.
- Define `ExtensionDeepLink` with `id`, `label`, optional `description`, optional `urlTemplate`, and optional action binding. Runtime validation in the engine module rejects registrations without either `urlTemplate` or action binding.

### Client Manifest and Invocation Schemas

`packages/client/src/extension-contributions.ts` must export:

- `EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION`.
- `ExtensionJsonValueSchema` and `ExtensionJsonObjectSchema` for JSON-safe request/response payloads.
- `ExtensionActionRequestedByHostSchema` and `ExtensionActionRequestedBySchema`.
- `ExtensionActionSideEffectSchema`.
- `ExtensionActionBindingManifestSchema` with effective `actionId` and optional `inputDefaults`.
- `ConsoleContributionRendererIdSchema` and `ConsoleContributionBlockSchema`.
- `ExtensionActionManifestEntrySchema`.
- `ConsoleContributionManifestEntrySchema`.
- `IntegrationCommandManifestEntrySchema`.
- `ExtensionDeepLinkManifestEntrySchema`.
- `ExtensionContributionManifestResponseSchema`.
- `ExtensionActionInvokeRequestSchema`.
- `ExtensionActionInvokeErrorCodeSchema` with `unknown-action`, `invalid-request`, `invalid-input`, `handler-error`, `timeout`, `invalid-output`, and `output-schema-failed`.
- `ExtensionActionInvokeSuccessResponseSchema`, `ExtensionActionInvokeFailureResponseSchema`, and `ExtensionActionInvokeResponseSchema`.
- `Static<>` types for every public schema above.
- `safeParseExtensionContributionManifest`, `parseExtensionContributionManifest`, `safeParseExtensionActionInvokeRequest`, `parseExtensionActionInvokeRequest`, `safeParseExtensionActionInvokeResponse`, and `parseExtensionActionInvokeResponse`.

### Client Helper Behavior

Node helper behavior:

- `apiGetExtensionContributionManifest({ cwd })` performs `GET API_ROUTES.extensionContributionManifest`.
- `apiGetExtensionContributionManifestIfRunning({ cwd })` performs the same request only when a live daemon lockfile exists and returns `null` otherwise.
- `apiInvokeExtensionAction({ cwd, body })` performs `POST API_ROUTES.extensionActionInvoke` with an `ExtensionActionInvokeRequest` body and returns a parsed `ExtensionActionInvokeResponse` for both success and typed failure response bodies.
- `apiInvokeExtensionActionIfRunning({ cwd, body })` preserves the same response behavior and returns `null` when no live daemon exists.
- All helper implementations call `parseExtensionContributionManifest` or `parseExtensionActionInvokeResponse` before returning data.

Browser helper behavior:

- `fetchExtensionContributionManifest(init?)` performs a relative `GET` using `API_ROUTES.extensionContributionManifest` and returns a parsed manifest.
- `invokeExtensionAction(body, init?)` performs a relative `POST` using `API_ROUTES.extensionActionInvoke`, sets `Content-Type: application/json`, and returns a parsed invocation response for 2xx and schema-valid non-2xx bodies.
- Browser helpers must not import `daemon-client.ts`, `lockfile.ts`, `api-version.ts`, `node:*`, or any Node-only module.

## Testing Strategy

### Unit Tests

- In `packages/client/src/__tests__/extension-contributions.test.ts`, validate that a full manifest containing one action, one Console contribution, one integration command, one deep link, and one diagnostic passes `safeParseExtensionContributionManifest`.
- In the same file, validate that manifest action entries containing `handler`, `module`, or `source` fields fail schema validation.
- Validate that every allowed `requestedBy.host` value (`console`, `pi`, `claude`, `mcp`, `cli`) passes and an unknown host fails.
- Validate that `ExtensionActionInvokeRequestSchema` rejects non-object `input` values.
- Validate that `ExtensionActionInvokeResponseSchema` accepts success and every failure code.
- Validate that `ConsoleContributionBlockSchema` accepts each renderer ID and rejects an unknown renderer ID.
- In `test/extension-sdk-example.test.ts`, add compile-time stubs that call all four new API methods and use all four identity helpers.

### Integration Tests

- In `test/browser-extension-contributions-helpers.test.ts`, stub `globalThis.fetch` and assert browser helpers use `API_ROUTES.extensionContributionManifest` and `API_ROUTES.extensionActionInvoke` with the expected methods, body, and JSON header.
- In the browser helper test, return HTTP 400 with a valid `ExtensionActionInvokeFailureResponse` JSON body and assert `invokeExtensionAction` resolves to `{ ok: false, error: { code: 'invalid-input', ... } }`.
- In the Node helper test, use a real ephemeral HTTP server plus a real lockfile to assert `apiGetExtensionContributionManifestIfRunning` and `apiInvokeExtensionActionIfRunning` route to the new constants and parse response bodies.
- In `test/client-no-start-api-helpers.test.ts` or the focused helper test, assert the new `IfRunning` helpers return `null` with no lockfile.
- In `test/daemon-api-version.test.ts`, assert `DAEMON_API_VERSION` equals `52`.

## Downstream Handoff

`engine-registry-runtime` consumes SDK types and client manifest types from this module. It owns runtime validation of local IDs, object-root schemas beyond TypeScript checks, binding resolution, duplicate effective IDs, safe metadata projection, and action dispatch.

`daemon-action-routes` consumes `API_ROUTES`, request/response schemas, requested-by schemas, and action invocation response types from this module. It owns HTTP status mapping and lifecycle events.

`console-contribution-rendering` imports only from `@eforge-build/client/browser` for manifest fetching and action invocation.

`host-integration-surfaces` imports Node helpers and manifest/invocation types from `@eforge-build/client`; it must keep extension-management dispatch separate from extension-authored action dispatch.

## Verification

- [ ] `packages/extension-sdk/src/api.ts` contains `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` on `EforgeExtensionAPI`.
- [ ] `@eforge-build/extension-sdk` exports `ExtensionAction`, `ConsoleContribution`, `IntegrationCommand`, `ExtensionDeepLink`, and the four identity helpers.
- [ ] TypeScript rejects an SDK `registerAction` call whose `inputSchema` is not assignable to `TObject`.
- [ ] `API_ROUTES.extensionContributionManifest` equals `/api/extensions/contributions`.
- [ ] `API_ROUTES.extensionActionInvoke` equals `/api/extensions/actions/invoke`.
- [ ] `ExtensionContributionManifestResponseSchema` validates a manifest with all four contribution families.
- [ ] `ExtensionContributionManifestResponseSchema` rejects a manifest action entry with a `handler` field.
- [ ] `ExtensionActionInvokeRequestSchema` rejects an invocation request whose `input` is an array, string, number, boolean, or null.
- [ ] `ExtensionActionInvokeResponseSchema` validates success plus all seven failure codes.
- [ ] `apiGetExtensionContributionManifestIfRunning` returns `null` when no daemon lockfile exists.
- [ ] `apiInvokeExtensionActionIfRunning` returns `null` when no daemon lockfile exists.
- [ ] `fetchExtensionContributionManifest` uses `API_ROUTES.extensionContributionManifest` and HTTP `GET` in the browser helper test.
- [ ] `invokeExtensionAction` uses `API_ROUTES.extensionActionInvoke`, HTTP `POST`, and `Content-Type: application/json` in the browser helper test.
- [ ] `invokeExtensionAction` resolves a schema-valid HTTP 400 action failure body instead of throwing.
- [ ] `packages/client/src/browser.ts` has no import from `daemon-client`, `lockfile`, `api-version`, or `node:`.
- [ ] `DAEMON_API_VERSION` equals `52` and `test/daemon-api-version.test.ts` names the v52 route-contract reason.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/extension-sdk-example.test.ts packages/client/src/__tests__/extension-contributions.test.ts test/browser-extension-contributions-helpers.test.ts test/extension-contribution-client-helpers.test.ts test/daemon-api-version.test.ts` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["api", "code"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
