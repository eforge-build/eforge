---
id: plan-04-context-recovery
name: Classify provider/proactive context failures and route capped
  retry-as-expedition or bounded-decomposition guidance.
branch: add-compile-resilience-for-oversized-prds/context-recovery
---

# Context Recovery

## Architecture Reference

This module implements the **context-recovery** portions of the architecture:

- **Module Responsibilities / context-recovery** — classify provider and proactive context failures, construct `CompileScopeContextFailure` values, enforce attempt caps/idempotency metadata, generate recovery options, and optionally retry as expedition once when eligibility is deterministic.
- **Shared Data Model / Scope/Context Failure** — consume client-owned `CompileScopeContextFailure`, `CompileArtifactSummary`, `CompileRecoveryAction`, and `CompilePreflightRisk` contracts from `foundation-contracts`.
- **Integration Contracts Between Modules / Context Failure and Recovery** — route live guard stops and provider context-window errors through one typed path, keep existing repair paths preferred when valid partial artifacts exist, and keep retry-as-expedition bounded rather than scheduler-owned.
- **Shared File Registry / Region Declarations** — bounded exact edits in `eforge.ts`, `pipeline/types.ts`, `compile-stages.ts`, and recovery sidecar files.

Key constraints from architecture:

- Provider context-window/context-length failures during compile must become typed scope/context failures, not generic manual failures.
- Proactive `CompileScopeContextError` failures from planner guardrails and provider context-window failures must use the same `planning:scope-context:failure` event path.
- Automatic retry-as-expedition is allowed at most once, only below expedition scope, only for the same source hash, only when no usable artifact set exists, and only when valid partial artifacts do not require repair.
- Recovery metadata must be idempotent: classifying the same failure does not increment attempts unless a retry is actually started.
- Bounded decomposition remains guidance, not scheduling.
- Existing continue/repair paths remain preferred when valid required compile artifacts already exist.
- All event and sidecar wire shapes must come from `@eforge-build/client`; engine code must not define parallel route or daemon shapes.
- State mutation and build-decision helper discipline remain in force; this module does not mutate `EforgeState` or emit direct `plan:build:decision` events.

## Scope

### In Scope

- Add provider context-window/context-length string classification for engine compile failures.
- Add engine helper functions that convert provider errors or planner-guardrail `CompileScopeContextError` values into enriched `CompileScopeContextFailure` payloads.
- Add best-effort compile artifact summaries for recovery eligibility checks.
- Add compile recovery attempt metadata to `PipelineContext`.
- Add deterministic recovery decisions for:
  - one-time retry-as-expedition;
  - bounded decomposition guidance;
  - manual scope reduction guidance;
  - repair-existing-artifacts preference when a valid compile artifact set exists.
- Escalate a composer-selected errand/excursion pipeline to expedition before the planner run when preflight overflow risk makes retry-as-expedition eligible.
- Retry a planner attempt once as expedition when a planner-stage context-budget/provider-context failure occurs before useful artifacts exist and eligibility is clear.
- Stop compile with a typed failure event when provider or guard context failures are not eligible for automatic retry.
- Emit `planning:scope-context:failure` and `build:terminal-failure` with `terminalSubtype: 'error_context_window'` for unrecovered compile scope/context failures.
- Re-throw context failures from module planning instead of swallowing them as non-fatal module failures.
- Populate recovery sidecar non-mutating `compile-scope-context` options when compile scope/context failure evidence is available.
- Update deterministic recovery recommendation text so compile context failures are classified as compile scope/context failures.
- Add unit and stub integration tests for classifier behavior, retry caps/idempotency, recovery option generation, compile failure events, and one-time retry-as-expedition.

### Out of Scope

- Client schema definitions for `CompileScopeContextFailure`, `CompilePreflightRisk`, terminal subtype literals, and recovery option unions; `foundation-contracts` owns those.
- Preflight risk scoring, generated-inventory detection, and prompt-source compaction; `preflight-compaction` owns those.
- Bounded planner tool validation diagnostics and live context guard thresholds; `planner-guardrails` owns those.
- Final persisted artifact success gating; `artifact-validation` owns `validateCompileArtifacts(ctx)` and the final success/failure gate.
- CLI, Console, Pi, or Claude plugin rendering changes; `surfaces-docs` owns rendering beyond sidecar option data and recommended-action text.
- Queue scheduling, auto-drain, or creating follow-up PRDs.
- Adding `retry-as-expedition` or `bounded-decomposition` to `ApplyRecoveryRequest` / `ApplyRecoveryResponse` mutation semantics.

## Implementation Approach

### Overview

Create focused engine helpers under `packages/engine/src/compile-resilience/`:

1. `provider-context.ts` classifies raw provider/harness errors as context-window or context-length failures with bounded explanations.
2. `context-recovery.ts` builds enriched `CompileScopeContextFailure` values, summarizes existing compile artifacts for recovery decisions, tracks one-time retry-as-expedition attempts, mutates the in-memory compile pipeline when recovery is attempted, and builds recovery sidecar options from persisted failure events.

`compile-stages.ts` will call these helpers in three places:

- after `planning:pipeline`, to escalate overflow-risk errand/excursion composition to expedition before invoking the planner;
- around planner execution, to retry once as expedition for planner-stage context failures with no useful artifacts;
- around module planning, to rethrow context failures so compile fails closed instead of continuing with missing module plans.

`EforgeEngine.compile()` will keep the existing source/worktree setup, but it will catch typed context failures after `runCompilePipeline(ctx)`, emit bounded typed failure events, and set the phase summary from the bounded explanation. The compile method will not start scheduler-owned work.

Recovery sidecar generation will consume the client-owned `RecoverySidecarRecoveryOption` union. It will add non-mutating `compile-scope-context` options when a `planning:scope-context:failure` event exists for the failed compile run, while preserving existing continue-and-repair options when compiled artifacts are eligible.

### Key Decisions

1. **Provider classification lives in an engine helper imported by `harness.ts`.**  
   `@eforge-build/client` owns the serializable subtype literal, but provider message heuristics are backend/runtime logic. Keeping the classifier in `compile-resilience/provider-context.ts` avoids client-side provider heuristics and lets `classifyAgentTerminalSubtype()` return `error_context_window` for terminal classification without creating a dependency cycle.

2. **`CompileScopeContextError` remains the proactive guard bridge.**  
   `planner-guardrails` creates this class. This module imports it, enriches its placeholder failure payload with artifacts/recovery metadata, and rethrows it for the compile-level catch path. It does not create a second error class.

3. **Artifact summaries are recovery evidence, not the final success gate.**  
   `summarizeCompileArtifactsForRecovery(ctx)` may parse `orchestration.yaml` and plan files to decide retry eligibility, but it never reports compile success. The later `artifact-validation` module owns the authoritative final artifact validation gate.

4. **Retry attempts increment only when a retry starts.**  
   Repeated classification for the same source hash and same failure returns the same attempt metadata. `compileScopeRecovery.retryAsExpeditionAttempts` increments only inside `markRetryAsExpeditionStarted(ctx, failure)` immediately before the pipeline is switched to expedition.

5. **Automatic retry is limited to planner-stage recovery.**  
   Preflight overflow can escalate the pipeline before the first planner call. Planner-stage context failures can retry once as expedition when no useful artifacts exist. Pipeline-composer context failures and module-planner context failures produce typed guidance because retrying them does not reduce the source prompt and can loop.

6. **Pipeline escalation emits observable events.**  
   When context recovery changes `ctx.pipeline` to expedition, it emits `planning:scope-context:failure` with `recovery.attempted: true`, then emits a new `planning:pipeline` event containing the effective expedition pipeline and a rationale that references bounded context recovery. Consumers can treat the latest `planning:pipeline` event as the active pipeline.

7. **Valid artifact sets block automatic retry.**  
   If `orchestration.yaml` exists, parses, references existing parseable plan files, and at least one valid plan exists, the recovery action becomes `repair-existing-artifacts`. The engine emits guidance and does not retry from scratch.

8. **Sidecar options are read-only guidance.**  
   `compile-scope-context` sidecar options point operators to retry-as-expedition/decomposition/manual scope reduction. They are not accepted by `apply-recovery`, and no queue mutation is added.

9. **Unrecovered context failures get terminal subtype evidence.**  
   `EforgeEngine.compile()` emits a `build:terminal-failure` event with `scope: 'compile'`, `stage`, and `terminalSubtype: 'error_context_window'` before `phase:end failed`. Existing recovery history can then synthesize typed compile-failure evidence from monitor DB events.

### Helper Contracts

The final function names can vary, but the implementation must expose this behavior from `packages/engine/src/compile-resilience/context-recovery.ts`:

```ts
// --- eforge:region plan-04-context-recovery ---
export interface CompileScopeRecoveryState {
  sourceHash: string;
  retryAsExpeditionAttempts: number;
  maxRetryAsExpeditionAttempts: number;
  attemptedSourceHashes: string[];
  lastFailure?: CompileScopeContextFailure;
}

export interface CompileScopeContextFailureInput {
  source: 'preflight' | 'live-context-guard' | 'provider';
  failureKind: 'context-budget' | 'context-window' | 'context-length' | 'scope-too-broad';
  stage: 'pipeline-composer' | 'planner' | 'module-planner' | 'compile-expedition' | 'compile';
  explanation: string;
  observed?: CompileScopeContextFailure['observed'];
  risk?: CompilePreflightRisk;
}

export function classifyProviderContextError(error: unknown): null | {
  failureKind: 'context-window' | 'context-length';
  explanation: string;
};

export async function toCompileScopeContextError(
  ctx: PipelineContext,
  error: unknown,
  fallbackStage: CompileScopeContextFailureInput['stage'],
): Promise<CompileScopeContextError | null>;

export async function buildPreflightEscalationDecision(
  ctx: PipelineContext,
): Promise<{ failure: CompileScopeContextFailure; retryAsExpedition: boolean } | null>;

export function markRetryAsExpeditionStarted(
  ctx: PipelineContext,
  failure: CompileScopeContextFailure,
): void;

export function applyRetryAsExpeditionPipeline(
  ctx: PipelineContext,
  reason: string,
): void;

export function scopeContextFailureEvent(
  failure: CompileScopeContextFailure,
): EforgeEvent;

export function compileScopeTerminalFailureEvent(input: {
  runId: string;
  failure: CompileScopeContextFailure;
}): EforgeEvent;
// --- eforge:endregion plan-04-context-recovery ---
```

The source marker slug uses `plan-04-context-recovery` because this is the fourth module in the plan set. Builders may omit temporary source markers when edits are small and non-overlapping.

### Provider Classification Details

`classifyProviderContextError(error)` must:

- inspect `Error.message`, string errors, `cause` chains, and common provider fields such as `error.type`, `code`, `status`, and `name` when present;
- match explicit length signatures as `context-length`, including `context_length_exceeded`, `maximum context length`, `max context length`, `input is too long`, and `prompt is too long`;
- match window/budget signatures as `context-window`, including `context window`, `context limit`, `token limit`, `too many tokens`, `input length and max_tokens exceed`, and Anthropic/Claude context-window wording;
- ignore non-context transport/API messages such as API 529 overloads and WebSocket close errors;
- bound explanations with a named constant such as `MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES` and include the original error class/name when available.

`harness.ts` must add `error_context_window` to the engine `AgentTerminalSubtype` union and call the classifier from `classifyAgentTerminalSubtype()` after transient transport / Pi infrastructure checks. This lets monitor and recovery code see the typed terminal subtype even when a context failure is wrapped by an `AgentTerminalError`.

### Recovery Decision Rules

`buildCompileScopeContextFailure(ctx, input)` must calculate a `CompileArtifactSummary` and then choose a recovery action with these rules:

1. **Repair existing artifacts:** if `orchestration.yaml` exists, parses, references existing parseable plan files, and `validPlanCount > 0`, choose `repair-existing-artifacts`, `eligible: true`, `attempted: false`, and do not retry.
2. **Retry as expedition:** if the current effective scope is `errand` or `excursion`, preflight/live/provider evidence recommends `retry-as-expedition`, no valid artifact set exists, `retryAsExpeditionAttempts < maxRetryAsExpeditionAttempts`, and the source hash is not in `attemptedSourceHashes`, choose `retry-as-expedition`, `eligible: true`.
3. **Bounded decomposition:** if no useful artifact set exists and retry-as-expedition is ineligible because scope is already expedition, the attempt cap is reached, or the risk recommendation is decomposition, choose `bounded-decomposition`, `eligible: true`.
4. **Manual reduce scope:** if evidence is incomplete or artifact state is ambiguous, choose `manual-reduce-scope`, `eligible: false`.
5. **No retry loops:** if a source hash has already started retry-as-expedition, later failures for that hash choose `bounded-decomposition` or `manual-reduce-scope` and report the previous attempt count.

The returned `failure.recovery.attempt` must reflect the number of retry-as-expedition attempts already started. It must increase only after `markRetryAsExpeditionStarted()` runs.

### Pipeline Escalation Details

When retry-as-expedition starts, `applyRetryAsExpeditionPipeline(ctx, reason)` must:

- set `ctx.pipeline.scope` to `expedition`;
- replace or append compile stages so the active compile sequence contains `planner`, `architecture-review-cycle`, `module-planning`, `cohesion-review-cycle`, and `compile-expedition` in predecessor order;
- preserve `ctx.pipeline.defaultBuild` and `ctx.pipeline.defaultReview` from the composer result;
- append a bounded rationale explaining that compile context recovery escalated the scope;
- recompute `ctx.compilePreflight` with `requestedPipelineScope: 'expedition'` when preflight helper data is available, without mutating any already-emitted `planning:preflight` event;
- reset no persisted files and delete no artifact directories.

## Files

### Create

- `packages/engine/src/compile-resilience/provider-context.ts` — provider context-window/context-length classifiers, bounded explanation helper, and exported regex/test constants.
- `packages/engine/src/compile-resilience/context-recovery.ts` — recovery state types, compile artifact recovery summaries, failure construction, retry/decomposition decision logic, expedition pipeline escalation, event builders, and recovery sidecar option lookup from monitor DB.
- `test/compile-context-recovery.test.ts` — unit tests for provider classification, artifact summary, recovery decision rules, retry caps, idempotency, terminal event construction, and recovery sidecar option generation.
- `test/compile-context-recovery-engine.test.ts` — stub compile tests for typed failure events, provider context error classification, one-time retry-as-expedition, module-planner context failure rethrow, and no false success.

### Modify

- `packages/engine/src/harness.ts` — add `error_context_window` to `AgentTerminalSubtype` and classify provider context-window/context-length messages through `provider-context.ts`.
- `packages/engine/src/eforge.ts` — keep a `PipelineContext | undefined` visible to the compile catch block, convert unrecovered context failures into `planning:scope-context:failure` and `build:terminal-failure`, set the bounded failure summary, and avoid duplicate event emission for already-attempted in-stage recovery `[region: context-recovery, in compile() catch/failure handling around `runCompilePipeline(ctx)`; no source normalization edits]`.
- `packages/engine/src/pipeline/types.ts` — add optional `compileScopeRecovery?: CompileScopeRecoveryState` to `PipelineContext` `[region: context-recovery, after planner-guardrails context-limit fields and before mutable state fields]`.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — import context-recovery helpers; evaluate preflight escalation after `planning:pipeline`; wrap planner execution to retry once as expedition for eligible planner-stage failures; convert provider context errors to `CompileScopeContextError`; rethrow context failures from module-planner attempts `[region: context-recovery, import section plus composer failure conversion, post-pipeline preflight escalation, planner retry-as-expedition wrapper, and module-planner context-error rethrow]`.
- `packages/engine/src/recovery/resume-sidecar.ts` — consume `RecoverySidecarRecoveryOption` from `@eforge-build/client`, add compile-scope-context option construction when monitor DB contains a matching `planning:scope-context:failure`, and preserve existing continue-repair option behavior `[region: context-recovery, adjacent to continue-repair option builder and `projectRecoverySidecarResumeEvidence` result assembly]`.
- `packages/engine/src/recovery/sidecar-payload.ts` — prefer compile-scope-context recommended-action text when a recommended compile option exists and no continue-repair option is recommended; include compile-scope-context options passed by `resume-sidecar.ts` without re-shaping them `[region: context-recovery, `recoveryOptionsFor`, recommended-action selection, and key-evidence additions]`.
- `packages/engine/src/recovery/sidecar-read.ts` — validate `compile-scope-context` recovery options using client-owned action/source/failure-kind contracts or schemas so daemon reads accept the new sidecar option.
- `packages/engine/src/recovery/sidecar.ts` — no behavior change expected beyond type compatibility; update imports only if `RecoverySidecarRecoveryOption` moves to the client type re-export.
- `packages/engine/src/recovery/recommendation.ts` — add a deterministic branch for compile context failures (`terminalFailure.scope === 'compile'` and `terminalSubtype === 'error_context_window'`) that returns a manual verdict with compile scope/context rationale and leaves non-mutating retry/decomposition guidance to `recoveryOptions`.
- `packages/engine/src/recovery/event-history.ts` — include failed `compile` runs with `build:terminal-failure` or `planning:scope-context:failure` evidence in run selection so queued compile failures synthesize typed recovery summaries.
- `packages/engine/src/recovery/terminal-failure-history.ts` — parse and propagate `failure.stage` from authoritative `build:terminal-failure` events so compile context failures retain `planner`, `module-planner`, or `pipeline-composer` evidence in summaries.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add valid fixture coverage only if foundation-contracts has not already added `planning:scope-context:failure` fixture coverage.

## Testing Strategy

### Unit Tests

Add `test/compile-context-recovery.test.ts` cases for:

- `classifyProviderContextError()` returns `context-length` for `context_length_exceeded` and maximum-context-length messages.
- `classifyProviderContextError()` returns `context-window` for provider context-window/token-limit messages.
- `classifyProviderContextError()` returns `null` for API 529 overloads, WebSocket close errors, and unrelated validation errors.
- Bounded provider explanations stay under `MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES` for a multi-kilobyte provider error string.
- `classifyAgentTerminalSubtype(new Error(contextMessage))` returns `error_context_window`.
- Recovery artifact summary returns `orchestrationExists: false`, `validPlanCount: 0`, and `missingPlanFileCount: 0` for an empty plan directory.
- Recovery artifact summary returns `orchestrationExists: true`, `validPlanCount > 0`, and no missing plan files for a minimal valid orchestration + plan fixture.
- A no-artifact excursion failure with preflight recommendation `retry-as-expedition` yields recovery action `retry-as-expedition`, `eligible: true`, `attempted: false`, and `attempt: 0` before the retry starts.
- Calling `markRetryAsExpeditionStarted()` increments the attempt count once and records the source hash.
- Rebuilding the same failure after `markRetryAsExpeditionStarted()` yields no second retry-as-expedition eligibility for the same source hash.
- An already-expedition failure with no artifacts yields recovery action `bounded-decomposition`.
- A valid artifact set yields recovery action `repair-existing-artifacts` and no automatic retry eligibility.
- `compileScopeTerminalFailureEvent()` returns `build:terminal-failure` with `failure.scope === 'compile'`, `failure.terminalSubtype === 'error_context_window'`, and the failure stage preserved.
- `compileScopeContextRecoveryOption()` returns a client-typed `compile-scope-context` sidecar option for `retry-as-expedition`, `bounded-decomposition`, and `manual-reduce-scope` actions, and returns no option for `none`.
- `parseRecoverySidecarPayload()` accepts a sidecar JSON containing a `compile-scope-context` option and rejects an option with action `none`.
- `determineRecoveryRecommendation()` for a compile context terminal failure returns a manual verdict whose rationale contains `Compile scope/context failure` and does not contain the generic `No failingPlans data` rationale.

### Integration / Stub Tests

Add `test/compile-context-recovery-engine.test.ts` using `StubHarness` and a real temporary git repo:

- Provider context-length error during planner:
  - composer returns `scope: 'expedition'`;
  - planner throws `AgentTerminalError('error_during_execution', 'context_length_exceeded ...')`;
  - `engine.compile()` emits one `planning:scope-context:failure` with `source: 'provider'`, `failureKind: 'context-length'`, `stage: 'planner'`, and a bounded explanation;
  - `engine.compile()` emits `build:terminal-failure` with `failure.terminalSubtype === 'error_context_window'` before `phase:end failed`;
  - no `planning:complete` event is emitted after the failure.
- Planner guard context-budget error:
  - configure the pipeline context or agent options with a low planner prompt byte limit;
  - the thrown `CompileScopeContextError` becomes a `planning:scope-context:failure` with `source: 'live-context-guard'` and `failureKind: 'context-budget'`;
  - the final `phase:end` status is `failed`.
- Preflight overflow escalation:
  - source preflight risk recommends `retry-as-expedition`;
  - composer returns `scope: 'excursion'`;
  - before the planner prompt, the engine emits `planning:scope-context:failure` with `source: 'preflight'`, `recovery.action === 'retry-as-expedition'`, and `recovery.attempted === true`;
  - a later `planning:pipeline` event has `scope: 'expedition'` and includes `compile-expedition` in `compile`.
- Planner-stage one-time retry-as-expedition:
  - composer returns excursion;
  - first planner attempt throws a provider context-window error before any submission;
  - the next planner prompt runs with `scope: expedition` and only the architecture submission tool is available;
  - exactly one retry-as-expedition attempt is recorded for the source hash.
- Retry cap:
  - after the expedition retry, the second planner attempt throws another context-window error;
  - the terminal `planning:scope-context:failure` has recovery action `bounded-decomposition` or `manual-reduce-scope` and `recovery.attempt >= recovery.maxAttempts`;
  - no third planner prompt is recorded.
- Module-planner context failure:
  - planner successfully emits expedition architecture;
  - module planner throws a provider context-window error;
  - compile emits `planning:scope-context:failure` with `stage: 'module-planner'`;
  - `phase:end` status is `failed`;
  - no `Compile complete` summary is emitted.
- Existing artifacts block retry:
  - create a valid orchestration + plan file before injecting a planner context failure;
  - failure recovery action is `repair-existing-artifacts`;
  - the harness records no retry-as-expedition planner prompt.
- Recovery sidecar option projection:
  - insert a failed compile run with `planning:scope-context:failure` into a test monitor DB;
  - `projectRecoverySidecarResumeEvidence()` returns a `recoveryOptions` entry with `kind: 'compile-scope-context'` and the recorded action/source/failureKind.

## Verification

- [ ] `classifyProviderContextError(new Error('context_length_exceeded'))` returns `failureKind: 'context-length'`.
- [ ] `classifyProviderContextError(new Error('context window exceeded'))` returns `failureKind: 'context-window'`.
- [ ] `classifyProviderContextError(new Error('API error 529: overloaded_error'))` returns `null`.
- [ ] A provider error string over 10 KiB produces an explanation whose UTF-8 byte length is less than or equal to `MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES`.
- [ ] `classifyAgentTerminalSubtype(new Error('maximum context length exceeded'))` returns `error_context_window`.
- [ ] A no-artifact excursion failure with retry-as-expedition risk yields `failure.recovery.action === 'retry-as-expedition'` and `failure.recovery.eligible === true` before any retry starts.
- [ ] `markRetryAsExpeditionStarted()` increments the retry-as-expedition attempt count from `0` to `1` for a source hash.
- [ ] Reclassifying the same source hash after one started retry does not return a second eligible retry-as-expedition decision.
- [ ] Already-expedition context failures with no artifacts yield `failure.recovery.action === 'bounded-decomposition'` or `manual-reduce-scope`.
- [ ] Valid `orchestration.yaml` plus valid referenced plan files yield `failure.recovery.action === 'repair-existing-artifacts'` and no retry-as-expedition attempt.
- [ ] Unrecovered provider context failures emit `planning:scope-context:failure` before `phase:end`.
- [ ] Unrecovered provider context failures emit `build:terminal-failure` with `failure.scope === 'compile'` and `failure.terminalSubtype === 'error_context_window'` before `phase:end`.
- [ ] Planner-stage retry-as-expedition records exactly two planner prompts when the first planner attempt fails before submission and the retry starts.
- [ ] Retry cap tests record no more than two planner prompts for the same source hash when `maxRetryAsExpeditionAttempts` is `1`.
- [ ] Module-planner context failures produce `phase:end` with `result.status === 'failed'`.
- [ ] Module-planner context failures do not produce a later `planning:complete` event.
- [ ] Recovery sidecar JSON containing `kind: 'compile-scope-context'` parses through `parseRecoverySidecarPayload()`.
- [ ] `projectRecoverySidecarResumeEvidence()` returns a `compile-scope-context` recovery option when the monitor DB contains a matching `planning:scope-context:failure` event.
- [ ] `determineRecoveryRecommendation()` for `terminalSubtype: 'error_context_window'` uses a compile scope/context rationale instead of the generic missing-failing-plans rationale.
- [ ] `packages/engine/src/pipeline/stages/compile-stages.ts` remains at or below its `613` line no-growth ceiling.
- [ ] New implementation files remain at or below `600` lines.
- [ ] New test files remain at or below `1,200` lines.
- [ ] `pnpm test -- test/compile-context-recovery.test.ts test/compile-context-recovery-engine.test.ts` exits `0`.
- [ ] `pnpm type-check` exits `0`.
- [ ] `pnpm maintainability:check` exits `0`.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
