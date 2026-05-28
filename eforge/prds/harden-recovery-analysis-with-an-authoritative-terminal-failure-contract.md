---
title: Harden Recovery Analysis With an Authoritative Terminal Failure Contract
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Harden Recovery Analysis With an Authoritative Terminal Failure Contract

## Problem / Motivation

Recovery sidecars can be materially misleading for builds that fail after successful plan completion and validation, especially during landing/artifact recording.

Evidence from the failed build `console-ui-read-only-planning-workspace-for-session-plans` shows recovery sidecars can misidentify the terminal failure when an old agent max-turn error is followed by successful plan completion, successful validation, and then a landing/artifact-recording failure.

Affected users include anyone relying on `.recovery.md`, `.recovery.json`, console recovery views, or `apply-recovery` decisions to decide whether to retry, split, or manually land a build.

The bad diagnosis directs users toward re-running or fixing plan/test work that is already complete, instead of addressing landing hygiene. It also makes recovery automation less trustworthy.

Roadmap alignment: this supports the Console Workbench / Actionable build control direction by making recovery diagnostics more reliable for build control and retry/recovery workflows.

### Observed Failed Run Evidence

Relevant observed event sequence from `.eforge/monitor.db` run `a2ee9de9-8b1e-4be6-b853-e65b5d475278`:

- `agent:stop` for `plan-02-console-plans-workspace` tester reported `Reached maximum number of turns (80)` at event `349896`.
- Later `plan:status:change` events marked the same plan `completed` and `merged` at events `350943` / `350939`.
- Final validation passed at event `351040` after `pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm maintainability:check`, targeted session-plan tests, and console-ui tests all exited 0.
- PRD validation and acceptance validation passed at events `351046` and `351047`.
- The real terminal failure was `daemon:error` with `source: stack:artifact-recording` at event `351048`, followed by `landing:skipped` at `351049` and failed `phase:end` at `351051`.
- The error was that the merge worktree had uncommitted `node_modules` symlinks.

### Current Code Evidence

- `packages/engine/src/recovery/event-history.ts` synthesizes summaries from monitor DB.
- When `plan:build:failed` rows exist, `event-history.ts` treats those as failures.
- When `plan:build:failed` rows do not exist, `event-history.ts` handles PRD-validation and acceptance-validation failures, then falls back to the latest `agent:stop` with an error before failed `phase:end`.
- The fallback does not currently check whether that errored agent belongs to a plan that later completed or merged.
- The fallback does not currently recognize post-validation terminal events such as `daemon:error` with `source: stack:artifact-recording`, `landing:skipped`, or failed `phase:end` landing summaries.
- `packages/engine/src/recovery/failure-summary.ts` calls `synthesizeFromEvents()` but only sets `result.partial = true` when no event fragment exists.
- If event synthesis returns `{ partial: true }`, `failure-summary.ts` drops that flag.
- `packages/engine/src/recovery/sidecar.ts` can already render `terminalFailure`, `validationCommands`, and `landing` sections.
- `packages/client/src/events.schemas.ts` already includes `BuildFailureSummary.terminalFailure`, `validationCommands`, `landing`, `failingPlans`, and plan status fields.

### Reproduction Steps

1. Inspect `.eforge/queue/failed/console-ui-read-only-planning-workspace-for-session-plans.recovery.json`.
2. Observe the sidecar summary reports `plans: [{ planId: plan-02-console-plans-workspace, status: failed, error: Reached maximum number of turns (80) }]` and `failingPlan.agentRole: tester`.
3. Query `.eforge/monitor.db` for run `a2ee9de9-8b1e-4be6-b853-e65b5d475278`.
4. Observe event `349896` is an older `agent:stop` tester max-turn error for `plan-02-console-plans-workspace`.
5. Observe later events `350943` and `350939` mark `plan-02-console-plans-workspace` `completed` and `merged`.
6. Observe event `351040` reports `validation:complete` with `passed: true`.
7. Observe events `351046` and `351047` report PRD validation and acceptance validation passed.
8. Observe event `351048` reports `daemon:error` with `source: stack:artifact-recording` and a message about 8 uncommitted `node_modules` symlinks in the merge worktree.
9. Observe event `351049` reports `landing:skipped` because stack artifact recording failed.
10. Observe event `351051` reports failed `phase:end` with the same artifact-recording summary.

Expected behavior: recovery summary and sidecars identify the terminal failure as landing/artifact-recording, include the successful plan/validation evidence, and avoid presenting the old tester max-turn event as the current failed plan.

Actual behavior: recovery summary falls back to the stale `agent:stop` error and omits the landing/artifact-recording terminal failure.

### Root Cause

1. `packages/engine/src/recovery/event-history.ts` has an `else` path for runs with no `plan:build:failed` events.
2. That path handles failed PRD validation and failed acceptance validation, then falls through to a generic `agent:stop` fallback.
3. The generic `agent:stop` fallback selects the newest errored agent stop before failed `phase:end`, regardless of whether later plan status events superseded it.
4. There is no terminal-failure branch for landing/artifact-recording evidence after validation has passed.
5. Relevant event types already present in the monitor DB include `daemon:error` with `source: stack:artifact-recording`, `landing:skipped`, `stack:landing:update`, and failed `phase:end` summary.
6. Because the old tester max-turn event was the newest `agent:stop` with an error, recovery selected it even though the same plan later completed and merged.
7. `packages/engine/src/recovery/failure-summary.ts` drops `eventFragment.partial === true`; it only sets `result.partial = true` when there is no event fragment.
8. Dropping `eventFragment.partial === true` can make fallback-derived sidecars look more authoritative than their event-history synthesis really is.

## Goal

Build a durable recovery-analysis direction by introducing an authoritative terminal failure contract for failed engine runs/build phases.

Recovery summary construction should prefer this authoritative terminal failure record over inferred event-history fallbacks, while keeping degraded fallback reconstruction available for old runs and marking inferred summaries as partial.

## Approach

### Profile Signal

Recommended profile: **excursion**.

Rationale: this is an architectural hardening slice, but the module boundary is clear: shared event schema, engine failure emission, recovery summary synthesis, and tests. It does not require delegated module planning; a single cohesive plan can cover the failure contract, fallback behavior, and regression fixtures.

### High-Level Implementation Direction

- Update `packages/engine/src/recovery/event-history.ts` to detect post-validation landing/artifact failures before the `agent:stop` fallback.
- Reconstruct latest plan statuses in the no-`plan:build:failed` path so stale errored agent stops for completed/merged plans are ignored.
- Include validation command results and landing details in the landing/artifact failure summary where available.
- Preserve or intentionally set `partial` semantics in `packages/engine/src/recovery/failure-summary.ts` so partial/fallback synthesis remains visible in sidecars.
- Add regression tests in `test/recovery.test.ts`, likely near the existing `buildFailureSummary multi-plan reconstruction` region, with a DB fixture that mirrors the observed event sequence.
- Prefer a precise terminal failure stage such as `landing-artifact-recording` or `landing` over any stale plan-level agent error when the failed phase summary or daemon error says landing failed.
- Keep `failingPlan` backward compatible by using a synthetic plan ID such as `landing` or `artifact-recording` when the failure is not plan-specific.
- Do not populate `failingPlans` for non-plan terminal failures unless there are current failed plans.
- Ensure deterministic recommendation remains conservative/manual for non-plan terminal failures, while the sidecar explains the real stage.
- If validation passed, include validation/acceptance evidence so users can see implementation was complete and the remaining action is landing hygiene.

### Desired Architecture

Introduce a typed terminal failure envelope, likely in `@eforge-build/client` event schemas and engine event types, with fields such as:

- `scope`: one of `plan | post-merge-validation | prd-validation | acceptance-validation | landing | artifact-recording | daemon | compile | unknown`.
- `message`.
- `sourceEventType`.
- `sourceEventId` when available from monitor DB reconstruction, or source event metadata when emitted live.
- `planId` only when the terminal failure is genuinely plan-scoped.
- `phaseSummary` / `phaseStatus`.
- `landing` status/action/reason when applicable.
- `validationPassed`, `prdValidationPassed`, and/or `acceptanceValidationPassed` when known.
- `authoritative: true | false`.

Emit the terminal failure envelope when the engine determines `status = failed` for the run, before or with `phase:end`.

Store and replay the terminal failure event through existing monitor DB event recording rather than introducing a parallel state store.

Update recovery summary creation to prefer the terminal failure envelope. Event-history inference should run only when the envelope is absent and should return `partial: true` / `authoritative: false`.

Preserve the existing `BuildFailureSummary.terminalFailure`, `landing`, `validationCommands`, `acceptanceValidation`, `plans`, and `failingPlans` fields by mapping the terminal envelope into them.

### Current Architecture Impact

- Recovery currently reconstructs terminal cause after the run from many event types in `packages/engine/src/recovery/event-history.ts`.
- The reconstruction path treats plan-level, post-merge-validation-level, PRD-validation-level, acceptance-validation-level, landing-level, and daemon-level events as comparable evidence.
- The reconstruction path does not have a single authoritative statement of why the engine marked the run failed.
- `buildSinglePrd()` in `packages/engine/src/eforge.ts` already maintains `status` and `summary` while draining orchestrator events.
- `buildSinglePrd()` is the point where the engine knows the terminal run result.
- `orchestrator/phases.ts` emits landing events and mutates final state.
- The failed `phase:end` currently carries only `{ status, summary }`, not a typed failure scope/cause/source.

### Design Decisions

1. Recovery should prefer authority over inference.
   - Decision: add a terminal failure envelope/event and make `buildFailureSummary()` consume it first.
   - Rationale: this avoids repeatedly patching heuristic precedence in `event-history.ts`.

2. The terminal failure envelope should be run-level, not always plan-level.
   - Decision: represent failure scope explicitly with exact schema values: `plan`, `post-merge-validation`, `prd-validation`, `acceptance-validation`, `landing`, `artifact-recording`, `daemon`, `compile`, and `unknown`.
   - Rationale: the observed failure had no current failed plan; forcing it into a real plan failure created the misleading sidecar.
   - Validation note: current event names distinguish post-merge validation (`validation:complete`), PRD validation (`prd_validation:complete`), and acceptance validation (`acceptance_validation:complete`), so the taxonomy should not collapse these into ambiguous `validation` / `acceptance` labels.

3. Plan IDs must be current, not historical.
   - Decision: only set `planId` on the terminal envelope when the terminal cause is still plan-scoped and not superseded by later `completed` or `merged` state.
   - Rationale: an old `agent:stop` can be useful context but must not become the terminal cause after later success.

4. Backward-compatible plan fields must not blur real plan failures and run-level failures.
   - Decision: if the existing `BuildFailureSummary` schema still requires `failingPlan`, non-plan failures may use a synthetic `failingPlan.planId` such as `landing` or `artifact-recording`.
   - Decision: `failingPlans` should include only real currently-failed plans.
   - Rationale: this preserves consumers that expect `failingPlan` while preventing multi-plan recommendation logic from treating landing/artifact failures as actual plan failures.

5. Event-history reconstruction remains a fallback.
   - Decision: keep `synthesizeFromEvents()` for old runs and incomplete DBs, but mark inferred summaries as `partial: true` / `authoritative: false`.
   - Rationale: old failed builds will not have the new terminal event, and recovery should still produce best-effort output without overstating confidence.

6. Use existing sidecar fields where possible.
   - Decision: map terminal envelope data into `BuildFailureSummary.terminalFailure`, `landing`, `validationCommands`, and existing plan fields rather than creating a separate sidecar-only report.
   - Rationale: minimizes UI/client churn and preserves current sidecar readability.

7. Regression tests should cover failure-class precedence.
   - Decision: add tests for stale agent failure superseded by plan merge and final artifact-recording failure.
   - Decision: add tests for partial propagation.
   - Decision: add at least one authoritative-terminal-event test proving recovery ignores older misleading events.
   - Rationale: this guards both the new design and the known bug.

### Compatibility

- Existing sidecars remain JSON schema version 2 unless the summary shape requires a schema increment.
- Existing plan-level recovery behavior should remain valid.
- The new terminal envelope should make plan-level failures more explicit, not remove `failingPlan` / `failingPlans`.
- For non-plan terminal failures, `failingPlan` may remain a backward-compatible synthetic entry such as `landing` or `artifact-recording` if required by the existing summary schema.
- `failingPlans` should contain only real plans that are currently failed.
- `failingPlans` should not include synthetic non-plan entries.
- Existing monitor consumers should ignore the new event variant if they do not render it yet.

### Expected Code Impact

- `packages/client/src/events.schemas.ts`: add the shared terminal failure event/envelope schema and derived type support.
- `packages/engine/src/events.ts`: consume exported event types as usual; update any local aliases if needed.
- `packages/engine/src/eforge.ts`: emit or carry the authoritative terminal failure envelope when failed run status is determined; ensure one envelope per failed run.
- `packages/engine/src/orchestrator/phases.ts`: optionally enrich finalization/landing failure metadata if the terminal envelope needs structured inputs from finalize/landing phases.
- `packages/engine/src/recovery/event-history.ts`: prefer authoritative terminal event from monitor DB; fallback to existing inference only when absent; add supersession filtering for stale agent errors.
- `packages/engine/src/recovery/failure-summary.ts`: preserve `eventFragment.partial === true` and map terminal envelope evidence into summary fields.
- `packages/engine/src/recovery/sidecar.ts`: likely no structural change required, but tests may require clearer stage/scope rendering.
- `test/recovery.test.ts` and possibly `test/recovery-recommendation.test.ts`: add regression coverage.

### Existing Patterns To Follow

- Event schema source of truth lives in `packages/client/src/events.schemas.ts`.
- Recovery summary reconstruction tests already exist in `test/recovery.test.ts`.
- Sidecar rendering tests already assert `Terminal Failure`, `Landing Status`, and JSON summary fields.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The robust fix should introduce an authoritative terminal failure contract rather than only adding landing/artifact special cases. | Multiple recovery bugs have occurred; inspected current `event-history.ts` heuristic fallback and observed it selected stale `agent:stop` over the actual landing failure. | high | low | Add tests proving authoritative envelope precedence over misleading historical events. | If wrong, this may be a larger change than necessary; however it directly targets the repeated brittleness pattern. |
| `buildSinglePrd()` / phase finalization is the right point to emit the authoritative terminal failure envelope. | `packages/engine/src/eforge.ts` already tracks `status` and `summary` while processing orchestrator events and emits failed `phase:end`. | high | medium | During implementation, trace all compile/build/run failure paths and ensure the envelope is emitted once per failed run. | If wrong, envelope emission could miss some failures or duplicate events. |
| Adding a new event/schema variant is acceptable for monitor consumers. | Event schemas are centralized in `packages/client/src/events.schemas.ts`; existing consumers generally tolerate new event types in the event union when compiled together. | medium | low | Run `pnpm type-check` and relevant monitor/console tests; update renderers only if type errors surface. | If wrong, UI/reducer consumers may need explicit handling or filtering for the new event. |
| Existing sidecar fields can render the new evidence clearly enough. | `sidecar.ts` already renders `Terminal Failure`, `Validation Commands`, and `Landing Status`; no new UI is required to surface the durable diagnosis. | high | low | Add sidecar rendering assertions for artifact/landing terminal failures. | If wrong, sidecar may need a new section or schema field to avoid ambiguity. |
| Event-history fallback should remain available for old runs. | Existing failed sidecars and manual recovery can be produced after the build process exits; old runs will lack the new terminal envelope. | high | low | Keep fallback tests for old DB event sequences and assert `partial: true`. | If wrong, recovery could regress for historical failed builds. |
| Failure scope taxonomy can start with exact values for known failure classes and evolve later. | Current observed event classes in code distinguish plan failures, post-merge command validation (`validation:complete`), PRD validation (`prd_validation:complete`), acceptance validation (`acceptance_validation:complete`), landing, artifact-recording, daemon, compile, and unknown. | high | low | Encode the exact enum in schema and add tests for post-merge validation, PRD validation, and acceptance validation names. | If wrong, some failures may map to `unknown`, but the envelope remains authoritative and less misleading than stale events. |
| Synthetic `failingPlan` is still needed for non-plan failures unless the summary schema is changed. | `BuildFailureSummarySchema` currently requires `failingPlan`, while `failingPlans` is optional. | high | low | Implement the smallest compatibility mapping and verify non-plan failures do not populate synthetic entries in `failingPlans`. | If wrong, consumers could either break from missing `failingPlan` or misclassify run-level failures as real failed plans. |

No unresolved low-confidence/high-impact assumptions remain.

The main implementation unknown is exact event naming/schema placement, which is low-cost to settle with schema tests and `pnpm type-check`.

### Risks

- Over-broad schema churn could create unnecessary UI/monitor updates.
- Mitigation: add the smallest shared event/envelope shape and let consumers ignore it unless needed.
- Emitting duplicate terminal failure envelopes could confuse recovery.
- Mitigation: centralize emission at the run-result decision point and add a test for exactly one authoritative terminal failure per failed run where practical.
- Some failure paths may not have enough structured metadata.
- Mitigation: use `scope: unknown` with `authoritative: true` and the phase summary rather than falling back to stale events.
- Event-history fallback must not regress old sidecars.
- Mitigation: preserve fallback tests and mark inferred context partial.
- `test/recovery.test.ts` is already large.
- Mitigation: use bounded additions or extract fixtures/helpers if maintainability check flags growth.

## Scope

### In Scope

- Define an authoritative terminal failure contract for failed engine runs/build phases.
- Emit or persist one structured terminal failure record at the point the engine decides the run failed.
- Make recovery summary construction prefer the authoritative terminal failure record over inferred event-history fallbacks.
- Keep event-history reconstruction as a degraded fallback and clearly mark it partial/inferred.
- Add precedence and supersession rules so stale plan/agent failures cannot override later successful plan completion, validation, or landing-stage failures.
- Include the observed landing/artifact-recording failure as a regression fixture.
- Keep existing recovery sidecar and deterministic recommendation behavior compatible for plan-level failures.

### Out Of Scope

- Replacing monitor.db or the event recorder.
- Redesigning the full build engine lifecycle.
- Changing the queue recovery apply semantics beyond consuming better summary data.
- Adding new console UI recovery screens in this slice.
- Reworking unrelated build failure classes unless needed for the terminal failure taxonomy.

## Acceptance Criteria

- `packages/client/src/events.schemas.ts` exports a typed terminal failure event or envelope schema used by engine recovery code.
- The terminal failure envelope includes a `scope` field whose schema enumerates `plan`, `post-merge-validation`, `prd-validation`, `acceptance-validation`, `landing`, `artifact-recording`, `daemon`, `compile`, and `unknown`.
- A failed build run records exactly one authoritative terminal failure envelope or event before or with the failed `phase:end` event.
- `buildFailureSummary()` prefers an authoritative terminal failure envelope over inferred `agent:stop`, `plan:build:failed`, or `phase:end` fallback evidence.
- Event-history recovery marks summaries as `partial: true` when it must infer the terminal cause because no authoritative terminal failure envelope exists.
- `buildFailureSummary()` preserves `partial: true` when event-history synthesis returns `partial: true`.
- A stale errored `agent:stop` for a plan that later reaches `completed` or `merged` is not reported as the terminal failing plan.
- A failed post-validation artifact-recording run is summarized with `terminalFailure.scope` or `terminalFailure.stage` equal to `artifact-recording` or `landing`.
- A failed post-validation artifact-recording run summary includes the authoritative terminal failure message when an authoritative terminal failure envelope exists.
- A failed post-validation artifact-recording run summary includes the artifact-recording `daemon:error.message` when no authoritative terminal failure envelope exists.
- A failed post-validation artifact-recording run summary includes `landing.status: skipped` when a `landing:skipped` event exists.
- Recovery sidecar Markdown renders the terminal failure scope or stage for an artifact-recording failure.
- Recovery sidecar Markdown renders landing status for an artifact-recording failure.
- Non-plan terminal failures do not add synthetic entries to `failingPlans`.
- Non-plan terminal failures may use a synthetic `failingPlan.planId` only when required for backward compatibility with the existing summary schema.
- Regression tests cover an authoritative terminal failure envelope taking precedence over an older misleading agent error.
- Regression tests cover fallback inference for old runs that have no authoritative terminal failure envelope.
- Regression tests cover the observed sequence of an older tester max-turn `agent:stop`, later plan `completed` and `merged`, successful validation events, and final `stack:artifact-recording` failure.
- Regression tests assert the terminal failure scope taxonomy distinguishes post-merge validation, PRD validation, and acceptance validation.
- `pnpm exec vitest run test/recovery.test.ts test/recovery-recommendation.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
