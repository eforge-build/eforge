---
id: plan-01-extension-input-contracts
name: Extension Input and Enricher Contracts
branch: extend-11-runtime-input-transformers-and-prd-enrichers/plan-01-extension-input-contracts
agents:
  builder:
    effort: high
    rationale: Cross-package public API and wire-schema changes require consistent
      updates across SDK, engine extension registry, client event schemas, and
      tests.
  reviewer:
    effort: high
    rationale: Public SDK and event schema changes need API and test coverage review.
---

# Extension Input and Enricher Contracts

## Architecture Context

EXTEND_11 adds runtime input transformation before enqueue, but the engine must remain input-agnostic. This plan establishes public contracts and registry projection only. Runtime execution happens in the next plan in `@eforge-build/input` and CLI/daemon boundary code.

## Implementation

### Overview

Add typed SDK support for runtime input sources and PRD enrichers, add PRD enricher capture to the engine extension registry, and add client wire events for input-source and enricher provenance/diagnostics. Existing `registerInputSource({ fetch(id) })` extensions remain type-compatible because context is an additive second parameter and string returns remain valid.

### Key Decisions

1. Add `registerPrdEnricher(enricher)` separately from `registerInputSource(adapter)` so source fetching and content mutation have distinct lifecycle points.
2. Use deterministic registration order by preserving existing recorder/loader ordering for the new `prdEnrichers` family.
3. Add preprocessing events as session-scoped, non-persisted client event variants so worker sessions can show provenance without daemon-wide projection state.
4. Keep replay behavior non-executing for input sources and PRD enrichers; replay summaries include counts only.

## Scope

### In Scope

- SDK types: `InputTransformContext`, `InputSourceResult`, widened `InputSourceAdapter`, `PrdEnrichmentInput`, `PrdEnrichmentResult`, and `PrdEnricher`.
- `EforgeExtensionAPI.registerPrdEnricher(enricher)` and SDK barrel exports.
- Engine extension API shape, recorder validation, duplicate-name diagnostics, registry state/counts, projection totals, loader counts, replay summaries, and type exports for PRD enrichers.
- Client event schemas, event registry summaries, wire parity fixtures, and API version bump for:
  - `extension:input-source:fetched`
  - `extension:input-source:failed`
  - `extension:prd-enricher:applied`
  - `extension:prd-enricher:failed`
- Tests for SDK type compatibility, loader/projection counts, duplicate enricher names, replay summaries, event schema validation, and wire parity.

### Out of Scope

- Running adapters/enrichers during enqueue.
- Filesystem/path/source resolution logic.
- CLI or daemon enqueue behavior.
- Documentation and issue-tracker examples.

## Files

### Create

- None.

### Modify

- `packages/extension-sdk/src/context.ts` — add `InputTransformContext` with cwd, original source, source kind (`inline`, `file`, or `extension-reference`), optional source path, optional adapter/source id, and logger access.
- `packages/extension-sdk/src/hooks.ts` — widen `InputSourceAdapter`, add input-source/enricher result types, and define `PrdEnricher`.
- `packages/extension-sdk/src/api.ts` — add `registerPrdEnricher`; update `registerInputSource` remarks from deferred contract to runtime-supported contract language.
- `packages/extension-sdk/src/index.ts` — export the new context, result, and enricher types.
- `packages/engine/src/extensions/types.ts` — add `PrdEnricherSpec`, API shape method, registration type, registry arrays, and registration count fields.
- `packages/engine/src/extensions/recorder.ts` — validate `registerPrdEnricher({ name, description, enrich })`, record registrations, and reject duplicate names through existing named-registration diagnostics.
- `packages/engine/src/extensions/loader.ts` — initialize and diff `prdEnrichers` counts for loaded extension summaries.
- `packages/engine/src/extensions/projector.ts` — include `prdEnrichers` in totals and per-extension registration projections.
- `packages/engine/src/extensions/replay.ts` — include PRD enrichers in non-event registration summaries without executing them during replay.
- `packages/engine/src/extensions/index.ts` — export `PrdEnricherRegistration` and related public extension types.
- `packages/client/src/events.schemas.ts` — add the four preprocessing event variants. Include extension path/name, adapter/enricher name, source identifier, changed flag, content lengths, failure reason (`not-found`, `error`, `timeout`, or `invalid-result`), message, optional stack, and optional timeout.
- `packages/client/src/event-registry.ts` — add exhaustive registry metadata and human summaries for the new variants.
- `packages/client/src/api-version.ts` — bump `DAEMON_API_VERSION` by one and update the version comment for input-source/enricher provenance events.
- `packages/client/src/__tests__/events-schemas.test.ts` — add typed fixtures and negative cases for the new variants.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add representative valid payloads for each new variant.
- `test/extension-sdk-example.test.ts` — add compile-time examples for old one-argument input sources, context-aware input sources, object-return input sources, and PRD enrichers.
- `test/extension-loader.test.ts` — add loader/recorder coverage for valid enrichers, invalid enrichers, duplicate enricher names, and registration counts.
- `test/extension-replay.test.ts` — assert PRD enrichers are summarized but not executed during replay.
- `test/extension-tooling-routes.test.ts` — update extension list/show/test route assertions for `prdEnrichers` totals and summaries.
- `test/extension-cli-commands.test.ts` — update CLI extension list/show/test assertions for `prdEnrichers` totals and summaries.

## Verification

- [ ] `sdk.EforgeExtensionFactory` accepts an existing `registerInputSource({ fetch: async (id) => '...' })` extension without TypeScript errors.
- [ ] `sdk.EforgeExtensionFactory` accepts `registerPrdEnricher({ name, description, enrich })` and exposes `InputTransformContext` in handler signatures.
- [ ] Loading an extension with one input source and one PRD enricher yields registry counts `inputSources: 1` and `prdEnrichers: 1`.
- [ ] Duplicate PRD enricher names emit `extension:duplicate-registration` and keep the first registration.
- [ ] `eforge extension test` reports PRD enrichers in non-event registration summaries and does not invoke `enrich`.
- [ ] `safeParseEforgeEvent` accepts all four new event variants and rejects a PRD enricher applied event missing `enricherName`.
- [ ] `eventRegistry` contains entries for every new event variant and TypeScript exhaustive checking passes.
- [ ] `DAEMON_API_VERSION` increases by one and the comment names input-source/enricher provenance events.
