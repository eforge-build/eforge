---
title: Harden Host-Boundary Output Caps
created: 2026-06-25
---

# Harden Host-Boundary Output Caps

## Problem / Motivation

Agent-facing extension host tools can still inject very large payloads into model context. A trusted `eforge extension reload --json` response was observed at about 20.8 MB, and equivalent MCP/Pi tool paths can currently stringify arbitrary daemon responses or include full `details`, leading to context compaction churn or provider input-size errors.

The codebase has partial bounded formatting, but no universal host-boundary guardrail:

- `packages/client/src/extension-contribution-output-formatting.ts` already provides semantic summaries and a final character budget for extension-contribution output.
- `packages/eforge/src/cli/mcp-extension-contributions.ts` uses the bounded contribution formatter.
- `packages/eforge/src/cli/mcp-tool-factory.ts` still formats default success and `McpUserError` responses with raw `JSON.stringify`.
- `packages/pi-eforge/extensions/eforge/index.ts` has a shared `jsonResult` helper that returns uncapped text and raw `details`.
- `packages/monitor/src/routes/extensions/discovery-service.ts` still builds rich extension-management responses containing detail arrays, diagnostics, and contribution metadata that are appropriate for management/debug surfaces but too large for default agent context.

## Goal

Establish hard platform-level output caps at agent-facing host boundaries by default while preserving explicit debug/raw inspection paths for humans. Target MCP default tool formatting, Pi `jsonResult`, `eforge_extension` management responses, and remaining extension-contribution debug-rich paths using shared host-safe rendering/projection helpers in `@eforge-build/client`.

## Approach

- Add shared host-safe rendering utilities in `@eforge-build/client`, likely near existing extension-contribution output formatting or in a general host-output module.
- The shared helper should stringify or summarize unknown JSON, apply a final hard character cap, report raw size and truncation, and include continuation guidance.
- Use a single shared budget constant for MCP/Pi host output and document the exact value during implementation.
- Add compact projection helpers for extension-management responses, including `ExtensionEntry`, `list`, `show`, `validate`, `reload`, `test`, and `package` actions as applicable.
- Compact projections should keep identity, status, trust, path/scope/source, registration counts, diagnostic counts, sample summaries, and next-step guidance.
- Compact projections should omit or summarize giant schemas and detail arrays by default.
- Update `packages/eforge/src/cli/mcp-tool-factory.ts` so default success formatting and `McpUserError` formatting use the shared bounded renderer unless a tool supplies an explicit formatter.
- Update `packages/pi-eforge/extensions/eforge/index.ts` so `jsonResult` uses the same budget for `content.text`.
- Avoid returning uncapped Pi `details` for large payloads by returning compact details metadata or projections instead.
- Update MCP and Pi `eforge_extension` paths to return compact projections by default.
- If raw/full detail is retained, make it opt-in and clearly non-default for agent-facing calls.
- Re-check extension-contribution `list`, `show`, and `invoke` debug-rich paths so all formatted host output has pagination or hard caps even when schemas, diagnostics, or action outputs are huge.
- Keep `eforge-plugin/` and `packages/pi-eforge/` user-facing guidance in sync if tool descriptions, raw/debug options, or documented budgets change.
- Bump the Claude Code plugin version if plugin files change.
- Prefer shared client helpers and typed route helpers to avoid duplicating client-owned wire-shape logic in monitor routes.
- Only add daemon options when necessary to avoid constructing pathological payloads.
- Treat Pi `details` as part of the host boundary so raw `details` cannot bypass capped `content.text`.
- Include behavioral tests that measure actual output size, not only static wiring-string checks.
- Use the existing bounded contribution formatter as precedent.
- Use synthetic giant-extension regression tests for MCP and Pi outputs under budget.

## Scope

In scope:

- MCP default tool success formatting.
- MCP `McpUserError` formatting.
- Pi `jsonResult` `content.text`.
- Pi `jsonResult` `details`.
- MCP `eforge_extension` management responses.
- Pi `eforge_extension` management responses.
- Extension-management actions including `list`, `reload`, `validate`, `show`, and `test`/`package` as applicable.
- Extension-contribution `list`, `show`, and `invoke` paths.
- Debug-rich options, giant input schemas, diagnostics, contribution metadata, and action output at agent-facing host boundaries.
- Shared host-safe rendering and projection helpers in `@eforge-build/client`.
- Regression tests using synthetic giant extensions.

Out of scope:

- Removing rich daemon discovery data entirely.
- Removing human/debug inspection paths entirely.
- Changing full daemon response shapes that remain available internally.
- Returning full detail by default in agent-facing MCP or Pi paths.
- Raw/full detail behavior except behind explicit non-default debug/raw routes or options.

## Acceptance Criteria

- A single shared host-output budget constant is used by MCP and Pi default host-boundary renderers.
- The shared host-output budget value is documented.
- MCP default success responses with oversized payloads return host text no longer than the documented budget.
- MCP `McpUserError` responses with oversized payloads return host text no longer than the documented budget.
- Pi `jsonResult` responses with oversized payloads return `content.text` no longer than the documented budget.
- Truncated or summarized host output includes raw size metadata.
- Truncated or summarized host output includes a truncation indicator.
- Truncated or summarized host output includes continuation or debug guidance.
- `packages/eforge/src/cli/mcp-tool-factory.ts` default success formatting uses the shared bounded/summarized renderer unless a tool supplies an explicit formatter.
- `packages/eforge/src/cli/mcp-tool-factory.ts` `McpUserError` formatting uses the shared bounded/summarized renderer.
- `packages/eforge/src/cli/mcp-tool-factory.ts` no longer uses raw `JSON.stringify(data, null, 2)` for large default success responses.
- `packages/eforge/src/cli/mcp-tool-factory.ts` no longer uses raw `JSON.stringify` for large `McpUserError` responses.
- `packages/pi-eforge/extensions/eforge/index.ts` `jsonResult` applies the shared budget to `content.text`.
- `packages/pi-eforge/extensions/eforge/index.ts` `jsonResult` does not return oversized raw `details`.
- Large Pi `details` are omitted, compacted, or replaced with bounded metadata/projection.
- MCP `eforge_extension list` returns a compact projection by default.
- MCP `eforge_extension reload` returns a compact projection by default.
- MCP `eforge_extension validate` returns a compact projection by default.
- MCP `eforge_extension show` returns a compact projection by default.
- Pi `eforge_extension list` returns a compact projection by default.
- Pi `eforge_extension reload` returns a compact projection by default.
- Pi `eforge_extension validate` returns a compact projection by default.
- Pi `eforge_extension show` returns a compact projection by default.
- Default `eforge_extension` compact projections preserve identity, status, trust, path/scope/source, registration counts, diagnostic counts, sample summaries, and next-step guidance where those fields apply.
- Default `eforge_extension` compact projections omit or summarize giant schemas, detail arrays, diagnostics, and contribution metadata instead of returning full rich arrays.
- Full `eforge_extension` detail is available only through an explicit non-default debug/raw path if retained.
- Extension contribution `list` output remains bounded with debug-rich options, giant input schemas, and diagnostics.
- Extension contribution `show` output remains bounded with debug-rich options, giant input schemas, and diagnostics.
- Extension contribution `invoke` output remains bounded with debug-rich options and giant action output.
- Extension contribution `list`, `show`, and `invoke` host output uses pagination or hard caps when schemas, diagnostics, or action outputs are huge.
- Shared renderer unit tests construct huge objects and assert output stays within the documented budget.
- Shared renderer unit tests construct huge arrays and assert output stays within the documented budget.
- Shared renderer unit tests construct huge strings and assert output stays within the documented budget.
- Shared renderer unit tests construct errors and assert output stays within the documented budget.
- Shared renderer unit tests construct already-small JSON and assert it is not unnecessarily truncated.
- MCP factory tests prove default success outputs are capped and contain continuation guidance.
- MCP factory tests prove `McpUserError` outputs are capped and contain continuation guidance.
- Pi tests prove `jsonResult` caps `content.text`.
- Pi tests prove `jsonResult` does not expose giant `details`.
- Extension-management tests construct a giant extension with giant schemas, diagnostics, and action metadata and assert `list` compact projections stay within the documented budget.
- Extension-management tests construct a giant extension with giant schemas, diagnostics, and action metadata and assert `reload` compact projections stay within the documented budget.
- Extension-management tests construct a giant extension with giant schemas, diagnostics, and action metadata and assert `validate` compact projections stay within the documented budget.
- Extension-management tests construct a giant extension with giant schemas, diagnostics, and action metadata and assert `show` compact projections stay within the documented budget.
- Synthetic giant-extension regression tests assert MCP tool responses stay below the documented budget and include truncation/continuation guidance.
- Synthetic giant-extension regression tests assert Pi tool responses stay below the documented budget and include truncation/continuation guidance.
- Contribution host/Pi tests cover debug-rich `list` payloads and assert output stays within the documented budget.
- Contribution host/Pi tests cover debug-rich `show` payloads and assert output stays within the documented budget.
- Contribution host/Pi tests cover debug-rich `invoke` payloads and assert output stays within the documented budget.
- Existing extension contribution formatter behavior tests pass.
- Existing consumer parity tests pass.
- If tool descriptions, raw/debug options, or documented budgets change, `eforge-plugin/` and `packages/pi-eforge/` user-facing guidance are updated consistently.
- If any file under `eforge-plugin/` changes, `eforge-plugin/.claude-plugin/plugin.json` has a bumped plugin version.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Use or create a synthetic extension with giant schemas, diagnostics, and contribution/action output.

1. Exercise extension management through MCP `eforge_extension` actions such as `list`, `reload`, `validate`, and `show`.
2. Exercise the same management actions through the Pi `eforge_extension` tool.
3. Exercise extension contribution `list`, `show`, and `invoke` paths, including debug-rich or schema-heavy options.
4. Observe that current gaps can produce uncapped JSON/text because MCP `createDaemonTool` defaults to `JSON.stringify(data, null, 2)`, Pi `jsonResult` returns uncapped `content.text` and `details`, and extension-management discovery responses can include rich detail arrays.
5. After the fix, repeat those calls and assert every agent-facing response stays under the documented budget and includes truncation/continuation guidance.