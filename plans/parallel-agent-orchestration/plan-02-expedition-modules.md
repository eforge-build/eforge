---
id: plan-02-expedition-modules
name: Parallel Expedition Module Planning
depends_on: [plan-01-run-parallel]
branch: parallel-agent-orchestration/expedition-modules
---

# Parallel Expedition Module Planning

## Architecture Context

Expedition module planners are independent - each writes to its own file (`plans/{set}/modules/{id}.md`) and reads shared context (architecture doc, PRD) read-only. The sequential `for (const mod of modules)` loop in `planExpeditionModules()` is an unnecessary bottleneck. With `runParallel` available from plan-01, this is a straightforward swap.

## Implementation

### Overview

Replace the sequential module planner loop in `EforgeEngine.planExpeditionModules()` (lines 617-645 of `eforge.ts`) with a `runParallel` call. Each module becomes a `ParallelTask` whose `run()` wraps the existing `runModulePlanner()` call with Langfuse tracing spans. No changes to `module-planner.ts`, `display.ts` (already keys spinners by `mod:${moduleId}`), `recorder.ts`, or `events.ts`.

### Key Decisions

1. **No assessment needed** - if you have expedition modules, always parallelize. Each module planner is isolated by definition (writes to its own file, reads shared context read-only).
2. **Parallelism uses `availableParallelism()`** - matches the default from config. Could also thread `config.build.parallelism` but module planning is I/O-bound (LLM calls), so OS-level parallelism is the right default.
3. **Error handling preserves existing behavior** - module planning failure is non-fatal (catch, log, continue). The `run()` generator wraps the error in a try/catch and yields nothing on failure, matching the current sequential behavior.

## Scope

### In Scope
- Replace sequential loop with `runParallel` in `planExpeditionModules()`
- Preserve Langfuse tracing per module (each task creates its own span)
- Preserve non-fatal error handling per module

### Out of Scope
- Changes to `module-planner.ts` agent
- Changes to event types or display rendering
- Multi-perspective review (plan-03)

## Files

### Modify
- `src/engine/eforge.ts` - Replace the sequential `for (const mod of modules)` loop in `planExpeditionModules()` with `runParallel`. Each module maps to a `ParallelTask` with `id: mod.id` and a `run()` generator that wraps `runModulePlanner()` with tracing. Import `runParallel` from `concurrency.ts` and `availableParallelism` from `node:os`.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - no regressions
- [ ] `pnpm build` produces `dist/cli.js` without errors
- [ ] `planExpeditionModules()` no longer contains a sequential `for` loop over modules - it delegates to `runParallel`
- [ ] Each module task creates a Langfuse span with `moduleId` metadata (same as current behavior)
- [ ] Module planning failure for one module does not prevent other modules from running (non-fatal)
