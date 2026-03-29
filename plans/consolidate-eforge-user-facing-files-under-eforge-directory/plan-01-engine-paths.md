---
id: plan-01-engine-paths
name: Engine Config Defaults, Path Wiring, and Prompt Templates
depends_on: []
branch: consolidate-eforge-user-facing-files-under-eforge-directory/engine-paths
---

# Engine Config Defaults, Path Wiring, and Prompt Templates

## Architecture Context

This plan changes the foundational path defaults and wires `config.plan.outputDir` through all engine consumers. Currently `plan.outputDir` is defined in config but never consumed - all plan directory references are hardcoded as `'plans'`. Similarly, `prdQueue.dir` defaults to `'docs/prd-queue'`. This plan updates defaults, fixes config discovery to look for the new config location, adds a legacy migration warning, and replaces all hardcoded `'plans'` references with config-driven paths.

## Implementation

### Overview

Three categories of changes:
1. Update `DEFAULT_CONFIG` defaults and `findConfigFile()` discovery logic
2. Replace every hardcoded `resolve(cwd, 'plans', ...)` with `resolve(cwd, config.plan.outputDir, ...)`
3. Add `{{outputDir}}` template variable to all prompt files that reference `plans/`

### Key Decisions

1. `findConfigFile()` searches for `eforge/config.yaml` (walk-up). If not found, checks for legacy `eforge.yaml` at `startDir` only, logs a stderr warning with migration instructions, and returns `null`. This avoids silently loading the old config.
2. The `PipelineContext` already has access to `ctx.config.plan.outputDir` so engine pipeline stages can read the output dir directly - no new plumbing needed.
3. Prompt template variable is named `{{outputDir}}` to match the config field name `plan.outputDir`.

## Scope

### In Scope
- Changing `DEFAULT_CONFIG.plan.outputDir` from `'plans'` to `'eforge/plans'`
- Changing `DEFAULT_CONFIG.prdQueue.dir` from `'docs/prd-queue'` to `'eforge/queue'`
- Updating `findConfigFile()` to search for `eforge/config.yaml` with legacy `eforge.yaml` detection
- Replacing all hardcoded `'plans'` path references in `pipeline.ts`, `eforge.ts`, `plan.ts`, `compiler.ts`, `agents/planner.ts`
- Adding `{{outputDir}}` template variable to 6 prompt files and passing it from 6 agent files

### Out of Scope
- Monitor server path fixes (plan-02)
- CLI help text and MCP description updates (plan-02)
- Test updates (plan-02)
- Documentation updates and file moves (plan-03)

## Files

### Modify
- `src/engine/config.ts` - Change `DEFAULT_CONFIG.plan.outputDir` to `'eforge/plans'`, `DEFAULT_CONFIG.prdQueue.dir` to `'eforge/queue'`, update `findConfigFile()` to look for `eforge/config.yaml` with legacy detection and stderr warning
- `src/engine/pipeline.ts` - Replace 7 instances of `resolve(cwd, 'plans', ...)` with `resolve(cwd, ctx.config.plan.outputDir, ...)` (lines ~423, 442, 524, 620, 664, 777, 1439)
- `src/engine/eforge.ts` - Replace 5 instances of hardcoded `'plans'` with `config.plan.outputDir` (lines ~252, 393, 405, 887, 891)
- `src/engine/plan.ts` - Replace `resolve(cwd, 'plans', planSetName)` with config-driven path (line ~491); add `outputDir` parameter to `writePlanArtifacts`
- `src/engine/compiler.ts` - Replace `resolve(cwd, 'plans', planSetName)` with config-driven path (line ~33)
- `src/engine/agents/planner.ts` - Replace hardcoded `'plans'` (line ~330), add `outputDir` to `loadPrompt` template vars
- `src/engine/agents/plan-reviewer.ts` - Add `outputDir` to `loadPrompt` template vars (pass `plan_output_dir` from config)
- `src/engine/agents/plan-evaluator.ts` - Add `outputDir` to `loadPrompt` template vars via `promptVars`
- `src/engine/agents/cohesion-reviewer.ts` - Add `outputDir` to `loadPrompt` template vars
- `src/engine/agents/architecture-reviewer.ts` - Add `outputDir` to `loadPrompt` template vars
- `src/engine/agents/module-planner.ts` - Add `outputDir` to `loadPrompt` template vars
- `src/engine/prompts/planner.md` - Replace all hardcoded `plans/` path references with `{{outputDir}}/`
- `src/engine/prompts/plan-reviewer.md` - Replace `plans/{{plan_set_name}}/` with `{{outputDir}}/{{plan_set_name}}/`
- `src/engine/prompts/plan-evaluator.md` - Replace `plans/{{plan_set_name}}/` with `{{outputDir}}/{{plan_set_name}}/`
- `src/engine/prompts/cohesion-reviewer.md` - Replace `plans/{{plan_set_name}}/` with `{{outputDir}}/{{plan_set_name}}/`
- `src/engine/prompts/architecture-reviewer.md` - Replace `plans/{{plan_set_name}}/` with `{{outputDir}}/{{plan_set_name}}/`
- `src/engine/prompts/module-planner.md` - Replace `plans/{{planSetName}}/` with `{{outputDir}}/{{planSetName}}/`

## Verification

- [ ] `pnpm build` compiles with zero errors
- [ ] `DEFAULT_CONFIG.plan.outputDir` equals `'eforge/plans'`
- [ ] `DEFAULT_CONFIG.prdQueue.dir` equals `'eforge/queue'`
- [ ] `findConfigFile()` returns `null` when only legacy `eforge.yaml` exists (no `eforge/config.yaml`)
- [ ] `findConfigFile()` returns the path to `eforge/config.yaml` when it exists
- [ ] Zero occurrences of `resolve(cwd, 'plans',` or `resolve(commitCwd, 'plans',` or `resolve(mergeWorktreePath, 'plans',` or `resolve(planBaseCwd, 'plans',` remain in `src/engine/pipeline.ts`, `src/engine/eforge.ts`, `src/engine/plan.ts`, `src/engine/compiler.ts`, `src/engine/agents/planner.ts`
- [ ] All 6 prompt files use `{{outputDir}}` instead of hardcoded `plans/`
- [ ] All 6 agent files pass `outputDir` (or equivalent key) in `loadPrompt` template vars
