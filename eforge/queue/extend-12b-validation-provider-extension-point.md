---
title: EXTEND_12B: Validation Provider Extension Point
created: 2026-05-19
---

# EXTEND_12B: Validation Provider Extension Point

## Problem / Motivation

EXTEND_12B closes the gap between loader-time validation-provider registration and actual runtime behavior. Today `registerValidationProvider` is present in `@eforge-build/extension-sdk`, captured by the loader, counted in extension projections, and exposed in docs/tooling, but runtime execution is explicitly deferred. Teams cannot yet add repo-specific validation gates (workspace graph checks, migration dry-runs, contract tests, etc.) through native TypeScript extensions.

Affected users are extension authors and teams using eforge for automated builds who need project-specific validation before code review/merge without forking the engine or registering arbitrary build stages.

**Evidence:**
- `packages/extension-sdk/src/api.ts` and `hooks.ts` expose `registerValidationProvider`.
- `docs/extensions.md`, `docs/extensions-api.md`, and `packages/extension-sdk/README.md` mark validation-provider execution as deferred.
- `packages/engine/src/pipeline/stages/build-stages.ts` already has a placeholder `validate` build stage intended for inline pre-merge checks.
- `packages/engine/src/orchestrator/phases.ts` has separate post-merge validation commands, but that does not satisfy the SDK's documented per-plan "after build before review" position.

**Source context:**
- Schaake OS epic `fc6b210f-ce2c-4c1d-bccf-97a1cb194029` is in progress, priority medium, tagged `extensions` and `validation`, depends on `0c2e2570-87c8-4a12-a2e3-178e27564a9d`, and is not blocked.
- Epic acceptance criteria require extension-registered validation providers or commands with typed results, visibility in planning/diagnostics/monitor output, coherent event/UI/CLI representation, documented timeout/failure behavior, no undocumented engine-state mutation, and no arbitrary compile/build stage registration.
- The TypeScript extensibility PRD (`docs/prd/typescript-extensibility.md`) defines EXTEND_12B as a separate limited stage-like API after reviewer perspectives (EXTEND_12A), with full custom compile/build stage registration explicitly out of scope.

**Roadmap alignment:**
- `docs/roadmap.md` includes Native TypeScript extensions under Extensibility, including typed event hooks, agent context/tool injection, policy gates, input transformers, and limited stage-like APIs. This epic fits that roadmap item.

**Current implementation facts:**
- SDK/API already exposes `registerValidationProvider(spec)` in `packages/extension-sdk/src/api.ts` and `packages/extension-sdk/src/hooks.ts`, but docs mark runtime execution as deferred.
- The existing public provider shape is minimal: `{ name, description, validate(planOutputDir): string | null | undefined | Promise<...> }`; `string` means failure, `null`/`undefined` means success.
- Loader-time registration capture already exists in `packages/engine/src/extensions/recorder.ts`, including duplicate-name diagnostics for validation providers. Registry/projection totals already count `validationProviders`.
- Reviewer perspectives provide the nearest runtime/projection pattern: `packages/engine/src/extensions/reviewer-perspective-runtime.ts` evaluates extension registrations with timeout-bounded fail-open diagnostics and emits `extension:reviewer-perspective:*` events.
- Build pipeline has a currently no-op `validate` build stage in `packages/engine/src/pipeline/stages/build-stages.ts` described as "inline validation" before merge, while post-merge validation commands are handled separately by `Orchestrator.validate()` in `packages/engine/src/orchestrator/phases.ts`.
- Existing post-merge validation emits `validation:start`, `validation:command:start`, `validation:command:complete`, `validation:command:timeout`, and `validation:complete`; monitor UI already reduces command spans via `packages/monitor-ui/src/lib/reducer/handle-validation.ts` and timeline formatting in `event-card.tsx`.
- `EforgeEngine.build()` passes only `policyGates` into the orchestrator extension registry today, while per-plan pipeline context already carries extension reviewer perspectives. Validation providers are registered but not currently passed into build-stage execution.

**Early assumptions / unknowns:**
- Assumption: EXTEND_12A is the dependency and has landed enough runtime/projection patterns to reuse. Evidence: reviewer perspective runtime/docs/tests are present. Confidence: high.
- Assumption: the first runtime target should be the per-plan `validate` build stage rather than post-merge validation, because current SDK docs say providers run after a plan build before review and the placeholder stage exists for inline validation. Confidence: medium-high; impact if wrong is event/API placement churn.
- Unknown: whether the existing minimal return type should remain the only supported contract or be expanded with a structured typed result while preserving string/null backwards compatibility.
- Unknown: whether validation providers should be auto-inserted into build pipelines when registered, or only run when the planner/composer selects/includes the `validate` stage.

## Goal

Make extension-registered validation providers a first-class, runtime-supported, per-plan quality gate executed through the built-in `validate` build stage, with typed results, command-style alternative, coherent events/projections/UI, and documented timeout/failure semantics, while preserving backwards compatibility and the "no arbitrary stage registration" guardrail.

## Approach

**Recommended eforge profile: Excursion.**

Rationale: this is a cohesive extension runtime feature touching SDK types, engine runtime, client event schemas, UI/CLI projections, tests, and docs. A single planner can enumerate the module changes and dependency order without delegated module planning. It is too broad for Errand, but does not require Expedition because the work is a sequential capability slice rather than multiple independently planned subsystems.

### Design Decisions

1. **Runtime location: use the existing built-in `validate` build stage.**
   - Decision: validation providers execute in `packages/engine/src/pipeline/stages/build-stages.ts` inside the existing `validate` stage, per plan, after implementation output exists and before review stages when the pipeline includes `validate` before review.
   - Rationale: the SDK docs already describe "after build before review", and the placeholder stage exists for inline validation. This keeps post-merge validation commands separate and avoids arbitrary stage registration.
   - Consequence: planning/composition must make `validate` visible and selected when providers are present. If a manually-authored pipeline omits `validate`, providers will not run unless a documented build-time normalization is added. Preferred implementation: do not silently mutate plan builds; instead make provider availability visible to the composer/planner and document that the built-in `validate` stage is the execution point.

2. **Provider result contract should be structured but backwards compatible.**
   - Decision: introduce `ValidationProviderResult` with statuses like `passed`, `failed`, and `skipped`, plus optional summary/message/details/annotations. Continue accepting existing legacy returns: `null`/`undefined` = passed, `string` = failed with message.
   - Rationale: epic asks for typed results, while the SDK already exposes a minimal contract. Compatibility avoids breaking existing authored extensions/tests.

3. **Command-style providers should be supported as a first-class alternative, not as arbitrary stages.**
   - Decision: extend `ValidationProviderSpec` to allow a documented command form (for example `commands: string[]`) in addition to function-form validation. Recorder validation should require a non-empty validate function or non-empty command list and reject ambiguous/invalid shapes if both forms would create unclear semantics.
   - Rationale: epic explicitly says "providers or commands"; command support maps common validation use cases without exposing stage registration.
   - Implementation detail to finalize during build: either reject specs that include both `validate` and `commands`, or define a deterministic order. The lower-risk choice is to reject both-present as ambiguous.

4. **Failure behavior is fail-closed for validation outcomes but non-crashing for engine process safety.**
   - Decision: a provider result of `failed`, a non-zero command exit, a thrown error, or a timeout emits provider diagnostics/events and fails the plan via `plan:build:failed`; it must not crash the daemon/worker process.
   - Rationale: validation providers are quality gates by definition. This differs from non-blocking event hooks but is consistent with build/test validation semantics.
   - Timeout: add `extensions.validationProviderTimeoutMs` or reuse `extensions.eventHookTimeoutMs` as the default. Preferred: add `validationProviderTimeoutMs` inheriting from `eventHookTimeoutMs`, parallel to `agentContextHookTimeoutMs`, `profileRouterTimeoutMs`, and `policyGateTimeoutMs`.

5. **Event model should be provider-specific, not overloaded onto shell command events.**
   - Decision: add events such as `extension:validation-provider:start`, `extension:validation-provider:complete`, `extension:validation-provider:error`, and `extension:validation-provider:timeout` with `planId`, `providerName`, `extensionName`, `extensionPath`, result status, message/details, timeoutMs, and command/exitCode where relevant.
   - Rationale: provider events need extension provenance and typed result data. Existing `validation:command:*` events are post-merge command-specific and lack extension provenance.

6. **No engine-state mutation contract.**
   - Decision: provider context exposes read-only build facts and safe helpers (`planId`, worktree/output directory, plan metadata, changed files if available, logger/exec, abort signal if supported). It does not expose `EforgeState`, registry mutation, or plan status setters.
   - Rationale: acceptance criteria require providers not mutate engine state outside documented contracts. Extensions remain unsandboxed trusted code, so docs must state this is an API contract rather than a security sandbox.

7. **Management/projection detail mirrors reviewer perspectives.**
   - Decision: expose safe metadata (`name`, `description`, extension provenance, kind/function-vs-command, command count but not command contents if sensitive concerns apply) in list/show/validate/test output.
   - Rationale: reviewer perspective details are already implemented this way and satisfy CLI/API/MCP/Pi visibility without exposing function bodies.

8. **Event replay remains event-hook-only.**
   - Decision: `eforge extension test` should continue not executing validation providers in replay mode, but its static summary should report validation providers as runtime-supported rather than deferred.
   - Rationale: provider execution needs a build worktree and can run arbitrary commands; replay fixtures are event-only by design.

### Code Impact

Expected code impact, based on static inspection:

**SDK and engine extension model:**
- `packages/extension-sdk/src/hooks.ts`, `api.ts`, `context.ts`, `index.ts`: add/export structured validation result/context types, optional command-style provider support, docs comments, and backwards-compatible legacy return handling.
- `packages/engine/src/extensions/types.ts`: mirror the runtime-facing provider/result/context shapes used by the loader and runtime.
- `packages/engine/src/extensions/recorder.ts`: validate the expanded provider spec shape (name/description plus either `validate` or command definition), keep duplicate-name behavior, and avoid accepting ambiguous/mutating shapes.
- `packages/engine/src/extensions/projector.ts` and `packages/client/src/types.ts`: add safe `validationProviderDetails` metadata, analogous to `reviewerPerspectiveDetails` but without exposing function source.
- New likely file: `packages/engine/src/extensions/validation-provider-runtime.ts` for timeout-bounded execution, legacy-result normalization, command execution, and event construction.
- `packages/engine/src/extensions/index.ts`: export the new runtime helpers.

**Build pipeline integration:**
- `packages/engine/src/pipeline/types.ts`: add `extensionValidationProviders` to `PipelineContext`/`BuildStageContext`.
- `packages/engine/src/eforge.ts`: pass `this.extensionRegistry.validationProviders` into compile/build pipeline context, similar to current reviewer perspective wiring.
- `packages/engine/src/pipeline/stages/build-stages.ts`: replace the no-op `validate` stage with provider execution and mark the descriptor as non-parallelizable; on provider failure emit `plan:build:failed` and set `ctx.buildFailed = true`.
- `packages/engine/src/agents/pipeline-composer.ts` and/or prompt inputs: expose loaded provider summaries so planning can include the `validate` stage when providers are present. Evidence: composer already injects `formatStageRegistry()` and validates selected stages.

**Events and consumer surfaces:**
- `packages/client/src/events.schemas.ts`, `events.ts`, event registry/tests: add validation-provider lifecycle event variants and wire schema parity tests.
- `packages/client/src/event-to-progress.ts`: high-signal progress for provider failure/timeout and possibly start/complete.
- `packages/monitor-ui/src/components/timeline/event-card.tsx`: readable timeline rows/details for provider events.
- Optional/likely `packages/monitor-ui/src/lib/reducer/handle-validation.ts` and `types.ts`: if provider runs should appear in the validation command panel, add provider spans; otherwise timeline-only is acceptable if coherent.
- `packages/eforge/src/cli` extension rendering and daemon routes via existing extension projections may need updates to print provider details and stop labelling providers as deferred.

**Documentation/examples/tests:**
- `docs/extensions.md`, `docs/extensions-api.md`, `docs/config.md`, `packages/extension-sdk/README.md`: update runtime status, API reference, timeout/failure semantics, and limitations.
- `examples/extensions/validation-provider.ts` and `examples/extensions/README.md`: add supported example.
- Tests likely touched/added: `test/extension-loader.test.ts`, `test/extension-cli-commands.test.ts`, `test/extension-replay.test.ts`, new validation-provider runtime/build-stage tests, `packages/client/src/__tests__/events-*.test.ts`, monitor UI reducer/timeline tests as needed, docs checks.

Evidence caveat: exact CLI file names were not exhaustively inspected; the impact list is based on current extension projection and CLI test coverage paths.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| EXTEND_12A/reviewer perspective runtime has landed and can serve as the projection/event pattern. | Read `packages/engine/src/extensions/reviewer-perspective-runtime.ts`, `projector.ts`, docs, and event-card/schema references. | high | low | Run targeted reviewer perspective tests. | Low/medium: plan would need a different observability pattern. |
| Validation providers should execute per-plan before review, not as post-merge validation. | SDK docs in `hooks.ts`/`docs/extensions-api.md` say after build before review; `build-stages.ts` has placeholder `validate` stage; `orchestrator.validate()` is clearly post-merge command validation. | medium-high | low | Confirm with maintainer or inspect historical PRD/epic dependency details. | Medium: event names and integration point would shift to orchestrator post-merge validation. |
| Backwards-compatible API expansion is required because `registerValidationProvider` is already public. | README says public exports are stability-promised; tests already register `validate: () => null`; docs expose the current signature. | high | low | Run existing extension-loader/CLI tests after type changes. | High: breaking SDK users/tests would be unacceptable without major-version migration. |
| Fail-closed is appropriate for provider failures/timeouts. | Validation providers are described as quality gates; existing shell validation failures fail builds. Initial extensibility AC says non-blocking event hooks should not crash builds, but validation providers are explicitly blocking by nature. | medium | low | Ask maintainer if fail-open should be configurable; compare policy gate failure policy. | Medium/high: wrong default could either block builds unexpectedly or allow invalid builds through. |
| Planner/composer visibility is sufficient if the built-in `validate` stage is the documented execution point. | Pipeline composer receives stage registry; current placeholder stage exists; epic asks for provider visibility in planning. | medium | medium | Inspect/adjust pipeline-composer prompt and build sample orchestration to ensure `validate` is included when providers exist. | Medium/high: providers may register but not run in some pipelines unless build-time normalization is added. |
| Command-style providers should be a first-class spec alternative. | Epic acceptance says "providers or commands"; existing post-merge validation commands demonstrate command execution patterns. | medium | low | Decide exact spec during implementation and test ambiguous cases. | Medium: over-broad API could create ambiguity; under-support could miss AC. |
| Provider context can limit engine state mutation by API shape, but cannot sandbox arbitrary code. | Existing extension docs/trust model state extensions are unsandboxed. | high | low | Confirm docs retain trust/security warning. | Medium: AC must be interpreted as documented API contract, not process sandbox. |

## Scope

### In scope

- Make validation-provider execution runtime-supported while preserving existing loader-time registration capture.
- Implement execution in the existing built-in `validate` build stage, so providers run per plan after implementation/build output exists and before review-cycle/review when that stage is in the plan build pipeline.
- Update planning/composition visibility so loaded validation providers are discoverable when build pipelines are chosen, and the built-in `validate` stage is clearly the stage that executes them.
- Evolve the SDK types in a backwards-compatible way to support typed validation results and command-style providers while accepting the current `string | null | undefined` return convention.
- Add canonical event schema variants for provider start/complete/error/timeout and surface them in CLI/progress/timeline/monitor UI enough to be coherent.
- Extend extension list/show/validate/test projections with safe validation-provider metadata, similar to reviewer perspective details.
- Document runtime behavior, timeout/failure semantics, no-mutation contract, and limitations; add an example extension.
- Add tests for SDK typing/loader validation, runtime behavior, event schema parity, CLI/daemon projection, and docs drift.

### Out of scope

- Full arbitrary compile/build stage registration.
- Replacing existing post-merge `postMergeCommands` / planner-generated `validate` commands.
- `beforeValidation` policy gates, approval workflow/state/UI, or mutation-style extension decisions.
- External CI/provider integrations beyond what a provider can run through documented commands/context.
- Sandboxing arbitrary extension code; existing extension trust model remains the security boundary.

## Acceptance Criteria

Implementation is complete when:

### 1. Runtime support
- A native extension can register a validation provider and have it execute through the built-in per-plan `validate` build stage.
- The provider receives documented context and cannot access engine state mutation APIs through that context.
- The build stage fails the current plan with `plan:build:failed` when any provider fails, throws, times out, or a provider command exits non-zero.
- Passing and skipped providers do not fail the plan.

### 2. Typed provider contract
- SDK exports typed validation provider context/result types.
- Existing legacy result behavior remains supported: `null`/`undefined` passes, `string` fails.
- Command-style validation providers are supported or intentionally represented through a documented helper/API that satisfies the "providers or commands" epic criterion.
- Invalid provider registrations are diagnosed at loader/validate time.

### 3. Events and observability
- Provider start/complete/error/timeout events are defined in `packages/client/src/events.schemas.ts` and covered by wire/schema tests.
- Events include provider name and extension provenance.
- CLI/Pi/MCP follow output and/or monitor timeline render provider failures/timeouts coherently.
- Extension list/show/validate/test output shows validation provider metadata and no longer labels validation providers as deferred once runtime support lands.

### 4. Planning/composition visibility
- Loaded validation providers are visible to planning/diagnostics and the `validate` stage description/prompting clearly communicates that it runs extension validation providers.
- A build plan can include the `validate` stage before review; tests cover provider execution in that placement.

### 5. Timeout/failure behavior
- A default validation-provider timeout is documented and implemented, preferably `extensions.validationProviderTimeoutMs` inheriting from `eventHookTimeoutMs`.
- Timeout and thrown-error behavior is documented as plan-failing but daemon-safe.
- Provider command output is bounded/sanitized consistently with existing validation command output where practical.

### 6. Guardrails
- No API allows arbitrary compile/build stage registration.
- Post-merge validation commands and PRD validation continue to behave as before.
- Existing extension tests for event hooks, policy gates, input sources, PRD enrichers, reviewer perspectives, profile routers, tools, trust, and replay continue to pass.

### 7. Docs/examples/tests
- `docs/extensions.md`, `docs/extensions-api.md`, `docs/config.md`, and `packages/extension-sdk/README.md` are updated.
- At least one runnable example extension demonstrates validation providers.
- Unit/integration tests cover passing, failing, skipped, thrown, timeout, duplicate/invalid registration, command-provider behavior, event schema validation, projection/CLI output, and docs/example references.
