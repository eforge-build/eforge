---
id: plan-01-shared-contribution-projection
name: Shared Contribution Projection and Formatting
branch: agent-first-backlog-discovery-and-session-plan-auto-creation/plan-01-shared-contribution-projection
agents:
  builder:
    effort: high
    rationale: This plan introduces shared projection and formatting contracts that
      multiple host integrations will depend on; careful API shape and
      compatibility handling are required.
---

# Shared Contribution Projection and Formatting

## Architecture Context

Extension contribution manifest and invocation contracts remain daemon/client-owned in `@eforge-build/client`. The daemon route can continue returning the rich manifest for Console and debugging, while coding-agent hosts consume shared client projections that omit schemas and diagnostics unless requested. Host wrappers must not shape manifests independently.

## Implementation

### Overview

Add compact-by-default contribution list projection, a focused single-contribution detail path, host-safe list/detail formatting, and a small failed-invocation envelope in shared client code.

### Key Decisions

1. Keep the raw daemon manifest route unchanged; add projection options in `packages/client/src/api/extension-contribution-dispatch.ts` so rich UI consumers are not forced through compact agent projections.
2. Make compact projection omit `inputSchema` and full diagnostics by default, while preserving identity, availability summary, side effects, output profile, action binding, and small input metadata.
3. Add explicit full/detail switches (`includeInputSchema`, `includeDiagnostics`, or `projection: 'full'`) instead of relying on broad list calls for debugging.
4. Format contribution list/detail responses through shared client helpers so MCP, Pi, and CLI do not duplicate summarization policy.
5. Summarize failed invocation inputs by keys/count/serialized size and never include `target.input` in coding-host error envelopes.

## Scope

### In Scope

- Compact and full projection options for `summarizeExtensionContributionManifest`.
- Filters for kind, extension name, search text, id prefix, output profile, limit, and offset.
- A single-contribution detail/show helper that can include schema and diagnostics on demand.
- Shared host-safe text formatters for list/detail responses.
- Shared failed invocation envelope helper.
- Client tests for projection, filtering, pagination, detail mode, diagnostics, and failure envelopes.

### Out of Scope

- Daemon route changes or API version changes.
- Console System or Workstation raw manifest rendering changes.
- Host wrapper CLI/MCP/Pi option wiring; that is handled in `plan-02-host-contribution-surfaces`.
- eforge-plan backlog action projection controls; that is handled in `plan-03-backlog-query-projections`.

## Files

### Create

- None expected.

### Modify

- `packages/client/src/api/extension-contribution-dispatch.ts` — Add projection/filter/pagination option types, compact entry shaping, detail resolution, and failed invocation envelope helper.
- `packages/client/src/extension-contribution-output-formatting.ts` — Add shared list/detail text formatting and, if useful, reusable JSON summary helpers for failed invocation details.
- `packages/client/src/browser.ts` — Export any new browser-safe formatting helpers and types added to `extension-contribution-output-formatting.ts`.
- `test/extension-contribution-dispatch.test.ts` — Cover compact defaults, full/detail modes, filters, pagination, and failure envelope input elision.
- `test/extension-contribution-client-helpers.test.ts` — Update helper expectations for compact projection and detail output.
- `packages/client/src/__tests__/extension-contribution-output-formatting.test.ts` — Cover budgeted contribution list/detail formatting and failure-envelope formatting.

## Implementation Notes

- Keep `ExtensionHostContributionKind` unchanged.
- Extend list options without inlining daemon route literals or importing daemon request helpers into dispatch code.
- A compact entry must retain at least `kind`, `id`, `label`, `extensionName`, `extensionPath`, `actionId`, `actionBacked`, `sideEffects`, `outputProfile`, and availability state/message when present.
- Represent input shape in compact mode with small metadata such as `hasInputSchema`, `requiredInputKeys`, `inputPropertyKeys`, and `inputDefaultKeys`; do not include the full `inputSchema` unless requested.
- Preserve command-specific input schema precedence in full/detail mode.
- For diagnostics, include `diagnosticCount` in compact responses and include full `diagnostics` only when requested.
- `show`/detail resolution must accept an explicit `kind` or infer it using the existing ambiguity checks.

## Verification

- [ ] `summarizeExtensionContributionManifest(manifest()).entries` omits `inputSchema` when no include flag is passed.
- [ ] `summarizeExtensionContributionManifest(manifest()).diagnostics` is `undefined` when no include flag is passed and `diagnosticCount` equals the manifest diagnostic count.
- [ ] Detail projection for one contribution includes `inputSchema` when `includeInputSchema: true` is passed.
- [ ] Detail projection includes diagnostics when `includeDiagnostics: true` is passed.
- [ ] List filters return only matching entries for `kind`, `extensionName`, `search`, `idPrefix`, and `outputProfile`.
- [ ] `limit` and `offset` produce deterministic `entries`, `total`, `returned`, and continuation metadata.
- [ ] Failed invocation envelope includes target kind/id/action id and error code/message.
- [ ] Failed invocation envelope includes input key names and serialized input size.
- [ ] Failed invocation envelope text does not contain a large raw input string value from the request.
- [ ] Client source still contains no `/api/` literals and no extension-management dispatch imports in contribution dispatch code.