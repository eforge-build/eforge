---
title: Make `orchestration.yaml` the single canonical source for plan dependencies
created: 2026-04-25
---

# Make `orchestration.yaml` the single canonical source for plan dependencies

## Problem / Motivation

A live build (`build-failure-recovery-agent`) exposed a silent divergence: plan‑04's `dependsOn` reads as `['plan-03']` in `orchestration.yaml` and `state.json`, but `['plan-02']` in the `planning:complete` event the monitor UI consumes. The engine dispatched correctly (orchestration.yaml is its source of truth) but the UI rendered a wrong "Depends on: Plan 02" tooltip.

Root cause is structural, not a one‑line bug: the same `depends_on` fact is written to **four** representations — plan‑file `.md` frontmatter, `orchestration.yaml`, runtime `state.json`, and the `planning:complete` event payload — with `backfillDependsOn` (`packages/engine/src/pipeline/misc.ts:73-85`) acting as a band‑aid that only fills frontmatter when it is empty, never reconciling actual disagreement. Anything that updates one source (e.g. `plan-review-cycle`) without the other drifts silently.

## Goal

Eliminate the duplication by making **`orchestration.yaml` the single canonical source of `depends_on`**. Plan‑file frontmatter drops the field entirely, and every downstream representation (state, events, UI) is derived from `orchestration.yaml`.

## Approach

1. **Submission schema** stops accepting `dependsOn` in plan frontmatter (it stays in `orchestration.plans[]`). Cycle/dangling‑ref validation moves to the orchestration block.
2. **Writers** stop emitting `depends_on:` into `.md` frontmatter.
3. **Readers** stop pulling `depends_on` from `.md` frontmatter; `parsePlanFile` simply doesn't look at the field. Any stray value left in legacy on‑disk files is ignored silently.
4. **`backfillDependsOn` is deleted.** The compile‑stage interceptor populates `PlanFile.dependsOn` *authoritatively* from the freshly‑parsed `OrchestrationConfig`, so every `planning:complete` event payload mirrors `orchestration.yaml` exactly.
5. **Tests updated** so fixtures don't carry `depends_on` in frontmatter and submission‑schema tests assert the new shape. One new test asserts an authoritative override (frontmatter `depends_on` in legacy fixtures gets replaced, not preserved).

The monitor UI requires **no change** — once the event payload is correct, the existing `serveOrchestration` / `servePlans` endpoints serve correct data and `thread-pipeline.tsx`'s depth/tooltip render correctly.

## Scope

### In scope — files to modify

#### Engine — schema and submission
- `packages/engine/src/schemas.ts`
  - **L341‑354** `planSetSubmissionPlanSchema.frontmatter`: remove `dependsOn` field.
  - **L388‑432** `superRefine`: rewrite the dangling‑ref check (currently L391‑401) and the cycle check (L403‑432) to operate on `data.orchestration.plans[].dependsOn` instead of `data.plans[i].frontmatter.dependsOn`. Also assert: every orchestration plan ID must appear in `data.plans` and vice versa.

#### Engine — writers
- `packages/engine/src/plan.ts`
  - **L662‑704** `writePlanSet`: remove `depends_on: plan.frontmatter.dependsOn` (currently L672) from the per‑plan frontmatter object. The orchestration.yaml write at L686‑702 is unchanged — it remains the sole writer of `depends_on`.
- `packages/engine/src/compiler.ts`
  - **L101‑110** `compileExpedition`: remove `depends_on: dependsOn` from the per‑plan frontmatter object written at L101‑108. The orchestration.yaml write further down is unchanged.
  - The in‑memory `PlanFile[]` returned at L112‑119 must still carry `dependsOn` for the immediate `planning:complete` emit at `pipeline/stages/compile-stages.ts:491` — that's fine because `compileExpedition` already has the canonical deps in scope (from `mod.dependsOn` at L97‑99).

#### Engine — readers
- `packages/engine/src/plan.ts`
  - **L139‑196** `parsePlanFile`: stop reading `frontmatter.depends_on` (L188). Always set `dependsOn: []` on the returned `PlanFile`. Any stray `depends_on` key still present on disk in legacy files is ignored — no warning, no detection.
  - **`PlanFile.dependsOn`** field on `events.ts:46` stays in place but is now exclusively populated by the compile‑stage interceptor — it represents the **resolved** value sourced from orchestration.yaml, not parsed from frontmatter.

#### Engine — compile‑stage interceptor (the actual fix point)
- `packages/engine/src/pipeline/stages/compile-stages.ts`
  - **L86‑110**: replace the `backfillDependsOn(event.plans, orchConfig)` call (L102) with an **authoritative** mapper that, for each `event.plans[i]`, sets `dependsOn` to `orchConfig.plans.find(p => p.id === plan.id)?.dependsOn ?? []`. Same shape, opposite semantics: orch.yaml wins on every key, not just empty ones.
  - The `try`/`catch` fallback at L106‑109 currently sets `ctx.plans = event.plans` and falls through — keep, but the practical risk drops because there's no longer a stale frontmatter source to fall back to.

#### Engine — delete the band‑aid
- `packages/engine/src/pipeline/misc.ts`
  - **L73‑85** `backfillDependsOn`: delete.
- `packages/engine/src/pipeline/stages/compile-stages.ts`
  - **L35**: remove the `backfillDependsOn` import.

#### Tests
- `test/submission-schemas.test.ts` — drop `dependsOn` from frontmatter in all fixtures; add a test that submitting a frontmatter with `dependsOn` is rejected (or stripped, depending on chosen Zod behavior). Move dangling‑ref / cycle assertions to operate on `orchestration.plans`.
- `test/plan-parsing.test.ts` — drop `depends_on` from frontmatter fixtures. Confirm `parsePlanFile` returns `dependsOn: []` regardless of frontmatter content.
- `test/plan-writers.test.ts` — assert that `writePlanSet` does **not** emit `depends_on:` into per‑plan `.md` frontmatter and *does* emit it into `orchestration.yaml`.
- `test/orchestration-logic.test.ts` and `test/dependency-graph.test.ts` — these operate on `OrchestrationConfig.plans[].dependsOn`, not frontmatter; spot‑check fixtures, no logic change expected.
- `test/pipeline.test.ts` — add coverage for the new authoritative mapper: build a `planning:complete` flowing through the compile interceptor where the input `PlanFile.dependsOn` is *intentionally wrong*, assert the emitted event has `dependsOn` matching `orchConfig`.

### Out of scope — no change required
- `packages/engine/src/orchestrator.ts:99-143` — already reads from `OrchestrationConfig`.
- `packages/engine/src/orchestrator/phases.ts` — dispatcher already gates on `state.plans[id].dependsOn`.
- `packages/monitor/src/server.ts:294-343, 475-556` — endpoints stay; the event payload they read is now correct.
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — depth/tooltip render is correct once data is.
- `packages/pi-eforge/extensions/eforge/index.ts:480` — type declaration only.
- `packages/engine/src/plan.ts:71-94, 117-136` (expedition `index.yaml` modules) — index.yaml stays the canonical source for the **architecture** phase; it gets compiled into orchestration.yaml downstream. No change.

## Acceptance Criteria

1. **Type‑check + tests**:
   ```bash
   pnpm type-check
   pnpm test
   ```
   All existing tests pass (with fixtures updated). New tests cover: schema rejects `dependsOn` in frontmatter; `parsePlanFile` warns on legacy frontmatter; compile‑stage interceptor overrides input `dependsOn` from orch config.

2. **Live‑build smoke test** — enqueue a small excursion via the daemon (e.g. a 2‑plan PRD) and confirm:
   - Generated plan‑file `.md` frontmatter contains no `depends_on:` key.
   - `orchestration.yaml` contains correct `depends_on:` per plan.
   - In the monitor UI, the dependency tooltip on each plan badge matches `orchestration.yaml`.
   - Depth bars on plan rows render the expected count (depth = longest dep chain).

3. **Regression test against the failing build's shape** — construct a fixture submission where the LLM (hypothetically) submits `frontmatter.dependsOn = [plan-02]` and `orchestration.dependsOn = [plan-03]`. Pre‑fix this asymmetry was silently accepted; post‑fix the schema rejects the submission (because the frontmatter field no longer exists). This is the regression guard for the bug we just diagnosed.

4. **Manual UI check on the in‑flight build**: after the fix is deployed and the daemon restarted, the *next* build will render correctly. The existing `build-failure-recovery-agent` build will keep its stale event payload (events are immutable in `monitor.db`), so its tooltip will remain wrong until that session ends — acceptable, no fix‑forward needed for in‑flight data.
