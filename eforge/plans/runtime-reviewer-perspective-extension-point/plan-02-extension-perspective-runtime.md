---
id: plan-02-extension-perspective-runtime
name: Extension Reviewer Perspective Runtime
branch: runtime-reviewer-perspective-extension-point/plan-02-extension-perspective-runtime
agents:
  builder:
    effort: high
    rationale: This plan wires a new bounded runtime path through extension
      registration, build context, applicability evaluation, reviewer prompt
      composition, and event emission.
  reviewer:
    effort: high
    rationale: Runtime extension execution is trusted but fail-open; review needs to
      check isolation of read-only contexts, timeout behavior, and event schema
      coverage.
  tester:
    effort: high
    rationale: Runtime behavior depends on git diff snapshots, StubHarness agent
      dispatch, and failure/timeout cases that require targeted tests.
---

# Extension Reviewer Perspective Runtime

## Architecture Context

After plan 1, the runtime can carry dynamic perspective identifiers. This plan promotes `registerReviewerPerspective` from captured provenance to a bounded review-cycle extension point. Extension perspectives contribute prompt context and applicability metadata only; they cannot mutate orchestration state, define build stages, or provide validation providers.

## Implementation

### Overview

Extend the SDK/engine registration contract, validate registrations, pass reviewer perspective registrations into build stages, select applicable extension perspectives during `review-cycle`, compose generic reviewer prompts with extension provenance, emit typed diagnostics/provenance events, and keep failures fail-open.

### Key Decisions

1. Extension perspective specs contain `key`, `label`, `description`, `promptFragment`, and optional `appliesTo` rules. Migrate existing examples/tests by treating missing `description` as invalid for the new runtime contract and updating tests/examples in this plan.
2. Applicability supports declarative rules plus an optional function. Declarative rules cover `fileGlobs`, `paths` or path prefixes, `extensions`, built-in `categories`, `minChangedFiles`, and `minChangedLines`. Function rules receive a frozen read-only snapshot with changed files, changed line count, categories, plan id, plan file metadata, cwd/base branch strings, and extension provenance.
3. Applicability exceptions, invalid return values, and timeouts emit observable extension diagnostic events and skip that perspective for the current review round. Reviewer agent errors for selected perspectives continue to emit `plan:build:review:parallel:perspective:error`.
4. Built-in perspectives use existing specialized prompts/schemas. Extension perspectives use the generic `reviewer` prompt and `getReviewIssueSchemaYaml()` with an appended provenance section containing extension name/path, key, label, description, and the prompt fragment.
5. Explicit `review.perspectives` values are honored for registered extension keys. Unknown dynamic keys are diagnosed and skipped during parallel review rather than causing built-in map lookup failures.

## Scope

### In Scope

- Extend SDK and engine `ReviewerPerspectiveSpec` types with `description` and bounded applicability types.
- Validate reviewer perspective registrations for required fields, safe key pattern, duplicate keys, built-in key conflicts, prompt/description non-empty strings, and applicability object/function shape.
- Add runtime helpers for applicability context construction, declarative rule matching, optional function timeout execution, provenance metadata, and prompt composition.
- Add typed events and event registry summaries for extension reviewer perspective application, skip/failure/timeout diagnostics, and unknown explicit perspective keys if no existing event carries the data.
- Wire `NativeExtensionRegistry.reviewerPerspectives` into `PipelineContext`/`BuildStageContext` from `EforgeEngine.build` and compile/build pipeline construction.
- Update `runParallelReview` options to receive reviewer perspective registrations and use them for inference, explicit selection, prompt dispatch, and event emission.
- Add extension perspectives to auto-inferred built-in perspectives when applicability rules match changed files/diff stats.
- Update adaptive review selection so extension perspectives with prior issues are retained, and declarative applicability can be recomputed against evaluator file verdicts when available.
- Add tests for registration validation, built-in conflict rejection, applicability match/no-match, function throw/timeout/invalid return, explicit custom key dispatch, prompt provenance, and dynamic event validation.

### Out of Scope

- `registerValidationProvider` runtime execution.
- Arbitrary build/compile stage registration.
- Sandboxing extension modules.
- Planner-generated dynamic perspective selection beyond accepting explicit keys already present in config/artifacts.

## Files

### Create

- `packages/engine/src/extensions/reviewer-perspective-runtime.ts` — applicability evaluation, rule matching, timeout wrapper, prompt provenance composition helpers, and runtime metadata types.
- `test/extension-reviewer-perspective-runtime.test.ts` — end-to-end runtime tests using `StubHarness` and temporary git worktrees.

### Modify

- `packages/extension-sdk/src/hooks.ts` — add `ReviewerPerspectiveApplicability`, read-only context/result types, and `description` to `ReviewerPerspectiveSpec`.
- `packages/extension-sdk/src/api.ts` — update `registerReviewerPerspective` remarks from deferred to runtime-supported and document runtime limits in API comments.
- `packages/extension-sdk/src/index.ts` — export new reviewer perspective applicability/context types.
- `packages/engine/src/extensions/types.ts` — mirror SDK spec/context types for engine-side loading.
- `packages/engine/src/extensions/recorder.ts` — validate required fields, safe keys, built-in conflicts, duplicate keys, and applicability shape.
- `packages/engine/src/extensions/index.ts` — export runtime helper types/functions if needed by tests.
- `packages/engine/src/pipeline/types.ts` — add an extension registry subset or reviewer perspective registration array to pipeline/build context.
- `packages/engine/src/eforge.ts` — populate the new context field in compile/build contexts from `this.extensionRegistry`.
- `packages/engine/src/agents/parallel-reviewer.ts` — select extension perspectives, dispatch built-in vs extension prompts, emit provenance/diagnostic events, and aggregate issues keyed by dynamic perspective.
- `packages/engine/src/review-cycle-perspectives.ts` — accept extension applicability metadata for recomputing overlap and retain extension keys with prior issues.
- `packages/engine/src/pipeline/stages/build-stages.ts` — pass reviewer perspective registrations into `runParallelReview` and adaptive selection.
- `packages/client/src/events.schemas.ts` — add schemas for new extension reviewer perspective diagnostic/provenance events or extend existing decision metadata with extension provenance.
- `packages/client/src/event-registry.ts` — add summaries and persistence flags for any new reviewer perspective extension events.
- `packages/client/src/__tests__/events-schemas.test.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts` — cover the new events and dynamic perspective payloads.
- `test/extension-loader.test.ts` — extend loader validation tests for description, safe keys, built-in conflicts, duplicate custom keys, and applicability shapes.
- `test/extension-replay.test.ts` — update deferred registration summaries if reviewer perspectives are removed from the deferred family.
- `test/extension-sdk-example.test.ts` — update compile-time SDK examples for the new required spec fields and applicability types.
- `test/agent-wiring.test.ts`, `test/reviewer-verify.test.ts`, `test/sharded-build-via-review-cycle.test.ts` — update fixtures affected by `runParallelReview` option changes and add a StubHarness prompt assertion for extension fragments.
- `packages/eforge/src/cli/display.ts`, `packages/monitor-ui/src/components/timeline/event-card.tsx`, `packages/monitor-ui/src/lib/reducer/index.ts` — handle new extension reviewer perspective diagnostic events if added to the event union.

## Verification

- [ ] `pnpm type-check` exits 0 with `ReviewerPerspectiveSpec` requiring `description` and accepting applicability rules.
- [ ] Loader tests reject keys equal to `code`, `security`, `api`, `docs`, `test`, or `verify`, reject unsafe keys, reject missing descriptions, and keep duplicate custom keys as `extension:duplicate-registration` diagnostics.
- [ ] Runtime tests show an `accessibility` perspective with matching TSX file rules emits parallel start/start/complete events with `perspective: "accessibility"`.
- [ ] StubHarness captures a reviewer prompt containing the extension name, extension path, key, label, description, and prompt fragment for an extension perspective.
- [ ] Built-in reviewer prompt tests still observe the existing specialized prompt/schema for `code`, `security`, `api`, `docs`, `test`, and `verify`.
- [ ] Applicability function tests emit timeout/failure diagnostics and do not include the failing perspective in the round.
- [ ] Explicit `review.perspectives: ["accessibility"]` runs the registered extension perspective, while `review.perspectives: ["unknown-custom"]` emits an observable diagnostic and skips that key.
- [ ] Adaptive review tests retain a custom perspective that produced prior issues and drop it when it has no prior issues and no declarative overlap with evaluator file verdicts.