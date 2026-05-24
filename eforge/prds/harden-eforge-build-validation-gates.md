---
title: Harden eforge Build Validation Gates
created: 2026-05-24
profile: gpt-claude-combo
landing: pr
---

# Harden eforge Build Validation Gates

## Problem / Motivation

Two independent audits in `.eforge/tmp/` identify that eforge can report successful builds without enough evidence that the PRD or acceptance criteria were satisfied:

- `.eforge/tmp/build-validation-slippage-audit-opus.md` frames the architectural root cause as missing acceptance-criteria verification: reviewer output with zero issues is treated as success, but no stage requires a structured per-AC pass/fail verdict.
- `.eforge/tmp/build-validation-slippage-audit-gpt.md` emphasizes concrete fail-open paths: PRD validation/gap-closing can fail or skip without blocking success, single-plan dirty work can be validated without landing, validation commands can be absent, and reviewer/test/doc phases are advisory.
- `docs/roadmap.md` has no specific roadmap item for validation hardening, but the work aligns with Integration & Maturity and with the engine principle that build status should reflect durable evidence.

Code evidence gathered:

- `packages/engine/src/orchestrator/phases.ts` currently short-circuits post-merge command validation when no commands exist (`allValidationCommands.length === 0`) and invokes gap closing after failed PRD validation. It marks `gapClosePerformed = true` after the gap closer stream but does not inspect the `gap_close:complete.passed` value as the authoritative outcome. The landed stack follow-up now reruns deterministic `validate(ctx)` when `ctx.gapClosePerformed` is true, but it still does **not** rerun PRD validation / AC validation after gap closing.
- `packages/engine/src/eforge.ts` still silently returns from the PRD validator closure when the PRD file cannot be read, the diff builder fails, or the rendered diff is empty. The newer `runPrdValidator` itself fails closed on backend/no-output/unparseable-output, but the closure can prevent the validator from running at all.
- `packages/engine/src/agents/reviewer.ts` parses `<review-issues>` output into `ReviewIssue[]`; malformed or missing XML returns an empty issue list, which downstream code treats as no issues.
- `packages/engine/src/pipeline/stages/build-stages.ts` terminates review cycles when `ctx.reviewIssues.length === 0` and there are no perspective errors. This conflates “no parsed issue blocks” with “reviewer completed required verification.”
- `packages/engine/src/prompts/reviewer*.md` require exactly one `<review-issues>` block but do not require AC-by-AC verdicts. `reviewer-verify.md` specifically treats passing commands as an empty issue block.
- `packages/engine/src/prompts/prd-validator.md` still ends with “When in doubt, assume the implementation is correct,” which conflicts with using PRD validation as a safety gate.
- `packages/client/src/events.schemas.ts` currently models `gap_close:complete.passed` as optional, and has no dedicated AC-verdict event.
- Post-stack-follow-up update: landing vocabulary is now canonical `landing.action` / `landingAction` with values `pr|merge|leave`; validation hardening should treat that as settled and avoid changing landing vocabulary.
- Post-stack-follow-up update: `packages/engine/src/artifacts/registry.ts` adds a provider-neutral artifact registry and `recordArtifact(ctx)` now records every successful queued build before landing. This makes validation slippage more consequential: a falsely successful build can now create a durable artifact that unblocks dependent PRDs.
- Tests already exist around PRD validator fail-closed behavior (`test/prd-validator-fail-closed.test.ts`, `test/prd-validate-phase.test.ts`) and gap closer outcomes (`test/gap-closer.test.ts`), but some existing tests expect the current fail-open/backward-compatible paths.

Classification: **architecture / deep**. This changes engine gate semantics, wire/event contracts, agent prompt contracts, and tests across several packages. Confidence: high.

## Goal

Make build success require positive, durable evidence rather than absence of explicit failures. Build status must reflect command validation, PRD/AC validation, gap-close reruns, and committed clean state before any provider-neutral artifact is recorded or downstream PRDs are unblocked.

## Approach

### Architecture impact

This change affects core engine gate semantics and the client-owned event contract.

Affected boundaries:

- **Engine orchestration boundary** (`packages/engine/src/orchestrator/phases.ts`, `packages/engine/src/eforge.ts`): post-build success must be gated by command validation, PRD/AC validation, gap-close reruns, and clean committed state. The orchestrator should own final gate sequencing because it has the merge worktree and integrated state. Current stack-follow-up code records queued-build artifacts after validation/PRD validation and before landing, so the validation gate must complete before `recordArtifact(ctx)` writes dependency-unblocking state.
- **Agent contract boundary** (`packages/engine/src/agents/reviewer.ts`, `packages/engine/src/agents/prd-validator.ts`, prompt files): agent text must be translated into typed gate outcomes. Parser failures should produce explicit failing outcomes rather than silently empty results.
- **Wire protocol boundary** (`packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, derived engine re-exports): any new AC-verdict event or stricter `gap_close:complete` shape must be defined in `@eforge-build/client` first, then consumed by engine and UI/monitor code. This follows the repository rule that event types and schemas are co-located in the client package. Validation work should preserve current `landingAction: pr|merge|leave` shapes when touching related events or tests.
- **Test boundary** (`test/` and `packages/client/src/__tests__/events-wire-parity.test.ts`): existing tests that treat empty reviewer output or optional gap-close status as acceptable must be updated deliberately, not patched around.

Recommended architecture:

1. Introduce a small, explicit **validation evidence model**:
   - `AcceptanceCriterionVerdict`: criterion text or id, `status: 'pass' | 'fail' | 'unknown'`, evidence string, optional file/command references.
   - An event such as `acceptance_validation:complete` or a `prd_validation:complete.criteria` extension. A separate event is cleaner because PRD validation may cover broad requirements while AC validation is a hard final gate.
2. Add a final **integrated validation sequence** after all plans merge and after post-merge commands:
   - deterministic command validation
   - PRD/AC validation on the merge worktree
   - gap-close if allowed
   - rerun deterministic validation and PRD/AC validation after a successful gap-close
   - only then proceed to `recordArtifact(ctx)` / stack landing / final landing / finalize
3. Keep engine mutation discipline:
   - New failure transitions should use the project’s existing state-mutation conventions where applicable. Current `phases.ts` has direct `state.status` assignments in existing code; new work should avoid expanding inconsistent mutation patterns unless the surrounding phase is already exempt.
4. Treat review and PRD validation as different signals:
   - Review cycles can remain useful quality gates, but final build success should not depend on interpreting “no reviewer issues” as AC satisfaction.
   - The AC/PRD validator should be the final acceptance gate and should fail on insufficient evidence.
5. Preserve compatibility consciously:
   - Existing queued builds with a PRD should become safer by default.
   - For direct `build(planSet)` without PRD source, the engine needs a deterministic-validation waiver path or a plan-derived AC source. If neither exists, the build should surface a clear validation-not-possible failure/skip-with-waiver, not an accidental success.
   - Treat landing-action vocabulary as settled; validation hardening should not expand or redesign it.

### Key design decisions

1. **Prefer a dedicated final AC/PRD evidence gate over making review cycles carry all acceptance semantics**
   - Decision: Add or strengthen a final integrated acceptance gate that runs on the merge worktree after plans are merged and before provider-neutral artifact recording. Review cycles should remain quality gates, but they should not be the only proof that acceptance criteria are met.
   - Rationale: The Opus audit’s central finding is that “no reviewer issues” is not equivalent to “all acceptance criteria verified.” A final gate over the integrated artifact also catches merge-conflict and cross-plan drift that plan-level review cannot see. Because the landed stack follow-up records artifacts before landing and uses those artifacts for dependency readiness, this gate also protects downstream PRDs from consuming invalid artifacts.

2. **Fail closed on missing evidence**
   - Decision: Treat missing PRD file, diff build failure, empty diff, missing reviewer XML, malformed reviewer XML, missing gap-close terminal event, and absent validation commands as failures unless an explicit waiver exists.
   - Rationale: Current behavior is biased toward success when sensors are absent. Validation gate semantics should require positive evidence.

3. **Use typed events for new evidence**
   - Decision: If AC verdicts are added, define them in `packages/client/src/events.schemas.ts` and re-export through engine types. Do not create engine-only event shapes.
   - Rationale: Repository instructions state that event discriminants and schemas are client-owned. This keeps daemon, monitor UI, and integrations in sync.

4. **Make gap closing a retry loop with a new proof obligation**
   - Decision: After failed PRD validation, gap closer may run only when viability permits. If gap closer reports success, rerun deterministic validation and PRD/AC validation before artifact recording. If the rerun fails, the build fails. If gap closer reports false/missing terminal, the build fails. The existing post-gap deterministic `validate(ctx)` rerun is useful but insufficient by itself.
   - Rationale: A repair attempt does not prove requirements are now satisfied. Only a second validation pass can prove that.

5. **Maintain a deliberate waiver path, not silent skips**
   - Decision: For cases where deterministic commands or PRD/AC source are legitimately unavailable, require explicit config/plan metadata such as `validation.allowNoCommands: true` or a similarly named waiver with a reason. The initial implementation can fail with a clear error before adding rich UI.
   - Rationale: Some direct/internal builds may not have a PRD file. Breaking them silently is bad, but silently passing is worse. A waiver makes the risk visible and testable.

6. **Synthetic failures should be actionable**
   - Decision: When replacing silent skips with failures, emit synthetic gaps/issues with specific requirements like “PRD validator could not read source file” or “Reviewer output contract missing.”
   - Rationale: Users and recovery tooling need enough detail to decide retry vs. manual intervention.

7. **Sequence implementation in small slices**
   - Recommended build slices:
     1. PRD closure and prompt fail-closed hardening.
     2. Gap-close terminal handling and rerun PRD/AC validation before artifact recording.
     3. Reviewer parser contract hardening.
     4. Final AC verdict event/gate.
     5. Dirty/uncommitted builtOnMerge enforcement before artifact recording.
     6. No-validation-command waiver/failure policy.
   - Rationale: These areas touch different tests and contracts. Slicing reduces regression risk and lets early fixes land before the full AC event model is complete.

### Likely code impact

- `packages/engine/src/orchestrator/phases.ts`
  - Evidence: `validate()` currently returns when there are no validation commands. `prdValidate()` runs gap closer after failed PRD validation but does not treat `gap_close:complete.passed` as authoritative. The stack follow-up added a second deterministic `validate(ctx)` call after `ctx.gapClosePerformed`, but there is still no second PRD/AC validation pass.
  - Expected changes: fail/waive no-command validation, track gap-close result, rerun PRD/AC validation after successful gap-close, fail on unsuccessful/missing gap-close terminal event, and ensure artifact recording cannot happen until the rerun proves success.
  - New related code from landed follow-up: `recordArtifact(ctx)` now writes provider-neutral artifact registry records for all queued builds before landing. Validation hardening must keep failure state set before this phase when evidence is missing.

- `packages/engine/src/eforge.ts`
  - Evidence: PRD validator closure returns silently on PRD read failure, diff builder failure, and empty rendered diff. Build status handling already marks `prd_validation:complete passed:false` as failure, so emitting a failure event from the closure should integrate cleanly.
  - Expected changes: emit/throw failure through `prdValidate()` for skipped validator cases; possibly provide synthetic gaps for “PRD unreadable”, “diff unavailable”, and “diff empty”.

- `packages/engine/src/agents/prd-validator.ts` and `packages/engine/src/prompts/prd-validator.md`
  - Evidence: agent implementation already fails closed on empty/no JSON; prompt still says “When in doubt, assume the implementation is correct.”
  - Expected changes: change prompt to require positive evidence and classify insufficient evidence as a gap/unknown; possibly extend parser/event payload to include per-criterion verdicts.

- `packages/engine/src/agents/reviewer.ts` and `packages/engine/src/prompts/reviewer*.md`
  - Evidence: parser returns `[]` for missing/malformed XML, and prompts allow empty issue blocks without AC evidence.
  - Expected changes: add parse metadata or a strict parser result; callers should surface parser/contract failures as perspective errors or synthetic issues. Prompts should require AC coverage evidence if reviewer output remains XML-only.

- `packages/engine/src/pipeline/stages/build-stages.ts` and possibly `packages/engine/src/pipeline/runners.ts`
  - Evidence: review cycle terminates on empty parsed issue list and zero perspective errors. Review fix/evaluation paths may not make unresolved review exhaustion fatal.
  - Expected changes: consume strict reviewer contract metadata; fail or continue when a reviewer response is invalid rather than treating it as no issues. Decide whether max-round exhaustion with unresolved critical/warning issues is fatal.

- `packages/engine/src/worktree-manager.ts`
  - Evidence: `mergePlan()` builtOnMerge path recovers drift and returns HEAD without checking clean status, HEAD movement, or committed work.
  - Expected changes: inspect `git status --porcelain`, compare HEAD/base, and fail when the plan left dirty work or produced no committed changes where the plan expected changes. This is now also artifact-safety work: `recordArtifact(ctx)` captures the current HEAD commit SHA, so dirty work must be rejected before that SHA is recorded as a durable artifact.

- `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts`
  - Evidence: event schemas are client-owned; `gap_close:complete.passed` is optional and no AC event exists.
  - Expected changes: add/modify event schema(s), registry descriptions, and parity fixtures. If making `passed` required is too breaking, emit a new stricter event or treat missing as failure engine-side first. Keep any touched landing-related event/API tests aligned with the current `landingAction: pr|merge|leave` contract.

- Tests in `test/`
  - Directly relevant existing tests found: `test/prd-validator.test.ts`, `test/prd-validator-fail-closed.test.ts`, `test/prd-validate-phase.test.ts`, `test/gap-closer.test.ts`, `test/xml-parsers.test.ts`, `test/review-cycle-adaptive.test.ts`, `test/build-evaluator-enforcement.test.ts`, `test/retry.test.ts`, `test/agent-wiring.test.ts`, plus new artifact/landing tests such as `test/artifact-registry.test.ts`, `test/artifact-aware-scheduler.test.ts`, `test/stack-artifact-recording.test.ts`, and `test/cli-landing-options.test.ts`.
  - Expected new tests: PRD closure fail-closed cases, gap-close false/missing fails, gap-close true reruns validator and prevents artifact recording on rerun failure, reviewer missing/malformed XML fails review, no validation commands fails or requires waiver, builtOnMerge dirty work fails before artifact recording.

### Documentation impact

Documentation likely needing updates if behavior/config changes:

- `README.md` or user-facing build workflow docs: clarify that successful builds now require validation evidence and may fail when PRD/AC validation cannot run.
- `docs/extensions.md` / `docs/extensions-api.md` only if validation-provider or policy-gate behavior is changed. Current plan does not require extension API changes unless the no-command waiver becomes extension-configurable.
- Generated reference docs: run `pnpm docs:generate` / `pnpm docs:check` if event schemas, CLI/API docs, or config reference artifacts change.
- Monitor/UI event reference artifacts if a new `acceptance_validation:complete` event is added or `gap_close:complete` semantics are documented.
- Changelog/release notes may be warranted because this is intentionally stricter behavior and can make previously “successful” builds fail.

No docs-only implementation should be considered complete unless tests prove the changed gate semantics first.

### Risks

- **Behavioral breaking change**: Fail-closed validation will cause some builds that previously completed to fail. Mitigation: emit clear synthetic gap/error messages and add an explicit waiver path for genuinely unavailable evidence.
- **Event contract drift**: Adding AC events or changing `gap_close:complete.passed` can break monitor/UI/tests if not done through `@eforge-build/client`. Mitigation: update schemas, registry, wire parity tests, and consumers in one slice.
- **Prompt-only false confidence**: Merely changing reviewer prompts may not fix the architectural gap because parsers still need structured evidence. Mitigation: require typed verdicts/events and fail parser contract violations.
- **Infinite/expensive validation loops**: Rerunning validation after gap closing can become costly or recursive. Mitigation: allow at most one gap-close attempt per build unless explicitly configured; track `gapClosePerformed`; cap retries.
- **Dirty-work enforcement false positives**: Some legitimate no-op/doc/test-only paths may produce no committed code changes. Mitigation: distinguish clean no-op plans from dirty uncommitted changes; require a plan/waiver if no committed diff is expected.
- **Recovery interaction**: Existing recovery logic may interpret new synthetic failures as retryable or split candidates incorrectly. Mitigation: use clear error categories/messages and add tests around recovery side effects if recovery consumes these events.
- **Test fixture churn**: Many tests currently use `<review-issues></review-issues>` as a convenient stub. Making empty output require AC evidence may require updating fixtures broadly. Mitigation: keep low-level parser tests separate from full AC gate tests, and provide a helper fixture for a valid no-issue review with evidence.
- **Partial implementation risk**: Fixing PRD fail-closed without the AC gate still leaves plan-level AC slippage; implementing AC verdicts without PRD/gap-close hardening still leaves fail-open holes. Mitigation: build in ordered slices but keep acceptance criteria covering the combined behavior.
- **Artifact propagation risk**: Since queued builds now write provider-neutral artifact records before landing and dependencies can unblock from those records, a false success can contaminate downstream builds. Mitigation: fail before `recordArtifact(ctx)` whenever PRD/AC evidence is missing, gap-close proof is incomplete, validation commands are absent without waiver, or builtOnMerge dirty work remains.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| PRD validator closure still skips before `runPrdValidator` can fail closed. | Read `packages/engine/src/eforge.ts`; catch blocks/empty diff return without yielding events. | High | Low | Add unit/integration tests for unreadable PRD, diff-builder failure, and empty diff. | High — PRD validation remains bypassable. |
| Gap closer completion is not currently a hard gate and PRD validation is not rerun after gap close. | Re-read `packages/engine/src/orchestrator/phases.ts` after stack follow-up landed; it sets `gapClosePerformed = true` after draining gap closer and does not inspect `gap_close:complete.passed`. `Orchestrator.execute()` now reruns deterministic `validate(ctx)` when `gapClosePerformed` is true, but still does not rerun PRD/AC validation. Existing `test/prd-validator.test.ts` expects gap closer without `passed` to proceed. | High | Low | Add tests for `passed:false`, missing terminal, `passed:true` followed by PRD/AC rerun pass, and `passed:true` followed by PRD/AC rerun failure. | High — known gaps can still pass and can now produce durable artifacts. |
| Reviewer parser treats invalid/missing contract as no issues. | Read `packages/engine/src/agents/reviewer.ts`; parser returns accumulated issues and missing block produces `[]`. | High | Low | Add tests in `test/xml-parsers.test.ts` / reviewer tests for missing block, malformed block, invalid attrs. | High — reviewer infrastructure failure can certify success. |
| There is no final per-AC verdict event/gate. | Searched for acceptance/verdict/event terms; event schema includes PRD/gap validation but no AC verdict event. Prompts mention acceptance criteria, but not structured per-AC verification. | High | Medium | Inspect all prompt contracts and event consumers before adding event. | High — central audit root cause remains. |
| No-command validation skip is intentional historical behavior, not an explicit waiver. | Read `validate()` condition in `phases.ts`; no config waiver found in quick search. | Medium | Medium | Inspect config schemas and docs before choosing exact waiver name. | Medium-high — a too-strict change could break legitimate flows. |
| `builtOnMerge` path can validate dirty uncommitted work. | Re-read `worktree-manager.ts` builtOnMerge path after stack follow-up; no local clean/HEAD-advanced guard. `recordArtifact(ctx)` now records current HEAD as the durable artifact commit, so dirty work would be excluded from recorded artifacts. Need more context on `recoverDriftedWorktree`. | Medium-high | Low | Read `recoverDriftedWorktree` and builder commit paths; add targeted test asserting dirty builtOnMerge fails before artifact recording. | High — final artifact may omit validated changes and downstream PRDs may build on the wrong commit. |
| Existing tests can be updated without large harness rewrites. | Tests use `StubHarness` heavily and already test related events. New stack follow-up tests add artifact registry / scheduler / landing coverage that can be extended for “no artifact on validation failure” behavior. | Medium | Medium | Run focused tests after implementation; update helper fixtures as needed. | Medium — implementation may need broader test refactor. |
| Artifact registry recording makes validation order more important. | Read `packages/engine/src/artifacts/registry.ts` and `recordArtifact(ctx)`: every queued build writes `.eforge/artifacts/builds.json` before landing, and scheduler dependency readiness consumes artifact records. | High | Low | Add tests that validation/gap/dirty-work failures do not call/write artifact registry records. | High — bad artifacts can unblock dependents. |

No low-confidence/high-impact assumption is accepted without a validation path. The highest-impact assumptions have direct file evidence and concrete tests to add.

### Profile signal

Recommended profile: **Excursion**.

Rationale: This is a cross-cutting engine hardening effort touching orchestration, agent contracts, client event schemas, tests, and docs, but it is still a cohesive validation-gate change. A single planner can enumerate the slices and dependencies without delegating module-specific planning. It does not require Expedition unless the AC-verdict event model expands into a broader multi-subsystem redesign.

## Scope

Address the audit issues as a validation-hardening change to the engine pipeline.

### In scope

1. **PRD validation fail-closed behavior**
   - The PRD validator closure in `packages/engine/src/eforge.ts` must emit/fail with a `prd_validation:complete passed: false` path when PRD content cannot be read, the diff cannot be built, or the diff is empty in contexts where PRD validation was requested.
   - Remove or invert the permissive PRD validator prompt bias in `packages/engine/src/prompts/prd-validator.md`.

2. **Gap-closing as a hard gate**
   - `packages/engine/src/orchestrator/phases.ts` must inspect `gap_close:complete.passed` and fail when it is false/missing.
   - A gap-close attempt must not make the original failed `prd_validation:complete` disappear as the terminal verdict. After a successful gap-close, PRD validation should run again and only the rerun may certify success.

3. **Review output contract hardening**
   - `packages/engine/src/agents/reviewer.ts` should distinguish “valid empty review” from “missing/malformed review contract”. Missing XML, malformed XML, invalid issue attributes, or no terminal contract should be surfaced as reviewer/perspective errors or synthetic critical review issues instead of `[]`.
   - Reviewer prompts should require explicit evidence of acceptance-criteria review, not merely an empty `<review-issues>` block.

4. **Acceptance-criteria evidence gate**
   - Add a structured AC verification mechanism. Minimal acceptable shape: reviewers/validator must produce per-criterion verdicts or a dedicated validation event that records each AC as `pass`/`fail`/`unknown` with evidence. `unknown` should fail the build unless explicitly waived by configuration.
   - This gate should run after integration on the merge worktree and before provider-neutral artifact recording, so it verifies the final combined artifact before any dependency-unblocking artifact is published.

5. **Committed-work enforcement**
   - Before a plan is marked merged, especially the `builtOnMerge` path in `packages/engine/src/worktree-manager.ts`, verify that the worktree is clean and that the plan produced committed changes when changes were expected.
   - Validation must not pass against dirty/uncommitted implementation changes that will not land, and such dirty work must prevent artifact registry writes.

6. **Deterministic validation command policy**
   - If neither configured post-merge commands nor planner-provided validate commands exist, the engine should not silently skip validation. It should either fail with a clear message or require an explicit opt-out/waiver in config/plan metadata.

7. **Tests and docs**
   - Update or add tests for the fail-closed paths above.
   - Update user-facing/docs/reference material only where behavior or config contracts change.

### Out of scope for this first hardening pass

- Replacing all reviewer XML with a new global structured-output protocol everywhere, unless needed for the minimal AC gate.
- Building a full policy/approval UI for validation waivers.
- Overhauling planner decomposition or expedition module planning beyond adding criteria that improve validation evidence.
- Changing eforge’s canonical landing action vocabulary. This plan should only touch landing/finalization code where accurate validation status requires it.

## Acceptance Criteria

### PRD validation and gap closing

- When a queued build requests PRD validation and the PRD file cannot be read, the build emits a failing `prd_validation:complete` or equivalent typed failure event and final status is failed.
- When PRD validation is requested and the validator diff cannot be built, the build fails closed with an actionable synthetic gap/error.
- When PRD validation is requested and the rendered implementation diff is empty, the build fails closed unless an explicit documented no-diff waiver is present.
- `packages/engine/src/prompts/prd-validator.md` no longer instructs the validator to assume correctness when in doubt; ambiguous or insufficient evidence must produce a gap/unknown verdict.
- If `gap_close:complete` has `passed: false` or no terminal success signal, the build fails and does not proceed to landing as successful.
- If gap closing succeeds, the engine reruns validation sufficient to prove the gaps are closed; the original failed PRD validation plus a successful gap-close attempt plus the current deterministic-command rerun alone is not enough to complete the build.
- If gap closing succeeds but the PRD/AC rerun fails or is inconclusive, no queued-build artifact record is written.
- Tests cover gap-close false, missing terminal, successful PRD/AC rerun pass, successful gap-close followed by PRD/AC rerun fail, and no artifact recording on failed/inconclusive rerun.

### Acceptance-criteria evidence

- The final integrated validation phase records structured verdicts for each acceptance criterion from the PRD/plan source: `pass`, `fail`, or `unknown`, with evidence for each verdict.
- A build cannot complete successfully while any acceptance criterion verdict is `fail` or `unknown`, unless an explicit waiver with a reason is present and surfaced in events/logs.
- Empty or malformed reviewer output is not accepted as evidence that acceptance criteria were checked.
- At least one test demonstrates that a reviewer returning `<review-issues></review-issues>` without AC verdict/evidence does not by itself satisfy the AC gate.

### Reviewer contract hardening

- Missing `<review-issues>` blocks, malformed reviewer XML, or invalid issue attributes produce a reviewer contract failure, perspective error, or synthetic critical issue; they are not parsed as a clean review.
- Review cycle termination on “no issues” only occurs after all required reviewer outputs are valid according to the contract.
- Tests cover missing XML, malformed XML, and valid empty review output.

### Deterministic validation and committed work

- If no post-merge validation commands and no planner validate commands are available, the build fails with a clear message unless an explicit validation-command waiver is configured.
- Single-plan / `builtOnMerge` builds fail before success if the merge worktree contains dirty tracked or untracked implementation changes after the builder finishes.
- Validation is run only against committed changes that will land, or the build explicitly fails explaining the uncommitted work.
- Dirty/uncommitted `builtOnMerge` work fails before provider-neutral artifact recording, so `.eforge/artifacts/builds.json` never records a commit that omits validated dirty changes.
- Tests cover a dirty builtOnMerge worktree, no artifact record for that failure, and no-validation-command behavior.

### Contracts, docs, and quality gates

- Any new/changed event shape is defined in `packages/client/src/events.schemas.ts`, documented in the event registry, and covered by wire parity tests.
- Any touched landing/finalization/API code preserves the current landing-action contract: `landing.action` / `landingAction` with values `pr|merge|leave`.
- Existing tests that encoded fail-open behavior are updated to assert the new fail-closed contract rather than removed without replacement.
- `pnpm type-check` and the focused/affected Vitest tests pass.
- If generated docs/reference artifacts drift because of schema/config changes, `pnpm docs:generate` is run and the generated updates are included.
