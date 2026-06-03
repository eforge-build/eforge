# Engine Registry Runtime

## Architecture Reference

This module implements the architecture sections **Shared data model**, **Namespaced IDs**, **Runtime flow**, **Integration contracts between modules: Engine registry to daemon routes**, and the engine-owned portions of **Manifest wire shape**, **Action invocation wire shape**, and **Action lifecycle diagnostics/events**.

Key constraints from architecture:
- The engine records extension metadata and handler references; the daemon owns HTTP routes and event persistence; consumers render client-owned manifests.
- New action, Console contribution, integration command, and deep-link registrations store both extension-local IDs and effective namespaced IDs.
- Duplicate effective IDs across loaded extensions produce deterministic `extension:duplicate-registration` diagnostics and reject the later registration.
- Action input schemas must be TypeBox-compatible object-root schemas at runtime, not only at the SDK compile-time boundary.
- Action output must be JSON-safe before it is returned to the daemon; optional output schemas validate that JSON-safe value.
- Manifest projection must expose safe metadata only and must never expose handler functions, handler source text, imported module objects, or raw secrets.
- Invalid registrations produce extension diagnostics instead of crashing extension loading.
- `@eforge-build/client` owns daemon wire types and management projection response types. Engine code imports those types instead of redeclaring route wire shapes.
- `packages/engine/src/extensions/index.ts` is shared with `daemon-action-routes`; this module owns all new exports required by daemon routes.
- `packages/client/src/types.ts` is shared with `platform-contracts`; this module owns only existing extension-management projection metadata and registration summary additions.

## Scope

### In Scope
- Add engine mirror types and registry records for extension actions, Console contributions, integration commands, and deep links.
- Add runtime validation for local IDs, required labels/titles/descriptions, TypeBox object-root input schemas, side-effect values, JSON-safe defaults, Console renderer blocks, action bindings, and deep-link target rules.
- Resolve stable effective IDs from loaded extension identity plus extension-local IDs.
- Detect duplicate effective IDs for the four new registration families during recorder-state merge.
- Reject contribution, command, and deep-link registrations whose action bindings cannot resolve to an accepted action from the same extension.
- Update loaded-extension registration counts, registry totals, replay selection, and static test summaries for the four new families.
- Project safe metadata for list/show/validate/test extension management responses.
- Build a safe `ExtensionContributionManifestResponse` from a `NativeExtensionRegistry` using the client-owned manifest types from `platform-contracts`.
- Add an engine action dispatcher that resolves an effective action ID, validates input, invokes the trusted handler with a timeout, validates JSON-safe output, validates optional output schemas, and returns daemon-safe outcome objects without throwing across the daemon boundary.
- Export the new ID, manifest projection, and action runtime helpers from `packages/engine/src/extensions/index.ts` for the daemon route module.
- Add focused tests for registration capture, invalid registration diagnostics, duplicate diagnostics, manifest projection, action dispatch success/failure modes, replay summaries, and management projections.

### Out of Scope
- Public SDK method/type definitions; `platform-contracts` owns `packages/extension-sdk/src/*`.
- Client route constants, manifest/invocation TypeBox schemas, Node helpers, browser helpers, and API version bump; `platform-contracts` owns those files.
- Daemon HTTP route registration, HTTP status mapping, action lifecycle event persistence, and reducer/timeline handling; `daemon-action-routes` owns those files.
- Console rendering or action invocation UI; `console-contribution-rendering` owns Console surfaces.
- Pi, Claude/MCP, and CLI command/deep-link UX; `host-integration-surfaces` owns host surfaces.
- Documentation and examples; `docs-examples-compat` owns docs and example migration.
- Raw extension-owned HTTP routes, arbitrary browser JavaScript, React bundles, approval workflows, session-plan extraction, and playbook extraction.

## Implementation Approach

### Overview

Implement the new registration families as additive engine registry capabilities. The recorder accepts the SDK methods added by `platform-contracts`, validates the raw extension-authored specs, resolves effective IDs, and stores handler-bearing records in the registry. Projection helpers then convert those records into client-owned safe metadata for extension management responses and contribution manifests.

Keep three representations separate:

1. **SDK/recorder specs**: handler-bearing objects received from native extension factories. These stay engine-internal.
2. **Registry records**: validated specs plus `extensionName`, `extensionPath`, `localId`, and effective `id`.
3. **Wire/projected metadata**: client-owned manifest entries and management detail arrays that omit handlers and non-serializable module objects.

The daemon route module will call two exported helpers from this module:

- `buildExtensionContributionManifest(registry)` to return safe manifest metadata.
- `dispatchExtensionAction(registry, options)` to run one action and return a typed runtime outcome for daemon HTTP/status/event mapping.

### Effective ID Contract

Use this deterministic ID derivation in a new helper module:

```ts
// --- eforge:region plan-02-engine-registry-runtime ---
export const EXTENSION_LOCAL_CONTRIBUTION_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function resolveExtensionContributionId(extensionName: string, localId: string): string {
  return `${extensionName}:${localId}`;
}
// --- eforge:endregion plan-02-engine-registry-runtime ---
```

Implementation requirements:
- Validate every extension-local action/contribution/command/deep-link ID against `EXTENSION_LOCAL_CONTRIBUTION_ID_RE` before recording.
- Store `localId` separately from effective `id` on every new registry record.
- Use effective `id` for duplicate detection and manifest/action invocation lookup.
- Keep local action IDs in extension-authored bindings while recording; resolve them to effective IDs only after action registrations for that extension have been accepted.
- Include `extensionName`, `extensionPath`, `localId`, and effective `id` in projected metadata.

### Runtime Validation Rules

Recorder validation must reject with `extension:invalid-registration` diagnostics when:
- A spec is not a non-array object.
- `id` is missing or does not match the local ID regex.
- Action `title`, Console contribution `title`, command `label`, or deep-link `label` is missing or blank.
- Any provided `description` is not a string.
- An action `inputSchema` is not a non-array object with `type: 'object'`.
- A command `inputSchema`, when present, is not object-root.
- An action `outputSchema`, when present, is not a non-array object.
- An action `handler` is not a function.
- `sideEffects`, when present, is not an array of the client-owned side-effect literals.
- `inputDefaults`, when present in an action binding, is not JSON-safe object data.
- A Console contribution block uses a renderer outside `text`, `markdown`, `status-badge`, `link`, `action-button`, or `action-form`.
- A Console `action-button` or `action-form` block lacks an action binding.
- A Console block contains a function, symbol, bigint, circular object, `undefined`, non-finite number, `Date`, `Map`, `Set`, or class instance in projected metadata/defaults.
- An integration command lacks an action binding.
- A deep link has neither `urlTemplate` nor an action binding.
- A deep-link `urlTemplate`, when present, is not a non-empty string.
- An action binding references a local action ID that was not accepted for the same extension.

Duplicate diagnostics must use `extension:duplicate-registration`, set `name` to the duplicate effective ID, set `path` to the later registration's extension path, and mention both the later and original extension names in the message.

### Action Runtime Outcomes

Create an engine-local outcome type, not an HTTP response type. The daemon route module maps outcomes to HTTP statuses and lifecycle events.

Required outcome kinds:
- `success`
- `unknown-action`
- `invalid-input`
- `handler-error`
- `timeout`
- `invalid-output`
- `output-schema-failed`

Every outcome must include:
- `invocationId`
- `actionId`
- `requestedBy`
- `durationMs` for terminal outcomes reached after a handler lookup

Outcomes for known actions must also include:
- `extensionName`
- `extensionPath`

Output rules:
- The dispatcher accepts `input: Record<string, unknown>` because `platform-contracts` request parsing rejects non-object input envelopes before daemon dispatch.
- Validate input with `safeParseWithSchema(action.inputSchema, input)` before calling the handler.
- Invoke the handler as `handler(parsedInput, actionContext)`.
- The action context contains `invocationId`, effective `actionId`, `requestedBy`, `cwd`, and a stderr-backed logger using a prefix containing extension name and action ID.
- Use a timer-based timeout matching existing extension runtime patterns; catch late rejections so they do not become unhandled rejections.
- Reject `undefined`, functions, symbols, bigints, non-finite numbers, circular references, non-plain objects, `Date`, `Map`, `Set`, and class instances as `invalid-output`.
- Return a JSON-cloned output value on success so downstream route code receives data that can be serialized by `JSON.stringify`.
- If `outputSchema` exists, validate the JSON-safe output with `safeParseWithSchema`; return `output-schema-failed` on validation failure.
- Do not include raw input or raw output in failure messages, diagnostics, or action runtime metadata.

### Key Decisions

1. **Mirror SDK spec types in engine source instead of importing `@eforge-build/extension-sdk`.** Existing extension runtime modules avoid SDK imports because the root tsconfig maps SDK sources outside the engine `rootDir`. This module follows that pattern and imports only TypeBox primitives and client-owned wire types.
2. **Effective IDs use `extensionName:localId`.** This gives stable, human-readable IDs independent of absolute install path. Duplicate effective IDs reject the later registration deterministically.
3. **Bindings are same-extension local action references.** Cross-extension action binding is deferred; this slice resolves bindings only against accepted actions from the extension that registered the contribution/command/deep link.
4. **Manifest projection lives in the engine.** The daemon must not inspect handler-bearing registry records directly or shape manifest wire objects itself.
5. **Action runtime returns outcome objects.** The engine never writes HTTP responses or daemon events. The daemon module maps outcomes to status codes and persisted `extension:action:*` events.
6. **JSON-safe validation is stricter than `JSON.stringify`.** Dates, Maps, Sets, class instances, non-finite numbers, and circular values are rejected instead of transformed silently.
7. **Management details reuse manifest-safe fields.** Extension list/show/validate/test responses expose compact detail arrays derived from the same safe projection helpers, not parallel object shaping.
8. **Tests use real extension files and direct engine helpers.** No mocks are needed; action runtime tests load native extension factories into a real registry and dispatch against it.

## Files

### Create

- `packages/engine/src/extensions/ids.ts` — local ID regex, local ID validation helpers, `resolveExtensionContributionId`, and deterministic duplicate-diagnostic helpers for the new ID-based families.
- `packages/engine/src/extensions/contribution-validation.ts` — recorder-time validators for action specs, Console contribution blocks, action bindings, command specs, deep-link specs, TypeBox object-root schemas, side-effect literals, and JSON-safe metadata/default values.
- `packages/engine/src/extensions/manifest.ts` — safe manifest and management detail projection helpers: `buildExtensionContributionManifest`, per-family manifest entry builders, per-family management detail builders, schema JSON-cloning helpers, and binding resolution from local action IDs to effective IDs.
- `packages/engine/src/extensions/action-runtime.ts` — `dispatchExtensionAction`, action runtime outcome types, action context/logger construction, timeout handling, input validation, output JSON-safety validation, optional output-schema validation, and error-message normalization.
- `test/extension-contribution-registry-runtime.test.ts` — focused registry/runtime tests using real extension files for valid registrations, invalid registrations, duplicate IDs, manifest projection, management projection, and action dispatch success/failure modes.

### Modify

- `packages/engine/src/extensions/types.ts` — add local engine mirror spec types, `ActionRegistration`, `ConsoleContributionRegistration`, `IntegrationCommandRegistration`, `DeepLinkRegistration`, new arrays on `NativeExtensionRecorderState`/`NativeExtensionRegistry`, new counts on `LoadedNativeExtension.registrations`, and new methods on `EforgeExtensionAPIShape`.
- `packages/engine/src/extensions/recorder.ts` — initialize new arrays, implement `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`, call validation helpers, record effective IDs, merge the new families, validate action bindings after accepted action merges, and emit duplicate diagnostics.
- `packages/engine/src/extensions/loader.ts` — include new arrays in `createEmptyRegistry`, `registrationCounts`, `diffRegistrationCounts`, and `buildLoadedExtension` accepted-count calculations.
- `packages/engine/src/extensions/projector.ts` — include new totals and per-extension safe detail arrays from `manifest.ts`; keep handlers/module objects out of `NativeExtensionRegistryProjection`.
- `packages/engine/src/extensions/replay.ts` — extend `EMPTY_EXTENSION_REGISTRATIONS`, `DEFERRED_FAMILIES`, selection filtering, `projectExtensions`, and `summarizeDeferredRegistrations` for the new families; add safe detail arrays to replay `ExtensionEntry` objects.
- `packages/engine/src/extensions/index.ts` — export the new registry record types plus `resolveExtensionContributionId`, `buildExtensionContributionManifest`, management detail helpers if needed by tests, `dispatchExtensionAction`, and action runtime outcome types `[region: engine-registry-runtime, append exports after projectExtensionRegistry/replay exports without adding daemon-owned exports]`.
- `packages/client/src/types.ts` — extend `ExtensionRegistrationSummary`, add safe management detail types or type aliases derived from `extension-contributions.ts`, add optional detail arrays to `ExtensionEntry`, and extend `ExtensionTestDeferredRegistrationFamily` `[region: engine-registry-runtime, in the existing extension-management type block only]`.
- `packages/monitor/src/routes/extensions/discovery-service.ts` — update `EMPTY_EXTENSION_REGISTRATIONS`, pass through new safe detail arrays from `projectExtensionRegistry` into `ExtensionEntry`, and avoid shaping manifest/action invocation wire objects.
- `test/extension-loader.test.ts` — add or update bounded assertions for accepted registration counts and duplicate diagnostics only when they are easier to colocate with existing loader coverage; otherwise keep new cases in `test/extension-contribution-registry-runtime.test.ts`.
- `test/extension-replay.test.ts` — assert replay responses include new registration counts, safe detail arrays, and deferred summaries for actions/contributions/commands/deep links.
- `test/validation-provider-projection.test.ts` — update registry/extension literals to include the four new registration count fields.
- `test/extension-tooling-routes-list-show.test.ts` — add targeted assertions that existing list/show/validate/test route responses expose new counts/details when an extension registers the new families; do not add new daemon manifest/action route tests here.

## Detailed Implementation Notes

### `types.ts` registry additions

Add engine-local mirror shapes that match the platform SDK fields but remain local to engine source:

- `ExtensionActionSpec`
- `ExtensionActionBindingSpec`
- `ConsoleContributionSpec`
- `ConsoleContributionBlockSpec`
- `IntegrationCommandSpec`
- `ExtensionDeepLinkSpec`

Do not import these from `@eforge-build/extension-sdk`.

Add registration record types with effective IDs:

```ts
// --- eforge:region plan-02-engine-registry-runtime ---
export type ActionRegistration = BaseExtensionRegistration<'action', ExtensionActionSpec> & {
  localId: string;
  id: string;
};

export type ConsoleContributionRegistration = BaseExtensionRegistration<'consoleContribution', ConsoleContributionSpec> & {
  localId: string;
  id: string;
};
// commands and deep links follow the same shape
// --- eforge:endregion plan-02-engine-registry-runtime ---
```

Use array property names `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` everywhere, including counts.

### Recorder merge order

Implement merge in this order:

1. Push event hooks, agent-run hooks, policy gates, and source diagnostics as today.
2. Merge accepted action registrations with duplicate detection by effective `id`.
3. Build an accepted-action lookup keyed by `extensionName\0extensionPath\0localId`.
4. Merge Console contributions, integration commands, and deep links by effective `id`, rejecting any registration whose binding references a missing accepted action from the same extension.
5. Merge existing named families using existing helper behavior.

This order prevents a contribution from surviving when it binds to an action that was rejected as a duplicate.

### Manifest and management detail projection

`manifest.ts` must use the client-owned types from `platform-contracts`, for example:

- `ExtensionContributionManifestResponse`
- `ExtensionActionManifestEntry`
- `ConsoleContributionManifestEntry`
- `IntegrationCommandManifestEntry`
- `ExtensionDeepLinkManifestEntry`
- `EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION`

Projection requirements:
- Use `schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION` on the manifest response and Console contribution entries.
- Include `generatedAt` as an ISO timestamp generated inside `buildExtensionContributionManifest`.
- Sort every manifest family by effective `id` for deterministic snapshots/tests.
- Sort diagnostics by path/name/code/message only if existing order is not deterministic after duplicate handling; otherwise preserve loader order.
- Clone TypeBox schemas through a JSON-safe clone helper before putting them in manifest entries or management details.
- Resolve all action bindings in projected objects to effective action IDs.
- Preserve extension-authored `inputDefaults` only after JSON-safe validation and cloning.
- Omit the `action` field on deep links that have no action binding.
- Omit optional fields instead of serializing `undefined`.

### Management projection detail shape

Add compact management detail arrays to `ExtensionEntry`:

- `actionDetails?: ExtensionActionDetail[]`
- `consoleContributionDetails?: ConsoleContributionDetail[]`
- `integrationCommandDetails?: IntegrationCommandDetail[]`
- `deepLinkDetails?: ExtensionDeepLinkDetail[]`

These details may be aliases or `Pick<>` types over the manifest entries. They must include IDs, labels/titles, descriptions, extension provenance, schema presence/input schema metadata where needed for management surfaces, side-effect metadata, renderer IDs, and action bindings. They must not include handlers, handler source, raw module objects, or non-JSON-safe values.

### Action runtime API

Export an API shaped like this; exact names may vary if implementation evidence favors a shorter name, but the exported helper must carry the same data:

```ts
// --- eforge:region plan-02-engine-registry-runtime ---
export interface DispatchExtensionActionOptions {
  actionId: string;
  input: Record<string, unknown>;
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  timeoutMs: number;
  invocationId?: string;
}

export type DispatchExtensionActionResult =
  | { kind: 'success'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; output: ExtensionJsonValue }
  | { kind: 'unknown-action'; invocationId: string; actionId: string; requestedBy: ExtensionActionRequestedBy; message: string }
  | { kind: 'invalid-input' | 'handler-error' | 'timeout' | 'invalid-output' | 'output-schema-failed'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; message: string; validationErrors?: Array<{ path: string; message: string }>; timeoutMs?: number };
// --- eforge:endregion plan-02-engine-registry-runtime ---
```

The daemon module can then convert `kind` to the client-owned `ExtensionActionInvokeResponse` and HTTP status code without importing handler-bearing specs.

## Testing Strategy

### Unit Tests

Add `test/extension-contribution-registry-runtime.test.ts` with real temporary extension files that cover:
- A loaded extension registering one action, one Console contribution, one integration command, and one deep link.
- Effective IDs equal `extensionName:localId` and local IDs remain present.
- Registration counts include `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks`.
- `buildExtensionContributionManifest` returns one entry per family and no manifest entry has `handler`, `module`, `source`, or function-valued properties.
- Manifest action bindings use effective action IDs, not extension-local action IDs.
- Invalid action input schemas, invalid command input schemas, invalid side effects, invalid renderer IDs, missing action bindings, unknown local action bindings, and deep links without `urlTemplate` or action binding each produce `extension:invalid-registration` diagnostics.
- Duplicate action, Console contribution, command, and deep-link effective IDs produce four deterministic `extension:duplicate-registration` diagnostics and keep the first registration.
- `dispatchExtensionAction` returns `success` with JSON-safe output for a valid action.
- `dispatchExtensionAction` returns `unknown-action` for a missing effective action ID.
- `dispatchExtensionAction` returns `invalid-input` with schema error paths when TypeBox input validation fails.
- `dispatchExtensionAction` returns `handler-error` when the handler throws.
- `dispatchExtensionAction` returns `timeout` when the handler does not settle before `timeoutMs`.
- `dispatchExtensionAction` returns `invalid-output` for `undefined`, functions, `BigInt`, non-finite numbers, circular objects, `Date`, `Map`, `Set`, and class instances.
- `dispatchExtensionAction` returns `output-schema-failed` when a JSON-safe output fails the optional output schema.
- Failure outcomes do not include raw input objects or raw output objects.

Update focused existing tests only where their literals must compile:
- `test/validation-provider-projection.test.ts` registry literals include zero counts for the four new fields.
- `test/extension-loader.test.ts` existing registration summary assertions include the four new fields if they compare whole objects.

### Integration Tests

Use existing route/test helpers where they already exercise extension management responses:
- In `test/extension-tooling-routes-list-show.test.ts`, add an extension file with new registrations and assert `extensionList`, `extensionShow`, `extensionValidate`, and `extensionTest` response entries include new registration counts and safe detail arrays.
- In `test/extension-replay.test.ts`, assert `deferredRegistrations` includes `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` with counts grouped by extension.
- In `test/extension-tooling-routes-list-show.test.ts`, assert route responses do not expose `handler` in serialized JSON for action details or contribution details.

### Source Discipline Tests

Add static assertions to the new focused runtime test or an existing source-contract test when compact:
- `packages/engine/src/extensions/action-runtime.ts` does not import from `@eforge-build/extension-sdk`.
- `packages/engine/src/extensions/manifest.ts` imports manifest/invocation types from `@eforge-build/client` and does not define `/api/` route literals.
- `packages/monitor/src/routes/extensions/discovery-service.ts` does not import daemon action invocation schemas or route constants for the new manifest/action routes.

## Downstream Handoff

`daemon-action-routes` will consume:
- `buildExtensionContributionManifest(registry)` for `GET API_ROUTES.extensionContributionManifest`.
- `dispatchExtensionAction(registry, options)` and its outcome types for `POST API_ROUTES.extensionActionInvoke`.
- `resolveExtensionContributionId` only in tests or diagnostics if needed.

The daemon module remains responsible for:
- Loading config/registry for each route request.
- Validating HTTP request envelopes with client-owned schemas.
- Mapping runtime outcome kinds to typed `ExtensionActionInvokeResponse` bodies and HTTP statuses.
- Emitting and persisting `extension:action:start|complete|failed|timeout` events.

`console-contribution-rendering` and `host-integration-surfaces` must not import engine helpers; they consume only the daemon/client manifest and action invocation helpers.

## Verification

- [ ] `NativeExtensionRecorderState` contains `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` arrays.
- [ ] `LoadedNativeExtension.registrations` contains `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` numeric fields.
- [ ] `EforgeExtensionAPIShape` contains `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`.
- [ ] A real extension file that registers one valid action creates one `ActionRegistration` with `localId` and effective `id` equal to `extensionName:localId`.
- [ ] A real extension file that registers one valid Console contribution creates one `ConsoleContributionRegistration` with `localId` and effective `id`.
- [ ] A real extension file that registers one valid integration command creates one `IntegrationCommandRegistration` with `localId` and effective `id`.
- [ ] A real extension file that registers one valid deep link creates one `DeepLinkRegistration` with `localId` and effective `id`.
- [ ] Invalid action input schema registrations produce `extension:invalid-registration` diagnostics and zero action records.
- [ ] Invalid Console contribution registrations produce `extension:invalid-registration` diagnostics and zero Console contribution records.
- [ ] Invalid integration command registrations produce `extension:invalid-registration` diagnostics and zero integration command records.
- [ ] Invalid deep-link registrations produce `extension:invalid-registration` diagnostics and zero deep-link records.
- [ ] Duplicate action effective IDs produce one `extension:duplicate-registration` diagnostic and keep the first action record.
- [ ] Duplicate Console contribution effective IDs produce one `extension:duplicate-registration` diagnostic and keep the first contribution record.
- [ ] Duplicate integration command effective IDs produce one `extension:duplicate-registration` diagnostic and keep the first command record.
- [ ] Duplicate deep-link effective IDs produce one `extension:duplicate-registration` diagnostic and keep the first deep-link record.
- [ ] A contribution binding to an unknown same-extension action local ID produces `extension:invalid-registration` and no contribution record.
- [ ] `projectExtensionRegistry` totals include nonzero counts for all four new families when registrations exist.
- [ ] `projectExtensionRegistry` extension entries include safe detail arrays for all four new families when registrations exist.
- [ ] Serialized management projection JSON does not contain `handler`, `module`, or handler source text.
- [ ] `buildExtensionContributionManifest` returns `schemaVersion: 1`, an ISO `generatedAt`, sorted entries for all four families, and loader diagnostics.
- [ ] Manifest action entries include input schemas and omit handler functions.
- [ ] Manifest Console contribution, command, and deep-link entries resolve action bindings to effective action IDs.
- [ ] `replayNativeExtensionEvents` response entries include new registration counts and safe detail arrays.
- [ ] `replayNativeExtensionEvents` `deferredRegistrations` includes `actions`, `consoleContributions`, `integrationCommands`, and `deepLinks` counts.
- [ ] `dispatchExtensionAction` returns `success` for valid input and JSON-safe output.
- [ ] `dispatchExtensionAction` returns `unknown-action` for an action ID absent from the registry.
- [ ] `dispatchExtensionAction` returns `invalid-input` when TypeBox input validation fails.
- [ ] `dispatchExtensionAction` returns `handler-error` when an action handler throws.
- [ ] `dispatchExtensionAction` returns `timeout` when an action handler exceeds `timeoutMs`.
- [ ] `dispatchExtensionAction` returns `invalid-output` when an action returns a non-JSON-safe value.
- [ ] `dispatchExtensionAction` returns `output-schema-failed` when output schema validation fails.
- [ ] Action runtime failure outcomes omit raw `input` and raw `output` fields.
- [ ] `packages/engine/src/extensions/index.ts` exports manifest projection and action runtime helpers for daemon route imports.
- [ ] `packages/client/src/types.ts` remains the only client file modified by this module.
- [ ] `packages/engine/src/extensions/action-runtime.ts` has no import from `@eforge-build/extension-sdk`.
- [ ] `eforge/extensions/eforge-guardrails.ts` compiles without behavior changes under `pnpm type-check`.
- [ ] `pnpm test -- test/extension-contribution-registry-runtime.test.ts test/extension-replay.test.ts test/extension-tooling-routes-list-show.test.ts test/validation-provider-projection.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
