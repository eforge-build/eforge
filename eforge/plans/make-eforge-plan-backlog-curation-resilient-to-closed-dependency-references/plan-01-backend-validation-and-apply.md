---
id: plan-01-backend-validation-and-apply
name: Backend Dependency Projection and Curation Apply Validation
branch: make-eforge-plan-backlog-curation-resilient-to-closed-dependency-references/plan-01-backend-validation-and-apply
agents:
  builder:
    effort: high
    rationale: This plan changes shared recommendation validation, curation apply
      transaction ordering, action schemas, and preview projections across
      several extension backend files.
  reviewer:
    effort: high
    rationale: Default fail-closed behavior and public extension action contracts
      need careful review.
---

# Backend Dependency Projection and Curation Apply Validation

## Architecture Context

`eforge-plan` keeps backlog curation as an extension-owned workflow. The daemon owns planning task execution, while the extension owns source projection, safe curation application, recommendation storage, workflow indexing, and action schemas. Recommendation model integrity is enforced before writes; this plan preserves that fail-closed default and adds an explicit curation-only escape hatch for invalid generated recommendations.

## Implementation

### Overview

Add explicit dependency state to backlog curation sources, add prompt guidance for recommendation target ids, replace string-only recommendation reference validation with structured validation details, and extend curation apply so users can explicitly apply a valid curation draft while discarding generated recommendations that reference closed or missing targets.

### Key Decisions

1. Keep the existing `dependencyProjection()` shape for current callers such as promotion copy, and add a richer dependency-state projection for curation/recommendation generation contexts.
2. Validate recommendation references against open item/epic ids by default. Closed records remain available as historical context but are not valid active recommendation targets.
3. Perform generated-recommendation validation before any curation or recommendation storage writes. Only `applyBacklogCurationDraft.applyCurationOnly: true` allows curation writes to continue when generated recommendations are invalid.
4. When curation-only apply skips generated recommendations, mark existing recommendations stale if the curation changes the recommendation source fingerprint; do not write partial or invalid recommendation models.

## Scope

### In Scope

- Explicit open, closed/satisfied, and missing dependency projection for `buildBacklogCurationSource()`.
- Prompt guidance for open recommendation targets and closed dependency semantics.
- Structured recommendation reference validation issues with stable `path`, `id`, `kind`, `reason`, and optional `status`/`title` fields.
- Default fail-closed generated recommendation validation for backlog curation apply.
- `applyCurationOnly: true` curation-only apply mode for invalid or intentionally discarded generated recommendations.
- Preview validation details attached to listed completed backlog-curation planning tasks.
- Backend tests for source projection, recommendation validation, curation-only apply, and action schema/list output.

### Out of Scope

- Allowing closed/shipped/stale/superseded ids in active recommendation target fields.
- Automatically removing `depends_on` metadata outside an AI-authored curation patch.
- Engine kernel changes or daemon task execution changes.
- Workstation rendering changes; those are handled by the dependent UI plan.

## Files

### Create

- None expected. Prefer extending the existing focused extension files unless implementation size requires a small helper module.

### Modify

- `eforge/extensions/eforge-plan/backlog-domain.ts` — add exported dependency-state projection types/helpers that classify dependencies as open, closed/satisfied, or missing while keeping `dependencyProjection()` unchanged.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — emit `dependencyDetails` with `openDependsOn`, `closedDependsOn`, `missingDependsOn`, and conservative cleanup-candidate context; include title/status for known closed dependencies; keep raw `depends_on` only as metadata context.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — instruct agents that recommendation target fields may reference only open item/epic ids and that closed dependencies are satisfied historical context.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — add structured issue collection; make `validateRecommendationReferences()` validate against open records and classify closed versus unknown ids; keep throwing `ExtensionActionInputValidationError` with stable details.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — extract shared dry-run/preview preparation for curation drafts; validate generated recommendations against post-apply open ids before writes; implement `applyCurationOnly` skip behavior; return validation and skipped-recommendation details.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — add schemas/types for recommendation reference validation issues/results, curation preview details, and skipped recommendation reporting in apply details.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — extend `applyBacklogCurationDraft` input with `applyCurationOnly?: true`; extend apply/list outputs with the new validation/preview detail schemas.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — attach backlog-curation preview validation details in `list-planning-agent-tasks` for completed curation tasks; ensure one malformed completed curation task does not fail the entire list response.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — preserve `applied.recommendations` as `false` when curation-only apply skips generated recommendations and pass through the new apply details.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — assert open, shipped, and missing dependencies are projected into distinct fields.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — add default rejection and curation-only apply tests for generated `blockedChains[].blockedBy` references to shipped items.
- `eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts` — assert closed item/epic recommendation references are rejected before `current.json` changes.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — assert the new input schema flag is accepted, incompatible selections remain rejected, and list output carries structured curation preview validation for completed tasks.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action schema assertions if the new `applyCurationOnly` and preview detail fields affect serialized schema checks.

## Database Migration

Not applicable.

## Verification

- [ ] `buildBacklogCurationSource()` returns a fixture item with one open dependency in `dependencyDetails[].openDependsOn`, one shipped dependency in `dependencyDetails[].closedDependsOn` with status/title, and one absent dependency in `dependencyDetails[].missingDependsOn`.
- [ ] A generated recommendation with `blockedChains.closed-chain.blockedBy = ['closed-dep']` causes default `applyBacklogCurationDraftFromTask()` to throw `ExtensionActionInputValidationError` before curation writes and before `recommendations/current.json` exists.
- [ ] The same task with `applyBacklogCurationDraft.applyCurationOnly: true` changes the target backlog record, leaves `recommendations/current.json` absent, and returns `recommendationsSkipped` with the invalid id and field path.
- [ ] `put-recommendations` or `applyPlannerResult()` rejects a shipped item id in recommendation target fields and preserves the previous `current.json` bytes.
- [ ] `list-planning-agent-tasks` returns structured preview validation details for a completed backlog-curation task whose generated recommendations reference a shipped item.
- [ ] The planning draft prompt text contains guidance that `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, `safeParallelizableGroups.epicIds`, `blockedChains.itemIds`, and `blockedChains.blockedBy` may reference only open targets.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
