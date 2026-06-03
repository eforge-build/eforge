# Daemon Action Routes

## Architecture Reference

This module implements the architecture sections **Runtime flow**, **Engine registry to daemon routes**, **Action invocation wire shape**, **Action lifecycle diagnostics/events**, and the daemon-owned portions of **Client to daemon route contract**.

Key constraints from architecture:
- The daemon owns exactly one contribution manifest route and one extension-authored action invocation route for this slice.
- Route constants, request/response schemas, invocation response types, and requested-by wire shapes come from `@eforge-build/client`; daemon code must not redeclare `/api/...` literals or daemon wire response interfaces.
- Engine handler-bearing records remain behind `@eforge-build/engine/extensions/index`; daemon routes consume exported engine helpers and never inspect extension module objects or handler source text directly.
- Action invocation validates the HTTP envelope before dispatch, uses the engine dispatcher for input/output validation and timeout handling, and maps dispatcher outcomes to typed HTTP responses.
- Action lifecycle telemetry is persisted as daemon-scoped events with provenance and duration/error metadata, without raw input payloads or raw output payloads.
- Route modules under `packages/monitor/src/routes/extensions/` must keep engine extension imports lazy inside service functions to satisfy current source-contract tests.
- Active Console and legacy monitor reducers must account for new event variants by handling them or listing them as intentionally ignored.

## Scope

### In Scope
- Add `GET API_ROUTES.extensionContributionManifest` under the existing extension content route aggregation.
- Add `POST API_ROUTES.extensionActionInvoke` under the existing extension content route aggregation.
- Load native extensions for route requests using current daemon/project config and engine registry helpers from `engine-registry-runtime`.
- Return client-owned contribution manifest responses from the manifest route.
- Parse and validate action invocation request envelopes with client-owned schemas.
- Invoke extension actions by effective action ID through the engine dispatcher.
- Map dispatcher outcomes to typed client-owned response bodies and HTTP status codes.
- Emit daemon-scoped persisted `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout` events.
- Add event schemas, event registry metadata, event fixture coverage, and reducer exhaustiveness updates for the four action event variants.
- Add route registration, route security, source-contract, manifest route, action invocation, timeout, invalid-output, and event-persistence tests.
- Preserve current extension-management, playbook, session-plan, and session-plan-set routes.

### Out of Scope
- SDK public registration methods and client route/schema/helper definitions owned by `platform-contracts`.
- Engine registry recording, safe manifest projection, and action runtime dispatch owned by `engine-registry-runtime`.
- Console contribution rendering and form/button action UX.
- Pi, Claude/MCP, and CLI command/deep-link surfaces.
- Documentation and examples.
- Raw extension-owned HTTP routes.
- Arbitrary extension-supplied browser JavaScript or React bundles.
- New extension action timeout config fields; this module reuses `extensions.eventHookTimeoutMs`.

## Implementation Approach

### Overview

Add a focused extension contribution route module that plugs into `createExtensionRoutes(context)`. The manifest handler loads the current native extension registry and delegates safe manifest shaping to `buildExtensionContributionManifest(registry)`. The invocation handler parses the request envelope with `safeParseExtensionActionInvokeRequest`, loads the registry/config, looks up safe action provenance from the manifest, emits a start event for known actions, calls `dispatchExtensionAction(registry, options)`, then maps the dispatcher outcome to a typed `ExtensionActionInvokeResponse` and a terminal action event.

Keep daemon route logic split into three small files:

1. `contributions.ts` defines route registrations and HTTP request parsing.
2. `contribution-service.ts` loads config/extensions and maps engine outcomes to client response bodies.
3. `action-events.ts` builds and writes action lifecycle events through the shared daemon event helper.

Extract the existing `writeDaemonEvent` helper from `server-main.ts` to a small monitor module so routes can persist daemon events without importing `server-main.ts` and creating a cycle.

### Route Behavior

Manifest route:
- Method: `GET`.
- Route key: `extensionContributionManifest`.
- Security: `[localOnly('Extension contribution manifest reads'), rejectCrossSiteBrowser('Extension contribution manifest reads')]`.
- Missing `context.cwd`: HTTP 503 with the existing JSON error shape.
- Success: HTTP 200 with `ExtensionContributionManifestResponse`, produced by `buildExtensionContributionManifest(registry)`.
- Extension loading errors: HTTP 500 with existing JSON error shape.

Action invocation route:
- Method: `POST`.
- Route key: `extensionActionInvoke`.
- Security: `[localMutation('Extension action invocation')]`.
- Missing `context.cwd`: HTTP 503 with a typed `invalid-request` response when an invocation ID can be generated before returning.
- Invalid JSON: HTTP 400 with typed `invalid-request` response.
- Request body larger than `MAX_JSON_BODY_BYTES`: HTTP 413 with typed `invalid-request` response.
- Schema-invalid request envelope: HTTP 400 with typed `invalid-request` response and validation errors from the client schema helper.
- Unknown effective action ID: HTTP 404 with typed `unknown-action` response; no action lifecycle event is emitted because extension provenance is unavailable.
- Engine `invalid-input`: HTTP 400 with typed `invalid-input` response and validation errors.
- Engine `handler-error`: HTTP 500 with typed `handler-error` response.
- Engine `timeout`: HTTP 504 with typed `timeout` response.
- Engine `invalid-output`: HTTP 500 with typed `invalid-output` response.
- Engine `output-schema-failed`: HTTP 500 with typed `output-schema-failed` response and validation errors.
- Engine `success`: HTTP 200 with typed success response and JSON-safe output.

### Action Event Contract

Add the following event variants in `packages/client/src/events.schemas.ts` near existing native extension diagnostic events:

```ts
// --- eforge:region plan-03-daemon-action-routes ---
const ExtensionActionEventBaseFields = {
  invocationId: Type.String(),
  actionId: Type.String(),
  extensionName: Type.String(),
  extensionPath: Type.String(),
  requestedBy: ExtensionActionRequestedBySchema,
} as const;
// extension:action:start|complete|failed|timeout schemas follow here.
// --- eforge:endregion plan-03-daemon-action-routes ---
```

Event field requirements:
- `extension:action:start`: base fields only.
- `extension:action:complete`: base fields plus `durationMs`.
- `extension:action:failed`: base fields plus `durationMs`, `errorCode` (`invalid-input`, `handler-error`, `invalid-output`, or `output-schema-failed`), `message`, and optional `validationErrors`.
- `extension:action:timeout`: base fields plus `durationMs`, `timeoutMs`, and `message`.
- No action event object includes `input`, `output`, `rawInput`, `rawOutput`, `payload`, or handler-return fields.

Event registry behavior:
- All four events are `scope: 'daemon'` and `persist: true`.
- Summaries include the action ID and extension name.
- No `project` function is attached; action events append to daemon activity only.
- `DAEMON_EVENT_TYPES` includes all four variants through the existing event registry derivation.

### Key Decisions

1. **Use the engine manifest projection for action provenance.** The daemon route builds a safe manifest before dispatch and finds the action entry by effective ID. This provides `extensionName` and `extensionPath` for the start event without reading handler-bearing registry internals.
2. **Do not emit action events for invalid request envelopes or unknown action IDs.** Those cases lack trusted extension provenance. The HTTP response remains typed and includes an invocation ID for caller correlation.
3. **Emit `start` before input-schema validation.** A schema-valid request targeting a known action has begun daemon dispatch even if the engine rejects the action input before calling the handler.
4. **Persist route action events via a shared monitor helper.** Routes must not import `server-main.ts`; extracting `writeDaemonEvent` avoids a route/server cycle and lets tests reuse the same event insertion behavior.
5. **Reuse `extensions.eventHookTimeoutMs`.** This slice adds no config field; the invocation route passes the resolved value to `dispatchExtensionAction`.
6. **Return typed action failure bodies on non-2xx statuses.** Client helpers from `platform-contracts` depend on schema-valid failure bodies for host and Console diagnostics.
7. **Keep extension-management dispatch separate.** This route does not call `dispatchEforgeExtensionAction` or `extension-tool-dispatch.ts`; extension-authored action dispatch is a distinct contract.
8. **Ignore action events in run-state reducers.** Action invocations are daemon-scoped and do not mutate per-run build state. Console activity surfaces can use `eventRegistry` summaries.

## Files

### Create
- `packages/monitor/src/daemon-events.ts` — shared `writeDaemonEvent(db, event, daemonSessionId)` helper extracted from `server-main.ts`; imports only `MonitorDB` and `isPersistedDaemonEventType`.
- `packages/monitor/src/routes/extensions/contributions.ts` — route definitions for `extensionContributionManifest` and `extensionActionInvoke`, request-body parsing, security policies, and response sending.
- `packages/monitor/src/routes/extensions/contribution-service.ts` — config/registry loading, manifest projection, action provenance lookup, dispatch invocation, response body construction, and HTTP status mapping.
- `packages/monitor/src/routes/extensions/action-events.ts` — action lifecycle event builders and `emitExtensionActionStart/Complete/Failed/Timeout` helpers that call `writeDaemonEvent`.
- `packages/monitor/src/__tests__/routes-extension-contributions.test.ts` — route-level tests for manifest success, security, invoke success, unknown action, invalid envelope, invalid input, handler throw, timeout, invalid output, output-schema failure, and persisted events.
- `packages/client/src/__tests__/events-schemas-extension-actions.test.ts` — event schema, registry, persistence allowlist, and summary tests for `extension:action:*`.

### Modify
- `packages/monitor/src/types.ts` — add `daemonSessionId?: string` to `StartServerOptions` so detached daemon startup can pass the process-wide daemon session ID into route context.
- `packages/monitor/src/context.ts` — add `daemonSessionId: string` to `MonitorContext` and initialize it from `options.daemonSessionId` or a generated fallback during `createMonitorContext`.
- `packages/monitor/src/server-main.ts` — import/re-export `writeDaemonEvent` from `./daemon-events.js`, remove the local helper body with a bounded edit, and pass the existing `daemonSessionId` into `startServer` options.
- `packages/monitor/src/routes/extensions/index.ts` — import `createExtensionContributionRoutes` and append its route definitions after existing extension read routes and before/after management routes without changing existing route order semantics.
- `packages/monitor/src/routes/extension-content.ts` — add `extensionContributionManifest` and `extensionActionInvoke` to `EXTENSION_CONTENT_ROUTE_KEYS` beside existing extension route keys `[region: daemon-action-routes, append new extension route keys immediately after extensionValidate or after extensionDemote, then keep playbook/session-plan keys unchanged]`.
- `packages/client/src/events.schemas.ts` — add action lifecycle event TypeBox schemas and import `ExtensionActionRequestedBySchema` plus `ExtensionActionInvokeErrorCodeSchema` from `./extension-contributions.js` `[region: daemon-action-routes, one contiguous block near native extension diagnostic events]`.
- `packages/client/src/event-registry.ts` — add action lifecycle event metadata and summaries `[region: daemon-action-routes, one contiguous block near existing extension diagnostic entries]`.
- `packages/client/src/__tests__/events-schema-test-helpers.ts` — add reusable valid `extensionActionVariants` fixtures for the four new event types.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add valid wire fixtures for all four action lifecycle events.
- `packages/client/src/__tests__/events-wire-parity-invalid-fixtures.ts` — add invalid fixtures for missing action event provenance and invalid requested-by host.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout` to `IGNORED_EVENT_TYPES`.
- `packages/monitor-ui/src/lib/reducer/index.ts` — add the same four action event types to the legacy reducer ignored-event list.
- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts` — update expected route keys, route count, GET/POST method ownership, and secured route key sets.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` — add a source-contract assertion that extension content route modules do not import `server-main.ts`; existing checks automatically cover the new route files for `/api/` literals, response-shape redeclarations, and static engine imports.
- `packages/monitor/src/__tests__/server-security.test.ts` — include the manifest route in sensitive read checks and the invocation route in local mutation checks.
- `packages/client/src/__tests__/events-schemas.test.ts` — add `isPersistedDaemonEventType` expectations for all four action event types if those assertions fit the existing predicate suite better than the new focused action-event suite.

## Detailed Implementation Notes

### Loading registry and config

`contribution-service.ts` must use dynamic imports inside functions:

- `@eforge-build/engine/config` for `loadConfig`, `getConfigDir`, and `getConventionalConfigDir`.
- `@eforge-build/engine/extensions/index` for `loadNativeExtensions`, `buildExtensionContributionManifest`, and `dispatchExtensionAction`.

This function shape keeps the route layer compact and source-contract-compliant:

- `loadContributionRuntime(context)` returns `{ config, registry, manifest }`.
- It uses `context.cwd` and the current config directory resolution pattern from `discovery-service.ts`.
- It passes `config.extensions` directly to `loadNativeExtensions`, preserving disabled-extension behavior.
- It calls `buildExtensionContributionManifest(registry)` exactly once per request path that needs safe metadata.

### Invocation response mapping

Build all response bodies using imported client types and `satisfies ExtensionActionInvokeResponse`. Avoid local `interface *Response` or `type *Response` declarations in route files.

Required status mapping:

| Engine/result kind | HTTP status | Client failure code |
| --- | ---: | --- |
| `success` | 200 | n/a |
| request parse/schema failure | 400 | `invalid-request` |
| request body too large | 413 | `invalid-request` |
| `unknown-action` | 404 | `unknown-action` |
| `invalid-input` | 400 | `invalid-input` |
| `handler-error` | 500 | `handler-error` |
| `timeout` | 504 | `timeout` |
| `invalid-output` | 500 | `invalid-output` |
| `output-schema-failed` | 500 | `output-schema-failed` |

Every response body includes the invocation ID generated by the daemon route. Known-action responses include `actionId`, `extensionName`, and `extensionPath` when the client schema supports those fields.

### Event emission ordering

For a schema-valid request targeting a known action:

1. Generate or reuse the invocation ID before manifest lookup.
2. Emit `extension:action:start` with action provenance and requested-by metadata.
3. Call `dispatchExtensionAction` with the same invocation ID.
4. Emit exactly one terminal event:
   - `extension:action:complete` for success.
   - `extension:action:failed` for invalid input, handler error, invalid output, and output schema failure.
   - `extension:action:timeout` for timeout.
5. Send the typed HTTP response.

If event persistence fails, the route still returns the action response. `writeDaemonEvent` is best-effort by design.

### Privacy discipline

Action route and event tests must use a handler returning a recognizable secret string and an invocation input containing a recognizable secret string. Persisted event JSON must not contain either string. Response bodies may contain the action output on success because responses go only to the caller; persisted events must not.

### Source-discipline details

- New route files must not contain string literals matching `/api/`.
- New route files must not declare local interfaces or type aliases whose names end in `Response`.
- New route files must not statically import `@eforge-build/engine/extensions/index`.
- New route files must not import `../server-main.js` or `../../server-main.js`.
- `contribution-service.ts` may use type-only `import('...')` references if needed, but dynamic runtime imports must happen inside functions.

## Testing Strategy

### Unit Tests
- In `packages/client/src/__tests__/events-schemas-extension-actions.test.ts`, validate all four action event variants with `safeParseEforgeEvent`.
- Assert action event registry entries have `scope: 'daemon'`, `persist: true`, no `project` function, and summaries containing the action ID plus extension name.
- Assert `DAEMON_EVENT_TYPES` and `isPersistedDaemonEventType` include `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout`.
- Assert invalid action events with missing `invocationId`, missing `actionId`, missing `extensionName`, missing `extensionPath`, or invalid `requestedBy.host` fail schema validation.
- Assert action event fixtures round-trip through JSON.

### Route Integration Tests
- Seed real project-local native extension files under `.eforge/extensions/` that register action/contribution/command/deep-link families through the SDK methods from `platform-contracts`.
- `GET API_ROUTES.extensionContributionManifest` returns HTTP 200 and a body accepted by `safeParseExtensionContributionManifest`.
- Manifest JSON contains actions, Console contributions, integration commands, and deep links without `handler`, `module`, handler source text, or function-valued data.
- Manifest route rejects non-loopback Host and cross-site browser headers with HTTP 403.
- `POST API_ROUTES.extensionActionInvoke` succeeds for a valid action and returns output from the handler.
- Invocation route rejects non-loopback Host and cross-site browser headers with HTTP 403 before reading malformed JSON.
- Unknown action ID returns HTTP 404 with `ok: false` and failure code `unknown-action`.
- Invalid JSON, array body, missing fields, invalid requested-by host, and non-object `input` return typed `invalid-request` responses.
- Input schema failure returns HTTP 400 with failure code `invalid-input` and validation error paths.
- Handler throw returns HTTP 500 with failure code `handler-error`.
- Handler timeout returns HTTP 504 with failure code `timeout`; set `extensions.eventHookTimeoutMs: 5` in test config for this case.
- Non-JSON-safe output returns HTTP 500 with failure code `invalid-output`.
- Optional output schema failure returns HTTP 500 with failure code `output-schema-failed`.
- Successful known-action invocation persists exactly one start event and one complete event.
- Invalid-input invocation persists one start event and one failed event.
- Timeout invocation persists one start event and one timeout event.
- Unknown-action invocation persists zero `extension:action:*` events.
- Persisted action event JSON contains `invocationId`, `actionId`, `extensionName`, `extensionPath`, `requestedBy`, `durationMs` on terminal events, and no raw input/output sentinel strings.

### Regression and Source Tests
- Update route registration tests to expect 36 extension-content route keys after adding the two routes.
- Update route method tests to classify `extensionContributionManifest` as `GET` and `extensionActionInvoke` as `POST`.
- Update route security tests to include both new route keys in the secured set.
- Update monitor route aggregation coverage so every key in `API_ROUTES` has a registered route.
- Add a source-contract test that no extension content route module imports `server-main.ts`.
- Ensure active Console and legacy monitor reducer exhaustiveness checks pass after adding the four action event types to ignored-event lists.

## Downstream Handoff

`console-contribution-rendering` consumes the manifest and invocation routes only through browser-safe helpers from `@eforge-build/client/browser`; it must not import monitor or engine route internals.

`host-integration-surfaces` consumes the same client-owned manifest and action invocation helpers for Pi, MCP/Claude, and CLI. It must route integration-command/deep-link invocation through `extensionActionInvoke`, not through the extension-management dispatcher.

`docs-examples-compat` documents the route behavior, action event privacy boundary, and timeout reuse after this module lands.

## Verification

- [ ] `createExtensionContentRoutes` registers `extensionContributionManifest` and `extensionActionInvoke` in addition to existing extension, playbook, session-plan, and session-plan-set keys.
- [ ] `EXTENSION_CONTENT_ROUTE_KEYS` contains 36 entries and preserves every pre-existing route key.
- [ ] `extensionContributionManifest` uses HTTP `GET` and `API_ROUTES.extensionContributionManifest`.
- [ ] `extensionActionInvoke` uses HTTP `POST` and `API_ROUTES.extensionActionInvoke`.
- [ ] Both new routes have at least one security policy in route registration tests.
- [ ] Manifest route returns HTTP 200 with a body accepted by `safeParseExtensionContributionManifest` for a real loaded extension.
- [ ] Manifest route response JSON contains no `handler`, `module`, or handler source text.
- [ ] Invocation route returns HTTP 200 with a body accepted by `safeParseExtensionActionInvokeResponse` for a valid action call.
- [ ] Invocation route returns HTTP 404 and failure code `unknown-action` for an unknown effective action ID.
- [ ] Invocation route returns HTTP 400 and failure code `invalid-request` for a schema-invalid request envelope.
- [ ] Invocation route returns HTTP 400 and failure code `invalid-input` when TypeBox input validation fails.
- [ ] Invocation route returns HTTP 500 and failure code `handler-error` when the handler throws.
- [ ] Invocation route returns HTTP 504 and failure code `timeout` when the handler exceeds `extensions.eventHookTimeoutMs`.
- [ ] Invocation route returns HTTP 500 and failure code `invalid-output` for non-JSON-safe handler output.
- [ ] Invocation route returns HTTP 500 and failure code `output-schema-failed` for output schema validation failure.
- [ ] Successful invocation persists `extension:action:start` and `extension:action:complete` daemon events.
- [ ] Handler failure persists `extension:action:start` and `extension:action:failed` daemon events.
- [ ] Handler timeout persists `extension:action:start` and `extension:action:timeout` daemon events.
- [ ] Unknown-action invocation persists zero `extension:action:*` daemon events.
- [ ] Persisted action events contain no raw input sentinel string from the test request.
- [ ] Persisted action events contain no raw output sentinel string returned by the test handler.
- [ ] `eventRegistry` entries for all four action event variants have `scope: 'daemon'` and `persist: true`.
- [ ] `DAEMON_EVENT_TYPES` contains all four action event variants.
- [ ] `safeParseEforgeEvent` accepts valid `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout` payloads.
- [ ] `safeParseEforgeEvent` rejects an action event with an invalid `requestedBy.host`.
- [ ] `packages/console-ui/src/lib/run-state/handlers/index.ts` accounts for all four action event types.
- [ ] `packages/monitor-ui/src/lib/reducer/index.ts` accounts for all four action event types.
- [ ] Extension content route source-contract tests find zero `/api/` literals in route modules.
- [ ] Extension content route source-contract tests find zero static imports from `@eforge-build/engine/extensions/index` in route modules.
- [ ] Extension content route source-contract tests find zero imports from `server-main.ts` in route modules.
- [ ] `pnpm test -- packages/client/src/__tests__/events-schemas-extension-actions.test.ts packages/monitor/src/__tests__/routes-extension-contributions.test.ts packages/monitor/src/__tests__/routes-extension-content-registration.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts packages/monitor/src/__tests__/server-security.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
