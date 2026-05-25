---
id: plan-01-acceptance-evidence-model
name: Acceptance Evidence Inventory and Policy Foundation
branch: harden-build-validation-evidence-gates/plan-01-acceptance-evidence-model
agents:
  builder:
    effort: high
    rationale: Introduces shared validation models and config policy that downstream
      engine gates depend on.
  tester:
    effort: high
    rationale: Schema/config/extractor edge cases need focused coverage before
      engine integration.
---

# Acceptance Evidence Inventory and Policy Foundation

## Architecture Context

Build validation currently trusts the validator's verdict list as the complete source of acceptance evidence. This plan establishes deterministic expected-acceptance-criterion extraction and explicit waiver policy before engine gate behavior changes consume it. Keep the event wire shape stable unless the implementation proves UI consumers need new fields; prefer reusing existing `acceptance_validation:complete.verdicts` plus `waivers`.

## Implementation

### Overview

Create a small engine-owned acceptance criteria utility that can extract expected criteria from PRD/source markdown and plan-file bodies. Add validation waiver config for no acceptance source and intentional no committed changes. Update config schema, resolved defaults, tests, and docs-generator inputs. Do not alter final gate behavior in this plan beyond adding reusable helpers and tests.

### Key Decisions

1. Use deterministic IDs derived from order plus normalized text, e.g. `ac-001`, `ac-002`, and preserve normalized text for matching.
2. Normalize matching text by trimming, collapsing whitespace, and stripping common list markers (`-`, `*`, ordered numbers, checkbox markers) so bullet style changes do not change criterion identity.
3. Represent policy overrides with explicit config booleans and non-empty reason strings; do not synthesize pass evidence in this plan.
4. Keep the event schema unchanged unless a builder demonstrates that rendering cannot derive summaries from `verdicts` and `waivers`.

## Scope

### In Scope

- Add an `ExpectedAcceptanceCriterion` model and extraction/matching helpers.
- Extract criteria from Markdown headings named `Acceptance Criteria`, `Acceptance criteria`, or `ACs`, stopping at the next heading of the same or higher depth.
- Extract fallback expected criteria from plan-file `## Verification` / `## Scope` sections only when no explicit acceptance criteria section exists, using checklist/bullet lines as candidate criteria.
- Add config fields:
  - `build.validation.allowNoAcceptanceCriteria`
  - `build.validation.noAcceptanceCriteriaReason`
  - `build.validation.allowNoCommittedChanges`
  - `build.validation.noCommittedChangesReason`
- Add resolved defaults and config validation for non-empty reasons.
- Add focused tests for extractor normalization, multi-criteria extraction, blank/placeholder criteria rejection, config defaults, and config reason validation.

### Out of Scope

- Running the PRD validator against the new inventory.
- Failing builds when inventory is missing.
- Reviewer XML parser changes.
- CLI or monitor rendering changes.

## Files

### Create

- `packages/engine/src/validation/acceptance-criteria.ts` — expected criterion model, markdown extraction, plan-file aggregation, verdict matching, and missing-verdict synthesis helpers.
- `test/acceptance-criteria-extractor.test.ts` — extraction and normalization coverage.

### Modify

- `packages/engine/src/config.ts` — add waiver config fields, resolved defaults, validation refinements, and exported `ValidationConfig` fields.
- `test/config.test.ts` — add tests for new waiver defaults and required reason validation.
- `packages/engine/src/events.ts` — re-export any engine-only helper types only if needed by existing imports; do not define wire event shapes here.
- `packages/client/src/events.schemas.ts` — modify only if the implementation needs optional machine-readable acceptance inventory fields; if changed, update event validators in the same plan.
- `packages/client/src/event-registry.ts` — update only if event schema fields change.
- `packages/client/src/__tests__/events-schemas.test.ts` — update only if event schema fields change.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — update only if event schema fields change.
- `packages/client/src/api-version.ts` — bump only if event wire schema changes.

## Verification

- [ ] `extractExpectedAcceptanceCriteria()` returns two criteria with IDs `ac-001` and `ac-002` for a PRD containing two bullet items under `## Acceptance Criteria`.
- [ ] Normalized matching treats `- Add login`, `1. Add login`, and `[ ] Add login` as the same criterion text.
- [ ] Blank, `TBD`, `N/A`, and `none` lines do not create expected criteria.
- [ ] Config parsing rejects `allowNoAcceptanceCriteria: true` without a non-empty `noAcceptanceCriteriaReason`.
- [ ] Config parsing rejects `allowNoCommittedChanges: true` without a non-empty `noCommittedChangesReason`.
- [ ] Config defaults set both new waiver booleans to `false`.