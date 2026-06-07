---
id: plan-02-promotion-selection
name: Multi-Source and Epic Promotion
branch: add-eforge-plan-backlog-workflow-foundations/plan-02-promotion-selection
---

# Multi-Source and Epic Promotion

## Architecture Context

Promotion remains an extension-owned handoff into ordinary `.eforge/session-plans/<session>.md` artifacts. The engine intake remains unchanged: generated plans are normal session-plan Markdown files. This plan builds on the private recommendation store from plan-01 so a new `promote-selection` action can resolve explicit item IDs, epic membership, or recommendation group refs into one ordered source selection.

## Implementation

### Overview

Refactor promotion synthesis so single-item promotion and multi-source promotion use one body/frontmatter generator, add selection resolution, and register a new backward-compatible action for grouped handoff.

### Key Decisions

1. Keep `promote-item` and `eforge://input/eforge-plan/<itemId>` backward compatible.
2. Add `promote-selection` rather than changing the `promote-item` input contract.
3. Preserve existing singular `eforge_plan.source_item_id` and `eforge_plan.source_epic_id` for one selected item, while also writing plural arrays.
4. For multi-item and epic selections, write plural `source_item_ids`, `source_epic_ids`, and optional `source_recommendation_ref` metadata.
5. Update trace sidecars for every selected item with the same promoted session plan entry.
6. Default grouped selections to `profile: 'excursion'` when the caller omits `profile` and the matched recommendation group does not provide `recommendedProfile`.

## Scope

### In Scope

- Resolve selection inputs from item IDs, epic ID, or recommendation ref.
- Generate one session plan for a selected group.
- Preserve implementation order from explicit item IDs or recommendation groups.
- Derive epic membership from backlog item frontmatter.
- Include source evidence, dependency context, assumptions guidance, acceptance criteria guidance, and recommendation context in generated bodies.
- Default grouped and epic handoffs to the `excursion` profile when no explicit or recommendation profile is supplied.
- Mark selected items `active` by default or `planned` when requested; never mark promoted items `shipped`.
- Add tests for grouped promotion, epic promotion, recommendation-ref promotion, and single-item compatibility.

### Out of Scope

- Planner context/result actions.
- Workstation recommendation controls and README updates.
- Auto-mode backlog draining or queue submission.
- Landing lifecycle shipped transitions.
- Engine, daemon route, queue schema, or client route changes.

## Files

### Create

- `eforge/extensions/eforge-plan/promotion-selection.ts` — Resolve `{ itemIds | epicId | recommendationRef }` into ordered backlog items, related epics, recommendation metadata, and display title/session defaults. Enforce exactly one selector family per call.
- `eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts` — Cover explicit multi-item selection, epic selection, recommendation group selection, selector validation errors, plural frontmatter metadata, body evidence, dependency context, trace updates, and item status updates.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — Add `PromotionSelectionInputSchema`, `PromotionSelectionOutputSchema`, selection-source schemas, and reusable source metadata schemas. The input must accept `itemIds?: string[]`, `epicId?: string`, `recommendationRef?: string`, `session?: string`, `status?: 'active' | 'planned'`, `profile?: PlanningProfile`, and optional `title?: string`.
- `eforge/extensions/eforge-plan/backlog-domain.ts` — Add helpers for epic membership, selected source summaries, dependency projection, blocker/risk projection, and ordered source-reference summaries.
- `eforge/extensions/eforge-plan/promote.ts` — Replace the single-item-only body generator with a shared selection generator. Keep `promoteBacklogItem`, `synthesizeSessionPlanMarkdown`, `synthesizeBuildSourceMarkdown`, and `fetchEforgePlanInputSource` exports working for existing callers. Add `promoteBacklogSelection` or an equivalent exported helper for `promote-selection`.
- `eforge/extensions/eforge-plan/index.ts` — Register the `promote-selection` action and keep `promote-item` unchanged.
- `eforge/extensions/eforge-plan/__tests__/promotion.test.ts` — Extend existing tests to assert singular compatibility plus plural arrays for one-item promotion and unchanged direct input-source output.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — Add `promote-selection` to action registration and local-write side-effect expectations.

## Selection Resolution Contract

- `itemIds`: read each item by ID, preserve caller order, reject duplicates, reject missing IDs, and include related epics from `item.epic`.
- `epicId`: read the epic, select all open backlog items whose `epic` equals `epicId`, sort selected items by dependency-before-dependent order when dependencies are inside the selected set, then by ID for ties.
- `recommendationRef`: read private recommendations and match `safeParallelizableGroups[].ref` first. Use that group’s `itemIds` order and `recommendedProfile` when the action input omits `profile`. Also support refs on `recommendedNextSequence[]` entries for one-item handoff.
- `profile`: use the caller-provided `profile` first, then a matched recommendation group `recommendedProfile`, then `excursion` for grouped selections (`itemIds.length > 1`, `epicId`, or a multi-item recommendation group), and otherwise keep the existing single-item default.
- Reject calls that supply zero selectors or more than one selector family.

## Generated Session Plan Contract

The generated frontmatter must include:

- existing session-plan fields: `session`, `topic`, `status`, `planning_type`, `planning_depth`, dimension arrays, `open_questions`, and `profile`;
- `eforge_plan.source_item_ids` for every selected item;
- `eforge_plan.source_epic_ids` for every selected epic;
- `eforge_plan.source_recommendation_ref` when selection came from a recommendation ref;
- `eforge_plan.source_item_id` and `eforge_plan.source_epic_id` only when exactly one selected item/epic makes the singular metadata unambiguous.

The generated body must include one section for each selected backlog item under `## Source Backlog Evidence`, one section for each selected epic under `## Source Epic Evidence`, and per-item dependency details under `## Dependency Context`.

## Verification

- [ ] Invoking `promote-selection` with two valid `itemIds` writes exactly one `.eforge/session-plans/<session>.md` file.
- [ ] The multi-item session plan frontmatter contains `eforge_plan.source_item_ids` with both selected item IDs in selection order.
- [ ] The multi-item session plan frontmatter contains `profile: excursion` when the input omits `profile`.
- [ ] A recommendation group `recommendedProfile` or caller-provided `profile` takes precedence over the grouped `excursion` default.
- [ ] The multi-item session plan body contains `Backlog item id: <id>` for each selected item.
- [ ] The multi-item session plan body contains a dependency entry for each selected item.
- [ ] Invoking `promote-selection` with `epicId` writes exactly one `.eforge/session-plans/<session>.md` file.
- [ ] The epic session plan frontmatter contains `eforge_plan.source_epic_ids` with the selected epic ID.
- [ ] Invoking `promote-selection` with a recommendation group ref writes `eforge_plan.source_recommendation_ref` with that ref.
- [ ] Each selected item receives one promoted session-plan trace entry for the generated session.
- [ ] Existing `promoteBacklogItem` and the `promote-item` action still write one session plan for one backlog item.
- [ ] Existing `eforge://input/eforge-plan/<itemId>` output remains byte-for-byte equal to `synthesizeBuildSourceMarkdown` for the same item and direct session ID.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/promotion.test.ts eforge/extensions/eforge-plan/__tests__/promotion-selection.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
