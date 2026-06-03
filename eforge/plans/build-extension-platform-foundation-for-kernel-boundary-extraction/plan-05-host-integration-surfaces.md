---
id: plan-05-host-integration-surfaces
name: Expose generic extension contribution discovery and invocation in Pi,
  Claude/MCP, and CLI while keeping management dispatch separate.
branch: build-extension-platform-foundation-for-kernel-boundary-extraction/host-integration-surfaces
---

# Host Integration Surfaces

## Architecture Reference

This module implements the architecture sections **Host integration contract**, **Integration command and deep-link model**, and the host-consumer portions of **Runtime flow** and **Client to daemon route contract**.

Key constraints from architecture:
- Pi, Claude/MCP, and CLI consume the daemon contribution manifest and action invocation route only through `@eforge-build/client` helpers.
- Extension-management dispatch remains separate from extension-authored action dispatch; do not add contribution invocation to `dispatchEforgeExtensionAction` or `EFORGE_EXTENSION_ACTIONS`.
- Host-specific UX may differ, but discovery/invocation metadata comes from the shared manifest and action invocation route.
- Pi uses passive `IfRunning` helpers for ambient/native extension calls; it must not auto-start the daemon except through existing daemon start/restart surfaces.
- MCP/Claude and CLI may use auto-starting Node helpers, matching existing daemon-backed tool and CLI behavior.
- Invocation routes receive effective action IDs and `requestedBy` provenance. Commands and deep links resolve to action bindings before invoking.
- Hosts must not inline `/api/...` route literals or redeclare daemon wire response shapes.
- New edits to oversized host entrypoints must be bounded. `packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/mcp-proxy.ts`, and `packages/pi-eforge/extensions/eforge/index.ts` receive import/call-site edits only.
- If plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json`. Do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- Add a shared client host-dispatch helper that lists manifest-backed host targets and invokes actions, integration commands, and action-backed deep links.
- Expose CLI commands for listing and invoking extension host contributions.
- Expose an MCP tool for Claude Code discovery/invocation of extension host contributions.
- Expose a Pi tool for model-driven discovery/invocation of extension host contributions.
- Expose a Pi native command for interactive discovery and action-backed invocation through the same client helper.
- Record `requestedBy.host` as `cli`, `mcp`, or `pi` and include command/deep-link IDs when invocation flows through those target kinds.
- Keep URL-only deep links discoverable but reject generic invocation unless they carry an action binding.
- Update extension-authoring skill guidance in both Claude plugin and Pi package to mention action, integration-command, and deep-link host surfaces, and bump the Claude plugin manifest version.
- Add static parity/source-discipline tests and focused dispatcher behavior tests.

### Out of Scope

- SDK contracts and client wire schemas owned by `platform-contracts`.
- Engine manifest projection and action dispatch owned by `engine-registry-runtime`.
- Daemon route handlers, HTTP status mapping, and action lifecycle events owned by `daemon-action-routes`.
- Console contribution rendering owned by `console-contribution-rendering`.
- Documentation/reference generation and extension examples owned by `docs-examples-compat`, except for host package skill/README guidance listed here.
- Dynamic per-extension Pi slash-command registration. This slice provides generic Pi tool/command discovery and invocation.
- Creating a new Claude Code slash skill for contribution invocation. Claude Code exposure is through the MCP tool.
- Invoking URL-only deep links by opening browsers or external applications.
- Raw extension-owned HTTP routes or arbitrary extension-supplied browser/frontend code.

## Implementation Approach

### Overview

Add one shared client dispatcher module above the platform-owned manifest/invocation helpers. The dispatcher converts a full `ExtensionContributionManifestResponse` into host-facing catalog entries for actions, integration commands, and deep links, then resolves command/deep-link invocation to effective action IDs and calls the action invocation helper.

All host surfaces use that dispatcher:

- CLI registers `eforge extension contributions list` and `eforge extension contributions invoke <id>` through a new focused CLI module.
- MCP registers a new `eforge_extension_contribution` tool through a new focused MCP helper module.
- Pi registers a new `eforge_extension_contribution` tool and `/eforge:extensions` native command through a new focused Pi helper module.

The large host entrypoints import and call these helpers only. This keeps edits bounded, keeps command UX colocated in small files, and gives tests importable units without reaching into oversized files.

### Shared client host dispatcher

Create `packages/client/src/api/extension-contribution-dispatch.ts` with host-facing utilities. It must import platform-owned types and helpers from `../extension-contributions.js` and `./extension-contributions.js`; it must not import `./extension-tool-dispatch.js`, `daemonRequest`, or route constants directly.

Export these public shapes and helpers:

- `EXTENSION_HOST_CONTRIBUTION_KINDS = ['action', 'command', 'deep-link'] as const`.
- `ExtensionHostContributionKind`.
- `ExtensionHostContributionEntry` with `kind`, `id`, `label`, optional `description`, `extensionName`, `extensionPath`, optional `actionId`, `actionBacked`, optional `sideEffects`, optional `inputSchema`, and optional `inputDefaults`.
- `ExtensionHostContributionListResponse` with `generatedAt`, `entries`, and manifest `diagnostics`.
- `ExtensionHostContributionInvokeParams` with optional `kind`, required `id`, optional object `input`, and `requestedBy: ExtensionActionRequestedBy`.
- `ExtensionHostContributionInvokeResult` with the resolved target metadata and `response: ExtensionActionInvokeResponse`.
- `summarizeExtensionContributionManifest(manifest, options?)` for pure list projection.
- `resolveExtensionContributionInvocation(manifest, params)` for pure target/action binding resolution.
- `listEforgeExtensionContributions`, `listEforgeExtensionContributionsIfRunning`, `invokeEforgeExtensionContribution`, and `invokeEforgeExtensionContributionIfRunning` using platform-owned Node helpers.

Resolution rules:

1. `kind: 'action'` resolves the ID directly against `manifest.actions`.
2. `kind: 'command'` resolves against `manifest.integrationCommands`, requires its action binding, merges `inputDefaults` with caller input, and sets `requestedBy.commandId`.
3. `kind: 'deep-link'` resolves against `manifest.deepLinks`, requires an action binding, merges `inputDefaults` with caller input, and sets `requestedBy.deepLinkId`.
4. Omitted `kind` searches actions, commands, and deep links by ID. If more than one target matches, throw an error telling the caller to pass `kind`.
5. URL-only deep links stay in list output with `actionBacked: false`; invoking them throws `Deep link "<id>" is not action-backed` before calling the action helper.
6. Caller input must be a non-array object. Reject arrays, `null`, strings, numbers, booleans, and missing IDs before making HTTP calls.
7. Caller input overrides binding `inputDefaults` when both define the same key.
8. Return typed action failure responses as data. Do not throw for `{ ok: false }` daemon action responses; only throw for local resolution errors and transport/schema errors from the platform helper.

### CLI surface

Create `packages/eforge/src/cli/extension-contributions.ts` and export `registerExtensionContributionCommands(extension: Command): void`.

Add a nested command group under existing `eforge extension`:

```text
eforge extension contributions list [--kind action|command|deep-link|all] [--json]
eforge extension contributions invoke <id> [--kind action|command|deep-link] [--input-json <json>] [--input-file <path>] [--json]
```

CLI behavior:

- `list` uses `listEforgeExtensionContributions({ cwd: process.cwd(), kind })`.
- Non-JSON list output renders a compact table with `kind`, `id`, `label`, `action`, `extension`, and action-backed status for deep links.
- JSON list output prints the full `ExtensionHostContributionListResponse`.
- `invoke` parses `--input-json` or `--input-file` as JSON. The two flags are mutually exclusive. Omitted input becomes `{}`.
- Parsed input must be a non-array object; otherwise print an error and exit nonzero.
- `invoke` calls `invokeEforgeExtensionContribution` with `requestedBy: { host: 'cli' }`.
- JSON invoke output prints `{ target, response }`.
- Non-JSON invoke output prints `invocationId`, target kind/id, action ID, and JSON-formatted output for success.
- Non-JSON action failures print the typed error code and message to stderr and exit `1`.
- Transport/stale-daemon errors continue through `formatCliError`.

Modify `packages/eforge/src/cli/index.ts` with bounded edits only: import `registerExtensionContributionCommands` and call it after existing extension-management commands are registered, before the `// Config commands` block.

### MCP / Claude Code surface

Create `packages/eforge/src/cli/mcp-extension-contributions.ts` and export `registerExtensionContributionMcpTool(server: McpServer, cwd: string): void`.

Register one daemon-backed MCP tool:

- Name: `eforge_extension_contribution`.
- Description: state that it lists and invokes extension-provided actions, integration commands, and action-backed deep links; it is distinct from `eforge_extension` management.
- Schema:
  - `action: 'list' | 'invoke'`.
  - `kind?: 'action' | 'command' | 'deep-link'`.
  - `id?: string` required for `invoke`.
  - `input?: Record<string, unknown>` for `invoke`.
- For `list`, return `listEforgeExtensionContributions({ cwd, kind })` data.
- For `invoke`, call `invokeEforgeExtensionContribution` with `requestedBy: { host: 'mcp' }`.
- If the returned action response has `ok: false`, throw `new McpUserError({ target, response })` so MCP marks the tool result as an error while preserving the typed body.
- Do not use `dispatchEforgeExtensionAction` and do not import extension-management dispatcher helpers.

Modify `packages/eforge/src/cli/mcp-proxy.ts` with bounded edits only: import `registerExtensionContributionMcpTool` and call it immediately after the existing `eforge_extension` tool registration and before `eforge_models`.

### Pi surface

Create `packages/pi-eforge/extensions/eforge/extension-contributions.ts` with two exports:

- `registerExtensionContributionTool(pi: ExtensionAPI): void`.
- `registerExtensionContributionsCommand(pi: ExtensionAPI, getLatestCtx: () => UIContext | null): void`.

Pi tool behavior:

- Register `eforge_extension_contribution` with the same high-level schema as MCP, using TypeBox and `StringEnum`.
- Use `listEforgeExtensionContributionsIfRunning` and `invokeEforgeExtensionContributionIfRunning`.
- Throw `DAEMON_NOT_RUNNING_GUIDANCE` when an `IfRunning` helper returns `null`.
- Use `requestedBy: { host: 'pi' }` for invocation.
- Return JSON text for successful list/invoke results. If the typed action response has `ok: false`, return the typed failure body as JSON instead of throwing; native command rendering handles errors visibly for human-triggered calls.

Pi native command behavior:

- Register `/eforge:extensions` with description `Browse and invoke extension-provided commands and deep links`.
- If no UI context is available, send a user message instructing the model to use `eforge_extension_contribution` with the original arguments.
- Supported power-user forms:
  - `/eforge:extensions list`
  - `/eforge:extensions invoke <id>`
  - `/eforge:extensions invoke <kind>:<id>`
  - `/eforge:extensions invoke <id> {"json":"input"}`
- No-argument UI flow fetches the list, shows a searchable selector containing integration commands, action-backed deep links, and actions, then prompts for object JSON input with `ctx.ui.editor` when the target has an action binding.
- The selector label includes kind, label, effective ID, and extension name. URL-only deep links display as non-invokable entries and open a read-only info panel explaining that generic host invocation only supports action-backed deep links.
- After invocation, show an info panel with success/failure, invocation ID, target ID, action ID, and JSON-formatted output or typed error.
- Use existing `showSearchableSelectPanel`, `showInfoPanel`, and `withLoader` helpers.

Modify `packages/pi-eforge/extensions/eforge/index.ts` with bounded edits only: import the two registration helpers, call `registerExtensionContributionTool(pi)` near the existing `eforge_extension` tool, and call `registerExtensionContributionsCommand(pi, () => _latestCtx)` near the existing command registrations.

### Skill and package guidance

Update both extension-authoring skill files in parity:

- `eforge-plugin/skills/extend/extend.md`.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md`.

Add concise guidance that `registerAction`, `registerConsoleContribution`, `registerIntegrationCommand`, and `registerDeepLink` are runtime-supported platform seams; host invocation uses `mcp__eforge__eforge_extension_contribution` in Claude/MCP and `eforge_extension_contribution` in Pi; raw HTTP routes and arbitrary frontend bundles remain unsupported.

Because plugin files change, bump `eforge-plugin/.claude-plugin/plugin.json` patch version. Do not change `packages/pi-eforge/package.json`.

Update `packages/pi-eforge/README.md` to mention the new `eforge_extension_contribution` tool and `/eforge:extensions` command.

### Key Decisions

1. **Use one generic host tool/command instead of registering dynamic per-extension commands.** This avoids stale dynamic command registration, command-name collisions in Pi/MCP, and reload complexity while still exposing all manifest metadata.
2. **Create a client dispatcher separate from extension management dispatch.** The new dispatcher resolves manifest contribution targets; `dispatchEforgeExtensionAction` remains solely for native extension management operations.
3. **Commands and deep links invoke by action binding.** Host-specific command IDs and deep-link IDs never become daemon action IDs; the dispatcher resolves them to effective action IDs and annotates `requestedBy`.
4. **List URL-only deep links but do not invoke them.** Opening URLs or external apps is host-specific and not required for this foundation slice.
5. **Pi uses passive helpers.** Pi tools and commands report daemon-not-running guidance instead of auto-starting the daemon from ambient extension code.
6. **MCP action failures become MCP user errors.** Claude sees failed extension actions as failed tool calls while still receiving the typed response body.
7. **CLI action failures exit `1`.** The action route kept the daemon alive and returned a typed failure; a human CLI invocation still needs a nonzero process result for scripts.
8. **Large entrypoints delegate to focused modules.** This satisfies the bounded-edit policy for files over 1,000 lines and keeps new behavior testable.

## Files

### Create

- `packages/client/src/api/extension-contribution-dispatch.ts` — host-facing manifest summarization and action/command/deep-link invocation dispatcher, separate from extension-management dispatch.
- `packages/eforge/src/cli/extension-contributions.ts` — Commander registration and rendering for `eforge extension contributions list|invoke`.
- `packages/eforge/src/cli/mcp-extension-contributions.ts` — MCP `eforge_extension_contribution` tool registration using `createDaemonTool`.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` — Pi `eforge_extension_contribution` tool and `/eforge:extensions` native command registration plus TUI helpers.
- `test/extension-contribution-dispatch.test.ts` — pure and helper-driven tests for listing, resolving, default input merging, requested-by provenance, URL-only deep-link rejection, ambiguous IDs, and typed action failure propagation.
- `test/extension-contribution-host-surfaces.test.ts` — static and command-registration tests for CLI, MCP, Pi, client exports, source discipline, skill parity, and plugin version bump.

### Modify

- `packages/client/src/index.ts` — export the new host dispatcher constants, types, and helpers `[region: host-integration-surfaces, after platform contribution exports from ./extension-contributions.js and ./api/extension-contributions.js]`.
- `packages/eforge/src/cli/index.ts` — import `registerExtensionContributionCommands` and call it on the existing `extension` Commander group `[region: host-integration-surfaces, import near other focused CLI command imports; call after extension-management command registrations and before // Config commands]`.
- `packages/eforge/src/cli/mcp-proxy.ts` — import and call `registerExtensionContributionMcpTool` `[region: host-integration-surfaces, import near mcp-tool-factory import; call immediately after the eforge_extension tool block and before eforge_models]`.
- `packages/pi-eforge/extensions/eforge/index.ts` — import and call `registerExtensionContributionTool` and `registerExtensionContributionsCommand` `[region: host-integration-surfaces, import near other native command modules; call tool helper after eforge_extension registration; call command helper near command aliases]`.
- `eforge-plugin/skills/extend/extend.md` — add host contribution/action guidance in the existing capability classification section.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — mirror the plugin skill change after parity normalization.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version because the plugin skill file changes.
- `packages/pi-eforge/README.md` — add the new Pi tool and native command to the feature list; do not change the package version.
- `test/client-no-start-api-helpers.test.ts` — add `listEforgeExtensionContributionsIfRunning` and `invokeEforgeExtensionContributionIfRunning` to the passive helper matrix if they are exported as direct no-start helpers rather than covered in `test/extension-contribution-dispatch.test.ts`.

## Detailed Implementation Notes

### Source and region discipline

- New route paths must not appear in host modules. Host modules use `@eforge-build/client` helpers only.
- `packages/client/src/api/extension-contribution-dispatch.ts` must not import `API_ROUTES`, `daemonRequest`, `daemonRequestIfRunning`, or `./extension-tool-dispatch.js`.
- `packages/eforge/src/cli/extension-contributions.ts` and `packages/eforge/src/cli/mcp-extension-contributions.ts` must not import monitor or engine packages.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` must use `IfRunning` helpers only; it must not import `daemonRequest`, `ensureDaemon`, or route constants.
- If a new file exceeds 300 lines, add durable semantic region markers such as `// --- eforge:region host-contribution-dispatch ---`; do not use temporary plan markers unless the builder intends cleanup to strip them.
- If temporary coordination markers are used in examples or source, use the compiled plan slug `plan-05-host-integration-surfaces`:

```ts
// --- eforge:region plan-05-host-integration-surfaces ---
registerExtensionContributionCommands(extension);
// --- eforge:endregion plan-05-host-integration-surfaces ---
```

### Dispatcher error messages

Use deterministic local error messages so CLI, MCP, Pi, and tests match:

- `"id" is required when action is "invoke"`.
- `"input" must be a JSON object`.
- `Unknown extension action "<id>"`.
- `Unknown extension integration command "<id>"`.
- `Unknown extension deep link "<id>"`.
- `Ambiguous extension contribution id "<id>"; pass kind action, command, or deep-link`.
- `Deep link "<id>" is not action-backed`.

### Requested-by metadata

The dispatcher receives a caller-provided base `requestedBy` and enriches it without overwriting the host:

- Direct action invocation: `{ host: 'cli' | 'mcp' | 'pi' }`.
- Command invocation: add `commandId: <effective command id>`.
- Deep-link invocation: add `deepLinkId: <effective deep-link id>`.

If `platform-contracts` names these optional provenance fields differently, use the exported `ExtensionActionRequestedBy` field names and update the test names to those exact fields.

### CLI input parsing

`packages/eforge/src/cli/extension-contributions.ts` owns a small parser:

- `parseJsonObjectInput({ inputJson, inputFile })` returns `{}` when both are absent.
- It throws when both flags are present.
- It reads `--input-file` with `fs.readFile` and parses as UTF-8 JSON.
- It rejects parsed values that are `null`, arrays, or non-objects.
- It does not validate against action input schemas locally; daemon action invocation remains the schema authority.

### Pi command parsing

Keep the native command parser intentionally small:

- Split the first word as branch: `list` or `invoke`.
- For `invoke`, accept `kind:id` prefixes for `action:`, `command:`, and `deep-link:`.
- Treat the remainder after the ID as JSON input when present.
- In interactive no-argument flow, fetch list entries and prompt for input JSON with `{}` as prefill.
- If JSON parsing fails, show an info panel containing the parser message and do not invoke.

## Testing Strategy

### Unit Tests

Add `test/extension-contribution-dispatch.test.ts` with a hand-crafted manifest and helper functions that exercise real dispatcher code:

- `summarizeExtensionContributionManifest` returns action, command, and deep-link entries and excludes Console contribution entries.
- URL-only deep links appear with `actionBacked: false`.
- `invokeEforgeExtensionContribution` with `kind: 'action'` posts the same effective action ID.
- Command invocation resolves the command action binding, merges defaults with caller input, and includes `requestedBy.commandId`.
- Deep-link invocation resolves the deep-link action binding, merges defaults with caller input, and includes `requestedBy.deepLinkId`.
- Caller input overrides binding defaults.
- Omitted `kind` with an ID present in multiple families throws the ambiguous-ID message and does not call the invoke helper.
- URL-only deep-link invocation throws the non-action-backed message and does not call the invoke helper.
- Unknown action, command, and deep-link IDs throw their deterministic messages.
- Non-object input values throw `"input" must be a JSON object`.
- A typed `{ ok: false }` action response returns as data rather than throwing.
- The dispatcher source contains no `/api/` literals and no `dispatchEforgeExtensionAction` import.

### Integration and Static Tests

Add `test/extension-contribution-host-surfaces.test.ts`:

- Import `createProgram` and assert the actual Commander program contains `extension contributions list` and `extension contributions invoke`.
- Read `packages/eforge/src/cli/extension-contributions.ts` and assert it references `listEforgeExtensionContributions`, `invokeEforgeExtensionContribution`, `--input-json <json>`, `--input-file <path>`, and no `/api/` literals.
- Read `packages/eforge/src/cli/mcp-extension-contributions.ts` and assert it registers `eforge_extension_contribution`, uses `createDaemonTool`, uses `McpUserError` for typed action failures, references `host: 'mcp'`, and contains no `/api/` literals.
- Read `packages/eforge/src/cli/mcp-proxy.ts` and assert it calls `registerExtensionContributionMcpTool(server, cwd)` after the `eforge_extension` block and before `eforge_models`.
- Read `packages/pi-eforge/extensions/eforge/extension-contributions.ts` and assert it registers `eforge_extension_contribution`, registers `eforge:extensions`, references `host: 'pi'`, uses `IfRunning` helpers, and does not contain `ensureDaemon`, `daemonRequest(`, or `/api/` literals.
- Read `packages/pi-eforge/extensions/eforge/index.ts` and assert it imports and calls both Pi registration helpers.
- Import `@eforge-build/client` and assert the host dispatcher exports are functions/constants.
- Assert `packages/client/src/index.ts` exports the host dispatcher module after the platform contribution helper exports.
- Assert `packages/client/src/api/extension-tool-dispatch.ts` does not mention `extensionContribution`, `integrationCommand`, `deepLink`, or `invokeEforgeExtensionContribution`.
- Assert `eforge-plugin/.claude-plugin/plugin.json` version is numerically greater than `0.25.44` when `eforge-plugin/skills/extend/extend.md` changes.
- Assert plugin and Pi extension-authoring skills both mention the new tool names after parity normalization.

Update `test/client-no-start-api-helpers.test.ts` if direct `IfRunning` dispatcher exports are used:

- `listEforgeExtensionContributionsIfRunning` returns `null` with no lockfile.
- `invokeEforgeExtensionContributionIfRunning` returns `null` with no lockfile.
- A live test server receives `GET API_ROUTES.extensionContributionManifest` for list and `POST API_ROUTES.extensionActionInvoke` for invoke through platform helpers, not through host route literals.

### Regression Tests

- Run `node scripts/check-skill-parity.mjs` through `pnpm test` and verify the modified extend skills stay in parity.
- Run existing extension-management CLI/MCP/Pi parity tests to confirm `eforge_extension` management behavior and `EFORGE_EXTENSION_ACTIONS` remain unchanged.
- Run session-plan/playbook MCP and Pi tests to confirm this module does not alter existing workflow tools.

## Downstream Handoff

`docs-examples-compat` documents the final host commands and tool names in public docs and generated references. It can cite the concrete names from this module:

- CLI: `eforge extension contributions list|invoke`.
- MCP/Claude: `eforge_extension_contribution`.
- Pi: `eforge_extension_contribution` and `/eforge:extensions`.

No downstream module imports host implementation helpers from CLI, MCP, or Pi packages. Public reuse lives in `@eforge-build/client` only.

## Verification

- [ ] `packages/client/src/api/extension-contribution-dispatch.ts` exports `EXTENSION_HOST_CONTRIBUTION_KINDS` with `action`, `command`, and `deep-link`.
- [ ] `listEforgeExtensionContributions` returns entries for manifest actions, integration commands, and deep links.
- [ ] `listEforgeExtensionContributions` omits Console contribution entries.
- [ ] URL-only deep-link entries have `actionBacked: false` in list output.
- [ ] Direct action invocation sends the requested effective action ID to the action invoke helper.
- [ ] Integration-command invocation resolves the command action binding to an effective action ID.
- [ ] Deep-link invocation resolves the deep-link action binding to an effective action ID.
- [ ] Command invocation adds the effective command ID to `requestedBy`.
- [ ] Deep-link invocation adds the effective deep-link ID to `requestedBy`.
- [ ] Binding input defaults merge with caller input and caller input wins on duplicate keys.
- [ ] Invoking a URL-only deep link throws `Deep link "<id>" is not action-backed` before any action invoke helper call.
- [ ] Ambiguous target IDs without `kind` throw an error that names `action`, `command`, and `deep-link`.
- [ ] Typed action failure responses return from the dispatcher as data with `response.ok === false`.
- [ ] `packages/client/src/api/extension-contribution-dispatch.ts` contains zero `/api/` literals.
- [ ] `packages/client/src/api/extension-contribution-dispatch.ts` does not import `./extension-tool-dispatch.js`.
- [ ] `@eforge-build/client` exports the host dispatcher helpers from `packages/client/src/index.ts`.
- [ ] The Commander program created by `createProgram(undefined, 'test')` contains `eforge extension contributions list`.
- [ ] The Commander program created by `createProgram(undefined, 'test')` contains `eforge extension contributions invoke`.
- [ ] CLI `list` command source references `listEforgeExtensionContributions` and contains zero `/api/` literals.
- [ ] CLI `invoke` command source references `invokeEforgeExtensionContribution`, `--input-json <json>`, and `--input-file <path>`.
- [ ] MCP source registers `eforge_extension_contribution` with actions `list` and `invoke`.
- [ ] MCP invocation uses `requestedBy.host` equal to `mcp`.
- [ ] MCP typed action failures return through `McpUserError`.
- [ ] MCP contribution source contains zero `/api/` literals.
- [ ] `packages/eforge/src/cli/mcp-proxy.ts` calls `registerExtensionContributionMcpTool(server, cwd)`.
- [ ] Pi source registers an `eforge_extension_contribution` tool.
- [ ] Pi source registers an `eforge:extensions` command.
- [ ] Pi invocation uses `requestedBy.host` equal to `pi`.
- [ ] Pi contribution source imports `IfRunning` helpers and contains zero `ensureDaemon` references.
- [ ] Pi contribution source contains zero `/api/` literals.
- [ ] `dispatchEforgeExtensionAction` and `EFORGE_EXTENSION_ACTIONS` remain unchanged by contribution invocation work.
- [ ] The Claude plugin extend skill mentions `mcp__eforge__eforge_extension_contribution`.
- [ ] The Pi extend skill mentions `eforge_extension_contribution`.
- [ ] `node scripts/check-skill-parity.mjs` exits 0.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` patch version is greater than `0.25.44`.
- [ ] `packages/pi-eforge/package.json` version remains unchanged.
- [ ] Existing session-plan MCP tool tests pass.
- [ ] Existing playbook MCP/Pi tool tests pass.
- [ ] `pnpm test -- test/extension-contribution-dispatch.test.ts test/extension-contribution-host-surfaces.test.ts test/client-no-start-api-helpers.test.ts test/extension-tooling-wiring-consumer-parity.test.ts test/extension-tooling-wiring-cli.test.ts test/profile-wiring-mcp-native.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
