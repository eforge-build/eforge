---
title: Harden Build Validation Evidence Gates
created: 2026-05-24
depends_on: ["close-stacked-pr-follow-up-gaps", "add-github-pr-auto-merge-option-for-eforge-builds-and-playbooks"]
stack_parent: "add-github-pr-auto-merge-option-for-eforge-builds-and-playbooks"
profile: gpt-claude-combo
landing: pr
---

# Harden Build Validation Evidence Gates

## Problem / Motivation

This plan follows up on the landed build-validation hardening PR (`b90830fc`, PR #30) and the review findings from the original audit session. The landed work substantially improved fail-closed behavior, but static inspection found remaining gaps where build success can still rely on incomplete evidence or where failures are rendered ambiguously.

Validated evidence gathered before planning:

- Roadmap alignment: `docs/roadmap.md` has no dedicated validation-hardening item, but this fits **Integration & Maturity** and the README's claim that build success requires command validation plus PRD acceptance evidence.
- Full local quality checks on current `main` passed: `pnpm type-check` and `pnpm test` (272 files / 4874 tests).
- AC evidence gap validated by search: engine/client contain `AcceptanceCriterionVerdict` and `acceptance_validation:complete`, but no deterministic extractor/cross-checker for expected PRD or plan acceptance criteria. The gate currently accepts a non-empty passing verdict list from the agent.
- Non-PRD bypass validated in `packages/engine/src/eforge.ts` and `packages/engine/src/orchestrator/phases.ts`: `prdValidator` is only created when `options.prdFilePath` exists, and `prdValidate()` returns immediately when no validator exists.
- Reviewer strictness is partial: build reviewers use `parseReviewIssuesStrict`, but planning/cohesion reviewers still call the legacy `parseReviewIssues()` in `packages/engine/src/agents/{plan-reviewer,architecture-reviewer,cohesion-reviewer}.ts`.
- Committed-state enforcement is partial: `WorktreeManager` records `baseSha` at acquisition and rejects dirty built-on-merge work, but `mergePlan()` does not verify that built-on-merge HEAD advanced or has a committed diff when changes were expected.
- User-facing rendering gap validated: CLI and monitor timeline render `gap_close:complete` as successful/complete without checking `event.passed`; acceptance validation has reducer inclusion but little/no explicit display.
- Docs already describe the stronger intended behavior in `README.md`, `docs/config.md`, and `docs/architecture.md`, so follow-up work should either make implementation match those docs or adjust docs if a narrower policy is chosen.

Classification: **architecture / deep** (high confidence). This changes validation gate semantics, event/wire rendering, parser contracts, and tests across engine, client, CLI, monitor UI, and docs. It is a cohesive hardening follow-up, not a broad new subsystem.

Recommended profile: **Excursion**.

Rationale: The change is cross-cutting across validation gates, parser contracts, event rendering, and tests, but it is a cohesive follow-up with a clear sequential dependency chain. A single planner can enumerate the slices and dependencies without delegated module planning. Expedition is not warranted unless the AC inventory model expands into a broad input-artifact redesign.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The current acceptance gate can pass with incomplete AC coverage. | Read `prdValidate()` gate logic and searched for deterministic AC extraction/cross-checking. Search found verdict schemas/events but no expected-criteria inventory or matcher. Current tests include a single passing verdict success case, not multi-AC coverage enforcement. | High | Low | Add failing test: PRD has two ACs, validator emits one passing verdict; build must fail with missing criterion. | High — central audit gap remains. |
| No-PRD/direct builds bypass acceptance validation. | Read `packages/engine/src/eforge.ts`: `prdValidator` closure only created when `options.prdFilePath` exists. Read `packages/engine/src/orchestrator/phases.ts`: `if (!prdValidator) return;`. | High | Low | Add orchestration test with no `prdValidator` and validation commands/waiver passing; assert final state fails unless waiver. | High — non-queued/internal builds can still succeed without AC evidence. |
| Input artifacts can provide AC source for at least some no-PRD flows. | Search found `packages/input/src/session-plan.ts` and `packages/input/src/playbook.ts` parse and expose acceptance-criteria sections. Did not trace every engine entry path that preserves this data into `EforgeEngine.build`. | Medium | Medium | Trace normalized source construction from CLI/daemon enqueue to engine options; add integration test for session-plan-derived AC inventory. | Medium-high — implementation may need source plumbing rather than only parser utility. |
| Malformed PRD validator `gaps` entries can be filtered away. | Read `parseGaps()` in `packages/engine/src/agents/prd-validator.ts`: it filters objects lacking string `requirement`/`explanation` and maps the rest. | High | Low | Add unit test with `gaps: [42]` plus passing acceptance verdict; expect synthetic failing gap. | Medium-high — structured validator failure can become success. |
| Reviewer strictness remains partial. | Search/read found `runReview()` and `runParallelReview()` use `parseReviewIssuesStrict`, while `plan-reviewer`, `architecture-reviewer`, and `cohesion-reviewer` still call `parseReviewIssues()`. Legacy parser tests assert no XML returns `[]`. | High | Low | Add tests for each reviewer agent or migrate call sites and update fixtures. | Medium — planning sensors can silently pass malformed output. |
| Strict parser terminal semantics are weaker than prompt wording. | Read `test/xml-parsers.test.ts`: `valid empty block followed by prose is still valid:true`. Parser only validates inside the block and allows trailing prose. | High | Low | Decide policy; if terminal means end-of-output, add failing test and tighten parser. | Medium — less severe than missing XML, but contract and tests conflict. |
| Built-on-merge can still cleanly no-op. | Read `WorktreeManager.acquireForPlan()` records `baseSha`; `mergePlan()` rejects dirty files but does not compare `baseSha..HEAD` before setting merged. Search found no no-op/HEAD-advanced test. | High | Low | Add test where built-on-merge plan makes no commit; assert failure unless explicit no-op waiver. | Medium-high — validates/records an artifact that may omit expected work. |
| Gap-close failure rendering is misleading. | Read CLI and monitor UI renderers: both render `gap_close:complete` without checking `event.passed`. | High | Low | Add display/render tests or snapshot assertions for `passed:false`. | Medium — engine may fail correctly, but user sees success text. |
| Acceptance validation display is underdeveloped. | Search found reducer inclusion but no CLI `case 'acceptance_validation:complete'` and no explicit timeline case. | High | Low | Add CLI/timeline rendering and tests for pass/fail/waiver summaries. | Low-medium — observability gap, not engine correctness. |
| Full repo is currently green before follow-up starts. | Ran `pnpm type-check` and full `pnpm test`; both passed. | High | Low | Re-run after changes. | Medium — future failures are attributable to follow-up work. |

No low-confidence/high-impact assumption remains unvalidated. The only medium-confidence assumption is source plumbing for plan/session-derived ACs; it has a concrete validation path and should be investigated in the first implementation slice before changing gate behavior for no-PRD builds.

## Goal

Close the remaining validation-hardening gaps left after PR #30 so build success requires complete, explicit, accurately rendered validation evidence.

## Approach

This follow-up affects existing validation and presentation boundaries rather than introducing a new standalone subsystem.

Affected boundaries:

- **Input/source boundary** (`@eforge-build/input`, session-plan/playbook normalization, queued PRD handling): acceptance criteria exist in several input artifacts, but the engine currently relies on validator-produced verdict text rather than a deterministic expected-criteria inventory. A small AC extraction/normalization utility should live where normalized input artifacts are already parsed, or in an engine utility that consumes normalized source text without coupling to daemon wrappers.
- **Engine validation gate** (`packages/engine/src/orchestrator/phases.ts`, `packages/engine/src/eforge.ts`, `packages/engine/src/agents/prd-validator.ts`): final build success should depend on both validator outcome and expected-AC coverage. The current `prdValidate()` gate needs expected criteria and no-PRD policy context, not only event streams.
- **Event contract boundary** (`packages/client/src/events.schemas.ts`, `event-registry.ts`, wire parity tests): existing `acceptance_validation:complete` has verdicts but no expected-criteria inventory. Prefer extending the event with optional expected/missing criterion metadata only if necessary for consumers; otherwise keep wire shape stable and enforce the cross-check inside the engine first.
- **Reviewer parser boundary** (`packages/engine/src/agents/reviewer.ts` plus planning reviewers): strict parsing exists for build reviewers; follow-up should either reuse it for other reviewer agents or split the API into clearly named legacy vs strict functions so fail-open use sites are intentional.
- **Worktree state boundary** (`packages/engine/src/worktree-manager.ts`): `baseSha` is already recorded at plan acquisition, providing a low-cost way to compare built-on-merge `baseSha..HEAD`. This should be used before marking a built-on-merge plan merged.
- **Presentation boundary** (`packages/eforge/src/cli/display.ts`, `packages/monitor-ui/src/components/timeline/event-card.tsx`): event renderers must respect validation verdict fields. This is separate from engine success/failure so UX cannot misleadingly show a failed gap close as successful.

Recommended architecture:

1. Introduce a deterministic `ExpectedAcceptanceCriterion` model and extractor that returns stable IDs or normalized text plus source location/source kind.
2. Pass expected criteria into the PRD validator/gate path. The agent may still produce natural text verdicts, but the gate must map or require verdicts for each expected criterion.
3. Add a validation-policy result for no-PRD/no-criteria cases: fail by default, explicit waiver with reason to pass.
4. Keep event schemas client-owned. Only change `acceptance_validation:complete` schema if UI or downstream consumers need machine-readable `missingCriteria` / `expectedCriteria`; otherwise avoid another daemon API bump.
5. Keep artifact recording sequenced after all new gates, preserving the current artifact-safety ordering.

Design decisions:

1. **Cross-check AC verdicts against an expected criterion inventory**
   - Decision: Do not trust `acceptance_validation:complete.verdicts` alone. Build an expected AC list from PRD/plan source and require a corresponding verdict for each expected item.
   - Rationale: The current gate can pass with one generic passing verdict. The original plan required per-criterion evidence for each criterion.
   - Implementation notes:
     - Start with text-normalized matching to minimize schema churn: trim, collapse whitespace, optionally strip bullet numbering.
     - If stable IDs are introduced, make them deterministic from order + normalized text so agent output can reference either exact text or ID.
     - Missing verdicts become `unknown` and fail unless explicitly waived.

2. **Fail by default when no validation source exists**
   - Decision: If no PRD validator can be created and no plan/source-derived AC inventory is available, emit a clear failure event/progress message and fail the build unless an explicit waiver with reason is configured.
   - Rationale: Returning from `prdValidate()` with no validator preserves the old fail-open path for direct/no-PRD builds.

3. **Separate waiver semantics from fake pass evidence**
   - Decision: Represent waivers as waivers, not as synthetic `pass` evidence. Prefer using the existing `acceptance_validation:complete.waivers` field or adding a small engine-side waiver summary event if needed.
   - Rationale: `allowEmptyPrdDiff` currently fabricates a passing criterion with `evidence: Waiver: ...`, which blurs evidence and policy override.

4. **Treat malformed validator gap entries as contract failure**
   - Decision: If the JSON has a `gaps` array but any entry is malformed, produce a synthetic gap such as `PRD validator gap output malformed` rather than filtering invalid entries away.
   - Rationale: Invalid structured output is missing evidence. Filtering can turn a failing/uncertain result into a pass.

5. **Make strict reviewer parsing intentional everywhere**
   - Decision: Rename or expose parser APIs so fail-open legacy parsing cannot be accidentally selected. Migrate planning/cohesion/architecture reviewers to strict behavior unless tests show their prompt contracts intentionally differ.
   - Rationale: Static search found remaining legacy parser use. If a reviewer contract says exactly one terminal XML block, parser behavior should match that contract.

6. **Use `baseSha` for built-on-merge no-op detection**
   - Decision: Compare built-on-merge `managed.baseSha` to `HEAD` or inspect `baseSha..HEAD` before marking the plan merged. Fail when no committed diff exists and the plan is expected to produce changes.
   - Rationale: The previous fix rejects dirty work, but clean no-op success remains possible. `baseSha` is already available, making this cheap.

7. **Rendering must branch on verdict fields**
   - Decision: CLI/monitor renderers must treat `gap_close:complete.passed === false` as failed and render acceptance validation summaries separately from PRD validation.
   - Rationale: Failure events should not look successful to users even when the engine state is failed.

Likely files/modules to change, with validated evidence:

- `packages/engine/src/orchestrator/phases.ts`
  - Evidence: `prdValidate()` returns when `prdValidator` is absent; acceptance gate checks only non-empty all-pass verdicts or any waiver.
  - Changes: require expected AC coverage; fail/waive no-validator/no-AC paths; ensure missing expected criteria become failing `unknown` verdicts before artifact recording.

- `packages/engine/src/eforge.ts`
  - Evidence: `prdValidator` closure exists only under `options.prdFilePath`; empty diff waiver emits a fake pass verdict rather than waiver metadata.
  - Changes: provide expected AC inventory/policy to orchestrator; improve waiver representation; possibly create a plan/source AC validator for no-PRD builds.

- `packages/engine/src/agents/prd-validator.ts`
  - Evidence: acceptance verdict entries are fail-closed, but malformed `gaps` entries are filtered out.
  - Changes: fail closed on malformed gap entries; optionally ask prompt for criterion IDs if introduced.

- `packages/input/src/session-plan.ts`, `packages/input/src/playbook.ts`, and/or a new engine utility
  - Evidence: input package already parses session/playbook acceptance criteria sections.
  - Changes: expose or reuse AC extraction from normalized source/session-plan/playbook text. Need avoid putting engine behavior into wrapper-specific code.

- `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts`
  - Evidence: event schemas are client-owned. `acceptance_validation:complete` currently has `passed`, `verdicts`, optional `waivers`, and `source` only.
  - Changes: only if new machine-readable expected/missing fields are surfaced. Otherwise no schema change required.

- `packages/engine/src/agents/reviewer.ts`
  - Evidence: strict and legacy parsers coexist; strict parser currently permits trailing prose after the block and ignores invalid numeric `line` attributes.
  - Changes: tighten strict parser; clarify legacy parser name or restrict use.

- `packages/engine/src/agents/{plan-reviewer,architecture-reviewer,cohesion-reviewer}.ts`
  - Evidence: all call `parseReviewIssues(fullText)`.
  - Changes: migrate to strict parser and update planning/cohesion tests, or explicitly test/document fail-open parser as non-build-success advisory behavior.

- `packages/engine/src/worktree-manager.ts`
  - Evidence: `baseSha` captured in `acquireForPlan()` and dirty work rejected in `mergePlan()`; no HEAD-advanced/no-diff check before merged status.
  - Changes: compare `managed.baseSha..HEAD` for built-on-merge plans and fail no-op without waiver/explicit no-change expectation.

- `packages/eforge/src/cli/display.ts`
  - Evidence: `case 'gap_close:complete'` unconditionally succeeds spinner; no acceptance validation rendering found.
  - Changes: fail/succeed based on `event.passed`; add concise acceptance validation display.

- `packages/monitor-ui/src/components/timeline/event-card.tsx` and related reducer/rendering
  - Evidence: timeline returns `Gap closing complete` unconditionally; reducer includes acceptance event as generic terminal event.
  - Changes: render failed gap close and acceptance verdict summaries/waivers.

Tests to add/update:

- PRD validator malformed `gaps` entry fails closed.
- PRD with two ACs and only one passing verdict fails with missing criterion unknown.
- No `prdValidator` / no AC inventory fails unless explicit waiver.
- Empty diff waiver uses waiver metadata rather than fake pass evidence.
- Strict parser rejects trailing prose after terminal block if terminal means terminal; rejects invalid `line` attr when present.
- Planning/cohesion reviewer malformed/missing XML behavior matches chosen policy.
- Built-on-merge no committed diff fails before validation/artifact recording when changes expected.
- CLI/monitor render `gap_close:complete passed:false` as failure and show acceptance validation summaries.

Documentation impact:

- `README.md`
  - Already states build success requires command validation and acceptance validation evidence. If no-PRD/no-AC waiver behavior is added, mention how non-PRD builds are handled.

- `docs/architecture.md`
  - Already describes per-criterion verdicts and fail-closed gap-close reruns. Update to describe deterministic expected-AC cross-checking, no-validator policy, and no-op committed-work semantics.

- `docs/config.md`
  - Already documents `allowNoCommands` and `allowEmptyPrdDiff`. Add any new waiver such as `allowNoAcceptanceCriteria` / `allowNoCommittedChanges` only if introduced, with required reason strings.

- Generated reference docs under `web/content/reference`, `web/public/reference`, and schemas under `web/public/schemas`
  - Regenerate with `pnpm docs:generate` if config/event schemas change.

- Event registry/docs
  - Update only if `acceptance_validation:complete` grows expected/missing criteria fields or if rendering docs include new summaries.

No docs-only fix should be considered complete unless tests prove the stricter gate behavior first.

Risks:

- **Over-tight AC matching false negatives**: exact text matching may fail when the validator paraphrases criteria. Mitigation: use deterministic IDs in prompts or a normalized matching strategy with tests.
- **Schema churn**: adding expected/missing criteria to events may require daemon API version bump and docs generation. Mitigation: start with engine-side enforcement and only extend wire shape if needed for UI/observability.
- **Direct/no-PRD build breakage**: failing when no AC source exists may break legitimate internal builds. Mitigation: provide explicit waiver with reason, and include clear migration docs.
- **No-op detection false positives**: some plans intentionally make no source changes (documentation generated elsewhere, already satisfied PRD, cleanup-only paths). Mitigation: distinguish clean no-op from dirty/uncommitted work; require explicit no-op waiver or expected-no-change metadata.
- **Reviewer parser fixture churn**: tests and stubs commonly use `<review-issues></review-issues>` and may include trailing prose. Tightening terminal semantics will require fixture updates. Mitigation: provide a helper for valid strict review output.
- **Policy ambiguity for planning reviewers**: making plan/architecture/cohesion reviewers strict could alter planning behavior. Mitigation: decide explicitly whether those reviewers are build-certifying sensors or planning advisory sensors, then test the policy.
- **UX inconsistency**: engine may fail correctly while CLI/monitor displays remain misleading. Mitigation: include rendering tests or snapshots for failed gap close and acceptance validation events.
- **Partial implementation risk**: implementing AC extraction without no-PRD policy or malformed-gap handling still leaves fail-open paths. Mitigation: acceptance criteria cover combined behavior before marking complete.

## Scope

In scope:

1. **Deterministic acceptance-criteria inventory and cross-check**
   - Extract expected acceptance criteria from queued PRD content and, where no PRD file exists, from normalized/session-plan/plan source where available.
   - Gate `acceptance_validation:complete` against the expected AC inventory: every expected criterion must have a verdict, and unknown/fail must fail unless specifically waived.
   - Prevent a single generic passing verdict from certifying a multi-criterion PRD.

2. **Non-PRD validation policy**
   - Define behavior when `prdValidator` is absent: use plan/source-derived ACs if available, otherwise fail with a clear validation-not-possible error unless an explicit waiver with reason exists.
   - Avoid reintroducing silent success for direct `build(planSet)` or internal/no-PRD flows.

3. **Malformed PRD validator output fail-closed hardening**
   - Treat malformed `gaps` entries as synthetic PRD validation failures instead of filtering them away.
   - Preserve existing acceptance verdict fail-closed behavior for missing/malformed verdict entries.

4. **Reviewer contract completion**
   - Either migrate planning/cohesion/architecture reviewers to strict parser behavior or explicitly document and test why they are out of scope for build-success validation.
   - Tighten the strict parser definition where needed: terminal block should be terminal if that remains the contract; invalid issue attributes such as non-numeric `line` should not be silently ignored if the attribute is present.

5. **Committed-work/no-op enforcement**
   - For built-on-merge plans, use already-recorded `baseSha` to detect whether committed changes were produced when changes are expected.
   - Add an explicit waiver or plan metadata path for intentional no-op/doc-only/config-only cases if needed.

6. **User-facing rendering**
   - Render `gap_close:complete passed:false` as failure in CLI and monitor UI.
   - Surface `acceptance_validation:complete` verdict summaries and waiver reasons where validation events are displayed.

7. **Tests and docs**
   - Add focused tests for the newly closed fail-open paths.
   - Update docs/reference/generated artifacts only if behavior or event/config contracts change.

Out of scope:

- Replacing XML reviewer output globally with a new structured protocol.
- A full waiver approval UI or human approval workflow.
- Changing landing action vocabulary (`pr|merge|leave`).
- Reworking the gap-close implementation pipeline itself, except where required to preserve final validation evidence semantics.

## Acceptance Criteria

### AC inventory and acceptance gate

- The engine derives an expected acceptance-criteria inventory from queued PRD content before final PRD/acceptance validation.
- For PRDs with multiple ACs, a validator response containing only a subset of passing verdicts fails with explicit missing/unknown verdicts for the omitted criteria.
- Every expected AC must have `pass`, `fail`, or `unknown` evidence; any `fail` or `unknown` fails the build unless specifically waived with a non-empty reason surfaced in events/logs.
- Tests cover at least: two expected ACs with one verdict, one generic verdict for multiple ACs, all ACs pass, one AC unknown, and one AC fail.

### No-PRD / no-AC policy

- Builds with no `prdValidator` and no derived AC inventory fail with a clear validation-not-possible message unless an explicit waiver with reason is configured.
- If plan/session source contains acceptance criteria but no PRD file exists, the final acceptance gate validates those criteria rather than silently skipping.
- Tests cover direct/no-PRD build failure, direct/no-PRD waiver pass, and plan-derived AC validation.

### Malformed validator output

- Malformed `gaps` entries from the PRD validator produce a synthetic failing PRD validation gap; they are not silently filtered into a passing result.
- Existing fail-closed behavior for missing/malformed acceptance verdicts remains intact.
- Tests cover malformed gap entry with otherwise passing acceptance verdicts.

### Reviewer contract completion

- All reviewer agents whose XML contract affects build/planning success use strict parsing or have an explicit, documented advisory-only exception.
- Strict parsing rejects missing XML, malformed issue XML, invalid required attributes, and invalid numeric optional attributes when present.
- If “terminal block” remains part of the contract, trailing non-whitespace text after the final block is invalid.
- Tests cover build reviewer, parallel reviewer, and planning/cohesion/architecture reviewer behavior under the chosen policy.

### Committed/no-op work enforcement

- Built-on-merge plans fail before validation/artifact recording when no committed changes were produced and changes were expected.
- Intentional no-op plans require an explicit waiver/metadata with reason.
- Tests prove dirty work, no committed diff, and successful committed diff paths; no artifact registry record is written for dirty/no-op failures.

### Rendering and docs

- CLI displays `gap_close:complete passed:false` as failure, not success.
- Monitor timeline displays failed gap close distinctly and surfaces acceptance validation summary/waivers.
- Any event/config schema changes are made in `packages/client/src/events.schemas.ts` / config schema first, with registry and wire parity tests updated.
- `pnpm type-check` and affected Vitest tests pass; `pnpm docs:generate` / docs checks are run if generated docs drift.
