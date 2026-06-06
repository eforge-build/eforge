---
id: plan-01-pi-extension-contribution-ux
name: Pi Extension Contribution Invocation UX
branch: improve-pi-eforge-extensions-contribution-invocation-ux/plan-01-pi-extension-contribution-ux
---

# Pi Extension Contribution Invocation UX

## Architecture Context

The native Pi `/eforge:extensions` command is a host integration layer over shared `@eforge-build/client` contribution helpers. The engine stays headless, Pi continues to use non-autostarting `*IfRunning` helpers, and the passive `eforge_extension_contribution` tool keeps returning machine-readable JSON. Existing Pi info panels already render Markdown through `showInfoPanel`, so result rendering can improve without adding a new TUI component.

Shared host contribution summaries are produced in `packages/client/src/api/extension-contribution-dispatch.ts`. That projection already exposes `inputSchema` for actions and command-specific schemas, plus `inputDefaults` for command and deep-link action bindings. It needs a bound-action schema fallback for action-backed deep links and commands without a host-specific schema so Pi can generate input templates from the same list response it already consumes.

## Implementation

### Overview

Implement a lightweight schema-aware JSON input helper for Pi contribution invocation, wire it into the interactive command path, format invocation results as Markdown-panel content, and extend the shared client projection so action-backed host entries expose a usable input schema when the manifest can derive one from the bound action.

### Key Decisions

1. Use JSON templates, not a full form renderer. The invocation API accepts object input, and the requested UX fix is satisfied by skipping unnecessary prompts plus seeding the editor with a schema-shaped object when input is missing.
2. Prompt only when required fields are missing from the effective defaults. For command and deep-link entries, `inputDefaults` count toward required-field satisfaction; the no-prompt invocation can pass `{}` because the shared client resolver still merges defaults into the effective action input.
3. Preserve command-specific `inputSchema` precedence. Only fall back to the bound action `inputSchema` when the command has no `inputSchema`, and always use the bound action schema for action-backed deep links because deep links have no host-specific schema field.
4. Treat daemon validation as authoritative. Placeholders help users see shape; if a placeholder value remains invalid for a richer schema constraint, the daemon action invocation failure remains the final validation path.
5. Render successful `{ markdown: string }` outputs as Markdown content, and render all other JSON outputs in fenced `json` blocks inside the existing Markdown info panel.

### Implementation Steps

1. Create `packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts` with Pi-free pure helpers. Keep the file under 300 lines if possible; if it grows past 300 lines, add balanced durable `// --- eforge:region <slug> ---` markers.
2. Export helper functions along these lines:
   - `requiredFields(schema: unknown): string[]` from JSON Schema/TypeBox `required`.
   - `schemaInputTemplate(entry: ExtensionHostContributionEntry): Record<string, unknown>` that starts from `entry.inputDefaults`, adds missing required fields, and uses schema-shaped placeholders.
   - `canInvokeWithoutPrompt(entry: ExtensionHostContributionEntry): boolean` that returns true when every required field is present in `entry.inputDefaults` or the schema has no required fields.
   - `prepareContributionInput(entry: ExtensionHostContributionEntry)` returning either a no-prompt `{ input: {} }` decision or an editor decision with title, missing required names, and JSON prefill text.
   - `formatInvocationPanel(result: ExtensionHostContributionInvokeResult)` returning `{ title, content }` for `showInfoPanel`.
3. Placeholder behavior in the helper:
   - Use `entry.inputDefaults[field]` first when the key exists.
   - Use a JSON-safe schema `default` when present for a required field.
   - For enums, use an existing default first, then the first enum value. Support `enum` arrays and, if small, TypeBox-style `anyOf`/`oneOf` literal lists.
   - Use `""` for strings, `0` for numbers and integers, `false` for booleans, `[]` for arrays, `{}` for objects, and `null` for unknown/complex required properties.
   - Keep required properties present even when the property schema is absent from `properties`.
   - Do not insert JSON comments into the editor prefill.
4. Update `packages/pi-eforge/extensions/eforge/extension-contributions.ts`:
   - Replace the unconditional `ctx.ui.editor('eforge extensions - JSON input', '{}')` path in `runInteractiveFlow` with the helper decision.
   - For no-prompt decisions, invoke immediately without opening the editor.
   - For prompt decisions, use a title containing the selected contribution kind and id, and append missing required field names when available.
   - Preserve `parseInvokeArgs`, `parseJsonObject`, and direct `/eforge:extensions invoke <id> [json]` input parsing behavior.
   - Preserve URL-only deep-link warning behavior.
   - Continue using `listEforgeExtensionContributionsIfRunning` and `invokeEforgeExtensionContributionIfRunning` only.
   - Use `formatInvocationPanel` for invocation result panels.
5. Update `packages/client/src/api/extension-contribution-dispatch.ts`:
   - Build an action lookup in `summarizeExtensionContributionManifest`.
   - Pass the lookup into command and deep-link entry projection helpers.
   - For commands, set `inputSchema` to `entry.inputSchema ?? boundAction.inputSchema`.
   - For action-backed deep links, set `inputSchema` to the bound action schema when the bound action is found.
   - Leave URL-only deep links without an `inputSchema` fallback.
   - Do not bump `DAEMON_API_VERSION`; this is an optional-field projection enhancement, not a daemon route contract change.
6. Leave the passive `eforge_extension_contribution` tool result shape unchanged. It must still return `JSON.stringify(data, null, 2)` text for agent consumption.
7. Do not modify `packages/pi-eforge/package.json`. Do not modify Claude Code plugin files unless an unexpected dependency is discovered; no plugin version bump is part of this plan.

## Scope

### In Scope

- Schema-aware input decisions for interactive Pi `/eforge:extensions` invocation.
- Skipping the editor for no-input actions and default-satisfied command/deep-link entries.
- JSON editor prefill templates for missing required input.
- Contribution-specific editor titles that include kind and id.
- Markdown rendering for exact `{ markdown: string }` success output.
- Fenced JSON rendering for non-Markdown success output and failure details.
- Shared client summary fallback from action-backed commands/deep links to bound action input schemas.
- Focused tests for pure Pi helper behavior, shared client projection, and Pi source-discipline constraints.

### Out of Scope

- A full dynamic JSON Schema form UI.
- Daemon action invocation route changes.
- Engine runtime behavior changes.
- Extension SDK contract changes.
- Console contribution rendering changes.
- Passive Pi tool JSON result changes.
- URL-only deep-link invocation support.
- Pi package version changes.
- Claude Code plugin changes.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts` — Pi-free schema/template and invocation-panel formatting helpers.
- `test/pi-extension-contribution-ux.test.ts` — unit tests for no-prompt decisions, template placeholders, Markdown output formatting, generic JSON formatting, and failure formatting.

### Modify

- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` — wire the helper into interactive invocation and result display while preserving direct-argument and passive-tool behavior.
- `packages/client/src/api/extension-contribution-dispatch.ts` — add bound action schema fallback projection for host entries.
- `test/extension-contribution-dispatch.test.ts` — verify deep-link schema fallback, command fallback, command-specific schema precedence, and command default projection.
- `test/extension-contribution-host-surfaces.test.ts` — extend Pi source-discipline checks to cover the new helper file and keep no-autostart/no-route-literal constraints.

## Test Guidance

- In `test/pi-extension-contribution-ux.test.ts`, craft `ExtensionHostContributionEntry` objects directly; do not mock daemon or Pi SDK calls.
- Cover a `Type.Object({})` action entry and assert no-prompt input.
- Cover a command/deep-link entry with required schema fields satisfied by `inputDefaults` and assert no-prompt input.
- Cover missing required string, number, integer, boolean, array, object, enum, and unknown/complex properties and assert placeholder values.
- Cover enum schema default precedence and first-enum fallback.
- Cover exact Markdown output detection with an object whose only key is `markdown`.
- Cover object and array non-Markdown outputs and assert fenced `json` blocks.
- Cover failure output with `code`, `message`, and `details` present.
- In `test/extension-contribution-dispatch.test.ts`, use distinguishable schemas so command-specific schema precedence can be asserted by value equality.

## Verification

- [ ] Selecting a no-input action entry in the helper returns a no-prompt decision with `{}` input.
- [ ] Selecting a default-satisfied command entry in the helper returns a no-prompt decision with `{}` input.
- [ ] Selecting a default-satisfied action-backed deep-link entry in the helper returns a no-prompt decision with `{}` input.
- [ ] Selecting an entry with missing required fields in the helper returns an editor decision with all missing required field names in the JSON template.
- [ ] The editor decision title contains the selected contribution kind and id.
- [ ] The template contains `inputDefaults` values when they exist.
- [ ] Placeholder tests cover string, number, integer, boolean, array, object, enum, and unknown/complex required fields.
- [ ] Exact `{ markdown: string }` success output content contains the markdown string without JSON braces or escaped newline sequences.
- [ ] Non-Markdown object and array success outputs contain fenced `json` blocks.
- [ ] Failure output content contains the error code, message, and fenced details when details exist.
- [ ] Action-backed deep-link summary entries expose the bound action input schema.
- [ ] Commands with no command-specific schema expose the bound action input schema.
- [ ] Commands with command-specific schema keep that schema instead of the bound action schema.
- [ ] Command summary entries keep `inputDefaults` from the action binding.
- [ ] `packages/pi-eforge/extensions/eforge/extension-contributions.ts` no longer contains the unconditional `ctx.ui.editor('eforge extensions - JSON input', '{}')` call.
- [ ] Direct `/eforge:extensions invoke <id> [json]` parsing remains handled by `parseInvokeArgs` and does not open the interactive editor.
- [ ] The passive `eforge_extension_contribution` tool still returns JSON text through `jsonResult`.
- [ ] Pi contribution files contain no `/api/` route literals, no `daemonRequest(` calls, and no `ensureDaemon` calls.
- [ ] `packages/pi-eforge/package.json` version remains `0.7.21`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test -- extension-contribution` exits 0.
