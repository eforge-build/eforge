---
id: plan-01-per-plan-build-config-foundation
name: "Per-Plan Build Config: Foundation"
depends_on: []
branch: per-plan-build-config-foundation/main
---

# Per-Plan Build Config: Foundation

## Architecture Context

This is the first of 3 PRDs to move build/review config from a single shared `ResolvedProfileConfig` to per-plan entries in orchestration.yaml. This plan adds the foundational types, constants, and wiring as purely additive changes - nothing existing breaks or changes behavior.

## Implementation

### Overview

Add per-plan `build` and `review` as optional fields on orchestration.yaml plan entries, wire them through the build pipeline via `BuildStageContext`, and simplify `resolveAgentConfig` to drop unused fields. All build stages switch from reading `ctx.profile.build`/`ctx.profile.review` to `ctx.build`/`ctx.review` with fallback to profile values during transition.

### Key Decisions

1. Per-plan `build`/`review` fields are optional - when absent, the profile's values are used as fallback. This keeps everything backward-compatible.
2. `resolveAgentConfig` drops the `profile` parameter and dead return fields (`prompt`, `tools`, `model`) since no caller uses them - agent runners get these from the backend config, not from this function.
3. `BuildStageContext` carries `build` and `review` as required fields (resolved from per-plan or profile fallback before pipeline entry), so build stages always have a definitive source.

## Scope

### In Scope
- New constants: `DEFAULT_BUILD`, `DEFAULT_BUILD_WITH_DOCS` in `src/engine/config.ts`
- Export existing `buildStageSpecSchema`, `reviewProfileConfigSchema`, `DEFAULT_REVIEW` from `src/engine/config.ts`
- Optional `build`/`review` on `OrchestrationConfig.plans` entries in `src/engine/events.ts`
- `build`/`review` required fields on `BuildStageContext` in `src/engine/pipeline.ts`
- `moduleBuildConfigs` on `PipelineContext` in `src/engine/pipeline.ts`
- `resolveAgentConfig` simplified to 2-arg signature in `src/engine/pipeline.ts`
- All 5 `resolveAgentConfig` call sites updated in `src/engine/pipeline.ts`
- All build stage reads updated to `ctx.build`/`ctx.review` in `src/engine/pipeline.ts`
- `parseOrchestrationConfig` reads optional per-plan `build`/`review` in `src/engine/plan.ts`
- `writePlanArtifacts` accepts and writes per-plan `build`/`review` in `src/engine/plan.ts`
- `validatePlanSet` validates per-plan build stage names in `src/engine/plan.ts`
- `compileExpedition` accepts optional `moduleBuildConfigs` in `src/engine/compiler.ts`
- `prd-passthrough` passes `build: DEFAULT_BUILD` and `review: DEFAULT_REVIEW` in `src/engine/pipeline.ts`
- `compile-expedition` passes `ctx.moduleBuildConfigs` to `compileExpedition` in `src/engine/pipeline.ts`
- Build phase in `src/engine/eforge.ts` reads per-plan build/review from orchConfig plan entries
- `PipelineContext` initialization in `compile()` includes `moduleBuildConfigs: new Map()`
- New exports from `src/engine/index.ts`

### Out of Scope
- Removing build/review/agents from profile type (PRD 2)
- Prompt changes for planner/module-planner to emit per-plan config (PRD 2)
- Agent changes (PRD 2)
- Test updates (PRD 3)
- Monitor UI changes (PRD 3)

## Files

### Modify
- `src/engine/config.ts` — Add and export `DEFAULT_BUILD`, `DEFAULT_BUILD_WITH_DOCS` constants. Export `buildStageSpecSchema`, `reviewProfileConfigSchema`, `DEFAULT_REVIEW` (change from `const` to `export const` for `DEFAULT_REVIEW`; the schemas are already `const` but not exported).
- `src/engine/events.ts` — Add optional `build?: BuildStageSpec[]` and `review?: ReviewProfileConfig` to `OrchestrationConfig.plans` entries. Import `BuildStageSpec` and `ReviewProfileConfig` from `./config.js`.
- `src/engine/pipeline.ts` — (1) Add `build: BuildStageSpec[]` and `review: ReviewProfileConfig` to `BuildStageContext`. (2) Add `moduleBuildConfigs: Map<string, { build: BuildStageSpec[]; review: ReviewProfileConfig }>` to `PipelineContext`. (3) Simplify `resolveAgentConfig` to 2-arg signature `(role, config)` returning `{ maxTurns: number }`. (4) Update all 5 call sites of `resolveAgentConfig` to drop profile arg. (5) Update `runBuildPipeline` to iterate `ctx.build` instead of `ctx.profile.build`. (6) Update `implementStage` to read parallel stages from `ctx.build`. (7) Update `reviewStageInner` to read strategy/perspectives from `ctx.review`. (8) Update `reviewFixStageInner` to read `autoAcceptBelow` from `ctx.review`. (9) Update `evaluateStageInner` to read `evaluatorStrictness` from `ctx.review`. (10) Update `reviewCycleStage` to read from `ctx.review`. (11) Update `prd-passthrough` to pass `build` and `review` to `writePlanArtifacts`. (12) Update `compile-expedition` to pass `ctx.moduleBuildConfigs` to `compileExpedition`. Import `DEFAULT_REVIEW` and new `DEFAULT_BUILD` from config.
- `src/engine/plan.ts` — (1) In `parseOrchestrationConfig`, read optional `build` and `review` from each plan entry, validate with imported schemas. (2) Update `WritePlanArtifactsOptions` to accept optional `build` and `review`. (3) Update `writePlanArtifacts` to include `build`/`review` in orchestration.yaml plan entries. (4) In `validatePlanSet`, add per-plan build stage validation.
- `src/engine/eforge.ts` — (1) In `planRunner` closure in `build()`, look up plan entry from `orchConfig.plans`, resolve `build` and `review` (per-plan or profile fallback), pass into `BuildStageContext`. (2) In `compile()`, initialize `moduleBuildConfigs: new Map()` in the `PipelineContext`.
- `src/engine/compiler.ts` — Update `compileExpedition` to accept optional `moduleBuildConfigs` parameter. Write per-plan `build` and `review` into orchestration.yaml plan entries when module config exists.
- `src/engine/index.ts` — Export `DEFAULT_BUILD`, `DEFAULT_BUILD_WITH_DOCS`, `DEFAULT_REVIEW`, `buildStageSpecSchema`, `reviewProfileConfigSchema` from config.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `pnpm build` exits with code 0
- [ ] `resolveAgentConfig` function signature has exactly 2 parameters (`role: AgentRole`, `config: EforgeConfig`) and return type is `{ maxTurns: number }`
- [ ] `BuildStageContext` interface includes `build: BuildStageSpec[]` and `review: ReviewProfileConfig` as required fields
- [ ] `PipelineContext` interface includes `moduleBuildConfigs: Map<string, { build: BuildStageSpec[]; review: ReviewProfileConfig }>`
- [ ] `DEFAULT_BUILD` is exported from `src/engine/index.ts` and equals `['implement', 'review-cycle']`
- [ ] `DEFAULT_BUILD_WITH_DOCS` is exported from `src/engine/index.ts` and equals `[['implement', 'doc-update'], 'review-cycle']`
- [ ] `DEFAULT_REVIEW` is exported from `src/engine/index.ts`
- [ ] `buildStageSpecSchema` is exported from `src/engine/index.ts`
- [ ] `reviewProfileConfigSchema` is exported from `src/engine/index.ts`
- [ ] `OrchestrationConfig.plans` entries accept optional `build` and `review` fields
- [ ] `runBuildPipeline` iterates `ctx.build` (not `ctx.profile.build`)
- [ ] `reviewCycleStage` reads `maxRounds`, `strategy`, `perspectives`, `autoAcceptBelow`, `evaluatorStrictness` from `ctx.review` (not `ctx.profile.review`)
- [ ] No callers of `resolveAgentConfig` pass a profile as the first argument
