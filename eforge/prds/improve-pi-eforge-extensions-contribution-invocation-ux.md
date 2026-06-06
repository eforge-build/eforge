---
title: Improve Pi /eforge:extensions Contribution Invocation UX
created: 2026-06-06
landing: pr
landing_auto_merge: true
---

# Improve Pi /eforge:extensions Contribution Invocation UX

## Problem / Motivation

Backlog item `.backlog/items/backlog-2026-06-06-improve-pi-eforge-extensions-contribution-invocation-ux.md` records a real UX failure: selecting `eforge-plan:render-board-markdown` from `/eforge:extensions` opened a generic JSON editor seeded with `{}` even though the action takes no required input, then rendered `{ markdown: ... }` as escaped JSON instead of readable Markdown.

The native Pi `/eforge:extensions` command makes extension-provided actions, commands, and action-backed deep links harder to use than necessary.

Confirmed current behavior from `packages/pi-eforge/extensions/eforge/extension-contributions.ts`:

- The interactive flow always opens `ctx.ui.editor('eforge extensions - JSON input', '{}')` after selecting an invokable contribution, even when the selected action has `Type.Object({})` input and no user input is needed.
- The editor title does not identify the selected contribution, required fields, defaults, or expected input shape.
- Successful invocation output is rendered through `JSON.stringify(result.response.output, null, 2)`, so Markdown output like `{ markdown: '# Summary\n...' }` appears as raw escaped JSON instead of readable Markdown.

User impact:

- No-input contributions add an unnecessary and unexplained interaction step.
- Required-input contributions do not give enough schema guidance for users to prepare valid JSON.
- Markdown-producing contributions, including `eforge-plan:render-board-markdown`, are hard to read in the Pi panel despite the Pi extension already having a Markdown-capable info panel helper.

Roadmap alignment:

- This fits `docs/roadmap.md` under Extension Platform and Console Observability/Control.
- It improves host-facing extension invocation UX while keeping the engine headless and reusing client/daemon contribution primitives.
- It supports the Extension Platform goal by improving host discovery/invocation usability.
- It respects engine boundary discipline by keeping this in the Pi host integration and shared client projection rather than adding engine workflow UX.

Classification: feature / focused, confidence high. This is a user-facing Pi integration UX feature with bounded code impact and no engine behavior change.

Relevant code evidence:

- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` owns the native Pi `/eforge:extensions` command and `eforge_extension_contribution` tool.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` currently always calls `ctx.ui.editor('eforge extensions - JSON input', '{}')` before invocation in the interactive path.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` currently formats successful output with `JSON.stringify(result.response.output, null, 2)`.
- `packages/pi-eforge/extensions/eforge/ui-helpers.ts` already renders info panels with `@earendil-works/pi-tui` `Markdown`, so Markdown result rendering can reuse the existing panel path rather than building a new renderer.
- `packages/client/src/api/extension-contribution-dispatch.ts` projects host entries with `inputSchema` for actions and integration commands and `inputDefaults` for commands/deep links.
- `packages/client/src/api/extension-contribution-dispatch.ts` does not currently attach the bound action schema to action-backed deep links, so schema-aware Pi templates for deep links need either a client projection enhancement or an explicit fallback.
- `packages/client/src/extension-contributions.ts` defines object-root TypeBox wire schemas for action and command input.
- Required fields are discoverable from JSON Schema/TypeBox `required` plus `properties`.
- `packages/console-ui/src/views/system/extension-contribution-rendering.ts` already contains precedent for inspecting contribution schemas, required fields, defaults, scalar types, enums, and JSON fallback when rendering Console action forms.
- `examples/extensions/action-contribution.ts` demonstrates required string input (`message`), optional boolean input, input defaults, command binding, and action-backed deep link binding.
- `packages/extension-sdk/README.md` documents no-input Markdown-producing actions (`Type.Object({})` with output `{ markdown: string }`) as a normal extension pattern.
- Pi docs confirm `ctx.ui.editor(title, prefilledText)` is a generic multi-line editor.
- Pi docs confirm `ctx.ui.custom()` plus `Markdown` are available for richer TUI components.
- Existing eforge helper panels already use `ctx.ui.custom()` and `Markdown`.

## Goal

Improve the native Pi `/eforge:extensions` interactive invocation flow so no-input or default-satisfied contributions invoke without an unexplained JSON editor, required-input contributions receive a schema-aware JSON template, and `{ markdown: string }` outputs render as readable Markdown.

Keep the engine headless, preserve machine-readable tool behavior, reuse existing client/daemon contribution primitives, and avoid daemon action-runtime or SDK contract changes.

## Approach

Use a lightweight schema-aware JSON template instead of a full dynamic form.

Rationale:

- The backlog asks for avoiding an unexplained raw JSON editor and generating templates for required fields.
- The backlog does not ask for a comprehensive form renderer.
- Pi TUI supports custom components, but a full JSON Schema form would be larger and riskier than this UX fix.

Skip the editor when all required fields are satisfied by `{}` plus available `inputDefaults`.

Rationale:

- This directly fixes the observed no-input `render-board-markdown` friction.
- This also covers default-backed command and deep-link invocations.

When the editor is needed, prefill a JSON object skeleton containing defaults and required fields.

Rationale:

- The invocation API requires object input.
- Current direct-args behavior already accepts JSON objects.
- A template preserves that contract while making required fields visible.

Template placeholders should be conservative and schema-shaped.

Suggested placeholder mapping:

- Strings use an empty string or descriptive placeholder string.
- Numbers use `0`.
- Integers use `0`.
- Booleans use `false`.
- Arrays use `[]`.
- Objects use `{}`.
- Enums use the first enum value or an existing default.
- Unknown or complex schemas use `null` or `{}` with the property still present.

Rationale:

- Templates should show shape without pretending to know semantic values.
- If a placeholder remains invalid, daemon input validation will fail safely.

Prefer contribution-specific input schema over bound action schema for integration commands.

Rationale:

- `IntegrationCommandManifestEntry.inputSchema` is a host-facing contract and may intentionally differ from the action input schema.

Use the bound action input schema as fallback for action-backed deep links and commands that have no host-specific schema.

Rationale:

- The current host summary omits deep-link schemas.
- The manifest has bound `actionId`.
- Actions have input schemas.
- This can be resolved cheaply in the client projection without a daemon API change.

Render `{ markdown: string }` successful output as Markdown, with invocation metadata kept above it.

Rationale:

- `showInfoPanel` already renders Markdown.
- The SDK README documents `{ markdown }` output as a normal action shape.

Render non-Markdown JSON output as fenced JSON in the Markdown panel rather than raw `JSON.stringify` text.

Rationale:

- This preserves machine-readable structure while making strings, `null`, objects, and arrays more readable in a Markdown-rendered panel.

Keep the passive native tool returning JSON.

Rationale:

- `eforge_extension_contribution` is agent/tool-facing and should remain machine-readable.
- The UX problem is in the native interactive command panel.

Primary implementation targets:

- Update `packages/pi-eforge/extensions/eforge/extension-contributions.ts`.
- Replace unconditional editor opening in `runInteractiveFlow` with input-preparation logic based on the selected `ExtensionHostContributionEntry`.
- Pass the selected entry or prepared display metadata into invocation formatting so output panels can use the selected label, kind, and id.
- Keep direct `/eforge:extensions invoke <id> [json]` parsing behavior unchanged because explicit JSON is already user-supplied.

Recommended helper extraction:

- Add a small helper module such as `packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts`.
- Export pure functions for `requiredFields(schema)`, `schemaInputTemplate(entry)`, `canInvokeWithoutPrompt(entry)`, and `formatInvocationPanel(result)` or equivalent.
- Keep the helper under the new-file 600-line policy.
- If the helper approaches 300 lines, add balanced `// --- eforge:region <slug> ---` / `// --- eforge:endregion <slug> ---` markers per project policy.
- Avoid importing from `packages/console-ui`; Console helpers are good precedent but not a stable package boundary for Pi.

Possible shared-client target:

- Update `packages/client/src/api/extension-contribution-dispatch.ts`.
- Add a manifest action lookup inside `summarizeExtensionContributionManifest` so command entries without their own `inputSchema` and action-backed deep-link entries can expose the bound action `inputSchema` when available.
- Preserve command-specific `inputSchema` precedence over action schema because a command may intentionally expose a host-specific input contract.

Likely tests:

- Add a focused test file such as `test/pi-extension-contribution-ux.test.ts` for pure Pi helper behavior.
- Extend `test/extension-contribution-dispatch.test.ts` to verify summary entries expose schema for action-backed deep links.
- Extend `test/extension-contribution-dispatch.test.ts` to verify command schema/default behavior is preserved.
- Keep or extend `test/extension-contribution-host-surfaces.test.ts` source-discipline checks so Pi code still uses `@eforge-build/client`.
- Keep or extend `test/extension-contribution-host-surfaces.test.ts` source-discipline checks so Pi code does not call daemon routes directly.
- Keep or extend `test/extension-contribution-host-surfaces.test.ts` source-discipline checks so Pi code does not autostart the daemon from the native command.

Existing constraints to preserve:

- Do not inline `/api/...` literals in Pi code.
- Do not use daemon request helpers directly from Pi.
- Keep using `listEforgeExtensionContributionsIfRunning`.
- Keep using `invokeEforgeExtensionContributionIfRunning`.
- Do not bump `packages/pi-eforge/package.json`; existing tests assert its publish-time version remains unchanged.
- No plugin version bump is needed unless the Claude Code plugin files are changed.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The problematic raw editor and raw output are in Pi `/eforge:extensions`, not daemon action execution. | Read `packages/pi-eforge/extensions/eforge/extension-contributions.ts`; it unconditionally calls `ctx.ui.editor(..., '{}')` and formats success with `JSON.stringify`. | high | low | Add tests around Pi helper decisions and manually run `/eforge:extensions` after implementation if desired. | If wrong, implementation could miss another call path, but direct code inspection confirms the interactive path. |
| Existing Pi panel rendering can display Markdown without new TUI infrastructure. | Read `packages/pi-eforge/extensions/eforge/ui-helpers.ts`; `showInfoPanel` wraps content in `Markdown`. Pi docs also document `Markdown` and `ctx.ui.custom()`. | high | low | Exercise a Markdown output helper unit test and optionally manual Pi panel verification. | If wrong, Markdown formatting would still appear as text, but no daemon behavior would be affected. |
| Required input fields can be inferred from object-root TypeBox/JSON Schema `required` and `properties`. | Read `packages/client/src/extension-contributions.ts`; action and command input schemas are object-root TypeBox wire schemas. Read Console helper code that already uses `required` and `properties`. | high | low | Unit-test schemas with required/optional/default scalar fields and enum fields. | If wrong for uncommon schemas, fallback editor still accepts JSON and daemon validation remains authoritative. |
| Action-backed deep links do not currently expose a schema in host summary entries. | Read `packages/client/src/api/extension-contribution-dispatch.ts`; `deepLinkEntry` sets defaults/action metadata but not input schema. | high | low | Extend summary projection tests before relying on deep-link templates. | If not addressed, deep-link templates may be less helpful, but action/direct and command cases still improve. |
| Direct `/eforge:extensions invoke <id> [json]` should not open an editor or be reformatted before invocation. | Read `parseInvokeArgs` and `invokeFromArgs`; explicit JSON args are already parsed and passed directly. | high | low | Regression-test parsing or preserve existing tests/source checks. | Changing this path could break script-like command use. |
| A full form UI is not required for this backlog item. | Backlog claim asks for avoiding editor when possible and schema-aware templates, not field widgets. Pi docs show custom form UI is possible but heavier. | medium | medium | Ask user for explicit form requirement or defer a separate backlog item after this improvement. | If the user expected a full form, this plan delivers a smaller but still meaningful UX improvement. |

Assumption review:

- All high-impact assumptions were validated by source inspection.
- The only medium-confidence assumption is scope preference for templates over a full form.
- The impact of the medium-confidence assumption is limited because the proposed implementation does not block future form work.

Recommended profile: **Excursion**.

Profile rationale:

- This is a bounded user-facing feature that likely touches the Pi command implementation, a small Pi helper module, shared client contribution projection, and focused tests.
- A single cohesive plan can cover the schema-template logic, output formatting, client projection fallback, and regression tests without delegated subsystem planning.
- It is more than an Errand because it affects UX and shared client projection.
- It does not require Expedition-level architecture planning.

## Scope

In scope:

- Improve the native Pi `/eforge:extensions` interactive invocation flow in `packages/pi-eforge/extensions/eforge/extension-contributions.ts`.
- Skip the JSON editor entirely when the selected contribution can be invoked with defaults and no missing required fields.
- Generate a schema-aware JSON template when user input is required, using TypeBox/JSON Schema object `properties`, `required`, and contribution `inputDefaults` where available.
- Make the editor title or pre-editor content identify the selected contribution and missing required fields when the editor is needed.
- Render successful output shaped as `{ markdown: string }` as Markdown content in the existing `showInfoPanel` Markdown renderer instead of escaped JSON.
- Render generic JSON output in a more readable Markdown panel, preferably fenced JSON after invocation metadata.
- Preserve existing direct argument behavior for `/eforge:extensions invoke <id> [json]`.
- Preserve the passive `eforge_extension_contribution` tool behavior.
- Add focused tests for the pure schema-template decisions.
- Add focused tests for the pure output-formatting decisions.
- Add focused tests for client host contribution projection if the deep-link schema fallback is added.

Out of scope:

- Building a full multi-field form UI for all JSON Schema features.
- Changing daemon action invocation routes.
- Changing engine action runtime behavior.
- Changing extension SDK contracts for action schemas.
- Changing extension SDK contracts for command schemas.
- Changing extension SDK contracts for deep-link schemas.
- Changing extension SDK contracts for output schemas.
- Changing Console contribution/action-form behavior.
- Changing Claude MCP tool behavior.
- Supporting non-action-backed URL-only deep-link invocation; the current warning remains correct.

## Acceptance Criteria

- Selecting an action contribution with `inputSchema: Type.Object({})` from interactive `/eforge:extensions` invokes the action without opening `ctx.ui.editor`.
- Selecting a command contribution whose required input fields are fully provided by `inputDefaults` invokes the command without opening `ctx.ui.editor`.
- Selecting an action-backed deep-link contribution whose required input fields are fully provided by `inputDefaults` invokes the deep link without opening `ctx.ui.editor`.
- Selecting an action contribution with missing required input opens a JSON editor prefilled with a JSON object containing every missing required field from the contribution input schema.
- Selecting a command contribution with missing required input opens a JSON editor prefilled with a JSON object containing every missing required field from the contribution input schema.
- The JSON editor title includes the selected contribution kind when input is required.
- The JSON editor title includes the selected contribution id when input is required.
- Immediate pre-editor content includes the selected contribution kind when input is required if the selected contribution kind is not included in the editor title.
- Immediate pre-editor content includes the selected contribution id when input is required if the selected contribution id is not included in the editor title.
- A generated JSON input template includes available `inputDefaults`.
- A generated JSON input template includes required fields discovered from JSON Schema/TypeBox `required`.
- A generated JSON input template includes fields discovered from JSON Schema/TypeBox `properties`.
- A generated JSON input template uses an existing default for an enum field when one is available.
- A generated JSON input template uses the first enum value for an enum field when no default is available.
- A generated JSON input template uses an empty string or descriptive placeholder string for a string field when no default is available.
- A generated JSON input template uses `0` for a number field when no default is available.
- A generated JSON input template uses `0` for an integer field when no default is available.
- A generated JSON input template uses `false` for a boolean field when no default is available.
- A generated JSON input template uses `[]` for an array field when no default is available.
- A generated JSON input template uses `{}` for an object field when no default is available.
- A generated JSON input template keeps an unknown or complex required property present when no default is available.
- Action-backed deep-link summary entries expose a usable input schema when their bound action has an input schema and the deep link has no more specific input schema.
- Command summary entries use the command-specific `inputSchema` when one is present, even when the bound action has a different input schema.
- A successful invocation output exactly shaped as `{ "markdown": string }` renders the markdown string in the Pi info panel content.
- A successful invocation output exactly shaped as `{ "markdown": string }` does not render JSON braces in the Pi info panel content.
- A successful invocation output exactly shaped as `{ "markdown": string }` does not render escaped newline sequences in the Pi info panel content.
- A successful invocation output that is not exactly `{ "markdown": string }` renders in Markdown-panel content.
- A successful invocation output that is not exactly `{ "markdown": string }` and is an object includes fenced JSON in the Markdown-panel content.
- A successful invocation output that is not exactly `{ "markdown": string }` and is an array includes fenced JSON in the Markdown-panel content.
- Failed invocation responses continue to show the error code.
- Failed invocation responses continue to show the error message.
- Failed invocation responses continue to show details when details are present.
- Direct `/eforge:extensions invoke <id> <json>` still parses the supplied JSON object.
- Direct `/eforge:extensions invoke <id> <json>` invokes without opening the interactive editor.
- The passive `eforge_extension_contribution` native tool still returns JSON text suitable for agent consumption.
- Pi extension contribution code continues to avoid direct daemon route literals.
- Pi extension contribution code continues to avoid direct daemon request calls.
- Pi extension contribution code continues to use `listEforgeExtensionContributionsIfRunning`.
- Pi extension contribution code continues to use `invokeEforgeExtensionContributionIfRunning`.
- The native Pi `/eforge:extensions` command does not autostart the daemon.
- `packages/pi-eforge/package.json` version remains unchanged.
- No Claude Code plugin version bump is made unless Claude Code plugin files are changed.
- A focused test verifies pure Pi helper behavior for no-input object schemas.
- A focused test verifies pure Pi helper behavior for default-satisfied required inputs.
- A focused test verifies pure Pi helper behavior for missing required input fields.
- A focused test verifies pure Pi helper behavior for Markdown output formatting.
- A focused test verifies pure Pi helper behavior for generic JSON output formatting.
- `test/extension-contribution-dispatch.test.ts` verifies summary entries expose schema for action-backed deep links when the shared-client deep-link schema fallback is added.
- `test/extension-contribution-dispatch.test.ts` verifies command schema behavior is preserved when the shared-client projection is changed.
- `test/extension-contribution-dispatch.test.ts` verifies command default behavior is preserved when the shared-client projection is changed.
- `pnpm test -- extension-contribution` exits 0.
- `pnpm type-check` exits 0.

## Manual Verification Notes

- After implementation, manually run `/eforge:extensions` if desired to verify the interactive path.
- After implementation, manually select `eforge-plan:render-board-markdown` from `/eforge:extensions` if desired to verify that it invokes without an unnecessary JSON editor and displays readable Markdown.
- Optionally perform manual Pi panel verification for Markdown output rendering.
- Ask the user for an explicit full-form requirement or defer a separate backlog item after this improvement if a full form UI is expected.