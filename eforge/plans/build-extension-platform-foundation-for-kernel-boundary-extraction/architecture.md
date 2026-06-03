# Build Extension Platform Foundation for Kernel-Boundary Extraction

## Current-state delta

This plan set is **not** a skip. Codebase exploration on the current worktree found no shipped `registerAction`, Console contribution registry, integration-command registry, deep-link registry, contribution manifest route, or extension-authored action invocation route. The existing extension stack records event hooks, agent-run hooks, policy gates, profile routers, input sources, PRD enrichers, reviewer perspectives, validation providers, and tools only.

Relevant current anchors:

- SDK API: `packages/extension-sdk/src/api.ts`, `hooks.ts`, `tools.ts`, `index.ts`
- Engine extension registry: `packages/engine/src/extensions/types.ts`, `recorder.ts`, `loader.ts`, `projector.ts`, `replay.ts`, `index.ts`
- Client-owned route/wire contracts: `packages/client/src/routes.ts`, `types.ts`, `index.ts`, `browser.ts`, `api-version-const.ts`, `events.schemas.ts`, `event-registry.ts`
- Daemon route modules: `packages/monitor/src/routes/extension-content.ts`, `packages/monitor/src/routes/extensions/*`
- Console System route: `packages/console-ui/src/views/system/*`, `packages/console-ui/src/lib/selectors/system.ts`
- Host integrations: `packages/pi-eforge/extensions/eforge/index.ts`, `packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, `eforge-plugin/`

The stale failed branch is reference material only. All implementation plans generated from this architecture must start from the current branch state and must not merge or resume the old feature branch.

## Vision and goals

Build a contract-first extension platform foundation that lets trusted native extensions contribute:

1. Typed actions with TypeBox object-root input schemas and optional output schemas.
2. Declarative Console contribution metadata rendered by first-party Console primitives.
3. Shared integration-command metadata for Pi, Claude/MCP, and CLI discovery.
4. Shared deep-link metadata for host discovery and action-backed invocation.
5. Daemon-owned manifest and action-invocation routes, with all route constants and wire shapes owned by `@eforge-build/client`.

This slice establishes platform seams for future kernel-boundary extraction. It does not extract session plans, playbooks, approval workflows, arbitrary HTTP routes, or arbitrary browser plugin bundles.

## Core architectural principles

- **Contract first:** public SDK and daemon/client wire contracts land before runtime consumers. Use TypeBox for action schemas and new HTTP wire schemas.
- **Engine records, daemon invokes, consumers render:** the engine registry captures extension metadata and handler references; the daemon exposes manifest/invocation routes; Console/Pi/Claude/CLI consume client-owned helpers.
- **No raw extension HTTP routes:** extensions register typed actions and declarative contributions only. The daemon owns exactly one manifest route and one action-invocation route for this slice.
- **No arbitrary browser code:** Console renders a closed set of declarative renderer IDs. Extension-supplied JavaScript/React bundles remain future work.
- **Trusted but bounded:** native extensions remain trusted unsandboxed Node code, but action invocation validates envelopes, validates action input, applies a timeout, catches handler failures, validates JSON-safe output, and never crashes the daemon.
- **No payload leakage:** diagnostics/events include provenance and error metadata, not raw action input or raw action output.
- **Route literal discipline:** no `/api/...` literals or daemon wire-shape redeclarations outside `@eforge-build/client`.
- **Existing workflows stay live:** session-plan and playbook routes/tools/Console Planning Workspace continue to pass their current tests unless an equivalent contribution-backed replacement ships in the same slice; this architecture does not replace them.
- **Integration parity:** Pi and Claude Code plugin/MCP/CLI expose the same generic discovery/invocation contract where technically feasible. If plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.

## Shared data model

### Namespaced IDs

Each new contribution family stores both an extension-local ID and an effective namespaced ID.

- Extension-local IDs are the author-facing `id` on action, Console contribution, integration command, and deep-link specs.
- Effective IDs are derived by the engine during recording, using the loaded extension identity plus the local ID, and are the only IDs accepted by daemon invocation routes.
- Duplicate effective IDs across loaded extensions produce deterministic `extension:duplicate-registration` diagnostics and the later registration is rejected.
- Records preserve: `extensionName`, `extensionPath`, `localId`, `id`/`effectiveId`, public metadata, schema metadata, and handler references where applicable.

### SDK registration families

The public SDK adds coherent methods with equivalent names allowed only if the module planner documents the mapping:

```ts
registerAction(action: ExtensionAction<TInput, TOutput>): void;
registerConsoleContribution(contribution: ConsoleContribution): void;
registerIntegrationCommand(command: IntegrationCommand): void;
registerDeepLink(deepLink: ExtensionDeepLink): void;
```

Action input schemas must be TypeBox-compatible object-root schemas (`type: "object"`). Output schemas are optional TypeBox schemas. If an output schema is present, runtime validates the JSON-safe handler output against it.

### Manifest wire shape

`@eforge-build/client` owns a new TypeBox-backed manifest module. The manifest route returns a single object containing all new families:

```ts
interface ExtensionContributionManifestResponse {
  schemaVersion: 1;
  generatedAt: string;
  actions: ExtensionActionManifestEntry[];
  consoleContributions: ConsoleContributionManifestEntry[];
  integrationCommands: IntegrationCommandManifestEntry[];
  deepLinks: ExtensionDeepLinkManifestEntry[];
  diagnostics: ExtensionDiagnostic[];
}
```

Manifest entries include safe metadata only: IDs, labels/titles, descriptions, extension provenance, renderer IDs, schemas needed for forms, side-effect metadata, and action bindings. They must not include handler functions, handler source text, imported module objects, or raw secrets.

### Action invocation wire shape

The daemon exposes one POST route for extension-authored action invocation. Proposed route keys and paths:

- `extensionContributionManifest`: `GET /api/extensions/contributions`
- `extensionActionInvoke`: `POST /api/extensions/actions/invoke`

The request body contains an effective action ID, a JSON object input payload, and caller provenance:

```ts
interface ExtensionActionInvokeRequest {
  actionId: string;
  input: Record<string, unknown>;
  requestedBy: ExtensionActionRequestedBy;
}
```

`requestedBy` is a closed union for first-party hosts, with optional command/contribution/deep-link IDs:

```ts
type ExtensionActionRequestedByHost = 'console' | 'pi' | 'claude' | 'mcp' | 'cli';
```

Responses are typed success/failure envelopes. Unknown actions return a typed 404 body. Invalid JSON/request envelopes and action input schema failures return typed 400 bodies. Handler throws, timeouts, invalid JSON-safe output, and output-schema failures return typed failure bodies with non-2xx HTTP status while keeping the daemon alive.

### Console contribution model

Console contributions are declarative, schema-versioned, and renderer-ID based. The initial closed renderer set is:

- `text`
- `markdown`
- `status-badge`
- `link`
- `action-button`
- `action-form`

Renderer blocks bind to effective action IDs where mutation is required. Forms are generated from object-root TypeBox action input schemas and submit through the browser-safe client helper.

### Integration command and deep-link model

Integration commands and deep links are manifest metadata, not host-specific forks.

- Commands carry an effective command ID, label, description, optional argument/input schema, and an action binding.
- Deep links carry an effective deep-link ID, label, description, optional URL/template metadata, and optional action binding.
- Host-specific UX can differ, but discovery and invocation use the manifest and action invocation route.

## Runtime flow

```mermaid
sequenceDiagram
  participant Ext as Native extension
  participant Engine as Engine loader/registry
  participant Daemon as Monitor daemon routes
  participant Client as @eforge-build/client
  participant Console as Console/Pi/MCP/CLI

  Ext->>Engine: registerAction / registerConsoleContribution / registerIntegrationCommand / registerDeepLink
  Engine->>Engine: validate local IDs, schemas, bindings; resolve effective IDs; record handlers
  Console->>Client: fetch contribution manifest helper
  Client->>Daemon: GET /api/extensions/contributions
  Daemon->>Engine: load registry and project safe manifest
  Daemon-->>Client: manifest without handlers
  Console->>Client: invoke action helper(actionId,input,requestedBy)
  Client->>Daemon: POST /api/extensions/actions/invoke
  Daemon->>Engine: validate input and dispatch trusted handler with timeout
  Engine-->>Daemon: JSON-safe output or typed failure
  Daemon-->>Client: typed invocation response
```

## Integration contracts between modules

### Platform contracts to engine registry

`platform-contracts` defines SDK specs and client wire schemas. `engine-registry-runtime` consumes those specs, records accepted registrations, and projects safe metadata. If a type is added to `@eforge-build/client` for management projection, the engine module must update projections in the same implementation plan that uses that type.

### Engine registry to daemon routes

`engine-registry-runtime` exposes helpers for:

- resolving contribution IDs;
- building a safe manifest from a `NativeExtensionRegistry`;
- dispatching an action by effective action ID;
- validating JSON-safe handler output;
- returning typed runtime outcomes without throwing across the daemon boundary.

`daemon-action-routes` imports these helpers lazily from `@eforge-build/engine/extensions/index` from route service modules, following existing extension route source contracts.

### Client to daemon route contract

`@eforge-build/client` owns:

- `API_ROUTES.extensionContributionManifest` and `API_ROUTES.extensionActionInvoke`;
- TypeBox schemas and `Static<>`-derived request/response types;
- Node helpers and `IfRunning` variants;
- browser-safe `fetchExtensionContributionManifest` and `invokeExtensionAction` helpers;
- route/API version exports.

Because first-party Console/Pi/MCP/CLI clients require daemon support for the new routes, bump `DAEMON_API_VERSION` from 51 to 52 in the same module that adds route constants/helpers.

### Action lifecycle diagnostics/events

This architecture chooses typed action lifecycle events instead of ad-hoc route-only logs. Add daemon-scoped persisted events:

- `extension:action:start`
- `extension:action:complete`
- `extension:action:failed`
- `extension:action:timeout`

Every event includes `invocationId`, `actionId`, `extensionName`, `extensionPath`, `requestedBy`, and timestamp. Terminal events include `durationMs`; failure/timeout events include error code/message or timeout metadata. No event includes raw input or raw output.

If importing `writeDaemonEvent` from `server-main.ts` creates a cycle, extract the daemon-event write helper into a small shared monitor module and update existing imports with bounded edits.

### Console renderer contract

Console consumes only browser-safe client helpers. It renders contributions inside `/console/system` first, near the existing Extensions section unless component composition requires a sibling `ExtensionContributionsSection`. Every mutating action button/form must use the shared browser helper and must show a visible success/failure result. Markdown blocks must use the existing sanitized `SafeMarkdown` pattern.

### Host integration contract

Pi, MCP/Claude, and CLI use the shared manifest and invocation route. Implement a generic host surface that can:

- list actions, integration commands, and action-backed deep links;
- invoke an action by effective action ID;
- invoke an integration command by effective command ID by resolving its action binding;
- invoke an action-backed deep link by effective deep-link ID.

Do not route extension-authored command invocation through the existing extension-management dispatcher in `packages/client/src/api/extension-tool-dispatch.ts`; create a separate helper/dispatcher if shared validation is needed.

## Shared File Registry

These files are high-risk or likely to receive edits from more than one module. Module planners must either honor the region ownership below or refactor to avoid multi-module edits. When a builder adds temporary region markers in TypeScript/TSX files, the marker slug must be the compiled plan ID such as `plan-01-platform-contracts`, not the module ID.

| File | Modules | Region Strategy |
|------|---------|-----------------|
| `packages/client/src/types.ts` | `platform-contracts`, `engine-registry-runtime` | Prefer new `extension-contributions.ts` for new manifest/invoke types. `engine-registry-runtime` owns additions to existing extension management projection types/counts only. |
| `packages/client/src/index.ts` | `platform-contracts`, `host-integration-surfaces` | Append-style export regions: platform exports schemas/routes/helpers; host exports optional shared command/deep-link dispatcher utilities. |
| `packages/client/src/browser.ts` | `platform-contracts`, `console-contribution-rendering` | Platform owns browser-safe helper/type exports. Console may add only browser-only renderer helper exports if a reusable helper is created under `packages/client/src/`; otherwise Console imports existing exports. |
| `packages/client/src/events.schemas.ts` | `daemon-action-routes` | Daemon module owns the action lifecycle event variants and any imports of shared requested-by schemas. Other modules must not edit this file. |
| `packages/client/src/event-registry.ts` | `daemon-action-routes` | Daemon module owns action event metadata, persistence, summaries, and daemon projection behavior. |
| `packages/engine/src/extensions/index.ts` | `engine-registry-runtime`, `daemon-action-routes` | Engine module owns exports for registry/runtime helpers. Daemon module may add no exports; if an export is missing, update the engine module plan instead. |
| `packages/monitor/src/routes/extension-content.ts` | `daemon-action-routes` | Daemon module owns new route keys in the extension content list and must update route registration/source-contract tests. |
| `packages/console-ui/src/views/system/extensions-section.tsx` | `engine-registry-runtime`, `console-contribution-rendering` | Console module owns all rendering of new registration counts/details and contribution panels. Engine module must not edit Console files. |
| `packages/eforge/src/cli/index.ts` | `host-integration-surfaces` | Host module owns bounded edits for CLI list/invoke commands; no other module edits this oversized file. |
| `packages/eforge/src/cli/mcp-proxy.ts` | `host-integration-surfaces` | Host module owns bounded edits for MCP tools; no other module edits this oversized file. |
| `packages/pi-eforge/extensions/eforge/index.ts` | `host-integration-surfaces` | Host module owns bounded edits for Pi tools/commands; no other module edits this oversized file. |

### Region Declarations

**`packages/client/src/types.ts`**

- `platform-contracts`: new import/type references only if the manifest module cannot carry them independently.
- `engine-registry-runtime`: `ExtensionRegistrationSummary`, `ExtensionEntry` optional safe detail arrays, `ExtensionTestDeferredRegistrationFamily`, and related extension-management response metadata.

**`packages/client/src/index.ts`**

- `platform-contracts`: after existing extension API exports, add exports from `./extension-contributions.js` and `./api/extension-contributions.js`.
- `host-integration-surfaces`: after platform contribution exports, add optional exports from a new shared command/deep-link dispatch helper if created.

**`packages/client/src/browser.ts`**

- `platform-contracts`: after existing browser-safe recovery/queue exports, add browser-safe contribution manifest/action invocation helpers and types.
- `console-contribution-rendering`: no direct edit unless a reusable browser helper is added under `packages/client/src/`; if required, append after platform contribution exports.

**`packages/client/src/events.schemas.ts`**

- `daemon-action-routes`: action lifecycle schemas in one contiguous block near existing native extension diagnostic events.

**`packages/client/src/event-registry.ts`**

- `daemon-action-routes`: action lifecycle registry entries in one contiguous block near existing extension diagnostic entries.

**`packages/engine/src/extensions/index.ts`**

- `engine-registry-runtime`: exports for ID helpers, manifest projection, and action runtime dispatch.
- `daemon-action-routes`: read-only; request missing exports by updating the engine module.

**`packages/monitor/src/routes/extension-content.ts`**

- `daemon-action-routes`: append `extensionContributionManifest` and `extensionActionInvoke` beside existing extension route keys; preserve existing playbook/session-plan route keys.

**`packages/console-ui/src/views/system/extensions-section.tsx`**

- `console-contribution-rendering`: render new registration badges/details and/or delegate to a new `ExtensionContributionsSection` sibling component.

## Technical decisions and rationale

1. **Use additive SDK methods.** Early breaking changes are allowed by the source, but additive methods minimize migration risk for `eforge/extensions/eforge-guardrails.ts` and current examples while still providing coherent long-term contracts.
2. **Use TypeBox across SDK and client.** Existing extension tools already use TypeBox object schemas; new action input/output and wire contracts use the same validation library.
3. **Use one manifest route and one invocation route.** This keeps extension-management operations separate from extension-authored action dispatch and prevents raw HTTP route registration.
4. **Persist action events as daemon-scoped events.** Action invocations are daemon-local operations initiated by Console/host surfaces, not plan-session events. Persisted daemon events give Console activity and SSE reconnects a stable audit trail without raw payloads.
5. **Render contributions in System first.** The current Console navigation is source-owned/static. System already hosts extension diagnostics and configuration surfaces, so it is the lowest-risk first render target.
6. **Bump daemon API to v52.** First-party clients will call new routes. A stale daemon returning 404 would produce misleading host/Console failures.
7. **Reuse the existing extension timeout configuration.** Do not add a config field in this slice unless implementation proves the current `extensions.eventHookTimeoutMs` reuse is unworkable; document the chosen timeout behavior in extension docs.
8. **Keep playbook/session-plan workflows source-owned.** This build creates seams for future extraction but does not move those workflows behind extensions.

## Module responsibilities

### `platform-contracts`

Define public SDK contracts and client-owned wire contracts. Create focused TypeBox schema modules, API route constants, Node/IfRunning helpers, browser helpers, exports, and API v52 bump. Include SDK type tests and client helper/schema tests.

Primary targets:

- `packages/extension-sdk/src/api.ts`
- new `packages/extension-sdk/src/contributions.ts`
- `packages/extension-sdk/src/index.ts`
- `packages/client/src/routes.ts`
- new `packages/client/src/extension-contributions.ts`
- new `packages/client/src/api/extension-contributions.ts`
- new browser helper module if needed
- `packages/client/src/index.ts`
- `packages/client/src/browser.ts`
- `packages/client/src/api-version-const.ts`

### `engine-registry-runtime`

Record, validate, de-duplicate, project, replay-summarize, and invoke new extension registration families. Add manifest projection and JSON-safe action runtime dispatch helpers. Keep handler functions out of projections.

Primary targets:

- `packages/engine/src/extensions/types.ts`
- `packages/engine/src/extensions/recorder.ts`
- `packages/engine/src/extensions/loader.ts`
- `packages/engine/src/extensions/projector.ts`
- `packages/engine/src/extensions/replay.ts`
- `packages/engine/src/extensions/index.ts`
- new focused helpers under `packages/engine/src/extensions/`
- `packages/client/src/types.ts` for existing management projection metadata
- `test/extension-loader.test.ts`
- `test/extension-replay.test.ts`
- `test/extension-sdk-example.test.ts`

### `daemon-action-routes`

Expose the manifest and action invocation routes using client-owned constants/schemas. Validate request envelopes, map runtime outcomes to typed HTTP statuses, emit action lifecycle events, update route registration/source-contract tests, and account for new events in active/legacy reducers.

Primary targets:

- `packages/monitor/src/routes/extensions/index.ts`
- new `packages/monitor/src/routes/extensions/contributions.ts`
- new route service/helper modules under `packages/monitor/src/routes/extensions/`
- `packages/monitor/src/routes/extension-content.ts`
- `packages/client/src/events.schemas.ts`
- `packages/client/src/event-registry.ts`
- `packages/console-ui/src/lib/run-state/handlers/index.ts`
- `packages/monitor-ui/src/lib/reducer/index.ts`
- `packages/console-ui/src/components/timeline/event-card.tsx` and legacy monitor timeline if action events are rendered
- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts`
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts`
- route and event tests in `test/` and `packages/client/src/__tests__/`

### `console-contribution-rendering`

Fetch the manifest with browser-safe client helpers, render declarative contributions in the System route, support the initial renderer IDs, and invoke actions via the browser helper. Include component tests for rendering and action submission.

Primary targets:

- `packages/console-ui/src/views/system/system-types.ts`
- `packages/console-ui/src/views/system/system-fetches.ts`
- `packages/console-ui/src/views/system/use-system-surfaces.ts`
- `packages/console-ui/src/views/system/system-view-content.tsx`
- `packages/console-ui/src/views/system/extensions-section.tsx`
- new `packages/console-ui/src/views/system/extension-contributions-section.tsx` or `src/views/extensions/*` only if needed
- `packages/console-ui/src/lib/selectors/system.ts`
- `packages/console-ui/src/views/system/__tests__/*`
- `packages/console-ui/README.md` control-surface guidance

### `host-integration-surfaces`

Expose generic contribution discovery/invocation in Pi, MCP/Claude, and CLI. Keep extension-management dispatch separate. Update plugin skills and bump the Claude plugin manifest version if plugin files change.

Primary targets:

- `packages/pi-eforge/extensions/eforge/index.ts`
- optional focused Pi helper modules under `packages/pi-eforge/extensions/eforge/`
- `packages/eforge/src/cli/index.ts`
- `packages/eforge/src/cli/mcp-proxy.ts`
- optional shared client dispatcher module for command/deep-link invocation
- `eforge-plugin/skills/*` where generic contribution guidance is exposed
- `eforge-plugin/.claude-plugin/plugin.json`
- host parity and MCP/Pi/CLI tests in `test/`

### `docs-examples-compat`

Update public docs, SDK README, examples, generated references, and integration docs. Document shipped seams, safety boundaries, timeout behavior, no raw routes, no arbitrary frontend bundles, and deferred workflow extraction. Add or update a minimal action/contribution example.

Primary targets:

- `docs/extensions.md`
- `docs/extensions-api.md`
- `docs/config.md` only if timeout behavior needs clarification or a new config field ships
- `packages/extension-sdk/README.md`
- `examples/extensions/README.md`
- new `examples/extensions/action-contribution.ts`
- `web/content/docs/integrations.md`
- generated docs artifacts via `pnpm docs:generate`
- `docs/roadmap.md` only to prune items actually shipped by this build; do not claim session-plan/playbook extraction or arbitrary frontend plugins shipped

## Quality attributes

- **Type safety:** public SDK methods infer action input types from TypeBox `TObject`; client wire types derive from TypeBox schemas.
- **Privacy:** action lifecycle telemetry contains IDs, provenance, durations, and errors only; it excludes raw inputs and raw outputs.
- **Daemon resilience:** invalid registrations produce diagnostics; action invocation failures return typed errors; handler failures/timeouts do not crash the daemon process.
- **Compatibility:** current session-plan and playbook REST routes, Pi tools, Claude/MCP tools, and Console Planning Workspace continue to work.
- **Maintainability:** new implementation files stay under 600 lines; oversized files receive bounded edits only; large new/modified files use balanced durable region markers where required by project policy.
- **Security boundary:** all action invocation routes use existing local/cross-site route security policies. Native extension code remains trusted and unsandboxed, and docs state that risk explicitly.

## Validation commands

Run after all modules merge:

```bash
pnpm maintainability:check
pnpm type-check
pnpm test
pnpm docs:check
```
