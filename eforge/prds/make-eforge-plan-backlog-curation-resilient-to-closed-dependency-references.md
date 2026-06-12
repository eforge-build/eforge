---
title: Make eforge-plan Backlog Curation Resilient to Closed Dependency References
created: 2026-06-12
---

# Make eforge-plan Backlog Curation Resilient to Closed Dependency References

## Problem / Motivation

Backlog curation apply can fail with errors like:

```text
Recommendation blockedChains.<ref>.blockedBy references unknown item id "backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis".
```

The referenced record exists, but it is `status: shipped` in:

```text
.eforge/storage/extensions/eforge-plan/backlog/items/backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis.md
```

This affects users who run **Analyze all backlog** / backlog curation from the eforge-plan workstation and then confirm the generated analysis. The AI task can complete successfully and render a preview, but final confirmation rejects the entire apply because generated recommendations include a closed dependency id in `blockedChains.blockedBy`.

This is a deterministic contract mismatch, not random daemon flakiness:

- `buildBacklogCurationSource()` filters source records to open items/epics only, but each open item still carries raw `depends_on` metadata.
- `dependencyProjection()` classifies dependencies not present in the selected open set as `externalDependsOn` without saying whether the dependency is closed/satisfied or truly missing.
- The AI can interpret an `externalDependsOn` id as still-blocking and emit it in `recommendations.blockedChains[].blockedBy`.
- `applyBacklogCurationDraftFromTask()` validates generated recommendations against post-apply open ids through `validateRecommendationReferencesAgainstIds()`.
- Closed/shipped ids are not valid recommendation targets, so apply fails before writing curation changes or recommendations.
- `BacklogCurationPreview` renders generated recommendation counts only and does not prevalidate recommendation references or show invalid ids before destructive confirmation.

Roadmap alignment: this fits Extension Platform and Console Observability goals by improving typed extension workflow reliability without expanding the engine kernel.

## Goal

Make backlog curation recommendation application resilient and understandable when AI output references closed dependencies. Preserve strict recommendation validation while allowing valid curation changes to be applied through an explicit curation-only path when generated recommendations are invalid.

## Approach

Implement the fix across source projection, prompt guidance, validation, apply behavior, schemas, workstation UI, tests, and documentation as needed.

Planned improvements:

1. Distinguish open blockers, closed/satisfied dependencies, and missing external dependencies in source projections.
2. Tighten curation/recommendation prompt guidance so recommendations only reference valid open recommendation targets.
3. Pre-validate generated recommendations before the destructive confirmation path and surface actionable preview errors.
4. Allow valid curation changes to be applied while invalid generated recommendations are skipped or discarded intentionally.
5. Optionally propose cleanup for stale closed dependencies instead of treating them as recommendation blockers.

Key design decisions:

- Preserve fail-closed recommendation validation as the default.
- Do not silently write invalid recommendation refs.
- Treat closed dependencies as satisfied historical context for recommendation generation.
- Do not allow closed/shipped/superseded dependencies in active `blockedBy` recommendation refs.
- Represent dependency state explicitly instead of overloading `externalDependsOn`.
- Distinguish at least `openDependsOn`, `closedDependsOn`, and `missingDependsOn`, or equivalent names.
- Include status/title for closed dependencies when available so the AI can explain cleanup safely.
- Add preview-time validation rather than relying only on final apply.
- Add an explicit curation-only fallback when the curation draft is valid but generated recommendations are invalid.
- Require an explicit UI/action input flag for curation-only apply.
- Mark recommendations stale or leave existing recommendation freshness unchanged according to whether curation changed the source.
- Prefer structured validation details over parsing error strings.
- Return field paths and ids so the workstation can render actionable messages and tests can assert stable structures.
- Keep automatic dependency cleanup conservative.
- Dependency cleanup may be AI-proposed as reviewed curation patches, but existing dependency metadata must not be removed deterministically outside the reviewed curation draft.

Primary implementation targets:

- `eforge/extensions/eforge-plan/backlog-domain.ts`
  - Extend dependency projection semantics or add a new curation/recommendation dependency projection.
  - Separate open blockers, closed/satisfied dependencies, and missing dependencies.
  - Preserve existing simple `dependencyProjection()` callers unless tests show they all benefit from the richer shape.

- `eforge/extensions/eforge-plan/backlog-curation-source.ts`
  - Include dependency status context for curation tasks.
  - Avoid treating shipped dependencies as active blockers.
  - Include explicit guidance fields for stale closed dependency cleanup candidates when open records still depend on shipped items.

- `packages/engine/src/prompts/eforge-plan-planning-draft.md`
  - Add backlog curation guidance that generated recommendations may only reference open item ids in `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups.itemIds`, and `blockedChains.itemIds/blockedBy`.
  - State that closed/shipped/superseded dependencies are satisfied historical context, not active `blockedBy` recommendation refs.

- `eforge/extensions/eforge-plan/backlog-curation-apply.ts`
  - Add an explicit apply mode for valid curation with generated recommendations skipped when references are invalid and the user has acknowledged the skip.
  - Keep default fail-closed behavior for unacknowledged invalid recommendations.
  - Return structured details for skipped/invalid recommendation apply attempts.

- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts`
  - Extend `applyBacklogCurationDraft` input/output schema with an explicit skip/discard invalid recommendations flag and structured validation preview result if needed.

- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts`
  - Extend `applyBacklogCurationDraft` input/output schema with an explicit skip/discard invalid recommendations flag and structured validation preview result if needed.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx`
  - Display generated recommendation validation warnings/errors before confirmation.
  - Disable normal confirm when generated recommendations are invalid.
  - Offer a clear “apply curation only / discard generated recommendations” path if the curation draft itself is valid.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
  - Add client-side types/projections for recommendation validation details.

- Related view-model files
  - Add client-side types/projections for recommendation validation details.

Testing targets:

- Extend `backlog-curation-apply.test.ts` for closed dependency recommendation refs and curation-only apply.
- Extend `recommendation-apply-validation.test.ts` if validation helper behavior or error details change.
- Add or extend workstation tests for preview messaging and confirmation button behavior.
- Add source-projection tests showing closed dependencies are represented as satisfied, missing deps as missing, and open deps as blockers.

Documentation targets:

- Update `eforge/extensions/eforge-plan/README.md` planning workstation/apply semantics if affected.
- Update `docs/extensions.md`, `web/content/docs/extensions.md`, and generated docs only if public extension action contract docs need regeneration or SDK-facing guidance changes.

Risks and mitigations:

- Weakening recommendation validation would hide data integrity problems; mitigate by keeping default fail-closed validation and adding only explicit, user-acknowledged curation-only apply.
- Adding dependency projection fields could drift from existing board/lane semantics; mitigate with tests for open, closed, and missing dependency cases and verify current lane behavior remains unchanged unless intentionally updated.
- Curation-only apply may surprise users if generated recommendations disappear; mitigate with clear UI copy and an apply result that reports recommendations were not applied.
- Automatically removing closed dependencies could be too aggressive if teams intentionally retain shipped dependency links as history; mitigate by making dependency cleanup AI-proposed as reviewed curation patches, not deterministic automatic mutation.
- Prompt-only fixes are insufficient because AI output can still be malformed; mitigate by pairing prompt guidance with source semantics, preview validation, and strict apply-side validation.

## Scope

In scope:

- Backlog curation source projection changes.
- Recommendation prompt guidance changes.
- Preview-time generated recommendation validation.
- Structured invalid recommendation reference details.
- Explicit curation-only apply when generated recommendations are invalid.
- Fail-closed default behavior for unacknowledged invalid recommendations.
- Workstation preview messaging and confirmation behavior.
- Source projection, apply validation, recommendation validation, and workstation tests.
- Documentation updates if public extension action contracts or SDK-facing guidance change.

Out of scope:

- Weakening recommendation validation by allowing closed or unknown ids as active recommendation targets.
- Silently writing invalid recommendation refs.
- Deterministically removing closed dependencies outside a reviewed curation draft.
- Expanding the engine kernel.
- Treating closed/shipped/superseded dependencies as active blockers.

## Acceptance Criteria

- `buildBacklogCurationSource()` projects open dependency references distinctly for open backlog items.
- `buildBacklogCurationSource()` projects closed/satisfied dependency references distinctly for open backlog items.
- `buildBacklogCurationSource()` projects missing dependency references distinctly for open backlog items.
- A source projection test verifies an open item depending on a shipped item does not expose that shipped dependency as an ambiguous active blocker.
- The backlog curation prompt instructs the agent that generated recommendation target fields may only reference open item ids.
- A backlog curation apply test verifies generated recommendations that reference a shipped dependency in `blockedChains[].blockedBy` are reported as invalid before recommendation storage is written.
- The workstation curation preview renders invalid generated recommendation references before the user confirms final apply.
- The workstation disables the normal “Confirm apply curation” path when generated recommendations are invalid and no explicit curation-only skip has been selected.
- `apply-planning-agent-task-result` supports an explicit curation-only apply selection that applies a valid backlog curation draft while discarding invalid generated recommendations.
- The curation-only apply result reports that curation changes were applied.
- The curation-only apply result reports that generated recommendations were not applied.
- Existing generated recommendation validation rejects unknown recommendation refs when no explicit curation-only skip is requested.
- Existing generated recommendation validation rejects closed recommendation refs when no explicit curation-only skip is requested.
- Existing tests covering stale curation preconditions pass without weakening fail-closed defaults.
- Existing tests covering unknown dependencies pass without weakening fail-closed defaults.
- Existing tests covering recommendation reference validation pass without weakening fail-closed defaults.
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Confirmed static reproduction from current project state:

1. Ensure an open backlog item depends on a closed/shipped item. Current evidence includes `migrate-eforge-plan-workstation-off-rich-list-board-initial-load`, which depends on shipped item `backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis`.
2. Start **Analyze all backlog** from the eforge-plan workstation. The action `analyze-all-backlog` builds an all-open-backlog curation source and starts an `eforge-plan.planning-draft` task requesting `backlogCurationDraft` plus `recommendations`.
3. Let the AI task complete with recommendations that place the shipped dependency id in `recommendations.blockedChains[].blockedBy`.
4. Review the preview and click **Confirm apply curation**.
5. Actual behavior: `apply-planning-agent-task-result` rejects with a recommendation reference error and no curation changes or recommendation writes are applied.
6. Expected behavior: the preview should identify invalid generated recommendation references before final confirmation, and the user should be able to either redraft or apply the valid curation draft while explicitly skipping invalid recommendations.

Existing durable evidence:

- `.eforge/storage/agent-tasks/task-ce76d746-53f8-44ba-9637-a8688d3dcac2.json` contains `blockedChains[].blockedBy` referencing `backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis`.
- `.eforge/storage/extensions/eforge-plan/backlog/items/backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis.md` has `status: shipped`.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` already verifies generated recommendations referencing records closed by the curation patch reject before writing, so the fail-closed behavior is intentional but currently poor UX for shipped dependencies emitted by the AI.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The screenshot error is caused by a generated recommendation referencing a closed/shipped item, not a missing file. | Read `.eforge/storage/extensions/eforge-plan/backlog/items/backlog-2026-06-12-dogfood-compact-eforge-plan-contribution-apis.md`; status is `shipped`. Read `.eforge/storage/agent-tasks/task-ce76d746-53f8-44ba-9637-a8688d3dcac2.json`; generated `blockedChains[].blockedBy` includes that id. | high | low | Add a regression test with a shipped dependency referenced from generated `blockedChains[].blockedBy`. | If wrong, the fix may address only one failure mode and not the observed toast. |
| Recommendation target refs should remain limited to open items for curation-generated recommendations. | `applyBacklogCurationDraftFromTask()` currently validates generated recommendations against post-apply open ids; tests already cover generated recommendations referencing closed records by curation patch. | high | low | Confirm desired UX with project owner if closed historical blockers should ever be renderable recommendation evidence. | If wrong, the data model may need a separate historical/satisfied blocker field instead of rejecting closed refs. |
| Users need a curation-only apply escape hatch when generated recommendations are invalid. | User reported frequent confirmation failures; current apply bundles curation draft and generated recommendations and rejects before writing either. | high | low | Implement explicit opt-in UI and tests; verify result copy is clear. | If wrong, users may prefer mandatory redraft over partial apply; curation-only path could add unnecessary UX surface. |
| Closed dependency cleanup should be reviewed, not automatic. | Backlog items can retain shipped dependencies as historical context; no code evidence showed deterministic cleanup currently exists. | medium | medium | Ask project owner whether shipped dependencies should remain in `depends_on` after completion. | If wrong, the implementation may miss an opportunity for simpler deterministic cleanup. |
| Preview-time validation can be implemented without starting a new daemon task. | Validation helpers already exist in extension code; apply already validates synchronously before writes. | medium | low | Reuse or extract validation helpers and call them from an action path or projected task preview. | If wrong, the UI may need a new action for dry-run validation, increasing scope slightly. |

Recommended profile: `excursion`.

Rationale: the change spans source projection, prompt guidance, apply validation, schemas, workstation UI, and tests, but it is a cohesive bugfix with clear dependency order. A single planner/build pass should be able to cover it without delegated module planning.