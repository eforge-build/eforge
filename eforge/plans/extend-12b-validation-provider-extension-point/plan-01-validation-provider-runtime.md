---
id: plan-01-validation-provider-runtime
name: Validation provider runtime, build-stage execution, and event schemas
branch: extend-12b-validation-provider-extension-point/plan-01-validation-provider-runtime
agents:
  builder:
    effort: high
    rationale: Cross-package SDK type expansion, new engine runtime helper,
      build-stage execution, and event schema additions with strict
      backwards-compatibility requirements. Higher effort improves type-design
      quality and the legacy/structured-result normalization logic.
  reviewer:
    effort: high
    rationale: Public SDK contract change plus new event schema variants — both have
      downstream consumers and must be reviewed for API ergonomics, backwards
      compatibility, and event-shape consistency with existing extension event
      families.
---

# Validation provider runtime, build-stage execution, and event schemas

## Architecture Context

EXTEND_12B turns the existing loader-time `registerValidationProvider` registration into a runtime-supported, per-plan quality gate executed by the existing built-in `validate` build stage (`packages/engine/src/pipeline/stages/build-stages.ts:1105-1115`, currently a no-op placeholder). The integration mirrors the EXTEND_12A reviewer-perspective runtime pattern: a dedicated runtime helper (`packages/engine/src/extensions/reviewer-perspective-runtime.ts`) bounded by `extensions.eventHookTimeoutMs`, fail-policy diagnostics emitted as `extension:reviewer-perspective:*` events, registrations threaded into `PipelineContext` (`packages/engine/src/pipeline/types.ts:43-46`) and `BuildStageContext`, and engine wiring in `packages/engine/src/eforge.ts:411,697` that passes `this.extensionRegistry.reviewerPerspectives` through.

Validation providers differ from reviewer perspectives in one important way: they are **blocking quality gates**, not informational lenses. A failure (string return, `failed` structured status, thrown error, non-zero command exit, or timeout) must fail the current plan with `plan:build:failed` and set `ctx.buildFailed = true` — the same termination path the implement/evaluator stages use today. They must not crash the daemon/worker process.

The SDK contract today (`packages/extension-sdk/src/hooks.ts:459-472`) is minimal: `{ name, description, validate(planOutputDir): string | null | undefined | Promise<...> }`. This plan keeps that contract working unchanged while adding (a) a structured `ValidationProviderResult` discriminated by `status: 'passed' | 'failed' | 'skipped'`, (b) a typed `ValidationProviderContext` carrying read-only build facts, and (c) a command-form alternative (`commands: string[]`) as a first-class spec variant.

No arbitrary build-stage registration API is added — providers run inside the already-built-in `validate` stage. Post-merge validation in `Orchestrator.validate()` (`packages/engine/src/orchestrator/phases.ts`) is untouched.

## Implementation

### Overview

1. Expand the public SDK with structured result/context types and an optional `commands` variant while preserving the legacy `string | null | undefined` return convention.
2. Tighten the loader-time `recorder.ts` validation to accept the expanded spec shape, reject ambiguous `{ validate, commands }` co-occurrence, and continue rejecting other invalid shapes.
3. Add a new runtime helper `packages/engine/src/extensions/validation-provider-runtime.ts` that runs each provider with a timeout, normalizes legacy/structured results, runs command-form providers via `execFile`, and constructs typed events.
4. Thread the registrations through `PipelineContext.extensionValidationProviders` and replace the no-op `validate` build stage body with a generator that yields provider lifecycle events and fails the plan on any provider failure.
5. Add a new optional config key `extensions.validationProviderTimeoutMs` that inherits from `eventHookTimeoutMs`.
6. Add a new `extension:validation-provider:*` event family (`start`, `complete`, `error`, `timeout`) to `packages/client/src/events.schemas.ts` with full extension provenance.
7. Expose validation-provider summaries to the pipeline composer prompt input so planning can include the `validate` stage when providers are present.

### Key Decisions

1. **Execution location**: replace the no-op body in the existing built-in `validate` build stage (`packages/engine/src/pipeline/stages/build-stages.ts:1105-1115`) rather than adding a new stage. This honors the AC guardrail "no arbitrary compile/build stage registration" and matches the SDK doc comment "after the build stage completes, before review".
2. **Backwards-compatible result contract**: `ValidationProviderSpec.validate` keeps the existing legacy signature `(ctx) => string | null | undefined | ValidationProviderResult | Promise<...>`. Existing extensions that return `null`/`undefined` or a string failure message continue to work unchanged. The normalization layer lives in the runtime helper.
3. **Command-style alternative as a first-class spec variant**: `ValidationProviderSpec` accepts either `validate: (ctx) => ...` **or** `commands: string[]`, but not both. The recorder rejects ambiguous specs at load time.
4. **Fail-closed for outcomes, daemon-safe for process**: a `failed` result, thrown error, timeout, or non-zero command exit emits the appropriate event and yields a `plan:build:failed` event from the build stage, setting `ctx.buildFailed = true`. The runtime helper itself never throws upward.
5. **Provider-specific events with extension provenance**: new event variants `extension:validation-provider:start|complete|error|timeout` carry `planId`, `providerName`, `extensionName`, `extensionPath`, and result data — they do not overload the existing post-merge `validation:command:*` events.
6. **Read-only `ValidationProviderContext`**: providers receive `{ planId, planOutputDir, worktreePath, logger, exec, signal?, changedFiles? }`. No engine-state, registry, or plan-status mutation APIs are exposed. The legacy first-positional `planOutputDir: string` signature stays supported for back-compat.
7. **Composer visibility**: the pipeline composer prompt input (`packages/engine/src/agents/pipeline-composer.ts:81`, where `formatStageRegistry()` is injected) gets an additional `validation providers loaded` summary so planners include the `validate` stage when providers exist. No silent plan mutation.

## Scope

### In Scope
- Public SDK type expansion (additive, backwards compatible) for `ValidationProviderSpec`, new `ValidationProviderResult`, new `ValidationProviderContext`.
- Engine-side mirror types in `packages/engine/src/extensions/types.ts` (relaxed to match the expanded spec) and recorder validation tightening.
- New runtime helper `packages/engine/src/extensions/validation-provider-runtime.ts`.
- Pipeline context plumbing: add `extensionValidationProviders?: ValidationProviderRegistration[]` to `PipelineContext` and ensure `BuildStageContext` inherits it.
- Build-stage execution: replace the no-op `validate` stage body with provider execution; on any failure emit `plan:build:failed` and set `ctx.buildFailed = true`.
- Engine wiring: pass `this.extensionRegistry.validationProviders` into the build-stage context in `packages/engine/src/eforge.ts` (mirror existing `extensionReviewerPerspectives` wiring sites at lines 411 and 697).
- Config: add `extensions.validationProviderTimeoutMs?: number` to the schema/types/defaults in `packages/engine/src/config.ts`, inheriting from `eventHookTimeoutMs`.
- Event schemas: add `extension:validation-provider:start|complete|error|timeout` variants to `packages/client/src/events.schemas.ts` and ensure they appear in any wire/registry parity exports.
- Pipeline composer visibility: feed a `validationProviders` summary into the composer prompt input so the `validate` stage is selected when providers are loaded.
- Tests for: SDK typing (compile-time only via type assertions), loader validation (valid spec, command-form spec, ambiguous both-present rejection, duplicate name diagnostic, invalid shape rejection), runtime helper (passed/failed/skipped/throw/timeout/legacy-string/legacy-null), build-stage execution (`plan:build:failed` propagation, no-op when no providers), event schema parity (round-trip + registry).

### Out of Scope
- Projector additions (`validationProviderDetails`) — plan-02.
- Event-to-progress mapping, monitor-UI timeline rendering, CLI extension display, docs updates, example extension — all plan-02.
- Any change to `Orchestrator.validate()` post-merge command behavior.
- Approval workflow, `beforeValidation` policy gates, sandboxing, arbitrary stage registration.
- Replay execution of validation providers (replay remains event-hook-only; `test/extension-replay.test.ts:231` continues to assert providers do not execute in replay).

## Files

### Create
- `packages/engine/src/extensions/validation-provider-runtime.ts` — runtime helper exporting `runValidationProvider(registration, ctx, options)` and `normalizeValidationResult(raw)`. Bounded by `extensions.validationProviderTimeoutMs` (falls back to `eventHookTimeoutMs`). Yields typed `extension:validation-provider:*` events. Normalizes legacy return values: `null|undefined → { status: 'passed' }`, non-empty `string → { status: 'failed', message }`, structured `ValidationProviderResult` passed through. For command-form providers, runs each command via `execFile` with the worktree as cwd and the same timeout; any non-zero exit code becomes `{ status: 'failed', message, command, exitCode }`. Thrown errors and timeouts emit `error`/`timeout` events and return a `failed` outcome.
- `test/validation-provider-runtime.test.ts` — unit tests for the runtime helper (passed/failed/skipped/throw/timeout/legacy-string/legacy-null/command-form/non-zero-exit/timeout-of-command).
- `test/validation-provider-build-stage.test.ts` — integration test: a `BuildStageContext` with one passing and one failing provider yields the expected event sequence and sets `ctx.buildFailed = true` on failure; with zero providers the stage is a no-op (preserves the current placeholder behavior).
- `test/validation-provider-event-schema.test.ts` — round-trips each new variant through `safeParseEforgeEvent` and asserts the wire-protocol registry knows about the new types.

### Modify
- `packages/extension-sdk/src/hooks.ts` — at the validation-provider region (lines 449-472), keep `ValidationProviderSpec.name` and `description`, change `validate` to accept the new `ValidationProviderContext` as either the sole argument or a second optional argument (preserving the legacy `(planOutputDir: string)` signature). Add `commands?: string[]` as an alternative spec form. Add exported types `ValidationProviderResult = { status: 'passed' | 'failed' | 'skipped'; message?: string; details?: string; annotations?: Array<{ severity: 'info'|'warning'|'error'; message: string; file?: string; line?: number }> }` and `ValidationProviderContext = { planId: string; planOutputDir: string; worktreePath: string; logger: ExtensionLogger; exec: ExtensionExecApi; signal?: AbortSignal; changedFiles?: string[] }`. Add doc comments documenting timeout/failure semantics ("plan-failing but daemon-safe") and mark runtime as supported.
- `packages/extension-sdk/src/api.ts` — at lines 279-285 replace the `@remarks Runtime not yet wired` note with documentation reflecting runtime support, link the new context/result types in the doc comment, and add an example showing both function and command forms.
- `packages/extension-sdk/src/context.ts` — add the `ValidationProviderContext` interface (or re-export from hooks) so authors can import it from `@eforge-build/extension-sdk`.
- `packages/extension-sdk/src/index.ts` — export the new `ValidationProviderResult` and `ValidationProviderContext` types alongside the existing `ValidationProviderSpec` export.
- `packages/engine/src/extensions/types.ts` — relax `ValidationProviderSpec` (line 57) to mirror the SDK shape: `{ name: string; description: string; validate?: ExtensionHandler; commands?: string[] }`. No other shape changes — `ValidationProviderRegistration` (line 178) is unchanged.
- `packages/engine/src/extensions/recorder.ts` — at `registerValidationProvider` (lines 139-145), require non-empty name+description, require **exactly one** of `validate: function` or `commands: string[]` (non-empty array of non-empty strings). Reject both-present and neither-present with `extension:invalid-registration` diagnostics. The existing duplicate-name behavior in `mergeNamedRegistrations` (line 176) is preserved as-is.
- `packages/engine/src/extensions/index.ts` — re-export the new runtime helpers from `validation-provider-runtime.ts` and ensure the `ValidationProviderRegistration` type is exported.
- `packages/engine/src/pipeline/types.ts` — add `extensionValidationProviders?: ValidationProviderRegistration[]` to `PipelineContext` next to the existing `extensionReviewerPerspectives` field (line 43-46). `BuildStageContext` inherits it through `extends PipelineContext`.
- `packages/engine/src/pipeline/stages/build-stages.ts` — replace the no-op `validate` stage body (lines 1105-1115) with a generator that: (1) returns early with no events when `ctx.extensionValidationProviders` is empty/undefined (preserves placeholder behavior for pipelines without providers); (2) iterates registrations in order, calling the runtime helper, yielding each event; (3) on any failed/error/timeout outcome, yields `{ type: 'plan:build:failed', planId: ctx.planId, error: ... }` and sets `ctx.buildFailed = true`, then returns. Mark the descriptor as `parallelizable: false`. Use `withPeriodicFileCheck`/`emitFilesChanged` only if a provider modifies files (do not auto-stage provider changes — providers are read-only by contract).
- `packages/engine/src/eforge.ts` — at the compile-pipeline context construction (around line 411) and the build-pipeline context construction (around lines 637-697), pass `extensionValidationProviders: this.extensionRegistry.validationProviders` alongside `extensionReviewerPerspectives`. The `extensionRegistry` getter (line 198-200, 210-212) needs no changes.
- `packages/engine/src/config.ts` — add `validationProviderTimeoutMs: z.number().int().positive().optional()` to the extensions schema (around line 187-197) with description "Timeout in milliseconds for validation provider handlers and commands (defaults to eventHookTimeoutMs)"; add the resolved field to the type (around line 371-381); resolve it in `loadConfig` with the `?? fileConfig.extensions?.eventHookTimeoutMs ?? DEFAULT_CONFIG.extensions.validationProviderTimeoutMs` pattern (around line 760-770) and add the corresponding default (around line 659-669).
- `packages/engine/src/agents/pipeline-composer.ts` — at the prompt input construction (around line 81 where `formatStageRegistry()` is injected), inject an additional `validation providers loaded: <name (extension)>, ...` summary derived from the registry so the composer knows to include the `validate` stage in build pipelines when providers exist. The composer continues to be authoritative — no silent mutation of build pipelines elsewhere.
- `packages/client/src/events.schemas.ts` — add four new `Type.Object({...})` variants to the `EforgeEventSchema` union near the existing `extension:reviewer-perspective:*` events (around lines 1127-1161):
  - `extension:validation-provider:start` with `{ planId, providerName, extensionName, extensionPath, kind: 'validate' | 'commands', commandCount?: integer }`
  - `extension:validation-provider:complete` with `{ planId, providerName, extensionName, extensionPath, status: 'passed' | 'skipped', message? }`
  - `extension:validation-provider:error` with `{ planId, providerName, extensionName, extensionPath, status: 'failed', message, details?, command?, exitCode? }`
  - `extension:validation-provider:timeout` with `{ planId, providerName, extensionName, extensionPath, timeoutMs, command? }`
  Add the new types to any aggregate predicate guard (similar to the `event.type === 'extension:agent-context:*' ||` block around line 1994).
- `packages/client/src/events.ts` — ensure the new variants are exported via the derived `EforgeEvent` union (no changes needed if the union is derived from the schema, but verify type re-exports are intact).
- `packages/client/src/event-registry.ts` (or whichever file the wire-protocol parity tests reference; locate via `getEventSummary` import in `event-to-progress.ts:20`) — add registry entries for the four new variants so any parity test passes.
- `test/extension-loader.test.ts` — update the existing test at lines 561-590 to no longer label validation providers as deferred (only structural assertions remain). Add new tests: (a) command-form spec is accepted; (b) `{ validate, commands }` both present is rejected with an `extension:invalid-registration` diagnostic; (c) `{}` (neither present) is rejected. The duplicate-name test at line 407 continues to pass unchanged.
- `test/extension-replay.test.ts` — the assertion at line 231 ("validation provider should not be replayed") remains correct and unchanged — replay still does not execute providers. Update any comment that implies providers are categorically deferred.
- `test/extension-cli-commands.test.ts` — the structural assertion at line 672 (`validationProviders: 1`) continues to pass. Update the surrounding comment (line 671 "validationProviders should still be deferred") to remove the "deferred" wording.

## Verification

- [ ] `pnpm type-check` passes for `@eforge-build/extension-sdk`, `@eforge-build/engine`, and `@eforge-build/client` with the new types.
- [ ] `test/validation-provider-runtime.test.ts` exercises ten cases: passed-via-null, passed-via-undefined, passed-via-structured, failed-via-string, failed-via-structured, skipped, throws-error, exceeds-timeout, command-non-zero-exit, command-timeout.
- [ ] `test/validation-provider-build-stage.test.ts` asserts that a context with `extensionValidationProviders: []` produces zero events (no-op), one passing provider produces one start + one complete event, one failing provider produces start + error + a `plan:build:failed` event and sets `ctx.buildFailed = true`.
- [ ] `test/validation-provider-event-schema.test.ts` round-trips each new variant via `safeParseEforgeEvent` and asserts each variant is present in the event-registry export.
- [ ] `test/extension-loader.test.ts` accepts a command-form spec, rejects `{ validate, commands }` both-present, and rejects `{}` neither-present.
- [ ] `test/extension-replay.test.ts` continues to assert that the registered provider's `validate` function does not execute during replay.
- [ ] A grep of `packages/engine/src` for `extensionValidationProviders` shows the field referenced in `pipeline/types.ts`, `pipeline/stages/build-stages.ts`, and `eforge.ts` only.
- [ ] A grep of `packages/extension-sdk/src` for `commands?: string[]` shows the new spec variant exported.
- [ ] `pnpm test` passes the full vitest suite.
