---
id: plan-01-trusted-creation-linkage
name: Trusted AI Creation-Draft Source Linkage
branch: link-eforge-plan-backlog-items-session-plans-queue-runs-and-landed-builds/plan-01-trusted-creation-linkage
agents:
  builder:
    effort: high
    rationale: Creation-draft apply must coordinate workflow-index trust,
      session-plan frontmatter, and trace writes without accepting
      model-authored source ids.
  reviewer:
    effort: medium
    rationale: Review focus is trust-boundary enforcement and atomicity of apply
      validation.
---

# Trusted AI Creation-Draft Source Linkage

## Architecture Context

`eforge-plan` owns backlog linkage metadata and private trace sidecars. The daemon-owned planning agent returns draft content only; trusted source references come from the extension-owned planning task workflow index written when the task was started. This plan makes AI-created session plans durable linkage anchors without adding daemon API surface or accepting source ids from model output.

## Implementation

### Overview

When `apply-planning-agent-task-result` applies a `sessionPlanCreationDraft`, resolve the original task workflow entry by `taskId`, re-run the stored selection through `resolvePromotionSelection`, and write source linkage metadata plus promoted-session trace sidecars after the session plan is created through the adapter.

### Key Decisions

1. Source item ids, epic ids, and recommendation refs come only from `PlanningTaskWorkflowEntry.selection` plus deterministic selection resolution.
2. Session-plan linkage is stored under `eforge_plan` frontmatter through helper functions that preserve existing profile, agent profile, and open-question behavior.
3. Creation-draft apply records trace evidence but does not change backlog item status, submit the plan, or enqueue a build.

## Scope

### In Scope

- Trusted source linkage for AI `sessionPlanCreationDraft` applies from item, epic, and recommendation workflow selections.
- Session-plan frontmatter helpers for `eforge_plan.source_item_ids`, `source_epic_ids`, `source_recommendation_ref`, and `promoted_at`.
- Promoted-session trace sidecar upserts for each resolved source item.
- Tests proving model-authored source ids are ignored.

### Out of Scope

- Workstation rendering of lifecycle panels.
- Lifecycle projection aggregation for board, plan, and epic views.
- Daemon/client event or route changes.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/session-plan-metadata.ts` — add source metadata read/write helpers that load and write session plans through `@eforge-build/input`, merge `eforge_plan` safely, preserve existing metadata mutations, keep plural fields authoritative, and maintain singular compatibility fields only when a single source exists.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — resolve workflow selection for creation-draft applies, validate stale selections before writes when a workflow entry exists, apply source metadata after adapter-backed create/select/section/skip operations, and upsert promoted-session trace rows for resolved items.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — expose optional JSON-safe `sourceRefs`/`traceItemIds` fields on the applied creation-draft result when linkage is available.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — add coverage for item, epic, and recommendation selection linkage, trace sidecars, spoofed model ids, and no-status-mutation behavior.

## Implementation Notes

- Add a focused `SessionPlanSourceMetadata` shape with ordered `sourceItemIds`, ordered `sourceEpicIds`, optional `sourceRecommendationRef`, and `promotedAt`.
- `updateSessionPlanSourceMetadata` must merge into `plan.eforge_plan` rather than replacing unrelated extension metadata.
- Resolve linkage with `findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(cwd), task.taskId)`. If no entry exists, preserve the current creation-draft behavior so existing direct tests and callers keep working.
- For a workflow entry with selection data, call `resolvePromotionSelection({ cwd, itemIds, epicId, recommendationRef })` and use the returned `items`, `epicIds`, and `recommendationRef` only.
- Upsert promoted-session trace rows with `session`, absolute or project-relative plan path matching existing trace conventions, `status: loaded.plan.status` or `planning`, and `promotedAt`.

## Verification

- [ ] Applying a completed planning-draft task with an item workflow entry creates `.eforge/session-plans/<session>.md`.
- [ ] The created plan frontmatter contains `eforge_plan.source_item_ids` matching the workflow entry selection.
- [ ] The created plan frontmatter omits model-authored source ids not present in the workflow entry.
- [ ] Item-selection apply writes a promoted-session trace row for the selected item.
- [ ] Recommendation-ref apply writes source item ids, source epic ids, source recommendation ref, and trace rows for all resolved items.
- [ ] Epic-selection apply writes source epic ids and trace rows for the open epic items.
- [ ] Existing profile, agent profile, and open-question tests still pass.
- [ ] Creation-draft apply leaves selected backlog item statuses unchanged.
