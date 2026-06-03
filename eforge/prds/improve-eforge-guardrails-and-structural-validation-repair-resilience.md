---
title: Improve eforge Guardrails and Structural Validation Repair Resilience
created: 2026-06-03
landing: pr
landing_auto_merge: true
---

# Improve eforge Guardrails and Structural Validation Repair Resilience

## Problem / Motivation

A concrete failed build exposed a structural gap in eforge validation recovery. In session `092b5f61-89b1-49ca-ad9c-5356508d7d1b`, `plan-01-platform-contracts` failed because `agent-maintainability-gate` reported `packages/client/src/routes.ts` at 628 lines against a 626-line no-growth ceiling.

The recovery sidecar `.eforge/queue/failed/build-extension-platform-foundation-for-kernel-boundary-extraction.recovery.md` reports a `MANUAL` verdict, three rejected or insufficient narrow fixes, no completed implementation commit, and downstream plans blocked by the failed first plan.

Backlog source: `.eforge/backlog/items/backlog-2026-06-03-improve-eforge-guardrails-and-structural-validation-repair-r.md`.

Validated current implementation facts:

- `packages/extension-sdk/src/hooks.ts` currently defines `ValidationProviderResult` with `status`, `message`, `details`, and annotations containing only `severity`, `message`, `file`, and `line`.
- `packages/engine/src/extensions/validation-provider-runtime.ts` normalizes validation annotations to `severity`, `message`, `file`, `line`, and `details`; it drops any richer guidance fields today.
- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` maps validation failures into generic `ReviewIssue`s and always calls the normal `review-fix` / `evaluate` callbacks for recoverable provider failures.
- `packages/engine/src/pipeline/stages/build-stages.ts` wires the `validate` stage to `runValidationProviderRecoveryStage` with `reviewFixStageInner` and `evaluateStageInner`; there is no structural validation-fixer path in the validate stage today.
- `packages/engine/src/prompts/review-fixer.md` instructs the fixer to keep changes minimal and not alter architecture; this conflicts with validation failures whose correct repair is a structural split/refactor.
- `packages/engine/src/agents/validation-fixer.ts` and `packages/engine/src/prompts/validation-fixer.md` exist for post-merge validation failures, but that agent currently commits changes and is not wired as an in-build validation-provider repair path.
- `eforge/extensions/eforge-guardrails.ts` currently runs `pnpm maintainability:check` and returns free-form `message`/`details` only when it fails; it does not parse maintainability output into annotations.
- `scripts/check-agent-maintainability.mjs` emits parseable lines for file-size failures: `BASELINE EXCEEDED  <path>: <lines> lines (ceiling: <ceiling>)` and `CAP EXCEEDED  <path>: <lines> lines (<category> cap: <cap>)`, plus a separate region-marker balance violation section.
- Current `packages/client/src/routes.ts` is 626 lines, and `pnpm maintainability:check` exits 0 in the current checkout, confirming the historical failure source is not currently active on this branch.
- `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, and `examples/extensions/validation-provider.ts` document the current annotation-only targeting behavior and the current review-fixer/evaluator recovery path.

Roadmap alignment:

- This fits `Kernel Resilience and Typed Recovery` through typed validation repair, honest gates, and inspectable recovery decisions.
- This fits `Extension Platform` by clarifying native validation-provider guidance without broadening into arbitrary UI/actions or wrapper-app workflow UX.

Classification:

- This is an **architecture / deep** change.
- It changes SDK contracts, engine validation recovery control flow, repair-agent prompting, event/review issue wire shape, a project-team extension, docs, examples, and tests.
- The depth is deep because assumption validation and cross-boundary data flow matter, not because the implementation needs delegated module planning.

## Goal

Improve eforge guardrails and structural validation repair resilience by replacing annotation-only validation-provider failures with structured repair guidance, routing structural validation failures to an appropriate in-build repair path, preserving failed implementation checkpoints, and making maintainability gate failures machine-readable.

The desired outcome is a validation recovery flow that can distinguish narrow repairs from structural repairs, avoid repeated ineffective line-shaving attempts, preserve inspectable failure artifacts, and keep recovery decisions typed and headless.

## Approach

### High-level architecture

This changes several kernel and extension boundaries:

- Public extension SDK contract: `packages/extension-sdk/src/hooks.ts`, `api.ts`, and `index.ts` will expose a stronger validation-provider result/guidance shape. Because the extension surface is greenfield, the build may remove weak legacy return forms and require structured results for function-form providers if that yields a cleaner contract.
- Engine validation normalization: `packages/engine/src/extensions/validation-provider-runtime.ts` must preserve the new guidance fields instead of dropping them during annotation normalization. Runtime failure-kind fields must remain distinguishable from provider-authored/domain failure-kind fields.
- Engine build pipeline: `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` needs a recovery strategy layer that chooses narrow review-fix or structural validation-fix based on guidance and attempt history. The `validate` stage wiring in `build-stages.ts` must supply the new structural repair callback.
- Repair agent boundary: the existing post-merge `validation-fixer` agent cannot be reused unchanged because it commits changes. The in-build structural validation repair path must leave changes unstaged for evaluator application, or introduce an explicit safe commit path with equivalent evaluator safeguards. Preferred architecture is an in-build validation-fixer mode/prompt that leaves changes unstaged and lets the existing evaluator accept/reject the candidate patch.
- Evaluator context: evaluator strictness currently treats broad refactors as suspect. Validation repair guidance must be visible to the evaluator so structural repairs requested by the validation provider are judged against the provider guidance rather than rejected as ordinary reviewer-driven scope creep.
- Wire/event shape: `ReviewIssue` is re-exported from `@eforge-build/client`, so adding guidance fields to review issues affects `packages/client/src/events.schemas.ts` and any UI/reducer/tests that consume review issues. If a separate validation-repair issue type is introduced instead, event schemas still need a single source of truth in `@eforge-build/client`.
- Recovery artifacts: checkpoint preservation should live in the engine/kernel, not in the extension. The engine knows the worktree, base refs, plan id, provider name, and attempt number and can write deterministic patches/checkpoint metadata under `.eforge` before repair attempts.
- Project-team guardrails extension: `eforge/extensions/eforge-guardrails.ts` becomes the first concrete provider using the new guidance contract by parsing maintainability output into repair-aware annotations.
- Documentation/examples: `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, `examples/extensions/validation-provider.ts`, and `examples/extensions/README.md` must describe the new result shape and the structural repair semantics.

The architecture should keep the engine headless. It should emit typed events and artifacts for inspection, but it should not move recovery orchestration into Console/Pi/Claude integrations.

### Design decisions

- Use a clean structured validation-provider result contract rather than compatibility shims. Rationale: the extension validation surface is greenfield and preserving legacy string/null behavior would keep the recovery path ambiguous. In-repo extension(s), examples, docs, and tests should migrate together.
- Keep command-form providers for simple subprocess gates if useful, but treat command-form failures as generic validation failures with synthesized guidance. Rationale: command form is convenient for simple gates but cannot express rich provider-authored repair guidance; function form is the preferred path for structural guidance.
- Put repair guidance on validation annotations and/or a normalized validation issue object, not only on top-level provider results. Rationale: a single provider can report multiple file-specific failures with different repair classes or metadata.
- Include at least these guidance fields: `fix`, `retryGuidance`, `failureKind`, `repairClass`, and JSON-safe `metadata`. Rationale: `fix` tells the repair agent what to do, `retryGuidance` tells later attempts what to avoid/retry, `failureKind` supports stable signatures, `repairClass` selects narrow vs structural vs manual behavior, and metadata carries validator-specific facts such as line counts and ceilings.
- Define `repairClass` as a small closed set, such as `narrow`, `structural`, `manual`, and `followup`. Rationale: the engine needs deterministic routing without parsing prose.
- Require metadata to be JSON-safe and bounded. Rationale: metadata may be persisted in events/artifacts and rendered in recovery sidecars; it must not contain functions, cyclic objects, raw large command output, or secrets.
- Preserve human-readable `message` and `details` for diagnostics, but do not make repair strategy depend on free-form strings when structured fields exist. Rationale: prose is useful to humans but unreliable for recovery routing.
- Map `repairClass: structural` to a structural validation repair path before using another narrow review-fixer pass. Rationale: the observed failure loop showed that narrow line-shaving attempts are counterproductive when the correct fix is extraction/splitting.
- Escalate to structural repair when repeated identical or materially equivalent signatures persist after a narrow attempt, even if the original provider did not classify the repair as structural. Rationale: repeated failure with little or no improvement is evidence that the narrow path is exhausted.
- Use the existing evaluator/patch application mechanism for structural validation repair outputs where feasible. Rationale: evaluator gating prevents repair agents from landing unrelated or unsafe broad changes, but evaluator prompts must receive validation guidance so intentional structural repairs are not rejected as ordinary scope creep.
- Preserve implementation checkpoints before each validation repair attempt by writing a deterministic patch/checkpoint artifact outside the ephemeral plan worktree when possible. Rationale: failed worktree cleanup should not erase the exact failed implementation state needed for manual or automated recovery.
- Record checkpoint references in events or recovery summaries. Rationale: recovery sidecars should be able to explain exactly what was preserved and how to inspect it.
- Parse maintainability output with explicit regexes for known lines (`BASELINE EXCEEDED`, `CAP EXCEEDED`, and region marker sections) and fall back to a generic validation failure when parsing fails. Rationale: known output is stable enough to structure; unparseable output should remain fail-closed.
- For maintainability file-size failures, default `repairClass` should be `structural` when the file is at a no-growth baseline or the overflow cannot be fixed by removing temporary plan markers alone. Rationale: comment shortening and dense formatting are policy-hostile; cohesive extraction or module splitting is the desired repair mode.
- Add tests at the unit/integration seams rather than only end-to-end. Rationale: the failure mode spans SDK types, normalization, guidance-to-issue mapping, strategy selection, checkpoint artifacts, and guardrails parsing; each seam needs focused coverage.

### Code impact

Likely implementation targets validated by file reads/search:

- `packages/extension-sdk/src/hooks.ts`: redefine `ValidationProviderResult`, validation annotations, return types, and docs comments for the clean guidance contract.
- `packages/extension-sdk/src/api.ts`: update `registerValidationProvider` API comments and examples to match the clean contract and greenfield/no-compatibility stance.
- `packages/extension-sdk/src/index.ts`: continue exporting the updated validation provider types.
- `packages/engine/src/extensions/types.ts`: mirror or import the updated validation-provider spec shape used by extension recorder/runtime.
- `packages/engine/src/extensions/recorder.ts`: validate the updated provider spec shape if return contract or command/function restrictions change.
- `packages/engine/src/extensions/validation-provider-runtime.ts`: normalize and preserve guidance fields, validate JSON-safe metadata, separate provider-authored failure kinds from runtime failure kinds, and emit details without leaking unsupported values.
- `packages/client/src/events.schemas.ts`: update `ReviewIssueSchema` or add a dedicated validation repair issue schema if guidance is carried through events. Engine `ReviewIssue` comes from `@eforge-build/client`, so client schema ownership applies.
- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts`: add strategy selection, failure signature tracking, escalation, checkpoint calls, and guidance-to-issue mapping.
- `packages/engine/src/pipeline/stages/build-stages.ts`: wire the structural repair callback into the `validate` stage and ensure evaluator prompt context receives validation guidance.
- `packages/engine/src/agents/validation-fixer.ts` and `packages/engine/src/prompts/validation-fixer.md`, or new sibling files: add an in-build validation repair mode that does not stage/commit and can perform focused structural fixes when explicitly guided.
- `packages/engine/src/prompts/review-fixer.md`: update narrow validation-provider repair guidance so narrow repair agents respect `fix`/`retryGuidance` and avoid structural work unless routed there.
- `packages/engine/src/prompts/evaluator.md` or evaluator prompt-append plumbing: provide validation repair context so the evaluator can accept structural repairs that are directly justified by validation guidance.
- `eforge/extensions/eforge-guardrails.ts`: parse maintainability output and return structured guidance annotations for baseline, cap, and region-marker failures.
- `scripts/check-agent-maintainability.mjs`: no behavior change is required unless parsing proves easier with machine-readable output; if changed, preserve existing human-readable output unless the plan explicitly chooses a new contract.
- `test/validation-provider-runtime.test.ts`: cover guidance normalization and metadata validation.
- `test/validation-provider-recovery-stage.test.ts`: cover guidance-to-issue mapping, structural routing, repeated-signature escalation, and checkpoint invocation.
- `test/validation-provider-build-stage.test.ts`: cover validate-stage wiring with structural repair callback behavior where practical.
- `test/extension-loader.test.ts` and `test/extension-replay.test.ts`: update validation-provider spec expectations if the SDK/runtime shape changes.
- `test/extension-sdk-example.test.ts` and example tests: migrate examples to the new result contract.
- New or existing tests for `eforge/extensions/eforge-guardrails.ts`: cover maintainability output parsing for `BASELINE EXCEEDED`, `CAP EXCEEDED`, and region marker violations.

Existing patterns to follow:

- Validation provider recovery already has focused tests in `test/validation-provider-recovery-stage.test.ts`.
- Validation runtime already has focused tests in `test/validation-provider-runtime.test.ts`.
- Engine event/wire types are owned by `@eforge-build/client`, and engine imports `ReviewIssue` through `packages/engine/src/events.ts`.

### Documentation impact

Update these docs and examples:

- `docs/extensions.md`: replace annotation-only validation-provider guidance with the new first-class guidance contract, structural repair semantics, greenfield/no-backward-compatibility stance, and command-form limitations.
- `docs/extensions-api.md`: update the `ValidationProviderResult` interface, worked examples, failure semantics, and recovery description.
- `packages/extension-sdk/README.md`: update validation-provider summary and examples to show structured guidance fields.
- `examples/extensions/validation-provider.ts`: migrate the example to return the new structured result shape and demonstrate at least one annotation with guidance fields.
- `examples/extensions/README.md`: update validation-provider example description.
- `docs/llm-friendly-code.md`: update only if the maintainability guidance policy needs explicit language about structural repair versus line-shaving.
- `docs/architecture.md`: update only if the implementation introduces a distinct in-build validation-fixer role/mode or changes the agent/stage architecture description.

Do not update `docs/roadmap.md` to mark roadmap items shipped unless the implementation fully ships the corresponding resilience capability. This plan is aligned with existing roadmap themes but does not require roadmap text changes.

### Risks

- The clean contract may require touching both `@eforge-build/extension-sdk` and engine-local extension types. Mitigation: keep the shape small and migrate in-repo examples/tests/docs in one pass.
- Adding guidance fields to `ReviewIssue` affects client-owned event schemas. Mitigation: update `packages/client/src/events.schemas.ts` and avoid redeclaring wire shapes in engine/monitor packages.
- Structural validation repair can become a loophole for broad scope creep. Mitigation: route structural repair only when provider guidance or repeated signatures justify it, and keep evaluator gating in place.
- Evaluator strictness may reject valid structural repairs if it does not see provider guidance. Mitigation: explicitly pass validation repair context into evaluator prompts or the evaluation snapshot context.
- Checkpoint artifacts can become noisy or large. Mitigation: store bounded patches/metadata only around validation repair attempts and reference them in recovery summaries; avoid storing raw command output beyond existing details.
- Metadata can leak secrets if providers put raw output into structured metadata. Mitigation: require JSON-safe bounded metadata and document that raw command output belongs in `details`, not metadata.
- Maintaining both command-form providers and rich guidance could create uneven capabilities. Mitigation: document command form as simple/generic and function form as required for rich repair guidance.
- Parser changes for maintainability output may become brittle. Mitigation: add unit tests for known output lines and a fail-closed generic fallback for unparseable output.
- This work may tempt broader extension-platform expansion. Mitigation: keep scope strictly to validation providers and repair resilience.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed build exposed a real structural validation-recovery gap rather than a one-off agent mistake. | Recovery sidecar for `build-extension-platform-foundation-for-kernel-boundary-extraction` records `MANUAL`, repeated narrow fixes, final `628 lines` vs `626` ceiling, and no preserved implementation commit. `validation-provider-recovery.ts` confirms all recoverable provider failures route through review-fix/evaluate. | high | low | Inspect monitor DB events for the same session if more detail is needed. | If wrong, structural repair work may be overbuilt. |
| Current validation-provider annotations do not support first-class repair guidance. | `packages/extension-sdk/src/hooks.ts` and `docs/extensions-api.md` show annotations only have `severity`, `message`, `file`, and `line`; runtime normalization only preserves `details` additionally. | high | low | Add type-level tests before implementation. | If wrong, implementation could duplicate an existing field. |
| Breaking the validation-provider result shape is acceptable. | User explicitly stated eforge is greenfield and backward compatibility is not required for this shape. | high | low | Reconfirm only if external extension users become a requirement before build. | If wrong, external extensions could break unexpectedly. |
| The in-build structural repair path should not reuse the current post-merge validation-fixer unchanged. | `validation-fixer.md` instructs the agent to commit changes, while in-build review-fixer/evaluator flow expects unstaged candidate fixes. | high | low | Inspect orchestrator post-merge validation wiring if implementation wants to share code. | If wrong, duplicated agent code may be unnecessary. |
| Existing evaluator prompts need validation guidance context to accept intentional structural repair. | `evaluator.md` treats broad refactors/scope creep as rejectable; `builderEvaluate` prompt inputs do not currently include the original validation issue list except via generic prompt append paths. | medium | low | Prototype a validation-guidance prompt append and add tests around evaluator prompt construction if available. | If wrong, structural repairs may still be rejected or evaluator changes may be over-scoped. |
| Maintainability output is stable enough to parse with regexes. | `scripts/check-agent-maintainability.mjs` has explicit string formats for `BASELINE EXCEEDED` and `CAP EXCEEDED`; region marker section is also clearly labeled. | high for file-size lines, medium for region-marker details | low | Add parser unit tests using exact output snippets from the script. | If wrong, guardrails provider should fall back to generic fail-closed results. |
| Checkpoint patches can be preserved outside ephemeral plan worktrees. | `BuildStageContext` includes `cwd`, `planSetName`, `planId`, and `worktreePath`, which are enough to write `.eforge` artifacts in the project root and diff the plan worktree. | medium | low | Inspect existing artifact/recovery helpers before implementation and choose a durable path. | If wrong, checkpoint preservation may need a smaller patch-only fallback. |
| Adding guidance fields to `ReviewIssue` is acceptable if client schemas are updated. | `packages/engine/src/events.ts` re-exports `ReviewIssue` from `@eforge-build/client`, and project policy says wire shapes live in client. | high | low | Update `packages/client/src/events.schemas.ts` and run type-check/tests. | If wrong, a separate validation issue type may be cleaner. |
| This should be one cohesive build pass, not an Expedition with delegated module planning. | The changes are cross-cutting but follow one data flow: provider result -> normalization -> repair strategy -> repair agent/evaluator -> checkpoint/recovery docs. | medium | low | If planner finds independent subproblem explosion, split into SDK/engine/guardrails subplans during compile. | If wrong, a single plan may become too broad for one build. |

No low-confidence/high-impact assumption remains unresolved. The medium-confidence assumptions have low-cost validation paths and can be validated during implementation with focused tests and file inspection.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a deep architecture change, but the implementation follows one cohesive data flow from validation-provider result shape to normalization, repair routing, repair prompting/evaluation, checkpoint artifacts, and guardrails parsing. A single planner can enumerate the files, decisions, tests, and dependencies with enough quality. Expedition is not necessary unless compile-time planning discovers that checkpoint persistence, evaluator context, and SDK contract migration each require independently planned submodules.

## Scope

In scope:

- Replace the current validation-provider annotation-only guidance with a clean first-class guidance contract. Breaking SDK/runtime changes are acceptable because this extension surface is greenfield; migrate in-repo extensions, examples, tests, and docs together rather than preserving weak legacy shapes.
- Add validation guidance fields that let extensions describe both the failure and the desired repair mode: `fix`, `retryGuidance`, domain `failureKind`, `repairClass`, and JSON-safe `metadata` at minimum.
- Parse `pnpm maintainability:check` output in `eforge/extensions/eforge-guardrails.ts` into structured validation-provider guidance for baseline ceiling, hard cap, and region-marker failures where the output is parseable.
- Preserve free-form provider `message`/`details` for human diagnostics, but make machine-readable guidance the primary path for repair targeting.
- Propagate validation guidance through engine normalization into `ReviewIssue` or a validation-specific issue representation used by repair agents and evaluator context.
- Add an in-build structural validation repair path for validation-provider failures whose guidance indicates structural repair or whose repeated failure signature shows narrow repair is not making progress.
- Keep narrow validation repairs available for failures whose `repairClass` is narrow or unspecified and whose guidance does not require structural changes.
- Detect repeated validation failure signatures across recovery attempts using provider name, file, domain failure kind, relevant metadata, and normalized message details.
- Escalate from narrow repair to structural repair when the same signature persists after an attempted narrow repair.
- Preserve failed implementation checkpoints or patches before validation-provider repair attempts so recovery sidecars can point to exact failed implementation state.
- Update relevant tests, docs, and examples to describe the new guidance contract, structural repair escalation, checkpoint behavior, and greenfield/no-compatibility stance.

Out of scope:

- Do not add broader extension platform features such as extension actions, Console contributions, integration commands, deep links, raw routes, or arbitrary frontend plugin bundles.
- Do not add validation waivers, approval workflow UI, or `beforeValidation` policy gates in this slice.
- Do not change post-merge validation semantics except where shared code or docs must distinguish post-merge validation-fixer behavior from in-build validation-provider repair.
- Do not loosen the maintainability gate or update `scripts/agent-maintainability-baseline.json` ceilings as the solution.
- Do not preserve compatibility for legacy validation-provider string returns if a clean contract removes them; update in-repo usages instead.
- Do not require Console UI changes unless event/schema changes force reducer/type updates.

## Acceptance Criteria

- The validation-provider result contract includes structured guidance entries with `severity`, `message`, optional location, optional `details`, optional `fix`, optional `retryGuidance`, optional provider-authored `failureKind`, optional `repairClass`, and optional `metadata`.
- The validation-provider result contract does not require preserving legacy non-empty string failure returns for in-repo providers.
- The `repairClass` field accepts only a bounded set of values that includes narrow repair and structural repair.
- Validation guidance metadata is accepted only when it is JSON-safe and bounded.
- Invalid validation guidance metadata is handled deterministically without crashing the daemon or silently losing the validation failure.
- Engine validation-provider normalization preserves all valid guidance fields needed for repair routing and prompts.
- Provider-authored `failureKind` remains distinguishable from engine runtime failure classification.
- In-repo validation-provider examples use the new structured result contract.
- Validation guidance is available to the repair agent prompt for validation-provider recovery attempts.
- Validation guidance is available to the evaluator when judging validation repair candidate diffs.
- A validation-provider failure with narrow repair guidance uses the narrow validation repair path.
- A validation-provider failure with structural repair guidance uses an in-build structural validation repair path.
- The structural validation repair path permits focused refactoring or file splitting when provider guidance requests it.
- The structural validation repair path leaves candidate changes unstaged.
- The structural validation repair path does not commit changes directly.
- Candidate changes from structural validation repair are evaluated before they can become a build commit.
- Validation recovery tracks failure signatures across attempts.
- Validation failure signatures include provider name, affected file when available, provider-authored failure kind when available, and relevant metadata when available.
- A repeated validation failure signature escalates from narrow repair to structural repair when the narrow path does not resolve the failure.
- The engine writes a checkpoint artifact or patch before each validation-provider repair attempt.
- Terminal validation-provider recovery failures include checkpoint reference information in events, sidecar data, or both.
- `eforge/extensions/eforge-guardrails.ts` parses `BASELINE EXCEEDED` maintainability output into structured guidance.
- `eforge/extensions/eforge-guardrails.ts` parses `CAP EXCEEDED` maintainability output into structured guidance.
- `eforge/extensions/eforge-guardrails.ts` parses region-marker balance output into structured guidance or falls back to a generic fail-closed validation failure.
- Maintainability file-size guidance includes current line count, ceiling or cap, and overflow metadata.
- Maintainability file-size guidance tells repair agents not to use comment shortening or dense formatting as the primary repair strategy.
- Maintainability baseline-ceiling failures default to structural repair guidance unless parser evidence indicates a narrow temporary-marker cleanup is sufficient.
- `docs/extensions.md` documents the new validation-provider guidance contract and recovery behavior.
- `docs/extensions-api.md` documents the new validation-provider guidance contract and recovery behavior.
- `packages/extension-sdk/README.md` documents the new validation-provider guidance contract.
- `examples/extensions/validation-provider.ts` demonstrates validation guidance fields.
- Tests cover validation guidance normalization and metadata handling.
- Tests cover narrow validation repair routing.
- Tests cover structural validation repair routing.
- Tests cover repeated-signature escalation.
- Tests cover validation repair checkpoint creation or checkpoint-reference emission.
- Tests cover maintainability parsing for `BASELINE EXCEEDED` output.
- Tests cover maintainability parsing for `CAP EXCEEDED` output.
- Tests cover region-marker parsing or generic fallback behavior.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.