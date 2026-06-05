---
title: Split Client Event Schemas for Maintainability
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Split Client Event Schemas for Maintainability

## Problem / Motivation

`packages/client/src/events.schemas.ts` is a 2,797-line god-file over the maintainability threshold, with a no-growth ceiling in `scripts/agent-maintainability-baseline.json`.

Validated findings:

- Backlog source: `.backlog/items/backlog-2026-06-05-split-client-event-schemas-god-file-for-maintainability.md`.
- The largest regions in `events.schemas.ts` are `event-variants` at 1,430 lines, `supporting-schemas` at 636 lines, and `derived-types`/snapshots/parse helpers at 404 lines.
- `packages/client/src/event-registry.ts` is also large, but it imports public event types from `./events.js`; it does not require `events.schemas.ts` to stay monolithic.
- `docs/roadmap.md` aligns with this work under Integration & Maturity / Schema library unification on TypeBox because TypeBox is canonical for eforge-owned domain schemas.
- `packages/client/package.json` exposes `@eforge-build/client`, `@eforge-build/client/browser`, and `@eforge-build/client/events`; it does not expose `@eforge-build/client/events.schemas`.
- `packages/client/tsup.config.ts` builds `src/index.ts`, `src/browser.ts`, and `src/events.ts` as entrypoints.
- `packages/docs-gen/src/generators/events.ts` assumes `EforgeEventSchema` is an intersect containing a direct variants union with top-level `anyOf` entries.
- Direct `events.schemas.ts` imports found by search are internal to `packages/client/src` and client tests; non-client code uses public package entrypoints or engine facades.
- Planning classification: this is an **architecture / deep** change because it changes internal module boundaries for the client wire-protocol source while requiring strong public-contract preservation.
- Recommended profile: **Excursion**.
- Profile rationale: This is a cohesive internal refactor with a clear target package, stable public boundaries, and well-defined validation gates. It is too cross-cutting and contract-sensitive for an Errand, but it does not require delegated module planning or independently planned subsystem work, so Expedition would add unnecessary overhead.

## Goal

Refactor the client event wire-schema implementation for maintainability without changing the public contract. Preserve runtime wire shapes, TypeBox-derived TypeScript types, public exports, docs extraction behavior, and parse validation behavior.

## Approach

### Architecture impact

This is an internal module-boundary refactor inside `@eforge-build/client`; the public event contract must remain stable.

Confirmed architecture facts:

- `packages/client/package.json` exposes only `.`, `./browser`, and `./events`; there is no public `./events.schemas` subpath.
- `packages/client/tsup.config.ts` builds only `src/index.ts`, `src/browser.ts`, and `src/events.ts` as entrypoints.
- `packages/client/src/events.ts`, `packages/client/src/index.ts`, and `packages/client/src/browser.ts` are the public export surfaces that must remain compatible.
- `packages/docs-gen/src/generators/events.ts` imports `EforgeEventSchema` from `@eforge-build/client` and expects `EforgeEventSchema` to be a TypeBox `Intersect` whose `allOf` includes a variants `Union` with top-level `anyOf` entries.
- `packages/client/src/event-registry.ts` derives exhaustiveness from `EforgeEvent['type']` and exports `DAEMON_EVENT_TYPES` from registry metadata, not from schema modules.

Target architecture:

- `packages/client/src/events.schemas.ts` becomes a small facade that re-exports the public schema/type/helper symbols from focused internal modules.
- Internal modules under `packages/client/src/events/` own the implementation.
- Suggested implementation grouping:
  - `constants.ts` for `ORCHESTRATION_MODES`, `REVIEW_PERSPECTIVES`, severity order inputs if appropriate, and helper constants.
  - `shared/core.ts`, `shared/review.ts`, `shared/orchestration.ts`, `shared/recovery.ts`, and `shared/stack.ts` for supporting TypeBox schemas currently concentrated in the 636-line supporting-schemas region.
  - `decisions.ts` for `PlanningDecisionSchema`, `BuildDecisionSchema`, and related decision event fields.
  - `queue-events.ts` and `envelope.ts` for queue variants and the event envelope.
  - `variants/*.ts` files grouped by event family, each exporting a readonly tuple of TypeBox object/union schemas.
  - `variants.ts` to aggregate all variant tuples into one flat `EforgeEventVariantsSchema`.
  - `root.ts` to compose `EforgeEventSchema = Type.Intersect([EventEnvelopeSchema, EforgeEventVariantsSchema])` and derive public event types.
  - `snapshots.ts` for daemon/session stream snapshot schemas and snapshot types.
  - `parse.ts` for safe/throwing parse helpers.
  - `utilities.ts` for `isBuiltInReviewPerspective`, `SEVERITY_ORDER`, and `isAlwaysYieldedAgentEvent`.
- Keep internal imports acyclic.
- `event-validation.ts` should import `type EforgeEvent` from the new root/type module rather than from the facade if needed.
- Parse helpers can import validation functions.
- Keep grouped variant arrays flat at aggregation time.
- Do not aggregate `Type.Union([GroupAEventSchema, GroupBEventSchema])`, because docs generation and potentially TypeScript discriminant inference depend on top-level variant entries.

Public API impact:

- Public API should be unchanged.
- Consumers continue importing from `@eforge-build/client`, `@eforge-build/client/browser`, or `@eforge-build/client/events`.
- The emitted JSON schema and generated event documentation should not reflect wire-shape changes.
- Only provenance/wording may change.

### Code impact

Primary implementation targets:

- `packages/client/src/events.schemas.ts`: replace the current god-file implementation with a facade that exports the same public symbols and updates the header to describe the new module layout.
- `packages/client/src/events/`: add focused internal modules.
- Every new implementation file must stay at or below 600 lines.
- `packages/client/src/event-validation.ts`: adjust its type-only event import if needed to avoid depending on the facade from validation used by parse helpers.
- `packages/client/src/events.ts`: preserve its current public re-export list. Update comments only if they would otherwise remain misleading.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts`: preserve the current public export surface; update only if new internal modules change export source plumbing.
- `packages/docs-gen/src/generators/events.ts`: update source/provenance wording so docs no longer imply all variants live directly in `events.schemas.ts`, while preserving event extraction behavior.
- `scripts/agent-maintainability-baseline.json`: remove the `packages/client/src/events.schemas.ts` baseline entry if the facade is below the hard cap; keep `event-registry.ts` baseline unchanged.
- `packages/client/src/__tests__/...`: update relative imports only where necessary.
- Add or update tests that assert schema-shape invariants and public export compatibility.
- `AGENTS.md`: update the project policy that currently says every event shape lives in `packages/client/src/events.schemas.ts`.

Validated dependency facts:

- Direct `events.schemas.ts` imports found by `rg` are limited to `packages/client/src` and `packages/client/src/__tests__`.
- Non-client code uses `@eforge-build/client`, `@eforge-build/client/browser`, `@eforge-build/client/events`, or engine facades.
- There are two current `@eforge-build/client/events` imports in monitor code/tests; these use the public `./events` subpath and should continue to work unchanged.
- Broad public client imports are numerous, so preserving `index.ts`, `browser.ts`, and `events.ts` exports is more important than preserving internal file locations.

Existing tests to rely on:

- `packages/client/src/__tests__/events-schemas*.test.ts` families validate many event parse paths.
- `packages/client/src/__tests__/events-wire-parity*.test.ts` validate representative wire parity.
- `packages/client/src/__tests__/terminal-failure-event.test.ts` validates exported terminal failure schemas.
- `packages/client/src/__tests__/events-schemas-auto-build.test.ts` validates daemon snapshot parsing.
- Workspace type-checks cover `eventRegistry` exhaustiveness and downstream `Extract<EforgeEvent, ...>` usages.

### Design decisions

1. Preserve a facade rather than renaming the public source file.
   - Decision: Keep `packages/client/src/events.schemas.ts` as the compatibility facade.
   - Rationale: Client tests and comments directly reference it, and public exports already flow through `events.ts`, `index.ts`, and `browser.ts`.
   - Evidence: `packages/client/src/events.ts` re-exports from `./events.schemas.js`; package exports do not expose `./events.schemas`.

2. Aggregate variant modules into one flat TypeBox union.
   - Decision: Each event-family module exports readonly tuple(s) of variants, and `events/variants.ts` constructs a single flat `Type.Union([...allVariantTuples] as const)`.
   - Rationale: `docs-gen` extracts variants from `EforgeEventSchema.allOf[*].anyOf`; a union-of-unions would hide variants from the existing generator and could weaken discriminated union inference.
   - Evidence: `packages/docs-gen/src/generators/events.ts` explicitly searches `allOf` for an item with `anyOf` and reads each direct variant's `properties.type.const`.

3. Split supporting schemas by domain, not just line ranges.
   - Decision: Split the 636-line supporting region into cohesive modules such as core agent/review primitives, orchestration/plan state, recovery/failure summaries, auto-build/snapshots, and stack schemas.
   - Rationale: Domain splits reduce future merge conflicts and keep each new file under the project's 600-line implementation-file cap.
   - Evidence: maintainability baseline lists `events.schemas.ts` at 2,799 no-growth ceiling; project policy caps new implementation files at 600 lines.

4. Derive all public types from TypeBox schemas in the new root/snapshot modules.
   - Decision: Keep `Static<typeof ...>` derivations colocated with the schema being exported. Re-export those types through the facade.
   - Rationale: The existing contract is that runtime validators and TypeScript types stay in sync.
   - Evidence: `events.schemas.ts` header states `EforgeEvent` is derived from `EforgeEventSchema`; event-registry's compile-time exhaustiveness depends on that type.

5. Keep parse and semantic validation behavior unchanged.
   - Decision: Move `safeParseEforgeEvent`/`parseEforgeEvent` into `events/parse.ts` but keep the same call order: metadata bounds check, TypeBox parse, semantic validation.
   - Rationale: Changing validation order or error behavior would turn this refactor into a behavior change.
   - Evidence: current `safeParseEforgeEvent` checks `validateReviewIssueMetadataBoundsForEvent`, then `safeParseWithSchema(EforgeEventSchema, value)`, then `validateEforgeEventSemanticFields`.

6. Update policy wording to match the new architecture.
   - Decision: Replace stale instructions that say event shapes may not be defined outside `events.schemas.ts` with instructions that event shapes live only under `packages/client/src/events/` and must be aggregated into the exported `EforgeEventSchema` facade.
   - Rationale: Leaving stale instructions would cause future agents to undo or fight the refactor.
   - Evidence: `events.schemas.ts` header and `AGENTS.md` currently encode god-file policy.

7. Do not bump `DAEMON_API_VERSION` for a purely mechanical split.
   - Decision: Leave API version unchanged unless schema JSON or public request/response/event contracts change.
   - Rationale: The version is for daemon/client compatibility changes; this work is intentionally contract-preserving.
   - Validation: Use docs/schema drift checks and event parse tests to prove no contract change.

### Documentation impact

Documentation and policy text that may need updates:

- `packages/client/src/events.schemas.ts` header must stop saying every discriminant variant lives in that file.
- `packages/client/src/events.ts` comments should be updated if they still imply schemas are implemented directly in `events.schemas.ts` rather than exposed through its facade.
- `packages/docs-gen/src/generators/events.ts` generated prose and provenance currently cite `packages/client/src/events.schemas.ts` as the definition location; update to mention the public facade plus implementation modules under `packages/client/src/events/`.
- `AGENTS.md` contains project policy saying event types and schemas are co-located in `packages/client/src/events.schemas.ts`; update to the new module policy.
- Generated docs may change only in provenance/source wording if `pnpm docs:generate` is required by `pnpm docs:check`.
- Event protocol content should not change semantically.

Documentation validation path:

- Run a targeted `rg` after edits for stale phrases like `every discriminant variant lives here`, `Do not define event shapes in other files`, and references that imply `events.schemas.ts` is still the implementation god-file.
- Run `pnpm docs:check` to catch generated reference drift.

### Risks and mitigations

- Type inference degradation: If grouped schemas are composed as nested unions or arrays lose literal tuple typing, `Static<typeof EforgeEventSchema>` may stop narrowing correctly. Mitigate with `as const` tuple exports, one flat aggregate union, `pnpm type-check`, and a targeted test/fixture using `Extract<EforgeEvent, { type: 'plan:build:review:complete' }>`.
- Documentation generator drift: `docs-gen` currently extracts only direct variants from a top-level `anyOf`. Mitigate by preserving `Type.Intersect([EventEnvelopeSchema, EforgeEventVariantsSchema])` with direct variant entries.
- Wire-shape drift: Moving schemas may accidentally change TypeBox object optionality, unions, recursive IDs, or ordering. Mitigate with existing event schema tests, docs check, and a structural schema-shape test.
- Re-export omissions: Public consumers depend on exported schema constants and types. Mitigate by keeping `events.ts`, `index.ts`, and `browser.ts` export lists intact and running type-check/build.
- Circular imports: `safeParseEforgeEvent` needs semantic validators while `event-validation.ts` currently imports `type EforgeEvent` from the schema file. Mitigate by making type-only imports point to the new root/type module and keeping parse helpers separate from shared schema definitions.
- File-size regression: Splitting could create a new oversized module if supporting schemas or variants are moved wholesale. Mitigate by splitting by domain and running `pnpm maintainability:check`.
- Stale agent policy: If `AGENTS.md` still says variants belong in `events.schemas.ts`, future work may re-centralize schemas. Mitigate by updating policy wording as part of the same change.
- Test runtime cost: Full workspace tests may be expensive. Mitigate by requiring targeted client/schema tests plus type-check/docs/maintainability checks; broader `pnpm test` remains useful if runtime permits.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Public package consumers do not import `events.schemas.ts` directly. | `packages/client/package.json` exports only `.`, `./browser`, and `./events`; `rg` found direct `events.schemas` imports only in `packages/client/src`, client tests, and type-only validation/session-stream internals. | high | low | Re-run `rg "events.schemas" packages test eforge-plugin -g '!node_modules' -g '!dist'` after implementation. | If wrong, external consumers could break from moved internals; keeping `events.schemas.ts` as a facade mitigates this. |
| `docs-gen` depends on the current flat `EforgeEventSchema` shape. | Read `packages/docs-gen/src/generators/events.ts`; `extractVariants` searches `schema.allOf` for an item with `anyOf` and iterates direct entries. | high | low | Add/keep a schema-shape test and run `pnpm docs:check`. | Generated event docs could omit variants even when runtime validation works. |
| TypeScript narrowing can be preserved if variant arrays are readonly tuples and aggregated into one flat `Type.Union`. | Current `EforgeEvent` is derived from `Static<typeof EforgeEventSchema>`; event-registry and console code heavily use `Extract<EforgeEvent, { type: ... }>`; this is a TypeBox/TypeScript behavior assumption for the new composition style. | medium | low | Add a compile-time/client test using representative `Extract` payloads; run `pnpm --filter @eforge-build/client type-check` and workspace type-check if available. | Downstream handler code could lose type safety or fail to compile. |
| This can remain a no-wire-change refactor that does not require `DAEMON_API_VERSION` to change. | Scope explicitly preserves event and snapshot wire shapes; API version comments describe additive/breaking daemon/client contract changes rather than internal file layout. | high | low | Compare generated event schema/docs output; run schema tests and docs check. | Stale clients or daemons could disagree if a wire-shape change slips in without a version bump. |
| `events.schemas.ts` can be reduced below 600 lines while all new implementation files stay below 600 lines. | Current region counts show the file can be split by domain; largest regions are event variants (1,430), supporting schemas (636), and derived/snapshot/helpers (404). | high | low | Run `wc -l packages/client/src/events.schemas.ts packages/client/src/events/**/*.ts` and `pnpm maintainability:check`. | The maintainability goal would not be met and baseline cleanup would be premature. |
| Updating `eventRegistry.ts` is not required beyond import compatibility. | `eventRegistry.ts` imports from `./events.js`, not `events.schemas.ts`; its exhaustive check depends on `EforgeEvent['type']`, which remains publicly re-exported. | high | low | Run client type-check and event-registry tests. | Additional registry refactor work could expand scope and risk. |
| `safeParseEforgeEvent` behavior can be moved without changing validation order. | Read current parse helper: metadata bounds validation runs first, TypeBox parse second, semantic validation third. | high | low | Add/keep tests for invalid metadata and semantic action/policy fields; inspect parse helper after move. | Behavior or error diagnostics could change despite no intended wire-shape change. |

No low-confidence/high-impact assumptions remain unresolved. The medium-confidence TypeBox tuple/narrowing assumption has a low-cost validation path and is explicitly covered by acceptance criteria.

## Scope

In scope:

- Keep `packages/client/src/events.schemas.ts` as the compatibility/public facade for existing internal tests and public re-export paths.
- Move implementation details into focused modules under `packages/client/src/events/`, including shared schema groups, decision schemas, queue/envelope schemas, event variant groups, root schema composition, stream snapshot schemas, parse helpers, and event utilities.
- Preserve public exports through `@eforge-build/client`, `@eforge-build/client/browser`, and `@eforge-build/client/events`.
- Preserve the runtime wire shapes accepted by `safeParseEforgeEvent`, `safeParseDaemonStreamSnapshot`, and `safeParseSessionStreamSnapshot`.
- Preserve TypeScript derivation from TypeBox schemas, especially `EforgeEvent = Static<typeof EforgeEventSchema>` and `Extract<EforgeEvent, { type: ... }>` behavior used throughout the codebase.
- Update stale policy/provenance wording that says every event variant must live in `events.schemas.ts`.
- Update maintainability baseline if `events.schemas.ts` falls below the implementation-file threshold.

Out of scope:

- No event wire-shape additions, removals, or semantic validation changes.
- No `eventRegistry` decomposition unless a small import adjustment is required; it remains a separate future maintainability candidate.
- No daemon API version bump unless an unintended contract change is discovered and explicitly accepted.
- No changes to route wire contracts outside event snapshot schema imports/re-exports.

## Acceptance Criteria

- `packages/client/src/events.schemas.ts` is below 600 lines after the refactor.
- `scripts/agent-maintainability-baseline.json` no longer contains an entry for `packages/client/src/events.schemas.ts` when that file is below 600 lines.
- Every new implementation file under `packages/client/src/events/` is at or below 600 lines.
- `@eforge-build/client` continues to export the event types, schema constants, parse helpers, constants, and utilities that it exported before this refactor.
- `@eforge-build/client/browser` continues to export the event types, schema constants, parse helpers, constants, and utilities that it exported before this refactor.
- `@eforge-build/client/events` continues to export the event types, schema constants, parse helpers, constants, and utilities that it exported before this refactor.
- `EforgeEventSchema` remains a TypeBox intersect whose `allOf` contains the event envelope schema.
- `EforgeEventSchema` remains a TypeBox intersect whose `allOf` contains a direct variants schema with top-level `anyOf` entries.
- The event variants schema aggregation uses one flat union of variant object or nested same-discriminant union entries.
- The event variants schema aggregation does not use a union of event-family union schemas.
- A client test validates that representative `Extract<EforgeEvent, { type: ... }>` aliases still narrow to payloads with their expected required fields.
- A client test validates that `Extract<EforgeEvent, { type: 'plan:build:review:complete' }>` still narrows to a payload with its expected required fields.
- A client test validates that every `eventRegistry` key is present in the exported `EforgeEventSchema` variant discriminants.
- `safeParseEforgeEvent` performs review-issue metadata bounds validation before TypeBox parsing.
- `safeParseEforgeEvent` performs semantic field validation after TypeBox parsing.
- `rg "every discriminant variant lives here|Do not define event shapes in other files|Event types and schemas are co-located.*events.schemas" packages docs AGENTS.md` returns no stale god-file policy wording after the text updates.
- `pnpm --filter @eforge-build/client type-check` exits 0.
- `pnpm docs:check` exits 0.
- `pnpm maintainability:check` exits 0.
- The targeted client event schema tests matching `packages/client/src/__tests__/events-schemas*.test.ts` exit 0.
- The targeted client event wire parity tests matching `packages/client/src/__tests__/events-wire-parity*.test.ts` exit 0.
- The targeted client terminal failure event test at `packages/client/src/__tests__/terminal-failure-event.test.ts` exits 0.