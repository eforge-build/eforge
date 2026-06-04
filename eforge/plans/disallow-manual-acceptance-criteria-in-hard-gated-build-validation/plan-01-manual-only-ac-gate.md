---
id: plan-01-manual-only-ac-gate
name: Reject Manual-Only Hard-Gated Acceptance Criteria
branch: disallow-manual-acceptance-criteria-in-hard-gated-build-validation/plan-01-manual-only-ac-gate
---

# Reject Manual-Only Hard-Gated Acceptance Criteria

## Architecture Context

Acceptance criteria quality is enforced in two places that must remain synchronized:

- `packages/input/src/acceptance-criteria-quality.ts` is the canonical analyzer used by session-plan readiness through `getReadinessDetail` in `packages/input/src/session-plan.ts`.
- `packages/engine/src/validation/acceptance-criteria.ts` contains an inlined engine copy because the engine must not import from `@eforge-build/input`.

Engine enqueue validates the canonical acceptance-criteria inventory in `packages/engine/src/validation/acceptance-criteria-inventory.ts` by calling the engine analyzer and mapping analyzer failures to inventory diagnostics with `kind: "quality"`. The existing route/readiness plumbing already exposes `acDiagnostics`, so the code change is concentrated in the duplicated analyzers plus tests and guidance.

Consumer-facing guidance in `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md` must remain equivalent. `scripts/check-skill-parity.mjs` verifies this during `pnpm test`. Because the Claude Code plugin skill changes, bump `eforge-plugin/.claude-plugin/plugin.json` from its current patch version.

## Implementation

### Overview

Add a deterministic `manual-only` acceptance-criteria diagnostic for explicit manual or visual verification instructions that lack objective automation evidence. The diagnostic rejects such criteria from session-plan readiness and enqueue inventory validation. Update formatter/extractor/validator prompts and plan skills so manual-only details are preserved as non-gating `Manual Verification Notes`, not emitted as hard-gated acceptance criteria.

### Key Decisions

1. Use a targeted pattern instead of a broad semantic classifier. Match explicit phrases such as `manually verify`, `manual verification`, `visually verify`, `visual inspection`, `visually inspect`, `inspect in browser`, and `check in browser`.
2. Classify an item as `manual-only` only when the item lacks objective automation evidence such as a command outcome, API response, route/status assertion, file/directory content assertion, event emission, JSON/schema result, or validation command result.
3. Run manual-only detection after grouping-label and bare-command checks, and before the vague-language check. This keeps existing diagnostics stable for existing malformed criteria while catching manual visual checks that the current vague detector misses.
4. Preserve user intent in prompts by moving manual-only/visual-only details into `## Manual Verification Notes`. These notes are informational and do not create acceptance verdict obligations.
5. Keep the input analyzer and engine inlined analyzer byte-for-behavior synchronized in one implementation pass.

### Suggested Analyzer Shape

In both analyzer files, update the `AcDiagnostic.kind` union to include `manual-only` and add helpers with equivalent behavior:

- In `packages/input/src/acceptance-criteria-quality.ts`, use names such as `MANUAL_ONLY_RE`, `hasObjectiveAutomationOutcome`, and `isManualOnly`.
- In `packages/engine/src/validation/acceptance-criteria.ts`, mirror those helpers with the existing underscore-prefixed style, for example `_MANUAL_ONLY_RE`, `_hasObjectiveAutomationOutcome`, and `_isManualOnly`.

Recommended matching details:

- Manual/visual trigger examples:
  - `manually verify`, `manually check`, `manually inspect`, `manually confirm`
  - `manual verification`, `manual check`, `manual inspection`, excluding the section title phrase `Manual Verification Notes`
  - `visually verify`, `visually inspect`, `visually check`, `visually confirm`
  - `visual inspection`, `visual verification`, `visual check`
  - `check in browser`, `inspect in browser`, `verify in browser`, plus close variants with `the browser`
- Objective automation evidence examples:
  - Backtick command with an outcome, such as `` `pnpm test` exits 0 ``.
  - Command/result phrases, such as `exits 0`, `passes`, `completes without errors`, `returns HTTP 200`, or `responds with`.
  - API/route/event/file assertions, such as `API returns`, `route responds`, `emits an event`, `file contains`, `directory contains`, `JSON matches`, or `schema validates`.

The diagnostic suggestion must include both remedies: replace the item with an automatable criterion, or move it to non-gating manual verification notes.

## Scope

### In Scope

- Add the `manual-only` diagnostic kind to `packages/input/src/acceptance-criteria-quality.ts`.
- Mirror the analyzer changes in `packages/engine/src/validation/acceptance-criteria.ts`.
- Let existing `packages/input/src/session-plan.ts` readiness behavior consume the new diagnostic without additional readiness plumbing unless type-checking reveals a required structural update.
- Let existing `packages/engine/src/validation/acceptance-criteria-inventory.ts` map the new analyzer diagnostic to a `quality` inventory diagnostic; adjust only if test coverage exposes a gap.
- Update `packages/engine/src/prompts/formatter.md` to forbid manual-only/visual-only checks in hard-gated Acceptance Criteria and to preserve such input under `## Manual Verification Notes`.
- Update `packages/engine/src/prompts/acceptance-criteria-extractor.md` to omit manual-only/visual-only notes from canonical criteria and to report warnings when such notes are observed and omitted.
- Update `packages/engine/src/prompts/prd-validator.md` so `Manual Verification Notes` are non-gating and the Expected Acceptance Criteria list is authoritative when present.
- Update `packages/pi-eforge/skills/eforge-plan/SKILL.md` with invalid manual-only/visual-only examples and downgrade guidance.
- Update `eforge-plugin/skills/plan/plan.md` with equivalent wording to the Pi plan skill.
- Bump `eforge-plugin/.claude-plugin/plugin.json` by one patch version because the plugin skill changes.
- Extend tests for analyzer behavior, session-plan readiness, enqueue rejection, inventory diagnostics, and prompt/skill guidance.

### Out of Scope

- A natural-language classifier for every subjective or aesthetic criterion.
- Manual approval, waiver, or UI workflows for manual checks.
- Changes to event schemas or acceptance verdict wire shapes.
- Treating manual verification notes as passed acceptance evidence.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Create

None.

### Modify

- `packages/input/src/acceptance-criteria-quality.ts` — add `manual-only` diagnostic detection, messages, suggestions, and helper tests compatibility.
- `packages/engine/src/validation/acceptance-criteria.ts` — mirror the input analyzer behavior in the inlined engine copy.
- `packages/engine/src/validation/acceptance-criteria-inventory.ts` — likely no code change; verify the existing analyzer-to-`quality` mapping handles `manual-only`.
- `packages/input/src/session-plan.ts` — likely no code change; verify the existing readiness detail exposes the new diagnostic.
- `packages/engine/src/prompts/formatter.md` — add manual-only/visual-only hard-gate prohibition and `Manual Verification Notes` preservation guidance.
- `packages/engine/src/prompts/acceptance-criteria-extractor.md` — add omit/downgrade/warning guidance for manual-only notes.
- `packages/engine/src/prompts/prd-validator.md` — add non-gating manual-notes guidance and Expected Acceptance Criteria authority language.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — add invalid examples and planner instructions for manual-only/visual-only checks.
- `eforge-plugin/skills/plan/plan.md` — keep plan-skill guidance equivalent to the Pi skill.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin patch version after the skill edit.
- `test/acceptance-criteria-quality.test.ts` — add input analyzer and enqueue rejection coverage for manual-only criteria.
- `test/acceptance-criteria-extractor.test.ts` — add engine analyzer and inventory validation coverage for manual-only criteria.
- `test/session-plan-helpers.test.ts` — add `getReadinessDetail` coverage for manual-only AC diagnostics.
- `test/daemon-session-plan-routes-readiness.test.ts` — add readiness route coverage for manual-only AC diagnostics.
- `test/skills-docs-wiring.test.ts` — add prompt and skill guidance assertions for manual-only examples, `Manual Verification Notes`, extractor warnings, PRD validator non-gating notes, and plugin/Pi parity-sensitive wording.

## Test Plan

Add or extend these focused tests:

1. `test/acceptance-criteria-quality.test.ts`
   - `analyzeAcceptanceCriteriaItem('- Manually verify dashboard rendering in the browser.')` returns `kind: 'manual-only'`.
   - `analyzeAcceptanceCriteriaItem('- Visually inspect the dashboard for layout regressions.')` returns `kind: 'manual-only'`.
   - The diagnostic suggestion matches both `automatable` and `manual verification notes` case-insensitively.
   - A criterion with a manual/visual phrase plus objective command/API/file/event evidence does not return `manual-only`, for example ``- Manually verify by running `pnpm test` and confirming it exits 0.``.
   - Section-level and body-level analysis return `valid: false` with `manual-only` diagnostics for manual-only criteria.
   - Existing grouping-label, bare-command, and vague tests remain in place.
   - Engine enqueue with canonical extractor output containing `Manually verify dashboard rendering in the browser.` emits `enqueue:failed`, emits no `enqueue:complete`, and leaves zero `.md` files in `.eforge/queue`.

2. `test/acceptance-criteria-extractor.test.ts`
   - The engine analyzer copy returns `manual-only` for the same representative manual and visual examples.
   - `validateCanonicalAcceptanceCriteriaInventory` returns an invalid result with a `quality` diagnostic for a manual-only canonical criterion.
   - `parseAcceptanceCriteriaExtractorOutput` rejects manual-only criteria; include the case alongside grouping-label, bare-command, and vague rejection coverage.

3. `test/session-plan-helpers.test.ts`
   - `getReadinessDetail` returns `ready: false` and `acDiagnostics[0].kind === 'manual-only'` when the required `acceptance-criteria` section contains a manual-only criterion.
   - The `acceptance-criteria` dimension remains covered and absent from `missingDimensions` when content exists but fails quality analysis.

4. `test/daemon-session-plan-routes-readiness.test.ts`
   - `GET ${API_ROUTES.sessionPlanReadiness}` returns `ready: false` and a `manual-only` `acDiagnostics` entry for a session plan containing a manual-only criterion.

5. `test/skills-docs-wiring.test.ts`
   - Pi and Claude Code plan skills contain `manually verify dashboard`, `visually inspect UI`, `manual-only`, and `Manual Verification Notes` guidance.
   - Formatter prompt contains instructions that manual-only/visual-only checks are not Acceptance Criteria, are preserved under `Manual Verification Notes`, and become Acceptance Criteria only with concrete automatable outcomes.
   - Acceptance criteria extractor prompt contains instructions to omit manual-only/visual-only notes and to emit warnings when those notes are omitted or downgraded.
   - PRD validator prompt states that `Manual Verification Notes` are informational/non-gating and that Expected Acceptance Criteria are authoritative when populated.

## Verification

- [ ] `analyzeAcceptanceCriteriaItem('- Manually verify dashboard rendering in the browser.')` returns a diagnostic with `kind: 'manual-only'`.
- [ ] `analyzeAcceptanceCriteriaItem('- Visually inspect the dashboard for layout regressions.')` returns a diagnostic with `kind: 'manual-only'`.
- [ ] The `manual-only` diagnostic suggestion contains replacement-with-automatable-criterion guidance and non-gating manual-notes guidance.
- [ ] A criterion containing a manual or visual phrase plus an objective command, API, file, or event outcome does not return `kind: 'manual-only'`.
- [ ] Session-plan readiness returns `ready: false` and includes a `manual-only` `acDiagnostics` entry for a manual-only acceptance criterion.
- [ ] Canonical inventory validation returns a `quality` diagnostic for a manual-only criterion.
- [ ] Engine enqueue emits `enqueue:failed` and writes zero queue markdown files for canonical extractor output containing a manual-only criterion.
- [ ] `packages/engine/src/prompts/formatter.md` contains `Manual Verification Notes` guidance and forbids manual-only/visual-only checks in hard-gated Acceptance Criteria.
- [ ] `packages/engine/src/prompts/acceptance-criteria-extractor.md` contains omission and warning guidance for manual-only/visual-only notes.
- [ ] `packages/engine/src/prompts/prd-validator.md` states that `Manual Verification Notes` are non-gating and Expected Acceptance Criteria are authoritative when populated.
- [ ] Pi and Claude Code plan skills contain equivalent manual-only/visual-only acceptance-criteria guidance.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is bumped by one patch version from the pre-change value.
- [ ] `node scripts/check-skill-parity.mjs` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

## Implementation Notes

- Keep exact text edits bounded in `packages/input/src/session-plan.ts` if any changes become necessary because the file exceeds 1,000 lines.
- Do not import `@eforge-build/input` from engine code.
- Do not update `packages/pi-eforge/package.json`.
- If prompt tests are implemented as string assertions, prefer targeted substrings over brittle full prompt snapshots.
