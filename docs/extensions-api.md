# Extensions API Reference

This document is the type-level reference for `@eforge-build/extension-sdk`. For conceptual background, scope model, management commands (`eforge extension list/show/validate/test/new/reload`), and example walkthroughs, see [`docs/extensions.md`](./extensions.md).

## Entrypoint

An extension is a TypeScript module with a default-export factory function:

```ts
import type { EforgeExtensionAPI } from "@eforge-build/extension-sdk";

export default function extension(eforge: EforgeExtensionAPI): void | Promise<void> {
  // register handlers on eforge
}
```

The factory is called once when the extension is loaded. All registrations must happen synchronously during the factory call (or within the awaited `Promise<void>` if the factory is async). Registrations made after the factory resolves are not guaranteed to take effect.

### `defineEforgeExtension(factory)`

A no-op identity helper for TypeScript inference. Useful when you want parameter inference without explicitly importing `EforgeExtensionAPI`:

```ts
import { defineEforgeExtension } from "@eforge-build/extension-sdk";

export default defineEforgeExtension((eforge) => {
  // eforge is inferred as EforgeExtensionAPI
});
```

**Type:** `(factory: EforgeExtensionFactory) => EforgeExtensionFactory`

**Runtime cost:** none (returns the factory unchanged).

---

## Dependency and capability contracts

Directory-layout extensions may declare public capabilities and dependency requirements in `package.json#eforge.extension` before any extension code is imported:

```json
{
  "name": "acme-workflow",
  "version": "1.2.0",
  "eforge": {
    "extension": {
      "name": "acme-workflow",
      "capabilities": [{ "name": "acme.workflow", "version": "1.2.0" }],
      "dependencies": {
        "required": [{ "name": "acme-core", "version": ">=1.0.0" }],
        "optional": [{ "capabilities": [{ "name": "acme.backlog", "version": ">=1.0.0" }] }]
      }
    }
  }
}
```

Capability declarations use `{ name, version? }` with exact semantic versions. Dependency entries use `{ name?, version?, capabilities? }`; omit `name` only for capability-only requirements. Version constraints support exact semantic versions, `>`, `>=`, `<`, `<=`, and comma-separated AND constraints. Required failures skip the dependent extension; optional failures keep it loaded and surface availability metadata.

Actions, agent task contributions, Console contributions, workstations, commands, and deep links may also declare `requirements?: { dependencies?: [...], capabilities?: [...] }`. The contribution manifest includes `availability`; unavailable actions are rejected with error code `unavailable`.

Action handlers receive immutable lookup data:

```ts
eforge.registerAction({
  id: "inspect-backlog",
  title: "Inspect backlog availability",
  inputSchema: Type.Object({}),
  requirements: { capabilities: [{ name: "acme.backlog" }] },
  handler: (_input, ctx) => ({
    dependency: ctx.dependencies.get("acme-core").available,
    backlog: ctx.capabilities.get("acme.backlog", ">=1.0.0").available,
  }),
});
```

The lookup API reports availability only. It does not call, proxy, or invoke another extension.

---

## Configuration fields

Policy gate and validation-provider runtime behavior is controlled by native extension config:

| Field | Default | Meaning |
|-------|---------|---------|
| `extensions.policyGateTimeoutMs` | inherits `extensions.eventHookTimeoutMs` | Timeout in milliseconds for each `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge` handler. Must be a positive integer. |
| `extensions.policyGateFailurePolicy` | `fail-closed` | Failure policy for thrown, timed-out, or invalid policy gates. `fail-closed` blocks the gated operation; `fail-open` records diagnostics and allows it to continue. |
| `extensions.validationProviderTimeoutMs` | inherits `extensions.eventHookTimeoutMs` | Timeout in milliseconds for each validation-provider function invocation or command. Must be a positive integer. |

---

## Scoped storage helpers

### `createEforgeProjectPaths(opts)`

Create scoped path helpers for eforge-owned storage locations. Use these helpers when extension tooling or runtime handlers need deterministic user, project-team, or project-local paths without depending on ad hoc string concatenation.

```ts
import { createEforgeProjectPaths } from "@eforge-build/extension-sdk";

const paths = createEforgeProjectPaths({
  cwd: process.cwd(),
  extensionName: "my-extension",
});

const tracePath = paths.extensionStoragePath("project-local", ["traces", "item-1.json"]);
// <cwd>/.eforge/storage/extensions/my-extension/traces/item-1.json
```

**Type:**

```ts
type EforgeStorageScope = 'user' | 'project-team' | 'project-local';

interface EforgeProjectPathsOptions {
  cwd: string;
  configDir?: string;
  extensionName?: string;
}

interface EforgeProjectPaths {
  cwd: string;
  configDir: string;
  scopeRoot(scope: EforgeStorageScope): string;
  storageRoot(scope: EforgeStorageScope): string;
  storagePath(scope: EforgeStorageScope, segments: readonly string[]): string;
  extensionStorageRoot(scope: EforgeStorageScope, extensionName?: string): string;
  extensionStoragePath(scope: EforgeStorageScope, segments: readonly string[], extensionName?: string): string;
}
```

Scope roots are:

| Scope | Root | Storage root |
|-------|------|--------------|
| `user` | `~/.config/eforge/` (XDG-aware) | `~/.config/eforge/storage/` |
| `project-team` | `<cwd>/eforge/` (or `configDir`) | `<cwd>/eforge/storage/` |
| `project-local` | `<cwd>/.eforge/` | `<cwd>/.eforge/storage/` |

Extension-owned private metadata should live under `storage/extensions/<extension-name>/`, resolved with `extensionStorageRoot(scope)` or `extensionStoragePath(scope, segments)`. For example, a project-local trace sidecar for `my-extension` should use `.eforge/storage/extensions/my-extension/traces/<id>.json`. Built-in eforge workflow artifacts, such as `.eforge/session-plans/`, are not extension-owned private storage and may keep their established workflow locations.

Runtime contexts expose the same helper object as `ctx.paths`, initialized with the current `cwd`, `configDir`, and extension name:

```ts
eforge.onEvent("plan:build:failed", async (_event, ctx) => {
  const diagnosticPath = ctx.paths.extensionStoragePath("project-local", ["diagnostics", "latest.json"]);
  // Callers own mkdir/write/read behavior.
});
```

**Behavior:** helper methods validate each segment lexically, reject empty segments, `.`/`..`, path separators, absolute paths, and null bytes, then verify the resolved absolute path remains contained under the selected storage root. The helpers perform no filesystem I/O: they do not create directories, read files, write files, or test whether a path exists. Callers own all I/O.

The path helpers are not a sandbox boundary. Extensions remain trusted, unsandboxed Node code running in the daemon/worker process; these APIs only standardize path layout and guard against accidental traversal in helper inputs.

### `resolveScopedStoragePath(opts)`

One-shot wrapper around `createEforgeProjectPaths(opts).storagePath(opts.scope, opts.segments)`.

**Type:** `(opts: { cwd: string; configDir?: string; scope: EforgeStorageScope; segments: readonly string[] }) => string`

### `resolveExtensionStoragePath(opts)`

One-shot wrapper around `extensionStoragePath` for extension-owned storage.

**Type:** `(opts: { cwd: string; configDir?: string; scope: EforgeStorageScope; extensionName: string; segments: readonly string[] }) => string`

### `resolveProjectLocalStoragePath(opts)`

Compatibility helper that resolves safe path segments under the project-local `.eforge/` root.

**Type:** `(opts: { cwd: string; segments: readonly string[] }) => string`

Prefer `createEforgeProjectPaths` or `resolveExtensionStoragePath` for new extension-owned storage so the scope and `storage/extensions/<extension-name>/` convention are explicit.

These helpers do not add a native workflow registration API. The first-party `eforge-playbooks` package exposes shipped playbook behavior through extension actions and owns parser/storage/compiler/seed behavior locally; domain-neutral acceptance-criteria helpers and session-planning helpers remain separate from that playbook extension boundary. User-authored custom playbook or session-plan extraction remains future/deferred work.

---

## `EforgeExtensionAPI` methods

### `onEvent(pattern, handler)`

Subscribe to one or more event types using a glob pattern. The handler fires after the event is emitted; it does not block or influence the pipeline.

```ts
eforge.onEvent("plan:build:failed", async (event, ctx) => {
  ctx.logger.warn(`Build failed for plan ${event.planId}`);
});

eforge.onEvent("plan:build:*", async (event, ctx) => {
  ctx.logger.info(`Build lifecycle: ${event.type}`);
});
```

**Signature:**

```ts
onEvent<TType extends EforgeEvent["type"]>(
  pattern: TType,
  handler: EventHookHandler<TType>,
): void

onEvent(
  pattern: EventPattern,
  handler: (event: EforgeEvent, ctx: EventHookContext) => void | Promise<void>,
): void
```

**Handler type:**

```ts
type EventHookHandler<T extends EforgeEvent["type"]> = (
  event: EventOfType<T>,
  ctx: EventHookContext,
) => void | Promise<void>
```

The `event` parameter is narrowed to `EventOfType<T>` when the pattern is an exact event type string. For glob patterns (containing `*`), the event type is `EforgeEvent`.

**Runtime status:** registration is captured at load time and matching events are dispatched at runtime. Dispatch is non-blocking with respect to the engine pipeline: handlers cannot alter, block, or stop the triggering work. Handler failures and timeouts emit `extension:event-handler:*` diagnostics with extension name, pattern, triggering event type, and available `sessionId`/`runId` correlation fields; monitor recording sees those diagnostics before shell hooks run.

**Replay testing:** `eforge extension test` executes matching `onEvent` handlers against fixture or monitor DB events. It reports replay counts, matched hooks, emitted `extension:event-handler:*` diagnostics, and non-event registration summaries. Replay testing does not execute `onAgentRun`, custom tools, policy gates, profile routers, runtime-choice routers, input sources, reviewer perspectives, or validation providers.

---

### `onAgentRun(handler)`

Register a handler invoked before each agent run starts. The handler receives an `AgentRunContext` (which itself extends `EforgeExtensionContext`, so logger and exec are available on the same object) and may return a `promptAppend` fragment, per-run extension `tools`, or additive `allowedTools` / `disallowedTools` tuning. Inspect `ctx.role`, `ctx.tier`, `ctx.phase`, and `ctx.stage` to scope behavior to specific agent roles or lifecycle positions.

```ts
eforge.onAgentRun(async (ctx) => {
  if (ctx.role !== "builder") return;
  return {
    promptAppend: "Check the design system before modifying UI components.",
  };
});
```

**Signature:**

```ts
onAgentRun(handler: AgentRunHandler): void
```

**Handler type:**

```ts
type AgentRunHandler = (
  ctx: AgentRunContext,
) => AgentRunAugmentation | undefined | void | Promise<AgentRunAugmentation | undefined | void>
```

**`AgentRunContext`** (extends `EforgeExtensionContext`):

```ts
interface AgentRunContext extends EforgeExtensionContext {
  role: AgentRole;
  tier: string;
  profile: string;
  planId?: string;
  changedFiles?: string[];
  // Lifecycle context (populated for pipeline runs):
  phase?: string;   // 'compile' | 'build' | 'standalone'
  stage?: string;   // e.g. 'implement', 'review', 'planner'
  // Runtime metadata (read-only):
  harness?: 'claude-sdk' | 'pi';
  runtimeChoice?: string;
  runtimeChoiceQualified?: string;
  runtimeChoiceSource?: 'default' | 'rule' | 'extension-router' | 'fallback';
  runtimeChoiceRule?: string;
  runtimeChoiceRouter?: string;
  runtimeChoiceFallbackReason?: 'no-match' | 'router-declined' | 'router-timeout' | 'router-error' | 'router-invalid-choice';
  toolbelt?: string | null;
  toolbeltSource?: 'tier' | 'role' | 'plan' | 'default';
  projectMcpSelection?: 'all' | 'none' | 'toolbelt';
  effectiveToolName(name: string): string;
}
```

**`AgentRunAugmentation`:**

```ts
interface AgentRunAugmentation {
  promptAppend?: string;
  /** Additional extension tools made available only for this run. */
  tools?: ExtensionTool[];
  /** Tool names additively allowed for this run when a harness allowlist is active. */
  allowedTools?: string[];
  /** Tool names additively disallowed for this run; deny wins. */
  disallowedTools?: string[];
}
```

**Prompt composition:** returned `promptAppend` fragments are appended *after* any config-level `promptAppend` already resolved by the engine, wrapped in a per-extension provenance section:

```
## Native extension context

### <extension-name>
<fragment>
```

Multiple extensions append in registration order. Each handler runs with a configurable timeout (see `extensions.agentContextHookTimeoutMs`).

**Fail-open behavior:** a handler that throws an error emits an `extension:agent-context:failed` event; a handler that exceeds the timeout emits an `extension:agent-context:timeout` event. In both cases that handler's prompt/tool changes are skipped and the agent run continues. Diagnostic events carry metadata (extension name, role, tier, phase, stage, fragment count) but never the prompt fragment text.

**Tool injection and availability tuning:** returning `tools` injects extension-defined tools only for the current run. Returning `allowedTools` and `disallowedTools` additively tunes the harness allow/deny lists for the current run; deny wins when the same name appears in both. Use `ctx.effectiveToolName(name)` when prompt text needs to mention the harness-visible name for an extension tool.

**Runtime-choice boundary:** `onAgentRun` can observe the selected runtime choice through the read-only `runtimeChoice*` fields, but it runs after runtime selection. It cannot change the harness, model, provider, effort, toolbelt, or selected choice for the current invocation; use declarative `agents.tiers.<tier>.routing.rules` or `registerRuntimeChoiceRouter` for runtime-choice selection.

**Runtime status:** Yes. Prompt context, per-run extension tool injection, and per-run tool availability tuning are applied at runtime.

---

### `registerTool(tool)`

Register a custom agent tool independently of an `onAgentRun` return value. This records loader-time provenance and validation metadata so list/show/validate tooling can report the contribution. It does not globally expose the tool to every agent run; return the tool from `onAgentRun` for the roles or stages that should receive it.

```ts
import { Type, defineExtensionTool } from "@eforge-build/extension-sdk";

const lookupComponent = defineExtensionTool({
  name: "lookup-component",
  description: "Looks up a design-system component by name",
  inputSchema: Type.Object({
    name: Type.String(),
  }),
  handler: async ({ name }) => `Component: ${name}`,
});

eforge.registerTool(lookupComponent);

eforge.onAgentRun((ctx) => {
  if (ctx.role !== "builder") return;
  const toolName = ctx.effectiveToolName(lookupComponent.name);
  return {
    tools: [lookupComponent],
    promptAppend: `Use ${toolName} when you need design-system component details.`,
  };
});
```

**Signature:**

```ts
registerTool(tool: ExtensionTool): void
```

**Runtime status:** registration is captured at load time for provenance. Agent tool injection and execution happen only when an `onAgentRun` handler returns the tool for a specific run.

---

### Extension contribution contracts

The SDK also exposes registration methods for extension-authored actions and host-facing contributions. These methods are available on `EforgeExtensionAPI` for author-facing type safety; the daemon exposes safe manifest projection and action invocation routes, Console renders declarative contributions under `/console/system`, and host integrations can list and invoke actions, integration commands, and action-backed deep links through the shared contribution dispatcher.

#### `registerAgentTask(task)`

Registers a prompt-backed agent task contribution owned by the extension. Task contribution IDs are local (`planning-draft`) and are projected as owner-scoped effective IDs (`<extensionName>:<localId>`), matching action contribution naming. Task-start callers reference the contribution (`{ task: { id: "planning-draft" }, input: {...} }`) and must not supply prompt asset paths, raw prompt text, or resolver functions.

Prompt sources are declared by trusted extension code:

```ts
import { Type, defineExtensionAgentTaskContribution } from "@eforge-build/extension-sdk";

eforge.registerAgentTask(defineExtensionAgentTaskContribution({
  id: "planning-draft",
  title: "Planning draft",
  inputSchema: Type.Object({ topic: Type.String() }),
  outputSchema: Type.Object({ summary: Type.String() }),
  prompt: { kind: "asset", asset: "prompts/planning-draft.md" },
}));
```

`prompt` is either `{ kind: "asset", asset: string }` or `{ kind: "export", module: string, exportName?: string }`. Asset names must be non-empty relative paths. Registration rejects absolute paths, NUL bytes, empty path segments, `.` segments, and `..` traversal segments; later daemon prompt resolution must repeat containment checks before reading assets. Manifest projection includes only safe metadata (`id`, `localId`, `extensionName`, `title`, `description`, `inputSchema`, optional `outputSchema`, and prompt source metadata). Raw prompt text, `resolvePrompt` function bodies, and tool handlers are never included in manifests.

Resolver functions, when used by later task runtimes, are responsible for returning resolved prompt text and generic run configuration from trusted extension code. They should treat request input as untrusted data, avoid reading caller-supplied prompt paths, and keep provider-specific execution details outside extension manifests.

#### `registerAction(action)`

Registers an extension-authored action handler. Action handlers run as trusted unsandboxed Node code. Action inputs require object-root TypeBox input schemas (`Type.Object(...)`). Action handlers must return JSON-safe outputs; optional output schemas are validated before eforge reports a successful invocation. Actions may declare an optional `outputProfile` (`agent-compact`, `agent-paginated`, `markdown`, `ui-rich`, or `debug-rich`) as manifest metadata so hosts can choose safe formatting without changing invocation success/failure response shapes. CLI non-`--json`, MCP/Claude, Pi, and Console previews use that metadata when formatting invocation output: exact `{ markdown: string }` outputs render as Markdown/plain text, oversized JSON is summarized with warnings while preserving identity fields, counts, omitted counts, and cursor/offset hints, MCP/Pi coding-agent tool text is capped at 12,000 characters, and `ui-rich`/`debug-rich` outputs warn in coding-agent hosts even when they fit. Broad list/search/board-style read action registrations remain valid, but validation emits warning diagnostics for id-shaped broad reads with array-shaped outputs when they lack limit or cursor/page controls, or when array-shaped output schemas omit an explicit profile. `agent-paginated` actions with limit and cursor/page controls are considered bounded for agent use without separate projection controls.

Action contexts include dependency/capability lookup plus daemon-owned APIs. `ctx.dependencies` and `ctx.capabilities` expose immutable availability data only; they do not invoke another extension. `ctx.agentTasks` starts, reads, and cancels supported single-shot agent tasks; the daemon owns task persistence, profile/runtime resolution, cancellation, and lifecycle events, and extensions never import provider SDKs or `AgentHarness`. `ctx.buildQueue.enqueue({ source, ... })` submits normalized build source through the same daemon queue path as `POST /api/enqueue`, including session-plan submission bookkeeping and producer-agnostic queue metadata such as `postMerge` command arrays. The MVP task runner resolves the `planner` role and enforces read-only tools. Product-specific output sections, transcript storage, annotations, and preview/apply semantics belong to the extension using the task API rather than to the daemon task API itself. Contribution-reference start requests execute for registered planner-compatible task contributions; unsupported or non-compatible contribution starts fail instead of reading caller-supplied prompt paths. Extensions cannot send arbitrary raw prompt templates through task starts or implement multi-turn chat through this API.

#### `registerConsoleContribution(contribution)`

Registers declarative Console metadata rendered under `/console/system`. Blocks must use one of the closed renderer IDs: `text`, `markdown`, `status-badge`, `link`, `action-button`, or `action-form`. Action blocks bind to a local action ID with optional JSON-safe input defaults.


#### `registerConsoleWorkstation(workstation)`

Registers a sandboxed Console workstation rendered under `/console/workstations`. The source SDK shape is trusted extension UI delivered as exactly one source: iframe `srcDoc` or `frameBundle` bundle metadata. Bundle roots must be `workstation-assets` or a child directory under `workstation-assets/`; `entrypoint`, `styles`, and `assets` paths are relative to that root. Bundle entries are projected as sandboxed iframe `src` navigations to the manifest `frameBundle.frameUrl` with the bridge token in the URL fragment, not in the daemon route query string. Declared `frameBundle` assets are supported and served only through eforge-owned frame/asset routes. The daemon serves bundle workstations through a generated frame shell with no-cache semantics and a `Content-Security-Policy` header plus declared, immutable, content-addressed asset URLs; the browser never supplies filesystem-relative asset paths. Workstation UI is isolated by the Console-owned iframe sandbox and bridge checks, but the `srcDoc` HTML or bundle metadata/code is not sanitized declarative content and should be reviewed like the extension source that produced it.

```ts
import { CONTRIBUTION_OUTPUT_PROFILES, Type, defineConsoleWorkstation, defineExtensionAction } from "@eforge-build/extension-sdk";

const listPlanningArtifacts = defineExtensionAction({
  id: "list-planning-artifacts",
  title: "List planning artifacts",
  inputSchema: Type.Object({
    includeSubmitted: Type.Optional(Type.Boolean()),
    includeBoard: Type.Optional(Type.Boolean()),
    includeArchive: Type.Optional(Type.Boolean()),
    epic: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  outputSchema: Type.Object({
    artifacts: Type.Array(Type.Unknown()),
    plans: Type.Array(Type.Unknown()),
    planSets: Type.Array(Type.Unknown()),
    total: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    offset: Type.Integer({ minimum: 0 }),
    board: Type.Optional(Type.Unknown()),
  }),
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
  sideEffects: ["local-read"],
  handler: () => ({ artifacts: [], plans: [], planSets: [], total: 0, limit: 50, offset: 0 }),
});

eforge.registerAction(listPlanningArtifacts);
eforge.registerConsoleWorkstation(defineConsoleWorkstation({
  id: "planning-workstation",
  title: "Planning workstation",
  description: "Interactive planning UI backed by extension actions.",
  frameBundle: {
    root: "workstation-assets/plans",
    entrypoint: "index.js",
    styles: ["style.css"],
    browserSdkVersion: 1,
  },
  allowedActions: ["list-planning-artifacts"],
}));
```

**Bridge protocol:** Console injects a small browser helper at `window.eforge.invokeAction(actionId, input)`. The helper posts an invocation request to the parent frame. The parent validates the source frame, resolves the requested local action ID to the effective manifest ID when allowed, calls the daemon-owned action invocation route, and posts a response back to the iframe. Successful responses resolve the promise with the action output; failed or disallowed responses reject the promise with an error. Iframe bundle code can import `getEforgeConsoleBridge`, `assertEforgeConsoleBridgeVersion`, `invokeAction`, and `EFORGE_WORKSTATION_BROWSER_SDK_VERSION` from the browser-safe `@eforge-build/extension-sdk/browser` subpath; those helpers are intentionally not exported from the package root.

**Allowed actions:** `ConsoleWorkstation.allowedActions` lists local action IDs registered by the same extension. The manifest carries effective namespaced action IDs. When `allowedActions` is omitted, projection uses the same-extension default behavior for the current V1 contract; authors who need a narrow bridge should specify the allowlist explicitly. Console rejects bridge calls for actions outside the manifest allowlist.

**Signature:**

```ts
registerConsoleWorkstation(workstation: ConsoleWorkstation): void
```

```ts
interface ConsoleWorkstationBase {
  id: string;
  title: string;
  description?: string;
  allowedActions?: string[];
}

interface ConsoleWorkstationFrameBundle {
  /** Must be "workstation-assets" or a child directory under "workstation-assets/". */
  root: string;
  /** Path relative to root. */
  entrypoint: string;
  /** Paths relative to root. */
  styles?: string[];
  /** Paths relative to root. */
  assets?: string[];
  /** Optional; omitted means browser SDK v1. */
  browserSdkVersion?: 1;
}

type ConsoleWorkstation =
  | (ConsoleWorkstationBase & { srcDoc: string; frameBundle?: never })
  | (ConsoleWorkstationBase & { srcDoc?: never; frameBundle: ConsoleWorkstationFrameBundle });
```

**Runtime status:** Yes. Registrations are captured at load time, projected into the daemon contribution manifest, listed in management output, and rendered by Console as sandboxed iframe workstations under `/console/workstations` with the parent-owned action bridge. Manifest entries render from either `srcDoc` or bundle-backed `frameBundle.frameUrl` sources.

#### `registerIntegrationCommand(command)`

Registers a host-discoverable command. Commands are manifest metadata plus an action binding; CLI, MCP/Claude, and Pi hosts invoke the bound action through the daemon-owned dispatcher.

#### `registerDeepLink(deepLink)`

Registers a host-discoverable deep link. Action-backed deep links can be invoked through generic contribution surfaces; URL-only deep links are listable navigation metadata and are not generic invocations.

```ts
registerAction<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
  action: ExtensionAction<TInput, TOutput>,
): void
registerAgentTask<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
  task: ExtensionAgentTaskContribution<TInput, TOutput>,
): void
registerConsoleContribution(contribution: ConsoleContribution): void
registerConsoleWorkstation(workstation: ConsoleWorkstation): void
registerIntegrationCommand(command: IntegrationCommand): void
registerDeepLink(deepLink: ExtensionDeepLink): void
```

Use the identity helpers to preserve TypeBox inference when defining contributions:

```ts
import { Type, defineExtensionAction } from "@eforge-build/extension-sdk";

const sayHi = defineExtensionAction({
  id: "say-hi",
  title: "Say hi",
  inputSchema: Type.Object({ name: Type.String() }),
  outputSchema: Type.Object({ greeting: Type.String() }),
  outputProfile: "agent-compact",
  sideEffects: ["none"],
  handler: (input) => ({ greeting: `Hello ${input.name}` }),
});
```

Browser bundle authors can import the dedicated browser SDK subpath from iframe code:

```ts
import {
  EFORGE_WORKSTATION_BROWSER_SDK_VERSION,
  assertEforgeConsoleBridgeVersion,
  getEforgeConsoleBridge,
  invokeAction,
} from "@eforge-build/extension-sdk/browser";

assertEforgeConsoleBridgeVersion(1);
const bridge = getEforgeConsoleBridge();
const result = await invokeAction("render-board-markdown", {});
```

`EFORGE_WORKSTATION_BROWSER_SDK_VERSION` is the helper package's current browser SDK version. `getEforgeConsoleBridge()` returns the injected `window.eforge` bridge and throws if it is unavailable. `assertEforgeConsoleBridgeVersion(expected)` verifies the injected bridge major version before app code depends on it. `invokeAction(actionId, input)` is a convenience wrapper around the bridge's action invocation. These helpers are for code running inside the workstation iframe only; browser bundles must not import private Console React/components/CSS modules, parent Console context, or parent-Console plugins. Private Console React/components/CSS imports are unsupported outside the parent Console codebase, parent Console context imports are unsupported, and parent-Console plugins are unsupported.

Exported contribution types include `ExtensionAction`, `ExtensionActionOutputProfile`, `ExtensionActionContext`, `ExtensionContributionRequirements`, `ExtensionContributionAvailability`, `ExtensionAgentTasksApi`, `ExtensionActionBinding`, `ConsoleContribution`, `ConsoleContributionBlock`, `ConsoleWorkstation`, `ConsoleWorkstationBase`, `ConsoleWorkstationFrameBundle`, `ConsoleWorkstationFrameBundleWorkstation`, `ConsoleWorkstationSrcDoc`, `EforgeConsoleBridge`, `IntegrationCommand`, and `ExtensionDeepLink`. `EforgeConsoleBridge` is the browser-side shape for `window.eforge`. `ExtensionActionContext.requestedBy` uses the client-owned `ExtensionActionRequestedBy` provenance type. Host integrations that display contribution lists, details, invocation output, or failed-invocation summaries use the client formatter APIs `formatExtensionContributionListText()`/`formatExtensionContributionList()`, `formatExtensionContributionDetailText()`/`formatExtensionContributionDetail()`, `formatExtensionContributionOutput()`/`formatExtensionContributionOutputText()`, and `formatExtensionContributionFailedInvocationEnvelopeText()`/`formatExtensionContributionFailedInvocationEnvelope()` from `@eforge-build/client` or the browser-safe `@eforge-build/client/browser` entrypoint; the non-`Text` variants also return truncation metadata. Shared host contribution runtime projection and daemon dispatch helpers are exported from the main `@eforge-build/client` entrypoint only: `EXTENSION_HOST_CONTRIBUTION_KINDS`, `summarizeExtensionContributionManifest()`, `showExtensionContributionManifestEntry()`/`getExtensionContributionManifestEntry()`, `resolveExtensionContributionInvocation()`, `listEforgeExtensionContributions()`/`listEforgeExtensionContributionsIfRunning()`, `invokeEforgeExtensionContribution()`/`invokeEforgeExtensionContributionIfRunning()`, `summarizeExtensionContributionInvocationInput()`, and `createExtensionContributionFailedInvocationEnvelope()`. The main entrypoint also exports related host contribution types, including `ExtensionHostContributionKind`, `ExtensionHostContributionProjection`, `ExtensionHostContributionProjectionOptions`, `ExtensionHostContributionDetailOptions`, `ExtensionHostContributionDetailResponse`, `ExtensionHostContributionEntry`, `ExtensionHostContributionListResponse`, `ExtensionHostContributionInvokeParams`, `ExtensionHostContributionInvokeResult`, `ExtensionHostContributionInvokeTarget`, `ExtensionHostContributionInputSummary`, and `ExtensionHostContributionFailedInvocationEnvelope`; the browser-safe `@eforge-build/client/browser` entrypoint exports the browser-safe projection/list/detail/failure-envelope response types needed by the formatter APIs. Browser-specific contribution access can call `fetchExtensionContributionManifest()` / `invokeExtensionAction()`, but manifest projection and host dispatch remain Node/main-entrypoint only: browser clients can format invocation outputs directly, while list/detail formatters require an already-projected contribution list/detail response.

**Runtime status:** engine registry/runtime support plus daemon manifest/action routes, Console System rendering for declarative contributions, Console workstation rendering under `/console/workstations`, and CLI, MCP/Claude, and Pi host dispatch for action-backed contributions, plus sandboxed iframe workstation rendering. Registrations are captured at load time, local IDs are namespaced as `<extensionName>:<localId>`, invalid or duplicate registrations produce extension diagnostics, manifest/management projection omits handlers, raw prompt text, resolver functions, and tool handlers, and action dispatch validates object-root TypeBox input schemas plus JSON-safe outputs. Contribution `requirements` are projected with `availability`; unavailable actions are rejected with error code `unavailable`. Agent task contributions are projected as safe manifest metadata and contribution-reference starts execute for registered planner-compatible task contributions; unsupported/non-compatible starts fail without prompt-path fallback. Action invocations reuse `extensions.eventHookTimeoutMs`, receive dependency/capability lookup data, `ctx.agentTasks` for supported daemon-owned single-shot planner tasks, and `ctx.buildQueue.enqueue` for trusted queue handoffs, and emit daemon-scoped `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout` events without raw input payloads or raw output payloads.

---

### `beforeQueueDispatch(handler)`

Policy gate that fires before a queued PRD is dispatched to a build worker. Return `{ decision: 'block', reason }` to prevent dispatch.

```ts
eforge.beforeQueueDispatch(async (ctx) => {
  if (ctx.priority !== undefined && ctx.priority > 100) {
    return { decision: "block", reason: "Priority is outside the team-approved range" };
  }
  return { decision: "allow" };
});
```

**Signature:**

```ts
beforeQueueDispatch(handler: QueueDispatchPolicyGateHandler): void
```

**Runtime status:** registration is captured at load time and executed at runtime before queue dispatch. Decisions are blocking; `require-approval` currently blocks because no approval workflow exists.

---

### `beforePlanMerge(handler)`

Policy gate that fires before a plan's worktree is merged into the integration branch. Return `{ decision: 'block', reason }` to prevent the merge.

```ts
eforge.beforePlanMerge(async (ctx) => {
  if (ctx.diff.files.some((f) => f.path === ".env")) {
    return { decision: "block", reason: "Do not merge .env changes" };
  }
  return { decision: "allow" };
});
```

**Signature:**

```ts
beforePlanMerge(handler: PlanMergePolicyGateHandler): void
```

**Runtime status:** registration is captured at load time and executed at runtime before each plan merge. Decisions are blocking; `require-approval` currently blocks because no approval workflow exists.

---

### `beforeFinalMerge(handler)`

Policy gate that fires before the completed feature branch is merged into the base branch. Return `{ decision: 'block', reason }` to prevent the final merge.

```ts
eforge.beforeFinalMerge(async (ctx) => {
  if (ctx.diff.files.some((f) => f.path.startsWith("infra/"))) {
    return { decision: "block", reason: "Final merge touches infra/" };
  }
  return { decision: "allow" };
});
```

**Signature:**

```ts
beforeFinalMerge(handler: FinalMergePolicyGateHandler): void
```

**Handler types:**

```ts
type PolicyGateHandler<TContext extends AnyPolicyGateContext = PolicyGateContext> = (
  ctx: TContext,
) => PolicyDecision | Promise<PolicyDecision>

type QueueDispatchPolicyGateHandler = PolicyGateHandler<QueueDispatchPolicyGateContext>;
type PlanMergePolicyGateHandler = PolicyGateHandler<PlanMergePolicyGateContext>;
type FinalMergePolicyGateHandler = PolicyGateHandler<FinalMergePolicyGateContext>;
```

**Runtime status:** registration is captured at load time and executed at runtime before the final merge. Decisions are blocking; `require-approval` currently blocks because no approval workflow exists.

---

### `registerProfileRouter(spec)`

Register a function that selects an agent runtime profile for each build dispatched from the queue. Called before a queued PRD build begins.

**Signature:**

```ts
registerProfileRouter(spec: ProfileRouterSpec): void
```

**`ProfileRouterSpec`:**

```ts
interface ProfileRouterSpec {
  name: string;
  /** Canonical method — receives full build/queue context. */
  selectBuildProfile?: (
    ctx: ProfileRouterContext,
  ) => ProfileRouterResult | null | undefined | Promise<ProfileRouterResult | null | undefined>;
  /**
   * @deprecated Use `selectBuildProfile` instead.
   * Receives limited agent-run context rather than build/queue context.
   */
  resolve?: (
    ctx: AgentRunContext,
  ) => ProfileRouterResult | null | undefined | Promise<ProfileRouterResult | null | undefined>;
}

interface ProfileRouterResult {
  profile: string;
  reason?: string;
  confidence?: 'low' | 'medium' | 'high';
}
```

At least one of `selectBuildProfile` or `resolve` must be provided. The `selectBuildProfile` method is canonical and receives `ProfileRouterContext` with PRD id, title, body, priority, dependencies, available profiles, and usage statistics. The PRD body and summary exclude eforge's hidden acceptance-criteria inventory block.

Return `null` or `undefined` from the handler to defer to the next registered router (or the default profile if no router selects one). The optional `reason` and `confidence` fields flow into the `queue:profile:selected` wire event.

**Runtime status:** `Yes (pre-build dispatch)`. Routers are invoked sequentially in registration order before each queued PRD build, with per-router timeouts controlled by `extensions.profileRouterTimeoutMs` (defaulting to `extensions.eventHookTimeoutMs`) and fail-open semantics:

- **Dispatch-time routing.** Routers run after a PRD is dequeued and before `session:start` is emitted. The selected profile is persisted to the PRD's frontmatter via a `chore(queue): route <prd> to profile <name>` commit before the build subprocess starts.
- **Explicit-override precedence.** When the PRD's `frontmatter.profile` is already set, routing is skipped entirely — no `queue:profile:*` events are emitted and no router is invoked.
- **Fail-open.** A router that throws emits `queue:profile:router-failed` and the next router is consulted. A timeout emits `queue:profile:router-timeout`. A returned profile name that cannot be loaded (not found in any scope) emits `queue:profile:invalid-selection`. If no router yields a valid selection, the build proceeds under the default profile (unchanged from current behavior).
- **First-valid-wins.** Returning `null` or `undefined` defers to the next router. The first non-null result whose profile name successfully loads wins.
- **`queue:profile:*` event family.** Four event types are emitted during dispatch:
  - `queue:profile:selected` — a valid profile was selected (includes `prdId`, `profile`, `baseProfile`, `routerName`, `extensionName`, `extensionPath`, optional `reason`/`confidence`).
  - `queue:profile:router-failed` — a router threw (includes `message`, optional `stack`).
  - `queue:profile:router-timeout` — a router exceeded its timeout (includes `timeoutMs`).
  - `queue:profile:invalid-selection` — a router returned a profile that could not be loaded (includes `requestedProfile`, `reason: 'not-found' | 'load-error'`).
- **Exact-quota caveat.** `ctx.usage.profile(name)` returns best-effort data from daemon event history. It does not query provider APIs for exact quota state. Use it for heuristic decisions (cooldown detection, token accumulation trends) rather than hard quota enforcement.

**Example using `selectBuildProfile`:**

```ts
eforge.registerProfileRouter({
  name: 'quota-aware-router',
  async selectBuildProfile(ctx) {
    const usage = ctx.usage.profile('primary-profile');
    if (usage.cooldownActive || usage.nearLimit) {
      // Fall back to secondary when primary is throttled
      return { profile: 'secondary-profile', reason: 'primary in cooldown', confidence: 'medium' };
    }
    if (ctx.availableProfiles.some((p) => p.name === 'primary-profile')) {
      return { profile: 'primary-profile', reason: 'primary available', confidence: 'high' };
    }
    return null; // Defer to next router or default profile
  },
});
```

See [`examples/extensions/profile-router.ts`](../examples/extensions/profile-router.ts) for a complete three-tier fallback example with env-var-driven profile names.

---

### `registerRuntimeChoiceRouter(spec)`

Register a function that can select a tier-local runtime choice for an individual agent invocation after role-to-tier resolution and after declarative routing rules decline to match. This is a separate layer from `registerProfileRouter`: profile routers select the active profile before build dispatch, while runtime-choice routers select among choices already declared inside the selected tier.

**Signature:**

```ts
registerRuntimeChoiceRouter(spec: RuntimeChoiceRouterSpec): void
registerRuntimeChoiceRouter(name: string, handler: RuntimeChoiceRouterHandler): void
```

**`RuntimeChoiceRouterSpec`:**

```ts
interface RuntimeChoiceRouterSpec {
  name: string;
  resolveRuntimeChoice: (ctx: RuntimeChoiceRouterContext) => RuntimeChoiceRouterResult | string | null | undefined | Promise<RuntimeChoiceRouterResult | string | null | undefined>;
}

interface RuntimeChoiceRouterContext extends EforgeExtensionContext {
  role: AgentRole;
  tier: string;
  profile: string;
  availableChoices: Array<{ name: string; qualified: string }>;
  phase?: string;
  stage?: string;
  planId?: string;
  planName?: string;
  planSummary?: string;
  prdTitle?: string;
  prdSummary?: string;
  taskSummary?: string;
  keywordText?: string;
  pathHints?: string[];
  changedFiles?: string[];
  shardIds?: string[];
  shardRoots?: string[];
  shardFiles?: string[];
}

interface RuntimeChoiceRouterResult {
  choice?: string;
  decline?: boolean;
  reason?: string;
  confidence?: number;
}
```

Return a choice name, `{ choice }`, `null`, `undefined`, or `{ decline: true }`. Choice names must resolve within the already-selected tier: use `default`, a tier-local name such as `ui`, or the same-tier qualified form such as `implementation.ui`. Cross-tier choices and unknown choices are invalid.

**Runtime status:** `Yes (per agent invocation)`. Declarative `agents.tiers.<tier>.routing.rules` run first; if a rule matches, runtime-choice routers are not invoked. If no rule matches, routers are invoked in registration order. Declines continue to the next router. A router error, timeout, invalid result, or unknown choice falls back to the tier `default` choice for that invocation and does not fail the build. Non-secret selection metadata is exposed on `agent:start` events and on `onAgentRun` context as `runtimeChoice*` fields.

---

### `registerInputSource(adapter)`

Register a custom input source that produces PRD/build-source artifacts for the queue. Adapters are selected at enqueue time by matching the adapter `name` against the `<adapter>` segment of an `eforge://input/<adapter>/<id>` URI.

**Signature:**

```ts
registerInputSource(adapter: InputSourceAdapter): void
```

**`InputSourceAdapter`:**

```ts
interface InputSourceAdapter {
  /** Unique adapter name matched against the URI's <adapter> segment (e.g. `github`, `linear`). */
  name: string;
  /** Human-readable description of where this source retrieves input from. */
  description: string;
  /**
   * Fetch the build input for the given identifier.
   *
   * Returns raw content (string), a structured InputSourceResult, or null if
   * the identifier was not found. Returning null is fatal to enqueue.
   * The optional ctx argument provides cwd and source provenance during enqueue preprocessing.
   */
  fetch: (id: string, ctx?: InputTransformContext) => Promise<string | InputSourceResult | null>;
}
```

**`InputSourceResult`:**

```ts
interface InputSourceResult {
  /** The raw build-input artifact content. */
  content: string;
  /** Optional human-readable title for the fetched item. */
  title?: string;
}
```

**`InputTransformContext`** (extends `EforgeExtensionContext`):

```ts
interface InputTransformContext extends EforgeExtensionContext {
  /** Absolute path to the project working directory. */
  cwd: string;
  /** The raw input content as originally provided (before any transformations). */
  originalSource: string;
  /**
   * How the source was supplied:
   * - 'inline' - raw text provided directly.
   * - 'file' - content read from a local file path.
   * - 'extension-reference' - a symbolic reference resolved by a registered adapter.
   */
  sourceKind: 'inline' | 'file' | 'extension-reference';
  /** Absolute path to the source file when sourceKind is 'file'. */
  sourcePath?: string;
  /** The adapter that produced this input when sourceKind is 'extension-reference'. */
  adapterId?: string;
  /** The remaining URI id passed to the input source adapter when sourceKind is 'extension-reference'. */
  sourceId?: string;
  /** Name of the extension that registered the adapter when sourceKind is 'extension-reference'. */
  extensionName?: string;
  /** Path of the extension that registered the adapter when sourceKind is 'extension-reference'. */
  extensionPath?: string;
}
```

**Preprocessing context limits:** although `InputTransformContext` extends `EforgeExtensionContext` for typing convenience, enqueue preprocessing receives only cwd/provenance metadata plus stub helpers. `ctx.exec.run` is unavailable during preprocessing and throws if called. `ctx.logger` is a no-op logger, so its behavior is not equivalent to event-hook or policy-gate logging.

**URI dispatch:** the runtime parses `eforge://input/<adapter>/<id>` URIs and looks up the registered adapter whose `name` exactly matches `<adapter>`. The remaining `<id>` path is passed to `fetch`. Example URIs:
- `eforge://input/github/acme/backend#42` — adapter `github`, id `acme/backend#42`
- `eforge://input/linear/ENG-42` — adapter `linear`, id `ENG-42`
- `eforge://input/jira/ENG-42` — adapter `jira`, id `ENG-42`

**Failure policy:** returning `null` or throwing is fatal to enqueue (`FatalPreprocessingError`). Design adapters to be safe-by-default: when credentials are absent, return an `InputSourceResult` with instructional content rather than throwing.

**Provenance events:** `extension:input-source:fetched` (success) and `extension:input-source:failed` (null return or throw).

**Runtime status:** Yes (extension-aware enqueue preprocessing). Registration is captured at load time; adapters are invoked during enqueue preprocessing when a matching `eforge://input/<adapter>/<id>` URI is supplied.

See [`examples/extensions/issue-tracker.ts`](../examples/extensions/issue-tracker.ts) for a worked example with GitHub, Linear, and Jira adapters.

---

### `registerPrdEnricher(spec)`

Register a PRD enricher that mutates or augments PRD/build-source content before it is written to the queue. Enrichers run in registration order after all input source preprocessing completes.

**Signature:**

```ts
registerPrdEnricher(spec: PrdEnricher): void
```

**`PrdEnricher`:**

```ts
interface PrdEnricher {
  /** Unique enricher name used for logging, duplicate detection, and provenance. */
  name: string;
  /** Human-readable description of what this enricher does. */
  description: string;
  /**
   * Enrich the given PRD content.
   *
   * Return a PrdEnrichmentResult to replace the content, or null/undefined to
   * pass the content through unchanged.
   */
  enrich: (input: PrdEnrichmentInput) => Promise<PrdEnrichmentResult | null | undefined> | PrdEnrichmentResult | null | undefined;
}
```

**`PrdEnrichmentInput`:**

```ts
interface PrdEnrichmentInput {
  /** The PRD/build-source content to be enriched. */
  content: string;
  /** The source identifier (e.g. file path, issue id) for this PRD content. */
  sourceId: string;
  /** Runtime context providing cwd and source provenance during preprocessing. */
  ctx: InputTransformContext;
}
```

**`PrdEnrichmentResult`:**

```ts
interface PrdEnrichmentResult {
  /** The enriched PRD/build-source content. */
  content: string;
}
```

**Behavior:** enrichers always run for every preprocessed source. Gate behavior inside `enrich` using `input.ctx.sourceKind`, `input.ctx.adapterId`, or `input.ctx.sourcePath` if you need to act only for specific source types. The preprocessing context has the same limits as input-source adapters: `ctx.exec.run` throws, and `ctx.logger` is a no-op logger rather than event-hook logging.

**Failure policy:** enricher failures are fail-open. A thrown error emits `extension:prd-enricher:failed` with the enricher name, source id, and error message; the unchanged content carries forward.

**Provenance events:** `extension:prd-enricher:applied` (content replaced) and `extension:prd-enricher:failed` (enricher threw).

**Runtime status:** Yes (fail-open content enrichment before queue write). Registration is captured at load time; enrichers are invoked during enqueue preprocessing in registration order.

---

### `registerReviewerPerspective(spec)`

Register a custom reviewer perspective that executes during parallel review-cycle perspective dispatch alongside built-in eforge perspectives (`review.strategy: parallel`, or `auto` once the diff crosses the parallel-review thresholds). When a perspective is applicable, eforge dispatches it as its own review perspective using the generic reviewer prompt with `promptFragment` appended as an extension-provenance section. Multiple extensions may register perspectives; each applicable perspective is dispatched separately and its findings are aggregated with the other review results.

**Signature:**

```ts
registerReviewerPerspective(spec: ReviewerPerspectiveSpec): void
```

**`ReviewerPerspectiveSpec`:**

```ts
interface ReviewerPerspectiveSpec {
  /** Unique perspective key used as the review perspective identifier. */
  key: string;
  /** Human-readable label shown in review output and management tooling. */
  label: string;
  /**
   * Human-readable description of what this perspective reviews.
   * Exposed in management projections (eforge extension show, list, validate, test).
   */
  description: string;
  /** Prompt fragment appended to the generic reviewer prompt when this perspective is active. */
  promptFragment: string;
  /** Optional applicability rules. Omit to run on every parallel review cycle. */
  appliesTo?: ReviewerPerspectiveApplicability;
}

interface ReviewerPerspectiveApplicability {
  /** Glob patterns matched against changed file paths. */
  fileGlobs?: string[];
  /** Path prefixes matched against changed file paths. */
  paths?: string[];
  /** File extensions, with or without a leading dot. */
  extensions?: string[];
  /** Built-in file categories that must have at least one changed file. */
  categories?: Array<'code' | 'api' | 'docs' | 'config' | 'deps' | 'test'>;
  /** Minimum number of changed files. */
  minChangedFiles?: number;
  /** Minimum number of added + deleted lines. */
  minChangedLines?: number;
  /** Optional predicate called after all declarative rules pass. */
  fn?: (changedFiles: string[], changedLines: number) => boolean | Promise<boolean>;
}
```

**Applicability rules:**

- `appliesTo.fileGlobs`: glob patterns matched against changed file paths in the review diff. The perspective runs when at least one changed file matches.
- `appliesTo.paths`: path prefixes matched against changed file paths.
- `appliesTo.extensions`: file extensions, with or without a leading dot.
- `appliesTo.categories`: built-in file categories (`code`, `api`, `docs`, `config`, `deps`, `test`).
- `appliesTo.minChangedFiles` / `appliesTo.minChangedLines`: minimum diff-size thresholds.
- `appliesTo.fn(changedFiles, changedLines)`: optional predicate called only after all declarative rules pass. Return `true` to include the perspective or `false` to skip it.
- Neither: omit `appliesTo` to run on every review cycle.

All specified declarative rules are ANDed together. Function-form applicability receives copies of the changed-file list and changed-line count; it does not receive a mutable orchestration context.

**Events:**

- `extension:reviewer-perspective:applied` — the perspective was evaluated as applicable and dispatched.
- `extension:reviewer-perspective:skipped` — the perspective was skipped because it was not applicable, its function-form predicate threw or timed out, an explicit key was unknown, or the predicate returned an invalid value.

Diagnostic events for reviewer perspectives include: perspective key, optional extension name/path when the skipped key maps to a registered extension perspective, optional plan id, skip reason, timeout milliseconds when applicable, and an error message for applicability failures. `unknown-key` skips omit extension provenance because no extension owns the key. There is no separate `extension:reviewer-perspective:failed` event; failures are reported as `extension:reviewer-perspective:skipped` with reason `applicability-error` or `applicability-timeout`.

**Trust model:**

Applicability inputs are read-only API snapshots (changed file paths and changed-line count). Reviewer perspectives cannot mutate orchestration state, block the review cycle, or call agent tool APIs. The extension module itself is unsandboxed trusted code running in the daemon/worker process; the read-only constraint applies to applicability inputs, not to extension code in general.

**Management projections:**

`eforge extension show` and JSON list/show/validate/test responses include registered reviewer perspectives with: `key`, `label`, `description`, extension name/path, and a normalized applicability summary. Function source text is never included in management projections.

**Limits:**

- Reviewer perspectives run during parallel review-cycle perspective dispatch only. They do not run during planning, building, merge stages, `review.strategy: single`, or `auto` reviews that stay below the parallel-review thresholds.
- `appliesTo.fn` is evaluated once per review cycle per registered perspective after declarative rules pass. Expensive synchronous work blocks the review dispatch; prefer declarative `fileGlobs`, `paths`, `extensions`, or `categories` for file-pattern-based rules.

**Runtime status:** registration is captured at load time. Perspectives execute at runtime during parallel review-cycle perspective dispatch. See [`examples/extensions/reviewer-perspective.ts`](../examples/extensions/reviewer-perspective.ts) for a worked example.

---

### `registerValidationProvider(spec)`

Register a custom validation step that runs during the per-plan `validate` build stage, after the implement stage and before the review stage.

**Signature:**

```ts
registerValidationProvider(spec: ValidationProviderSpec): void
```

**`ValidationProviderSpec`:**

Provide exactly one of `validate` (function form) or `commands` (command form). Registering both or neither is rejected at load time.

```ts
interface ValidationProviderSpec {
  /** Unique provider name. */
  name: string;
  /** Human-readable description of what this provider validates. */
  description: string;

  /**
   * Function form: run custom validation logic for the plan.
   *
   * Receives the absolute path to the plan worktree and an optional
   * `ValidationProviderContext` with richer build facts (planId, paths, logger,
   * exec, signal, changedFiles).
   *
   * Return values:
   * - `null` or `undefined` — passed
   * - `ValidationProviderResult` — explicit structured outcome; `status: 'failed'`
   *   is recoverable before terminal failure, and annotations improve recovery targeting
   *
   * Throwing/rejecting, timing out, returning a non-empty string, or returning
   * an unexpected shape is a hard failure that bypasses recovery.
   *
   * Mutually exclusive with `commands`. Provide exactly one.
   */
  validate?: (
    planOutputDir: string,
    context?: ValidationProviderContext,
  ) => Promise<null | undefined | ValidationProviderResult>
     | null | undefined | ValidationProviderResult;

  /**
   * Command form: shell commands to run in the plan worktree, one per entry.
   *
   * Each command string is split on whitespace into `[executable, ...args]`
   * and run via `execFile` (no shell interpretation — quoted args, env-var
   * expansion, redirects, and pipes are not supported). A non-zero exit code
   * is a recoverable generic subprocess failure using the command's stderr
   * (or stdout if stderr is empty) as the failure message.
   *
   * Mutually exclusive with `validate`. Provide exactly one.
   */
  commands?: string[];
}
```

**`ValidationProviderContext`:**

```ts
interface ValidationProviderContext {
  /** The plan ID being validated. */
  planId: string;
  /** Absolute path to the worktree root for the plan. */
  planOutputDir: string;
  /** Same as `planOutputDir` — the worktree root path. */
  worktreePath: string;
  /** Scoped eforge project path helpers initialized for this extension. */
  paths: EforgeProjectPaths;
  /** Structured logger routed through the eforge daemon's log pipeline. */
  logger: ExtensionLogger;
  /** Shell-exec API for running subprocesses from a validation provider. */
  exec: ExtensionExecApi;
  /** AbortSignal for the current build, if available. */
  signal?: AbortSignal;
  /** Files changed in the plan worktree, if available. */
  changedFiles?: string[];
}
```

**`ValidationRepairClass` and metadata:**

```ts
type ValidationRepairClass = 'narrow' | 'structural' | 'manual' | 'followup';
type ValidationJsonPrimitive = string | number | boolean | null;
type ValidationJsonValue =
  | ValidationJsonPrimitive
  | ValidationJsonValue[]
  | { [key: string]: ValidationJsonValue };
type ValidationProviderMetadata = Record<string, ValidationJsonValue>;
```

Metadata values must be JSON-safe primitives, arrays, or objects. Keep metadata small and factual so repair agents can use it without parsing prose.

**`ValidationProviderResult`:**

```ts
interface ValidationProviderResult {
  /** Validation outcome. */
  status: 'passed' | 'failed' | 'skipped';
  /** Optional human-readable message describing the outcome. */
  message?: string;
  /** Optional extended details (e.g. full command output). */
  details?: string;
  /** Optional structured annotations for individual files. */
  annotations?: ValidationProviderAnnotation[];
}

interface ValidationProviderAnnotation {
  severity: 'info' | 'warning' | 'error';
  message: string;
  file?: string;
  line?: number;
  details?: string;
  fix?: string;
  retryGuidance?: string;
  /** Provider-authored domain failure signature; runtime failures use a separate classification. */
  failureKind?: string;
  repairClass?: ValidationRepairClass;
  metadata?: ValidationProviderMetadata;
}
```

Use `repairClass: 'narrow'` or omit it for localized fixes. Use `repairClass: 'structural'` for extraction, file splitting, or broader code organization changes. Use `manual` when the provider should fail closed without automated repair. Use `followup` for findings that should only fail closed when every remaining issue is follow-up-only; mixed follow-up plus automatable issues route according to the narrow/structural guidance.

**Worked example:**

```ts
import type { EforgeExtensionAPI, ValidationProviderResult } from '@eforge-build/extension-sdk';

export default function validationProviders(eforge: EforgeExtensionAPI): void {
  // Function form: programmatic validation with full context access.
  eforge.registerValidationProvider({
    name: 'type-check-gate',
    description: 'Runs TypeScript type checking and fails the plan on type errors.',
    validate: async (planOutputDir, ctx): Promise<ValidationProviderResult | null> => {
      const result = await ctx!.exec.run('pnpm', ['type-check'], { cwd: planOutputDir });
      if (result.exitCode !== 0) {
        const output = result.stderr.trim() || result.stdout.trim();
        return {
          status: 'failed',
          message: 'TypeScript type checking failed',
          details: output,
          annotations: [{
            severity: 'error',
            message: 'TypeScript diagnostics must be resolved before review can continue.',
            details: output,
            fix: 'Run pnpm type-check locally and fix the reported TypeScript errors.',
            retryGuidance: 'Make the smallest type-safe change that resolves the diagnostic.',
            failureKind: 'typescript-diagnostics',
            repairClass: 'narrow',
            metadata: { command: 'pnpm type-check' },
          }],
        };
      }
      return null; // passed
    },
  });

  // Command form: exit-code-is-failure subprocess dispatch.
  eforge.registerValidationProvider({
    name: 'lint-gate',
    description: 'Runs the project linter and fails the plan on lint errors.',
    commands: ['pnpm lint'],
  });
}
```

**Failure semantics, recovery, and timeout:**

Providers are fail-closed gates. Normal validation failures — structured `{ status: 'failed' }` results and command-form non-zero exits — enter bounded in-plan recovery before terminal failure. Recovery uses the `review.maxRounds` budget and reruns the provider suite from the first provider after each recovery attempt. If recoverable failures remain unresolved when the budget is exhausted, the current plan fails and emits `plan:build:failed`.

Structured annotations are normalized into review issues. Narrow or unspecified annotations go through the review-fixer path first. Structural annotations route to the validation-fixer path. If the same validation failure signature survives a prior narrow repair attempt, eforge escalates the next attempt to structural repair. Any manual annotation disables automated repair, and an all-follow-up failure set fails closed without automated repair; mixed follow-up plus narrow or structural issues routes according to the remaining automatable issues. Before each automated repair attempt, eforge writes `.eforge/validation-recovery/<plan-set>/<plan-id>/attempt-<n>-<provider>/checkpoint.patch` and `metadata.json`; the repair prompt and evaluator both receive those checkpoint references. Every narrow or structural validation repair is evaluator-mediated before the provider suite reruns.

Command-form failures are recoverable but generic: the command output becomes the message, with no annotations, `repairClass`, `retryGuidance`, `failureKind`, or `metadata`. Use function form when a provider can supply structured repair guidance.

Hard provider failures bypass recovery and emit terminal `plan:build:failed` immediately: thrown exceptions/rejections, provider timeouts, non-empty string returns, and unexpected return shapes. The timeout is controlled by `extensions.validationProviderTimeoutMs` (falls back to `extensions.eventHookTimeoutMs`).

**Runtime events:**

- `extension:validation-provider:start` — provider invocation has begun.
- `extension:validation-provider:complete` — provider completed with a passed or skipped outcome; carries `status`.
- `extension:validation-provider:error` — provider completed with a failed outcome; carries provider name and error message. This includes recoverable normal failures (structured failed results and command-form non-zero exits) as well as hard exception/rejection, non-empty string return, and unexpected-return-shape failures.
- `extension:validation-provider:timeout` — timeout exceeded; carries provider name and elapsed milliseconds. This is a hard failure that bypasses recovery.

**Runtime status:** registration is captured at load time. Providers execute at runtime during the per-plan `validate` build stage. See [`examples/extensions/validation-provider.ts`](../examples/extensions/validation-provider.ts) for a worked example with both function-form and command-form providers.

---

## Context types

### `EforgeExtensionContext`

The base context passed to all handlers. Provides logging and command execution.

```ts
interface EforgeExtensionContext {
  logger: ExtensionLogger;
  exec: ExtensionExecApi;
  /** Scoped path helpers for resolving eforge-owned storage locations. */
  paths: EforgeProjectPaths;
}
```

Action handlers receive an `ExtensionActionContext`, which extends the base context shape with invocation provenance, immutable dependency/capability lookup, daemon-owned task controls, and daemon-owned queue handoff controls:

```ts
interface ExtensionActionContext {
  invocationId: string;
  actionId: string;
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  signal: AbortSignal;
  logger: ExtensionLogger;
  paths: EforgeProjectPaths;
  dependencies: ExtensionDependencyLookup;
  capabilities: ExtensionCapabilityLookup;
  agentTasks: ExtensionAgentTasksApi;
  buildQueue: ExtensionBuildQueueApi;
}
```

#### `ctx.agentTasks`

`ctx.agentTasks` lets an action delegate a supported single-shot agent run to the daemon while keeping the extension out of provider/runtime internals.

```ts
interface ExtensionAgentTasksApi {
  start(request: ExtensionAgentTaskStartInput): Promise<ExtensionAgentTaskStartResponse>;
  get(taskId: string): Promise<ExtensionAgentTaskGetResponse>;
  cancel(taskId: string, reason?: string): Promise<ExtensionAgentTaskCancelResponse>;
}

type ExtensionAgentTaskStartInput = {
  kind: "eforge-plan.planning-draft";
  input: EforgePlanPlanningDraftInput;
};
```

`start` persists a task record before the background run is queued and returns it as `{ task }`. The planning-draft input may request structured output sections owned by the calling first-party workflow; completed output-bearing results are validated by the shared client schema before persistence and count as output-bearing task results. Workflow-specific unresolved cases live inside the workflow output section; the top-level `needs-input` result variant carries no output sections. For first-party eforge-plan output sections and workflow semantics, see the [eforge-plan guide](/docs/eforge-plan). `get` returns `{ task }` for the persisted record. `cancel` requests cancellation for a running task, records `status: "cancelled"` when accepted, and returns the updated record as `{ task }`. Task records use `status: "queued" | "running" | "completed" | "failed" | "cancelled"`; completed records contain a JSON-safe result, failed records contain a sanitized error message, and lifecycle events never include raw task input or raw result payloads.

The action dispatcher binds task provenance to the invoking extension and host request. Do not pass secrets or raw prompt templates through task metadata. First-party workflow packages may layer their own storage, UI state, annotations, or preview/apply semantics above this API while `ctx.agentTasks` remains a daemon-owned single-shot task API. The MVP supports only the daemon-owned planner task kind shown above, with the task runner limited to read-only operation. Contribution-reference starts execute for registered planner-compatible task contributions; unsupported or non-compatible starts fail without prompt-path fallback. Caller-supplied prompt paths, arbitrary prompt templates, write-capable agent capabilities, and multi-turn chat are unsupported.

#### `ctx.buildQueue`

`ctx.buildQueue` lets an action hand a ready build source to the daemon queue without constructing raw HTTP requests.

```ts
interface ExtensionBuildQueueApi {
  enqueue(request: EnqueueRequest): Promise<EnqueueResponse>;
}
```

`enqueue` follows the daemon enqueue route semantics: it validates profile/landing/dependency fields and `postMerge` command arrays, spawns the enqueue worker, returns `{ sessionId, pid, autoBuild }`, and applies built-in session-plan submission bookkeeping when the source is a flat session plan under `.eforge/session-plans/`. Per-enqueue `postMerge` commands are persisted as queued PRD metadata and appended after configured `build.postMergeCommands` for that build. Actions using it should declare `build-queue` in `sideEffects`.

**`ExtensionLogger`:**

```ts
interface ExtensionLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

**`ExtensionExecApi`:**

```ts
interface ExtensionExecApi {
  run(
    command: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
```

### `EventHookContext`

Context for `onEvent` handlers. Extends `EforgeExtensionContext` and adds an `event` field carrying the raw `EforgeEvent` that triggered the hook (the same object as the handler's first argument, exposed here for convenience in shared helpers). Runtime event hooks receive the enriched event object, including available `sessionId` and `runId` correlation fields:

```ts
interface EventHookContext extends EforgeExtensionContext {
  event: EforgeEvent;
}
```

### Policy gate contexts

Policy gate contexts are read-only snapshots for the gated operation. They include `ctx.logger` and `ctx.exec`, but those helpers do not sandbox extension code; loaded extensions remain trusted, unsandboxed code running in the daemon/worker process.

```ts
type PolicyGateKind = "queue-dispatch" | "plan-merge" | "final-merge";

interface QueueDispatchContinueRepairMetadata {
  mode: "compiled";
  sourcePrdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
}

interface QueueDispatchPolicyGateContext extends EforgeExtensionContext {
  gateKind: "queue-dispatch";
  prdId: string;
  prdTitle?: string;
  priority?: number;
  profile?: string;
  dependsOn: string[];
  /** Present only for continue-and-repair queue items backed by complete compiled artifacts; omitted for normal PRDs. */
  continueRepair?: QueueDispatchContinueRepairMetadata;
}

interface PlanMergePolicyGateContext extends EforgeExtensionContext {
  gateKind: "plan-merge";
  planId: string;
  diff: ExtensionDiff;
}

// Backward-compatible alias for the original plan-merge context.
type PolicyGateContext = PlanMergePolicyGateContext;

interface FinalMergePolicyGateContext extends EforgeExtensionContext {
  gateKind: "final-merge";
  featureBranch: string;
  baseBranch: string;
  planIds?: string[];
  diff: ExtensionDiff;
}

type AnyPolicyGateContext =
  | QueueDispatchPolicyGateContext
  | PlanMergePolicyGateContext
  | FinalMergePolicyGateContext;

interface ExtensionDiff {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
  }>;
}
```

`continueRepair` is available only on `beforeQueueDispatch` contexts for continue-and-repair PRDs backed by complete compiled artifacts. The SDK exposes the parsed camelCase shape shown above. Normal PRDs omit the property entirely.

---

## Hook result types

### `PolicyDecision`

Returned by policy gate handlers. A discriminated union with three variants:

```ts
type PolicyDecision =
  | { decision: "allow" }
  | { decision: "block"; reason: string }
  | { decision: "require-approval"; reason: string };
```

- `allow` - the operation proceeds normally.
- `block` - the operation is rejected. `reason` is surfaced in logs and Console.
- `require-approval` - currently blocks the operation because no approval workflow, approval state, or Console approval UI exists in this MVP.

A `modify` variant (mutating the diff inline) is intentionally absent. `modify` decisions remain deferred; no policy gate in the current scope explicitly allows mutation.

---

## Event types and `EventPattern` glob semantics

All event types are exposed through `packages/client/src/events.schemas.ts` as the `EforgeEvent` discriminated union and implemented in focused modules under `packages/client/src/events/`. The SDK re-exports `EforgeEvent`, `EforgeEventSchema`, `AgentRole`, and `safeParseEforgeEvent` from `@eforge-build/client`. The lower-level `@eforge-build/client/events` subpath also exports `DaemonStreamSnapshotSchema` for validating the daemon `stream:hello` snapshot shape, including queue hold/capability metadata and failed-enqueue projections.

Policy gate execution emits `extension:policy:decision`, `extension:policy:failed`, and `extension:policy:timeout` diagnostics with extension name/path, registration index, gate kind, method (`beforeQueueDispatch`, `beforePlanMerge`, or `beforeFinalMerge`), the configured failure policy, and target identifiers such as `prdId`, `planId`, or final-merge branch names.

Daemon-owned agent tasks emit `extension:agent-task:start`, `extension:agent-task:progress`, `extension:agent-task:complete`, `extension:agent-task:failed`, and `extension:agent-task:cancelled`. These events carry `taskId`, `taskKind`, duration/error fields where applicable, and sanitized metadata only; raw task context and result payloads stay in the persisted task record instead of the event stream.

### `EventOfType<T>`

Extract a specific event variant by type string:

```ts
import type { EventOfType } from "@eforge-build/extension-sdk";

type FailedEvent = EventOfType<"plan:build:failed">;
// resolves to the exact discriminant variant from EforgeEvent
```

### Pattern semantics

`EventPattern` is a string type alias. Patterns use `*` as a wildcard that matches any characters including `:`. The semantics are identical to shell hook patterns in `eforge/config.yaml`.

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `plan:build:failed` | `plan:build:failed` | `plan:build:complete` |
| `plan:build:*` | `plan:build:start`, `plan:build:failed`, ... | `planning:complete` |
| `*:complete` | `plan:build:complete`, `merge:finalize:complete`, `planning:complete` | `plan:build:failed` |
| `*` | Every event type | - |
| `plan.build:start` | `plan.build:start` (literal dot) | `plan:build:start` |

The last row illustrates that `.` in a pattern is a literal dot, not a regex wildcard. Only `*` is special.

### Pattern helpers

```ts
import { compileEventPattern, matchesEventPattern } from "@eforge-build/extension-sdk";

// Compile a pattern once and reuse the RegExp
const re = compileEventPattern("plan:build:*");
re.test("plan:build:failed"); // true

// One-shot test
matchesEventPattern("*:complete", "wave:complete"); // true
```

`compileEventPattern` produces an anchored `RegExp` (`^...$`) using the same algorithm as `packages/engine/src/hooks.ts::compilePattern`. The SDK ports this algorithm internally so it stays engine-independent; behavioral parity is tested in `test/extension-sdk-example.test.ts`.

---

## TypeBox schema usage and `ExtensionTool`

The SDK uses TypeBox as its schema language. Import `Type`, `TSchema`, `TObject`, and `Static` directly from `@eforge-build/extension-sdk` - you do not need a separate `@sinclair/typebox` dependency to write tools.

### `ExtensionTool<TInput>`

```ts
interface ExtensionTool<TInput extends TObject = TObject> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: Static<TInput>) => Promise<string> | string;
}
```

### `defineExtensionTool(tool)`

Identity helper for inference. Returns the tool unchanged at runtime:

```ts
import { defineExtensionTool, Type } from "@eforge-build/extension-sdk";

const lookupTool = defineExtensionTool({
  name: "lookup-component",
  description: "Looks up a design system component by name",
  inputSchema: Type.Object({
    name: Type.String({ description: "Component name" }),
  }),
  handler: async ({ name }) => {
    return `Component: ${name}`;
  },
});
```

`ExtensionTool` is a narrower public type than the engine's internal `CustomTool`. The loader captures `ExtensionTool` registrations at load time for provenance and validation; `onAgentRun` return values inject accepted tools for a specific run. The public shape stays narrow so the engine's internal representation can evolve without breaking extension authors.

---


## SDK stability and migration guidance

The canonical SDK stability and migration guidance lives here. Public exports from `@eforge-build/extension-sdk` are stability-promised within a major version, but runtime behavior is intentionally versioned through the daemon/client contract and documented in this reference. When upgrading:

1. Read this Extensions API reference first, especially the runtime support table and deferred-boundary notes.
2. Run `eforge extension validate <name-or-path>` to catch registration-shape changes.
3. Run `eforge extension test <name-or-path>` for replayable event hooks or registration summaries.
4. Rebuild packaged extensions against the new SDK and avoid private imports from `packages/console-ui`, `packages/engine`, or daemon internals.
5. For Console workstations, target the documented `ConsoleWorkstation` source union and `window.eforge.invokeAction` bridge. Iframe bundle code can use the versioned `@eforge-build/extension-sdk/browser` helpers instead of private Console React imports; omitted `frameBundle.browserSdkVersion` means browser SDK v1.

Breaking changes to daemon HTTP routes, event schemas, manifest wire shapes, or workstation bridge semantics require a daemon API version bump and migration notes in this section. Bundle-backed workstation manifest metadata, daemon-owned workstation frame/asset routes, daemon-owned agent-task routes, and agent task contribution manifest metadata are part of the client contract; extension-authored arbitrary asset bundle serving outside the workstation frame/asset contract, direct React component loading into the parent Console remains unsupported, raw extension-owned HTTP routes are unsupported, extension-owned AI planning/chat APIs outside `ctx.agentTasks` are unsupported, caller-supplied arbitrary raw prompt templates and multi-turn chat are not migration targets for V1 because they remain deferred or unsupported.

## Runtime support status

The daemon can discover, trust-check, import, and execute extension factories. During factory execution it records runtime-wired registrations and exposes counts through `eforge extension` CLI commands and extension daemon APIs. Direct React component loading into the parent Console is unsupported for extensions, private Console React/components/CSS imports are unsupported, parent Console context imports are unsupported, and parent-Console plugins are unsupported. Runtime dispatch and replay testing are available for `onEvent`; runtime wiring is also available for `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, `registerProfileRouter` pre-build dispatch, the shipped policy-gate subset (`beforeQueueDispatch`, `beforePlanMerge`, `beforeFinalMerge`), `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` parallel review-cycle dispatch, `registerValidationProvider` per-plan `validate`-stage execution, engine-side extension action/contribution/workstation registry support, daemon contribution manifest/action invocation routes, daemon-owned `ctx.agentTasks` dispatch for supported single-shot read-only planner tasks, daemon-owned `ctx.buildQueue.enqueue` dispatch for trusted queue handoffs, Console System rendering, and CLI/MCP/Pi host discovery/detail/invocation for action-backed contributions, plus sandboxed iframe workstation rendering. Agent task contribution declarations are captured and safely projected in manifests, but only registered planner-compatible task contributions execute; unsupported/non-compatible starts fail without prompt-path fallback. Replay invokes only matching event hooks and summarizes non-event registrations separately with their current runtime status. The first-party `eforge-playbooks` extension exposes shipped playbook behavior through native actions, and session-planning remains separate/built-in; neither is a user-authored native workflow registration API. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored custom session-plan extraction, user-authored custom playbook extraction, raw extension-owned HTTP routes, extension-authored arbitrary frontend asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied arbitrary raw prompt templates, multi-turn chat, and arbitrary frontend plugin bundles outside registered workstation iframes are intentionally deferred or unsupported runtime phases.

| Capability | Type contract | Loader-time registration capture | Runtime execution today |
|-----------|---------------|----------------------------------|-------------------------|
| `onEvent` | Yes | Yes | Yes |
| `onAgentRun` | Yes | Yes | Yes (promptAppend, per-run tools, allowedTools, disallowedTools)[^1] |
| `registerTool` / `ExtensionTool` | Yes | Yes | Provenance only; inject per run via `onAgentRun` |
| `beforeQueueDispatch` policy gate | Yes | Yes | Yes (blocking policy gate) |
| `beforePlanMerge` policy gate | Yes | Yes | Yes (blocking policy gate) |
| `beforeFinalMerge` policy gate | Yes | Yes | Yes (blocking policy gate) |
| `registerProfileRouter` | Yes | Yes | Yes (pre-build dispatch) |
| `registerInputSource` | Yes | Yes | Yes (extension-aware enqueue preprocessing) |
| `registerPrdEnricher` | Yes | Yes | Yes (fail-open content enrichment before queue write) |
| `registerReviewerPerspective` | Yes | Yes | Yes (parallel review-cycle dispatch) |
| `registerValidationProvider` | Yes | Yes | Yes (per-plan `validate` build stage) |
| `registerAction` / `ExtensionAction` | Yes | Yes | Engine action dispatcher via daemon action invocation route; action context includes dependency/capability lookup, daemon-owned `ctx.agentTasks`, and `ctx.buildQueue` |
| `registerAgentTask` / `ExtensionAgentTaskContribution` | Yes | Yes | Daemon contribution manifest projection; contribution-reference starts execute for registered planner-compatible task contributions; unsupported/non-compatible starts fail without prompt-path fallback |
| `registerConsoleContribution` / `ConsoleContribution` | Yes | Yes | Daemon contribution manifest projection; Console renders declarative panels under `/console/system` |
| `registerConsoleWorkstation` / `ConsoleWorkstation` | Yes | Yes | Daemon contribution manifest projection; Console renders sandboxed iframe workstations under `/console/workstations` from `srcDoc` entries or source `frameBundle` entries projected to daemon frame/asset URLs |
| `registerIntegrationCommand` / `IntegrationCommand` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed commands |
| `registerDeepLink` / `ExtensionDeepLink` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed deep links |

[^1]: `onAgentRun` handlers are fail-open: errors and timeouts emit `extension:agent-context:failed` / `extension:agent-context:timeout` diagnostics and do not abort the agent run. Tool names in prompt text should use `ctx.effectiveToolName(name)` when they refer to extension tools.

Loaded extensions appear in provenance and validation output, including registration summaries and diagnostics for runtime-wired families. Event-hook, agent context/tool injection, profile-router, runtime-choice-router, policy-gate, input-source fetching, PRD enrichment, reviewer perspective, validation-provider, daemon-owned action agent tasks, agent task contribution declarations, daemon-owned action build queue handoffs, and contribution-family examples can be loaded and validated at runtime. Action lifecycle diagnostics use the `extension:action:*` event family; daemon-owned task diagnostics use the `extension:agent-task:*` event family with sanitized metadata. Event-hook examples can also be dry-run with `eforge extension test --fixture <path>` or `eforge extension test --run latest`. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored custom session-plan extraction, user-authored custom playbook extraction, raw extension-owned HTTP routes, extension-authored arbitrary frontend asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied arbitrary raw prompt templates, multi-turn chat, and arbitrary frontend plugin bundles outside registered workstation iframes are future or unsupported runtime work.

---

## Toolbelt-vs-extension boundary

Profile toolbelts and extensions are complementary but intentionally separate:

| | Toolbelts | Extensions |
|-|-----------|-----------|
| **Language** | YAML (declarative) | TypeScript (imperative) |
| **Purpose** | "Which MCP servers does this tier get?" | "What should eforge do when X happens?" |
| **Can block pipeline** | No | Yes (policy gates) |
| **Can add custom tools** | Indirectly (MCP) | Yes (`ExtensionTool`) |
| **Scope model** | profiles/, user/project/local | extensions/, user/project/local |

Toolbelt filtering applies only to project MCP servers declared in `.mcp.json`. It does not filter engine-internal custom tools, harness built-ins, or extension-contributed custom tools. `registerTool` records loader-time provenance; `onAgentRun({ tools: [...] })` is the supported per-run injection path. `allowedTools` and `disallowedTools` tune harness availability for a single run and are not toolbelt configuration.

Profile routers receive available profile names and best-effort usage summaries through `ProfileRouterContext`; agent-run hooks also receive read-only runtime metadata such as `profile`, `harness`, and toolbelt selection. Extensions must not write profile marker files or redefine toolbelt declarations.
