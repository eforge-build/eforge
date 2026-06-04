---
id: plan-01-acceptance-recovery-evidence
name: Enrich Acceptance Validation Recovery Evidence
branch: include-failed-acceptance-criteria-details-in-recovery-sidecars/plan-01-acceptance-recovery-evidence
---

# Enrich Acceptance Validation Recovery Evidence

## Architecture Context

Recovery summaries are assembled by `buildFailureSummary(...)`, which delegates monitor DB reconstruction to `synthesizeFromEvents(...)`. The modern authoritative path finds `build:terminal-failure` rows and returns `buildAuthoritativeFragment(...)` before the legacy acceptance-validation fallback can parse `acceptance_validation:complete` verdicts. The sidecar renderer already emits `## Acceptance Validation` when `summary.acceptanceValidation` exists, so the missing evidence belongs in recovery event-history synthesis plus a small markdown rendering enhancement.

Key constraints from the existing architecture:

- Event schemas and recovery summary types are owned by `@eforge-build/client`; do not change `acceptance_validation:complete` or sidecar JSON schemas for this bugfix.
- Recovery evidence remains engine-side. Do not move recovery analysis into Console, Pi, or plugin packages.
- Preserve legacy fallback behavior for non-authoritative event histories.
- Use `monitor.db` event ids to bound authoritative evidence lookup: the verdict source is the latest `acceptance_validation:complete` event in the same run at or before the authoritative `build:terminal-failure` event id.

## Implementation

### Overview

Add a shared acceptance-validation parsing/extraction path in `packages/engine/src/recovery/terminal-failure-history.ts`, call it from the authoritative branch in `packages/engine/src/recovery/event-history.ts`, and render deterministic next-step guidance in `packages/engine/src/recovery/sidecar.ts`.

### Key Decisions

1. **Use a shared parser with distinct caller policy.** Add a parser that returns either a populated `BuildFailureSummary['acceptanceValidation']` or a structured parse failure. The legacy fallback can keep its existing behavior by using successful parse results only; the authoritative path must convert missing/malformed lookup results into a schema-valid unknown placeholder verdict.
2. **Bound lookup by terminal event id.** Query `events` with `run_id = ?`, `type = 'acceptance_validation:complete'`, and `id <= terminal.id`, ordered by `id DESC LIMIT 1`. This prevents a later event between terminal failure and `phase:end` from overwriting the authoritative failure source.
3. **Keep placeholder evidence in the existing verdict shape.** Use one `unknown` verdict with a non-empty `criterion` and `evidence`. The evidence must name the run id, authoritative terminal event id, source event type/timestamp when present, the SQL/event window attempted, and a human inspection step.
4. **Add markdown-only next-step guidance.** Extend the Acceptance Validation markdown table with a `Next Step` column derived from each verdict. Do not add a typed JSON field.

## Scope

### In Scope

- Enrich authoritative `build:terminal-failure` summaries with `scope: 'acceptance-validation'` using adjacent `acceptance_validation:complete` verdict evidence.
- Preserve failed and unknown criterion strings and evidence from the source acceptance event.
- Preserve pass/fail/unknown/total counts, waivers, and acceptance conflicts from the source acceptance event.
- Emit a schema-valid placeholder `acceptanceValidation` summary when authoritative verdict extraction finds no readable source row.
- Include lookup-failure details in placeholder evidence.
- Render deterministic next-step guidance for non-pass acceptance verdicts in recovery sidecar markdown.
- Add targeted regression tests for authoritative enrichment, placeholder fallback, and sidecar guidance.

### Out of Scope

- Changing `acceptance_validation:complete` event schema or `BuildFailureSummary` JSON schema.
- Changing acceptance validation pass/fail semantics.
- Console, Pi, or Claude plugin changes.
- New recovery workflow actions.
- Database migrations.

## Files

### Create

None.

### Modify

- `packages/engine/src/recovery/terminal-failure-history.ts` — Add shared acceptance-validation payload parser, authoritative lookup helper, placeholder builder, and source event timestamp/id propagation in `AuthoritativeTerminalEvent`/`buildAuthoritativeFragment`.
- `packages/engine/src/recovery/event-history.ts` — Replace duplicated legacy acceptance parsing where practical with the shared parser, call authoritative acceptance extraction before `buildAuthoritativeFragment(...)`, and pass the resulting `acceptanceValidation` into the fragment.
- `packages/engine/src/recovery/sidecar.ts` — Add a deterministic next-step helper and include a `Next Step` column or equivalent non-pass guidance in the `## Acceptance Validation` section.
- `test/recovery-terminal-failure.test.ts` — Add authoritative acceptance-validation recovery tests covering preserved fail/unknown verdicts, counts/evidence, latest-before-terminal selection, and placeholder evidence when no readable source row exists.
- `test/recovery-sidecars.test.ts` — Add or update a sidecar markdown test asserting non-pass criteria, verdicts, evidence, and next-step guidance render in the Acceptance Validation section.
- `test/recovery-failure-summary.test.ts` — Keep the legacy fallback acceptance-validation expectations passing; only update this file if sharing the parser requires import/expectation adjustments without changing legacy counts.

## Implementation Details

### `terminal-failure-history.ts`

- Extend `AuthoritativeTerminalEvent` with optional `sourceEventId` and `sourceEventTimestamp` fields when available in the terminal failure payload.
- Update `findAuthoritativeTerminalEvent(...)` to parse `failure.sourceEventId` and `failure.sourceEventTimestamp` in addition to the existing `sourceEventType` and `acceptanceValidationPassed` fields.
- Add a parser, for example:
  - `parseAcceptanceValidationPayload(data: string): { ok: true; acceptanceValidation: NonNullable<BuildFailureSummary['acceptanceValidation']> } | { ok: false; reason: string }`
  - Filter verdict rows to schema-valid `criterion`, `verdict` (`pass`/`fail`/`unknown`), and `evidence` strings.
  - Count only parsed verdicts: `pass`, `fail`, and `unknown`.
  - Filter `waivers` to non-empty strings.
  - Filter `acceptanceConflicts` to the existing `AcceptanceCriteriaConflict` shape.
  - Return a parse failure for invalid JSON/object shape, `passed !== false` on the selected failure source, missing/non-array verdicts, or zero parsed verdicts.
- Add an authoritative helper, for example:
  - `extractAuthoritativeAcceptanceValidation(db, runId, terminal): NonNullable<BuildFailureSummary['acceptanceValidation']>`
  - Return parsed source evidence when the latest `acceptance_validation:complete` row at or before `terminal.id` parses.
  - Return a placeholder summary when the query finds no row or the parser reports a failure.
- Placeholder summary requirements:
  - `passed: false`, `total: 1`, `pass: 0`, `fail: 0`, `unknown: 1`.
  - Verdict: `{ criterion: 'Acceptance validation evidence lookup failed', verdict: 'unknown', evidence: '<details>' }`.
  - Evidence string must include `run_id=<runId>`, `build:terminal-failure event id=<terminal.id>`, `acceptance_validation:complete`, the `id <= <terminal.id>` lookup window, parse failure text if any, and a human inspection step for `monitor.db`.
- Update `buildAuthoritativeFragment(...)` to accept optional acceptance validation evidence, preferably through a final options object to avoid another long positional parameter:
  - `options?: { acceptanceValidation?: BuildFailureSummary['acceptanceValidation'] }`
  - Include `acceptanceValidation` in the returned fragment when supplied.
  - Include `sourceEventId`/`sourceEventTimestamp` in `terminalFailure` when present.

### `event-history.ts`

- In the authoritative branch, before calling `buildAuthoritativeFragment(...)`, compute:
  - `const acceptanceValidation = authTerminal.scope === 'acceptance-validation' ? extractAuthoritativeAcceptanceValidation(db, runId, authTerminal) : undefined;`
- Pass the value into `buildAuthoritativeFragment(...)`.
- Refactor the existing legacy fallback block to use `parseAcceptanceValidationPayload(...)` if this can be done without changing its observed output. If parser reuse would increase risk, keep legacy behavior and only share the lowest-risk validation/counting helpers.
- Preserve the PRD-validation precedence guard: a failed latest `prd_validation:complete` must still report PRD validation rather than acceptance validation.

### `sidecar.ts`

- Add a helper such as `acceptanceNextStep(verdict: AcceptanceCriterionVerdict): string`.
- Deterministic text examples:
  - `fail`: `Update the implementation or tests cited by the evidence, then rerun acceptance validation for this criterion.`
  - `unknown`: `Inspect the cited evidence manually; add deterministic proof or clarify/split the criterion before retrying.`
  - `pass`: empty string or `No action required.`
- Update the Acceptance Validation verdict table to include next-step text. Escape all markdown table cell content with the existing `escapeTableCell(...)`.

## Testing Plan

- Add an authoritative monitor DB fixture with:
  - `prd_validation:complete` passed with no gaps.
  - An older failed `acceptance_validation:complete` containing stale criteria.
  - A target failed `acceptance_validation:complete` containing at least one `fail` and one `unknown` verdict with distinct evidence strings.
  - An authoritative `build:terminal-failure` with `scope: 'acceptance-validation'`, `sourceEventType: 'acceptance_validation:complete'`, `sourceEventTimestamp`, and `acceptanceValidationPassed: false`.
  - A later `acceptance_validation:complete` after the terminal event but before `phase:end` containing a different criterion.
- Assert `buildFailureSummary(...)` selects the target event at or before the terminal id, not the later event.
- Assert failed and unknown criterion/evidence strings survive in `summary.acceptanceValidation.verdicts`.
- Assert `total`, `pass`, `fail`, and `unknown` counts match the selected source event.
- Add a placeholder fixture with an authoritative acceptance-validation terminal event and no source row that parses as an acceptance-validation payload at or before the terminal id.
- Assert the placeholder verdict is `unknown`, schema-valid, and its evidence names the run id, terminal event id, `acceptance_validation:complete`, and `id <= <terminal.id>` lookup window.
- Add a sidecar markdown test asserting the `## Acceptance Validation` section contains each non-pass criterion, verdict, evidence, and deterministic next-step guidance.

## Verification

- [ ] `pnpm exec vitest run test/recovery-terminal-failure.test.ts test/recovery-sidecars.test.ts test/recovery-failure-summary.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] Authoritative acceptance-validation summary contains the target failed criterion string from the source `acceptance_validation:complete` event.
- [ ] Authoritative acceptance-validation summary contains the target unknown criterion string from the source `acceptance_validation:complete` event.
- [ ] Authoritative acceptance-validation summary contains the target failed evidence text from the source `acceptance_validation:complete` event.
- [ ] Authoritative acceptance-validation summary contains the target unknown evidence text from the source `acceptance_validation:complete` event.
- [ ] Authoritative acceptance-validation summary reports `total`, `pass`, `fail`, and `unknown` counts from the selected source event.
- [ ] Placeholder summary contains one `unknown` verdict when no source row exists or the selected source row cannot be parsed as an acceptance-validation payload.
- [ ] Placeholder evidence contains the run id, terminal event id, `acceptance_validation:complete`, and the bounded lookup window.
- [ ] Recovery markdown contains the Acceptance Validation section, each non-pass evidence text, and next-step guidance for fail and unknown verdicts.
