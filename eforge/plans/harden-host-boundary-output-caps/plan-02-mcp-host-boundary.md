---
id: plan-02-mcp-host-boundary
name: MCP Host-Boundary Caps and Compact Extension Management
branch: harden-host-boundary-output-caps/plan-02-mcp-host-boundary
agents:
  builder:
    effort: high
    rationale: Touches the MCP factory plus a large proxy file; default behavior
      must remain compatible for small JSON while capping oversized payloads.
  reviewer:
    effort: high
    rationale: MCP is an agent-facing boundary where raw error/details leakage needs
      careful review.
---

# MCP Host-Boundary Caps and Compact Extension Management

## Architecture Context

The MCP proxy is a coding-agent host boundary. `createDaemonTool` currently uses raw `JSON.stringify(data, null, 2)` for default success responses and `McpUserError` data. `eforge_extension` currently returns daemon extension-management data directly, including schemas, diagnostics, and contribution detail arrays. This plan consumes the shared client helpers from plan-01 to cap MCP default output and return compact extension-management projections.

`packages/eforge/src/cli/mcp-proxy.ts` is over 1,000 lines; use bounded exact edits around the `eforge_extension` registration and imports.

## Implementation

### Overview

Route all MCP default success and user-error text through the shared host renderer, keep explicit custom `formatResponse` overrides honored, and compact `eforge_extension` data before it reaches MCP response formatting. Also cap contribution invoke/list/show text after any MCP-specific header is added.

### Key Decisions

1. Keep `formatResponse` as an escape hatch for tools that already provide bounded semantic text; the factory default only applies when no formatter is supplied.
2. Keep small default MCP JSON parseable so existing tests and consumers that parse small tool output keep working.
3. Compact `eforge_extension` inside the handler before returning data, so the default factory renderer becomes a second hard cap.
4. Keep raw/full extension-management data out of MCP by default; explicit human/debug inspection remains through CLI `--json` or daemon/client HTTP surfaces.

## Scope

### In Scope

- MCP default success output cap using the shared host renderer.
- MCP `McpUserError` output cap using the shared host renderer.
- Removal of raw default-success and user-error `JSON.stringify(data, null, 2)` paths from `mcp-tool-factory.ts`.
- `eforge_extension` MCP action responses compacted by default via the shared client projection helper.
- Behavioral MCP `eforge_extension` giant-extension tests for list/show/validate/reload/test/package outputs staying under the shared budget.
- MCP contribution list/show/invoke response text capped after headers and debug-rich summaries.
- MCP tests for huge success payloads, huge `McpUserError` payloads, continuation guidance, and small JSON compatibility.

### Out of Scope

- Pi tool integration.
- Raw CLI `eforge extension ... --json` behavior.
- Changing daemon extension route response shapes.
- Adding a raw/full MCP option unless implementation explicitly keeps it non-default and still prevents uncapped text/details.

## Files

### Create

- None expected. Add new tests to existing MCP test files unless a focused new test file reduces size.

### Modify

- `packages/eforge/src/cli/mcp-tool-factory.ts` — import shared host-output helpers; use them for default success and `McpUserError`; keep `formatResourceJson` parseable via a shared stringify helper instead of inlining the raw pattern.
- `packages/eforge/src/cli/mcp-proxy.ts` — import the compact extension-management projection helper; return compact `eforge_extension` action data; update the tool description to state compact host-safe output by default.
- `packages/eforge/src/cli/mcp-extension-contributions.ts` — cap final formatted text for list/show/invoke after MCP-specific headers and fallback formatting.
- `test/mcp-tool-factory.test.ts` — update factory tests for bounded huge success/error output and unchanged parseable small JSON.
- `test/extension-tooling-wiring-consumer-parity.test.ts` — update the MCP `eforge_extension` wiring assertion to require the compact projection helper and add behavioral assertions for synthetic giant-extension list/show/validate/reload/test/package MCP outputs; leave Pi assertions for plan-03.
- `test/extension-contribution-host-surfaces.test.ts` — add or update MCP contribution host-boundary assertions for the shared cap and no raw route literals.

## Verification

- [ ] MCP factory default success output from a huge object has `text.length <= HOST_OUTPUT_CHAR_BUDGET` and includes raw length plus continuation guidance.
- [ ] MCP factory `McpUserError` output from a huge payload has `text.length <= HOST_OUTPUT_CHAR_BUDGET` and includes raw length plus continuation guidance.
- [ ] Small MCP default success output remains parseable JSON with the original fields.
- [ ] Small MCP `McpUserError` output remains parseable JSON with `isError: true`.
- [ ] `packages/eforge/src/cli/mcp-tool-factory.ts` has no default success or `McpUserError` branch using raw `JSON.stringify(data, null, 2)`.
- [ ] MCP `eforge_extension` handler returns compact extension-management action data by default.
- [ ] MCP `eforge_extension` list/show/validate/reload/test/package outputs from synthetic giant extension data have `text.length <= HOST_OUTPUT_CHAR_BUDGET` and include continuation/debug guidance when capped.
- [ ] MCP contribution list/show/invoke text from giant schemas or debug-rich action output stays within `HOST_OUTPUT_CHAR_BUDGET` after headers.
