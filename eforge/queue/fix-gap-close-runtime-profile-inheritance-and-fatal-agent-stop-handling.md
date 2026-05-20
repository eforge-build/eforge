---
title: Fix Gap-Close Runtime Profile Inheritance and Fatal Agent-Stop Handling
created: 2026-05-20
profile: gpt-claude-combo
---

# Fix Gap-Close Runtime Profile Inheritance and Fatal Agent-Stop Handling

## Problem / Motivation

Gap-close synthetic builds can run under the wrong harness/profile routing and can report success despite immediate agent-stop errors.

During the `improve-adaptive-reviewer-selection-and-follow-up` build with profile `gpt-claude-combo`, the main plan completed and PRD validation triggered a gap-close phase at 93% completion. The synthetic `gap-close` plan then produced impossible runtime metadata:

- `agent:start` for `builder` on plan `gap-close` advertised model `claude-sonnet-4-6` but harness `pi`.
- The same agent immediately stopped with error: `No provider in model ref for Pi backend. Tier recipes with harness "pi" must set pi.provider.`
- A later `review-fixer` on `gap-close` had the same model/harness mismatch and error.
- Despite those errors, the synthetic pipeline emitted `plan:build:implement:complete`, `plan:build:complete`, and `gap_close:complete` with `passed: true`.

In the observed run, the selected profile (`gpt-claude-combo`) had implementation configured for `claude-sdk`/`claude-sonnet-4-6`, but the `gap-close` builder ran with harness `pi` and model `claude-sonnet-4-6`, causing `No provider in model ref for Pi backend`.

Impact: gap-close remediation can silently fail while the monitor presents a successful gap-close pipeline, and tiered/multi-runtime profiles are violated during a critical post-validation phase.

### Classification

This is a **bugfix / focused** change. The root behavior is incorrect orchestration after tiered profiles: gap-close should not select or collapse profiles independently, and agent stop errors should not be silently converted into successful stages.

### Evidence from code inspection

- `packages/engine/src/eforge.ts` invokes gap close with `harness: agentRuntimes.forRole('gap-closer')`. Since `gap-closer` is mapped to the planning tier, this harness is the planning-tier harness for the selected profile.
- `packages/engine/src/agents/gap-closer.ts` then builds the synthetic `BuildStageContext` with `agentRuntimes: singletonRegistry(options.harness)`. This collapses every synthetic role (`builder`, `reviewer`, `review-fixer`, `evaluator`) onto the gap-closer planning harness.
- `packages/engine/src/pipeline/stages/build-stages.ts` correctly asks `ctx.agentRuntimes.forRoleResolved('builder', ctx.planFile)` for builder execution. The bad registry supplied by gap closer is what makes the builder use the planning harness.
- `packages/engine/src/agents/builder.ts` currently treats a harness stream that yields `agent:stop` with `error` but does not throw as a successful run; after the loop it unconditionally emits implementation progress/complete. This explains why the failed builder appeared complete.
- `test/gap-closer.test.ts` covers synthetic pipeline construction and success/failure paths, but does not assert that the full runtime registry is preserved or that emitted `plan:build:failed` causes `gap_close:complete passed: false`.

### Root Cause

Confirmed root cause 1 — runtime registry collapse in gap-close:

- `packages/engine/src/eforge.ts` passes only `harness: agentRuntimes.forRole('gap-closer')` into `runGapCloser`.
- `packages/engine/src/agents/gap-closer.ts` uses `singletonRegistry(options.harness)` when constructing the synthetic `BuildStageContext`.
- Because `gap-closer` is a planning-tier role (`AGENT_ROLE_TIERS['gap-closer'] === 'planning'`), this wraps the planning harness as the harness for every synthetic role. In mixed profiles, builder/review-fixer can therefore receive implementation-tier model settings while executing through the planning-tier harness.

Confirmed root cause 2 — agent stop errors are not fatal in builder success path:

- `packages/engine/src/agents/builder.ts` catches thrown harness errors and emits `plan:build:failed`.
- However, if the harness yields `agent:stop` with an `error` field and does not throw, `builderImplement` records/yields the event but then falls through to unconditional `plan:build:implement:progress` and `plan:build:implement:complete`.
- This matches the observed event stream where an immediate `agent:stop` error was followed by implementation complete.

Likely related issue:

- `runGapCloser` currently treats `yield* options.runBuildPipeline(buildCtx)` as success unless the generator throws. If the pipeline yields `plan:build:failed` but does not throw, gap-close may still emit `passed: true`. Tests should verify this path and fix it if present.

## Goal

Gap-close plan generation should still run with the `gap-closer` role/tier, but the synthetic gap-close build pipeline should use the parent build session’s full `AgentRuntimeRegistry` for all build roles.

Builder agent-stop errors should be fatal to the implementation stage, and gap-close should report `passed: false` when the synthetic build pipeline emits `plan:build:failed`.

## Approach

At a high level:

- Preserve the parent build session’s full `AgentRuntimeRegistry` when invoking and running the synthetic gap-close build pipeline.
- Do not wrap the gap-closer planning harness in `singletonRegistry` for production synthetic build execution.
- Ensure synthetic build roles resolve through the inherited registry:
  - `builder` resolves to the implementation-tier harness.
  - `reviewer` resolves to the review-tier harness.
  - `review-fixer` resolves to the implementation-tier harness.
  - `evaluator` resolves to the evaluation-tier harness.
- Update `builderImplement` so a harness stream that yields `agent:stop` with `error` and no successful `agent:result`/success signal emits `plan:build:failed` and does not emit `plan:build:implement:complete`.
- Update gap-close pass/fail handling so `gap_close:complete passed: false` is emitted if the synthetic build pipeline yields `plan:build:failed`, even when the pipeline generator does not throw.
- Preserve existing abort behavior: `AbortError` from gap-close generation or synthetic build still propagates.

### Reproduction Steps

Observed reproduction from local monitor DB:

1. Enqueue a build with profile `gpt-claude-combo`, where planning/review/evaluation use Pi/OpenAI and implementation uses Claude SDK.
2. Let the main plan complete with PRD validation gaps remaining so gap-close starts.
3. Inspect `gap-close` agent events.
4. Actual: `builder` starts with model `claude-sonnet-4-6` but harness `pi`, then stops immediately with `No provider in model ref for Pi backend. Tier recipes with harness "pi" must set pi.provider.`
5. Actual: pipeline still emits `plan:build:implement:complete`, later `plan:build:complete`, and `gap_close:complete passed: true`.

Deterministic test reproduction to add:

- Construct a fake `AgentRuntimeRegistry` with different harnesses per role/tier.
- Invoke `runGapCloser` with a gap-closer harness plus the full registry in pipeline context.
- Assert the synthetic `BuildStageContext.agentRuntimes.forRoleResolved('builder')` resolves to the original implementation harness, not the gap-closer harness.
- Construct a harness that yields `agent:start` then `agent:stop` with `error` and no `agent:result`; run builder/gap-close path and assert a build failure / `gap_close:complete passed: false` instead of success.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Gap-close should inherit the parent session's full runtime registry rather than choose/collapse a profile. | User confirmed expectation; code inspection shows gap-close is a continuation phase inside `eforge.ts`, not a separate user build. | high | low | Add test asserting role-specific harnesses inside synthetic `BuildStageContext`. | If wrong, mixed profiles remain unsafe and gap-close can run roles on incorrect providers. |
| `singletonRegistry(options.harness)` is the direct cause of the builder using Pi with a Claude model. | `gap-closer` is planning tier; `runGapCloser` wraps its harness for all roles; monitor event shows builder got `harness: pi` with implementation model. | high | low | Replace with full registry and rerun a mixed-registry unit test. | If wrong, another layer in runtime resolution also needs investigation. |
| Harnesses may yield `agent:stop` with `error` without throwing. | Observed event stream did exactly this; tests mention harnesses yield `agent:stop` on error. | high | low | Add a focused harness stub test for `builderImplement`. | If not handled, stages can keep reporting success after failed agents. |
| `runBuildPipeline` can signal failure by yielding `plan:build:failed` without throwing. | Build stages commonly yield failure events and set context flags; gap closer currently only checks thrown errors. | medium | low | Add test with runBuildPipeline yielding `plan:build:failed`. | If unhandled, gap-close may still report passed true on non-throwing failures. |
| Fixing builder stop-error handling is sufficient for implementation-stage false success. | Builder implementation is where the observed impossible complete event originated; review-fixer may also swallow failures by design because it is non-fatal. | medium | medium | Audit other agent wrappers for stop-error handling after the first fix; prioritize builder and gap-close pass/fail semantics. | Some non-builder roles may still present misleading stop errors, though gap-close pass/fail will improve. |

No unresolved low-confidence/high-impact assumptions remain. The main behavior and root cause are evidence-backed by monitor events plus code inspection.

### Profile Signal

Recommended profile: **Excursion**.

Rationale: this is a focused but non-trivial engine orchestration bugfix touching gap-close runtime wiring, builder failure semantics, and tests. A single cohesive plan is sufficient; it does not require delegated module planning.

## Scope

### In scope

- Gap-close runtime wiring in:
  - `packages/engine/src/eforge.ts`
  - `packages/engine/src/agents/gap-closer.ts`
- Synthetic `BuildStageContext.agentRuntimes` construction for the `gap-close` pipeline.
- Builder fatal handling for harness streams that yield `agent:stop` with `error`.
- Gap-close pass/fail semantics when `runBuildPipeline` yields `plan:build:failed` without throwing.
- Tests covering:
  - Registry inheritance bug.
  - Builder stop-error fatal handling.
  - Gap-close failed-event handling.
  - Relevant tier-resolution/wiring behavior.
- Validation with `pnpm type-check` and relevant tests.

### Out of scope

N/A

## Acceptance Criteria

- Gap-close plan generation still runs with the `gap-closer` role/tier, but the synthetic gap-close build pipeline uses the parent build session's full `AgentRuntimeRegistry` for all build roles.
- Under a mixed profile, synthetic `gap-close` builder resolves to the implementation-tier harness, reviewer resolves to review-tier harness, review-fixer resolves to implementation-tier harness, and evaluator resolves to evaluation-tier harness.
- No gap-close code path wraps the gap-closer harness in `singletonRegistry` for production synthetic build execution.
- A builder harness stream that yields `agent:stop` with `error` and no successful `agent:result`/success signal emits `plan:build:failed` and does not emit `plan:build:implement:complete`.
- Gap-close emits `gap_close:complete passed: false` if the synthetic build pipeline yields `plan:build:failed`, even when the pipeline generator does not throw.
- Existing abort behavior is preserved: AbortError from gap-close generation or synthetic build still propagates.
- Tests cover the registry inheritance bug, builder stop-error fatal handling, and gap-close failed-event handling.
- `pnpm type-check` and relevant tests (`test/gap-closer.test.ts`, builder/pipeline failure tests, tier-resolution/wiring tests) pass.
