---
id: plan-01-client-host-output
name: Shared Client Host Output and Extension Management Projections
branch: harden-host-boundary-output-caps/plan-01-client-host-output
agents:
  builder:
    effort: high
    rationale: Defines shared host-boundary rendering and compact projection APIs
      that downstream MCP and Pi plans depend on.
  reviewer:
    effort: high
    rationale: Shared client APIs need careful compatibility review before host
      integrations consume them.
---

# Shared Client Host Output and Extension Management Projections

## Architecture Context

`@eforge-build/client` owns shared daemon wire types, route constants, and host-safe formatting used by consumer integrations. Existing contribution formatting in `packages/client/src/extension-contribution-output-formatting.ts` already caps contribution text, but MCP/Pi default JSON rendering and extension-management responses lack a common guardrail. This plan adds the shared foundation only; MCP and Pi integration changes happen in dependent plans.

Keep full daemon/CLI raw JSON shapes available for explicit human/debug inspection. The shared helpers are for agent-facing host boundaries and compact projections.

## Implementation

### Overview

Add pure client helpers for bounded host output and compact extension-management projections. Reuse the existing contribution formatter semantics where possible, keep the documented budget in one exported constant, and add behavioral tests that assert rendered output length.

### Key Decisions

1. Use `HOST_OUTPUT_CHAR_BUDGET = 12_000` as the single shared host-output budget constant. Keep the current contribution formatter's implicit 12k budget value to minimize behavior churn.
2. Make small JSON render as parseable pretty JSON with no warnings so existing small MCP response behavior remains compatible.
3. For oversized values, include raw character length, a truncation/summarization indicator, and guidance for narrower queries or explicit raw CLI/HTTP inspection.
4. Compact extension-management projections summarize `ExtensionEntry` detail arrays and giant schemas instead of preserving them by default.

## Scope

### In Scope

- Shared host output renderer for unknown JSON, strings, arrays, objects, and `Error` instances.
- Exported host-output budget constant and metadata/detail helper for Pi results.
- Compact projection helpers for `ExtensionEntry` and `eforge_extension` action responses: `list`, `show`, `validate`, `reload`, `test`, `package`, `new`, `trust`, `untrust`, `install`, `update`, `remove`, `promote`, and `demote`.
- Contribution formatter default budget updated to use the shared constant.
- Unit tests for huge objects, arrays, strings, errors, small JSON, compact extension projections, and contribution formatter budget behavior.

### Out of Scope

- MCP tool factory integration.
- Pi `jsonResult` integration.
- Changing raw daemon route shapes or CLI `--json` output.
- Adding new daemon query parameters unless later implementation proves host-side projection still constructs pathological payloads that must be avoided before HTTP serialization.

## Files

### Create

- `packages/client/src/host-output.ts` — shared `HOST_OUTPUT_CHAR_BUDGET`, JSON/text host renderer, final cap helper, raw-size/truncation metadata, continuation/debug guidance, and `Error` normalization.
- `packages/client/src/extension-management-output.ts` — compact projection helpers for extension-management responses and action envelopes.
- `packages/client/src/__tests__/host-output.test.ts` — behavioral tests for huge object/array/string/error rendering and small JSON compatibility.
- `packages/client/src/__tests__/extension-management-output.test.ts` — synthetic giant extension tests for compact list/show/validate/reload/test/package projections.

### Modify

- `packages/client/src/extension-contribution-output-formatting.ts` — replace the private default budget with `HOST_OUTPUT_CHAR_BUDGET`; share final cap/guidance helpers where useful while preserving existing semantic summary behavior.
- `packages/client/src/index.ts` — export host-output and extension-management projection helpers from `@eforge-build/client`.
- `packages/client/src/__tests__/extension-contribution-output-formatting.test.ts` — assert default/list/show/debug-rich contribution output stays within `HOST_OUTPUT_CHAR_BUDGET` and still reports raw size plus guidance when capped.

## Verification

- [ ] `HOST_OUTPUT_CHAR_BUDGET` is exported from `@eforge-build/client` and equals `12_000`.
- [ ] Huge object, array, string, and `Error` fixtures render with `text.length <= HOST_OUTPUT_CHAR_BUDGET`.
- [ ] Oversized renders include raw character length, a truncation or summary marker, and continuation/debug guidance.
- [ ] A small JSON object renders as parseable pretty JSON and contains no truncation warning.
- [ ] Compact extension projections omit giant schema/detail arrays and include identity, status, trust, path, scope, source, registration counts, diagnostic counts, sample diagnostics, and `nextSteps`.
- [ ] Synthetic giant extension list/show/validate/reload/test/package projection renders stay within `HOST_OUTPUT_CHAR_BUDGET` when passed through the shared renderer.
- [ ] Existing extension contribution formatter tests pass after switching to the shared budget constant.
