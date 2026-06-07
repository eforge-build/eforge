---
title: Add eforge-plan backlog workflow foundations
created: 2026-06-07
landing: pr
landing_auto_merge: true
---

# Add eforge-plan backlog workflow foundations

## Problem / Motivation

This plan combines three backlog items from the **Eforge-plan backlog workflow foundations** recommendation lane:

- `backlog-2026-06-05-add-backlog-item-to-session-plan-promotion-and-handoff-workf`
- `backlog-2026-06-05-maintain-recommended-backlog-implementation-order-and-next-w`
- `backlog-2026-06-05-add-extension-owned-ai-planning-chat-orchestration-capabilit`

The current `eforge-plan` MVP supports project-local `.backlog` storage, single-item `promote-item`, direct `eforge://input/eforge-plan/<itemId>`, lifecycle trace sidecars, and a proof-of-concept board workstation. Promotion currently accepts exactly one `itemId`, writes one session plan, stores `eforge_plan.source_item_id`, and marks the item active/planned.

Evidence gathered during planning:

- `.backlog/recommendations.json` recommends these items as a safe planning group and cautions that implementation order should keep backlog handoff before traceability/auto-mode behavior.
- `docs/roadmap.md` supports keeping the engine headless, placing richer workflow UX in extension surfaces, making Console the canonical local-first control surface, and continuing extension-platform expansion without moving input authoring into the kernel.
- `eforge/extensions/eforge-plan/README.md` documents the current MVP.
- `eforge/extensions/eforge-plan/index.ts` confirms the current registered actions are `list-board`, `render-board-markdown`, `capture-item`, `upsert-epic`, `update-item`, and `promote-item`; the current workstation only renders board Markdown through the action bridge.
- `eforge/extensions/eforge-plan/promote.ts` confirms current single-item promotion behavior.
- `docs/extensions.md` and `packages/extension-sdk/src/contributions.ts` confirm V1 extensions can register actions, input sources, Console contributions, and sandboxed workstations with `srcDoc` or `frameBundle`; extension-owned AI planning/chat runtime APIs remain explicitly deferred.
- `eforge_status` shows the Console Plans migration is currently running, so this plan should not depend on deprecated core Plans UI and should be compatible with the eforge-plan workstation direction.

Classification: **architecture / focused**. The work changes extension-owned data contracts, action contracts, and Console workstation workflow boundaries. It is cohesive enough for one plan, but it should be implemented in ordered slices rather than as unrelated parallel work.

## Goal

Build the foundation for eforge-plan backlog workflow recommendations, multi-item and epic-level promotion, and extension-owned AI planning orchestration. Keep generated build artifacts as ordinary session plans under `.eforge/session-plans/` so existing eforge build intake remains unchanged.

## Approach

Implement the work in this order:

1. Recommendation model support.
2. Multi-item and epic handoff.
3. AI-planning orchestration hooks that use the recommendation and handoff contracts.

Architecture impact:

- This change stays outside the engine kernel.
- This change primarily affects the project-team `eforge-plan` extension plus Console workstation integration.
- No direct engine API, queue schema, daemon route change, or `.backlog/recommendations.json` compatibility layer is expected.

Expected implementation targets:

- `eforge/extensions/eforge-plan/schema.ts`: add typed recommendation, selection, planning-context, and multi-source handoff schemas.
- `eforge/extensions/eforge-plan/backlog-domain.ts`: extend domain helpers for selected item groups, epic membership, source-reference summaries, and dependency/risk projection.
- `eforge/extensions/eforge-plan/recommendations-store.ts`: add a focused module for private recommendation persistence, validation, projection, and JSON-safe output under `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- `eforge/extensions/eforge-plan/promote.ts`: generalize synthesis helpers so single-item promotion and multi-source promotion share one source-of-truth body generator.
- `eforge/extensions/eforge-plan/promotion-selection.ts`: add a focused module for resolving `{ itemIds | epicId | recommendationRef }` into ordered source items and one handoff plan.
- `eforge/extensions/eforge-plan/planner-orchestration.ts`: add a focused module for producing planner context packets and applying structured planner results.
- `eforge/extensions/eforge-plan/index.ts`: register new actions and expose them to Console contributions/workstations without breaking existing action IDs.
- `eforge/extensions/eforge-plan/README.md`: document private recommendation support, multi-source promotion, planner orchestration boundaries, and Console-first usage.
- `eforge/extensions/eforge-plan/__tests__/`: add tests for private recommendation storage/projection, multi-source promotion, epic promotion, planner packet generation, and backward-compatible single-item promotion.

Data and contract impacts:

- The existing `promote-item` action remains backward compatible.
- A new multi-source promotion action should accept explicit item IDs, an epic ID, or a recommendation reference rather than overloading `promote-item` in a breaking way.
- Generated session plans should preserve source metadata using plural fields such as `eforge_plan.source_item_ids`, `eforge_plan.source_epic_ids`, and `eforge_plan.source_recommendation_ref`.
- Generated session plans should continue to support the existing singular `source_item_id` for single-item plans.
- Recommendation data is extension-owned private metadata resolved through `ctx.paths.extensionStoragePath('project-local', ['recommendations', 'current.json'])` or equivalent project-path helpers.
- Recommendation access is public through typed extension actions, Console contributions, and the eforge-plan workstation.
- The raw recommendation JSON file is not the public integration contract.
- Planner orchestration should exchange structured packets and results through extension actions, not through private Console imports or engine-side chat state.

Design decisions:

- Use a new multi-source promotion action, tentatively `promote-selection`, instead of changing the existing `promote-item` input contract.
- Make `.eforge/storage/extensions/eforge-plan/recommendations/current.json` the canonical recommendation store.
- Do not implement `.backlog/recommendations.json` import/export or migration behavior.
- Expose recommendation access only through typed extension actions, Console contributions, integration commands/deep links when useful, and the eforge-plan workstation.
- Keep recommendation maintenance extension-owned but AI-host-agnostic.
- Model AI planning/chat orchestration as structured actions first: one action prepares a planner context packet, and another action applies a structured planner result to recommendations or session-plan handoff.
- Generate one ordinary session plan for a selected group when the group is coherent and recommendation context says it is safe to plan together.
- Preserve implementation order inside the session plan body.
- Add plural source metadata while preserving singular metadata for backward compatibility with existing single-item promotion consumers.
- Recommend `excursion` by default for this grouped plan unless the generated selection contains independently planned subsystems that require delegated module planning.

Assumptions and validation context:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
| --- | --- | --- | --- | --- | --- |
| The three backlog items are suitable for one cohesive plan with ordered implementation slices. | `.backlog/recommendations.json` grouped them under “Eforge-plan backlog workflow foundations” and said they can be planned together as a cohesive workflow. This artifact is planning evidence only, not the target storage contract. | high | low | Re-read current extension-owned recommendations after the active Console Plans migration finishes. | The work may need to split into separate session plans. |
| The plan should avoid the deprecated core Console Plans surface. | `docs/roadmap.md` says richer workflow UX belongs in extension surfaces; recommendations say Console Plans migration is active; `eforge_status` confirmed a related build was running during planning. | high | medium | Inspect the landing result of the active Console Plans migration before enqueueing this plan. | UI targets may need to move to the new eforge-plan workstation files produced by that build. |
| Extension-private recommendation storage is the canonical target. | User confirmed this is greenfield and does not need `.backlog/recommendations.json` import/export compatibility; `docs/extensions-api.md` establishes `.eforge/storage/extensions/<extension-name>/...` as the extension-owned private metadata convention. | high | low | Add tests asserting the resolved path uses `ctx.paths.extensionStoragePath('project-local', ['recommendations', 'current.json'])`. | Recommendation data could be written to a public/backlog path instead of extension-owned storage. |
| Full general-purpose extension-owned AI chat runtime support is not required for this build. | `docs/extensions.md` and `eforge-plan/README.md` state extension-owned AI planning/chat runtime APIs are deferred; supported extension actions and workstations can carry structured planner packets today; user accepted the action/orchestration recommendation. | high | low | Keep the README and action names explicit about orchestration, not general chat runtime. | Scope expands significantly into platform/runtime design and may require a separate architecture plan. |
| Session plan frontmatter can safely include plural `eforge_plan` metadata. | Existing `promote.ts` already writes nested `eforge_plan` metadata into generated session plans. | high | low | Add parser/unit coverage for plural fields in generated session plans. | Generated plans might be accepted but metadata consumers could miss source references. |
| Existing extension actions are the right boundary for recommendation and handoff workflows. | `packages/extension-sdk/src/contributions.ts` defines typed actions, side effects, Console contributions, and workstations; current `index.ts` already registers action-backed Console surfaces. | high | low | Add tests around action registration and workstation allowed actions. | A daemon/client route might be needed if action output or timeout constraints are insufficient. |

Profile signal:

- Recommended profile: **excursion**.
- Rationale: this is cross-cutting across the `eforge-plan` extension, recommendation storage, session-plan synthesis, and workstation-facing actions, but the architecture is cohesive and can be planned as one ordered implementation sequence.
- This does not require delegated subsystem planning unless the user expands scope to a full general-purpose AI chat runtime.
- Current scope is cross-cutting but cohesive; eforge guidance says cross-cutting alone is not enough for `expedition`.

## Scope

In scope:

- Treat the three backlog items as one cohesive eforge-plan workstation foundation plan.
- Add extension-owned support for reading, validating, updating, and rendering a structured recommendation model with fields such as `activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroups`, `blockedChains`, and `rationaleAndAssumptions`.
- Store recommendations canonically as extension-private project-local data under `.eforge/storage/extensions/eforge-plan/recommendations/current.json` using the extension SDK path helpers.
- Add multi-item and epic-level promotion/handoff from backlog records into one implementation-ready session plan.
- Preserve source backlog item IDs, epic IDs, recommendation/lane context, dependencies, assumptions, acceptance criteria guidance, and profile recommendation during multi-item and epic-level promotion/handoff.
- Add Console/workstation-facing extension actions that prepare structured AI planning context.
- Add Console/workstation-facing extension actions that accept structured planner outputs for recommendation refreshes or session-plan synthesis.
- Update the eforge-plan workstation/contribution surfaces so users can see recommended next work.
- Update the eforge-plan workstation/contribution surfaces so users can select one item, multiple items, a safe-parallel group, or an epic.
- Update the eforge-plan workstation/contribution surfaces so users can invoke promotion through allowed extension actions.
- Keep generated build artifacts as ordinary session plans under `.eforge/session-plans/` so existing eforge build intake remains unchanged.

Out of scope:

- Do not write or import/export `.backlog/recommendations.json`.
- Do not treat this as a migration/backward-compatibility project for `.backlog/recommendations.json`.
- Do not move planning workflow UX into the engine kernel.
- Do not depend on the deprecated core Console Plans surface.
- Do not implement auto-mode backlog draining.
- Do not implement automatic queue orchestration in this plan.
- Do not implement a general daemon-owned AI chat runtime.
- Do not mark backlog items shipped during promotion.
- Landing lifecycle hooks continue to own shipped transitions.

## Acceptance Criteria

- The `eforge-plan` extension exposes a typed action that returns the current recommendation model from extension-private storage.
- The `eforge-plan` extension reads recommendations from `.eforge/storage/extensions/eforge-plan/recommendations/current.json` through extension SDK path helpers.
- The `eforge-plan` extension rejects malformed recommendation payloads with a validation error before writing private recommendation storage.
- The `eforge-plan` extension exposes a typed action that writes a valid recommendation model to `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- The implementation does not add import behavior for `.backlog/recommendations.json`.
- The implementation does not add export behavior for `.backlog/recommendations.json`.
- The board JSON returned by `list-board` includes recommendation summary data when private recommendation storage exists.
- The rendered board Markdown includes recommended next work when private recommendation storage exists.
- A new multi-source promotion action writes exactly one `.eforge/session-plans/<session>.md` file when invoked with two or more valid backlog item IDs.
- A multi-source generated session plan frontmatter includes every selected item ID in `eforge_plan.source_item_ids`.
- A multi-source generated session plan body includes source evidence for every selected backlog item.
- A multi-source generated session plan body includes dependency context for every selected backlog item.
- An epic-level promotion invocation writes exactly one `.eforge/session-plans/<session>.md` file for the selected epic.
- An epic-level generated session plan frontmatter includes the selected epic ID in `eforge_plan.source_epic_ids`.
- Existing `promote-item` behavior for a single backlog item remains covered by tests and continues to write one session plan.
- Existing `eforge://input/eforge-plan/<itemId>` behavior for a single backlog item remains covered by tests and continues to return build-source Markdown.
- The eforge-plan workstation or Console contribution exposes a user-visible control to promote a recommended item through an allowed extension action.
- The eforge-plan workstation or Console contribution exposes a user-visible control to promote a recommended group through an allowed extension action.
- The eforge-plan workstation or Console contribution exposes a user-visible control to promote an epic through an allowed extension action.
- A planner-context action returns selected backlog items as structured JSON-safe data.
- A planner-context action returns epics as structured JSON-safe data.
- A planner-context action returns recommendation rationale as structured JSON-safe data.
- A planner-context action returns dependency/blocker context as structured JSON-safe data.
- A planner-context action returns roadmap evidence as structured JSON-safe data.
- A planner-result action applies a structured recommendation update without requiring private Console imports.
- A planner-result action applies a structured handoff draft without requiring private Console imports.
- The eforge-plan README documents private recommendation storage.
- The eforge-plan README documents multi-source promotion.
- The eforge-plan README documents planner orchestration boundaries.
- The eforge-plan README documents non-goals for general AI chat runtime support.
- `pnpm type-check` exits 0.
- Targeted Vitest tests for the eforge-plan extension pass.

## Manual Verification Notes

- Re-read current extension-owned recommendations after the active Console Plans migration finishes.
- Inspect the landing result of the active Console Plans migration before enqueueing this plan.