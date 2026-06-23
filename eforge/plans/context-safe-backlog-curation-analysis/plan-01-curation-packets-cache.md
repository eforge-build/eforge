---
id: plan-01-curation-packets-cache
name: Backlog Curation Packets and Item Audit Cache
branch: context-safe-backlog-curation-analysis/plan-01-curation-packets-cache
agents:
  builder:
    effort: high
    rationale: Defines shared schemas, byte/count caps, canonical hashes, and
      durable cache behavior that all later plans depend on.
  reviewer:
    effort: high
    rationale: Shared package contracts and cache-key semantics require a careful
      compatibility review.
---

# Backlog Curation Packets and Item Audit Cache

## Architecture Context

`eforge/extensions/eforge-plan/backlog-curation-source.ts` currently assembles a single large JSON payload containing open records, dependency details, shipped evidence candidates, `gitDelta`, `fullImplementationAudit`, roadmap context, and recommendations. That payload is placed in `sourceText` by `backlog-curation-source-provider.ts`, then one planner receives it through the generic extension planning task path.

This plan creates the bounded data model that the map/reduce runner will consume later. It keeps the current legacy `sourceText` output available for compatibility until the daemon integration plan routes curation tasks away from the monolithic planner path.

## Implementation

### Overview

Add shared strict schemas for backlog-curation map/reduce artifacts, refactor source assembly to build a small global context plus one packet per open item, and add a durable per-item finding cache keyed by source, item, packet/body, prompt version, and runtime identity.

### Key Decisions

1. Put cross-package map/reduce artifact schemas in `@eforge-build/client` so the eforge-plan extension, engine agents, and monitor runner validate the same shapes instead of duplicating interfaces.
2. Keep raw full evidence out of the new reducer bundle. `gitDelta` and `fullImplementationAudit` may remain in preview metadata sidecars, but the new global context and reducer source carry summaries, counts, diagnostics, and compact per-item findings only.
3. Compute packet hashes from canonical JSON that excludes volatile timestamps and includes the item precondition/body hash plus bounded evidence fields. Cache keys include the packet hash and runtime identity so stale or model-specific findings never get reused silently.
4. Treat historical git/PR/lifecycle/session data as navigation hints in packet fields with `closureAuthority: false`; current-source citations remain the only closure authority for shipped/superseded proposals.

## Scope

### In Scope

- Shared TypeBox schemas and exported TypeScript types for global context, item packets, item findings, item outcomes, reducer input, runtime identity, and cap diagnostics.
- Item outcome schema variants for cache-hit, audited-finding, oversized-packet, item-agent-failure, invalid-finding, and cancelled outcomes, each carrying bounded diagnostics needed to explain reuse or degradation without raw packet evidence.
- Packet builders that create exactly one bounded packet or one bounded degraded outcome for each open backlog item.
- Deterministic packet hashes and cap diagnostics.
- Cache read/write helpers with atomic sidecar writes and schema/byte validation.
- Source-provider output that includes the structured bundle while preserving legacy `sourceText` until the daemon runner consumes the bundle.
- Unit tests for packet caps, unrelated body isolation, preconditions, stable hashes, and cache hit/miss dimensions.

### Out of Scope

- Invoking item audit agents.
- Running the final reducer.
- Changing backlog curation apply behavior.
- Changing workstation UI rendering.

## Files

### Create

- `packages/client/src/extension-agent-tasks/backlog-curation-map-reduce.ts` — shared constants, caps, schemas, and types for map/reduce source bundles, packets, findings, outcomes, reducer input, runtime identity, and diagnostics.
- `eforge/extensions/eforge-plan/backlog-curation-packets.ts` — deterministic builders for global context, per-item packets, packet hashes, byte/count cap validation, reducer input assembly helpers, and bounded degraded findings for oversized packets.
- `eforge/extensions/eforge-plan/backlog-curation-item-audit-cache.ts` — cache key construction, sidecar path resolution under eforge-plan project-local storage, schema-valid cache reads, byte-valid cache reads, and atomic writes.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts` — packet unit tests covering caps, hashes, preconditions, and unrelated item body isolation.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-item-audit-cache.test.ts` — cache tests covering every required key dimension.
- `packages/client/src/__tests__/extension-agent-task-curation-map-reduce.test.ts` — schema shape tests for valid and invalid packets, findings, outcomes, reducer input, and runtime identity.

### Modify

- `packages/client/src/extension-agent-tasks.ts` — export the new backlog-curation map/reduce schema module without changing existing planning-result or task-record shapes.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — factor source assembly so existing evidence collection feeds both legacy source text and the new structured bundle; continue writing preview metadata from the existing preview projections.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — return `{ sourceText, backlogCurationMapReduce }`, export cache helper hooks for the daemon runner, and keep current input parsing for `itemAuditConcurrency` and redraft context.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — add extension-local schema aliases only where workstation or action tests need to parse new provider-side diagnostics; do not duplicate the shared client schemas.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — update deferred source-provider assertions so legacy `sourceText` remains available and the structured bundle contains the same source fingerprint and item count.

## Implementation Details

- Add explicit cap constants for packet bytes, packet counts, citations per item, historical hints per item, diagnostics per packet, finding bytes, finding array counts, reducer input bytes, and repair error bytes.
- Count caps cover dependency facts, current-source citations, historical navigation hints, recommendation signals, diagnostics, validation errors, and reducer outcome lists.
- Packet builder inputs come from the existing open item snapshots, dependency projections, trace summaries, `fullImplementationAudit.preview/context` item summaries, source-first results, shipped evidence candidates, git-delta affected candidates, roadmap projection, and recommendation summaries.
- Per-item packets may include the target item title, metadata, full precondition, body hash, record hash, bounded section summaries for that item only, relevant dependency facts without dependency bodies, current-source citations for that item, historical navigation hints for that item, and cap diagnostics.
- Global context may include curation guidance, source fingerprint, generated timestamp, caps, diagnostics, roadmap summaries, recommendation summaries, dependency summaries, open item id summaries, and redraft summary. It must not include full raw `gitDelta`, full raw `fullImplementationAudit`, or full item bodies.
- Cache writes are skipped when source fingerprint, item id, packet hash, body hash, prompt version, or runtime/model identity is missing.
- Cache reads return a cache miss when the sidecar is missing, malformed, schema-invalid, byte-invalid, or keyed for a different runtime identity.

## Verification

- [ ] Packet tests assert every open item yields one packet or one degraded oversized-packet outcome.
- [ ] Packet tests assert each packet byte length is less than or equal to the exported packet cap.
- [ ] Packet tests assert packet dependency-fact, current-source citation, historical-hint, and diagnostic arrays are less than or equal to exported count caps.
- [ ] Packet tests assert packet hashes remain identical across two builds with unchanged backlog/source inputs.
- [ ] Packet tests assert each item packet includes `bodySha256`, `recordSha256`, `kind: "item"`, and the source fingerprint in its precondition.
- [ ] Packet tests assert a unique body string from item B is absent from item A's packet JSON.
- [ ] Cache tests assert source fingerprint, item id, packet hash, prompt version, and runtime/model identity changes each produce a miss after an initial hit.
- [ ] Client schema tests assert item outcome variants include cache-hit, audited-finding, oversized-packet, item-agent-failure, invalid-finding, and cancelled, and reject unknown outcome variants.
- [ ] Client schema tests reject packets, findings, outcomes, and reducer inputs with unknown top-level properties.
- [ ] Client schema tests assert finding byte length and citation, recommendation-signal, and diagnostic count caps are enforced.
- [ ] `pnpm --filter @eforge-build/client type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
