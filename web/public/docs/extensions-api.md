---
title: Extensions API Reference
description: Type-level reference for extension hooks, actions, Console contributions, commands, and deep links in @eforge-build/extension-sdk.
---

# Extensions API Reference

This document is the type-level reference for `@eforge-build/extension-sdk`. For conceptual background, scope model, management commands (`eforge extension list/show/validate/test/new/reload`), and example walkthroughs, see [Extensions](/docs/extensions). For the user-facing profile creation, switching, and scope model that `registerProfileRouter` interacts with, see [Profiles](/docs/profiles).

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

## Configuration fields

Policy gate and validation-provider runtime behavior is controlled by native extension config:

| Field | Default | Meaning |
|-------|---------|---------|
| `extensions.policyGateTimeoutMs` | inherits `extensions.eventHookTimeoutMs` | Timeout in milliseconds for each `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge` handler. Must be a positive integer. |
| `extensions.validationProviderTimeoutMs` | inherits `extensions.eventHookTimeoutMs` | Timeout in milliseconds for each validation-provider function or command. Must be a positive integer. |
| `extensions.policyGateFailurePolicy` | `fail-closed` | Failure policy for thrown, timed-out, or invalid policy gates. `fail-closed` blocks the gated operation; `fail-open` records diagnostics and allows it to continue. |

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

These helpers do not add a native workflow registration API. The bundled playbook and session-planning adapters are internal to `@eforge-build/input`; user-authored custom playbook or session-plan extraction remains future/deferred work.

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

**Replay testing:** `eforge extension test` executes matching `onEvent` handlers against fixture or monitor DB events. It reports replay counts, matched hooks, emitted `extension:event-handler:*` diagnostics, and non-event registration summaries. Replay testing does not execute `onAgentRun`, custom tools, policy gates, profile routers, input sources, reviewer perspectives, or validation providers.

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
  stage?: string;   // e.g. 'implement', 'review', 'planner', 'module-planner'
  // Runtime metadata (read-only):
  harness?: 'claude-sdk' | 'pi';
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

#### `registerAction(action)`

Registers an extension-authored action handler. Action handlers run as trusted unsandboxed Node code. Action inputs require object-root TypeBox input schemas (`Type.Object(...)`). Action handlers must return JSON-safe outputs; optional output schemas are validated before eforge reports a successful invocation.

#### `registerConsoleContribution(contribution)`

Registers declarative Console metadata rendered under `/console/system`. Blocks must use one of the closed renderer IDs: `text`, `markdown`, `status-badge`, `link`, `action-button`, or `action-form`. Action blocks bind to a local action ID with optional JSON-safe input defaults.


#### `registerConsoleWorkstation(workstation)`

Registers a sandboxed Console workstation rendered under `/console/workstations`. A workstation is trusted extension UI delivered as iframe `srcDoc`; it is isolated by the Console-owned iframe sandbox and bridge checks, but the HTML is not sanitized declarative content and should be reviewed like the extension source that produced it.

```ts
import { Type, defineConsoleWorkstation, defineExtensionAction } from "@eforge-build/extension-sdk";

const renderBoard = defineExtensionAction({
  id: "render-board-markdown",
  title: "Render board",
  inputSchema: Type.Object({}),
  outputSchema: Type.Object({ markdown: Type.String() }),
  sideEffects: ["none"],
  handler: () => ({ markdown: "# Board\nReady." }),
});

eforge.registerAction(renderBoard);
eforge.registerConsoleWorkstation(defineConsoleWorkstation({
  id: "board-workstation",
  title: "Board workstation",
  description: "Interactive board backed by extension actions.",
  srcDoc: `<!doctype html>
<button id="refresh">Refresh</button>
<pre id="output"></pre>
<script>
  document.getElementById('refresh').onclick = async () => {
    const result = await window.eforge.invokeAction('render-board-markdown', {});
    document.getElementById('output').textContent = result.markdown;
  };
</script>`,
  allowedActions: ["render-board-markdown"],
}));
```

**Bridge protocol:** Console injects a small browser helper at `window.eforge.invokeAction(actionId, input)`. The helper posts an invocation request to the parent frame. The parent validates the source frame, resolves the requested local action ID to the effective manifest ID when allowed, calls the daemon-owned action invocation route, and posts a response back to the iframe. Successful responses resolve the promise with the action output; failed or disallowed responses reject the promise with an error.

**Allowed actions:** `ConsoleWorkstation.allowedActions` lists local action IDs registered by the same extension. The manifest carries effective namespaced action IDs. When `allowedActions` is omitted, projection uses the same-extension default behavior for the current V1 contract; authors who need a narrow bridge should specify the allowlist explicitly. Console rejects bridge calls for actions outside the manifest allowlist.

**Signature:**

```ts
registerConsoleWorkstation(workstation: ConsoleWorkstation): void
```

```ts
interface ConsoleWorkstation {
  id: string;
  title: string;
  description?: string;
  srcDoc: string;
  allowedActions?: string[];
}
```

**Runtime status:** Yes. Registrations are captured at load time, projected into the daemon contribution manifest, listed in management output, and rendered by Console as sandboxed iframe `srcDoc` workstations under `/console/workstations` with the parent-owned action bridge.

#### `registerIntegrationCommand(command)`

Registers a host-discoverable command. Commands are manifest metadata plus an action binding; CLI, MCP/Claude, and Pi hosts invoke the bound action through the daemon-owned dispatcher.

#### `registerDeepLink(deepLink)`

Registers a host-discoverable deep link. Action-backed deep links can be invoked through generic contribution surfaces; URL-only deep links are listable navigation metadata and are not generic invocations.

```ts
registerAction<TInput extends TObject, TOutput extends TSchema | undefined = undefined>(
  action: ExtensionAction<TInput, TOutput>,
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
  sideEffects: ["none"],
  handler: (input) => ({ greeting: `Hello ${input.name}` }),
});
```

Exported contribution types include `ExtensionAction`, `ExtensionActionContext`, `ExtensionActionBinding`, `ConsoleContribution`, `ConsoleContributionBlock`, `ConsoleWorkstation`, `EforgeConsoleBridge`, `IntegrationCommand`, and `ExtensionDeepLink`. `EforgeConsoleBridge` is the browser-side shape for `window.eforge`. `ExtensionActionContext.requestedBy` uses the client-owned `ExtensionActionRequestedBy` provenance type.

**Runtime status:** engine registry/runtime support plus daemon manifest/action routes, Console System rendering for declarative contributions, Console workstation rendering under `/console/workstations`, and CLI, MCP/Claude, and Pi host dispatch for action-backed contributions, plus sandboxed iframe workstation rendering. Registrations are captured at load time, local IDs are namespaced as `<extensionName>:<localId>`, invalid or duplicate registrations produce extension diagnostics, manifest/management projection omits handlers, and action dispatch validates object-root TypeBox input schemas plus JSON-safe outputs. Action invocations reuse `extensions.eventHookTimeoutMs` and emit daemon-scoped `extension:action:start`, `extension:action:complete`, `extension:action:failed`, and `extension:action:timeout` events without raw input payloads or raw output payloads.

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

See [`examples/extensions/profile-router.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/profile-router.ts) for a complete three-tier fallback example with env-var-driven profile names.

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

See [`examples/extensions/issue-tracker.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/issue-tracker.ts) for a worked example with GitHub, Linear, and Jira adapters.

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

**Runtime status:** registration is captured at load time. Perspectives execute at runtime during parallel review-cycle perspective dispatch. See [`examples/extensions/reviewer-perspective.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/reviewer-perspective.ts) for a worked example.

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

**Runtime status:** registration is captured at load time. Providers execute at runtime during the per-plan `validate` build stage. See [`examples/extensions/validation-provider.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/validation-provider.ts) for a worked example with both function-form and command-form providers.

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

interface QueueDispatchCompiledResumeMetadata {
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
  /** Present only for complete compiled-resume queue items; omitted for normal PRDs. */
  compiledResume?: QueueDispatchCompiledResumeMetadata;
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

`compiledResume` is available only on `beforeQueueDispatch` contexts for PRDs with complete compiled-resume frontmatter. The SDK exposes the parsed camelCase shape shown above rather than the raw `resume_*` frontmatter keys. Normal PRDs omit the property entirely.

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

All event types are exposed through `packages/client/src/events.schemas.ts` as the `EforgeEvent` discriminated union and implemented in focused modules under `packages/client/src/events/`. The SDK re-exports `EforgeEvent`, `EforgeEventSchema`, `AgentRole`, and `safeParseEforgeEvent` from `@eforge-build/client`.

Policy gate execution emits `extension:policy:decision`, `extension:policy:failed`, and `extension:policy:timeout` diagnostics with extension name/path, registration index, gate kind, method (`beforeQueueDispatch`, `beforePlanMerge`, or `beforeFinalMerge`), the configured failure policy, and target identifiers such as `prdId`, `planId`, or final-merge branch names.

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
| `*:complete` | `plan:build:complete`, `expedition:wave:complete`, `planning:complete` | `plan:build:failed` |
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
5. For Console workstations, target the documented `ConsoleWorkstation` shape and `window.eforge.invokeAction` bridge. Reusable SDK-provided widgets should use a versioned workstation browser SDK or host-rendered slots when those surfaces exist, not private Console React imports.

Breaking changes to daemon HTTP routes, event schemas, manifest wire shapes, or workstation bridge semantics require a daemon API version bump and migration notes in this section. Separately served asset bundles, direct React component loading, raw extension-owned HTTP routes, and extension-owned AI planning/chat APIs are not migration targets for V1 because they remain deferred.

## Runtime support status

The daemon can discover, trust-check, import, and execute extension factories. During factory execution it records runtime-wired registrations and exposes counts through `eforge extension` CLI commands and extension daemon APIs. Runtime dispatch and replay testing are available for `onEvent`; runtime wiring is also available for `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, `registerProfileRouter` pre-build dispatch, the shipped policy-gate subset (`beforeQueueDispatch`, `beforePlanMerge`, `beforeFinalMerge`), `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` parallel review-cycle dispatch, `registerValidationProvider` per-plan validate-stage execution, engine-side extension action/contribution registry support, daemon contribution manifest/action invocation routes, Console System rendering, and CLI/MCP/Pi host discovery/invocation for action-backed contributions, plus sandboxed iframe workstation rendering. Replay invokes only matching event hooks and summarizes non-event registrations separately with their current runtime status. The bundled playbook and session-planning adapters are internal/built-in and are not user-authored native extension workflow registration APIs. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored custom session-plan extraction, user-authored custom playbook extraction, raw extension-owned HTTP routes, separately served frontend asset bundles, direct React component loading, extension-owned AI planning/chat APIs, and arbitrary frontend plugin bundles are intentionally deferred or unsupported runtime phases.

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
| `registerAction` / `ExtensionAction` | Yes | Yes | Engine action dispatcher via daemon action invocation route |
| `registerConsoleContribution` / `ConsoleContribution` | Yes | Yes | Daemon contribution manifest projection; Console renders declarative panels under `/console/system` |
| `registerConsoleWorkstation` / `ConsoleWorkstation` | Yes | Yes | Daemon contribution manifest projection; Console renders sandboxed iframe `srcDoc` workstations under `/console/workstations` |
| `registerIntegrationCommand` / `IntegrationCommand` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed commands |
| `registerDeepLink` / `ExtensionDeepLink` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed deep links |

[^1]: `onAgentRun` handlers are fail-open: errors and timeouts emit `extension:agent-context:failed` / `extension:agent-context:timeout` diagnostics and do not abort the agent run. Tool names in prompt text should use `ctx.effectiveToolName(name)` when they refer to extension tools.

Loaded extensions appear in provenance and validation output, including registration summaries and diagnostics for runtime-wired families. Event-hook, agent context/tool injection, profile-router, policy-gate, input-source fetching, PRD enrichment, reviewer perspective, validation-provider, and contribution-family examples can be loaded and validated at runtime. Action lifecycle diagnostics use the `extension:action:*` event family. Event-hook examples can also be dry-run with `eforge extension test --fixture <path>` or `eforge extension test --run latest`. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored custom session-plan extraction, user-authored custom playbook extraction, raw extension-owned HTTP routes, separately served frontend asset bundles, direct React component loading, extension-owned AI planning/chat APIs, and arbitrary frontend plugin bundles are future or unsupported runtime work.

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
