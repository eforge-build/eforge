---
id: base-sync-events-contract-cli
name: Base-sync event contract, CLI rendering, and import discipline
branch: direct-pr-base-sync-recovery-ux/base-sync-events-contract-cli
---

# Base-sync event contract, CLI rendering, and import discipline

Define base-sync progress event variants/types in the client-owned schema, emit them from the build path, render them through the command surface, and replace any local wire-shape declarations with imports from @eforge-build/client.

## Traceability

Criteria: ac-005, ac-007, ac-009
Aspects: ac-005:general:general, ac-007:interface:command-surface, ac-009:interface:schema, ac-009:interface:schema-contract, ac-009:subsystem:client, ac-009:subsystem:eforge-build, ac-009:subsystem:import, ac-009:subsystem:schema, ac-009:subsystem:use

## Validation

Author schema/runtime parse tests, event emission tests, CLI rendering tests, and import-discipline checks that prevent event wire-shape redeclarations.

## Fragment: Client event schema source of truth

Implement the documented invariant from `docs/hooks.md`: event types are the `EforgeEvent` discriminated union exported from `@eforge-build/client`, with schemas exposed through `packages/client/src/events.schemas.ts` and focused event modules under `packages/client/src/events/`. Inspect the referenced client source/tests before editing. If direct PR base-sync recovery UX requires new event variants, define their schema and exported type in the client package only. Keep the public client import surface stable and avoid introducing parallel Zod or hand-rolled event wire schemas.
## Fragment: Consumer shared-type import audit

Audit referenced eforge-build consumers and tests for locally declared event payload interfaces, event-schema facsimiles, or direct parser behavior that duplicates the client contract. Replace those with imports from `@eforge-build/client` and shared parse/type helpers while preserving existing event JSON. Extend/author contract tests or grep guards so future changes fail if event wire shapes are re-declared outside the client package. Sync existing docs such as `docs/hooks.md` only if the public contract wording changes.
## Fragment: Emit lifecycle events and render CLI progress

Add typed base-sync lifecycle visibility. Use the client-owned event contract from `@eforge-build/client` rather than local wire declarations. Emit events for start, conflict attempt N/M, resolver start, resolver complete, rebase continue, success, and exhausted budget. Update CLI output to render these events as active base-sync progress and resolver activity so the run does not look idle. Validate event typing/emission order and CLI display behavior.