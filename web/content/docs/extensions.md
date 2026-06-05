---
title: Extensions
description: TypeScript and JavaScript extensions that observe lifecycle behavior and publish typed actions, Console contributions, commands, and deep links.
---

# Extensions

eforge has a broad extension surface around a small build-engine kernel. Input surfaces, playbooks, session plans, profile toolbelts, shell hooks, host integrations, wrapper apps, and native TypeScript extensions can shape how work is authored, routed, governed, observed, and integrated without moving those concerns into the engine.

Native eforge extensions are one typed mechanism in that broader surface: TypeScript or JavaScript modules loaded by the eforge daemon/worker Node process. They are the typed, programmatic counterpart to shell hooks: extension factories can register event hooks, agent-run augmenters, policy gates, profile routers, input sources, PRD enrichers, reviewer perspectives, validation providers, custom tools, typed actions, declarative Console contributions, integration commands, and deep links with full TypeScript inference.

Extensions are **not sandboxed**. A loaded native extension executes in the same Node process as eforge and has the same filesystem, environment, and network access as the daemon. Only enable extensions from sources you trust.

## What native extensions are (and are not)

Native eforge extensions are distinct from other extensibility mechanisms in the broader eforge extension surface:

| Mechanism | Language/shape | Runtime owner | Purpose |
|-----------|----------------|---------------|---------|
| Native eforge extensions | TypeScript/JavaScript modules in `extensions/` | eforge daemon/worker | Typed lifecycle registrations, per-run prompt/tool augmentation, and runtime hooks |
| Claude Code plugins | Claude Code plugin package | Claude Code host | Slash commands, MCP proxy wiring, Claude Code UX |
| Pi extensions | Pi extension package | Pi host | Native Pi commands, tools, and TUI surfaces |
| Shell hooks | YAML + shell command | eforge hook runner | Fire-and-forget notifications/integrations |
| Playbooks/session plans | Markdown input artifacts | `@eforge-build/input` then engine queue | Reusable build sources and planning artifacts |
| Profile toolbelts | YAML MCP server bundles | agent runtime registry | Declarative project MCP server selection |

Toolbelts answer "which project MCP servers from `.mcp.json` should this tier expose?" Extensions answer "what should eforge do when something happens?" and may contribute TypeScript-defined tools per agent run. Toolbelts do not filter extension-contributed tools, engine-internal custom tools, or harness built-ins. Extensions should not redefine toolbelts or act as a hidden profile/config layer.

Session plans are still project-local Markdown files under `.eforge/session-plans/` and are handled by eforge's bundled internal session-planning adapter in `@eforge-build/input`. That adapter is built in so the daemon can remain a compatibility shim around client-owned HTTP routes and wire shapes while the engine receives normalized build source. Native extensions do not currently register session-plan extraction workflows; session-plan extraction into user-authored extensions remains future/deferred work.

## Extension user workflow

A typical extension workflow has four parts:

1. **Install or author** - use `eforge extension install <source>` for npm packages, local package directories, or tarballs, or scaffold a local TypeScript module with `eforge extension new <name>`. Consumer integrations expose the same management actions through their host UIs.
2. **Configure loading** - keep `extensions.enabled: true`, then optionally use `extensions.include`, `extensions.exclude`, or `extensions.paths` to select discovered modules. Start experiments in `.eforge/extensions/` and promote to `eforge/extensions/` only when the team should share them.
3. **Trust and validate** - project/team extensions are skipped until each user runs `eforge extension trust <name>` after inspecting the code. Run `eforge extension validate` and, for event hooks, `eforge extension test` before reload or a real build.
4. **Use at runtime** - reload the daemon's extension registry with `eforge extension reload`, then run normal builds. Loaded extensions can observe events, add per-agent prompt/tool context, route profiles, enforce shipped policy gates, provide input sources and PRD enrichers, add reviewer perspectives, and run validation providers depending on what they registered.

## Configuration

Native extension loading is controlled by the top-level `extensions` block in `eforge/config.yaml`, `~/.config/eforge/config.yaml`, or `.eforge/config.yaml`:

```yaml
extensions:
  enabled: true                  # default: true
  eventHookTimeoutMs: 5000       # default: 5000; positive integer milliseconds
  # agentContextHookTimeoutMs: 5000  # default: inherits eventHookTimeoutMs; positive integer milliseconds
  # profileRouterTimeoutMs: 5000 # default: inherits eventHookTimeoutMs; positive integer milliseconds
  # policyGateTimeoutMs: 5000 # default: inherits eventHookTimeoutMs; positive integer milliseconds
  # validationProviderTimeoutMs: 5000 # default: inherits eventHookTimeoutMs; positive integer milliseconds
  # policyGateFailurePolicy: fail-closed # fail-closed (default) or fail-open
  # include: [build-notifier]    # optional allowlist by extension name
  # exclude: [experimental]      # optional denylist by extension name
  # paths:                       # optional explicit extension modules/directories
  #   - ./tools/eforge-audit.ts
  trustProjectExtensions: false  # deprecated compatibility field; local trust records control project/team loading
```

Fields:

| Field | Default | Meaning |
|-------|---------|---------|
| `extensions.enabled` | `true` | Enables native extension loading at runtime. When `false`, extension directories and `paths` are not loaded; management commands may still report discovered candidates with `enabled: false` for visibility. |
| `extensions.include` | unset | Optional allowlist for auto-discovered extension names. If set, only listed auto-discovered names are considered. |
| `extensions.eventHookTimeoutMs` | `5000` | Timeout in milliseconds for each native `onEvent` handler invocation and extension-authored action invocation. Must be a positive integer. |
| `extensions.agentContextHookTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each `onAgentRun` handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.profileRouterTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each profile-router handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.policyGateTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each policy-gate handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.validationProviderTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for validation-provider handlers and commands. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.policyGateFailurePolicy` | `fail-closed` | Failure policy for policy-gate throws, timeouts, or invalid decisions. `fail-closed` blocks the gated operation; `fail-open` records diagnostics and allows it to continue. |
| `extensions.exclude` | unset | Optional denylist for auto-discovered extension names. Applied after `include`. |
| `extensions.paths` | unset | Additional explicit extension file or directory paths. Relative paths resolve from the current project root. Explicit paths are validated even when outside standard extension directories. |
| `extensions.trustProjectExtensions` | `false` | Deprecated compatibility field. It does not trust project/team extensions or bypass changed-hash blocking; explicit local trust records in `.eforge/extension-trust.json` control loading. User and project-local extensions are trusted when loading is enabled. |

The compatibility trust flag is intentionally restricted: checked-in `eforge/config.yaml` cannot silently trust checked-in extensions, and `extensions.trustProjectExtensions` is stripped from committed project config/profile layers with a warning. Loading project/team extensions is controlled by explicit per-extension local trust records created with `eforge extension trust <name>`.

## Discovery scopes and precedence

Auto-discovery scans three directories:

| Scope | Directory | Trust default | Purpose |
|-------|-----------|---------------|---------|
| User | `~/.config/eforge/extensions/` | trusted | Personal extensions reusable across projects |
| Project/team | `eforge/extensions/` | untrusted unless a matching local trust record exists | Shared, committed team extensions |
| Project-local | `.eforge/extensions/` | trusted | Local experiments and personal project overrides |

Precedence for same-name auto-discovered extensions is:

```text
project-local > project-team > user
```

The highest-precedence candidate wins; lower-precedence candidates with the same name are reported as `shadowed`. Project-local is the recommended starting point for new extensions. Promote an extension to `eforge/extensions/` only once it is intended for the team and document that users must inspect and trust the project/team extension locally.

CLI scaffold scopes map to discovery directories as follows: local -> `.eforge/extensions/`, project -> `eforge/extensions/`, and user -> `~/.config/eforge/extensions/` by default (`$XDG_CONFIG_HOME/eforge/extensions/` when configured).

## Package-managed extensions

Extensions can be distributed as npm packages, local package directories, or tarballs and installed with `eforge extension install`. A package declares itself as an eforge extension using the `eforge.extension` field in `package.json`:

```json
{
  "name": "acme-build-notifier",
  "version": "1.0.0",
  "eforge": {
    "extension": {
      "name": "build-notifier",
      "entrypoint": "./dist/index.js"
    }
  }
}
```

Fields:

| Field | Required | Meaning |
|-------|----------|---------|
| `eforge.extension.name` | Yes | Extension name used for discovery, trust records, and management commands. |
| `eforge.extension.entrypoint` | Yes | Relative path from the package root to the extension module entry point. |

### Install, update, and remove

```bash
# Install from an npm package name (defaults to --scope local)
eforge extension install acme-build-notifier

# Install from a local package directory or tarball
eforge extension install ./packages/acme-build-notifier
eforge extension install ./dist/acme-build-notifier-1.0.0.tgz

# Install to a specific scope
eforge extension install acme-build-notifier --scope project

# Install and immediately trust (project/team scope only)
eforge extension install acme-build-notifier --scope project --trust
eforge extension install acme-build-notifier --scope project --trust --trusted-by "Alice <alice@example.com>"

# Update an installed extension to the latest version
eforge extension update build-notifier

# Remove an installed extension
eforge extension remove build-notifier
eforge extension remove build-notifier --force
```

Install scope follows the CLI scaffold labels: `local` targets `.eforge/extensions/`, `project` targets `eforge/extensions/`, and `user` targets `~/.config/eforge/extensions/`. The default scope is `local`. Package acquisition uses the local `npm` CLI for npm specs/tarball URLs and the system `tar` command for tarball extraction, so ensure those commands are on `PATH` when using those source types.

Non-JSON output prints concrete next steps after install. When the returned entry has `trustState: "untrusted"` or `"changed"`, the CLI prints a trust command (`eforge extension trust <name>`), a validate command, and a reload command. JSON output (`--json`) prints the daemon response directly.

### Promote and demote

Installed and source-authored extensions can be promoted from project-local scope to project-team scope or demoted back:

```bash
eforge extension promote build-notifier
eforge extension promote build-notifier --force

eforge extension demote build-notifier
```

`promote` moves the extension from `.eforge/extensions/` to `eforge/extensions/`. `demote` moves it back. After promotion, project/team scope trust requirements apply: users must run `eforge extension trust <name>` before the extension loads. After demotion, the extension returns to project-local scope and loads without an explicit trust record.

### Trust and supply-chain safety

Package-managed extensions are **unsandboxed arbitrary code**. Installing from npm, a tarball, or a local package directory introduces supply-chain risk: a package may contain malicious code, its published source may not match the distributed artifact, and transitive dependencies are executed without a sandbox. Always inspect installed extension code before trusting it, especially before promoting to project/team scope where other team members will be asked to trust the same artifact.

The content hash covers extension source files only. Install sidecar files - package metadata, lockfile records, and other install-generated artifacts written alongside the extension module - are excluded from the trust hash. This means that reinstalling without changing the source files does not invalidate an existing trust record.

Git URL installs are not yet supported. Accepted install sources are npm package specifiers (including tarball URLs), local package directories, and local `.tgz`/`.tar.gz` tarball paths.

## Supported layouts

Auto-discovered and explicit extension paths support file and directory layouts.

### File layout

```text
eforge/extensions/build-notifier.ts
eforge/extensions/build-notifier.mts
eforge/extensions/build-notifier.js
eforge/extensions/build-notifier.mjs
```

The extension name is the filename without the known extension.

### Directory layout

```text
eforge/extensions/build-notifier/index.ts
eforge/extensions/build-notifier/index.mts
eforge/extensions/build-notifier/index.js
eforge/extensions/build-notifier/index.mjs
```

A directory may also provide `package.json` with a supported root `exports`, `exports["."].import`, `exports["."].default`, or `main` entrypoint pointing at `.ts`, `.mts`, `.js`, or `.mjs`. The extension name is the directory name.

Unsupported files or directories are skipped during auto-discovery with a warning diagnostic. Unsupported explicit paths are errors.

## Loader strategy

The loader chooses a strategy from the resolved entrypoint format:

| Format | Strategy |
|--------|----------|
| `.js`, `.mjs` | native dynamic `import()` |
| `.ts`, `.mts` | `jiti` runtime loader |

The module must default-export an extension factory function. The factory is called once at load time with an `EforgeExtensionAPI` recorder. Registration methods must be called during factory execution; registrations made later are not guaranteed to be captured.

```ts
import type { EforgeExtensionAPI } from "@eforge-build/extension-sdk";

export default function extension(eforge: EforgeExtensionAPI) {
  eforge.onEvent("plan:build:*", async (event, ctx) => {
    ctx.logger.info(`Build event: ${event.type}`);
  });
}
```

You can also use `defineEforgeExtension` for parameter inference.

## Statuses, diagnostics, and provenance

The daemon and CLI expose candidates, loaded extensions, diagnostics, shadows, and registration summaries through `eforge extension` commands and daemon API routes.

Statuses:

| Status | Meaning |
|--------|---------|
| `pending` | Candidate discovered and awaiting load. Usually transient in internal results. |
| `loaded` | Factory loaded successfully and registration capture completed. |
| `shadowed` | Auto-discovered candidate lost to a higher-precedence extension with the same name. |
| `skipped` | Candidate was intentionally skipped - most commonly because it is an untrusted project/team extension (`extension:untrusted`) or because its content changed since the last trust operation (`extension:trust-changed`). |
| `excluded` | Candidate was filtered out by extension include/exclude configuration. |
| `error` | Discovery, validation, import, export, or factory execution failed. |

Diagnostics include severity (`warning` or `error`), stable code, message, and when available name/path/scope/source. Common diagnostics include unsupported layouts, duplicate explicit names, untrusted project extensions (`extension:untrusted`), changed content since last trust (`extension:trust-changed`), invalid default exports, and factory errors. Trust-related diagnostics also include `currentHash` and, for changed extensions, `trustedHash`.

Provenance fields identify where an extension came from:

- `scope`: `user`, `project-team`, `project-local`, or `external`
- `source`: `auto` or `explicit`
- `path` and `entrypoint`
- `format`, `layout`, and `strategy`
- `trust`: `trusted` or `untrusted`
- `trustState`: `trusted`, `untrusted`, `changed`, or `not-required` (project-team candidates only; `not-required` for all other scopes)
- `currentHash`: SHA-256 content hash at discovery time (project-team candidates)
- `trustedHash`: SHA-256 hash recorded at trust time (project-team candidates with a trust record)
- `trustedAt`: ISO-8601 timestamp of the most recent trust operation (project-team candidates with a trust record)
- `trustedBy`: optional annotation set at trust time
- `shadows`: lower-precedence candidates hidden by this candidate
- `registrations`: counts captured by registration family
- `package`: package provenance from `package.json`, including `packageName`, `version`, `description`, `eforgeExtensionName`, `eforgeEntrypoint`, `repository`, and `homepage` when present
- `install`: install provenance from `.eforge-install.json`, including `sourceKind`, `sourceSpec`, `resolvedVersion`, `integrity`, `installedAt`, and `targetScope` for eforge-managed installs

Use:

```bash
eforge extension list
eforge extension contributions list
eforge extension contributions invoke <id> --kind command
eforge extension show build-notifier
eforge extension validate
eforge extension validate ./tools/eforge-audit.ts
eforge extension test [nameOrPath]
eforge extension test build-notifier --fixture events.json
eforge extension test ./tools/eforge-audit.ts --run latest --event plan:build:failed
eforge extension new <name>
eforge extension reload
eforge extension trust <nameOrPath>
eforge extension untrust <nameOrPath>
eforge extension install <source>
eforge extension install <source> --scope project --trust
eforge extension update <name>
eforge extension remove <name>
eforge extension promote <name>
eforge extension demote <name>
```

`eforge extension test [nameOrPath]` validates the selected extension set and dry-runs matching `onEvent` hooks against replayed events. Omit `nameOrPath` to test configured extensions, pass a configured extension name to test one loaded extension, or pass an extension file/directory path for an ad-hoc test. Path detection matches `extension validate`: `./tools/eforge-audit.ts` is a path, while `build-notifier` is a configured extension name.

Replay sources:

- no source: static validation and registration summary only
- `--fixture <path>`: read project-local fixture events through the daemon
- `--run latest`: replay events from the latest monitor DB session
- `--run <sessionId-or-runId>`: replay events from a specific monitor session or run
- `--event <type>`: filter replay input to an exact event type before matching hooks
- `--json`: print the raw `ExtensionTestResponse`

Fixture files may contain one JSON event object, a JSON array of event objects, or JSONL with one event object per non-empty line. Every event is validated against the canonical eforge event schema before replay.

Non-JSON output is summary-first. It reports whether the test passed, the source (`none`, `fixture`, or `run`), replay counts (`inputEventCount`, `filteredEventCount`, `emittedEventCount`, and `diagnosticEventCount`), match count, emitted event-handler diagnostics, and deferred registration family counts. Zero matching hooks are valid when the response is otherwise valid; the CLI prints a clear zero-match message and exits 0. The process exits 1 only when the daemon response has `valid: false`.

`eforge extension new <name>` scaffolds a TypeScript extension. Defaults are `--scope local` (project-local `.eforge/extensions/`), `--template event-logger`, and no overwrite. Pass `--scope project` for committed team extensions, `--scope user` for personal cross-project extensions, `--template blank` for a minimal module, or `--force` to overwrite an existing scaffold target. Non-JSON output prints the created path, canonical daemon scope (`project-local`, `project-team`, or `user`), template, overwrite state, and next validation/reload steps.

`eforge extension reload` refreshes daemon extension discovery and restarts the runtime watcher when it is currently running. JSON output is the raw daemon response, including refreshed extension entries, diagnostics, registration totals, and watcher restart metadata. Non-JSON output summarizes watcher state and diagnostic counts.

List/show output includes `enabled`, a derived boolean for whether the entry is selected by the current extension config and is not shadowed or excluded. It is `false` when extensions are globally disabled, when include/exclude filters leave the entry out, or when a higher-precedence extension shadows it. A selected entry can still have `enabled: true` with status `skipped` or `error`; use status, trust, and diagnostics to see why it did not load.

Add `--json` to CLI commands for machine-readable provenance. The same data is exposed via `/api/extensions/list`, `/api/extensions/show`, `/api/extensions/validate`, `/api/extensions/new`, `/api/extensions/reload`, `/api/extensions/test`, `/api/extensions/trust`, `/api/extensions/untrust`, `/api/extensions/install`, `/api/extensions/update`, `/api/extensions/remove`, `/api/extensions/promote`, and `/api/extensions/demote`.

`eforge extension trust` and `eforge extension untrust` discover and hash project/team candidates, then update `.eforge/extension-trust.json`; they do not import the extension module or execute its factory. The trust decision takes effect when a later validate, test, reload, or build operation loads the extension.

`extension enable` and `extension disable` workflows are deferred.

## Runtime support today

The runtime foundation is shipped: discovery, trust gating, loader strategy selection, factory execution, registration capture, diagnostics, status reporting, CLI/API/MCP/Pi inspection and management tooling, native `onEvent` dispatch, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, and pre-build `registerProfileRouter` dispatch are available.

Event hooks run for real CLI, queue worker, and daemon watcher event streams. Dispatch is non-blocking with respect to the engine pipeline: handlers receive matching events but cannot alter or stop the triggering work. Handler failures and timeouts emit `extension:event-handler:*` diagnostics with the extension name, matched pattern, triggering event type, and available `sessionId`/`runId` correlation fields. Those diagnostics are recorded by the monitor before shell hooks run, so shell-hook matching has parity with normal engine and extension diagnostic events.

Event replay testing is also available through `eforge extension test`. Replay execution is a dry run for `onEvent` hooks only: it invokes matching event handlers against fixture or monitor DB events and records emitted handler diagnostics, but it does not execute custom tools, policy gates, profile routers, input sources, reviewer perspectives, validation providers, or agent-run hooks. Those non-event registrations are summarized separately in the test result; this replay limitation does not reflect whether the capability runs during normal engine execution.

### Actions, Console contributions, commands, and deep links

Extension authors can use `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` to publish typed, manifest-backed control surfaces. Local IDs in extension source are projected as effective namespaced IDs (`<extensionName>:<localId>`) in the daemon manifest. Console contributions render only with closed renderer IDs (`text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`) inside `/console/system`; extensions do not ship arbitrary Console JavaScript, React bundles, or independently loaded frontend plugins. Integration commands and action-backed deep links are discoverable through CLI `eforge extension contributions list|invoke`, MCP/Claude `eforge_extension_contribution` (`mcp__eforge__eforge_extension_contribution` in Claude tool-call form), Pi `eforge_extension_contribution`, and Pi `/eforge:extensions`. URL-only deep links can be listed for host navigation, but generic contribution invocation requires an action binding.

Action input schemas must be TypeBox object-root schemas (`Type.Object(...)`). Handler outputs must be JSON-safe; when an optional output schema is present, eforge validates the returned output before reporting success. Action handlers run as trusted, unsandboxed Node code in the daemon/worker process and reuse `extensions.eventHookTimeoutMs` for timeout enforcement. The daemon owns manifest projection and action invocation; TypeScript consumers should use `fetchExtensionContributionManifest`, `invokeExtensionAction`, and client-owned `API_ROUTES` helpers from `@eforge-build/client` rather than constructing raw `/api/...` paths. Extension-owned raw HTTP route registration is unsupported.

Action lifecycle diagnostics/events include provenance, duration, status, and error metadata, but omit raw input payloads and raw output payloads. This keeps daemon logs and event streams useful for observability without leaking action arguments or results.

Agent-run hooks fire before each agent invocation. Handlers can inspect `ctx.role`, `ctx.tier`, `ctx.phase`, and `ctx.stage` to scope their contribution, then return `{ promptAppend, tools, allowedTools, disallowedTools }` to inject additional prompt context, expose extension tools for that run, and tune harness availability lists. Prompt fragments are appended after any config-level `promptAppend` already resolved by the engine, wrapped in a named provenance section identifying the contributing extension. Multiple extensions contribute in registration order. The runtime is fail-open: a handler that throws or exceeds `extensions.agentContextHookTimeoutMs` emits a typed diagnostic event but does not abort the agent run.

Policy gates run at three blocking points: `beforeQueueDispatch` runs before a queued PRD is dispatched, `beforePlanMerge` runs before a plan worktree is merged, and `beforeFinalMerge` runs before the completed feature branch is merged into the base branch. Gate contexts are read-only snapshots and include `ctx.logger` and `ctx.exec`; `beforeQueueDispatch` contexts also include optional `compiledResume` metadata for complete compiled-resume queue items. They are not a sandbox. Extensions remain trusted, unsandboxed code running in the daemon/worker process.

Policy decisions are strictly validated. `{ decision: 'allow' }` lets the operation continue. `{ decision: 'block', reason }` blocks it and surfaces the reason. `{ decision: 'require-approval', reason }` blocks the gated operation; eforge does not provide approval workflow, approval state, or Console approval UI in the current release. Thrown errors, timeouts, and invalid decisions emit `extension:policy:*` diagnostics and follow `extensions.policyGateFailurePolicy`: `fail-closed` blocks, while `fail-open` allows continuation after recording diagnostics.

Other extension capability families and unsupported variants remain intentionally deferred for later phases. Loading an extension records runtime-wired registration families so provenance and validation output remain complete. For tools, `registerTool(tool)` records loader-time provenance and validation metadata; returning `tools: [tool]` from `onAgentRun` is the per-run injection path. Extension-authored actions, Console contributions, integration commands, and deep links are captured in the engine registry with safe management details and manifest projection; the daemon exposes contribution manifest and action invocation routes, Console renders declarative Console contributions under `/console/system`, and CLI, MCP/Claude, and Pi host integrations can discover actions, integration commands, and action-backed deep links through the shared contribution dispatcher. Action invocations reuse `extensions.eventHookTimeoutMs` and emit daemon-scoped `extension:action:*` lifecycle events without raw input payloads or raw output payloads. The shipped session-planning adapter is internal/built-in rather than a user-authored native extension registration point. `beforeEnqueue`, `beforeValidation`, `modify` decisions, session-plan extraction into extensions, playbook extraction into extensions, raw extension-owned HTTP routes, arbitrary Console JavaScript, arbitrary React bundles, and independently loaded frontend plugins remain deferred or unsupported runtime phases. Approval workflows, approval state, and Console approval UI are not provided in the current release.

| Capability | Type contract | Loader-time registration capture | Runtime execution today |
|-----------|---------------|----------------------------------|-------------------------|
| `onEvent` - typed event subscriptions | Yes | Yes | Yes |
| `onAgentRun` - agent prompt/tool augmentation and availability tuning | Yes | Yes | Yes |
| `registerTool` - custom agent tool provenance | Yes | Yes | Provenance only; inject per run via `onAgentRun` |
| `beforeQueueDispatch` - policy gate before queued PRD dispatch | Yes | Yes | Yes (blocking policy gate) |
| `beforePlanMerge` - policy gate before plan worktree merge | Yes | Yes | Yes (blocking policy gate) |
| `beforeFinalMerge` - policy gate before final feature merge | Yes | Yes | Yes (blocking policy gate) |
| `registerProfileRouter` | Yes | Yes | Yes (pre-build dispatch) |
| `registerInputSource` | Yes | Yes | Yes (extension-aware enqueue preprocessing) |
| `registerPrdEnricher` | Yes | Yes | Yes (fail-open content enrichment before queue write) |
| `registerReviewerPerspective` | Yes | Yes | Yes (parallel review-cycle dispatch) |
| `registerValidationProvider` | Yes | Yes | Yes (per-plan `validate` build stage) |
| `registerAction` | Yes | Yes | Engine action dispatcher via daemon action invocation route |
| `registerConsoleContribution` | Yes | Yes | Daemon contribution manifest projection; Console renders declarative panels under `/console/system` |
| `registerIntegrationCommand` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed commands |
| `registerDeepLink` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed deep links |

Event-hook, agent context/tool injection, profile-router, shipped policy-gate, input-source fetching, PRD enrichment, reviewer perspective, validation provider, and contribution-family examples can be loaded and validated at runtime. Event-oriented examples include [`examples/extensions/minimal-event-logger.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/minimal-event-logger.ts) and the safe [`examples/extensions/slack-webhook-notifier.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/slack-webhook-notifier.ts), which only sends a Slack-compatible webhook when `EFORGE_SLACK_WEBHOOK_URL` is set. [`examples/extensions/agent-tools.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/agent-tools.ts) demonstrates defining a TypeBox tool, registering it for provenance, and returning it only for builder runs with `ctx.effectiveToolName(...)` in prompt text. Profile routers run before each PRD build is dispatched from the queue: routers are invoked in registration order with `extensions.profileRouterTimeoutMs` timeout/fail-open semantics, and the first valid profile selection persists to the PRD's frontmatter before `session:start` is emitted. When a router selects a profile, a `queue:profile:selected` event is emitted with the PRD id, selected profile, router name, and optional reason/confidence fields. An explicit `profile:` field in the PRD's frontmatter takes absolute precedence — no routers are consulted. See [`examples/extensions/profile-router.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/profile-router.ts) for a Claude → Codex → local fallback example. [`examples/extensions/protected-paths.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/protected-paths.ts) demonstrates runtime-supported plan/final merge policy enforcement for protected paths. [`examples/extensions/issue-tracker.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/issue-tracker.ts) demonstrates runtime-supported input source adapters for GitHub, Linear, and Jira. [`examples/extensions/reviewer-perspective.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/reviewer-perspective.ts) demonstrates a runtime-supported accessibility reviewer perspective with declarative `appliesTo.fileGlobs` applicability for UI/TSX files. [`examples/extensions/validation-provider.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/validation-provider.ts) demonstrates runtime-supported validation providers in both function form (programmatic) and command form (subprocess). [`examples/extensions/action-contribution.ts`](https://github.com/eforge-build/eforge/blob/main/examples/extensions/action-contribution.ts) demonstrates an action-backed Console contribution, integration command, and deep link without raw HTTP routes or browser code. Raw extension-owned HTTP routes remain unsupported. `beforeEnqueue`, `beforeValidation`, `modify` decisions, session-plan extraction, playbook extraction, and arbitrary frontend plugin bundles are future or unsupported runtime phases. Approval workflow/state/UI is not provided in the current release.

### Input sources and PRD enrichers

Input sources and PRD enrichers run during the enqueue preprocessing stage, before the build source artifact is written to the queue. For usage examples from each host surface (Claude Code, Pi, CLI), see [Integrations - Input source adapters](/docs/integrations#input-source-adapters-github-linear-jira).

**`registerInputSource` — URI-based artifact fetching**

Input source adapters are selected by `name` against the `<adapter>` segment of an `eforge://input/<adapter>/<id>` URI. The runtime calls `adapter.fetch(id, ctx)` with the remaining `<id>` path and an `InputTransformContext`.

URI examples:
- `eforge://input/github/acme/backend#42` — adapter `github`, id `acme/backend#42`
- `eforge://input/linear/ENG-42` — adapter `linear`, id `ENG-42`
- `eforge://input/jira/ENG-42` — adapter `jira`, id `ENG-42`

Adapters may return a raw content string, an `InputSourceResult` object `{ content, title? }`, or `null` to signal that the identifier was not found. Returning `null` is fatal to enqueue (`FatalPreprocessingError`). Throwing is also fatal. Design adapters to be safe-by-default: when required credentials are absent, return an `InputSourceResult` with instructional content rather than throwing.

Provenance events emitted per adapter call:
- `extension:input-source:fetched` — adapter returned content successfully.
- `extension:input-source:failed` — adapter threw or returned `null`.

**`registerPrdEnricher` — content augmentation before queue write**

PRD enrichers run in registration order after input source preprocessing completes. Each enricher receives `{ content, sourceId, ctx }` and may return `{ content }` to replace the content, or `null`/`undefined` to pass it through unchanged. Enrichers always run for every preprocessed source; gate behavior inside `enrich` using `ctx.sourceKind`, `ctx.adapterId`, or `ctx.sourcePath` if needed.

Enricher failures are fail-open: a thrown error emits `extension:prd-enricher:failed` with the enricher name, source id, and error message, and the unchanged content carries forward.

Provenance events emitted per enricher call:
- `extension:prd-enricher:applied` — enricher returned modified content.
- `extension:prd-enricher:failed` — enricher threw (content unchanged; build continues).

### Validation providers

Validation providers execute during the per-plan `validate` build stage, after the implement stage completes and before the review stage, when `validate` is included in the build pipeline. Each registered provider is invoked in registration order for every plan that reaches the validate stage. Providers are fail-closed gates: normal validation failures can be repaired first, but unresolved failures still fail the current plan and emit `plan:build:failed`.

Normal validation-provider failures are recoverable before fail-closed terminal failure: structured `{ status: 'failed' }` function-form results and command-form non-zero exits enter the plan's recovery loop. Recovery is bounded by the plan's `review.maxRounds` budget. After each recovery attempt, eforge reruns the provider suite from the first provider so earlier gates can re-check changes made during recovery.

Hard provider failures bypass recovery and emit terminal `plan:build:failed` immediately: thrown exceptions or rejected promises, provider timeouts, non-empty string returns from function-form providers, and unexpected return shapes. Use these hard-failure paths for extension bugs or unavailable infrastructure, not ordinary quality-gate findings.

A function-form provider returns `null` or `undefined` to pass, or a structured `ValidationProviderResult` object with `status` (`'passed'`, `'failed'`, or `'skipped'`), an optional `message`, optional extended `details`, and optional per-file `annotations`. Non-empty string failure returns are not part of the function-form contract; they are treated as unexpected return shapes.

Structured annotations are the best path to precise recovery issues. Include `file` and `line` whenever possible so the repair agent can target the relevant location instead of inferring it from free-form output. Each annotation may include `details`, `fix`, `retryGuidance`, provider-authored `failureKind`, `repairClass` (`narrow`, `structural`, `manual`, or `followup`), and small JSON-safe `metadata`.

Use `repairClass: 'narrow'` or omit it for localized fixes. Use `repairClass: 'structural'` when the correct fix requires extraction, file splitting, or broader code organization changes. Use `manual` when the provider should fail closed without automated repair. Use `followup` for findings that should only fail closed when every remaining issue is follow-up-only; mixed follow-up plus automatable issues route according to the narrow/structural guidance.

Function-form annotations are normalized into review issues. Narrow or unspecified issues go through the review-fixer path first. Structural issues route to the validation-fixer path. If the same validation failure signature survives a prior narrow repair attempt, eforge escalates the next attempt to structural repair. Any manual annotation disables automated repair, and an all-follow-up failure set fails closed without an automated attempt; mixed follow-up plus narrow or structural issues routes according to the remaining automatable issues.

Before each automated validation-provider repair attempt, eforge writes a checkpoint under `.eforge/validation-recovery/<plan-set>/<plan-id>/attempt-<n>-<provider>/` with `checkpoint.patch` and `metadata.json`. The repair prompt references these paths, and the evaluator receives the same validation repair context. Every narrow or structural validation repair is evaluator-mediated: a candidate patch must be judged as a strict improvement before the provider suite reruns.

Command-form providers are useful for subprocess exit-code gates. A non-zero exit code is a recoverable generic subprocess failure with stderr (or stdout if stderr is empty) as the message. Command form cannot attach annotations, `repairClass`, `retryGuidance`, `failureKind`, or `metadata`; use function form when you need structured guidance.

## Schema language

The SDK uses [TypeBox](https://github.com/sinclairzx81/typebox) as its schema language for custom tools:

```ts
import { defineExtensionTool, Type } from "@eforge-build/extension-sdk";

const myTool = defineExtensionTool({
  name: "my-tool",
  description: "Does something useful",
  inputSchema: Type.Object({ path: Type.String() }),
  handler: async ({ path }) => `processed: ${path}`,
});
```

Supported authoring pattern:

1. Define the tool with `defineExtensionTool` and TypeBox.
2. Call `eforge.registerTool(tool)` during factory execution so loader/list output records provenance and validation metadata.
3. Return `{ tools: [tool] }` from `eforge.onAgentRun(...)` only for the roles/stages that should receive the tool.
4. Use `ctx.effectiveToolName(tool.name)` when prompt text names the tool, because harnesses may expose different visible names.
5. Use `allowedTools` and `disallowedTools` only for per-run harness availability tuning. They are not toolbelt configuration.

Tool sources stay distinct: engine-internal custom tools are owned by eforge, harness built-ins are owned by the selected harness, toolbelt-selected project MCP tools come from `.mcp.json`, and extension-contributed tools come from TypeScript extensions returned for a run.

Zod does not appear in the SDK public surface. If you use Zod internally, adapt it at the extension boundary.

## Event patterns

Event subscriptions accept glob-style patterns using `*` as a wildcard. The wildcard matches any characters including `:`:

| Pattern | Matches |
|---------|---------|
| `plan:build:failed` | Exact match only |
| `plan:build:*` | `plan:build:start`, `plan:build:complete`, `plan:build:failed`, etc. |
| `*:complete` | `planning:complete`, `plan:build:complete`, `expedition:wave:complete`, etc. |
| `*` | Every event |

Pattern semantics match shell hooks. See the [Events Reference](/reference/events) for public event types.

## Trust and security

- Extensions run in the eforge daemon/worker Node process without a sandbox.
- User (`~/.config/eforge/extensions/`) and project-local (`.eforge/extensions/`) extensions load when `extensions.enabled` is true.
- Project/team extensions (`eforge/extensions/`) are unsandboxed arbitrary code committed to the repository. They require an explicit per-extension local trust record in `.eforge/extension-trust.json` — created by `eforge extension trust <name>` — before loading. Any code change invalidates the stored hash and blocks the extension until re-trusted.
- The content hash covers the entrypoint for file-layout extensions and, for directory-layout extensions, `package.json` plus `.ts`, `.mts`, `.js`, and `.mjs` files under the extension directory (excluding `node_modules/`, `dist/`, and `.git/`). Files imported from outside the extension directory — and non-source/data files inside it — are not covered; keep implementation code inside the extension directory and in hashed source files to ensure relevant code changes are captured.
- Explicit paths outside standard scopes are treated as `external` and trusted when enabled, so use them only for code you control.
- Do not load extensions from unreviewed repositories or package artifacts.
- Treat `eforge extension test` as code execution, not static analysis. The replay path is a dry run with respect to eforge engine state, but matching `onEvent` handlers still execute in the daemon process and can perform filesystem, environment, and network operations.

## API reference

For full type signatures and method documentation, see [`docs/extensions-api.md`](./extensions-api.md).
