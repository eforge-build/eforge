---
title: "Per-Plan Build Config: Completion"
created: 2026-03-19
status: pending
depends_on: ["per-plan-build-config-foundation"]
---

# Per-Plan Build Config: Completion

## Problem / Motivation

The foundation PRD added per-plan `build` and `review` as optional fields on `OrchestrationConfig.plans`, added `build`/`review` to `BuildStageContext`, simplified `resolveAgentConfig`, and updated all build stage reads. But profiles still carry `build`/`review`/`agents` fields, prompts don't instruct per-plan config, and tests/monitor still use the old shape.

This PRD completes the migration in one atomic change: removes old profile fields, makes per-plan fields required, updates agents/prompts, updates ALL tests and monitor UI, and updates docs. Everything lands together so type changes and consumer updates are never split.

## Goal

1. Profiles become `{ description, compile }` only
2. Per-plan `build` and `review` become required on `OrchestrationConfig.plans`
3. Agents and prompts generate/consume per-plan config
4. All tests, monitor UI, and docs reflect the new shape

## Approach

### Engine: Profile schema changes — `src/engine/config.ts`

- Remove `build`, `review`, `agents` from `resolvedProfileConfigSchema` and `partialProfileConfigSchema`
- Update `BUILTIN_PROFILES` to only have `description` and `compile`
- Remove `DEFAULT_BUILD_STAGES` and `ERRAND_BUILD_STAGES` constants
- Remove `agentProfileConfigSchema` from profile schemas
- Simplify `resolveProfileExtensions` — remove agents/review/build merging
- Simplify `mergePartialConfigs` — remove agents/review merging from profiles
- Simplify `resolveGeneratedProfile` — remove build/review/agents handling
- Simplify `validateProfileConfig` — remove build stage and agents validation

### Engine: Make per-plan fields required — `src/engine/events.ts`

Change `build` and `review` from optional (`?`) to required on `OrchestrationConfig.plans` entries.

**Critical:** This type change must land in the same commit as all consumer updates below. The `resolveDependencyGraph` function accepts `OrchestrationConfig['plans']` — if it doesn't use `build`/`review`, narrow its parameter type to `Array<{ id: string; dependsOn: string[] }>` so callers that don't have build/review still compile.

### Engine: Agents — `src/engine/agents/planner.ts`

- Remove `formatParallelLanes` function
- Remove parallelLanes computation from `buildPrompt()`
- Update `formatProfileGenerationSection` to exclude build/review/agents

### Engine: Common — `src/engine/agents/common.ts`

- Add `parseBuildConfigBlock()` for parsing `<build-config>` XML blocks from module planner output
- Update `GeneratedProfileBlock` — remove `build`, `agents`, `review` from overrides

### Engine: Pipeline — `src/engine/pipeline.ts`

- In module-planning stage, intercept `agent:message` events to parse `<build-config>` blocks and populate `ctx.moduleBuildConfigs`
- Import `parseBuildConfigBlock` from `./agents/common.js`

Note: `parseBuildConfigBlock` may already be imported and wired from the foundation PRD's builder being proactive. Check first and skip if already present.

### Engine: Exports — `src/engine/index.ts`

- Remove `formatParallelLanes` export

### Prompts — `src/engine/prompts/planner.md`

Add per-plan build/review instructions to the orchestration.yaml format section:
- Each plan entry MUST include `build` and `review` fields
- `build` uses `review-cycle` as the composite stage:
  - `["implement", "review-cycle"]` for code changes
  - `[["implement", "doc-update"], "review-cycle"]` when touching user-facing surfaces
  - `review-cycle` almost always included — only omit for purely mechanical zero-logic changes
- `review` configures knobs: `strategy`, `perspectives`, `maxRounds`, `evaluatorStrictness`
- Remove build/review/agents from profile generation section
- Remove `{{parallelLanes}}` template variable usage

### Prompts — `src/engine/prompts/module-planner.md`

Add `<build-config>` block emission instructions with same `review-cycle` guidance.

### Tests

**`test/pipeline.test.ts`**:
- Remove `build`, `review`, `agents` from any remaining `BUILTIN_PROFILES` spreads
- `orchConfig` in `makeBuildCtx`: add per-plan `build`/`review` to plan entries

**`test/dynamic-profile-generation.test.ts`**:
- `cloneProfile`: remove build/review/agents
- `resolveGeneratedProfile` tests: profiles only have description/compile/extends
- `validateProfileConfig` tests: remove build stage and agents validation tests

**`test/config-profiles.test.ts`**:
- Profile construction: remove build/review/agents
- Extension resolution: only description/compile/extends merge

**`test/plan-parsing.test.ts`**:
- Orchestration fixtures: add per-plan build/review, remove from profile

**`test/lane-awareness.test.ts`**:
- Delete `formatParallelLanes` tests
- Update `formatBuilderParallelNotice` tests

**`test/agent-wiring.test.ts`**:
- Profile construction: remove build/review/agents

**`test/orchestration-logic.test.ts`**:
- Profile construction: remove build/review/agents
- Orchestration plan entries: add per-plan build/review

**`test/plan-complete-depends-on.test.ts`**:
- Orchestration plan entries: add per-plan build/review

**`test/adopt.test.ts`**:
- Profile construction: remove build/review/agents

**`test/fixtures/orchestration/valid.yaml`**:
- Remove build/review/agents from profile, add per-plan build/review to plans

**New `test/per-plan-build-config.test.ts`**:
- parseOrchestrationConfig reads per-plan build/review
- parseOrchestrationConfig throws on missing build/review
- validatePlanSet catches invalid per-plan stage names
- parseBuildConfigBlock parses valid JSON, returns null on invalid

### Monitor UI

**`src/monitor/ui/src/lib/types.ts`**: Remove `build`, `review`, `agents` from `ProfileConfig`

**`src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`**: ProfileHeader and StageOverview show compile-only

**`src/monitor/ui/src/components/timeline/event-card.tsx`**: eventDetail shows compile stages only

**`src/monitor/mock-server.ts`**: Update mock profile objects and plan entries

### Plugin docs

**`eforge-plugin/skills/config/config.md`**: Update profile examples to `{ description, compile }`, document per-plan build/review

## Acceptance Criteria

1. `pnpm type-check` passes
2. `pnpm test` passes — all tests green
3. `pnpm build` succeeds
4. `ResolvedProfileConfig` has only `description`, `extends` (optional), `compile`
5. `OrchestrationConfig.plans` entries have required `build` and `review`
6. `formatParallelLanes` no longer exists
7. `parseBuildConfigBlock` exists in common.ts
8. Planner prompt documents per-plan build/review with review-cycle
9. Module planner prompt documents `<build-config>` block
10. No test constructs `ResolvedProfileConfig` with `build`, `review`, or `agents`
11. Monitor UI `ProfileConfig` has only `description` and `compile`
