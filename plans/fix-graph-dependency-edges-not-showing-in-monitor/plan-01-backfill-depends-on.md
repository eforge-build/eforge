---
id: plan-01-backfill-depends-on
name: Backfill dependsOn from orchestration.yaml into plan:complete events
dependsOn: []
branch: fix-graph-dependency-edges-not-showing-in-monitor/backfill-depends-on
---

# Backfill dependsOn from orchestration.yaml into plan:complete events

## Architecture Context

The monitor's Graph tab renders dependency edges from `plan:complete` events, but the planner agent writes `depends_on` only to `orchestration.yaml` - not to individual plan file frontmatter. The `parsePlanFile()` function returns empty `dependsOn` arrays, so `plan:complete` events carry no dependency data and the graph shows disconnected nodes.

The fix enriches `plan:complete` events in the `planner` compile stage by cross-referencing `orchestration.yaml` after the planner writes it. This is the single authoritative join point where both data sources are available.

## Implementation

### Overview

In the `planner` compile stage in `src/engine/pipeline.ts`, after injecting the profile into `orchestration.yaml`, parse the orchestration config and backfill `dependsOn` from it into each plan in the `plan:complete` event before yielding.

### Key Decisions

1. **Enrich at the pipeline level, not at parse time** - `parsePlanFile()` reads individual `.md` files that genuinely lack dependency data. The authoritative source is `orchestration.yaml`, so enrichment belongs where both are available: the pipeline stage.
2. **Graceful fallback on parse failure** - If `orchestration.yaml` cannot be parsed (shouldn't happen since the planner just wrote it, but defensive), fall through to yield the original event unchanged.
3. **Use `continue` to avoid double-yield** - After yielding the enriched event, `continue` skips the default `yield event` at the bottom of the loop.

## Scope

### In Scope
- Adding `parseOrchestrationConfig` to imports from `./plan.js` in `pipeline.ts`
- Enriching `plan:complete` events with `dependsOn` from `orchestration.yaml` in the planner stage
- Unit test for the backfill logic

### Out of Scope
- Changes to the monitor, `parsePlanFile()`, `prd-passthrough`, or `compile-expedition` stages
- Modifying how the planner agent writes plan files or `orchestration.yaml`

## Files

### Modify
- `src/engine/pipeline.ts` - Add `parseOrchestrationConfig` to the import from `./plan.js`. In the planner stage's `plan:complete` handler (lines 406-412), after `injectProfileIntoOrchestrationYaml`, parse the orchestration config, build a `planId -> dependsOn` map, merge into `event.plans`, update `ctx.plans`, yield the enriched event, and `continue`.

### Create
- `test/plan-complete-depends-on.test.ts` - Test that verifies the backfill logic: given a `plan:complete` event with empty `dependsOn` and an `orchestration.yaml` with populated `depends_on`, the enriched event carries the correct dependencies. Also test the fallback path where `orchestration.yaml` is missing/unparseable.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm build` produces `dist/cli.js` without errors
- [ ] New test in `test/plan-complete-depends-on.test.ts` covers both the enrichment path and the fallback path
