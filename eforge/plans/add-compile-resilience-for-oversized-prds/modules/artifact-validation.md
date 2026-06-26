# Artifact Validation

## Architecture Reference

This module implements the **artifact-validation** portions of the architecture:

- **Module Responsibilities / artifact-validation** — final persisted-artifact success gating and expedition module completeness checks.
- **Integration Contracts Between Modules / Artifact Validation** — `validateCompileArtifacts(ctx)` returns a client-owned `CompileArtifactSummary` plus a bounded failure message, and compile success is reported only after required artifacts are present and parseable.
- **Shared Data Model / Scope/Context Failure** — consume `CompileArtifactSummary` from `foundation-contracts` so artifact summaries have the same shape as context-recovery failure payloads.
- **Shared File Registry / Region Declarations** — bounded exact edits in `eforge.ts` after `runCompilePipeline(ctx)` and in `compile-stages.ts` inside the `compile-expedition` stage.

Key constraints from architecture:

- A compile phase reports success only after `orchestration.yaml` exists, parses, contains the injected pipeline, and references valid plan files.
- Required plan files must exist, parse, match their orchestration entries, and have non-empty bodies.
- Expedition module files must exist before deterministic compilation and empty compiled plan bodies must be rejected.
- Missing or invalid artifacts produce `phase:end` with `result.status === 'failed'` and a bounded summary, not a false `Compile complete` success.
- Existing context-recovery retry/decomposition decisions stay outside this module; artifact validation does not initiate retries or scheduling.
- Existing compile skip behavior remains valid: a `planning:skip` run does not require plan artifacts.
- Event and wire shapes come from `@eforge-build/client`; this module defines no new client schemas.

## Scope

### In Scope

- Add an engine helper that validates persisted compile artifacts and returns `CompileArtifactSummary`.
- Add a bounded artifact-validation failure formatter with named byte/list caps.
- Require `orchestration.yaml` to exist before compile success unless `ctx.skipped` is set.
- Require `orchestration.yaml` to parse through `parseOrchestrationConfig()` and include a pipeline matching the effective `ctx.pipeline`.
- Require `validatePlanSet(orchestrationPath)` to pass before compile success.
- Require every orchestration plan entry to have a persisted `${plan.id}.md` file.
- Require every plan file to parse, have frontmatter `id` matching the orchestration entry, have branch matching the orchestration entry, and contain a non-empty body.
- Update `ctx.plans` from the validated persisted plan files before no-review artifact commits.
- Validate expedition module inputs before `compileExpedition()` runs: `index.yaml` parses, module IDs match the architecture/module context, and every module file exists with non-whitespace content.
- Validate expedition compiled artifacts before emitting expedition `planning:complete`.
- Add unit and stub integration tests for missing orchestration, missing plan files, invalid plan files, empty bodies, bounded summaries, skipped compiles, expedition missing modules, and normal valid compiles.

### Out of Scope

- Defining `CompileArtifactSummary` or other client wire schemas; `foundation-contracts` owns those.
- Provider context-window classification, `planning:scope-context:failure` emission, retry-as-expedition, bounded decomposition, and recovery sidecar options; `context-recovery` owns those.
- Preflight risk estimation or prompt compaction; `preflight-compaction` owns those.
- Planner tool validation diagnostic bounding and live context guards; `planner-guardrails` owns those.
- Changing the lower-level `compileExpedition()` transform to reject missing module files for direct callers; this module validates the engine compile path around that transform.
- Rollback or deletion of already committed plan artifacts after a validation failure.
- CLI, Console, Pi, or Claude plugin rendering changes.

## Implementation Approach

### Overview

Create `packages/engine/src/compile-resilience/artifact-validation.ts` with pure, bounded helpers for compile artifact checks. The helper reads only the plan-set artifact directory under `ctx.cwd`, builds a `CompileArtifactSummary`, and returns a discriminated validation result rather than throwing for expected missing/invalid artifact states.

`EforgeEngine.compile()` calls `validateCompileArtifacts(ctx)` immediately after `yield* runCompilePipeline(ctx)` and before the existing no-review artifact commit block. If validation fails, `compile()` sets `status = 'failed'`, sets `summary` to the bounded validation message, yields an existing `planning:error` event with the same bounded reason, and returns so the `finally` block emits `phase:end failed`. If validation succeeds, `compile()` replaces `ctx.plans` with the validated persisted plan files and continues to the existing commit path.

The `compile-expedition` stage performs two additional checks: `validateExpeditionModuleInputs(ctx)` before `compileExpedition()` and `validateCompileArtifacts(ctx)` after pipeline injection but before emitting `expedition:compile:complete` or expedition `planning:complete`. This prevents missing module files or empty compiled plan bodies from producing success-looking expedition events.

### Key Decisions

1. **Keep final validation in the engine compile path, not the pipeline runner.**  
   `runCompilePipeline(ctx)` remains a reusable stage runner with existing tests that assert raw stage events. The user-facing compile success gate belongs in `EforgeEngine.compile()` immediately before phase success.

2. **Treat `planning:skip` as a valid no-artifact terminal path.**  
   The planner prompt explicitly allows `<skip>` without writing artifacts. `validateCompileArtifacts(ctx)` returns `ok: true` with `skipped: true` when `ctx.skipped` is set, and the engine does not require `orchestration.yaml` for that path.

3. **Use `validatePlanSet()` plus stricter success-gate checks.**  
   `validatePlanSet()` already covers parse errors, dependency graph errors, build-stage names, and missing files. The new helper adds success-gate requirements not enforced today: injected pipeline equality, plan frontmatter ID/branch alignment with orchestration entries, and non-empty plan bodies.

4. **Validate expedition inputs at the stage boundary instead of changing `compileExpedition()`.**  
   `compileExpedition()` remains a deterministic file transformer used by direct tests and callers. The engine stage enforces stricter compile success semantics before and after calling it.

5. **Use client-owned bounded summary fields.**  
   Missing and invalid plan path samples are capped with `MAX_COMPILE_RISK_LIST_ITEMS`, while `missingPlanFileCount`, `validPlanCount`, and `invalidPlanCount` retain exact totals.

6. **Make failure messages deterministic and bounded.**  
   Define `MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES` and `MAX_COMPILE_ARTIFACT_DETAIL_BYTES` in the helper. Expected validation failures return messages under the max byte cap and include path samples plus counts, never full file contents.

7. **Do not emit new event variants.**  
   A validation failure uses the existing `planning:error` event and `phase:end failed`. Context/scope failure events remain owned by `context-recovery`.

### Helper Contract

The helper module should expose this behavior:

```ts
// --- eforge:region plan-05-artifact-validation ---
export const MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES = 4_096;
export const MAX_COMPILE_ARTIFACT_DETAIL_BYTES = 512;

export type CompileArtifactValidationResult =
  | {
      ok: true;
      skipped: boolean;
      summary: CompileArtifactSummary;
      plans: PlanFile[];
      orchestration?: OrchestrationConfig;
      warnings: string[];
    }
  | {
      ok: false;
      skipped: false;
      summary: CompileArtifactSummary;
      message: string;
      details: string[];
      warnings: string[];
    };

export type ExpeditionModuleInputValidationResult =
  | { ok: true; moduleCount: number }
  | {
      ok: false;
      message: string;
      missingModuleFiles: string[];
      emptyModuleFiles: string[];
      invalidModuleIds: string[];
      moduleCount: number;
    };

export async function validateCompileArtifacts(
  ctx: PipelineContext,
): Promise<CompileArtifactValidationResult>;

export async function validateExpeditionModuleInputs(
  ctx: PipelineContext,
): Promise<ExpeditionModuleInputValidationResult>;
// --- eforge:endregion plan-05-artifact-validation ---
```

Builders may omit temporary plan markers in final code when the file stays small and edits are non-overlapping. If temporary markers are used, the slug must remain `plan-05-artifact-validation`.

### Integration Notes

- Import `CompileArtifactSummary`, `MAX_COMPILE_RISK_LIST_ITEMS`, `PlanFile`, and `OrchestrationConfig` through `packages/engine/src/events.ts` after `foundation-contracts` re-exports them. Do not define parallel wire shapes in the engine.
- If `context-recovery` has already added `summarizeCompileArtifactsForRecovery(ctx)`, leave that recovery-evidence helper in place. This module's validator is the authoritative final success gate; keep field semantics aligned with the recovery summary but do not move retry/decomposition decisions into this module.
- `planner-guardrails` may throw `CompileScopeContextError` before artifact validation runs. This module only handles the post-pipeline persisted-artifact gate and expedition stage completeness checks.

### Artifact Validation Details

`validateCompileArtifacts(ctx)` must:

1. Compute `planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName)` and `orchPath = resolve(planDir, 'orchestration.yaml')`.
2. Return success immediately when `ctx.skipped === true`, with `orchestrationExists` reflecting disk state and all counts set from disk inspection if cheap to compute.
3. Fail when `orchestration.yaml` is absent with `summary.orchestrationExists === false`, `validPlanCount === 0`, `invalidPlanCount === 0`, and `missingPlanFileCount === 0`.
4. Parse orchestration through `parseOrchestrationConfig(orchPath)` and capture warnings.
5. Fail when `orchConfig.pipeline` does not equal the effective `ctx.pipeline` by stable JSON comparison.
6. Run `validatePlanSet(orchPath)` and include its errors as bounded details when it returns invalid.
7. For each `orchConfig.plans` entry:
   - expect `${plan.id}.md` under `planDir`;
   - increment `missingPlanFileCount` and add a bounded path sample when the file is absent;
   - parse with `parsePlanFile()` when present;
   - mark invalid when parsing fails, frontmatter `id` differs from `plan.id`, branch differs from `plan.branch`, or `body.trim().length === 0`;
   - count valid plans and return parsed `PlanFile` objects for successful entries.
8. Fail when any missing or invalid plan file exists.
9. Fail when `orchConfig.plans.length === 0` even if `validatePlanSet()` has already produced that error.
10. Return success with the parsed `OrchestrationConfig`, parsed `PlanFile[]`, warning strings, and a summary whose counts match the persisted artifact set.

`validateExpeditionModuleInputs(ctx)` must:

1. Return success when `ctx.expeditionModules.length === 0`.
2. Parse `index.yaml` via `parseExpeditionIndex()` from the current plan directory.
3. Compare the module ID set from `ctx.expeditionModules` with the module ID set in `index.yaml`; any missing or unexpected ID is an invalid module ID detail.
4. For every module ID from `index.yaml`, require `modules/${id}.md` to exist under the modules directory.
5. Require each module file to contain non-whitespace text.
6. Return bounded missing/empty/invalid samples and an error message below `MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES` when validation fails.

## Files

### Create

- `packages/engine/src/compile-resilience/artifact-validation.ts` — final compile artifact validator, expedition module input validator, bounded message/list helpers, stable pipeline comparison, and `CompileArtifactSummary` construction.
- `test/compile-artifact-validation.test.ts` — unit tests for helper behavior with real temporary files and real parsers.
- `test/compile-artifact-validation-engine.test.ts` — stub compile tests for engine-level phase failure and expedition completeness behavior.

### Modify

- `packages/engine/src/eforge.ts` — call `validateCompileArtifacts(ctx)` immediately after `yield* runCompilePipeline(ctx)` and before the existing no-review commit block; on validation failure set `status = 'failed'`, set the bounded summary, yield `planning:error`, and return; on success assign `ctx.plans = validation.plans` `[region: artifact-validation, in compile() immediately after the runCompilePipeline(ctx) call and before the “If compile pipeline didn't produce plans” commit block]`.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — import artifact validation helpers; in `compileExpeditionStage`, validate module inputs before `compileExpedition()`, validate persisted artifacts after `injectPipelineIntoOrchestrationYaml()`, emit expedition completion events with validated plans only after validation success, and set `ctx.plans` from validated files `[region: artifact-validation, import section and compileExpeditionStage only; do not edit planner/context-recovery retry blocks]`.

## Testing Strategy

### Unit Tests

Add `test/compile-artifact-validation.test.ts` cases for:

- Valid errand/excursion artifacts: helper returns `ok: true`, `summary.orchestrationExists === true`, `validPlanCount === 1`, `missingPlanFileCount === 0`, `invalidPlanCount === 0`, and a parsed plan body matching the persisted file.
- Missing `orchestration.yaml`: helper returns `ok: false`, `summary.orchestrationExists === false`, and `message` contains `orchestration.yaml` with byte length at or below `MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES`.
- Orchestration missing the injected pipeline: helper returns `ok: false` and includes `pipeline` in bounded details.
- Orchestration pipeline differs from `ctx.pipeline`: helper returns `ok: false` and includes `orchestration.pipeline` in bounded details.
- Missing plan file: helper returns `ok: false`, `summary.missingPlanFileCount === 1`, and `summary.missingPlanFiles` includes the expected relative path.
- Many missing plan files: helper caps `summary.missingPlanFiles.length` at `MAX_COMPILE_RISK_LIST_ITEMS` while preserving the exact `missingPlanFileCount`.
- Invalid plan frontmatter: helper returns `ok: false`, `summary.invalidPlanCount === 1`, and `summary.invalidPlanFiles` includes the plan path.
- Frontmatter ID mismatch and branch mismatch: helper marks each file invalid and records bounded details.
- Empty plan body: helper returns `ok: false`, `summary.invalidPlanCount === 1`, and `message` includes `empty plan body`.
- Skipped compile: with `ctx.skipped === true` and no artifacts, helper returns `ok: true`, `skipped === true`, and an empty `plans` array.
- Expedition module input validation with all module files present: helper returns `ok: true` and the expected module count.
- Expedition module input validation with a missing module file: helper returns `ok: false` and `missingModuleFiles` includes the bounded module path.
- Expedition module input validation with an empty module file: helper returns `ok: false` and `emptyModuleFiles` includes the bounded module path.
- Expedition module ID mismatch between `ctx.expeditionModules` and `index.yaml`: helper returns `ok: false` and `invalidModuleIds.length > 0`.

### Integration / Stub Tests

Add `test/compile-artifact-validation-engine.test.ts` cases for:

- Engine compile with a custom compile stage that emits `planning:complete` but writes no `orchestration.yaml`: final `phase:end.result.status === 'failed'`, summary contains `orchestration.yaml`, a `planning:error` event is emitted, and no no-review artifact commit is created.
- Engine compile with a custom compile stage that writes a valid plan set but does not populate `ctx.plans`: final `phase:end.result.status === 'completed'`, `ctx.plans` is populated through validation before the no-review commit path, and the plan artifact commit exists in the merge worktree.
- Expedition compile where planner submits architecture, module planner emits completion but writes no module file: final `phase:end.result.status === 'failed'`, summary contains `missing expedition module`, `expedition:compile:complete` is absent, and expedition `planning:complete` is absent.
- Expedition compile where a module file exists but has only whitespace: final `phase:end.result.status === 'failed'`, summary contains `empty expedition module`, and no expedition `planning:complete` event is emitted.
- Valid small errand compile through `StubHarness`: final `phase:end.result.status === 'completed'`, `planning:complete` is emitted, and persisted `orchestration.yaml` plus plan file pass `validateCompileArtifacts()`.

## Verification

- [ ] `validateCompileArtifacts()` returns `ok: false` and `summary.orchestrationExists === false` when `orchestration.yaml` is absent.
- [ ] Missing orchestration failure messages have UTF-8 byte length less than or equal to `MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES`.
- [ ] `validateCompileArtifacts()` returns `ok: false` and `summary.missingPlanFileCount === N` for an orchestration referencing `N` absent plan files.
- [ ] `summary.missingPlanFiles.length` is less than or equal to `MAX_COMPILE_RISK_LIST_ITEMS` for more than `MAX_COMPILE_RISK_LIST_ITEMS` missing files.
- [ ] `validateCompileArtifacts()` returns `ok: false` and `summary.invalidPlanCount === 1` for a plan file with missing frontmatter.
- [ ] `validateCompileArtifacts()` returns `ok: false` for a plan file whose frontmatter ID differs from the orchestration plan ID.
- [ ] `validateCompileArtifacts()` returns `ok: false` for a plan file whose branch differs from the orchestration plan branch.
- [ ] `validateCompileArtifacts()` returns `ok: false` for a plan file whose body is empty after trimming whitespace.
- [ ] `validateCompileArtifacts()` returns `ok: false` when parsed `orchestration.pipeline` differs from `ctx.pipeline`.
- [ ] `validateCompileArtifacts()` returns `ok: true`, `skipped === true`, and `plans.length === 0` for `ctx.skipped === true` with no artifacts.
- [ ] `validateExpeditionModuleInputs()` returns `ok: false` with a bounded message when an index module lacks `modules/<id>.md`.
- [ ] `validateExpeditionModuleInputs()` returns `ok: false` with a bounded message when an index module file contains only whitespace.
- [ ] `compileExpeditionStage` throws before calling `compileExpedition()` when `validateExpeditionModuleInputs()` returns `ok: false`.
- [ ] `compileExpeditionStage` emits no `expedition:compile:complete` and no expedition `planning:complete` after an expedition module input validation failure.
- [ ] `EforgeEngine.compile()` emits `phase:end` with `result.status === 'failed'` when final artifact validation fails after `runCompilePipeline(ctx)`.
- [ ] `EforgeEngine.compile()` emits `planning:error` with the same bounded summary used in `phase:end.result.summary` for final artifact validation failures.
- [ ] `EforgeEngine.compile()` updates `ctx.plans` from validated persisted plan files before the no-review artifact commit block.
- [ ] A valid small errand compile emits `phase:end` with `result.status === 'completed'` and preserves existing `planning:complete` behavior.
- [ ] `packages/engine/src/pipeline/stages/compile-stages.ts` remains at or below its `613` line no-growth ceiling.
- [ ] `packages/engine/src/eforge.ts` remains at or below its `3182` line no-growth ceiling.
- [ ] New implementation files remain at or below `600` lines.
- [ ] New test files remain at or below `1,200` lines.
- [ ] `pnpm test -- test/compile-artifact-validation.test.ts test/compile-artifact-validation-engine.test.ts` exits `0`.
- [ ] `pnpm type-check` exits `0`.
- [ ] `pnpm maintainability:check` exits `0`.
- [ ] `pnpm build` exits `0`.

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
