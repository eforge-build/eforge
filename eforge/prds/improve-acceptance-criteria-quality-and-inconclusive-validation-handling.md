---
title: Improve Acceptance Criteria Quality and Inconclusive Validation Handling
created: 2026-06-07
landing: pr
landing_auto_merge: true
---

# Improve Acceptance Criteria Quality and Inconclusive Validation Handling

## Problem / Motivation

Backlog item `.backlog/items/backlog-2026-06-07-improve-acceptance-criteria-quality-and-inconclusive-validat.md` combines two related concerns:

- Upstream planning quality: `/eforge:plan` should guide agents to write acceptance criteria at the right semantic level instead of producing long field-by-field lists that are technically valid but noisy and hard for validators to evaluate.
- Downstream validator handling: when the PRD validator emits no usable acceptance verdicts, eforge should make the failure explicitly inconclusive/validator-related and provide actionable diagnostics rather than making it look like concrete unmet requirements.

Concrete incident evidence: the failed build `improve-pi-eforge-extensions-contribution-invocation-ux` had 52 granular canonical criteria plus a generic synthesized row. Deterministic commands passed, but acceptance validation ended with 0 pass / 0 fail / 53 unknown because the validator did not produce criterion verdicts.

Roadmap alignment: `docs/roadmap.md` names **Honest gates** under Kernel Resilience and Typed Recovery: completed builds should mean verified work, acceptance evidence should be strengthened, and failures should not create optimistic success. This change keeps gates fail-closed while making inconclusive validator failures more honest and actionable.

Validated source findings:

- `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md` already require flat, atomic, objective AC and reject grouping labels, bare commands, vague criteria, and manual-only/visual-only checks. Searches found no guidance for semantic abstraction level, over-granular field-by-field duplication, or contract-vs-behavior consolidation.
- `packages/input/src/acceptance-criteria-quality.ts` and the inlined engine copy in `packages/engine/src/validation/acceptance-criteria.ts` implement mechanical AC diagnostics only: `grouping-label`, `bare-command`, `manual-only`, and `vague`.
- `packages/engine/src/agents/prd-validator.ts` synthesizes a single unknown verdict with evidence `The validator did not produce acceptance criterion verdicts.` when the validator output omits `acceptanceVerdicts`.
- `packages/engine/src/orchestrator/phases.ts` expands missing verdicts across the expected canonical inventory via `synthesizeMissingVerdicts`, which explains the observed all-unknown explosion.
- `packages/engine/src/terminal-failure.ts` currently records all failed `acceptance_validation:complete` events with the generic terminal message `Acceptance criteria validation failed`.
- `packages/client/src/event-registry.ts` summarizes failed acceptance validation as `N criterion/criteria not passed`, even when every non-passing verdict is `unknown` and none are concrete `fail` verdicts.
- `packages/engine/src/validation/acceptance-summary.ts` already contains a better distinction for final build summaries: all-unknown failures are described as `inconclusive (insufficient evidence)`.
- Recovery already has partial handling for inconclusive acceptance failures: `packages/engine/src/prompts/recovery-analyst.md` instructs the analyst that unknown-only acceptance validation is insufficient evidence to abandon, and `packages/engine/src/recovery/sidecar-payload.ts` includes pass/fail/unknown counts and bounded verdicts.
- The recovery sidecar key evidence still does not explicitly classify the all-unknown/no-verdict case as a validator-output problem.
- Tests already cover mechanical AC quality in `test/acceptance-criteria-quality.test.ts`.
- Tests already cover PRD validator omitted-verdict fail-closed behavior in `test/agent-wiring-build-evaluate.test.ts`.
- Tests already cover acceptance terminal failure enrichment in `test/recovery-terminal-failure.test.ts`.
- Tests already cover client acceptance event summary wording in `packages/client/src/__tests__/events-schemas-validation-recovery.test.ts`.

Classification: this is a **feature / focused** change. It changes user-facing planning guidance and validation/recovery diagnostics across Pi skill, Claude plugin skill, client event summaries, engine terminal failure wording, and focused tests. It is cross-cutting but cohesive; it does not require delegated subsystem planning.

Recommended profile: **Excursion**. A single cohesive implementation plan can cover the planning-skill guidance update, verdict-count summary helpers, terminal failure message adjustment, sidecar key evidence update, plugin version bump, and focused tests. The work is cross-cutting, but it does not require delegated subsystem planning or independent module planners. It is more than an Errand because it changes behavior across plugin/Pi/client/engine/recovery surfaces.

## Goal

Keep acceptance gates honest and fail-closed while making upstream criteria easier for validators to evaluate and making downstream all-unknown/no-verdict failures explicitly diagnosable.

## Approach

Update both planning skills with explicit pre-ready guidance to review the full acceptance criteria set for semantic level, over-granular field-by-field duplication, and contract-vs-behavior consolidation.

Keep semantic AC quality as planner guidance, not a hard gate in this slice. The existing analyzer can reliably detect mechanical issues, but over-granularity and contract-vs-behavior level are semantic judgments. A hard heuristic could reject legitimate detailed criteria or create false confidence.

Keep all-unknown validation fail-closed. All `unknown` verdicts should still make `acceptance_validation:complete.passed` false unless a waiver exists. The improvement is diagnostic honesty, not gate relaxation.

Use wording based on verdict distribution:

- When `fail > 0`, summaries should continue to state failed/not met criteria.
- When `fail === 0 && unknown > 0`, summaries should say acceptance validation was inconclusive or insufficiently evidenced.
- When all verdicts are unknown, summaries should call out that no criterion was verified.
- This should be based on existing verdict arrays with no schema change.

Preserve existing wire shapes. Do not add a new required field to `acceptance_validation:complete` or `build:terminal-failure`.

Make recovery sidecars operator-oriented. Recovery key evidence should explicitly distinguish `0 fail, all unknown` from concrete unmet criteria and should suggest inspecting validator output/context or clarifying criteria. The sidecar should continue to include bounded verdict evidence and omission notices.

Keep plugin and Pi skill parity explicit. Because this changes the Claude Code plugin skill, bump `eforge-plugin/.claude-plugin/plugin.json`. Do not bump `packages/pi-eforge/package.json`.

Primary implementation targets:

- `packages/pi-eforge/skills/eforge-plan/SKILL.md`
  - Add an “acceptance criteria set review” subsection near the existing acceptance criteria guidance or readiness step.
  - Explain how to consolidate repetitive field-by-field criteria into behavior-level or contract-level criteria without losing objectively testable obligations.
- `eforge-plugin/skills/plan/plan.md`
  - Apply the same guidance as the Pi skill.
  - Keep wording synchronized enough for `scripts/check-skill-parity.mjs` to pass.
- `eforge-plugin/.claude-plugin/plugin.json`
  - Bump plugin version because a plugin skill file changes.
- `packages/client/src/event-registry.ts`
  - Update `acceptance_validation:complete` summary wording to report fail and unknown counts separately.
  - Use inconclusive wording when all non-passing verdicts are `unknown` and no verdict is `fail`.
- `packages/engine/src/terminal-failure.ts`
  - Derive a more precise terminal failure message for failed acceptance validation events.
  - Use wording such as `Acceptance validation inconclusive: N criterion/criteria unknown` for all-unknown failures while retaining concrete failure wording when `fail` verdicts exist.
- `packages/engine/src/recovery/sidecar-payload.ts`
  - Add key evidence for all-unknown/no-verdict acceptance validation, including the pass/fail/unknown distribution and a diagnostic hint that no concrete failed criteria were produced.
  - Preserve bounded evidence behavior and existing omission notices.

Possible supporting target:

- `packages/engine/src/validation/acceptance-summary.ts`
  - Reuse or extend count/summary helpers so terminal failure, sidecar, and client summary wording do not drift.
  - If client cannot import engine helpers, mirror a tiny local count helper in `packages/client/src/event-registry.ts`.

Likely tests and validation commands:

- Add or extend a skill-surface test to assert both planning skills mention semantic-level review, over-granular field-by-field duplication, and contract-vs-behavior consolidation.
- Extend `packages/client/src/__tests__/events-schemas-validation-recovery.test.ts` so all-unknown acceptance events summarize as inconclusive rather than “not passed.”
- Extend `test/recovery-terminal-failure.test.ts` or a focused terminal-failure test so all-unknown acceptance validation produces an inconclusive terminal message.
- Extend `test/recovery-sidecars.test.ts` or a focused sidecar-payload test so recovery key evidence includes an all-unknown inconclusive diagnostic.
- Run `pnpm test -- acceptance` or targeted affected tests if available.
- Run `pnpm test -- skill-parity terminal-failure recovery-sidecars events-schemas-validation-recovery acceptance-criteria-quality` if targeted filtering is practical.
- Run `pnpm type-check`.
- Run `pnpm maintainability:check` because project policy requires maintainability validation before committing.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `/eforge:plan` skill guidance lacks semantic AC-level review. | Searched `packages/pi-eforge/skills/eforge-plan/SKILL.md`, `eforge-plugin/skills/plan/plan.md`, and AC analyzer files for `over-granular`, `field-by-field`, `contract-vs-behavior`, and similar terms; no matches were found. Read the skill guidance and confirmed it covers mechanical AC quality only. | high | low | Re-read both skill files before editing and run `node scripts/check-skill-parity.mjs`. | If wrong, implementation could duplicate existing guidance, but search/read evidence makes this unlikely. |
| A hard over-granularity analyzer is not appropriate for the first slice. | Read `packages/input/src/acceptance-criteria-quality.ts` and the inlined engine copy; current analyzer uses deterministic regex-style checks for mechanical defects. Semantic abstraction-level judgment would require fuzzier criteria and could reject legitimate detailed AC. | medium | medium | Prototype heuristic against existing session plans and backlog examples, then review false positives. | If wrong, the first slice may rely too much on guidance and not prevent repeated over-granular AC automatically. |
| The all-unknown failure can be diagnosed from existing acceptance verdict arrays without a schema change. | Read `packages/client/src/event-registry.ts`, `packages/engine/src/terminal-failure.ts`, `packages/engine/src/recovery/sidecar-payload.ts`, and `packages/engine/src/validation/acceptance-summary.ts`; all receive or summarize verdict arrays with pass/fail/unknown outcomes. | high | low | Add focused tests for all-unknown event summaries, terminal messages, and sidecar key evidence. | If wrong, implementation might need a new optional diagnostic field or API version consideration. |
| The PRD validator omitted-verdict path is the likely source of the observed “all unknown plus generic row” failure shape. | Read `packages/engine/src/agents/prd-validator.ts`; it emits one synthetic unknown row when `acceptanceVerdicts` is absent. Read `packages/engine/src/orchestrator/phases.ts`; it then calls `synthesizeMissingVerdicts` against the canonical expected criteria. This matches the observed 1 generic row plus expected-criteria unknown rows. | high | low | Add or extend a test that combines omitted `acceptanceVerdicts` with multiple expected criteria through the orchestrator path. | If wrong, diagnostics still improve all-unknown failures, but root cause wording should stay general rather than blame one parser path. |
| Better terminal/event/sidecar wording is sufficient for this backlog item’s downstream hardening goal. | Backlog asks to classify and surface all-unknown/no-verdict as inconclusive with actionable diagnostics, not to alter recovery eligibility or add a new workflow state. Existing recovery analyst prompt already treats unknown-only acceptance as manual/inconclusive. | medium | low | Inspect Console rendering after event summary changes if desired. | If wrong, a follow-up may need a richer failure subtype or Console-specific UI treatment. |
| Changing the Claude Code planning skill requires a plugin version bump. | Project instructions state to always bump `eforge-plugin/.claude-plugin/plugin.json` when changing anything in the plugin. | high | low | Inspect plugin manifest before implementation. | If missed, project convention and tests may fail or release metadata will be stale. |
| No low-confidence high-impact assumption remains unresolved. | All high-impact code-impact assumptions were validated with source reads/searches. Remaining medium-confidence decisions are deliberately scoped to avoid irreversible schema or hard-gate changes. | high | low | Re-run readiness after acceptance criteria are written. | If wrong, implementation may need scope adjustment before build enqueue. |

## Scope

In scope:

- Update `packages/pi-eforge/skills/eforge-plan/SKILL.md` with explicit pre-ready guidance to review acceptance criteria for semantic level, over-granular field-by-field duplication, and contract-vs-behavior consolidation.
- Update `eforge-plugin/skills/plan/plan.md` with explicit pre-ready guidance to review acceptance criteria for semantic level, over-granular field-by-field duplication, and contract-vs-behavior consolidation.
- Keep existing mechanical AC quality gates in place for grouping labels, bare commands, vague criteria, and manual-only criteria.
- Preserve hard-gated acceptance validation semantics: `unknown` verdicts still fail unless explicitly waived.
- Improve all-unknown/no-verdict diagnostics by changing user-facing summaries for acceptance events.
- Improve all-unknown/no-verdict diagnostics by changing terminal failure messages.
- Improve all-unknown/no-verdict diagnostics by changing recovery sidecar key evidence.
- Distinguish “inconclusive” from concrete failed criteria.
- Add focused tests for planning-skill guidance presence.
- Add focused tests for all-unknown acceptance event summaries.
- Add focused tests for all-unknown terminal failure messages.
- Add focused tests for recovery sidecar key evidence.
- Keep Pi and Claude Code planning skill surfaces in sync.
- Bump `eforge-plugin/.claude-plugin/plugin.json` because the Claude Code plugin skill file changes.

Out of scope:

- Do not introduce a hard semantic AC analyzer for over-granularity in this first slice; automated semantic-level judgment is brittle and could reject valid detailed criteria.
- Do not make unknown-only acceptance validation pass automatically.
- Do not add a new acceptance event type or breaking wire-shape change.
- Do not change the PRD validator agent contract beyond optional prompt/diagnostic wording that preserves the existing JSON output schema.
- Do not change the acceptance unknown resolver behavior unless a small diagnostic-only change is necessary.
- Do not implement the broader manual verification hold workflow.
- Do not change `packages/pi-eforge/package.json` version.

## Acceptance Criteria

- `packages/pi-eforge/skills/eforge-plan/SKILL.md` instructs planners to review the whole acceptance criteria set for over-granular field-by-field duplication before marking a session ready.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` instructs planners to consolidate related contract-shape requirements while preserving distinct behavior-level acceptance criteria.
- `eforge-plugin/skills/plan/plan.md` includes the same semantic acceptance criteria review guidance as the Pi planning skill.
- Existing mechanical AC diagnostics for `grouping-label`, `bare-command`, `manual-only`, and `vague` remain active.
- `unknown` acceptance verdicts keep acceptance validation fail-closed unless explicitly waived.
- `node scripts/check-skill-parity.mjs` exits 0.
- `getEventSummary` for a failed `acceptance_validation:complete` event whose verdicts are all `unknown` includes the word `inconclusive`.
- `getEventSummary` for a failed `acceptance_validation:complete` event whose verdicts are all `unknown` does not include the phrase `not passed`.
- `getEventSummary` for a failed `acceptance_validation:complete` event with both `fail` and `unknown` verdicts reports the fail count and the unknown count separately.
- `createBuildTerminalFailureTracker` emits a `build:terminal-failure` message containing `inconclusive` when it observes a failed `acceptance_validation:complete` event with zero `fail` verdicts and at least one `unknown` verdict.
- `createBuildTerminalFailureTracker` emits a `build:terminal-failure` message that identifies concrete failed criteria when it observes a failed `acceptance_validation:complete` event with at least one `fail` verdict.
- Recovery sidecar key evidence for acceptance validation with zero `fail` verdicts and all verdicts `unknown` includes an explicit inconclusive-validation diagnostic.
- Recovery sidecar key evidence for acceptance validation with zero `fail` verdicts and all verdicts `unknown` states that no concrete failed criteria were produced.
- Existing acceptance validation event schemas continue to accept `acceptance_validation:complete` events without any new required wire fields.
- No new acceptance event type is introduced.
- The PRD validator agent JSON output schema remains unchanged.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped because the Claude Code plugin planning skill changes.
- `packages/pi-eforge/package.json` version remains unchanged.
- A focused test asserts both planning skills mention semantic-level review, over-granular field-by-field duplication, and contract-vs-behavior consolidation.
- A focused test asserts all-unknown acceptance event summaries use inconclusive wording.
- A focused test asserts all-unknown terminal failure messages use inconclusive wording.
- A focused test asserts all-unknown recovery sidecar key evidence includes an inconclusive diagnostic.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Optionally inspect Console rendering after event summary changes.
- Further validation can prototype an over-granularity heuristic against existing session plans and backlog examples, then review false positives.