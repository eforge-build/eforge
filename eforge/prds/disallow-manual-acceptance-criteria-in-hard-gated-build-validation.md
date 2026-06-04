---
title: Disallow Manual Acceptance Criteria in Hard-Gated Build Validation
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Disallow Manual Acceptance Criteria in Hard-Gated Build Validation

## Problem / Motivation

Manual-only acceptance criteria can enter session plans or formatted PRDs as hard build gates. When those criteria require a human observation, such as “manually verify dashboard rendering,” the acceptance validator can only return `unknown`, causing otherwise successful builds to fail late.

This is garbage-in for hard validation: a criterion that cannot be objectively automated should be rejected before enqueue/readiness or preserved only as a non-gating manual verification note.

Affected users include:

- eforge users who write or plan PRDs with manual review bullets.
- Build agents that later fail acceptance validation for criteria they cannot prove.
- Reviewers who must diagnose unnecessary `unknown` acceptance failures.

Why now:

- Backlog item `.eforge/backlog/items/backlog-2026-06-04-disallow-manual-acceptance-criteria-in-hard-gated-build-vali.md` reports a failed build, `tag-every-agent-with-an-orchestrator-assigned-swimlane`.
- In that failed build, 21 acceptance criteria passed and one manual visual-verification AC, `ac-022`, remained `unknown`, causing acceptance validation failure.
- The stated policy is that hard build gates must be objectively automatable; manual review should not masquerade as acceptance evidence.

Roadmap alignment:

- `docs/roadmap.md` explicitly includes “Honest gates” under Kernel Resilience and Typed Recovery.
- That roadmap item includes stricter fail-closed validation and acceptance evidence.
- This change fits that direction.

Validated codebase facts:

- Session-plan readiness uses `packages/input/src/acceptance-criteria-quality.ts` via `getReadinessDetail` in `packages/input/src/session-plan.ts`.
- The current session-plan readiness analyzer detects `grouping-label`, `bare-command`, and `vague` diagnostics only.
- Engine enqueue hard-gates canonical AC inventory through an inlined analyzer in `packages/engine/src/validation/acceptance-criteria.ts` and `packages/engine/src/validation/acceptance-criteria-inventory.ts`.
- The engine file states the analyzer is intentionally duplicated from `packages/input/src/acceptance-criteria-quality.ts` to avoid an engine-to-input dependency.
- Analyzer changes must update both the input copy and the engine copy.
- `rg` over analyzer, prompts, and plan skills found no current manual/visual-verification pattern handling.
- `packages/engine/src/prompts/formatter.md` and `packages/engine/src/prompts/acceptance-criteria-extractor.md` contain AC rules but do not yet tell agents to downgrade manual-only verification into non-gating notes.
- Pi and Claude Code planning skills both document flat/objectively validatable ACs, but neither includes manual-only invalid examples or downgrade guidance.
- The affected planning skill files are `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md`.

User-added requirement:

- Update the Pi eforge plan skill/command guidance to prevent garbage-in acceptance criteria.
- Because project instructions require consumer-facing Pi and Claude Code integrations to stay in sync, include the Claude Code plugin planning skill guidance as well.

## Goal

Hard-gated acceptance criteria should be objectively automatable. Manual-only or visual-only verification requests should either be rejected before readiness/enqueue or preserved as non-gating `Manual Verification Notes`.

## Approach

Expected implementation targets and evidence:

- `packages/input/src/acceptance-criteria-quality.ts`
  - Add a diagnostic kind for manual-only criteria, for example `manual-only`.
  - Detect phrases that make the whole criterion depend on human/visual/manual observation, such as “manually verify”, “manual verification”, “visually verify”, “visual inspection”, and “check in browser”, when no objective command/API/file/event outcome is stated.
  - The diagnostic suggestion should say to replace the item with an automatable criterion or move it to non-gating manual verification notes.

- `packages/engine/src/validation/acceptance-criteria.ts`
  - Mirror the analyzer changes in the inlined copy.
  - Evidence: the file header says the canonical copy lives in input and must be kept in sync because the engine must not import from `@eforge-build/input`.

- `packages/input/src/session-plan.ts`
  - Likely no logic change is needed beyond consuming the new analyzer diagnostic.
  - `getReadinessDetail` already marks readiness false when `analyzeAcceptanceCriteria(content)` returns invalid diagnostics.
  - Tests should verify readiness exposes `acDiagnostics` for a manual-only AC.

- `packages/engine/src/validation/acceptance-criteria-inventory.ts`
  - Likely no logic change is needed beyond analyzer consumption.
  - Inventory validation already calls `analyzeAcceptanceCriteriaItem` and emits a `quality` diagnostic.
  - Tests should verify canonical extractor output containing a manual-only criterion causes enqueue/inventory validation failure and no queue file is written.

- `packages/engine/src/prompts/formatter.md`
  - Strengthen Acceptance Criteria Rules so manual-only or visual-only checks are forbidden in hard-gated ACs.
  - Instruct the formatter to preserve such user requests under a `## Manual Verification Notes` section as non-gating notes.
  - Instruct the formatter to convert such user requests into ACs only when a concrete automatable outcome is explicitly present.

- `packages/engine/src/prompts/acceptance-criteria-extractor.md`
  - Instruct the extractor not to emit manual-only/visual-only verification as canonical criteria.
  - Instruct the extractor to include warnings when manual-only notes were observed and omitted/downgraded.

- `packages/engine/src/prompts/prd-validator.md`
  - Clarify that `Manual Verification Notes` are non-gating informational notes and should not produce acceptance verdicts.
  - Clarify that the Expected Acceptance Criteria list is the authoritative hard-gate list when populated.

- `packages/pi-eforge/skills/eforge-plan/SKILL.md`
  - Add stricter planning guidance and examples.
  - Document that “manually verify dashboard”, “visually inspect UI”, and similar manual checks are invalid ACs.
  - Instruct planners to record manual checks as non-gating manual verification notes or replace them with automatable checks.

- `eforge-plugin/skills/plan/plan.md`
  - Keep the Claude Code plan skill guidance equivalent to Pi's guidance.
  - If this file changes, also bump `eforge-plugin/.claude-plugin/plugin.json`.

Tests likely to extend:

- `test/acceptance-criteria-quality.test.ts`
- `test/acceptance-criteria-extractor.test.ts`
- `test/daemon-session-plan-routes-readiness.test.ts`
- Existing prompt/skill validation tests if present.
- Focused string/assertion tests only if consistent with existing test style.

Design decisions:

1. Use a targeted manual-only diagnostic instead of a broad semantic classifier.
   - Rationale: the current AC quality gate is simple and deterministic.
   - A targeted pattern catches the known bad class without making enqueue brittle for every subjective phrase.
   - Implement the pattern conservatively around explicit manual/visual instructions: “manually verify”, “manual verification”, “visually verify”, “visual inspection”, “inspect in browser”, “check in browser”, and close variants.

2. Reject manual-only criteria in hard gates and use prompts for downgrade/preservation.
   - Rationale: deterministic validation should fail closed when a manual-only criterion reaches a hard gate.
   - Agent-facing prompts can preserve user intent by moving manual checks into `Manual Verification Notes`, where they are non-gating context.
   - This avoids silently dropping information while preventing late `unknown` acceptance failures.

3. Prevent manual notes from creating acceptance verdict obligations.
   - Rationale: if the formatter adds `## Manual Verification Notes`, PRD validation should treat that section as informational.
   - The Expected Acceptance Criteria list remains the authoritative set for hard acceptance verdicts when populated.

4. Keep duplicated analyzer logic synchronized.
   - Rationale: the engine copy cannot import from input by design.
   - Update both files in the same implementation.
   - Add tests that exercise both paths.

5. Keep planning guidance synchronized across Pi and Claude Code.
   - Rationale: project policy requires `packages/pi-eforge/` and `eforge-plugin/` consumer-facing surfaces to stay in sync.
   - The Pi skill is explicitly requested.
   - The Claude Code skill should receive equivalent language.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The current AC quality analyzer does not detect manual-only / visual-only criteria. | Read `packages/input/src/acceptance-criteria-quality.ts` and `packages/engine/src/validation/acceptance-criteria.ts`; `rg` for manual/visual verification terms across analyzers, prompts, and plan skills returned no matches. | high | low | Add tests for representative manual-only phrases and run the targeted test files. | If wrong, implementation may duplicate existing behavior; tests will reveal overlap. |
| Adding a new diagnostic kind is acceptable for session-plan readiness consumers. | `getReadinessDetail` exposes `acDiagnostics` structurally and already carries diagnostic `kind`, `message`, and `suggestion`; route code passes readiness through. No route-specific enum was found in the inspected path. | medium | low | Run TypeScript type-check and session-plan readiness route tests after changing the diagnostic union. | If wrong, client/UI code may require an enum/type update. |
| Engine enqueue rejection can be achieved through canonical inventory validation without new queue plumbing. | `packages/engine/src/validation/acceptance-criteria-inventory.ts` already maps analyzer diagnostics to `quality` inventory diagnostics, and existing tests verify invalid AC output emits `enqueue:failed` and writes no queue files. | high | low | Extend `test/acceptance-criteria-quality.test.ts` or `test/acceptance-criteria-extractor.test.ts` with manual-only inventory output. | If wrong, an additional enqueue gate may be needed. |
| Prompt downgrade to `Manual Verification Notes` will not break PRD formatting or downstream parsing. | Formatter output is Markdown with standard sections, and downstream AC extraction looks specifically for Acceptance Criteria / AC headings. Extra Markdown sections are generally tolerated. | medium | low | Add or adapt tests for formatted PRD/extractor behavior if prompt tests exist; otherwise verify extractor ignores manual notes in a direct unit test. | If wrong, manual notes could be reinterpreted as requirements; PRD-validator prompt guidance mitigates this. |
| Pi and Claude Code plan skills should both be updated. | Project instructions explicitly say consumer-facing integration packages must stay in sync when changing skills/user-facing behavior; files are `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md`. | high | low | Review both diffs and run any skill/package tests if present. | If wrong, one integration continues encouraging bad ACs. |
| The implementation should remain focused rather than add a broad subjective-language classifier. | Existing analyzer is deterministic and already limited to concrete classes; backlog evidence names manual/visual verification as the failing class. | high | low | Keep tests scoped to explicit manual/visual phrases and avoid overbroad regexes. | If wrong, some subjective ACs may remain, but the known failure mode is addressed without excessive false positives. |

No low-confidence/high-impact assumptions remain unresolved. The main medium-confidence assumptions have low-cost validation paths and are directly covered by the planned tests/type-check.

Profile signal:

- Recommended profile: `excursion`.
- Rationale: this is a cohesive cross-cutting quality-gate update that spans duplicated analyzer logic, prompts, planning skill docs, and tests.
- A single planner can enumerate the affected files and validation path without delegated module planning, so `expedition` is unnecessary.
- It is broader than an `errand` because it touches engine/input boundaries and consumer-facing guidance.

## Scope

In scope:

- Add deterministic AC quality detection for manual-only / visual-only verification criteria in both the session-plan analyzer and the engine's inlined analyzer.
- Treat manual-only ACs as invalid hard-gate criteria in session-plan readiness through `acDiagnostics`.
- Treat manual-only ACs as invalid hard-gate criteria in canonical inventory validation during enqueue.
- Update formatter/extractor prompts so manual-only verification requested by the user is preserved outside the hard-gated Acceptance Criteria section, preferably under a non-gating `Manual Verification Notes` section, instead of being emitted as an AC.
- Update PRD validation prompt guidance so `Manual Verification Notes` are informational/non-gating.
- Update PRD validation prompt guidance so the canonical Expected Acceptance Criteria list remains authoritative for hard acceptance verdicts.
- Update Pi planning skill guidance at `packages/pi-eforge/skills/eforge-plan/SKILL.md` with explicit invalid examples.
- Update Pi planning skill guidance to convert manual-only checks into non-gating notes or automatable criteria.
- Keep the Claude Code plugin planning skill in sync at `eforge-plugin/skills/plan/plan.md`.
- Bump `eforge-plugin/.claude-plugin/plugin.json` if implementation changes files under `eforge-plugin/`.
- Add or extend tests for analyzer behavior.
- Add or extend tests for session-plan readiness.
- Add or extend tests for engine enqueue rejection.
- Add or extend prompt/skill guidance tests where existing tests already cover related AC quality rules.

Out of scope:

- Building a full natural-language classifier for every possible subjective criterion.
- Adding UI workflows for manual approval or waiver collection.
- Changing the acceptance verdict event schema unless implementation discovers it is strictly required.
- Making manual notes count as passed acceptance evidence.

## Acceptance Criteria

- `packages/input/src/acceptance-criteria-quality.ts` defines a diagnostic kind that identifies manual-only criteria, such as `manual-only`.
- `packages/engine/src/validation/acceptance-criteria.ts` mirrors the manual-only diagnostic behavior from `packages/input/src/acceptance-criteria-quality.ts`.
- `analyzeAcceptanceCriteriaItem('- Manually verify dashboard rendering in the browser.')` returns a manual-only AC diagnostic with a suggestion to replace the item with an automatable criterion or move it to non-gating manual verification notes.
- `analyzeAcceptanceCriteriaItem('- Visually inspect the dashboard for layout regressions.')` returns a manual-only AC diagnostic with a suggestion to replace the item with an automatable criterion or move it to non-gating manual verification notes.
- `analyzeAcceptanceCriteriaItem` does not classify a criterion as manual-only solely because it contains a manual or visual phrase when the criterion also states an objective command, API, file, or event outcome.
- Session-plan readiness for an `acceptance-criteria` section containing a manual-only criterion returns `ready: false`.
- Session-plan readiness for an `acceptance-criteria` section containing a manual-only criterion includes an `acDiagnostics` entry for the manual-only criterion.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` maps a manual-only criterion from canonical extractor output to a `quality` diagnostic.
- Engine enqueue rejects canonical extractor output that contains a manual-only criterion.
- Engine enqueue emits an `enqueue:failed` event when canonical extractor output contains a manual-only criterion.
- The queue directory contains zero new markdown files after a rejected enqueue caused by a manual-only criterion.
- `packages/engine/src/prompts/formatter.md` instructs the formatter not to emit manual-only or visual-only checks as Acceptance Criteria.
- `packages/engine/src/prompts/formatter.md` instructs the formatter to preserve user-provided manual-only or visual-only details under non-gating `Manual Verification Notes` when those details must be retained.
- `packages/engine/src/prompts/formatter.md` instructs the formatter to convert manual-only or visual-only requests into acceptance criteria only when a concrete automatable outcome is explicitly present.
- `packages/engine/src/prompts/acceptance-criteria-extractor.md` instructs the extractor not to emit manual-only or visual-only checks as canonical acceptance criteria.
- `packages/engine/src/prompts/acceptance-criteria-extractor.md` instructs the extractor to report a warning when it omits or downgrades a manual-only or visual-only note.
- `packages/engine/src/prompts/prd-validator.md` states that `Manual Verification Notes` are informational and do not require acceptance verdicts.
- `packages/engine/src/prompts/prd-validator.md` states that the Expected Acceptance Criteria list is the authoritative hard-gate list when populated.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` documents “manually verify dashboard”, “visually inspect UI”, and similar manual checks as invalid hard-gated acceptance criteria.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` tells planners to convert manual-only and visual-only checks to automatable criteria or non-gating manual verification notes.
- `eforge-plugin/skills/plan/plan.md` contains equivalent manual-only and visual-only acceptance-criteria guidance to `packages/pi-eforge/skills/eforge-plan/SKILL.md`.
- `eforge-plugin/.claude-plugin/plugin.json` has a bumped plugin version when `eforge-plugin/skills/plan/plan.md` changes.
- The existing `grouping-label` AC quality diagnostic remains covered by tests and passes.
- The existing `bare-command` AC quality diagnostic remains covered by tests and passes.
- The existing `vague` AC quality diagnostic remains covered by tests and passes.
- `pnpm type-check` exits 0.