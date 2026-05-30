---
id: plan-01-changedfiles-extension-contexts
name: Propagate changedFiles into extension contexts
branch: fix-changedfiles-propagation-for-extension-agent-run-and-validation-provider-contexts/plan-01-changedfiles-extension-contexts
---

# Propagate changedFiles into extension contexts

## Architecture Context

The extension SDK already exposes `AgentRunContext.changedFiles` and `ValidationProviderContext.changedFiles`, but engine runtime wiring does not populate those fields in the affected paths. The fix stays inside the engine harness/extension boundary: agent run metadata is carried on `AgentRunOptions`, hook contexts receive a defensive copy, reviewer agents supply their existing plan-diff file list, and the build `validate` stage supplies the same plan-diff file list to validation providers.

Key constraints:
- Keep `changedFiles` as optional metadata; builder/compile/standalone runs without a plan diff can omit it.
- Do not add `changedFiles` to extension diagnostic event payloads.
- Do not change reviewer perspective applicability logic; it already uses `computeReviewThresholdSnapshot`.
- Use bounded exact edits in `packages/engine/src/pipeline/stages/build-stages.ts` because it is over 1,000 lines.

## Implementation

### Overview

Add `changedFiles?: string[]` to the engine harness run options, clone it into agent-run hook contexts, pass reviewer diff files into single and parallel reviewer harness calls, and compute/pass plan changed files from the validate build stage into validation provider execution.

### Key Decisions

1. `AgentRunOptions.changedFiles` is engine-owned metadata. Backend harnesses must continue to construct provider SDK requests from explicit known fields only; `changedFiles` is for wrappers and extension hooks, not for direct SDK forwarding.
2. `buildAgentRunContext(...)` must clone `options.changedFiles` with a new array so a hook mutating `ctx.changedFiles` cannot mutate the original run options.
3. `runReview(...)` must reuse the review diff context it already computes for prompt variables and pass the array form to `harness.run(...)`.
4. `runParallelReview(...)` must pass the existing `snapshot.changedFiles` list to each perspective harness call. Keep fallback branches delegated to `runReview(...)` so the single-reviewer propagation path is shared.
5. The validate stage must compute plan changed files once, only when providers exist, using `computeReviewThresholdSnapshot(ctx.worktreePath, ctx.orchConfig.diffBaseRef ?? ctx.orchConfig.baseBranch)`, then pass a cloned list into each validation provider invocation through `runValidationProviderRecoveryStage(...)`.

## Scope

### In Scope

- Add `changedFiles?: string[]` to `AgentRunOptions` with documentation that it is not forwarded directly to backend SDKs.
- Add `changedFiles?: string[]` to the engine-local `AgentRunContext` mirror.
- Clone `options.changedFiles` into the hook context in `buildAgentRunContext(...)`.
- Pass changed files from the single reviewer diff computation into the reviewer harness run.
- Pass changed files from the parallel reviewer threshold snapshot into each perspective harness run.
- Compute changed files in the build `validate` stage when validation providers are registered.
- Pass the validate-stage changed files to function-form validation providers via the recovery-stage runtime path.
- Add regression tests for agent hook context propagation, hook mutation isolation, reviewer harness propagation, and validate-stage provider propagation.

### Out of Scope

- No new extension API shape.
- No new extension phase.
- No deferred extension phases.
- No approval/modify semantics.
- No changed-file lists in `extension:agent-context:*` diagnostic events.
- No reviewer perspective applicability changes.
- No Claude Code plugin or Pi extension package changes; this plan does not add CLI commands, MCP tools, skills, or integration-package user behavior.

## Files

### Create

- None.

### Modify

- `packages/engine/src/harness.ts` — add `AgentRunOptions.changedFiles?: string[]` near `phase`/`stage` metadata with a comment that it is engine-owned and not forwarded directly to backend SDKs.
- `packages/engine/src/extensions/agent-context-runtime.ts` — add `changedFiles?: string[]` to the local `AgentRunContext` mirror and clone `options.changedFiles` into the object returned by `buildAgentRunContext(...)`; leave diagnostic correlation/event shapes unchanged.
- `packages/engine/src/agents/reviewer.ts` — preserve the existing prompt `changed_files` string while also exposing an array form from the review context computation, then pass that array as `changedFiles` to the single reviewer `harness.run(...)` call.
- `packages/engine/src/agents/parallel-reviewer.ts` — pass a cloned `snapshot.changedFiles` array as `changedFiles` in both built-in and extension perspective `harness.run(...)` calls; leave fallback-to-`runReview(...)` branches delegated.
- `packages/engine/src/pipeline/stages/build-stages.ts` — in `validateStage`, return early when no providers exist, compute the plan changed files once with `computeReviewThresholdSnapshot(...)`, and pass them into the validation provider recovery stage.
- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` — accept optional changed-file metadata from the validate stage and pass a fresh clone into each `runValidationProvider(...)` call.
- `test/extension-agent-context-runtime.test.ts` — add tests that `executeAgentRunHooks(...)` exposes `ctx.changedFiles` and that mutating `ctx.changedFiles` does not mutate `AgentRunOptions.changedFiles`.
- `test/review-context-filtering.test.ts` — extend the existing git fixture coverage to assert `runReview(...)` and forced `runParallelReview(...)` pass the filtered changed-file list into reviewer harness `AgentRunOptions.changedFiles`.
- `test/validation-provider-build-stage.test.ts` — add a focused validate-stage test using a real temporary git repo that asserts a function-form provider receives the filtered plan changed-file list in its context.

## Verification

- [ ] `AgentRunOptions` has an optional `changedFiles?: string[]` field documented as engine metadata that backend SDKs do not receive directly.
- [ ] An `onAgentRun` hook invoked by `executeAgentRunHooks(...)` observes `ctx.changedFiles` equal to the supplied options array contents.
- [ ] A hook that pushes into `ctx.changedFiles` leaves `AgentRunOptions.changedFiles` unchanged.
- [ ] `runReview(...)` sends `changedFiles` to the reviewer harness matching the filtered `git diff <base>...HEAD --name-only` file list.
- [ ] Forced parallel review sends the same filtered changed-file list to each perspective harness call.
- [ ] The validate build stage sends the filtered changed-file list to a function-form validation provider context.
- [ ] Existing validation-provider runtime behavior still passes when `changedFiles` is supplied directly.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- extension-agent-context-runtime validation-provider-runtime validation-provider-build-stage review-context-filtering` exits 0.
