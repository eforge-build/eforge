---
id: plan-05-recommendation-actionability-workstation
name: Workstation Recommendation Actionability Rendering
branch: clean-up-the-eforge-plan-workstation/plan-05-recommendation-actionability-workstation
agents:
  builder:
    effort: high
    rationale: The UI must consume a new server projection while preserving existing
      recommendation selection and planning workflows.
  reviewer:
    effort: high
    rationale: Plan CTA suppression and mixed-lane behavior are user-facing and need
      close review against duplicate-work risks.
---

# Workstation Recommendation Actionability Rendering

## Architecture Context

The workstation must render extension-owned actionability; it must not infer lifecycle state from stale browser data. `get-recommendations` becomes the authoritative source for recommendation entry actionability, while `start-planning-agent-task` remains the direct-call safety net.

## Implementation

### Overview

Thread the server-provided recommendation actionability projection through workstation data state and render it in the Recommendations rail. Show planning controls only for actionable entries or actionable subsets. Render non-actionable entries as read-only rows with reason text and associated links when available.

### Key Decisions

1. Do not recompute actionability in React; only match server projection entries by recommendation ref or item id.
2. For safe-parallel groups with mixed actionability, call `selection.planLane()` with the server-reported `actionableItemIds` only and render suppressed item ids with reasons/links.
3. For fully non-actionable groups, omit the Plan CTA and show a read-only suppression row.
4. Keep direct-call duplicate guards from plan 04 as the fail-closed layer for stale UIs or external action invocation.

## Scope

### In Scope

- Add workstation TypeScript types for recommendation actionability projection.
- Store and pass `recommendationActionability` from `useWorkstationData()` to `RecommendationsRail`.
- Update `RecommendationsRail` to suppress or de-action non-actionable Next up entries and Safe in parallel groups.
- Render suppression reason text and associated links for displayed suppressed entries.
- Ensure Plan CTAs never render for non-actionable entries.
- Update mock bridge/fixtures and UI tests.
- Update workstation README if behavior text references recommendation planning controls.

### Out of Scope

- Replacing recommendation generation.
- Replacing the backlog board selection model.
- Adding engine or daemon scheduling behavior.
- Redesigning the full Recommendations rail layout beyond actionability rendering.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx` — component tests for Plan CTA suppression, reason rendering, link rendering, and mixed-lane actionable subset planning.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add actionability projection/link/reason types and include them in `GetRecommendationsResponse`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — store `recommendationActionability` from `get-recommendations` and expose it in `WorkstationDataState`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — assert the projection is loaded and retained.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/workstation-view.tsx` — pass actionability into the rail.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx` — render actionable entries, suppressed entries, reason text, and links from server projection.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add representative actionability metadata to mock recommendation responses.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` and `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.test.ts` — keep mock `get-recommendations` output aligned with the new additive field.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.test.tsx` — update any startup mock response assumptions.
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — document that the rail renders server-derived actionability and direct action calls are guarded server-side.

## Verification

- [ ] Non-actionable Next up entries render as read-only suppression rows with a reason and no selection button.
- [ ] Fully non-actionable Safe in parallel groups render no Plan CTA.
- [ ] Suppressed entries display associated session/task/trace/PR links when the server projection includes links.
- [ ] Mixed Safe in parallel groups render a Plan CTA only for `actionableItemIds`; the click invokes `selection.planLane(actionableItemIds, group.ref)`.
- [ ] UI tests prove the rail hides Plan for non-actionable entries and renders suppression reasons.
- [ ] The workstation does not infer recommendation actionability from board item lifecycle fields when `recommendationActionability` is absent; it falls back to current legacy rendering only for backward-compatible responses.
