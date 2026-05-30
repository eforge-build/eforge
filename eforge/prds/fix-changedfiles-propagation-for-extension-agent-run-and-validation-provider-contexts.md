---
title: Fix changedFiles propagation for extension agent-run and validation-provider contexts
created: 2026-05-30
landing: pr
landing_auto_merge: true
---

# Fix changedFiles propagation for extension agent-run and validation-provider contexts

## Problem / Motivation

Extension authors can read `AgentRunContext.changedFiles` and `ValidationProviderContext.changedFiles` in the public SDK/docs, but build runtime wiring does not currently populate those values in the affected paths.

Evidence gathered:

- `packages/extension-sdk/src/context.ts` documents `AgentRunContext.changedFiles?: string[]` and says it is populated for review and post-build stages.
- `packages/engine/src/harness.ts` currently has no `changedFiles` field on `AgentRunOptions`, so harness wrapper code has no typed place to carry this metadata into agent-run hooks.
- `packages/engine/src/extensions/agent-context-runtime.ts` has a local mirror of `AgentRunContext` without `changedFiles`, and `buildAgentRunContext(...)` does not copy changed-file metadata into extension hook contexts.
- `packages/engine/src/extensions/validation-provider-runtime.ts` already supports `ValidationProviderRuntimeContext.changedFiles` and passes it to function-form providers, with test coverage in `test/validation-provider-runtime.test.ts`.
- `packages/engine/src/pipeline/stages/build-stages.ts` invokes `runValidationProvider(...)` without `changedFiles`, so the validation provider runtime capability is not wired from build stages.
- `packages/engine/src/agents/parallel-reviewer.ts` already computes changed files via `computeReviewThresholdSnapshot(cwd, baseBranch)` for review heuristics and extension reviewer perspective applicability. This provides an existing pattern/source for plan-diff file lists.
- Roadmap alignment: this supports the Extensibility roadmap by making the documented native extension contract match runtime behavior. It does not add deferred extension phases or approval/modify semantics.

Affected behavior:

- `onAgentRun` hooks cannot make path-specific prompt/tool decisions from changed files, because the engine's agent-context wrapper never puts `changedFiles` on the hook context.
- Validation providers can accept `changedFiles` at the runtime API level, but build-stage invocation does not supply it.
- Project-local guardrail extensions that rely on path-specific reminders silently fall back to generic behavior.

This is a contract wiring bug, not a new extension feature. The SDK contract and runtime implementation diverged.

Static/code-level reproduction:

1. Inspect `packages/extension-sdk/src/context.ts` and confirm `AgentRunContext` includes `changedFiles?: string[]` with documentation saying it is populated for review and post-build stages.
2. Inspect `packages/engine/src/harness.ts` and confirm `AgentRunOptions` has no `changedFiles` field.
3. Inspect `packages/engine/src/extensions/agent-context-runtime.ts` and confirm the local `AgentRunContext` mirror and `buildAgentRunContext(...)` omit `changedFiles`.
4. Inspect `packages/engine/src/pipeline/stages/build-stages.ts` validate stage and confirm `runValidationProvider(...)` is called with `planId`, `planOutputDir`, `worktreePath`, and `signal`, but not `changedFiles`.
5. Add or run a focused test hook that records `ctx.changedFiles` during an agent run where `AgentRunOptions.changedFiles` is supplied; current code cannot pass this because the option/context path is absent.

Expected behavior:

- When an agent run is supplied changed-file metadata, `onAgentRun` handlers receive an immutable copy via `ctx.changedFiles`.
- When the validate stage runs after implementation, validation providers receive changed files for the plan diff.

Actual behavior:

- `onAgentRun` handlers receive no `changedFiles` field.
- Build-stage validation providers receive no changed files, despite runtime support for the field.

## Goal

Thread existing changed-file metadata into documented extension contexts so `onAgentRun` hooks and validation providers receive reliable `changedFiles` values when a plan diff is available.

## Approach

Root cause:

- `AgentRunContext.changedFiles` exists in `packages/extension-sdk/src/context.ts`, but the engine's local mirror in `packages/engine/src/extensions/agent-context-runtime.ts` was not updated with `changedFiles`.
- `AgentRunOptions` in `packages/engine/src/harness.ts` has no metadata field for changed files, so agent call sites cannot carry the data through the wrapper even if they compute it.
- `buildAgentRunContext(...)` copies metadata such as role, tier, profile, planId, phase, stage, harness, toolbelt, and MCP selection, but never copies changed-file metadata.
- `ValidationProviderRuntimeContext` accepts `changedFiles` and `runValidationProvider(...)` forwards it to function-form providers, but the build `validate` stage never computes or passes changed files.

Implementation targets and likely code impact:

- Update `packages/engine/src/harness.ts` to add `changedFiles?: string[]` to `AgentRunOptions` near `phase`/`stage` metadata.
- Document `AgentRunOptions.changedFiles` as engine-owned metadata that is not forwarded directly to backend SDKs.
- Update `packages/engine/src/extensions/agent-context-runtime.ts` to add `changedFiles?: string[]` to the local `AgentRunContext` mirror.
- Update `buildAgentRunContext(...)` in `packages/engine/src/extensions/agent-context-runtime.ts` to copy a defensive array clone from `options.changedFiles`.
- Update `packages/engine/src/agents/reviewer.ts` so the single-reviewer path passes changed files as an array to `harness.run(...)` where the review diff is already computed for prompt context.
- Update `packages/engine/src/agents/parallel-reviewer.ts` so the parallel reviewer path passes existing `changedFiles` to each perspective `harness.run(...)`.
- Keep fallback paths in `packages/engine/src/agents/parallel-reviewer.ts` delegating to `runReview(...)`.
- Update `packages/engine/src/pipeline/stages/build-stages.ts` to compute the plan changed files once for post-implement build stages that need the metadata, at minimum the validate stage.
- Use the existing `computeReviewThresholdSnapshot(ctx.worktreePath, ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch)` pattern unless a narrower helper is introduced.
- Pass computed changed files from `packages/engine/src/pipeline/stages/build-stages.ts` into `runValidationProvider(...)`.
- Optionally reuse the same helper for post-implement evaluator/test/doc/fixer agent calls if scope permits.
- Update `test/extension-agent-context-runtime.test.ts` with regression coverage that `executeAgentRunHooks(...)` exposes `changedFiles` to hooks.
- Update `test/extension-agent-context-runtime.test.ts` with regression coverage that hook mutation cannot mutate the original options array.
- Add or update build-stage/validation-provider wiring coverage if an existing test harness covers validate-stage invocation.
- If build-stage validation wiring coverage would require large orchestration setup, keep focused runtime tests and rely on type-check for call-site propagation.

Pattern evidence:

- `computeReviewThresholdSnapshot(...)` already returns changed files using `git diff ${baseBranch}...HEAD --name-only` and is already imported into `build-stages.ts`.
- `test/validation-provider-runtime.test.ts` already verifies `runValidationProvider(...)` forwards `changedFiles` when supplied, so the missing behavior is the build-stage caller, not the runtime function.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `changedFiles` should be populated only when a diff is available, not for every agent run. | SDK docs say `changedFiles` is optional and populated for review/post-build stages; initial builder runs may have no meaningful pre-change diff. | high | low | Keep the field optional and only set it at call sites with computed diff data. | Low; over-populating could confuse hooks, while optional behavior preserves compatibility. |
| `computeReviewThresholdSnapshot(ctx.worktreePath, ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch)` is an acceptable source for plan changed files in build-stage wiring. | Existing review-stage code uses the same helper for review strategy and extension reviewer perspective applicability. `build-stages.ts` already imports it. | medium | low | Implement and run focused tests/type-check; inspect whether base ref is available in all validate-stage contexts. | Medium; wrong base ref could provide incomplete or overly broad changed-file lists to extensions. |
| Changed files should not be added to agent-context diagnostic events. | Current diagnostic event shape records provenance and prompt counts, not the full prompt/context payload. No docs indicate diagnostics should expose changed-file lists. | high | low | Confirm event schema before implementation if tempted to alter diagnostics. | Medium; adding fields would expand wire shape and may require client schema updates. |
| Focused runtime/unit tests are sufficient for this bugfix if full build-stage orchestration tests are too heavy. | Existing `validation-provider-runtime.test.ts` covers runtime forwarding when supplied; missing behavior is wiring. Agent context runtime has focused tests. | medium | medium | Prefer adding a build-stage validation wiring test if an existing helper makes it cheap; otherwise document reliance on type-check plus focused runtime tests. | Medium; lack of integration coverage could miss a call-site omission. |

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is a focused bugfix, but it crosses the engine harness contract, extension agent-context runtime, build-stage validation wiring, and tests.
- A single cohesive plan is sufficient.
- Delegated module planning is not needed.
- Errand is a little too light because the fix touches documented extension API behavior and runtime call-site wiring.

## Scope

In scope:

- Add `changedFiles?: string[]` to `AgentRunOptions` as engine-owned metadata that is not forwarded to backend SDKs.
- Add `changedFiles?: string[]` to the engine’s local `AgentRunContext` mirror.
- Copy a defensive `changedFiles` array clone into `buildAgentRunContext(...)` when present.
- Pass changed files into reviewer harness runs where the review diff has already been computed.
- Compute plan changed files for the build `validate` stage.
- Pass plan changed files to `runValidationProvider(...)`.
- Add focused regression coverage for agent-run hook context propagation and mutation isolation.
- Add or update validation-stage wiring coverage if an existing test can exercise the build `validate` stage without large orchestration setup.
- Rely on focused runtime tests and type-check for call-site propagation if build-stage orchestration tests are too heavy.

Out of scope:

- Do not expose changed-file lists in `extension:agent-context:*` diagnostic events unless there is an explicit product decision; those events currently report counts/provenance, not prompt/context contents.
- Do not add a new extension API shape.
- Do not add a new extension phase.
- Do not add deferred extension phases.
- Do not add approval/modify semantics.
- Do not change reviewer perspective applicability; it already has a separate changed-file path.

## Acceptance Criteria

- `AgentRunOptions` includes an optional `changedFiles` metadata field.
- `AgentRunOptions.changedFiles` is documented as not forwarded directly to backend SDKs.
- `onAgentRun` handlers receive `ctx.changedFiles` when the agent run options include changed files.
- Mutating `ctx.changedFiles` inside an `onAgentRun` handler does not mutate the original `AgentRunOptions.changedFiles` array.
- Single-reviewer agent runs receive changed files computed from the review diff.
- Parallel reviewer perspective agent runs receive changed files computed from the review diff.
- The build `validate` stage passes changed files to function-form validation providers.
- Existing reviewer perspective applicability behavior remains unchanged.
- `pnpm type-check` exits 0.
- `pnpm test -- extension-agent-context-runtime validation-provider-runtime` exits 0 or the equivalent focused Vitest invocation for those tests exits 0.
