---
id: plan-01-canonicalize-orch-deps
name: Canonicalize plan deps in orchestration.yaml
depends_on: []
branch: make-orchestration-yaml-the-single-canonical-source-for-plan-dependencies/canonicalize-orch-deps
---

# Canonicalize plan deps in orchestration.yaml

## Architecture Context

A live build (`build-failure-recovery-agent`) exposed a silent divergence: plan-04's `dependsOn` read as `['plan-03']` in `orchestration.yaml` and `state.json`, but `['plan-02']` in the `planning:complete` event the monitor UI consumed. The engine dispatched correctly because `orchestration.yaml` is its source of truth, but the UI rendered a wrong tooltip from the event payload.

The root cause is structural: `depends_on` is currently written into **four** representations:

1. Plan-file `.md` YAML frontmatter (`depends_on:` key).
2. `orchestration.yaml` (`plans[].depends_on`).
3. Runtime `state.json` (derived from orchestration.yaml).
4. The `planning:complete` event payload (built from the planner's `PlanFile[]`, which reads frontmatter).

`backfillDependsOn` in `packages/engine/src/pipeline/misc.ts` is a band-aid: it copies orchestration deps into `PlanFile.dependsOn` only when the latter is empty, never when the two genuinely disagree. Anything that updates one source without the other (e.g. plan-review-cycle) drifts silently.

This plan eliminates the duplication: **`orchestration.yaml` becomes the single canonical source of `depends_on`**. Plan-file frontmatter drops the field; downstream representations (state, events, UI) are derived from `orchestration.yaml` via an authoritative compile-stage interceptor that overrides `PlanFile.dependsOn` on every key, not just empty ones.

The monitor UI requires no change — once the event payload mirrors `orchestration.yaml`, `serveOrchestration` / `servePlans` and `thread-pipeline.tsx`'s tooltip render correctly.

## Implementation

### Overview

Four coordinated edits to the engine source plus tests:

1. **Submission schema** stops accepting `dependsOn` in plan-file frontmatter (it stays in `orchestration.plans[]`). Cycle and dangling-ref validation moves onto the orchestration block.
2. **Writers** (`plan.ts:writePlanSet` and `compiler.ts:compileExpedition`) stop emitting `depends_on:` into `.md` frontmatter. The orchestration.yaml writes are unchanged — they remain the sole writers of `depends_on`.
3. **Reader** (`plan.ts:parsePlanFile`) stops reading `frontmatter.depends_on`; it always returns `dependsOn: []`. Any stray legacy value on disk is silently ignored.
4. **Compile-stage interceptor** (`pipeline/stages/compile-stages.ts`) replaces the `backfillDependsOn` call with an authoritative mapper that sets `event.plans[i].dependsOn` to `orchConfig.plans.find(p => p.id === plan.id)?.dependsOn ?? []`. `backfillDependsOn` itself is deleted.

The in-memory `PlanFile[]` returned from `compileExpedition` continues to carry `dependsOn` for the immediate `planning:complete` emit at `pipeline/stages/compile-stages.ts:491` — that path already has the canonical deps in scope from `mod.dependsOn`, so it stays correct.

### Key Decisions

1. **Authoritative override, not merge.** The interceptor unconditionally replaces `event.plans[i].dependsOn` with the orchestration value, even if the input was non-empty. This is the opposite semantic of `backfillDependsOn` (which only filled empties) and is the actual fix for the silent-divergence bug.
2. **No legacy migration, no warning.** `parsePlanFile` simply does not look at `frontmatter.depends_on`. Stray keys in legacy on-disk files are ignored. There is no detection log because the field is no longer part of the schema and the planner can no longer write it.
3. **Schema rejects `dependsOn` in plan frontmatter.** `planSetSubmissionPlanSchema.frontmatter` removes the field. With Zod's default behavior, unknown fields are stripped silently — the new test asserts the resulting submission has `dependsOn` only on the orchestration block. (If Zod is configured with `.strict()` elsewhere, the submission is rejected outright; either is acceptable.)
4. **Validation moves to the orchestration block.** Cycle detection and dangling-ref checks run on `data.orchestration.plans[].dependsOn`. The schema also already asserts `orchIds` matches `planIdSet` — that stays.
5. **No backward-compat shim.** Per project convention, we rip out `backfillDependsOn` cleanly rather than leaving a deprecated alias.

## Scope

### In Scope

- Engine schema change in `schemas.ts` (drop `dependsOn` from plan frontmatter, move validation onto orchestration).
- Writer changes in `plan.ts` and `compiler.ts` (stop emitting `depends_on:` into `.md` frontmatter).
- Reader change in `plan.ts:parsePlanFile` (stop reading `frontmatter.depends_on`; always `[]`).
- Compile-stage interceptor rewrite in `pipeline/stages/compile-stages.ts` (authoritative mapper replaces `backfillDependsOn`).
- Deletion of `backfillDependsOn` from `pipeline/misc.ts` and its import.
- Test updates: `submission-schemas.test.ts`, `plan-parsing.test.ts`, `plan-writers.test.ts`, `pipeline.test.ts`. Spot-check `orchestration-logic.test.ts` and `dependency-graph.test.ts`.

### Out of Scope

- `packages/engine/src/orchestrator.ts` and `orchestrator/phases.ts` — already read deps from `OrchestrationConfig` / `state.plans[id].dependsOn`.
- `packages/monitor/src/server.ts` — endpoints unchanged; the data they serve is now correct.
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — render is correct once payload is.
- `packages/pi-eforge/extensions/eforge/index.ts:480` — type declaration only.
- `packages/engine/src/plan.ts` expedition `index.yaml` modules code — `index.yaml` remains canonical for the architecture phase; it gets compiled into `orchestration.yaml` downstream by `compileExpedition`.
- The currently-running `build-failure-recovery-agent` build — its event payload is already persisted in `monitor.db` (events are immutable). The fix applies to subsequent builds only.

## Files

### Modify

- `packages/engine/src/schemas.ts`
  - In `planSetSubmissionPlanSchema.frontmatter` (around L374-387): remove the `dependsOn: z.array(z.string())...` line.
  - In `superRefine` (around L406-484): the dangling-ref loop currently iterates `data.plans[i].frontmatter.dependsOn` (L424-434) and the cycle check builds `adjMap` from `plan.frontmatter.dependsOn` (L437-440). Rewrite both to iterate `data.orchestration.plans[].dependsOn` instead. The existing assertion that orchestration plan IDs match submitted plan IDs (L468-483) stays as-is.
- `packages/engine/src/plan.ts`
  - `parsePlanFile` (L139-196): change L188 from `dependsOn: Array.isArray(frontmatter.depends_on) ? frontmatter.depends_on : []` to `dependsOn: []`. Remove any reference to `frontmatter.depends_on` in the function body.
  - `writePlanSet` (L662-704): remove `depends_on: plan.frontmatter.dependsOn` (L672) from the per-plan frontmatter object. The orchestration.yaml write at L686-702 is unchanged.
- `packages/engine/src/compiler.ts`
  - `compileExpedition` (around L101-110): remove `depends_on: dependsOn` from the per-plan frontmatter object. The in-memory `PlanFile[]` push at L112-119 keeps `dependsOn` as a TS field — that's fine and required for the immediate `planning:complete` emit. The orchestration.yaml write further down is unchanged.
- `packages/engine/src/pipeline/stages/compile-stages.ts`
  - L35: remove the `import { backfillDependsOn } from '../misc.js';` line.
  - L86-110: replace the `backfillDependsOn(event.plans, orchConfig)` call (L102) with an authoritative mapper. Concretely:
    ```ts
    const depsById = new Map(orchConfig.plans.map(p => [p.id, p.dependsOn]));
    const enrichedPlans = event.plans.map(plan => ({
      ...plan,
      dependsOn: depsById.get(plan.id) ?? [],
    }));
    ```
    Keep the surrounding `try`/`catch` exactly as-is — on parse failure, fall back to `ctx.plans = event.plans` and yield the original event unchanged.
- `packages/engine/src/pipeline/misc.ts`
  - Delete the `backfillDependsOn` function (L73-85) and its docblock (L68-72). Remove any now-unused imports (`PlanFile`, `OrchestrationConfig`) if they're no longer referenced elsewhere in the file.
- `test/submission-schemas.test.ts`
  - Drop `dependsOn` from every `frontmatter` literal in fixtures.
  - Add a test: a submission whose plan frontmatter contains `dependsOn: ['plan-02']` parses successfully but the parsed value has no `dependsOn` on `frontmatter` (Zod strips it), or — if the schema is strict — is rejected. Pick whichever Zod default applies in the codebase and assert it explicitly.
  - Move the dangling-ref test fixture to put bad refs on `orchestration.plans[].dependsOn` rather than `plans[].frontmatter.dependsOn`. Same for the cycle test.
- `test/plan-parsing.test.ts`
  - Drop `depends_on:` lines from every `.md` frontmatter fixture.
  - Add a test: feed `parsePlanFile` a fixture string whose frontmatter still contains `depends_on: [plan-99]` (legacy on-disk leftover) and assert the returned `PlanFile.dependsOn` is `[]`.
- `test/plan-writers.test.ts`
  - Add an assertion that the generated `.md` frontmatter has no `depends_on:` key (e.g. `expect(fileContent).not.toContain('depends_on')`).
  - Add an assertion that the generated `orchestration.yaml` does contain `depends_on:` for plans that have deps (existing fixtures probably already cover this; verify and keep).
- `test/pipeline.test.ts`
  - Add a test for the new authoritative mapper. Construct a `planning:complete` event whose `plans[]` contains `{ id: 'plan-02', dependsOn: ['plan-99-WRONG'] }` and an `orchConfig` whose `plans` says `{ id: 'plan-02', dependsOn: ['plan-01'] }`. Run the compile-stage interceptor and assert the emitted event's `plans[0].dependsOn === ['plan-01']`. This is the regression guard for the silent-divergence bug.
- `test/orchestration-logic.test.ts` and `test/dependency-graph.test.ts`
  - Read these and confirm they operate on `OrchestrationConfig.plans[].dependsOn`, not on plan frontmatter. If any fixtures still embed `depends_on:` in plan frontmatter, drop the field. No logic change is expected.

## Verification

- [ ] `pnpm type-check` exits with status 0.
- [ ] `pnpm test` passes with all updated fixtures and new tests.
- [ ] `Grep` for `frontmatter.depends_on` and `frontmatter.dependsOn` across `packages/engine/src/` returns zero matches.
- [ ] `Grep` for `backfillDependsOn` across `packages/engine/src/` returns zero matches.
- [ ] The `planSetSubmissionPlanSchema.frontmatter` Zod object has no `dependsOn` field; running the schema against `{ frontmatter: { id, name, branch, dependsOn: [...] }, ... }` either strips `dependsOn` (default Zod) or returns a parse error (if strict) — whichever applies is asserted in `test/submission-schemas.test.ts`.
- [ ] New test in `test/pipeline.test.ts` covers the authoritative-override case: input `PlanFile.dependsOn` of `['plan-99-WRONG']` is replaced with `['plan-01']` from `orchConfig` in the emitted `planning:complete` event.
- [ ] New test in `test/plan-parsing.test.ts` confirms `parsePlanFile` returns `dependsOn: []` even when the on-disk `.md` frontmatter contains `depends_on: [plan-99]`.
- [ ] New test in `test/plan-writers.test.ts` confirms `writePlanSet` emits no `depends_on:` line in any per-plan `.md` file and emits one in `orchestration.yaml` for plans with deps.
- [ ] `Grep` of `eforge/plans/*/plan-*.md` for newly-generated plan files (run a smoke build) returns zero `depends_on:` matches in plan-file frontmatter.
- [ ] In a smoke-test build, `eforge/plans/<set>/orchestration.yaml` contains the expected `depends_on:` per plan and the monitor UI's plan-badge tooltip matches it on every plan.
