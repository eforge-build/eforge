---
id: plan-01-acceptance-guidance-diagnostics
name: Acceptance Criteria Guidance and Inconclusive Validation Diagnostics
branch: improve-acceptance-criteria-quality-and-inconclusive-validation-handling/plan-01-acceptance-guidance-diagnostics
---

# Acceptance Criteria Guidance and Inconclusive Validation Diagnostics

## Architecture Context

eforge has two consumer planning surfaces for `/eforge:plan`: the Claude Code plugin skill under `eforge-plugin/skills/plan/plan.md` and the Pi extension skill under `packages/pi-eforge/skills/eforge-plan/SKILL.md`. Project policy requires these surfaces to stay synchronized and requires a Claude plugin version bump when plugin files change.

Acceptance validation is already fail-closed: `unknown` verdicts make `acceptance_validation:complete.passed` false unless waivers exist. The client owns event summary text in `packages/client/src/event-registry.ts`; the engine owns terminal failure tracking in `packages/engine/src/terminal-failure.ts`; recovery sidecar key evidence is assembled in `packages/engine/src/recovery/sidecar-payload.ts`. This plan changes wording and operator diagnostics only. It does not change the `acceptance_validation:complete` schema, PRD validator JSON schema, event types, or acceptance gate semantics.

`packages/client/src/event-registry.ts` is an oversized legacy file with a no-growth ceiling. Use bounded exact edits and keep added lines small enough for `pnpm maintainability:check` to pass.

## Implementation

### Overview

Add semantic acceptance-criteria set review guidance to both planning skills, then make failed acceptance validation summaries distinguish concrete failed criteria from inconclusive/unknown verdicts. Keep all gates fail-closed and preserve existing wire shapes.

### Key Decisions

1. Treat over-granularity as planner guidance, not a deterministic enqueue gate. Existing analyzers catch mechanical defects (`grouping-label`, `bare-command`, `manual-only`, `vague`); this slice adds semantic review instructions without adding brittle heuristics.
2. Base all downstream diagnostic wording on the existing verdict array. Count `pass`, `fail`, and `unknown`; use concrete failure wording when `fail > 0`, and inconclusive wording when `fail === 0 && unknown > 0`.
3. Keep the client helper local in `packages/client/src/event-registry.ts` because the client package cannot import engine validation helpers.
4. Add recovery sidecar key evidence that names the all-unknown/no-concrete-failure case and points operators at validator output/context inspection or acceptance-criteria clarification.
5. Bump `eforge-plugin/.claude-plugin/plugin.json` patch version. Leave `packages/pi-eforge/package.json` unchanged.

## Scope

### In Scope

- Update both `/eforge:plan` skill files with a semantic-level review pass for the whole acceptance criteria set.
- Tell planners to detect over-granular field-by-field duplication and consolidate related contract-shape obligations.
- Tell planners to preserve distinct behavior-level criteria when fields represent different observable behaviors, validation rules, or failure modes.
- Update client event summary wording for failed `acceptance_validation:complete` events.
- Update engine terminal failure messages for failed acceptance validation events.
- Update recovery sidecar key evidence for zero-fail/all-unknown acceptance validation.
- Add focused tests for skill guidance, event summaries, terminal failure messages, and sidecar key evidence.
- Preserve existing mechanical acceptance criteria diagnostics.
- Preserve fail-closed `unknown` verdict behavior.
- Preserve existing wire schemas and event variants.

### Out of Scope

- Add a hard semantic over-granularity analyzer.
- Make unknown-only acceptance validation pass automatically.
- Add a new acceptance event type or required field.
- Change the PRD validator agent JSON output schema.
- Change acceptance unknown resolver behavior.
- Implement a manual verification hold workflow.
- Change `packages/pi-eforge/package.json`.

## Files

### Create

None.

### Modify

- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — Add an acceptance criteria set review subsection near the existing acceptance criteria guidance or readiness step. Include the exact concepts `semantic-level review`, `over-granular field-by-field duplication`, and `contract-vs-behavior consolidation`.
- `eforge-plugin/skills/plan/plan.md` — Add matching guidance so skill parity passes after normalization.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump the patch version because the plugin skill changes.
- `packages/client/src/event-registry.ts` — Update the `acceptance_validation:complete` summary callback to count fail and unknown verdicts separately. For all-unknown failures, return inconclusive wording and avoid the phrase `not passed`.
- `packages/engine/src/terminal-failure.ts` — Add verdict-aware acceptance terminal failure messages. Unknown-only failures include `inconclusive`; failures with `fail` verdicts include a concrete failed criterion preview and the fail count.
- `packages/engine/src/recovery/sidecar-payload.ts` — Add key evidence for zero-fail/all-unknown acceptance validation that says the validation is inconclusive, no concrete failed criteria were produced, and operators can inspect validator output/context or clarify criteria.
- `test/skills-docs-wiring.test.ts` — Add a focused test that both planning skills mention semantic-level review, over-granular field-by-field duplication, and contract-vs-behavior consolidation.
- `packages/client/src/__tests__/events-schemas-validation-recovery.test.ts` — Extend summary tests for all-unknown and mixed fail+unknown acceptance events. Keep schema tests proving no new fields are required.
- `test/recovery-terminal-failure.test.ts` — Add focused tracker tests for all-unknown inconclusive terminal messages and concrete failed-criterion terminal messages.
- `test/recovery-sidecars.test.ts` — Add a JSON sidecar assertion that `report.keyEvidence` contains the inconclusive all-unknown diagnostic and the no-concrete-failed-criteria statement.

## Implementation Notes

- In both skill files, place the semantic guidance where agents see it before marking a session ready. Suggested text shape:
  - Review the whole acceptance criteria set, not only individual bullets.
  - Run a `semantic-level review` for `over-granular field-by-field duplication`.
  - Use `contract-vs-behavior consolidation`: collapse related contract-shape field requirements into one objectively testable contract criterion, while keeping distinct behavior-level obligations as separate criteria.
  - Keep criteria flat, atomic, objective, and automatable.
- In `packages/client/src/event-registry.ts`, keep the helper small. A local count helper or a short `reduce` inside the summary callback is enough.
- Suggested client summary behavior:
  - Passed: retain `Acceptance validation passed: N criterion/criteria verified`.
  - `fail > 0 && unknown > 0`: `Acceptance validation failed: F criterion/criteria failed, U unknown` plus the existing conflict suffix.
  - `fail > 0 && unknown === 0`: `Acceptance validation failed: F criterion/criteria failed` plus suffix.
  - `fail === 0 && unknown > 0`: `Acceptance validation inconclusive: U criterion/criteria unknown` plus suffix; if every verdict is unknown, append `; no criterion was verified`.
- In `packages/engine/src/terminal-failure.ts`, include only bounded failed criterion text in terminal messages. A first-three preview with an omitted count suffix is enough.
- In `packages/engine/src/recovery/sidecar-payload.ts`, append the all-unknown diagnostic after the existing acceptance distribution line so the sidecar retains pass/fail/unknown counts.

## Verification

- [ ] Both planning skills contain `semantic-level review`, `over-granular field-by-field duplication`, and `contract-vs-behavior consolidation`.
- [ ] `node scripts/check-skill-parity.mjs` exits 0.
- [ ] Existing analyzer tests still cover `grouping-label`, `bare-command`, `manual-only`, and `vague` diagnostics.
- [ ] `safeParseEforgeEvent` accepts an `acceptance_validation:complete` event without new required fields.
- [ ] `safeParseEforgeEvent` rejects `acceptance_validation:complete` with `passed: false` and only `pass` verdicts.
- [ ] `getEventSummary` for an all-unknown failed `acceptance_validation:complete` event contains `inconclusive`.
- [ ] `getEventSummary` for an all-unknown failed `acceptance_validation:complete` event does not contain `not passed`.
- [ ] `getEventSummary` for a failed `acceptance_validation:complete` event with both `fail` and `unknown` verdicts reports the fail count and unknown count separately.
- [ ] `createBuildTerminalFailureTracker` emits a `build:terminal-failure` message containing `inconclusive` for a failed acceptance event with zero `fail` verdicts and at least one `unknown` verdict.
- [ ] `createBuildTerminalFailureTracker` emits a `build:terminal-failure` message containing a failed criterion preview when a failed acceptance event has at least one `fail` verdict.
- [ ] Recovery sidecar JSON `report.keyEvidence` for an all-unknown acceptance failure contains an inconclusive-validation diagnostic.
- [ ] Recovery sidecar JSON `report.keyEvidence` for an all-unknown acceptance failure contains `no concrete failed criteria were produced`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` patch version is higher than the pre-change version.
- [ ] `packages/pi-eforge/package.json` is unchanged.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
