# @eforge-build/extension-sdk

Type-first API surface for eforge TypeScript extensions. Write extensions that observe or influence eforge lifecycle behavior with full TypeScript inference.

## Install

```sh
npm install @eforge-build/extension-sdk
# or
pnpm add @eforge-build/extension-sdk
```

## Quick start

Start with the CLI scaffold for a local, gitignored extension:

```sh
eforge extension new build-notifier
$EDITOR .eforge/extensions/build-notifier.ts
eforge extension validate build-notifier
eforge extension test build-notifier --fixture events.json
# or replay the latest recorded run:
eforge extension test build-notifier --run latest
eforge extension reload
```

By default this uses the `event-logger` template in `.eforge/extensions/` and refuses to overwrite an existing file unless `--force` is passed. Use `--template blank` for a minimal module. Use `--scope project` for `eforge/extensions/` or `--scope user` for your user config directory.

An extension is a TypeScript module with a default-export factory:

```ts
// .eforge/extensions/build-notifier.ts
import type { EforgeExtensionAPI } from "@eforge-build/extension-sdk";

export default function extension(eforge: EforgeExtensionAPI) {
  eforge.onEvent("plan:build:failed", async (event, ctx) => {
    ctx.logger.warn(`Build failed: ${event.planId}`);
  });
}
```

Use `defineEforgeExtension` when you want factory parameter inference:

```ts
import { defineEforgeExtension } from "@eforge-build/extension-sdk";

export default defineEforgeExtension((eforge) => {
  eforge.onEvent("plan:build:*", async (event, ctx) => {
    ctx.logger.info(`Build event: ${event.type}`);
  });
});
```

## Runtime loading

The eforge daemon discovers and loads native extensions from three scopes:

| Scope | Directory | Trust default | Purpose |
|-------|-----------|---------------|---------|
| User | `~/.config/eforge/extensions/` | trusted | Personal, cross-project |
| Project/team | `eforge/extensions/` | untrusted unless a matching local trust record exists | Shared, committed |
| Project-local | `.eforge/extensions/` | trusted | Local experiments |

Precedence is `project-local > project-team > user`. Supported entrypoints are `.ts`, `.mts`, `.js`, and `.mjs` files or directories with `index.*` / supported `package.json` entrypoints. TypeScript loads through `jiti`; JavaScript uses dynamic import. Extensions run in the eforge daemon/worker Node process without a sandbox. Project/team extensions require an explicit per-extension local trust record in `.eforge/extension-trust.json` — created by `eforge extension trust <name>` — before loading; any content change invalidates the stored hash and blocks the extension until re-trusted. Trust/untrust commands only discover and hash project/team candidates and update `.eforge/extension-trust.json`; they do not import the module or execute its factory. Later validate, test, reload, or build operations may load and execute trusted extension code.

Loader-time registration capture is available today for runtime-wired families: the daemon calls each default-export factory and records registrations for provenance, validation, CLI/API/MCP/Pi tooling, and diagnostics. Runtime dispatch and replay testing are available for `onEvent`; `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, `registerProfileRouter` pre-build dispatch, the shipped policy-gate subset (`beforeQueueDispatch`, `beforePlanMerge`, `beforeFinalMerge`), `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` parallel review-cycle dispatch, `registerValidationProvider` per-plan validate-stage execution, engine-side extension action/contribution/workstation registry support, safe manifest projection for `registerAgentTask` prompt-backed task contributions, daemon contribution routes, Console System rendering for declarative contributions, Console workstation rendering as sandboxed iframe workstations under `/console/workstations`, host discovery/invocation for actions, integration commands, and action-backed deep links, daemon-owned `ctx.agentTasks` dispatch for supported single-shot read-only planner tasks, and daemon-owned `ctx.buildQueue.enqueue` dispatch for trusted build-queue handoffs are wired. The client-owned manifest contract preserves `srcDoc` entries and also supports source `frameBundle` entries rendered from eforge-owned workstation frame URLs. The first-party `eforge-playbooks` package exposes shipped playbook behavior through extension actions backed by public `@eforge-build/input` helpers; session-planning helpers remain separate from that playbook extension boundary. These are not extension SDK registration APIs for user-authored workflow extraction. Agent task contribution starts parse by contribution reference but are not executed yet. Raw extension-owned HTTP routes are unsupported. Extension-owned AI planning/chat APIs are unsupported outside `ctx.agentTasks`. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, raw extension-owned HTTP routes, arbitrary frontend plugin bundles outside registered workstation iframes, arbitrary frontend asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied arbitrary raw prompt templates, multi-turn chat, user-authored session-plan extraction, and user-authored playbook extraction remain separate, deferred, or unsupported runtime phases. Parent-Console plugins are unsupported.

## Dependency and capability metadata

Directory-layout extensions can declare public capabilities and required/optional dependencies in `package.json#eforge.extension`:

```json
{
  "name": "acme-workflow",
  "version": "1.2.0",
  "eforge": {
    "extension": {
      "name": "acme-workflow",
      "capabilities": [{ "name": "acme.workflow", "version": "1.2.0" }],
      "dependencies": {
        "optional": [{ "name": "acme-backlog", "capabilities": [{ "name": "acme.backlog", "version": ">=1.0.0" }] }]
      }
    }
  }
}
```

Required dependency failures skip the dependent extension. Optional failures keep it loaded and populate contribution/action lookup availability. Action handlers can inspect immutable state only:

```ts
handler: (_input, ctx) => ({
  backlogAvailable: ctx.capabilities.get("acme.backlog", ">=1.0.0").available,
  dependencyAvailable: ctx.dependencies.get("acme-backlog").available,
})
```

The lookup API does not invoke other extensions.

## Scoped storage helpers

Use `createEforgeProjectPaths` to resolve eforge-owned storage locations for the user, project-team, and project-local scopes. It is exported from the package root and `@eforge-build/extension-sdk/project-paths`, so extension tooling can use the same path convention without loading an extension module or running the daemon extension runtime.

```ts
import { createEforgeProjectPaths } from "@eforge-build/extension-sdk";

const paths = createEforgeProjectPaths({
  cwd: process.cwd(),
  extensionName: "my-extension",
});

const projectCache = paths.extensionStoragePath("project-local", ["cache.json"]);
// <cwd>/.eforge/storage/extensions/my-extension/cache.json

const teamIndex = paths.storagePath("project-team", ["indexes", "team.json"]);
// <cwd>/eforge/storage/indexes/team.json
```

Available scopes are `"user"`, `"project-team"`, and `"project-local"`. Scope roots are `~/.config/eforge/` (XDG-aware), `<cwd>/eforge/`, and `<cwd>/.eforge/`; storage roots add `storage/` below those roots. Extension-owned private metadata should live under `storage/extensions/<extension-name>/`, usually via `extensionStorageRoot(scope)` or `extensionStoragePath(scope, segments)`. Built-in eforge workflow artifacts, such as `.eforge/session-plans/`, are not extension-owned private storage and may keep their established locations.

Runtime contexts include the same helpers as `ctx.paths`, already initialized with the current extension name:

```ts
eforge.onEvent("plan:build:failed", async (_event, ctx) => {
  const tracePath = ctx.paths.extensionStoragePath("project-local", ["traces", "latest.json"]);
  // Callers own directory creation and writes.
});
```

The helper rejects empty segments, `.`/`..`, path separators, absolute paths, and null bytes, then verifies the resolved absolute path remains contained under the selected storage root. It performs no filesystem I/O: it does not create directories, read files, write files, or check whether the path exists. These helpers are path-convention utilities only; extensions remain trusted, unsandboxed Node code, and the returned paths are not a sandbox boundary.

`resolveScopedStoragePath` and `resolveExtensionStoragePath` are convenience wrappers for one-shot resolution. `resolveProjectLocalStoragePath` remains available for compatibility and resolves segments under `<cwd>/.eforge/`.

## Registration methods

| Method | Description | Loader-time capture | Runtime execution |
|--------|-------------|---------------------|-------------------|
| `onEvent(pattern, handler)` | Subscribe to typed events (glob patterns) | Yes | Yes |
| `onAgentRun(handler)` | Append prompt context, inject extension tools, and tune tool availability scoped by role/tier/phase | Yes | Yes |
| `registerTool(tool)` | Register a custom agent tool for loader/list provenance and validation | Yes | Provenance only; inject per run via `onAgentRun` |
| `beforeQueueDispatch(handler)` | Policy gate before queued PRD dispatch | Yes | Yes (blocking policy gate) |
| `beforePlanMerge(handler)` | Policy gate before plan worktree is merged into the integration branch | Yes | Yes (blocking policy gate) |
| `beforeFinalMerge(handler)` | Policy gate before final feature merge | Yes | Yes (blocking policy gate) |
| `registerProfileRouter(spec)` | Select agent runtime profile per build (canonical: `selectBuildProfile`) | Yes | Yes (pre-build dispatch) |
| `registerInputSource(adapter)` | Produce PRD/build-source artifacts via `eforge://input/<adapter>/<id>` URIs | Yes | Yes (extension-aware enqueue preprocessing) |
| `registerPrdEnricher(spec)` | Enrich PRD/build-source content before queue write | Yes | Yes (fail-open) |
| `registerReviewerPerspective(spec)` | Add custom reviewer perspective | Yes | Yes (parallel review-cycle dispatch) |
| `registerValidationProvider(spec)` | Add custom validation step | Yes | Yes (per-plan `validate` build stage) |
| `registerAction(action)` | Register an extension-authored action | Yes | Engine action dispatcher via daemon action invocation route; action context includes dependency/capability lookup, daemon-owned `ctx.agentTasks`, and `ctx.buildQueue` |
| `registerAgentTask(task)` | Register a prompt-backed agent task contribution | Yes | Manifest/management metadata projection; contribution-reference start shape parses, execution is not wired yet |
| `registerConsoleContribution(contribution)` | Register a Console contribution | Yes | Manifest/management metadata projection; Console renders declarative panels under `/console/system` |
| `registerConsoleWorkstation(workstation)` | Register a sandboxed Console workstation | Yes | Manifest/management metadata projection; Console renders iframe workstations under `/console/workstations` from `srcDoc` entries or source `frameBundle` entries projected to daemon frame/asset URLs |
| `registerIntegrationCommand(command)` | Register a host integration command | Yes | Manifest/management metadata projection; host integrations can invoke action-backed commands |
| `registerDeepLink(deepLink)` | Register a host deep-link | Yes | Manifest/management metadata projection; host integrations can invoke action-backed deep links |

All capabilities have full TypeScript type contracts. Loading, registration capture, `onEvent` dispatch, `onAgentRun` prompt-context augmentation, per-run extension tool injection, tool availability tuning, `registerProfileRouter` pre-build dispatch, `beforeQueueDispatch` / `beforePlanMerge` / `beforeFinalMerge` policy gates, `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` parallel review-cycle dispatch, `registerValidationProvider` per-plan validate-stage execution, engine-side action/contribution/workstation registry support, safe manifest projection for `registerAgentTask` prompt-backed task contributions, daemon contribution routes, Console System rendering for declarative contributions, Console workstation rendering from `srcDoc` or source `frameBundle` entries, host discovery/invocation for actions, integration commands, and action-backed deep links, daemon-owned `ctx.agentTasks` dispatch for supported single-shot read-only planner tasks, and daemon-owned `ctx.buildQueue.enqueue` dispatch for trusted build-queue handoffs are wired. The shipped playbook action surface lives in the first-party `eforge-playbooks` extension, and session-planning remains separate/built-in; neither is a user-authored native extension registration point. Agent task contribution starts parse by contribution reference but are not executed yet. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, raw extension-owned HTTP routes, arbitrary frontend plugin bundles outside registered workstation iframes, arbitrary frontend asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied arbitrary raw prompt templates, multi-turn chat, user-authored session-plan extraction, and user-authored playbook extraction land in separate or subsequent phases or remain unsupported. Parent-Console plugins are unsupported.

### Actions and host contributions

Use `registerAction` for daemon-invoked work and bind it to declarative surfaces with `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`. Local action IDs are resolved to effective namespaced manifest IDs by eforge, so author examples can bind to the local ID while hosts see stable manifest metadata. Contributions may declare dependency/capability `requirements`; manifest entries include `availability`, and unavailable actions are rejected with error code `unavailable`.

Action handlers also receive immutable dependency/capability lookup plus narrow daemon-owned APIs. `ctx.dependencies` and `ctx.capabilities` report availability only and do not invoke another extension. `ctx.agentTasks` supports approved single-shot agent tasks; the daemon owns task storage under `.eforge/storage/agent-tasks`, profile/runtime resolution, cancellation, and lifecycle events. `ctx.buildQueue.enqueue({ source, ... })` submits normalized build source through the same daemon queue path as `POST /api/enqueue`, including session-plan submission bookkeeping. Extensions do not import provider SDKs or `AgentHarness` and cannot send arbitrary raw prompt templates through task starts. Contribution-reference starts parse but are not executed yet; unsupported starts fail rather than reading caller-supplied prompt paths. The MVP resolves the existing planner role in read-only mode; product-specific output sections, transcript storage, annotations, and preview/apply semantics belong to the extension using the task API rather than to the daemon task API itself. Write-capable agent operation and multi-turn chat are not supported.

```ts
import {
  Type,
  defineConsoleContribution,
  defineEforgeExtension,
  defineExtensionAction,
} from "@eforge-build/extension-sdk";

const echoStatus = defineExtensionAction({
  id: "echo-status",
  title: "Echo status",
  inputSchema: Type.Object({ message: Type.String() }),
  outputSchema: Type.Object({ ok: Type.Boolean(), message: Type.String() }),
  sideEffects: ["none"],
  handler: ({ message }) => ({ ok: true, message }),
});

export default defineEforgeExtension((eforge) => {
  eforge.registerAction(echoStatus);
  eforge.registerConsoleContribution(defineConsoleContribution({
    id: "status-panel",
    title: "Status panel",
    blocks: [{
      rendererId: "action-button",
      content: "Echo a safe default status.",
      action: { actionId: "echo-status", inputDefaults: { message: "Hello" } },
    }],
  }));
});
```

Action inputs require object-root TypeBox input schemas, action handlers must return JSON-safe outputs, and optional output schemas are enforced when present. Actions may declare an optional `outputProfile` (`agent-compact`, `agent-paginated`, `markdown`, `ui-rich`, or `debug-rich`) so hosts can choose safe formatting without changing invocation success/failure response shapes. Host previews render exact `{ markdown: string }` outputs as Markdown/plain text, summarize oversized JSON with warnings while preserving identity fields, counts, omitted counts, and cursor/offset hints, and warn for `ui-rich`/`debug-rich` coding-agent reads even when they fit. Action handlers run as trusted unsandboxed Node code and reuse `extensions.eventHookTimeoutMs`; lifecycle events include provenance/duration/error metadata but omit raw input payloads and raw output payloads. Throw `ExtensionActionInputValidationError` for schema-like field issues or `ExtensionActionUserError` for user-fixable domain/precondition failures; both surface as `invalid-input` with sanitized message/details, while unexpected exceptions remain generic `handler-error` responses. Agent-task events likewise expose only sanitized metadata, never raw task input or result payloads. Console contributions render inside `/console/system` using closed renderer IDs only; Console workstations render under `/console/workstations` as sandboxed iframe documents with `window.eforge.invokeAction` or bundle iframe code using `@eforge-build/extension-sdk/browser`. Raw HTTP routes are unsupported, and arbitrary Console JavaScript outside workstations, arbitrary asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, parent-Console plugins, or independently loaded frontend plugins are deferred/unsupported. Extension-owned AI planning/chat APIs outside `ctx.agentTasks` are unsupported. The shipped playbook action/contribution surface lives in the first-party `eforge-playbooks` extension, and session-planning remains separate/built-in; neither is a user-authored workflow extraction registration point. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored session-plan extraction, and user-authored playbook extraction remain deferred. See [`examples/extensions/action-contribution.ts`](../../examples/extensions/action-contribution.ts) for a complete safe sample with a command and deep link.

### Bounded action design

Design extension actions as bounded contracts by default. Prefer small `search-*` and `get-*` actions over one broad board/list dump, keep list responses paginated, return compact summaries first, and make raw bodies, long evidence, lifecycle rows, trace payloads, or UI-only fields opt-in. If a workstation needs rich state, keep that rich projection separate from agent-oriented actions so coding agents and CLI hosts can inspect records without spending context on full UI payloads. Reserve raw CLI `--json` or direct daemon/client reads for intentional rich/debug inspection.

The SDK exports helpers for the common list-page shape:

```ts
import {
  CONTRIBUTION_OUTPUT_PROFILES,
  Type,
  createContributionPageOutputSchema,
  createContributionPaginationInputFields,
  defineExtensionAction,
  paginateContributionItems,
} from "@eforge-build/extension-sdk";

const Summary = Type.Object({ id: Type.String(), title: Type.String() }, { additionalProperties: false });
const SearchInput = Type.Object({
  query: Type.Optional(Type.String()),
  ...createContributionPaginationInputFields({ maxLimit: 50 }),
}, { additionalProperties: false });

const searchItems = defineExtensionAction({
  id: "search-items",
  title: "Search items",
  inputSchema: SearchInput,
  outputSchema: createContributionPageOutputSchema(Summary),
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
  sideEffects: ["local-read"],
  async handler(input) {
    const matches = [{ id: "item-1", title: input.query ?? "Untitled" }];
    return paginateContributionItems(matches, input, { defaultLimit: 20, maxLimit: 50 });
  },
});
```

Use `createContributionPaginationInputFields()` in object-root input schemas, `createContributionPageOutputSchema(itemSchema)` for the standard `{ items, total, limit, offset }` output shape, `paginateContributionItems()` / `resolveContributionPagination()` in handlers, and `CONTRIBUTION_OUTPUT_PROFILES` / `contributionOutputProfile()` for typed JSON-safe profile strings. These helpers are deliberately small: they establish bounded defaults and caps, while each extension still owns domain-specific filters, projections, and detail actions. Broad list/search/board-style read actions stay valid, but validation emits warning diagnostics for id-shaped broad reads with array-shaped outputs when they lack limit or cursor/page controls, or when array-shaped output schemas omit an explicit profile. `agent-paginated` actions with limit and cursor/page controls are considered bounded for agent use without separate projection controls.


### Console workstations

Use `registerConsoleWorkstation` for richer Console UI that needs browser interactivity. V1 source-authored workstations declare exactly one source: inline iframe `srcDoc` or a `frameBundle` with local bundle metadata (`root`, `entrypoint`, optional `styles`, optional `assets`, and optional `browserSdkVersion: 1`). Bundle roots must be `workstation-assets` or a child directory under `workstation-assets/`; `entrypoint`, `styles`, and `assets` paths are relative to that root. Bundle entries are projected to manifest `frameBundle.frameUrl` iframe navigations with the bridge token in the URL fragment, not in the daemon route query string. Declared `frameBundle` assets are supported and served only through eforge-owned frame/asset routes. The daemon serves a generated bundle frame shell with no-cache semantics and a `Content-Security-Policy` header, and serves declared files through immutable, content-addressed asset URLs; browsers never provide filesystem-relative asset paths. eforge serves already-present declared files; it does not build browser source, so extension authors own the bundling step that produces `workstation-assets/.../index.js`. Workstations are not shared React components, private Console imports, parent-Console plugins, or arbitrary asset bundles outside the workstation frame/asset contract; those boundaries remain unsupported for extensions. The workstation can call the parent-owned bridge at `window.eforge.invokeAction(actionId, input)` or use `invokeAction` from `@eforge-build/extension-sdk/browser` to invoke allowed extension actions.

```ts
import {
  Type,
  defineConsoleWorkstation,
  defineEforgeExtension,
  defineExtensionAction,
} from "@eforge-build/extension-sdk";

const renderSummary = defineExtensionAction({
  id: "render-summary",
  title: "Render summary",
  inputSchema: Type.Object({}),
  outputSchema: Type.Object({ markdown: Type.String() }),
  sideEffects: ["none"],
  handler: () => ({ markdown: "# Summary\nReady." }),
});

export default defineEforgeExtension((eforge) => {
  eforge.registerAction(renderSummary);
  eforge.registerConsoleWorkstation(defineConsoleWorkstation({
    id: "summary-workstation",
    title: "Summary workstation",
    srcDoc: `<!doctype html>
<button id="refresh">Refresh</button>
<pre id="output"></pre>
<script>
  document.getElementById('refresh').onclick = async () => {
    const result = await window.eforge.invokeAction('render-summary', {});
    document.getElementById('output').textContent = result.markdown;
  };
</script>`,
    allowedActions: ["render-summary"],
  }));
});
```

A bundle-backed source can use `frameBundle` instead of `srcDoc`:

```ts
eforge.registerConsoleWorkstation(defineConsoleWorkstation({
  id: "bundle-workstation",
  title: "Bundle workstation",
  frameBundle: {
    root: "workstation-assets/demo",
    entrypoint: "index.js",
    styles: ["index.css"],
    assets: ["logo.svg"],
    browserSdkVersion: 1, // optional; omitted means browser SDK v1
  },
  allowedActions: ["render-summary"],
}));
```

Iframe bundle code can import browser-safe helpers from the dedicated subpath:

```ts
import { invokeAction } from "@eforge-build/extension-sdk/browser";

const result = await invokeAction<{ markdown: string }>("render-summary");
```

The iframe `srcDoc` HTML or bundle metadata/code is trusted extension UI isolated by the Console iframe sandbox; it is not sanitized declarative content. Specify `allowedActions` to keep the bridge narrow. If the allowlist is omitted, the V1 manifest uses same-extension default behavior; Console rejects bridge calls outside the manifest allowlist. Authors may bundle React or another browser framework inside the iframe only; that code executes inside the workstation iframe boundary, not in the parent Console realm. Extension-authored arbitrary asset bundles outside the daemon-owned workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, parent-Console plugins, raw extension-owned HTTP routes, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied raw prompt templates, and multi-turn chat remain deferred or unsupported. Reusable widgets should target the versioned workstation browser SDK or host-rendered slots when available, not private Console imports.

### Agent task contributions

Use `registerAgentTask` for prompt-backed task contribution declarations owned by the extension. Local IDs are projected in manifests as `<extensionName>:<localId>`. Prompt sources are declared by trusted extension code as either relative assets or module exports; callers start tasks by contribution reference and never send prompt paths, raw prompt text, or resolver functions.

```ts
import {
  Type,
  defineExtensionAgentTaskContribution,
  defineEforgeExtension,
} from "@eforge-build/extension-sdk";

export default defineEforgeExtension((eforge) => {
  eforge.registerAgentTask(defineExtensionAgentTaskContribution({
    id: "planning-draft",
    title: "Planning draft",
    inputSchema: Type.Object({ topic: Type.String() }),
    outputSchema: Type.Object({ summary: Type.String() }),
    prompt: { kind: "asset", asset: "prompts/planning-draft.md" },
  }));
});
```

Asset prompt paths must be non-empty relative paths without absolute roots, NUL bytes, empty segments, `.` segments, or `..` traversal. Manifest projection includes safe metadata (`id`, `localId`, `extensionName`, schemas, requirements/availability, and prompt source metadata) but not raw prompt text, resolver function bodies, or tool handlers.

`registerProfileRouter` routers run before each queued PRD build. Per-router timeout is controlled by `extensions.profileRouterTimeoutMs`, which defaults to `extensions.eventHookTimeoutMs`. Routers are invoked sequentially in registration order using `selectBuildProfile` (preferred) or the deprecated `resolve` method. A `null`/`undefined` result defers to the next router. Routers that throw or time out emit `queue:profile:*` diagnostics and the next router is consulted (fail-open). An explicit `profile:` field in the PRD's frontmatter takes absolute precedence — no routers are invoked. See [`examples/extensions/profile-router.ts`](../../examples/extensions/profile-router.ts) for a three-tier fallback example.

`onEvent` handlers are non-blocking with respect to the engine pipeline. Handler failures and timeouts emit `extension:event-handler:*` diagnostics with extension name, pattern, triggering event type, and available `sessionId`/`runId` correlation fields. Use `eforge extension test <name-or-path> --fixture <path>` or `eforge extension test <name-or-path> --run latest` to dry-run matching event hooks and inspect replay counts, matches, emitted diagnostics, and non-event registration summaries.

`onAgentRun` handlers run before each agent invocation and may return `{ promptAppend, tools, allowedTools, disallowedTools }` to inject role- or phase-scoped context, expose extension tools for that run, and tune the harness allow/deny lists. Each prompt fragment is wrapped in a named provenance section appended to the resolved prompt. Handlers are fail-open: a throw or timeout emits a typed `extension:agent-context:*` diagnostic but does not abort the agent run. `registerTool` records loader-time provenance; returning `tools` from `onAgentRun` is the per-run injection path.

`registerReviewerPerspective` perspectives run during parallel review-cycle perspective dispatch (`review.strategy: parallel`, or `auto` once the diff crosses the parallel-review thresholds) when their optional `appliesTo` rules match the plan diff. Use declarative `appliesTo.fileGlobs`, `paths`, `extensions`, `categories`, or `minChanged*` thresholds when possible; reserve `appliesTo.fn(changedFiles, changedLines)` for richer predicates. See [`examples/extensions/reviewer-perspective.ts`](../../examples/extensions/reviewer-perspective.ts) and [`docs/extensions-api.md`](../../docs/extensions-api.md#registerreviewerperspectivespec).

`registerValidationProvider` providers run as fail-closed quality gates during the per-plan `validate` build stage. Function-form providers return `null`/`undefined` to pass or a structured `ValidationProviderResult`; non-empty string returns are unexpected hard failures, not ordinary gate failures. Normal validation failures — structured `{ status: 'failed' }` results and command-form non-zero exits — enter bounded in-plan recovery before terminal failure. Command-form failures are generic subprocess failures: the command output becomes the message, with no annotation guidance fields.

Prefer structured annotations with file/line data plus `fix`, `retryGuidance`, provider `failureKind`, `repairClass`, and JSON-safe `metadata` so recovery can target precise issues. Narrow or unspecified repairs use the review-fixer path first; `repairClass: 'structural'` routes to the validation-fixer path for extraction, splitting, or broader organization changes. Any `manual` annotation disables automated repair, and an all-`followup` failure set fails closed without automated repair; mixed follow-up plus narrow or structural issues routes according to the remaining automatable issues. Before each automated validation repair, eforge writes `.eforge/validation-recovery/.../checkpoint.patch` and `metadata.json`, then evaluator-gates the candidate repair before rerunning the provider suite from the first provider. Thrown errors/rejections, provider timeouts, non-empty string returns, and unexpected return shapes bypass recovery and emit `plan:build:failed` immediately. Unresolved recoverable failures still fail the plan.

## Policy decisions

Policy gates are runtime-supported for `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge`. Handlers receive read-only context snapshots, but extensions are still trusted, unsandboxed code running in the daemon/worker process. `beforeQueueDispatch` contexts include optional `continueRepair` metadata for continue-and-repair queue items backed by complete compiled artifacts; normal PRDs omit it. Policy gate failures, invalid decisions, and timeouts follow `extensions.policyGateFailurePolicy` (`fail-closed` by default, or `fail-open`).

Policy gate handlers return a discriminated union:

```ts
// allow
return { decision: "allow" };

// block
return { decision: "block", reason: "Do not merge .env changes" };

// require human approval (currently blocks because no approval workflow exists)
return { decision: "require-approval", reason: "Sensitive path changed" };
```

## Input sources and PRD enrichers

### Input source adapters

Input source adapters let extensions supply PRD/build-source artifacts from external systems using `eforge://input/<adapter>/<id>` URIs. The runtime selects an adapter by exact `name` match against the URI's `<adapter>` segment.

```ts
eforge.registerInputSource({
  name: 'linear',
  description: 'Fetch Linear issues as build-source artifacts',
  fetch: async (id: string, ctx?: InputTransformContext) => {
    const apiKey = process.env['LINEAR_API_KEY'];
    if (!apiKey) {
      // Safe-by-default: return instructions rather than throwing.
      return { content: '# Configure LINEAR_API_KEY to enable this adapter', title: `${id} (unconfigured)` };
    }
    ctx?.logger.info(`Fetching Linear issue ${id}`);
    // ... call Linear API and return { content, title }
    return null; // null signals not-found and is fatal to enqueue
  },
});
```

The `fetch` method signature accepts an optional `InputTransformContext` for context-aware adapters. During enqueue preprocessing this context is limited to cwd/provenance metadata plus stub helpers: `ctx.exec.run` is unavailable and throws, and `ctx.logger` is a no-op logger rather than event-hook logging.

```ts
interface InputTransformContext extends EforgeExtensionContext {
  cwd: string;            // project working directory
  originalSource: string; // raw input as originally provided
  sourceKind: 'inline' | 'file' | 'extension-reference';
  sourcePath?: string;    // set when sourceKind is 'file'
  adapterId?: string;     // adapter name for extension-reference sources
  sourceId?: string;      // remaining URI id for extension-reference sources
  extensionName?: string; // registering extension for extension-reference sources
  extensionPath?: string; // registering extension path for extension-reference sources
}
```

Returning `null` or throwing is fatal to enqueue. Design adapters to return instructional `InputSourceResult` content when credentials are absent rather than throwing. Provenance events: `extension:input-source:fetched` and `extension:input-source:failed`.

### PRD enrichers

PRD enrichers mutate or augment PRD content after input source preprocessing and before the artifact is written to the queue. Enrichers run in registration order and receive the output of the previous enricher as input. Gate behavior inside `enrich` using `input.ctx` fields if you need to act only for specific sources.

```ts
eforge.registerPrdEnricher({
  name: 'context-injector',
  description: 'Appends project context to every PRD',
  async enrich({ content, sourceId, ctx }) {
    // Use ctx.adapterId to act only for extension-reference sources.
    if (ctx.sourceKind !== 'extension-reference') return null; // pass through unchanged
    ctx.logger.info(`Enriching ${sourceId} from ${ctx.cwd}`);
    return { content: content + '\n\n## Project context\n...' };
  },
});
```

Enricher preprocessing uses the same limited `InputTransformContext` as input-source adapters: do not call `ctx.exec.run`, and do not rely on logger output. Enricher failures are fail-open: a thrown error emits `extension:prd-enricher:failed` and the unchanged content carries forward. Provenance events: `extension:prd-enricher:applied` and `extension:prd-enricher:failed`.

See [`examples/extensions/issue-tracker.ts`](../../examples/extensions/issue-tracker.ts) for a worked example with GitHub, Linear, and Jira adapters.

## Publishing as a package

Extensions can be published as npm packages and installed by other projects with `eforge extension install`. Declare the extension entry point in `package.json` using the `eforge.extension` field:

```json
{
  "name": "my-eforge-extension",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "eforge": {
    "extension": {
      "name": "my-extension",
      "entrypoint": "./dist/index.js",
      "capabilities": [{ "name": "acme.workflow", "version": "1.0.0" }],
      "dependencies": {
        "optional": [{ "name": "acme-backlog", "version": ">=1.0.0" }]
      }
    }
  }
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `eforge.extension.name` | Yes | Extension name used for discovery, trust records, and management commands. |
| `eforge.extension.entrypoint` | Yes | Relative path from the package root to the extension module entry point. |
| `eforge.extension.capabilities` | No | Public capabilities provided by the extension. Capability versions are exact semantic versions. |
| `eforge.extension.dependencies.required` | No | Provider/capability requirements that must resolve before this extension is imported. |
| `eforge.extension.dependencies.optional` | No | Provider/capability requirements that populate availability state without blocking import. |

### Installing packaged extensions

```sh
# Install from npm (defaults to local scope)
eforge extension install my-eforge-extension

# Install from a local package directory or tarball
eforge extension install ./packages/my-eforge-extension
eforge extension install ./dist/my-eforge-extension-1.0.0.tgz

# Install to project/team scope and record a trust annotation
eforge extension install my-eforge-extension --scope project --trust --trusted-by "Alice <alice@example.com>"

# Update to the latest version
eforge extension update my-extension

# Update an npm-installed extension to a version, range, or dist-tag
eforge extension update my-extension --version latest
eforge extension update my-extension --version 1.2.3

# Remove
eforge extension remove my-extension
```

Package acquisition uses the local `npm` CLI for npm specs/tarball URLs and the system `tar` command for tarball extraction, so ensure those commands are on `PATH` when using those source types. `eforge extension update <name> --version <specifier>` forwards the specifier only for npm-installed extensions; local package directory and tarball installs update from their recorded sidecar source.

Install sidecar files - package metadata, lockfile records, and other install-generated artifacts - are excluded from the trust hash. Reinstalling without changing the source files or trusted `workstation-assets/` browser assets does not invalidate an existing trust record.

Git URL installs are not yet supported; accepted sources are npm package specifiers (including tarball URLs), local package directories, and local `.tgz`/`.tar.gz` tarball paths.

> **Supply-chain warning:** installed extensions are unsandboxed code. npm packages, tarballs, and local package directories can contain arbitrary code. Always inspect the installed source before trusting a project/team extension. For `--scope project`, run `eforge extension trust <name>` after inspecting the code.

## Custom tools

Contribute tools to agent runs using TypeBox schemas:

```ts
import { defineExtensionTool, Type } from "@eforge-build/extension-sdk";

const myTool = defineExtensionTool({
  name: "my-tool",
  description: "Does something useful",
  inputSchema: Type.Object({
    path: Type.String(),
  }),
  handler: async ({ path }) => `processed: ${path}`,
});

// `registerTool` captures the tool at load time for provenance and validation.
eforge.registerTool(myTool);

// `onAgentRun` injects the tool only for selected runs.
eforge.onAgentRun(async (ctx) => {
  if (ctx.role !== "builder") return;
  const toolName = ctx.effectiveToolName(myTool.name);
  return {
    tools: [myTool],
    disallowedTools: ["dangerous_shell_escape"],
    promptAppend: `Use ${toolName} when you need this extension-provided helper.`,
  };
});

// `allowedTools` and `disallowedTools` tune per-run harness availability.
// They are not toolbelt configuration; toolbelts select project MCP servers from `.mcp.json`.
```

## Event patterns

Patterns use `*` as a wildcard (matches any characters including `:`):

```ts
eforge.onEvent("plan:build:*", handler);   // all build phase events
eforge.onEvent("*:complete", handler);     // all completion events
eforge.onEvent("*", handler);              // every event
```

Pattern semantics match shell hooks in `eforge/config.yaml`.

## Dependencies

- `@eforge-build/client` - canonical event types and TypeBox schemas
- `@eforge-build/scopes` - scope directory lookup provider for scoped project path helpers
- `@sinclair/typebox` - schema language for tool definitions

## Documentation

- [Extensions guide](https://eforge.build/docs/extensions) - conceptual overview, scopes, and examples
- [Extensions API reference](https://eforge.build/docs/extensions-api) - full type signatures

Local docs: [`docs/extensions.md`](../../docs/extensions.md) and [`docs/extensions-api.md`](../../docs/extensions-api.md).

## Stability, versioning, and migration

Canonical SDK stability and migration guidance lives in the [Extensions API reference](https://eforge.build/docs/extensions-api#sdk-stability-and-migration-guidance) (local: [`docs/extensions-api.md`](../../docs/extensions-api.md#sdk-stability-and-migration-guidance)). Public exports are stability-promised within a major version. Runtime loading, daemon integration, CLI/API/MCP/Pi inspection, diagnostics, registration capture, `onEvent` execution/replay testing, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, `registerProfileRouter` pre-build dispatch, the shipped policy-gate subset, `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` review-cycle dispatch, and `registerValidationProvider` validate-stage execution are available. Extension-authored actions, agent task contribution declarations, Console contributions, Console workstations, integration commands, and deep links have engine registry support and daemon manifest projection. Action contexts include `ctx.agentTasks` for daemon-owned single-shot read-only planner tasks and `ctx.buildQueue.enqueue` for daemon-owned build queue handoffs. Console System rendering applies to declarative contributions; Console workstations render as sandboxed iframes under `/console/workstations`; host discovery/invocation applies to action-backed commands and deep links.
