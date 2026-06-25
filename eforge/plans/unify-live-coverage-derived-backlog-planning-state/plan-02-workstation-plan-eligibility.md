---
id: plan-02-workstation-plan-eligibility
name: Workstation Uses Backend Plan Eligibility
branch: unify-live-coverage-derived-backlog-planning-state/plan-02-workstation-plan-eligibility
agents:
  builder:
    effort: medium
    rationale: Focused frontend/type update consuming backend projection fields
      across board filtering and selection paths.
  tester:
    effort: medium
    rationale: Workstation unit tests must cover backend-first eligibility behavior
      and fallback compatibility.
---

# Workstation Uses Backend Plan Eligibility

## Architecture Context

The backend plan in this set adds `planEligible` to compact board/search/detail projections. The workstation currently duplicates backend planning rules through hard-coded reason-code and lane checks, which can disagree with SQL-derived live coverage. This plan updates workstation types, adapters, filters, and selection logic to prefer backend eligibility when present and keep legacy fallback only for mock/older payloads without the field.

## Implementation

### Overview

Propagate `planEligible` from compact backend responses into `BoardItem`, then make ready filtering, ready counts, selection eligibility, and recommendation lane planning use that backend field. Keep existing local reason-code fallback for payloads where `planEligible` is absent so tests and older mock data still render.

### Key Decisions

1. `isPlanEligible(item)` first returns `item.planEligible` when it is a boolean; local lane/reason-code logic remains only as compatibility fallback.
2. Selection and recommendation lane planning continue to call `isPlanEligible`, so one backend-first rule covers board filters, ready stats, selected eligible ids, and one-click lane planning.
3. Mock compact data includes representative `planEligible` values so workstation tests prove the backend field takes precedence over legacy reason-code duplication.

## Scope

### In Scope

- Workstation TypeScript models for compact items and board items.
- Compact board adapter propagation of `planEligible` from list/search/detail responses.
- Board ready filtering and ready stats.
- Backlog selection and recommendation-lane planning eligibility.
- Workstation fixtures and tests covering backend field precedence.

### Out of Scope

- Backend coverage policy changes from plan 01.
- New UI surfaces beyond existing filters, selection, and recommendations rail behavior.
- Broad visual redesign.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add `planEligible?: boolean` and optional eligibility metadata to `CompactBoardItem`, `CompactItemDetail`, and `BoardItem`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.ts` — copy `planEligible` and eligibility metadata from compact summaries/details into board items during initial load, lane-page merge, and detail merge.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.ts` — make `isPlanEligible` backend-first; keep the existing reason-code fallback only when `planEligible` is absent.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.ts` — no independent rule additions; ensure maps/sets inherit backend-first `isPlanEligible` behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — populate `planEligible` in compact and board fixtures for open candidates, live coverage blockers, current result blockers, and legacy fallback cases.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.test.ts` — assert ready filter/stats use backend `planEligible` even when lane/reason codes would disagree, and assert fallback behavior only when the field is absent.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-backlog-selection.test.ts` — assert selected eligible ids and `planLane` use backend `planEligible`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.test.ts` — assert compact list/detail adapters preserve `planEligible` through initial hydration and detail merge.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx` — assert recommendation lane planning falls back to selection `planEligibleIds` only when backend actionability projection is absent, and backend actionability remains authoritative when present.

## Verification

- [ ] A board item with `planEligible: true` matches the ready filter even if legacy `reasonCodes` contain `planned-session-plan`.
- [ ] A board item with `planEligible: false` does not match the ready filter even if legacy lane/reason-code fallback would mark it eligible.
- [ ] A board item without `planEligible` uses the previous fallback rule.
- [ ] `stats(items).ready` counts items by backend `planEligible` when present.
- [ ] `useBacklogSelection` returns `selectedPlanEligibleIds` and `planEligibleIds` based on backend `planEligible` when present.
- [ ] Recommendation lane planning sends only ids whose board items carry `planEligible: true` when recommendation actionability is absent.
- [ ] Compact board hydration and compact item detail merge preserve `planEligible` from backend payloads.
