---
id: plan-01-authoritative-acceptance-recovery
name: Preserve Authoritative Acceptance Validation Recovery Evidence
branch: preserve-authoritative-acceptance-validation-details-in-recovery-sidecars/plan-01-authoritative-acceptance-recovery
---

# Preserve Authoritative Acceptance Validation Recovery Evidence

## Architecture Context

Recovery sidecars are synthesized from monitor DB events in `packages/engine/src/recovery/event-history.ts`. Authoritative terminal failures come from `build:terminal-failure` events via `findAuthoritativeTerminalEvent()` and are converted to `BuildFailureSummary` fragments by helpers in `packages/engine/src/recovery/terminal-failure-history.ts`.

The current bug is inside the authoritative branch of `synthesizeFromEvents()`: after an authoritative `build:terminal-failure` scoped to `acceptance-validation` is found, a failed `prd_validation:complete` event can still trigger an early partial PRD-validation return. That return bypasses `extractAuthoritativeAcceptanceValidation()` and drops failed acceptance verdicts and conflicts.

## Implementation

### Overview

Remove the PRD-validation early return from the authoritative terminal-failure branch. Once `findAuthoritativeTerminalEvent()` returns an event with `authoritative: true`, that event is the terminal source for the authoritative path. The legacy no-authoritative fallback below must continue to prefer PRD-validation failures over acceptance-validation inference.

### Key Decisions

1. Treat `build:terminal-failure` with `authoritative: true` as the source of truth in the authoritative branch, including when `scope === 'acceptance-validation'` and PRD validation also failed.
2. Keep the no-authoritative legacy fallback PRD-validation preference unchanged, because existing runs may contain acceptance-validation events emitted after unresolved PRD gaps.
3. Do not change acceptance-validation parsing or event schemas; the existing `extractAuthoritativeAcceptanceValidation()` and `buildAuthoritativeFragment()` helpers already preserve verdicts, waivers, and conflicts when reached.

### Implementation Steps

1. In `packages/engine/src/recovery/event-history.ts`, locate the `if (authTerminal) { ... }` branch after `findAuthoritativeTerminalEvent(db, runId, failedPhaseRow.id)`.
2. Delete the nested block that checks `authTerminal.scope === 'acceptance-validation'`, queries the latest `prd_validation:complete`, and returns a partial PRD-validation summary.
   - Delete the obsolete block rather than adding code around it; this file is near the 600-line implementation-file threshold.
3. Add a concise comment at the start of the authoritative branch stating that authoritative terminal events take precedence there, and that the PRD-validation preference applies only in the no-authoritative legacy fallback path below.
4. Leave the existing call path intact so acceptance-validation authoritative events reach:
   - `reconstructPlanMaps()`
   - `extractValidationCommands()`
   - `extractLandingInfo()`
   - `extractPlanErrorMap()`
   - `extractAuthoritativeAcceptanceValidation(db, runId, authTerminal)`
   - `buildAuthoritativeFragment(..., acceptanceValidation !== undefined ? { acceptanceValidation } : {})`
5. Do not edit generated `dist/` artifacts.

## Scope

### In Scope

- Fix `synthesizeFromEvents()` authoritative acceptance-validation precedence.
- Preserve acceptance-validation details from authoritative `acceptance_validation:complete` source events.
- Add a regression test for failed PRD validation coexisting with authoritative acceptance-validation terminal failure.
- Keep existing no-authoritative legacy fallback behavior and tests passing.

### Out of Scope

- Event schema changes.
- Changes to `extractAuthoritativeAcceptanceValidation()` parsing semantics.
- Recovery analyst prompt changes.
- Recovery sidecar rendering changes.
- Legacy fallback behavior changes for runs without authoritative `build:terminal-failure` evidence.

## Files

### Create

- None.

### Modify

- `packages/engine/src/recovery/event-history.ts` — remove the authoritative-branch partial PRD-validation early return and add the precedence comment.
- `test/recovery-terminal-failure.test.ts` — add a regression test near the existing authoritative acceptance-validation tests.

## Regression Test Requirements

Add a test in `test/recovery-terminal-failure.test.ts` that seeds one run with these events, in order:

1. `prd_validation:complete` with `passed: false` and at least one gap.
2. `acceptance_validation:complete` with `passed: false`, at least one `verdict: 'fail'`, and at least one valid `acceptanceConflicts` entry.
3. `build:terminal-failure` with `failure.scope: 'acceptance-validation'`, `failure.authoritative: true`, and `failure.sourceEventType: 'acceptance_validation:complete'`.
4. Failed `phase:end`.

Use `synthesizeFromEvents()` or `buildFailureSummary()` and assert all of the following:

- `terminalFailure.scope` is `'acceptance-validation'`.
- `terminalFailure.authoritative` is `true`.
- `terminalFailure.sourceEventType` is `'acceptance_validation:complete'`.
- `partial` is `undefined`.
- `acceptanceValidation.passed` is `false`.
- `acceptanceValidation.verdicts` contains the failed verdict seeded in the acceptance event.
- `acceptanceValidation.conflicts` contains the conflict seeded in the acceptance event.
- `failingPlan.planId` is not `'prd-validation'`.

Keep the existing legacy/no-authoritative tests intact, including the test that reports PRD validation when the latest `prd_validation:complete` failed without an authoritative terminal event.

## Database Migration

None.

## Verification

- [ ] `pnpm test -- test/recovery-terminal-failure.test.ts test/recovery-failure-summary.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] The new regression test fails against the pre-change early-return behavior by observing PRD-validation partial output, then passes after the authoritative-branch early return is removed.
- [ ] `packages/engine/src/recovery/event-history.ts` does not grow past 600 lines.