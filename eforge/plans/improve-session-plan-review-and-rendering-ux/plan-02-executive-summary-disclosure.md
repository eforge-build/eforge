---
id: plan-02-executive-summary-disclosure
name: Executive Summary Persistence and Progressive Disclosure
branch: improve-session-plan-review-and-rendering-ux/plan-02-executive-summary-disclosure
agents:
  builder:
    effort: high
    rationale: This plan coordinates runtime draft application, prompt guidance,
      build-source behavior, and the plan-detail rendering order while keeping
      large files within maintainability ceilings.
---

# Executive Summary Persistence and Progressive Disclosure

## Architecture Context

Planning task results already include a top-level `summary`, but `applySessionPlanCreationDraft` persists only generated readiness sections. Session plans then lack a fast sign-off artifact, and the detail view leads with readiness before the plan substance. This plan stores the task summary as a canonical `## Executive Summary` section outside the readiness dimension set and renders it before readiness diagnostics.

## Implementation

### Overview

Carry the top-level planning task `summary` through creation-draft resolution and write it as an `executive-summary` section before generated readiness dimensions. Update the plan detail surface so the executive summary appears near the top, readiness follows, and detailed sections default collapsed while remaining editable and annotatable.

### Key Decisions

1. Store the executive summary as a plain `## Executive Summary` section by calling the existing session-plan section mutation path with dimension id `executive-summary`.
2. Do not include `executive-summary` in `validateSessionPlanCreationDraftReadiness`; validation remains limited to the selected readiness contract.
3. In `applySessionPlanCreationDraft`, write the executive summary before draft readiness sections so `sessionPlanToBuildSource` and `normalizeBuildSource` emit the summary before detailed dimensions without changing the oversized `packages/input/src/session-plan.ts` implementation.
4. Keep existing plans without an executive summary renderable by treating the summary section as optional.

## Scope

### In Scope

- Persist completed planning task `summary` into created session plans as `## Executive Summary`.
- Preserve readiness validation for required contract dimensions only.
- Ensure build-source normalization includes the summary before detailed sections for created plans.
- Render executive summary near the top of the main plan detail.
- Move readiness below the summary while keeping diagnostics visible.
- Collapse detailed sections by default and expose edit plus annotation target-selection controls after expansion.
- Update planner prompt/source guidance so top-level `summary` is framed as the executive summary for created session plans.
- Update relevant docs and tests.

### Out of Scope

- Mermaid rendering.
- Revision-session backend changes.
- Reordering arbitrary legacy session-plan bodies that already place Executive Summary elsewhere.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-summary.test.tsx` — Focused component tests for executive summary placement, missing-summary fallback, and collapsed detail sections.

### Modify

- `eforge/extensions/eforge-plan/planner-orchestration.ts` — Capture `rawResult.summary`, carry a trimmed executive summary through `ResolvedSessionPlanCreationDraft`, and write it before readiness sections in both new-plan and abandoned-plan replacement paths. Keep the file under 600 lines; extract a tiny helper file if added lines exceed the cap.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — Cover summary-to-executive-summary persistence, readiness dimensions staying limited to the selected contract, and normalized build-source ordering for applied creation drafts.
- `test/session-plan.test.ts` or `test/normalize-build-source.test.ts` — Add a build-source ordering assertion using a session plan body that contains `## Executive Summary` before readiness sections.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — State that top-level `summary` becomes the executive summary for session-plan creation drafts and must be useful for fast scope review.
- `test/prompts.test.ts` — Assert the rendered planning draft prompt contains executive-summary guidance.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — Render summary first, readiness second, and detailed sections collapsed by default; exclude `executive summary` from the detailed section list.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-annotatable-section.tsx` — Add collapsed/expanded rendering and section edit support if not handled by `PlanDetailCard`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/section-editor.tsx` — Reuse as needed for expanded detailed-section editing.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-actions.test.tsx` and `plan-detail-annotations.test.tsx` — Update assertions for summary-first ordering and collapsed sections.
- `eforge/extensions/eforge-plan/README.md` — Document that applying a ready creation draft persists the task summary as an Executive Summary section.
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — Document summary-first review and collapsed detail sections in the workstation.

## Verification

- [ ] Applying a completed planning task with `summary: "Drafted a plan."` writes `## Executive Summary` with that text to the created session-plan Markdown.
- [ ] Creation-draft readiness validation still rejects unknown section ids and does not require `executive-summary`.
- [ ] The persisted Markdown places `## Executive Summary` before `## Problem Statement`, `## Scope`, or other readiness sections.
- [ ] `sessionPlanToBuildSource` output contains `## Executive Summary` before detailed dimension headings, and normalized build-source output preserves that order for the created plan.
- [ ] Plan detail renders the executive summary above the readiness card.
- [ ] Plans without an executive summary render the readiness card and sections without throwing.
- [ ] Detailed sections render collapsed on first load.
- [ ] Expanding a detailed section reveals rendered Markdown, editable content controls, and annotation target-selection buttons.
- [ ] Prompt tests prove the planning draft prompt contains executive-summary guidance for session-plan creation drafts.
- [ ] README updates mention summary-first review without documenting new backend actions.