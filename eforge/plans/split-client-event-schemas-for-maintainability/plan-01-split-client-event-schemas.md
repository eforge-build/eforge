---
id: plan-01-split-client-event-schemas
name: Split Client Event Schemas
branch: split-client-event-schemas-for-maintainability/plan-01-split-client-event-schemas
agents:
  builder:
    effort: high
    rationale: Large contract-preserving TypeBox refactor with many internal module
      boundaries and strict public export preservation.
  reviewer:
    effort: high
    rationale: Review must check schema shape, public exports, parse order, and
      generated-doc extraction assumptions.
  tester:
    effort: high
    rationale: Validation spans TypeScript narrowing, TypeBox runtime parsing, docs
      drift, and file-size gates.
---

# Split Client Event Schemas

## Architecture Context

`packages/client/src/events.schemas.ts` is currently a 2,797-line implementation file and is listed in `scripts/agent-maintainability-baseline.json` with a no-growth ceiling. It is not a public package subpath; public consumers import event symbols through `@eforge-build/client`, `@eforge-build/client/browser`, and `@eforge-build/client/events`.

This plan is a contract-preserving internal module-boundary refactor inside `@eforge-build/client`. The runtime wire protocol, TypeBox-derived TypeScript types, parse validation behavior, public exports, generated JSON schema, and event documentation extraction shape must remain stable.

Key constraints:

- `EforgeEvent` must remain derived from `EforgeEventSchema` via `Static<typeof EforgeEventSchema>`.
- `EforgeEventSchema` must remain `Type.Intersect([EventEnvelopeSchema, EforgeEventVariantsSchema])` or an equivalent TypeBox intersect with those two direct `allOf` entries.
- `EforgeEventVariantsSchema` must be one flat TypeBox union of variant entries. Do not aggregate pre-built family unions such as `Type.Union([BuildEventsSchema, DaemonEventsSchema])`.
- Same-discriminant nested union entries that already exist may remain nested entries inside the flat union.
- `safeParseEforgeEvent` must keep the current validation order: review-issue metadata bounds check, TypeBox parse, semantic validation.
- No event wire-shape additions, removals, or daemon API version bump are in scope.
- All new implementation files must be at or below 600 lines.

## Implementation

### Overview

Replace `packages/client/src/events.schemas.ts` with a small compatibility facade and move implementation into focused modules under `packages/client/src/events/`. Preserve the existing public export lists in `events.ts`, `index.ts`, and `browser.ts`; update only comments that would otherwise describe the old god-file architecture.

### Key Decisions

1. Keep `events.schemas.ts` as the compatibility facade.
   - Rationale: client tests and public barrel modules already import from it internally, while package exports do not expose it as a public subpath.
2. Export variant-family arrays, then aggregate them into one flat `Type.Union([...])` in `packages/client/src/events/variants.ts`.
   - Rationale: `packages/docs-gen/src/generators/events.ts` extracts variants from a direct `anyOf` under the root intersect.
3. Split support schemas by domain rather than by line number.
   - Rationale: domain modules reduce future edit conflicts and keep new files below 600 lines.
4. Move parse helpers into a parse module, but keep semantic validators in `event-validation.ts`.
   - Rationale: parse behavior remains unchanged while avoiding a facade import cycle.
5. Update policy and generated-doc provenance text in the same change.
   - Rationale: stale instructions saying every variant belongs in `events.schemas.ts` would conflict with the new architecture.

### Suggested module layout

Create these files under `packages/client/src/events/` unless an equivalent grouping keeps every file below 600 lines and preserves acyclic imports:

- `constants.ts` — `ORCHESTRATION_MODES`, `REVIEW_PERSPECTIVES`, and literal helper inputs.
- `shared/review.ts` — review perspectives, review issue/test issue schemas, evaluation outcomes, acceptance-criteria schemas, severity-related types.
- `shared/core.ts` — agent roles, results, clarification/result primitives, JSON-safe metadata support shared outside review if not kept in `shared/review.ts`.
- `shared/orchestration.ts` — shard/build-stage/review-profile/pipeline/plan/orchestration/state schemas and build-resume artifact schemas.
- `shared/recovery.ts` — staleness/recovery verdicts, terminal failure schemas, build failure summary schemas.
- `shared/stack.ts` — stack provider/layer/landing schemas and stack-sync wire type aliases/interfaces.
- `shared/auto-build.ts` — auto-build desired/runtime/scheduler/transition schemas and `AutoBuildDetailFields`.
- `shared/agent-fields.ts` — `agentStartFields` and agent lifecycle field groups that are used by variant modules.
- `decisions.ts` — `PlanningDecisionSchema`, `PlanningDecisionEventSchema`, `BuildDecisionSchema`, and their derived types.
- `queue-events.ts` — queue event variant tuple and `QueueEventSchema`/`QueueEvent`.
- `envelope.ts` — `EventEnvelopeSchema`.
- `variants/session-planning.ts` — session, phase, config warnings, planning, planning review, architecture review, cohesion, and expedition events.
- `variants/extensions.ts` — extension hook diagnostics, agent-context/tool events, profile router events, policy-gate events, input-source/PRD-enricher events, reviewer perspective events, validation-provider events, and extension action events.
- `variants/build.ts` — per-plan build, plan lifecycle, orchestration, landing, PR auto-merge, merge worktree, and build resume events.
- `variants/agents.ts` — agent lifecycle, agent verbose streaming, agent activity/usage/tool events, and retry events.
- `variants/validation-recovery.ts` — validation, PRD validation, gap closing, acceptance validation, reconciliation, cleanup, user interaction, enqueue, recovery analysis/apply, and terminal failure events.
- `variants/daemon.ts` — daemon run upsert, daemon lifecycle, scheduler, auto-build, daemon recovery, orphan reaping, and daemon errors/warnings.
- `variants/stack.ts` — stack layer lifecycle, stack landing/sync, provider command, and conflict recovery events.
- `variants.ts` — imports all variant tuples plus queue/decision variants and exports one flat `EforgeEventVariantsSchema`.
- `root.ts` — composes `EforgeEventSchema`, derives `EforgeEvent`, and exports event-specific `Extract<...>` aliases.
- `snapshots.ts` — daemon/session stream snapshot schemas and snapshot types.
- `parse.ts` — `safeParseEforgeEvent`, `parseEforgeEvent`, `safeParseDaemonStreamSnapshot`, and `safeParseSessionStreamSnapshot`.
- `utilities.ts` — `SEVERITY_ORDER`, `isBuiltInReviewPerspective`, and `isAlwaysYieldedAgentEvent`.

If a different grouping is chosen, keep these invariants:

- No file under `packages/client/src/events/` exceeds 600 lines.
- Variant-family exports are readonly tuples or tuple-compatible constants, not pre-built TypeBox unions.
- `variants.ts` spreads family tuples into one flat array before calling `Type.Union`.
- Internal imports are acyclic: shared schemas -> decisions/queue/envelope/variant modules -> variants aggregate -> root -> snapshots/parse/utilities/facade.

### Detailed steps

1. Create the internal `packages/client/src/events/` module tree.
2. Move constants and shared TypeBox schemas out of `events.schemas.ts` without changing TypeBox literals, optional fields, descriptions, recursive metadata bounds, or object shapes.
3. Move queue event schemas, envelope schema, agent shared fields, and decision schemas.
4. Move event variants into family modules. Export arrays with `as const` and aggregate them in `events/variants.ts` using one flat spread expression.
5. Move root schema composition and derived event aliases into `events/root.ts`.
6. Move daemon/session snapshot schemas and snapshot types into `events/snapshots.ts`.
7. Move parse helpers into `events/parse.ts`. Keep this exact behavior:
   - Call `validateReviewIssueMetadataBoundsForEvent(value)` before `safeParseWithSchema(EforgeEventSchema, value)`.
   - Return the TypeBox parse failure before semantic validation when TypeBox rejects the value.
   - Call `validateEforgeEventSemanticFields(result.data)` only after TypeBox parsing succeeds.
8. Move utility exports into `events/utilities.ts`.
9. Replace `events.schemas.ts` with a facade header plus explicit exports/re-exports for the same public symbols currently exported by that file:
   - constants: `ORCHESTRATION_MODES`, `REVIEW_PERSPECTIVES`, `SEVERITY_ORDER`.
   - schemas: `ReviewPerspectiveKeySchema`, `LandingActionSchema`, `EvaluationIssueOutcomeSchema`, stack schemas, acceptance schemas, terminal failure schemas, build resume schemas, decision schemas, `EforgeEventSchema`, daemon/session snapshot schemas.
   - helpers: `isBuiltInReviewPerspective`, `isAlwaysYieldedAgentEvent`, parse helpers.
   - types currently exported by `events.schemas.ts`, including `EforgeEvent`, `DaemonRunUpsertEvent`, `AgentRole`, `ReviewIssue`, `BuildFailureSummary`, `PlanningDecision`, `BuildDecision`, stack wire types, snapshot types, and build-resume event aliases.
10. Update `packages/client/src/event-validation.ts` to import `type EforgeEvent` from `./events/root.js` or another non-facade type module to avoid a parse/facade cycle.
11. Preserve the existing export lists in `packages/client/src/events.ts`, `packages/client/src/index.ts`, and `packages/client/src/browser.ts`. Update comments that refer to the old implementation location.
12. Update `packages/client/src/event-registry.ts` comments so they refer to the exported event schema/type contract rather than adding variants to the old god-file.
13. Update `packages/docs-gen/src/generators/events.ts` provenance/source wording:
    - Keep `extractVariants` compatible with `EforgeEventSchema.allOf[*].anyOf` direct entries.
    - Change source text to mention the facade at `packages/client/src/events.schemas.ts` and implementation modules under `packages/client/src/events/`.
14. Update stale policy/provenance text in:
    - `AGENTS.md`.
    - `packages/client/src/events.schemas.ts` facade header.
    - `packages/client/src/events.ts` comment.
    - `packages/extension-sdk/src/events.ts` if it still names `events.schemas.ts` as the sole implementation owner.
    - `docs/extensions-api.md`, `web/content/docs/extensions-api.md`, and generated mirrors if they still say all event types are defined in `events.schemas.ts`.
15. Regenerate docs when generator output changes: `pnpm docs:generate`.
16. Remove the `packages/client/src/events.schemas.ts` entry from `scripts/agent-maintainability-baseline.json` after the facade is below 600 lines. Leave the `packages/client/src/event-registry.ts` baseline entry unchanged.
17. Add focused tests described below.

## Scope

### In Scope

- Internal module split under `packages/client/src/events/`.
- Compatibility facade in `packages/client/src/events.schemas.ts`.
- Import-cycle avoidance for `event-validation.ts`.
- Comment, policy, and generated-doc provenance wording updates tied to this split.
- Removal of the `events.schemas.ts` maintainability-baseline entry after the file is under 600 lines.
- Tests for schema shape, narrowing, registry/schema discriminant alignment, parse validation order, and representative public exports.

### Out of Scope

- Event wire-shape changes.
- Event type additions or removals.
- Semantic validation rule changes.
- `DAEMON_API_VERSION` changes.
- `packages/client/src/event-registry.ts` decomposition beyond comment/import adjustments.
- Route, daemon DB, or monitor wire-shape refactors.
- New public package export subpaths.

## Files

### Create

- `packages/client/src/events/constants.ts` — event-schema constants.
- `packages/client/src/events/envelope.ts` — event envelope schema.
- `packages/client/src/events/queue-events.ts` — queue event variant tuple and queue event schema/type.
- `packages/client/src/events/decisions.ts` — planning/build decision schemas and derived types.
- `packages/client/src/events/root.ts` — root event schema and event-derived aliases.
- `packages/client/src/events/snapshots.ts` — daemon/session snapshot schemas and types.
- `packages/client/src/events/parse.ts` — safe/throwing parse helpers.
- `packages/client/src/events/utilities.ts` — exported utility functions/constants.
- `packages/client/src/events/variants.ts` — flat event-variant aggregate union.
- `packages/client/src/events/shared/*.ts` — domain-specific shared schemas, split so each file is at or below 600 lines.
- `packages/client/src/events/variants/*.ts` — event-family variant tuples, split so each file is at or below 600 lines.
- `packages/client/src/__tests__/events-schema-shape.test.ts` — schema-shape, variant-discriminant, narrowing, parse-order, and public-export tests. Additional focused test files may be created if a single test file approaches the 1,200-line test cap.

### Modify

- `packages/client/src/events.schemas.ts` — replace god-file implementation with an explicit compatibility facade below 600 lines.
- `packages/client/src/event-validation.ts` — change type-only event import to a non-facade module.
- `packages/client/src/events.ts` — preserve exports; update header/comment wording if stale.
- `packages/client/src/index.ts` — preserve current event export surface; edit only if export plumbing requires a source path adjustment.
- `packages/client/src/browser.ts` — preserve current event export surface; edit only if export plumbing requires a source path adjustment.
- `packages/client/src/event-registry.ts` — update stale comments that name `events.schemas.ts` as the place new variants are added.
- `packages/docs-gen/src/generators/events.ts` — update source/provenance wording while preserving direct-`anyOf` extraction.
- `scripts/agent-maintainability-baseline.json` — remove only the `packages/client/src/events.schemas.ts` entry after the facade is below 600 lines.
- `AGENTS.md` — replace the old god-file policy with the new `packages/client/src/events/` implementation-module policy.
- `packages/extension-sdk/src/events.ts` — update source-owner comment if it still points to `events.schemas.ts` as the sole implementation file.
- `docs/extensions-api.md` and `web/content/docs/extensions-api.md` — update stale user-facing source wording if present.
- `web/content/reference/events.md`, `web/public/reference/events.md`, `web/public/docs/extensions-api.md`, `web/public/llms-full.txt`, and other generated files touched by `pnpm docs:generate` — update generated provenance/text only. `web/public/schemas/events.schema.json` must not contain wire-shape drift.
- Existing `packages/client/src/__tests__/events-schemas*.test.ts`, `events-wire-parity*.test.ts`, and `terminal-failure-event.test.ts` — update relative imports only when the facade path no longer fits the test purpose. Prefer keeping facade imports where the test intentionally checks compatibility.

## Database Migration

None.

## Test Requirements

Add or update client tests so that they assert these facts:

- `EforgeEventSchema` has an `allOf` array and includes the envelope schema entry.
- `EforgeEventSchema.allOf` includes a variants entry with top-level `anyOf` entries.
- The variants entry is not a union of event-family union schemas.
- A helper that recursively reads direct variant objects and same-discriminant nested union entries finds every `eventRegistry` key in the exported schema discriminants.
- Representative `Extract<EforgeEvent, { type: ... }>` aliases still narrow to payloads with required fields. Include at least:
  - `Extract<EforgeEvent, { type: 'plan:build:review:complete' }>` with `planId` and `issues`.
  - `Extract<EforgeEvent, { type: 'daemon:run:upsert' }>` with `run.planSet`, `run.command`, and `run.cwd`.
  - One stack event or extension action event with its required fields.
- `safeParseEforgeEvent` reports review-issue metadata bounds errors before TypeBox discriminant errors when both are present.
- `safeParseEforgeEvent` returns a TypeBox parse failure before semantic validation when a value is TypeBox-invalid and also contains a semantic-only forbidden field.
- `safeParseEforgeEvent` still returns a semantic validation error for a TypeBox-valid extension action event containing a forbidden raw field.
- Representative imports from `../events.js`, `../index.js`, and `../browser.js` compile and expose the event symbols that existed before this refactor. Do not add browser exports solely for this refactor.

## Verification

- [ ] `wc -l packages/client/src/events.schemas.ts` reports fewer than 600 lines.
- [ ] `find packages/client/src/events -type f -name '*.ts' -maxdepth 4 -print0 | xargs -0 wc -l` reports no implementation file above 600 lines.
- [ ] `scripts/agent-maintainability-baseline.json` has no `packages/client/src/events.schemas.ts` entry and still has the `packages/client/src/event-registry.ts` entry.
- [ ] `packages/client/src/events.schemas.ts` exports every symbol that it exported before the refactor, either directly or via explicit re-export.
- [ ] `packages/client/src/events.ts`, `packages/client/src/index.ts`, and `packages/client/src/browser.ts` preserve their event export lists from before the refactor.
- [ ] A schema-shape test verifies the root intersect and direct top-level variants `anyOf` shape.
- [ ] A schema-discriminant test verifies every `eventRegistry` key appears in exported schema variant discriminants.
- [ ] A TypeScript test verifies `Extract<EforgeEvent, { type: 'plan:build:review:complete' }>` accepts a value with `planId` and `issues`.
- [ ] A parse-order test verifies metadata bounds validation runs before TypeBox parsing.
- [ ] A parse-order test verifies semantic validation runs after TypeBox parsing.
- [ ] `rg "every discriminant variant lives here|Do not define event shapes in other files|Event types and schemas are co-located.*events.schemas" packages docs AGENTS.md` returns no matches.
- [ ] `pnpm --filter @eforge-build/client type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/client build` exits 0.
- [ ] `pnpm exec vitest run "packages/client/src/__tests__/events-schemas*.test.ts" "packages/client/src/__tests__/events-wire-parity*.test.ts" packages/client/src/__tests__/terminal-failure-event.test.ts packages/client/src/__tests__/events-schema-shape.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
