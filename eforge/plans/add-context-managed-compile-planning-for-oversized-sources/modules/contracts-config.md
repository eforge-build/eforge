# Contracts Config

## Architecture Reference

This module implements the **contracts-config** row from **Implementation Module Boundaries**, plus the **Client-Owned Wire Model**, **Configuration Contract**, **Event Contract**, and the client-owned portion of the **Recovery Contract**.

Key constraints from architecture:
- Client-owned TypeBox schemas are the source of truth for decomposition events, decomposition failure evidence, failure kinds, and exported wire types.
- Route and sidecar wire shapes remain in `@eforge-build/client`; engine code consumes exported types instead of redeclaring them.
- Config defaults and validation expose planning-unit parallelism with a default of `2`, and expose explicit defaults for the other planning-unit budget limits used by diagnostics.
- This module must not implement strategy selection, decomposition graph derivation, agent prompts, scheduler policy, artifact synthesis, Console rendering, or recovery wording.
- `packages/client/src/events/variants/session-planning.ts` is shared; this module owns only the decomposition event variant definitions in the planning/expedition area.

## Scope

### In Scope
- Add bounded planning-decomposition TypeBox schemas and public TypeScript types in the client package.
- Add event variants for:
  - `planning:decomposition:start`
  - `planning:decomposition:unit:queued`
  - `planning:decomposition:unit:running`
  - `planning:decomposition:unit:progress`
  - `planning:decomposition:unit:completed`
  - `planning:decomposition:unit:skipped`
  - `planning:decomposition:unit:failed`
  - `planning:decomposition:schedule`
  - `planning:decomposition:budget`
  - `planning:decomposition:compact-handoff`
  - `planning:decomposition:synthesis:complete`
- Extend compile scope/context failure contracts with `source: 'decomposition'`, `failureKind: 'decomposition-exhausted'`, `stage: 'planning-decomposition'`, and optional bounded `decompositionEvidence`.
- Extend recovery sidecar compile-scope-context option schema with optional bounded `decompositionEvidence`.
- Add concise event-registry metadata and persistence settings for all new decomposition events.
- Add semantic event validation that rejects raw source, prompt, and transcript fields on decomposition events.
- Add `compile` config defaults, schema validation, partial-config merge support, and a resolver that returns `PlanningDecompositionLimits`.
- Export new schemas, constants, and types through `@eforge-build/client`, `@eforge-build/client/events`, `@eforge-build/client/browser`, and the engine event/config facades used by later modules.
- Update generated event/config reference artifacts and concise user-facing config documentation for the new `compile.*` keys.
- Add client contract tests and engine config tests for the new schemas, exports, defaults, validation, and resolver.

### Out of Scope
- Selecting direct vs context-managed planning in compile stages.
- Deriving planning units, dependency graphs, coverage assignment, recursive splits, or schedule batches.
- Invoking planner/module-planner agents with bounded prompts.
- Persisting `.decomposition/*` artifacts or synthesizing architecture, module, plan, or orchestration files.
- Rendering Console/CLI decomposition timelines or recovery text.
- Mapping engine `DecompositionPlanningError` values into failures; this module only defines the client-owned target shape.
- Changing provider context guard math or planner-family token accounting.
- Bumping package versions or `DAEMON_API_VERSION`; this change is additive to the event/config contract and does not rename or remove daemon HTTP routes.

## Implementation Approach

### Overview

Implement the client contract first, then wire engine config to those exported types. The client package gets a new planning-decomposition shared schema module containing bounded payload schemas, evidence schemas, constants, and exported TypeScript types. `session-planning.ts` imports those field maps and registers the event variants as ordinary flat event objects so `EforgeEvent` narrowing remains precise.

Engine config gets a small config-owned limits resolver that imports the client-owned `PlanningDecompositionLimits` type. `config.ts` only adds the `compile` config section, defaults, merge support, and re-exports; it does not own decomposition graph or scheduler logic.

### Key Decisions

1. **Client owns the limit shape.** Define `PlanningDecompositionLimitsSchema` and `PlanningDecompositionLimits` in the client schema module, then have engine config resolve to that type. This gives downstream engine modules one contract to consume.
2. **Event variants use flat fields.** Keep decomposition event fields at the event top level rather than nesting under `payload`, matching existing planning events and keeping generated event-reference fields visible.
3. **Risk evidence is summarized, not imported as full preflight risk.** The new planning-decomposition schema module must not import `compile-resilience.ts`, because `compile-resilience.ts` imports `DecompositionFailureEvidenceSchema`. Define a bounded `PlanningDecompositionRiskEvidenceSchema` with risk level, score, source/prompt bytes, acceptance criteria count, subsystem summaries, recommendation action, and selected scope.
4. **No raw source or transcript in events.** Source slice schemas record hashes, paths/headings/line ranges, criteria IDs, and byte counts. Semantic validation rejects decomposition events that include top-level or nested fields such as `sourceContent`, `prompt`, `transcript`, `rawSource`, or `rawTranscript`.
5. **Failure evidence is optional for compatibility.** Existing `planning:scope-context:failure` events and recovery sidecars remain valid without `decompositionEvidence`; decomposition exhaustion events can attach bounded unit evidence when later modules emit it.
6. **Invalid config fails validation.** `compile.planningUnitParallelism` and all numeric planning-unit limit overrides use positive integer validation. Non-positive and fractional values fail config parsing instead of being ignored.
7. **Progress can be live-only.** Persist `start`, lifecycle terminal/state events, `schedule`, `budget`, `compact-handoff`, and `synthesis:complete`. Keep `planning:decomposition:unit:progress` non-persisted because replay can be reconstructed from persisted lifecycle and schedule events.

## Files

### Create
- `packages/client/src/events/shared/planning-decomposition.ts` — TypeBox constants, bounded primitive schemas, planning unit/budget/coverage/evidence schemas, payload field maps, event type list for semantic validation, and exported `Static<>` types.
- `packages/engine/src/compile-resilience/planning-decomposition-limits.ts` — raw compile config defaults, `PlanningDecompositionConfig` type, and `resolvePlanningDecompositionLimits(config)` mapping from `compile.planningUnit*` keys to the client-owned `PlanningDecompositionLimits` shape.
- `packages/client/src/__tests__/events-schemas-planning-decomposition.test.ts` — focused client contract tests for decomposition events, failure evidence, recovery sidecar evidence, registry metadata, public exports, and semantic raw-field rejection.
- `test/planning-decomposition-config.test.ts` — engine config tests for schema acceptance/rejection, defaults, overrides, layered merge behavior, frozen resolved config, and limit resolver output.

### Modify
- `packages/client/src/events/shared/compile-resilience.ts` — import `DecompositionFailureEvidenceSchema`; add `decomposition` to `CompileScopeContextSourceSchema`, `decomposition-exhausted` to `CompileScopeContextFailureKindSchema`, `planning-decomposition` to the failure stage union, and optional `decompositionEvidence` to `CompileScopeContextFailureSchema`.
- `packages/client/src/events/variants/session-planning.ts` — add decomposition event variants to `planningEventVariants` using field maps from the new shared schema module `[region: contracts-config, after planning:scope-context:failure and before clarification/progress events]`.
- `packages/client/src/events/root.ts` — import and export new decomposition schemas/types and `Extract<EforgeEvent, ...>` aliases for the new event variants.
- `packages/client/src/events.schemas.ts` — re-export decomposition schemas, constants, and types through the compatibility facade.
- `packages/client/src/events.ts` — re-export decomposition schemas, constants, and types through the public events subpath.
- `packages/client/src/index.ts` — re-export decomposition schemas, constants, and types through the main client facade.
- `packages/client/src/browser.ts` — re-export decomposition schemas, constants, and types through the browser-safe facade.
- `packages/client/src/event-registry.ts` — add session-scoped registry entries, persistence flags, and summaries for all decomposition events.
- `packages/client/src/event-validation.ts` — add a decomposition-event semantic guard using the exported event type list and recursive forbidden-field detection.
- `packages/client/src/routes/recovery.ts` — add optional `decompositionEvidence` to `RecoverySidecarCompileScopeContextOptionSchema` by importing the client-owned evidence schema.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add representative valid payloads for each decomposition event variant.
- `packages/client/src/__tests__/events-wire-parity-invalid-fixtures.ts` — add at least one invalid decomposition payload with a forbidden raw prompt/source/transcript field.
- `packages/engine/src/config.ts` — add `compile` zod schema fields, `EforgeConfig['compile']`, `DEFAULT_CONFIG.compile`, `resolveConfig()` defaults/overrides, `mergePartialConfigs()` shallow merge, and re-exports for planning-decomposition config defaults/resolver. Use bounded exact edits because this file is oversized.
- `packages/engine/src/events.ts` — re-export new decomposition schemas/types from `@eforge-build/client` for later engine modules that import from `../events.js`.
- `docs/config.md` — document the `compile` planning-unit budget keys and note that they only affect context-managed planning for overflow-risk compile inputs.
- `web/content/docs/configuration.md` — add a concise “Compile planning limits” section with the default `compile` block and the parallelism override behavior.
- `web/public/docs/configuration.md` — generated public mirror of `web/content/docs/configuration.md`; update via docs sync/generation.
- `web/content/reference/config.md`, `web/public/reference/config.md`, `web/public/schemas/config.schema.json` — generated config reference/schema updates from `pnpm docs:generate`.
- `web/content/reference/events.md`, `web/public/reference/events.md`, `web/public/schemas/events.schema.json` — generated event reference/schema updates from `pnpm docs:generate`.
- `web/public/llms.txt`, `web/public/llms-full.txt` — include if `pnpm docs:generate` updates the agent-readable docs bundle after the config/event reference changes.

## Schema Details

### Client Planning-Decomposition Schemas

Define bounded schemas with exported constants for array and string limits. The exact constants can be tuned during implementation, but they must be finite and tested. Use this initial shape:

- `PlanningDecompositionUnitStatusSchema`: `queued | running | completed | skipped | failed`.
- `PlanningDecompositionLimitsSchema`: `parallelism`, `maxDepth`, `maxPromptSourceBytes`, `maxPromptBytes`, `maxObservedInputTokens`, optional `maxObservedTurns`, `maxCompactHandoffBytes`, `maxLocalExplorationToolUses`, `maxCriteriaPerUnit`, `maxSubsystemsPerUnit`, `maxSplitAttemptsPerUnit`.
- `PlanningUnitBudgetSchema`: same budget fields as architecture, with `maxRecursiveDepth`.
- `PlanningObservedBudgetPressureSchema`: observed token/byte/tool-use counts and bounded `triggeredLimitKeys`.
- `PlanningSourceSliceSummarySchema`: `kind`, `sourceHash`, optional `path`, optional `headingPath`, optional line range, `criteriaIds`, and `byteLength`; do not include source text.
- `PlanningCriterionCoverageSchema` and `PlanningCoverageSummarySchema`: covered criteria plus bounded unresolved criteria entries with reason/evidence.
- `PlanningDecompositionUnitSummarySchema`: unit ID, parent/depth, source slice summaries, coverage, subsystem hints, dependencies, interface/shared-file constraints, budgets, and status.
- `PlanningScheduleDecisionSchema`: ready/running/waiting/selected batch, `parallelism`, and blocked pairs.
- `DecompositionFailureEvidenceSchema`: failed unit identity, budgets, observed pressure, assigned/unresolved criteria, blockers, and split attempts.
- Payload field maps for each event variant listed in scope.

### Config Defaults

Use these raw config defaults unless implementation discovers an existing named default that is a closer fit:

| Config key | Limit field | Default |
|------------|-------------|---------|
| `compile.planningUnitParallelism` | `parallelism` | `2` |
| `compile.planningUnitMaxDepth` | `maxDepth` | `3` |
| `compile.planningUnitMaxPromptSourceBytes` | `maxPromptSourceBytes` | `40000` |
| `compile.planningUnitMaxPromptBytes` | `maxPromptBytes` | `80000` |
| `compile.planningUnitMaxObservedInputTokens` | `maxObservedInputTokens` | `120000` |
| `compile.planningUnitMaxObservedTurns` | `maxObservedTurns` | unset unless configured |
| `compile.planningUnitMaxCompactHandoffBytes` | `maxCompactHandoffBytes` | `12000` |
| `compile.planningUnitMaxLocalExplorationToolUses` | `maxLocalExplorationToolUses` | `24` |
| `compile.planningUnitMaxCriteriaPerUnit` | `maxCriteriaPerUnit` | `20` |
| `compile.planningUnitMaxSubsystemsPerUnit` | `maxSubsystemsPerUnit` | `2` |
| `compile.planningUnitMaxSplitAttemptsPerUnit` | `maxSplitAttemptsPerUnit` | `2` |

`resolvePlanningDecompositionLimits(resolveConfig({}))` must return the default limit object above, with `maxObservedTurns` omitted when unset.

## Testing Strategy

### Unit Tests
- Client schema tests accept one valid event for each decomposition event type and reject malformed statuses, missing required fields, oversized bounded arrays, invalid hashes, and raw prompt/source/transcript fields.
- Client failure tests accept `planning:scope-context:failure` with `source: 'decomposition'`, `failureKind: 'decomposition-exhausted'`, `stage: 'planning-decomposition'`, and bounded `decompositionEvidence`.
- Recovery route schema tests accept `RecoverySidecarCompileScopeContextOptionSchema` with optional `decompositionEvidence` and reject invalid decomposition evidence shapes.
- Registry tests verify scope/persist settings and summaries for all new event types.
- Public export tests verify the new schemas/types/constants are available from `@eforge-build/client`, `@eforge-build/client/events`, and `@eforge-build/client/browser`.
- Config schema tests verify `compile.*` positive-integer validation and rejection of zero, negative, and fractional values.
- Config resolver tests verify defaults, valid overrides, merge precedence, and `resolvePlanningDecompositionLimits()` output.

### Integration Tests
- No scheduler, agent, or compile-stage integration test belongs to this module.
- Existing event wire parity tests must include the new decomposition events through valid fixtures and at least one invalid forbidden-field fixture.
- Existing docs drift checks must pass after generated config/event references and schemas are updated.

## Verification

- [ ] `safeParseEforgeEvent()` accepts all 11 decomposition event types with bounded representative payloads.
- [ ] `safeParseEforgeEvent()` rejects a decomposition event containing `transcript` and reports `/transcript`.
- [ ] `CompileScopeContextFailureSchema` accepts `source: 'decomposition'`, `failureKind: 'decomposition-exhausted'`, `stage: 'planning-decomposition'`, and bounded `decompositionEvidence`.
- [ ] `RecoverySidecarCompileScopeContextOptionSchema` accepts optional `decompositionEvidence` and rejects an invalid split-attempt entry.
- [ ] `eventRegistry['planning:decomposition:unit:progress'].persist` is `false`.
- [ ] Persisted decomposition event registry entries are `true` for start, lifecycle, schedule, budget, compact handoff, and synthesis events.
- [ ] `resolveConfig({}).compile.planningUnitParallelism` equals `2`.
- [ ] `resolvePlanningDecompositionLimits(resolveConfig({})).parallelism` equals `2`.
- [ ] `resolvePlanningDecompositionLimits(resolveConfig({ compile: { planningUnitParallelism: 4 } })).parallelism` equals `4`.
- [ ] `configYamlSchema.safeParse({ compile: { planningUnitParallelism: 0 } }).success` is `false`.
- [ ] `configYamlSchema.safeParse({ compile: { planningUnitParallelism: 1.5 } }).success` is `false`.
- [ ] `mergePartialConfigs({ compile: { planningUnitParallelism: 3 } }, { compile: { planningUnitMaxDepth: 5 } })` preserves both keys.
- [ ] New decomposition schemas/constants are exported from `@eforge-build/client`, `@eforge-build/client/events`, `@eforge-build/client/browser`, and `@eforge-build/engine/events`.
- [ ] Generated `web/public/schemas/events.schema.json` contains `planning:decomposition:synthesis:complete`.
- [ ] Generated `web/public/schemas/config.schema.json` contains `planningUnitParallelism`.
- [ ] `pnpm docs:check` exits 0 after generated docs are updated.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
