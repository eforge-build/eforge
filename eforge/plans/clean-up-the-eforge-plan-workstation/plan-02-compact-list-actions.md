---
id: plan-02-compact-list-actions
name: Compact Paginated eforge-plan List Actions
branch: clean-up-the-eforge-plan-workstation/plan-02-compact-list-actions
agents:
  builder:
    effort: high
    rationale: Multiple extension action schemas, handlers, registration tests,
      workstation task-list behavior, and docs must move together without
      breaking existing workstation flows.
  reviewer:
    effort: high
    rationale: Action wire-shape and UI compatibility changes need careful API review.
---

# Compact Paginated eforge-plan List Actions

## Architecture Context

Agent-facing broad list actions must avoid unbounded context payloads. The extension SDK already provides `CONTRIBUTION_OUTPUT_PROFILES`, `createContributionPaginationInputFields()`, and `paginateContributionItems()`; eforge-plan backlog compact reads use that pattern. This plan applies the same pattern to the remaining broad list actions while preserving single-record detail actions for full views.

## Implementation

### Overview

Add bounded `limit`/`offset` pagination, compact list projections, and `outputProfile` declarations for draft units, planning artifacts, plan revision sessions, and planning agent tasks. Keep full details behind existing single-record reads (`get-draft-unit`, `show-session-plan`, `show-session-plan-set`, `get-plan-revision-session`, `get-planning-agent-task`) or explicit rich/debug opt-ins.

### Key Decisions

1. Use `limit` plus `offset` everywhere for consistency with `list-plan-revision-sessions`.
2. Default list reads to compact projections; use full/detail actions for verbose bodies, curation drafts, and task results.
3. Preserve workstation startup behavior by keeping default limits large enough for normal local workstations and by adding UI detail-fetching only where compact task list rows omit heavy task results.

## Scope

### In Scope

- `list-draft-units` pagination, compact projection, `agent-paginated` output profile, and tests.
- `list-planning-artifacts` pagination, compact projection metadata, `agent-paginated` output profile, and tests.
- `list-plan-revision-sessions` output profile while preserving existing `limit` and `offset` behavior.
- `list-planning-agent-tasks` pagination, compact task-list projection, `agent-paginated` output profile, and tests.
- Workstation changes required for compact task-list rows, including lazy fetching full task detail through `get-planning-agent-task` when a drawer needs omitted result data.
- eforge-plan README updates for new pagination/profile behavior.

### Out of Scope

- Removing intentional `debug-rich` `list-board` output.
- Replacing recommendation generation.
- Changing daemon task storage.
- Changing session-plan file format.

## Files

### Modify

- `eforge/extensions/eforge-plan/draft-plan-unit-schemas.ts` — add pagination input fields, compact list item schema, and `total`/`limit`/`offset` output fields.
- `eforge/extensions/eforge-plan/draft-plan-unit-actions.ts` — page `listDraftPlanUnits()`, map to compact list items, and declare `CONTRIBUTION_OUTPUT_PROFILES.agentPaginated`.
- `eforge/extensions/eforge-plan/session-plan-schemas.ts` — add `limit`/`offset` to `ListPlanningArtifactsInputSchema` and `total`/`limit`/`offset` to output.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — page the combined artifact projection and keep `plans`/`planSets` derived from the returned page; declare `agent-paginated`.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — declare `agent-paginated` for `list-plan-revision-sessions` without changing slicing semantics.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add pagination fields to `ListPlanningAgentTasksInputSchema`, add `total`/`limit`/`offset` to the output, and add optional compact-list metadata such as `resultOmitted` when heavy results are suppressed.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — page workflow entries before joining daemon records; project task records for list rows without large curation drafts or other verbose result payloads; keep `get-planning-agent-task` as the full detail read.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add pagination and task-list compact fields to workstation types.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — accept paginated list responses and keep existing first-page behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.tsx` — fetch full task detail on drawer open when the list item marks result data as omitted.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — render loading/error states for lazy task detail if needed.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-draft-units.ts` and related fixture files — add pagination metadata to mock list responses.
- `eforge/extensions/eforge-plan/__tests__/draft-plan-unit-store.test.ts` — cover `limit`/`offset`, compact unit fields, and full `get-draft-unit` detail retention.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — cover planning artifact pagination and compact output.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts` and `eforge/extensions/eforge-plan/__tests__/plan-revision-annotations.test.ts` — assert `limit`/`offset` behavior remains unchanged.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — cover task-list pagination and compact projection, including omitted heavy curation result data.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert new `outputProfile` values and schema fields for all list actions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx`, `eforge/extensions/eforge-plan/workstation-src/plans/src/views/activity-rail.test.tsx`, and `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — update expectations for paginated compact task list responses and lazy full-detail fetches.
- `eforge/extensions/eforge-plan/README.md` and `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — document pagination defaults, compact projections, output profiles, and detail-read paths.

## Verification

- [ ] `list-draft-units` returns `units`, `total`, `limit`, and `offset`; `limit: 1, offset: 1` returns the second newest draft unit.
- [ ] `list-draft-units` list rows omit verbose fields reserved for `get-draft-unit` and include enough identity fields for agents: unit id, title, status, provenance, item ids or item count, profile, promotion metadata, and timestamps.
- [ ] `list-planning-artifacts` returns paged `artifacts`, with `plans` and `planSets` matching the same returned page.
- [ ] `list-plan-revision-sessions` still honors existing `limit` and `offset` inputs.
- [ ] `list-planning-agent-tasks` returns `tasks`, `total`, `limit`, and `offset`, and omits heavy curation result payloads from list rows.
- [ ] `get-planning-agent-task` still returns full task detail for a selected drawer row.
- [ ] Registration tests assert `agent-paginated` on `list-draft-units`, `list-planning-artifacts`, `list-plan-revision-sessions`, and `list-planning-agent-tasks`.
- [ ] eforge-plan README examples show `limit` and `offset` for the updated list actions.
