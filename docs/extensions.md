# Extensions

eforge has a broad extension surface around a small build-engine kernel. Input surfaces, first-party `eforge-playbooks` playbook workflows, session plans, profile toolbelts, shell hooks, host integrations, wrapper apps, and native TypeScript extensions can shape how work is authored, routed, governed, observed, and integrated without moving those concerns into the engine.

Native eforge extensions are one typed mechanism in that broader surface: TypeScript or JavaScript modules loaded by the eforge daemon/worker Node process. They are the typed, programmatic counterpart to shell hooks: extension factories can register event hooks, agent-run augmenters, policy gates, profile routers, runtime-choice routers, input sources, PRD enrichers, reviewer perspectives, validation providers, custom tools, typed actions, declarative Console contributions, sandboxed Console workstations, integration commands, and deep links with full TypeScript inference.

Extensions are **not sandboxed**. A loaded native extension executes in the same Node process as eforge and has the same filesystem, environment, and network access as the daemon. Only enable extensions from sources you trust.

## What native extensions are (and are not)

Native eforge extensions are distinct from other extensibility mechanisms in the broader eforge extension surface:

| Mechanism | Language/shape | Runtime owner | Purpose |
|-----------|----------------|---------------|---------|
| Native eforge extensions | TypeScript/JavaScript modules in `extensions/` | eforge daemon/worker | Typed lifecycle registrations, per-run prompt/tool augmentation, and runtime hooks |
| Claude Code plugins | Claude Code plugin package | Claude Code host | Slash commands, MCP proxy wiring, Claude Code UX |
| Pi extensions | Pi extension package | Pi host | Native Pi commands, tools, and TUI surfaces |
| Shell hooks | YAML + shell command | eforge hook runner | Fire-and-forget notifications/integrations |
| Playbooks/session plans | Markdown input artifacts | First-party extensions and domain-neutral input adapters, then engine queue | Reusable build sources and planning artifacts |
| Profile toolbelts | YAML MCP server bundles | agent runtime registry | Declarative project MCP server selection |

Toolbelts answer "which project MCP servers from `.mcp.json` should this tier expose?" Extensions answer "what should eforge do when something happens?" and may contribute TypeScript-defined tools per agent run. Toolbelts do not filter extension-contributed tools, engine-internal custom tools, or harness built-ins. Extensions should not redefine toolbelts or act as a hidden profile/config layer.

Playbooks and session plans are reusable input artifacts outside the engine kernel. The first-party `@eforge-build/eforge-playbooks` extension owns shipped playbook parsing, storage, validation, compilation, management actions, planning-mode handoff metadata, and autonomous queue handoff across project-local, project-team, and user scopes. Domain-neutral acceptance-criteria quality helpers and session-plan normalization are separate input-layer concerns; session plans remain project-local Markdown files under `.eforge/session-plans/` and are handled separately from the playbook extension boundary. Native extensions do not currently register custom playbook or session-plan extraction workflows. Custom playbook extraction remains deferred, custom session-plan extraction remains deferred, user-authored session-plan extraction remains unsupported, user-authored playbook extraction remains unsupported, and user-authored native workflow registration remains future/deferred work.

## LLM-first extension authoring checklist

When an LLM or assisted authoring flow creates an extension, keep the loop explicit and auditable:

1. **Scaffold locally** with `eforge extension new <name>` (usually project-local `.eforge/extensions/`) and keep the first version small.
2. **Author against supported V1 surfaces**: event hooks, agent-run context/tools, policy gates, profile routers, runtime-choice routers, input sources, PRD enrichers, reviewer perspectives, validation providers, actions, declarative System contributions, and source-authored sandboxed Console workstations with iframe `srcDoc` or `frameBundle` plus `window.eforge.invokeAction` / `@eforge-build/extension-sdk/browser`.
3. **Validate statically** with `eforge extension validate <name-or-path>` before reload.
4. **Test behavior** with `eforge extension test <name-or-path>` and, for event hooks, a fixture or `--run latest` replay.
5. **Trust only after inspection**: for project/team extensions, read the source and then run `eforge extension trust <name>` so the local `.eforge/extension-trust.json` records the reviewed hash.
6. **Reload deliberately** with `eforge extension reload` after validation, testing, and trust are complete.
7. **Re-check trust and boundaries** whenever code changes: changed project/team hashes must be re-trusted, workstation `srcDoc` HTML and bundle metadata/code are trusted iframe UI rather than sanitized declarative content, extension-owned raw routes, extension-authored arbitrary asset bundles outside the workstation frame/asset contract, React injection, and extension-owned AI planning/chat APIs outside the daemon-owned `ctx.agentTasks` boundary remain deferred.

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
| `extensions.validationProviderTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each validation provider handler invocation (function form) or command (commands form). Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.policyGateFailurePolicy` | `fail-closed` | Failure policy for policy-gate throws, timeouts, or invalid decisions. `fail-closed` blocks the gated operation; `fail-open` records diagnostics and allows it to continue. |
| `extensions.exclude` | unset | Optional denylist for auto-discovered extension names. Applied after `include`. |
| `extensions.paths` | unset | Additional explicit extension file or directory paths. Relative paths resolve from the current project root. Explicit paths are validated even when outside standard extension directories. |

Only the documented `extensions` keys are accepted in config files and profiles. Remove stale or obsolete project/team trust compatibility settings during upgrades; project/team extension loading now uses local trust records instead.

Loading project/team extensions is controlled by explicit per-extension local trust records in `.eforge/extension-trust.json`, created with `eforge extension trust <name>` after inspecting the extension code. User and project-local extensions are trusted when loading is enabled.

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
      "entrypoint": "./dist/index.js",
      "capabilities": [{ "name": "acme.notifications", "version": "1.0.0" }],
      "dependencies": {
        "optional": [{
          "name": "acme-backlog",
          "version": ">=1.0.0, <2.0.0",
          "capabilities": [{ "name": "acme.backlog", "version": ">=1.0.0" }]
        }]
      }
    }
  }
}
```

Fields:

| Field | Required | Meaning |
|-------|----------|---------|
| `eforge.extension.name` | Yes | Extension name used for discovery, trust records, and management commands. |
| `eforge.extension.entrypoint` | Yes | Relative path from the package root to the extension module entry point. |
| `eforge.extension.capabilities` | No | Public capabilities provided by the extension. Capability versions are exact semantic versions. |
| `eforge.extension.dependencies.required` | No | Provider/capability requirements that must resolve before this extension is imported. Missing, shadowed, untrusted, changed, errored, version-incompatible, or capability-incompatible providers skip the dependent and emit `extension:dependency-*` diagnostics. |
| `eforge.extension.dependencies.optional` | No | Provider/capability requirements that populate availability state but do not block importing the dependent. |

Version constraints accept exact semantic versions, comparators (`>`, `>=`, `<`, `<=`), and comma-separated AND constraints. Invalid dependency or capability metadata is reported as `extension:invalid-package-manifest`. Contribution manifests expose `availability` for actions, commands, deep links, Console contributions, and workstations; unavailable actions return `{ ok: false, error: { code: "unavailable" } }`. Action contexts expose immutable `ctx.dependencies` and `ctx.capabilities` lookup data. They report availability only — there is no cross-extension invocation API or invocation loop state.

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

# Update an npm-installed extension to a version, range, or dist-tag
eforge extension update build-notifier --version latest
eforge extension update build-notifier --version 1.2.3

# Remove an installed extension
eforge extension remove build-notifier
eforge extension remove build-notifier --force
```

Install scope follows the CLI scaffold labels: `local` targets `.eforge/extensions/`, `project` targets `eforge/extensions/`, and `user` targets `~/.config/eforge/extensions/`. The default scope is `local`. Package acquisition uses the local `npm` CLI for npm specs/tarball URLs and the system `tar` command for tarball extraction, so ensure those commands are on `PATH` when using those source types.

`eforge extension update <name> --version <specifier>` forwards the specifier to npm-installed extensions only. Use it for npm versions, ranges, or dist-tags. Local package directory and tarball installs update from their recorded sidecar source rather than resolving a registry version specifier.

Non-JSON output prints concrete next steps after install. When the returned entry has `trustState: "untrusted"` or `"changed"`, the CLI prints a trust command (`eforge extension trust <name>`), a validate command, and a reload command. JSON output (`--json`) prints the daemon response directly.

### Optional first-party packages

`@eforge-build/eforge-plan` is the optional first-party planning package. `@eforge-build/eforge-playbooks` is the first-party playbooks package; it declares playbook management/run capabilities and optionally uses the `eforge.plan.planning-workstation >=1.0.0` capability from eforge-plan when available. This generic extension guide intentionally covers only package installation and the platform boundary; product behavior such as backlog workflows, recommendation refresh, workstation planning UX, revision flows, explicit planning-store maintenance, playbook management, and playbook run handoff is documented in `/docs/eforge-plan`, `/docs/playbooks`, and the extension-owned READMEs.

```bash
# Local install (trusted by default)
eforge extension install @eforge-build/eforge-plan
eforge extension validate eforge-plan
eforge extension reload

# Project/team install with post-inspection trust
eforge extension install @eforge-build/eforge-plan --scope project
eforge extension validate eforge-plan
eforge extension trust eforge-plan
eforge extension reload

# Project/team install with immediate trust
eforge extension install @eforge-build/eforge-plan --scope project --trust
eforge extension reload

# Install the first-party playbooks package
eforge extension install @eforge-build/eforge-playbooks
eforge extension validate eforge-playbooks
eforge extension reload

# Update or remove
eforge extension update eforge-plan
eforge extension update eforge-plan --version latest
eforge extension remove eforge-plan
eforge extension update eforge-playbooks
eforge extension remove eforge-playbooks
```

These packages remain unsandboxed arbitrary code like any native extension. `eforge-plan` ships runtime entrypoints in `dist/` and its planning workstation browser bundle in `workstation-assets/plans/`; `eforge-playbooks` ships its runtime entrypoint in `dist/` and declarative Console contribution metadata without a workstation bundle. Local installs under `.eforge/extensions/` are trusted by default, while project/team installs under `eforge/extensions/` require each user to inspect and trust the package before loading.

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

The content hash covers extension source files and directory-layout browser assets placed under `workstation-assets/`. Install sidecar files - package metadata, lockfile records, and other install-generated artifacts written alongside the extension module - are excluded from the trust hash. This means that reinstalling without changing the source files or trusted workstation assets does not invalidate an existing trust record.

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
eforge extension contributions list --kind command --search planning --limit 20
eforge extension contributions show <id> --kind command --include-schema
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
eforge extension update <name> --version <specifier>
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

`eforge extension reload` refreshes daemon extension discovery and restarts the runtime watcher when it is currently running. JSON output is the raw daemon response, including refreshed extension entries, diagnostics, registration totals, and watcher restart metadata. Non-JSON output summarizes watcher state and diagnostic counts. MCP and Pi `eforge_extension` management calls return compact projections by default for list, show, validate, reload, test, install/update/remove, trust/untrust, promote/demote, and new-extension actions: identity, status, trust, path, scope, source, registration counts, diagnostic counts, sample summaries, and next steps are kept, while raw daemon discovery objects are omitted unless you use CLI `--json` or daemon/client HTTP APIs for explicit debug inspection. List/show projections preserve every action detail identity, label/name, and output profile, but omit large schemas and raw diagnostic detail from compact defaults.

List/show output includes `enabled`, a derived boolean for whether the entry is selected by the current extension config and is not shadowed or excluded. It is `false` when extensions are globally disabled, when include/exclude filters leave the entry out, or when a higher-precedence extension shadows it. A selected entry can still have `enabled: true` with status `skipped` or `error`; use status, trust, and diagnostics to see why it did not load.

Add `--json` to CLI commands for machine-readable provenance. The same data is exposed via `/api/extensions/list`, `/api/extensions/show`, `/api/extensions/validate`, `/api/extensions/new`, `/api/extensions/reload`, `/api/extensions/test`, `/api/extensions/trust`, `/api/extensions/untrust`, `/api/extensions/install`, `/api/extensions/update`, `/api/extensions/remove`, `/api/extensions/promote`, and `/api/extensions/demote`.

`eforge extension trust` and `eforge extension untrust` discover and hash project/team candidates, then update `.eforge/extension-trust.json`; they do not import the extension module or execute its factory. The trust decision takes effect when a later validate, test, reload, or build operation loads the extension.

`extension enable` and `extension disable` workflows are deferred.

## Runtime support today

The runtime foundation is shipped: discovery, trust gating, loader strategy selection, factory execution, registration capture, diagnostics, status reporting, CLI/API/MCP/Pi inspection and management tooling, native `onEvent` dispatch, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, pre-build `registerProfileRouter` dispatch, and per-invocation `registerRuntimeChoiceRouter` dispatch after declarative runtime-choice rules are available.

Event hooks run for real CLI, queue worker, and daemon watcher event streams. Dispatch is non-blocking with respect to the engine pipeline: handlers receive matching events but cannot alter or stop the triggering work. Handler failures and timeouts emit `extension:event-handler:*` diagnostics with the extension name, matched pattern, triggering event type, and available `sessionId`/`runId` correlation fields. Those diagnostics are recorded by the monitor before shell hooks run, so shell-hook matching has parity with normal engine and extension diagnostic events.

Event replay testing is also available through `eforge extension test`. Replay execution is a dry run for `onEvent` hooks only: it invokes matching event handlers against fixture or monitor DB events and records emitted handler diagnostics, but it does not execute custom tools, policy gates, profile routers, runtime-choice routers, input sources, reviewer perspectives, validation providers, or agent-run hooks. Non-event registrations are summarized separately in the test result with their current runtime status; this replay limitation does not reflect whether the capability runs during normal engine execution.

### Actions, agent task contributions, Console contributions, commands, and deep links

Extension authors can use `registerAction`, `registerAgentTask`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink`, and `registerConsoleWorkstation` to publish typed, manifest-backed control surfaces. Local IDs in extension source are projected as effective namespaced IDs (`<extensionName>:<localId>`) in the daemon manifest. These contribution registrations may declare dependency/capability `requirements`; manifest entries include `availability`, and unavailable actions are rejected with error code `unavailable`. Agent task contribution entries declare trusted prompt sources as safe manifest metadata; task-start callers reference the contribution and do not supply prompt paths, raw prompt text, or resolver functions. Console contributions render only with closed renderer IDs (`text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`) inside `/console/system`; outside registered workstation `srcDoc` or `frameBundle` sources, arbitrary Console JavaScript is unsupported, direct parent-Console React/components are unsupported, and independently loaded frontend plugins are unsupported. Actions, integration commands, and action-backed deep links are discoverable through CLI `eforge extension contributions list|show|invoke`, MCP/Claude `eforge_extension_contribution` (`mcp__eforge__eforge_extension_contribution` in Claude tool-call form), Pi `eforge_extension_contribution`, and Pi `/eforge:extensions`. URL-only deep links can be listed for host navigation, but generic contribution invocation requires an action binding.

Contribution discovery surfaces return compact, formatted list text by default rather than raw full manifests. MCP and Pi coding-agent host text is capped to a 12,000-character budget; contribution list rendering stops on whole-entry boundaries and reports `returned`, `total`, and `nextOffset` continuation guidance when more entries remain. Narrow broad lists with `--kind`, `--extension-name`, `--search`, `--id-prefix`, `--output-profile`, `--limit`, and `--offset` (or the matching MCP/Pi tool fields), page through list results, then use `show <id>` / `action: "show"` for focused detail. Opt into heavier payloads with CLI `--include-schema`, `--include-diagnostics`, or `--full` (MCP/Pi fields: `includeInputSchema`, `includeDiagnostics`, or `full`) when a human or script needs schemas or diagnostics. Pi interactive browsing lists compact entries first, then fetches focused detail with input schema for the selected contribution before deciding whether it needs to prompt for required fields. Failed MCP/Pi invocations return a summarized envelope with action identity, target identity, error code/message, and input key/size summary; raw `target.input` is omitted. Use CLI `--json` or typed daemon/client HTTP helpers when you intentionally need full raw manifests or debug-rich action payloads.

Action input schemas must be TypeBox object-root schemas (`Type.Object(...)`). Handler outputs must be JSON-safe; when an optional output schema is present, eforge validates the returned output before reporting success. Action handlers run as trusted, unsandboxed Node code in the daemon/worker process and reuse `extensions.eventHookTimeoutMs` for timeout enforcement. Throw `ExtensionActionInputValidationError` for schema-like field issues or `ExtensionActionUserError` for user-fixable domain/precondition failures; both surface as `invalid-input` with sanitized message/details. Unexpected exceptions remain generic `handler-error` responses. The daemon owns manifest projection and action invocation; TypeScript consumers should use `fetchExtensionContributionManifest`, `invokeExtensionAction`, and client-owned `API_ROUTES` helpers from `@eforge-build/client` rather than constructing raw `/api/...` paths. Extension-owned raw HTTP route registration is unsupported.

Action lifecycle diagnostics/events include provenance, duration, status, and error metadata, but omit raw input payloads and raw output payloads. This keeps daemon logs and event streams useful for observability without leaking action arguments or results.

### Designing bounded contribution actions

Contribution actions should be bounded by default because the same action may be invoked from a rich Console UI, a CLI, an MCP/Pi tool call, or a coding-agent context window. Prefer separate contracts for list, detail, and search operations: use compact `search-*` or `list-*` actions for summaries, targeted `get-*` actions for one record, and explicit opt-in flags for raw Markdown bodies, long evidence, trace rows, lifecycle links, recommendations, or other UI-only fields. Keep workstation-rich payloads separate from agent-safe payloads rather than making every host pay for the full UI projection.

Actions may also declare an optional `outputProfile` so hosts can choose safe formatting without re-inferring payload shape. Supported profiles are `agent-compact`, `agent-paginated`, `markdown`, `ui-rich`, and `debug-rich`. Use agent profiles for coding-agent-safe summary/detail payloads, `markdown` for actions that return exactly `{ markdown: string }`, `ui-rich` for workstation-oriented rich payloads, and `debug-rich` for compatibility/debug surfaces that intentionally remain large. The engine treats output profiles as manifest metadata only; they do not change action invocation success/failure response shapes.

Host integrations format invocation output defensively. CLI non-`--json`, MCP/Claude, Pi tools and panels, and Console previews render exact `{ markdown: string }` outputs as Markdown/plain text instead of escaped JSON. MCP and Pi apply the shared 12,000-character host-output budget to final coding-agent tool text: MCP returns capped text, while Pi tool details replace raw detail payloads with bounded metadata such as budget, raw length, summary/truncation flags, output kind, warnings, and guidance. Oversized JSON output is summarized semantically before any final character cap: top-level keys remain visible, arrays retain `count`, representative entries keep identity fields such as `id`, `itemId`, `epicId`, `title`, `name`, `status`, `state`, `kind`, and `lane`, and summaries preserve pagination/continuation fields such as `limit`, `offset`, `nextOffset`, `cursor`, and `nextCursor` with omitted counts. Hosts warn when output is summarized or truncated, and they warn for `ui-rich`/`debug-rich` profiles even when the current payload fits. Use CLI `--json` or daemon/client raw invocation helpers only when a human explicitly needs the full raw payload; coding-agent workflows should prefer compact, paginated, or Markdown actions.

The extension SDK exports small helpers for paginated actions: `createContributionPaginationInputFields()`, `createContributionPageOutputSchema(itemSchema)`, `resolveContributionPagination()`, `paginateContributionItems()`, `CONTRIBUTION_OUTPUT_PROFILES`, and `contributionOutputProfile()`. They standardize `limit`/`offset`, cap excessive limits, return the common `{ items, total, limit, offset }` shape, and keep profile strings typed and JSON-safe while leaving domain filters and projection fields to the extension.

Broad list/search/board-style read action registrations remain valid, but validation emits warning diagnostics for id-shaped broad reads with array-shaped outputs when their input schemas lack limit or cursor/page controls, or when array-shaped output schemas omit an explicit output profile. `agent-paginated` actions with limit and cursor/page controls are considered bounded for agent use without separate projection controls. These warnings are advisory for extension ergonomics; invalid registration shapes still use error diagnostics and are not recorded.

```ts
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
  handler: (input) => paginateContributionItems(findMatches(input.query), input, { defaultLimit: 20, maxLimit: 50 }),
});
```

### Daemon-owned agent tasks from actions

Action handlers can inspect immutable dependency and capability availability through `ctx.dependencies` and `ctx.capabilities`, start/read/cancel daemon-owned single-shot agent tasks through `ctx.agentTasks`, submit trusted build-queue handoffs through `ctx.buildQueue.enqueue({ source, ... })`, and read kernel-owned agent runtime profiles through `ctx.profiles.list(request?)`. Queue handoffs use the same daemon queue path as `POST /api/enqueue`, validate producer-agnostic metadata such as `postMerge` command arrays, and perform session-plan submission bookkeeping. Profile listing uses the shared client profile-list projection; actions should not scan profile directories, import private config/listing internals, declare local profile DTOs, or construct raw profile HTTP requests. Actions that enqueue should declare the `build-queue` side effect. Dependency/capability lookup reports availability only and does not invoke another extension. The action never imports provider SDKs or `AgentHarness`; the daemon owns task persistence, profile/runtime resolution, cancellation, and lifecycle events. Task records are stored under `.eforge/storage/agent-tasks`, and task events include only sanitized metadata rather than raw task input, prompt context, or result payloads.

The MVP task runner is intentionally narrow. It resolves the existing `planner` role and enforces read-only agent tools for the run. The start-request contract accepts contribution references alongside the legacy task-kind shape, but only registered planner-compatible task contributions execute; unsupported or non-compatible starts fail without prompt-path fallback. Extensions cannot send arbitrary raw prompt templates through task starts, expose multi-turn chat, or bypass the daemon-owned task lifecycle. The first supported task kind is a single-shot planning-draft task; extension-specific UI and higher-level eforge-plan actions can build on this boundary without owning the agent runtime directly.

A planning-draft result is either a ready result that carries at least one applicable structured output section for a supported first-party workflow, or a `needs-input` decision that carries structured clarification questions and a rationale instead of output sections. Product-specific output-section names and preview/apply semantics belong to the extension that requested the task; the daemon owns only task records, status, result validation, cancellation, sanitized progress, and error lifecycle. While a task runs, the agent may report telemetry-only `sectionProgress` (current, covered, and remaining sections) through a read-only progress tool. The daemon sanitizes and length-caps that progress before persisting it on the running record and emitting it on sanitized progress events; section progress is advisory telemetry only and never determines readiness or apply eligibility.

### Console workstations

Extension authors can also register sandboxed Console workstations for richer trusted extension UI under `/console/workstations`. V1 source-authored workstations are manifest-backed entries registered with `registerConsoleWorkstation` and declare exactly one source: inline iframe `srcDoc` or `frameBundle` bundle metadata. Bundle roots must be `workstation-assets` or a child directory under `workstation-assets/`; `entrypoint`, `styles`, and `assets` paths are relative to that root. Bundle entries render as sandboxed iframe `src` navigations to the manifest `frameBundle.frameUrl` with the bridge token in the URL fragment, not in the daemon route query string. Declared `frameBundle` assets are supported and served only through eforge-owned frame/asset routes. The daemon serves a generated frame shell through eforge-owned frame routes with no-cache semantics and a `Content-Security-Policy` header, and serves declared bundle files through immutable, content-addressed asset URLs from eforge-owned asset routes; browsers never provide filesystem-relative asset paths. Workstations are not sanitized declarative content and they are not rendered through the closed `/console/system` block renderer. Treat workstation `srcDoc` HTML and bundle metadata/code as trusted extension UI from the same unsandboxed extension codebase, isolated in the browser by the Console-owned iframe sandbox rather than by HTML sanitization.

A workstation can call the parent-owned action bridge with `window.eforge.invokeAction(actionId, input)` or use `invokeAction` from the browser-safe `@eforge-build/extension-sdk/browser` subpath. Console validates the request against the workstation's manifest `allowedActions`, invokes the daemon-owned action dispatcher, and posts a success or failure response back into the iframe. Authors may list explicit local action IDs in `allowedActions`; when the allowlist is omitted, the manifest projection defaults to actions registered by the same extension. The iframe may request a local ID such as `render-board-markdown` or an effective manifest ID such as `my-extension:render-board-markdown` when that effective ID is allowed.

Minimal workstation pattern:

```ts
import { Type, defineConsoleWorkstation, defineEforgeExtension, defineExtensionAction } from "@eforge-build/extension-sdk";

const renderSummary = defineExtensionAction({
  id: "render-summary",
  title: "Render summary",
  inputSchema: Type.Object({}),
  outputSchema: Type.Object({ markdown: Type.String() }),
  sideEffects: ["none"],
  handler: () => ({ markdown: "# Extension summary\nReady." }),
});

export default defineEforgeExtension((eforge) => {
  eforge.registerAction(renderSummary);
  eforge.registerConsoleWorkstation(defineConsoleWorkstation({
    id: "summary-workstation",
    title: "Summary workstation",
    srcDoc: `<!doctype html>
<button id="refresh">Refresh</button>
<pre id="out"></pre>
<script>
  document.getElementById('refresh').onclick = async () => {
    const result = await window.eforge.invokeAction('render-summary', {});
    document.getElementById('out').textContent = result.markdown;
  };
</script>`,
    allowedActions: ["render-summary"],
  }));
});
```

A bundle-backed source can use `frameBundle` instead of `srcDoc` when the declared files already exist under `workstation-assets/`:

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

Browser bundle modules use the browser-safe SDK subpath rather than private Console modules:

```ts
import { invokeAction } from "@eforge-build/extension-sdk/browser";

const result = await invokeAction("render-summary", {});
```

V1 intentionally keeps several boundaries deferred: extension-authored arbitrary frontend asset bundles remain deferred beyond the daemon-owned workstation frame/asset manifest contract; direct React component loading into the parent Console, parent-Console plugins, parent Console context imports, and private Console React/components/CSS imports remain unsupported; raw extension-owned HTTP routes remain unsupported; extension-owned AI planning/chat APIs remain unsupported outside the daemon-owned `ctx.agentTasks` single-shot task boundary; arbitrary independently loaded frontend plugins remain deferred. Authors may bundle React or another browser framework inside a `frameBundle` iframe, but that code executes inside the workstation iframe boundary, not in the parent Console realm. Iframe bundle code should use the versioned `@eforge-build/extension-sdk/browser` helpers or host-rendered slots rather than private Console React imports.

Agent-run hooks fire before each agent invocation. Handlers can inspect `ctx.role`, `ctx.tier`, `ctx.phase`, and `ctx.stage` to scope their contribution, then return `{ promptAppend, tools, allowedTools, disallowedTools }` to inject additional prompt context, expose extension tools for that run, and tune harness availability lists. Prompt fragments are appended after any config-level `promptAppend` already resolved by the engine, wrapped in a named provenance section identifying the contributing extension. Multiple extensions contribute in registration order. The runtime is fail-open: a handler that throws or exceeds `extensions.agentContextHookTimeoutMs` emits a typed diagnostic event but does not abort the agent run.

Policy gates run at three blocking points: `beforeQueueDispatch` runs before a queued PRD is dispatched, `beforePlanMerge` runs before a plan worktree is merged, and `beforeFinalMerge` runs before the completed feature branch is merged into the base branch. Gate contexts are read-only snapshots and include `ctx.logger` and `ctx.exec`; `beforeQueueDispatch` contexts also include optional `continueRepair` metadata for continue-and-repair queue items backed by complete compiled artifacts. They are not a sandbox. Extensions remain trusted, unsandboxed code running in the daemon/worker process.

Policy decisions are strictly validated. `{ decision: 'allow' }` lets the operation continue. `{ decision: 'block', reason }` blocks it and surfaces the reason. `{ decision: 'require-approval', reason }` currently blocks as an MVP behavior because no approval workflow, approval state, or Console approval UI exists yet. Thrown errors, timeouts, and invalid decisions emit `extension:policy:*` diagnostics and follow `extensions.policyGateFailurePolicy`: `fail-closed` blocks, while `fail-open` allows continuation after recording diagnostics.

Other extension capability families and unsupported variants remain intentionally deferred for later phases. Custom playbook extraction remains deferred, custom session-plan extraction remains deferred, user-authored session-plan extraction remains unsupported, and user-authored playbook extraction remains unsupported. Loading an extension records runtime-wired registration families so provenance and validation output remain complete. For tools, `registerTool(tool)` records loader-time provenance and validation metadata; returning `tools: [tool]` from `onAgentRun` is the per-run injection path. Extension-authored actions, agent task contributions, Console contributions, integration commands, and deep links are captured in the engine registry with safe management details and manifest projection; the daemon exposes contribution manifest and action invocation routes, Console renders declarative Console contributions under `/console/system`, and CLI, MCP/Claude, and Pi host integrations can discover actions, integration commands, and action-backed deep links through the shared contribution dispatcher. Action invocations reuse `extensions.eventHookTimeoutMs`, receive the daemon-owned `ctx.agentTasks` API for supported single-shot read-only planner tasks, `ctx.buildQueue.enqueue` for trusted queue handoffs, and `ctx.profiles.list` for read-only profile listing, and emit daemon-scoped `extension:action:*` lifecycle events without raw input payloads or raw output payloads. Agent task contribution manifests expose safe prompt source metadata only; raw prompt text and resolver function bodies stay private. The shipped playbook action surface lives in the first-party `eforge-playbooks` extension, and the session-planning adapter remains internal/built-in; neither is a user-authored native extension registration point. `beforeEnqueue`, `beforeValidation`, approval workflows/UI/state, `modify` decisions, custom session-plan extraction into extensions, custom playbook extraction into extensions, raw extension-owned HTTP routes, arbitrary Console JavaScript outside registered workstation documents, direct React loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, multi-turn chat, caller-supplied arbitrary raw prompt templates, and independently loaded frontend plugins remain deferred or unsupported runtime phases.

Reviewer perspectives execute during the review-cycle stage and are no longer deferred. They participate in parallel review perspective dispatch (for `review.strategy: parallel`, or `auto` when the diff crosses the parallel-review thresholds). Each registered perspective is evaluated for applicability against the plan diff; applicable custom perspectives run as separate review perspectives using the generic reviewer prompt with their `promptFragment` appended as extension-provenance context. Applicability inputs are read-only API snapshots: reviewer perspectives cannot mutate orchestration state, block the review, or access agent tool APIs.

| Capability | Type contract | Loader-time registration capture | Runtime execution today |
|-----------|---------------|----------------------------------|-------------------------|
| `onEvent` - typed event subscriptions | Yes | Yes | Yes |
| `onAgentRun` - agent prompt/tool augmentation and availability tuning | Yes | Yes | Yes |
| `registerTool` - custom agent tool provenance | Yes | Yes | Provenance only; inject per run via `onAgentRun` |
| `beforeQueueDispatch` - policy gate before queued PRD dispatch | Yes | Yes | Yes (blocking policy gate) |
| `beforePlanMerge` - policy gate before plan worktree merge | Yes | Yes | Yes (blocking policy gate) |
| `beforeFinalMerge` - policy gate before final feature merge | Yes | Yes | Yes (blocking policy gate) |
| `registerProfileRouter` | Yes | Yes | Yes (pre-build dispatch) |
| `registerRuntimeChoiceRouter` | Yes | Yes | Yes (per-invocation runtime-choice dispatch after declarative rules) |
| `registerInputSource` | Yes | Yes | Yes (extension-aware enqueue preprocessing) |
| `registerPrdEnricher` | Yes | Yes | Yes (fail-open content enrichment before queue write) |
| `registerReviewerPerspective` | Yes | Yes | Yes (parallel review-cycle dispatch) |
| `registerValidationProvider` | Yes | Yes | Yes (per-plan `validate` build stage) |
| `registerAction` | Yes | Yes | Engine action dispatcher via daemon action invocation route; action context includes dependency/capability lookup, daemon-owned `ctx.agentTasks`, `ctx.buildQueue`, and `ctx.profiles` |
| `registerAgentTask` | Yes | Yes | Daemon contribution manifest projection; contribution-reference starts execute for registered planner-compatible task contributions; unsupported/non-compatible starts fail without prompt-path fallback |
| `registerConsoleContribution` | Yes | Yes | Daemon contribution manifest projection; Console renders declarative panels under `/console/system` |
| `registerIntegrationCommand` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed commands |
| `registerDeepLink` | Yes | Yes | Daemon contribution manifest projection; host integrations can invoke action-backed deep links |
| `registerConsoleWorkstation` | Yes | Yes | Daemon contribution manifest projection; Console renders sandboxed iframe workstations under `/console/workstations` from `srcDoc` entries or source `frameBundle` entries projected to daemon frame/asset URLs |

Event-hook, agent context/tool injection, profile-router, shipped policy-gate, input-source fetching, PRD enrichment, reviewer perspective, validation provider, daemon-owned action agent tasks, agent task contribution declarations, read-only action profile-list access, and contribution-family examples can be loaded and validated at runtime. Event-oriented examples include [`examples/extensions/minimal-event-logger.ts`](../examples/extensions/minimal-event-logger.ts) and the safe [`examples/extensions/slack-webhook-notifier.ts`](../examples/extensions/slack-webhook-notifier.ts), which only sends a Slack-compatible webhook when `EFORGE_SLACK_WEBHOOK_URL` is set. [`examples/extensions/agent-tools.ts`](../examples/extensions/agent-tools.ts) demonstrates defining a TypeBox tool, registering it for provenance, and returning it only for builder runs with `ctx.effectiveToolName(...)` in prompt text. Profile routers run before each PRD build is dispatched from the queue: routers are invoked in registration order with `extensions.profileRouterTimeoutMs` timeout/fail-open semantics, and the first valid profile selection persists to the PRD's frontmatter before `session:start` is emitted. When a router selects a profile, a `queue:profile:selected` event is emitted with the PRD id, selected profile, router name, and optional reason/confidence fields. An explicit `profile:` field in the PRD's frontmatter takes absolute precedence — no routers are consulted. See [`examples/extensions/profile-router.ts`](../examples/extensions/profile-router.ts) for a Claude → Codex → local fallback example. [`examples/extensions/protected-paths.ts`](../examples/extensions/protected-paths.ts) demonstrates runtime-supported plan/final merge policy enforcement for protected paths. [`examples/extensions/issue-tracker.ts`](../examples/extensions/issue-tracker.ts) demonstrates runtime-supported input source adapters for GitHub, Linear, and Jira. [`examples/extensions/reviewer-perspective.ts`](../examples/extensions/reviewer-perspective.ts) demonstrates a runtime-supported accessibility reviewer perspective with declarative `appliesTo.fileGlobs` applicability for UI/TSX files. [`examples/extensions/validation-provider.ts`](../examples/extensions/validation-provider.ts) demonstrates runtime-supported validation providers in both function form (programmatic) and command form (subprocess). [`examples/extensions/action-contribution.ts`](../examples/extensions/action-contribution.ts) demonstrates an action-backed Console contribution, integration command, and deep link without raw HTTP routes or browser code. Raw extension-owned HTTP routes remain unsupported. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, user-authored custom session-plan extraction, user-authored custom playbook extraction, arbitrary frontend plugin bundles outside registered workstation iframes, extension-authored arbitrary frontend asset bundles outside the workstation frame/asset contract, direct React component loading into the parent Console, private Console React/components/CSS imports, parent Console context imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, multi-turn chat, and caller-supplied arbitrary raw prompt templates are unsupported runtime phases.

### Input sources and PRD enrichers

Input sources and PRD enrichers run during the enqueue preprocessing stage, before the build source artifact is written to the queue.

**`registerInputSource` — URI-based artifact fetching**

Input source adapters are selected by `name` against the `<adapter>` segment of an `eforge://input/<adapter>/<id>` URI. The runtime calls `adapter.fetch(id, ctx)` with the remaining `<id>` path and an `InputTransformContext`. During enqueue preprocessing this context is limited to cwd/provenance metadata plus stub helpers: `ctx.exec.run` is unavailable and throws, and `ctx.logger` is a no-op logger rather than event-hook logging.

URI examples:
- `eforge://input/github/acme/backend#42` — adapter `github`, id `acme/backend#42`
- `eforge://input/linear/ENG-42` — adapter `linear`, id `ENG-42`
- `eforge://input/jira/ENG-42` — adapter `jira`, id `ENG-42`

Adapters may return a raw content string, an `InputSourceResult` object `{ content, title? }`, or `null` to signal that the identifier was not found. Returning `null` is fatal to enqueue (`FatalPreprocessingError`). Throwing is also fatal. Design adapters to be safe-by-default: when required credentials are absent, return an `InputSourceResult` with instructional content rather than throwing.

Provenance events emitted per adapter call:
- `extension:input-source:fetched` — adapter returned content successfully.
- `extension:input-source:failed` — adapter threw or returned `null`.

**`registerPrdEnricher` — content augmentation before queue write**

PRD enrichers run in registration order after input source preprocessing completes. Each enricher receives `{ content, sourceId, ctx }` and may return `{ content }` to replace the content, or `null`/`undefined` to pass it through unchanged. Enrichers always run for every preprocessed source; gate behavior inside `enrich` using `ctx.sourceKind`, `ctx.adapterId`, or `ctx.sourcePath` if needed. The preprocessing context has the same limits as input-source adapters: `ctx.exec.run` throws, and `ctx.logger` is a no-op logger.

Enricher failures are fail-open: a thrown error emits `extension:prd-enricher:failed` with the enricher name, source id, and error message, and the unchanged content carries forward.

Provenance events emitted per enricher call:
- `extension:prd-enricher:applied` — enricher returned modified content.
- `extension:prd-enricher:failed` — enricher threw (content unchanged; build continues).

### Reviewer perspectives

Reviewer perspectives execute during the review-cycle stage alongside built-in eforge review perspectives when the review uses parallel perspective dispatch (`review.strategy: parallel`, or `auto` once the diff crosses the parallel-review thresholds). Each registered perspective is evaluated for applicability against the plan diff; applicable custom perspectives run as separate review perspectives using the generic reviewer prompt with their `promptFragment` appended as extension-provenance context. Multiple extensions may register perspectives; each applicable perspective is dispatched separately and its findings are aggregated with the other review results. Perspective keys must be lowercase slugs (`^[a-z][a-z0-9-]{0,63}$`) and must not conflict with built-ins (`code`, `security`, `api`, `docs`, `test`, `verify`).

**Applicability rules**

A perspective declares when it applies via `appliesTo` or neither:

- `appliesTo.fileGlobs`: glob patterns matched against changed file paths in the review diff. The perspective runs when at least one changed file matches any supplied pattern.
- `appliesTo.paths`: path prefixes matched against changed file paths.
- `appliesTo.extensions`: file extensions, with or without a leading dot.
- `appliesTo.categories`: built-in file categories (`code`, `api`, `docs`, `config`, `deps`, `test`).
- `appliesTo.minChangedFiles` / `appliesTo.minChangedLines`: minimum diff-size thresholds.
- `appliesTo.fn(changedFiles, changedLines)`: optional function-form predicate called only after all declarative rules pass. Return `true` to include the perspective or `false` to skip it.
- Neither: omit `appliesTo` to run on every review cycle.

All specified declarative rules are ANDed together.

**Function-form applicability and fail-open behavior**

Function-form `appliesTo.fn` handlers run with a configurable timeout (`extensions.eventHookTimeoutMs`). A throw, timeout, or unexpected return value is fail-open: the perspective is skipped and an `extension:reviewer-perspective:skipped` diagnostic is emitted rather than blocking the review cycle. The diagnostic reason is `applicability-error` or `applicability-timeout`.

**Trust model and read-only inputs**

Applicability inputs are read-only snapshots of changed file paths and changed-line count. Reviewer perspectives cannot mutate orchestration state, block the review cycle, or access agent tool APIs. However, TypeScript extensions are unsandboxed trusted code: the extension module itself runs in the daemon/worker process with full filesystem, environment, and network access. The read-only constraint applies to review applicability inputs, not to extension code in general.

**Management output**

`eforge extension show` and JSON list/show/validate/test responses include registered reviewer perspectives with their key, label, description, extension name/path, and normalized applicability summary. Function source text is never exposed in management projections.

See [`examples/extensions/reviewer-perspective.ts`](../examples/extensions/reviewer-perspective.ts) for an accessibility review example that targets UI/TSX files using declarative `appliesTo.fileGlobs`.

### Validation providers

Validation providers execute during the per-plan `validate` build stage, after the implement stage completes and before the review stage, when `validate` is included in the build pipeline. Each registered provider is invoked in registration order for every plan that reaches the validate stage. Providers are fail-closed gates: normal validation failures can be repaired first, but unresolved failures still fail the current plan and emit `plan:build:failed`. The daemon process itself is never crashed by a provider failure.

Normal validation-provider failures are recoverable before fail-closed terminal failure: structured `{ status: 'failed' }` function-form results and command-form non-zero exits enter the plan's recovery loop. Recovery is bounded by the plan's `review.maxRounds` budget. After each recovery attempt, eforge reruns the provider suite from the first provider so earlier gates can re-check changes made during recovery.

Hard provider failures bypass recovery and emit terminal `plan:build:failed` immediately: thrown exceptions or rejected promises, provider timeouts, non-empty string returns from function-form providers, and unexpected return shapes. Use these hard-failure paths for extension bugs or unavailable infrastructure, not ordinary quality-gate findings.

**Result contract**

A function-form provider returns `null` or `undefined` to pass, or a structured `ValidationProviderResult` object with `status` (`'passed'`, `'failed'`, or `'skipped'`), an optional `message`, optional extended `details`, and optional per-file `annotations`. Non-empty string failure returns are not part of the function-form contract; they are treated as unexpected return shapes.

Structured annotations are the best path to precise recovery issues. Include `file` and `line` whenever possible so the repair agent can target the relevant location instead of inferring it from free-form output. Each annotation may include:

- `details`: diagnostic output or other context for the annotation.
- `fix`: provider-authored repair instruction.
- `retryGuidance`: advice for the next repair attempt if the first patch is rejected or the same failure recurs.
- `failureKind`: a provider-authored domain signature such as `maintainability:file-size-cap`; this is separate from runtime failure classification.
- `repairClass`: one of `narrow`, `structural`, `manual`, or `followup`.
- `metadata`: small JSON-safe data that lets the fixer avoid parsing prose (for example `{ currentLines, cap, overflow }`).

Use `repairClass: 'narrow'` or omit it for localized fixes. Use `repairClass: 'structural'` when the correct fix requires extraction, file splitting, or broader code organization changes. Use `manual` when the provider should fail closed without automated repair. Use `followup` for findings that should only fail closed when every remaining issue is follow-up-only; mixed follow-up plus automatable issues route according to the narrow/structural guidance.

**Recovery routing and checkpoints**

Function-form annotations are normalized into review issues. Narrow or unspecified issues go through the review-fixer path first. Structural issues route to the validation-fixer path. If the same validation failure signature survives a prior narrow repair attempt, eforge escalates the next attempt to structural repair. Any manual annotation disables automated repair, and an all-follow-up failure set fails closed without an automated attempt; mixed follow-up plus narrow or structural issues routes according to the remaining automatable issues.

Before each automated validation-provider repair attempt, eforge writes a checkpoint under `.eforge/validation-recovery/<plan-set>/<plan-id>/attempt-<n>-<provider>/` with `checkpoint.patch` and `metadata.json`. The repair prompt references these paths, and the evaluator receives the same validation repair context. Every narrow or structural validation repair is evaluator-mediated: a candidate patch must be judged as a strict improvement before the provider suite reruns.

**Command form**

For gates that reduce to a subprocess exit code, use the `commands` array instead of a `validate` function. Each entry is a whitespace-split command string run via `execFile` in the plan worktree. A non-zero exit code is a recoverable generic subprocess failure with the command's stderr (or stdout if stderr is empty) as the message. Command-form providers cannot attach annotations, `repairClass`, `retryGuidance`, `failureKind`, or `metadata`; use the function form when you need structured guidance. Shell interpretation, quoted arguments, env-var expansion, redirects, and pipes are not supported; use the function form when you need those features.

**Failure semantics and timeout**

Providers run under a wall-clock timeout controlled by `extensions.validationProviderTimeoutMs` (falls back to `extensions.eventHookTimeoutMs`). On expiry the subprocess tree is killed and an `extension:validation-provider:timeout` event is emitted with the provider name and elapsed duration. Timeouts are hard failures and do not enter recovery.

**No-mutation contract**

Providers receive a `ValidationProviderContext` carrying read-only build facts: `planId`, `planOutputDir`, `worktreePath`, `logger`, `exec`, `signal`, and `changedFiles`. Providers must not mutate engine state, the extension registry, or orchestration metadata. Writing to the plan worktree is allowed but uncommon; do not write outside the plan worktree.

**Events**

The runtime emits the following events during validation provider execution:

- `extension:validation-provider:start` — provider invocation has begun.
- `extension:validation-provider:complete` — provider completed with a passed or skipped outcome; carries `status`.
- `extension:validation-provider:error` — provider completed with a failed outcome; carries provider name and error message. This includes recoverable normal failures (structured failed results and command-form non-zero exits) as well as hard exception/rejection, non-empty string return, and unexpected-return-shape failures.
- `extension:validation-provider:timeout` — provider exceeded `validationProviderTimeoutMs`; carries the provider name and elapsed milliseconds. Timeouts are hard failures that bypass recovery.

**Management output**

`eforge extension show` and JSON list/show/validate/test responses include registered validation providers with: `name`, `description`, `kind` (`function` or `commands`), `commandCount` (command-form only), and extension provenance. Function source text and raw command strings are never exposed in management projections.

See [`examples/extensions/validation-provider.ts`](../examples/extensions/validation-provider.ts) for a worked example with both function-form (`type-check-gate`) and command-form (`lint-gate`) providers.

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
| `*:complete` | `planning:complete`, `plan:build:complete`, `merge:finalize:complete`, etc. |
| `*` | Every event |

Pattern semantics match shell hooks. See [`docs/hooks.md`](./hooks.md) for event types.

## Trust and security

- Extensions run in the eforge daemon/worker Node process without a sandbox.
- User (`~/.config/eforge/extensions/`) and project-local (`.eforge/extensions/`) extensions load when `extensions.enabled` is true.
- Project/team extensions (`eforge/extensions/`) are unsandboxed arbitrary code committed to the repository. They require an explicit per-extension local trust record in `.eforge/extension-trust.json` — created by `eforge extension trust <name>` — before loading. Any code change invalidates the stored hash and blocks the extension until re-trusted.
- The content hash covers the entrypoint for file-layout extensions and, for directory-layout extensions, `package.json` plus `.ts`, `.mts`, `.js`, and `.mjs` files under the extension directory (excluding top-level `node_modules/`, `dist/`, and `.git/`). It also covers every regular file under `workstation-assets/`, including nested `dist/`, `node_modules/`, or `.git/` directories there, so trusted workstation bundle assets are covered. Files imported from outside the extension directory — and non-source/data files outside `workstation-assets/` — are not covered; keep implementation code inside the extension directory and in hashed source files to ensure relevant code changes are captured.
- Explicit paths outside standard scopes are treated as `external` and trusted when enabled, so use them only for code you control.
- Do not load extensions from unreviewed repositories or package artifacts.
- Treat `eforge extension test` as code execution, not static analysis. The replay path is a dry run with respect to eforge engine state, but matching `onEvent` handlers still execute in the daemon process and can perform filesystem, environment, and network operations.
- Reviewer perspective applicability inputs are read-only API snapshots: changed file paths and changed-line count only. Perspectives cannot mutate orchestration state. The extension module itself, however, is unsandboxed trusted code running in the daemon/worker process.

## API reference

For full type signatures and method documentation, see [`docs/extensions-api.md`](./extensions-api.md). For upgrade expectations, see the [SDK stability and migration guidance](./extensions-api.md#sdk-stability-and-migration-guidance).
