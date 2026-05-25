---
id: plan-04-rendering-and-docs
name: Validation Rendering and Documentation Sync
branch: harden-build-validation-evidence-gates/plan-04-rendering-and-docs
agents:
  builder:
    effort: medium
    rationale: UI and docs updates depend on settled event/config behavior from
      previous plans.
  doc-syncer:
    effort: high
    rationale: Behavioral docs and generated reference artifacts must stay aligned
      with new validation policy.
  tester:
    effort: medium
    rationale: Rendering tests need focused assertions for failed gap close and
      acceptance summaries.
---

# Validation Rendering and Documentation Sync

## Architecture Context

Engine failures can still look successful when CLI or monitor timeline renders terminal validation events without inspecting verdict fields. Documentation already claims stronger validation behavior, and new waiver/config semantics from earlier plans must be reflected in user-facing docs and generated reference artifacts.

## Implementation

### Overview

Update CLI and monitor timeline rendering so failed gap close and acceptance validation outcomes are distinct. Sync README/config/architecture docs with the implemented policy and regenerate reference artifacts when config or event schemas change.

### Key Decisions

1. `gap_close:complete passed:false` renders as failure in both CLI and monitor UI.
2. Acceptance validation rendering summarizes pass/fail/unknown counts and lists waiver reasons.
3. Monitor classification must not rely only on `type.endsWith(':complete')` for verdict-bearing complete events.
4. Documentation describes waivers as policy overrides, not evidence.

## Scope

### In Scope

- CLI rendering for `gap_close:complete passed:false` and `acceptance_validation:complete`.
- Monitor timeline classification, summary, and detail rendering for failed gap-close and acceptance validation events.
- Tests or pure rendering assertions for CLI display helpers if present and monitor `event-card` logic.
- README and docs updates for expected AC inventory, no-PRD/no-AC policy, waiver reasons, and committed-work/no-op semantics.
- Regenerate generated reference docs/schemas if config or event schemas changed in earlier plans.

### Out of Scope

- New dashboard views beyond the existing timeline cards.
- A waiver approval UI.
- Changing event names.

## Files

### Modify

- `packages/eforge/src/cli/display.ts` — branch on `event.passed` for gap close and add acceptance validation rendering.
- `packages/monitor-ui/src/components/timeline/event-card.tsx` — classify verdict-bearing completion events by their fields and render acceptance summaries/details.
- `packages/monitor-ui/src/components/timeline/__tests__/event-card.test.tsx` — add pure tests or component tests for failed gap close and acceptance summaries.
- `packages/monitor-ui/test/pure-reducer-acceptance.test.ts` — update only if reducer expectations need acceptance event detail assertions.
- `README.md` — describe deterministic acceptance inventory and explicit waivers for no-AC/no-PRD or no-op builds.
- `docs/architecture.md` — document expected-criterion cross-checking, no-validator policy, gap-close rerun ordering, and committed-work/no-op enforcement.
- `docs/config.md` — document new validation waiver fields and required reason strings.
- `web/content/reference/**` — regenerate when docs generator output changes.
- `web/public/reference/**` — regenerate when docs generator output changes.
- `web/public/schemas/**` — regenerate when schemas change.

## Verification

- [ ] CLI display renders `gap_close:complete` with `passed:false` using the failure path and text containing `Gap closing failed`.
- [ ] CLI display renders `acceptance_validation:complete` with counts for pass, fail, and unknown verdicts.
- [ ] Monitor timeline classifies `gap_close:complete passed:false` as failed.
- [ ] Monitor timeline summary for `acceptance_validation:complete` includes pass/fail/unknown counts.
- [ ] Monitor timeline detail for waived acceptance validation includes every waiver reason string.
- [ ] `docs/config.md` lists each new waiver boolean and its required reason field.
- [ ] Generated reference artifacts have no drift after `pnpm docs:generate` when schema/config docs are affected.