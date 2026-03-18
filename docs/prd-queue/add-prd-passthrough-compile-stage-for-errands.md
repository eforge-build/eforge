---
title: Add `prd-passthrough` compile stage for errands
created: 2026-03-18
status: pending
---

## Problem / Motivation

The errand and excursion profiles currently share identical compile stages: `['planner', 'plan-review-cycle']`. For errands - small, self-contained changes - this means a full planner agent (codebase exploration, structured plan file generation) and a plan-review-cycle (plan-reviewer + plan-evaluator agents) run before any building starts. That's three agent invocations adding latency, token cost, and no value for simple tasks. An errand should treat the PRD as the plan and go straight to build.

## Goal

Add a `prd-passthrough` compile stage that converts the PRD directly into the plan file + orchestration.yaml the build phase expects, without invoking any agents - pure data transformation. Update the errand profile to use it.

## Approach

- Register a new `prd-passthrough` compile stage in the pipeline stage registry (`src/engine/pipeline.ts`). The stage performs pure data transformation with no agent invocations:
  - Extracts title from PRD: YAML frontmatter `title` field > H1 heading > humanized `planSetName`
  - Strips PRD frontmatter from the body (the builder gets implementation instructions, not PRD metadata)
  - Gets base branch via `git rev-parse --abbrev-ref HEAD` (fallback `'main'`)
  - Detects validation commands via `detectValidationCommands(ctx.cwd)` from `plan.ts`
  - Calls `writePlanArtifacts()` from `plan.ts` to create the plan file + orchestration.yaml
  - Populates `ctx.plans` with the returned `PlanFile`
  - Yields events: `plan:start`, `plan:scope` (assessment: `'errand'`), `plan:profile`, `plan:progress`, `plan:complete`
- Use a small inline `extractPrdMetadata(sourceContent, planSetName)` helper that parses frontmatter/H1/fallback and returns `{ title, body }`
- Imports to add in `pipeline.ts`: `writePlanArtifacts`, `extractPlanTitle`, `detectValidationCommands` from `./plan.js`; `parse as parseYaml` from `yaml` (already imported)
- Update the errand profile's compile stages from `['planner', 'plan-review-cycle']` to `['prd-passthrough']` in `src/engine/config.ts` (line 154)
- Reuse existing helpers: `writePlanArtifacts()` (`plan.ts:455`), `extractPlanTitle()` (`plan.ts:386`), `detectValidationCommands()` (`plan.ts:412`), and `exec` (already imported in `pipeline.ts`)

## Scope

**In scope:**

- New `prd-passthrough` compile stage registration in `src/engine/pipeline.ts`
- Errand profile compile stage update in `src/engine/config.ts`
- Test updates in `test/pipeline.test.ts`:
  - Add `'prd-passthrough'` to the built-in compile stages array (line 132)
  - Update errand assertion to `expect(errand.compile).toEqual(['prd-passthrough'])` (lines 561-563)
- Tests in `test/config-profiles.test.ts` (lines 41, 61, 103) reference `BUILTIN_PROFILES.errand.compile` and will pass without changes since they compare against the actual value
- CLAUDE.md updates: add `prd-passthrough` to compile stages list, update errand profile description to `compile: ['prd-passthrough']`

**Out of scope:**

- Changes to the excursion or expedition profiles
- Any agent invocations within the new stage

**Files to modify:**

- `src/engine/pipeline.ts` — new `prd-passthrough` stage registration
- `src/engine/config.ts` — errand profile compile stages
- `test/pipeline.test.ts` — update assertions
- `CLAUDE.md` — documentation

## Acceptance Criteria

- `prd-passthrough` is a registered compile stage that converts a PRD into plan file + orchestration.yaml without invoking any agents
- The errand profile's compile stages are `['prd-passthrough']`
- The stage extracts the title (YAML frontmatter `title` > H1 heading > humanized `planSetName`), strips frontmatter from body, detects base branch and validation commands, writes artifacts via `writePlanArtifacts()`, and populates `ctx.plans`
- The stage yields `plan:start`, `plan:scope`, `plan:profile`, `plan:progress`, and `plan:complete` events
- `pnpm test` passes with updated assertions
- `pnpm type-check` passes with no type errors
- Manual verification: `eforge run` on a small PRD shows only `prd-passthrough` during compile (no planner, no plan-reviewer, no plan-evaluator), and the build phase receives the PRD content as the plan body
