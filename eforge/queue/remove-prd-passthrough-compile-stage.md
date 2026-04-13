---
title: Remove prd-passthrough compile stage
created: 2026-04-13
---

# Remove prd-passthrough compile stage

## Problem / Motivation

When a PRD describes already-implemented functionality, eforge should skip the build. Currently this fails because the pipeline composer selects `prd-passthrough` for errands, which bypasses the planner entirely. Since `prd-passthrough` is a non-LLM stage, it can never detect "nothing to do" - it blindly creates plan artifacts from the PRD. This causes a build phase crash when the planner generates 0 plans.

The root issue is architectural: the skip-detection logic lives in the planner, but `prd-passthrough` prevents the planner from ever running for errands.

## Goal

Remove `prd-passthrough` as a compile stage so the planner always runs for all profiles, giving it the opportunity to explore the codebase and determine whether to skip (fully implemented), plan a subset (partially implemented), or plan the full PRD (nothing implemented). For errands, the planner generates a single simple plan - the "passthrough" behavior becomes an organic outcome rather than a special case.

## Approach

Delete the `prd-passthrough` stage registration and all references to it across the codebase. The planner stage already handles the skip case (0-plans -> `plan:skip`), and defensive changes in `planner.ts`, `eforge.ts`, prompt strengthening, test updates, and the MCP proxy are already in place from a prior build. This PRD covers the removal of `prd-passthrough` itself.

Key changes:

### 1. Remove prd-passthrough stage registration
**File:** `packages/engine/src/pipeline.ts`

- **Delete lines 707-761**: The entire `registerCompileStage({ name: 'prd-passthrough', ... })` block
- **Line 769**: Remove `conflictsWith: ['prd-passthrough']` from the planner stage registration (change to `conflictsWith: []` or remove the field)
- **Line 2024**: Update the comment referencing prd-passthrough in the pipeline restart logic

### 2. Pipeline-composer prompt
**File:** `packages/engine/src/prompts/pipeline-composer.md`

No changes needed. Line 36 already says "For errand scope: minimal pipeline - just planner + implement." The stage registry table is auto-generated from registered stages, so prd-passthrough will automatically disappear from the composer's catalog.

### 3. Update docs
**File:** `docs/architecture.md`

- **Line 102**: Remove prd-passthrough from the Mermaid diagram
- **Line 121**: Remove prd-passthrough row from the stages table
- **Line 146**: Update errand profile description (currently says "Compile: `[prd-passthrough]`. Skips planning entirely")

### 4. Update monitor UI
**File:** `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`

- **Lines 581-583**: Remove special-case handling for prd-passthrough stage completion

### 5. Update tests

Six test files reference prd-passthrough:

- **`test/adopt.test.ts:14`** - `ERRAND_PIPELINE` uses `compile: ['prd-passthrough']` -> change to `['planner']`
- **`test/plan-parsing.test.ts:21`** - Same `ERRAND_PIPELINE` pattern -> change to `['planner']`
- **`test/plan-complete-depends-on.test.ts:8`** - `STUB_PROFILE` uses `compile: ['prd-passthrough']` -> change to `['planner']`
- **`test/agent-wiring.test.ts:802`** - Tests conflict detection between planner and prd-passthrough -> remove this test case
- **`test/pipeline.test.ts:154`** - `builtinCompileStages` list includes prd-passthrough -> remove it, update count
- **`test/pipeline.test.ts:727-729`** - Specific test for prd-passthrough in registry -> remove
- **`test/continuation.test.ts:152,197`** - YAML fixtures reference prd-passthrough -> change to `planner`

### 6. Keep writePlanArtifacts
**File:** `packages/engine/src/plan.ts`

`writePlanArtifacts()` (lines 549-598) stays - it is used by `test/adopt.test.ts` and may be useful for future adopt/import workflows.

## Scope

**In scope:**
- Deleting the `prd-passthrough` stage registration from `packages/engine/src/pipeline.ts`
- Removing `conflictsWith` reference to `prd-passthrough` from the planner stage
- Updating the comment referencing prd-passthrough in pipeline restart logic
- Updating `docs/architecture.md` (Mermaid diagram, stages table, errand profile description)
- Removing prd-passthrough special-case handling in `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`
- Updating all six test files that reference prd-passthrough

**Out of scope:**
- Changes to `packages/engine/src/prompts/pipeline-composer.md` (no changes needed)
- Removing `writePlanArtifacts()` from `packages/engine/src/plan.ts` (kept for adopt/import workflows)
- Defensive changes in `planner.ts`, `eforge.ts`, prompt strengthening, test updates, and MCP proxy (already applied in a prior build)

## Acceptance Criteria

- `pnpm test` - all tests pass
- `pnpm type-check` - no type errors
- `pnpm build` - build succeeds
- No references to `prd-passthrough` remain in the codebase (source, tests, docs) except `writePlanArtifacts` in `plan.ts` which is retained
- Eval `./run.sh --variant claude-sdk todo-api-errand-skip` - planner agent is invoked, `plan:skip` event emitted, exit 0
- Eval `./run.sh --variant pi-codex todo-api-errand-skip` - same expectations (planner invoked, `plan:skip`, exit 0)
