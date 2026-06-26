# Add Compile Resilience for Oversized PRDs

## Expedition Selection

This work spans engine compile intake, planner prompt construction, custom-tool validation, provider/harness failure classification, recovery sidecars, client wire schemas, CLI/Console rendering, and regression tests. Those are more than four independently explorable subsystems with shared contracts in `@eforge-build/client` and coordinated edits to compile-stage files, so the architecture uses expedition mode.

## Vision and Goals

Eforge compile must treat oversized PRDs as a bounded product path instead of allowing large generated inventories and failed validation payloads to consume the planner context until a provider hard-fails. The implementation must:

- Estimate compile risk before any large planner prompt is sent.
- Compact generated or machine-readable inventory content while preserving traceability.
- Keep normal small and moderate PRD prompts byte-for-byte or semantically unchanged.
- Bound planner custom-tool validation diagnostics, especially `submit_plan_set`.
- Stop proactively when prompt or live context growth crosses a safe threshold.
- Classify provider context-window/context-length errors as typed scope/context failures.
- Recommend or perform bounded retry-as-expedition only when eligible and capped.
- Fail closed when required compile artifacts are missing or invalid.
- Surface typed guidance through existing client/CLI/Console/recovery surfaces without moving scheduling or broad workflow orchestration into the engine.

## Core Architectural Principles

1. **Engine-owned, deterministic risk gates.** Preflight uses byte counts, acceptance-criteria counts, generated-inventory hints, subsystem breadth, selected profile, and pipeline scope. It must not depend on token-perfect estimates.
2. **Full source remains available outside prompts.** Prompt compaction affects agent input only; hashes, headings, counts, path references, and summaries preserve auditability.
3. **Client owns wire contracts.** New events, terminal subtypes, sidecar recovery options, and shared discriminants are defined in `@eforge-build/client` and re-exported by the engine.
4. **Bounded diagnostics are invariant.** Tool validation failures return a reusable bounded summary containing schema path, expected type, received type, compact excerpts, payload byte length, and content hash; raw oversized arguments are never echoed.
5. **Recovery is bounded, not scheduling.** Automatic escalation to expedition may happen within the same compile attempt only when eligibility is deterministic and attempt caps prevent loops. Otherwise emit typed guidance for bounded decomposition/manual replanning.
6. **Fail closed on partial success.** A compile phase reports success only after `orchestration.yaml` and every required plan file are persisted and validated.
7. **Existing repair paths remain preferred.** If valid partial artifacts exist and are repair-eligible, do not auto-retry from scratch or auto-escalate.
8. **Existing engine discipline still applies.** Any plan-state mutation must use `mutateState(state, event)`, and any `plan:build:decision` emission must use `emitBuildDecision`/`emitBuildDecisionForPlan` rather than direct event construction.

## Module Responsibilities

- **foundation-contracts** owns shared client schemas, event variants, terminal subtypes, recovery option discriminants, and exported type names. It does not make engine recovery decisions.
- **preflight-compaction** owns deterministic source measurement, acceptance-criteria counting, generated inventory/sidecar detection, prompt-source compaction, and creation of `CompilePromptSourceBundle`/`CompilePreflightRisk` values. It does not classify provider failures or validate persisted artifacts.
- **planner-guardrails** owns compact-source plumbing into composer/planner prompts, live context-budget observation, and bounded planner tool-validation diagnostics. It does not decide compile success.
- **context-recovery** owns scope/context error classification, `planning:scope-context:failure` construction, attempt-cap/idempotency metadata, recovery option generation, and the optional one-time retry-as-expedition decision. It does not compact source content.
- **artifact-validation** owns the final persisted-artifact success gate and returns artifact summaries used by recovery. It does not initiate retries by itself.
- **surfaces-docs** owns rendering of shared client event/recovery types in CLI, Console, and recovery markdown. It must not re-declare daemon wire shapes or route constants.

## Shared Data Model

Event-facing arrays in the compile-resilience schemas must be bounded by a shared constant such as `MAX_COMPILE_RISK_LIST_ITEMS`; counts retain the unbounded totals while arrays carry representative hashes/headings/paths/evidence. This keeps `planning:preflight`, failure payloads, and recovery sidecars compact even for PRDs with many generated inventory entries.

### Compile Risk Result

A client-owned schema, re-exported by the engine, should describe deterministic preflight output:

```ts
type CompileRiskLevel = 'normal' | 'elevated' | 'overflow-risk';
type CompileRecoveryAction = 'none' | 'retry-as-expedition' | 'bounded-decomposition' | 'manual-reduce-scope' | 'repair-existing-artifacts';

interface CompilePreflightRisk {
  sourceBytes: number;
  promptSourceBytes: number;
  acceptanceCriteriaCount: number;
  generatedInventory: {
    detected: boolean;
    blockCount: number;
    sidecarCount: number;
    omittedBytes: number;
    contentHashes: string[];
    pathReferences: string[];
    headings: string[];
  };
  subsystemBreadth: {
    count: number;
    subsystems: string[];
    evidence: string[];
  };
  selectedProfile?: string | null;
  pipelineScope?: 'errand' | 'excursion' | 'expedition';
  score: number;
  level: CompileRiskLevel;
  reasons: string[];
  recommendation: {
    action: CompileRecoveryAction;
    eligible: boolean;
    reason: string;
  };
}
```

### Preflight Options

The engine preflight helper accepts explicit options so modules do not invent separate escape hatches for full-content inclusion:

```ts
interface CompilePreflightOptions {
  selectedProfile?: string | null;
  requestedPipelineScope?: 'errand' | 'excursion' | 'expedition' | null;
  fullContentRequiredPaths?: string[];
  fullContentRequiredHeadings?: string[];
  maxPromptSourceBytes?: number;
}
```

`fullContentRequiredPaths` and `fullContentRequiredHeadings` default to empty arrays. Generated inventories and machine-readable sidecars are included at full size only when they match one of those explicit allow-lists; otherwise they are summarized/path-hash referenced. Small/moderate ordinary PRDs still pass through unchanged.

### Compacted Source Bundle

Engine-only helper output passed through `PipelineContext`:

```ts
interface CompilePromptSourceBundle {
  originalBytes: number;
  promptSource: string;
  promptSourceBytes: number;
  sourceHash: string;
  compactions: Array<{
    kind: 'generated-inventory' | 'machine-readable-sidecar' | 'large-code-fence';
    heading?: string;
    path?: string;
    originalBytes: number;
    contentHash: string;
    itemCount?: number;
    preservedSummary: string;
  }>;
}
```

### Bounded Validation Diagnostic

Reusable diagnostic summaries should include:

- `schemaPath` / TypeBox JSON pointer converted to dot path for readability.
- `expectedType` derived from the schema node.
- `receivedType` derived from the payload value at that path.
- `excerpt` capped per value and total message cap.
- `payloadBytes` and `payloadSha256` for the whole submitted argument object.
- `omittedBytes`/`truncated` markers when bounding occurs.

The planner/tooling integration uses a named helper contract rather than ad-hoc string formatting:

```ts
interface BoundedDiagnosticOptions {
  maxMessageBytes: number;
  maxExcerptBytes: number;
}

interface BoundedValidationDiagnostic {
  schemaPath: string;
  expectedType: string;
  receivedType: string;
  excerpt: string;
  payloadBytes: number;
  payloadSha256: string;
  omittedBytes: number;
  truncated: boolean;
  message: string;
}

function formatPlannerToolValidationDiagnostic(input: {
  toolName: string;
  schemaPath: string;
  expectedType: string;
  receivedValue: unknown;
  fullPayload: unknown;
  options?: Partial<BoundedDiagnosticOptions>;
}): BoundedValidationDiagnostic;
```

### Scope/Context Failure

Client-owned event payload used for both proactive guard stops and provider errors:

```ts
interface CompileScopeContextFailure {
  source: 'preflight' | 'live-context-guard' | 'provider';
  failureKind: 'context-budget' | 'context-window' | 'context-length' | 'scope-too-broad';
  stage: 'pipeline-composer' | 'planner' | 'module-planner' | 'compile-expedition' | 'compile';
  explanation: string;
  risk?: CompilePreflightRisk;
  observed?: { inputTokens?: number; outputTokens?: number; turns?: number; promptBytes?: number };
  recovery: {
    action: CompileRecoveryAction;
    eligible: boolean;
    attempted: boolean;
    attempt: number;
    maxAttempts: number;
    reason: string;
  };
  artifacts: CompileArtifactSummary;
}

interface CompileArtifactSummary {
  orchestrationExists: boolean;
  validPlanCount: number;
  invalidPlanCount: number;
  missingPlanFiles: string[];
  invalidPlanFiles: string[];
}

class CompileScopeContextError extends Error {
  readonly failure: CompileScopeContextFailure;
}

function classifyProviderContextError(error: unknown): null | {
  failureKind: 'context-window' | 'context-length';
  explanation: string;
};
```

`CompileScopeContextError` is the engine-only bridge between planner guardrails and context-recovery. Client packages own the serializable `CompileScopeContextFailure` shape; engine modules own the thrown error class and provider string classifier.

## Integration Contracts Between Modules

### Foundation Contracts

- Adds client schemas/types for `CompilePreflightRisk`, `CompileScopeContextFailure`, `CompileArtifactSummary`, new `planning:preflight` and `planning:scope-context:failure` event variants, and `error_context_window` terminal subtype.
- Extends recovery sidecar option types to allow non-mutating guidance options such as `retry-as-expedition` and `bounded-decomposition` without changing the `apply-recovery` verdict enum.
- Exports only serializable wire contracts from `@eforge-build/client`; engine-only helpers such as `CompileScopeContextError`, provider error classification, and bounded payload formatting live in engine modules and return the shared client-owned shapes.

### Preflight and Compaction

- Runs immediately after source normalization / visible stripped source construction in `EforgeEngine.compile`, before pipeline composer prompt construction.
- Produces `CompilePromptSourceBundle` with `buildCompilePromptSourceBundle(strippedSource: string, options: CompilePreflightOptions)` and `CompilePreflightRisk` with `estimateCompilePreflightRisk(bundle: CompilePromptSourceBundle, options: CompilePreflightOptions)`.
- Stores the full stripped source and compacted prompt source separately in `PipelineContext`.
- Emits `planning:preflight` before the composer prompt with the risk signals known at that point. If final `pipelineScope` is only known after `planning:pipeline`, the engine may enrich `ctx.compilePreflight` for downstream decisions and `planning:scope-context:failure` payloads, but it must not mutate the already-emitted event. Emitting a later preflight update requires an explicit revision/update field in the client schema.
- For small/moderate inputs, `promptSource` must equal the visible stripped source.
- For generated inventories, replaces large bodies with traceable summaries preserving counts, headings, hashes, path references, and compact human-readable summaries unless the explicit full-content options require inclusion.

### Planner Guardrails and Diagnostics

- `runPlanner`, `composePipeline`, and `runModulePlanner` consume `promptSourceContent` instead of the raw full source when present.
- Submission tools use `formatPlannerToolValidationDiagnostic` for schema and post-parse validation failures, including semantic validation failures that can identify a schema path or logical field path.
- Live context guard observes prompt byte size and `agent:usage` events. When thresholds are crossed, it throws a `CompileScopeContextError` containing a `CompileScopeContextFailure`; context-recovery catches and emits the same failure event path used for provider context-window errors.
- Guard thresholds use named constants/configuration (for example max prompt bytes, max observed input tokens, max validation diagnostic bytes) so tests can assert deterministic boundaries.

### Context Failure and Recovery

- Provider errors matching context-window/context-length patterns map to `error_context_window` and then to `planning:scope-context:failure` via `classifyProviderContextError`.
- Automatic retry-as-expedition is eligible only when all of the following are true: the current compile scope is below expedition, the retry attempt count is below the configured max, the source hash/recovery metadata show this escalation has not already been attempted, no valid partial artifacts require repair, and the artifact summary indicates no usable orchestration/plan artifact set exists.
- If eligible and preflight/live guard recommends `retry-as-expedition`, the compile pipeline may switch from excursion/errand to expedition once, with the attempt budget recorded in the failure/recovery metadata.
- If eligibility is unclear, the max attempt has been reached, or valid partial artifacts exist and repair is available, no automatic retry occurs. Emit bounded guidance for `bounded-decomposition` or existing repair paths.
- Recovery metadata is idempotent: repeating classification for the same source hash and attempt number must produce the same recovery action and must not increment attempts unless an actual retry is started.
- Recovery sidecars for compile scope/context failures include non-mutating `recoveryOptions` so operators see retry-as-expedition/decomposition guidance without the engine taking over scheduling.
- Any state/status changes use `mutateState`, and any build-decision events use the existing decision helper entry points.

### Artifact Validation

- A final compile artifact validator runs before `phase:end` success.
- `validateCompileArtifacts(ctx)` returns `CompileArtifactSummary` plus a bounded failure message when validation fails.
- It requires `orchestration.yaml` to exist, parse, contain the injected pipeline, and reference valid plan files.
- It requires expedition module files to exist before deterministic compilation and rejects empty compiled plan bodies.
- Missing `orchestration.yaml`, missing plan files, invalid plan files, or invalid orchestration produce `phase:end failed` with a bounded message and no `Compile complete` false success.

### Surfaces

- Engine produces `planning:preflight`, `planning:scope-context:failure`, terminal subtype, and recovery sidecar values using shared client schemas.
- Daemon and SSE transport pass these values as `EforgeEvent`/client route types without re-declaring route constants or wire shapes.
- Console timeline and run-state handling render `planning:preflight` and `planning:scope-context:failure` using shared client types.
- CLI display renders concise preflight risk and scope/context failure guidance.
- Recovery report markdown and Console recovery panel render new non-mutating recovery options.
- Pi and Claude plugin command behavior changes are not expected; if implementation changes recovery or build command semantics, both integration packages must be updated together and the Claude plugin version bumped.

## Dependency Direction

The dependency graph is one-way:

1. `@eforge-build/client` defines serializable schemas and route/recovery types.
2. Engine modules import those types, produce events/sidecars, and keep engine-only helpers out of the client package.
3. Daemon/CLI/Console/Pi/plugin surfaces consume client types and engine-emitted events.

No surface package may import engine internals, and engine modules must not import Console/CLI/plugin code.

## Shared File Registry

| File | Modules | Region Strategy |
|------|---------|-----------------|
| `packages/engine/src/eforge.ts` | preflight-compaction, context-recovery, artifact-validation | Bounded exact edits in compile source-resolution/normalization, compile catch/finalization, and post-pipeline artifact-validation sections. |
| `packages/engine/src/pipeline/types.ts` | foundation-contracts, preflight-compaction, planner-guardrails, context-recovery | Append optional compile-resilience fields to `PipelineContext` in one coordinated block. |
| `packages/engine/src/pipeline/stages/compile-stages.ts` | preflight-compaction, planner-guardrails, context-recovery, artifact-validation | Separate import groups and non-overlapping blocks in planner stage, planner attempt wrapper, module planner handoff, and compile-expedition validation. |
| `packages/engine/src/agents/planner.ts` | preflight-compaction, planner-guardrails | Preflight owns prompt-source option plumbing; guardrails owns validation diagnostic formatting/tool handlers. |
| `packages/engine/src/agents/pipeline-composer.ts` | preflight-compaction, planner-guardrails | Preflight owns source substitution; guardrails owns prompt/context guard wrapping if needed. |
| `packages/engine/src/agents/module-planner.ts` | preflight-compaction, planner-guardrails | Preflight owns compact source injection; guardrails owns live guard integration if added. |
| `packages/engine/src/recovery/resume-sidecar.ts` | context-recovery, surfaces-docs | Context-recovery extends option union/builders; surfaces-docs consumes/rendering helpers without redefining shapes. |
| `packages/engine/src/recovery/sidecar-payload.ts` | context-recovery, surfaces-docs | Context-recovery supplies option data and recommended-action text; surfaces-docs adjusts rendering-facing text only. |
| `packages/client/src/events/shared/schemas.ts` | foundation-contracts, context-recovery | Foundation owns new schemas/subtypes; context-recovery may add optional terminal failure fields through the same compile-resilience block. |
| `packages/client/src/events/variants/session-planning.ts` | foundation-contracts, planner-guardrails, context-recovery | Foundation owns event schema additions; guardrails/recovery only consume those variants. |
| `packages/client/src/routes/recovery.ts` | context-recovery, surfaces-docs | Context-recovery owns type union additions; surfaces-docs consumes browser exports. |

New single-module helper files for preflight/compaction, bounded diagnostics, provider error classification, and artifact validation are allowed when they keep implementation files below 600 lines. They do not need shared-registry entries unless more than one module will edit them.

### Region Declarations

**`packages/engine/src/eforge.ts`**:
- `preflight-compaction`: in `compile()`, after source normalization / visible stripped source construction and before merge worktree creation; add no unrelated edits.
- `context-recovery`: in `compile()` catch/failure handling; convert `CompileScopeContextError` into typed events and bounded summary.
- `artifact-validation`: immediately after `yield* runCompilePipeline(ctx)` and before artifact commit/phase success.

**`packages/engine/src/pipeline/types.ts`**:
- `foundation-contracts`: import/type references for client compile-resilience wire types if required.
- `preflight-compaction`: optional `promptSourceContent`, `compilePreflight`, and `compilePromptSourceBundle` fields.
- `planner-guardrails`: optional guard configuration/result fields only.
- `context-recovery`: optional recovery attempt metadata fields only.

**`packages/engine/src/pipeline/stages/compile-stages.ts`**:
- `preflight-compaction`: imports for preflight helpers plus planner-stage preflight/pipeline-scope enrichment and compact-source handoff.
- `planner-guardrails`: imports and wrappers around `runPlannerAttempt`, `runModulePlannerAttempt`, and usage-event observation.
- `context-recovery`: scope-escalation/recovery decision block after pipeline composition and error conversion around planner execution.
- `artifact-validation`: compile-expedition missing-module/plan validation and final artifact checks.

**`packages/engine/src/agents/planner.ts`**:
- `preflight-compaction`: `PlannerOptions` prompt-source field and `loadPrompt('planner', { source: ... })` substitution.
- `planner-guardrails`: `formatSubmissionValidationError` replacement and submission-tool handler diagnostic integration.

**`packages/engine/src/agents/pipeline-composer.ts`**:
- `preflight-compaction`: option field and prompt source substitution.
- `planner-guardrails`: optional context-guard event observation only if guard logic is implemented at this layer.

**`packages/engine/src/agents/module-planner.ts`**:
- `preflight-compaction`: option field and prompt source substitution.
- `planner-guardrails`: optional context-guard event observation only if guard logic is implemented at this layer.

**`packages/client/src/events/shared/schemas.ts`**:
- `foundation-contracts`: compile risk/failure schemas, terminal subtype extension.
- `context-recovery`: optional terminal failure/recovery fields only if the foundation module leaves them as declared extension points.

**`packages/client/src/events/variants/session-planning.ts`**:
- `foundation-contracts`: new planning event variants.
- `planner-guardrails` / `context-recovery`: no direct edits unless tests prove a field is missing from the foundation contract.

**`packages/client/src/routes/recovery.ts`**:
- `context-recovery`: broaden `RecoverySidecarRecoveryOption` union.
- `surfaces-docs`: import/use the broadened union; do not re-declare it.

## Technical Decisions and Rationale

1. **Use character/byte thresholds with conservative defaults.** They are deterministic, testable, and explainable; token-perfect estimates are provider-specific and unnecessary for risk gating.
2. **Compact before the composer as well as the planner.** The pipeline composer is also an LLM planning prompt, so it must receive bounded source content with enough risk hints to choose expedition.
3. **Add new events rather than overloading warnings.** Typed events make daemon/Console/recovery projections testable and prevent context failures from being treated as generic manual failures.
4. **Keep automatic retry limited to same-compile escalation.** Retrying as expedition is permitted once when eligibility is clear and no required artifacts exist. Bounded decomposition otherwise remains guidance.
5. **Use sidecar `recoveryOptions` for new guidance.** The existing `RecoveryVerdict` enum remains stable; non-mutating options can guide operators without adding scheduler-owned behavior to the engine.
6. **Artifact validation is a compile success gate.** A `planning:complete` event alone is not success; persisted and validated files are required.
7. **Treat events as append-only.** Preflight enrichment after pipeline selection updates context/failure payloads or uses an explicit update event; it never mutates an already emitted event.
8. **Tests use real code and stub harnesses.** Stub harnesses simulate provider context failures; preflight, compaction, diagnostics, and artifact validation are tested with real functions.

## Quality Attributes

- Diagnostics for a deliberately huge invalid `submit_plan_set` payload stay below the configured upper bound and include path/type/hash/length details.
- Event-facing preflight and recovery payloads remain bounded even when the source contains many inventory sections or sidecars.
- Small/moderate PRDs do not escalate and do not lose prompt detail.
- Generated inventories preserve traceability but not bulk.
- Context-window failures and proactive context-budget stops use one typed classification path.
- Retry metadata is idempotent and attempt-capped.
- Files over 1,000 lines are edited with bounded exact edits only; new implementation files stay under 600 lines and new test files under 1,200 lines.
- Final validation: `pnpm type-check`, `pnpm test`, `pnpm maintainability:check`, and `pnpm build` all pass.

## Module Verification Expectations

Every module must include tests next to its code changes. Do not create a test-only module. Expected test coverage includes:

- Preflight: small PRD, oversized PRD, many acceptance criteria, generated inventory, broad subsystem hints, profile/scope signals.
- Compaction: counts/headings/hashes/path references/summaries retained; large machine-readable bodies omitted; explicit full-content allow-list behavior; small prompts unchanged.
- Diagnostics: huge invalid `submit_plan_set` payload bounded; no raw payload echo; schema path/type/hash/length present.
- Guard/classification: proactive guard and provider context errors emit typed scope/context failure and no false success.
- Recovery: retry-as-expedition/decomposition guidance when artifacts are absent; no auto retry when valid partial artifacts require repair; attempt caps/idempotent metadata.
- Artifact validation: missing `orchestration.yaml` or required plan files fails compile; valid normal errand/excursion behavior remains unchanged.
- Surfaces: shared client types parse new events; CLI/Console render concise guidance without re-declared wire shapes.
