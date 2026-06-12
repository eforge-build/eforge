---
id: plan-02-workstation-preview-and-docs
name: Workstation Preview and Documentation for Curation-Only Apply
branch: make-eforge-plan-backlog-curation-resilient-to-closed-dependency-references/plan-02-workstation-preview-and-docs
---

# Workstation Preview and Documentation for Curation-Only Apply

## Architecture Context

The eforge-plan workstation is a sandboxed extension surface that renders daemon-owned planning task records through `list-planning-agent-tasks` and applies selected generated output through `apply-planning-agent-task-result`. The backend plan adds structured curation preview validation and an explicit curation-only apply flag; this plan consumes those optional fields in the workstation and documents the new apply semantics.

## Implementation

### Overview

Render invalid generated recommendation references in the backlog curation preview, block the normal destructive confirmation path while invalid recommendations remain unacknowledged, and offer an explicit curation-only apply action that sends the backend skip flag. Update workstation types, mocks, tests, and README contract text.

### Key Decisions

1. Treat preview validation as advisory display data until the user applies: backend apply remains the authority and repeats validation before writes.
2. Disable the normal “Confirm apply curation” button when `recommendationValidation.valid === false`; do not infer invalidity from text strings.
3. Show a separate “Apply curation only / discard generated recommendations” action only when validation details report invalid generated recommendations.
4. Keep normal confirmation behavior unchanged when validation details are absent or valid so older task records and mock data remain renderable.

## Scope

### In Scope

- Workstation types for recommendation validation issues, validation results, curation preview details, and skipped recommendation apply details.
- Curation preview warning/error rendering with field paths and invalid ids.
- Normal confirm disablement for invalid generated recommendations.
- Explicit curation-only apply button that sends `applyBacklogCurationDraft.applyCurationOnly: true`.
- Mock bridge/data updates for skipped recommendation result shapes.
- Workstation tests for warning rendering, disabled normal confirm, and curation-only action input.
- README and README contract test updates for public action semantics.

### Out of Scope

- New daemon actions or a new workstation route.
- Client-side reimplementation of backend recommendation reference validation.
- Automatic dependency cleanup UI outside reviewed curation patches.
- Changes to Claude Code or Pi integration packages; this is an eforge-plan workstation/action contract change only.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add `RecommendationReferenceValidationIssue`, validation result, curation preview, and skipped recommendation fields; extend `PlanningAgentTaskListItem` and `ApplyPlanningTaskResponse`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — pass optional curation preview validation from the list item into `BacklogCurationPreview`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — keep completed task rendering compatible with optional preview details; no generic recommendation apply path for curation tasks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — render invalid generated recommendation reference details, disable normal confirmation when invalid, and add the explicit curation-only apply button with the new action input flag.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — add small formatting helpers for validation issue labels if needed.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — after polling observes a terminal task status, reload the task list so completed curation tasks receive backend preview validation details.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add mock curation preview validation and skipped recommendation apply details for development/test fixtures.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — assert invalid reference rendering, disabled normal confirm, and curation-only action input.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — assert curation task cards pass invalid preview details through to the preview.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — add or update a polling transition test if the reload-on-terminal-status change is observable.
- `eforge/extensions/eforge-plan/README.md` — document preview-time recommendation validation, disabled normal apply, and `applyCurationOnly` curation-only semantics.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert README text mentions `applyCurationOnly` and invalid generated recommendation references.

## Database Migration

Not applicable.

## Verification

- [ ] A `BacklogCurationPreview` test renders an invalid recommendation reference with path `blockedChains.closed-chain.blockedBy` and id `closed-dep` before any apply click.
- [ ] After the preview review step, the normal `Confirm apply curation` button is disabled when validation details report invalid generated recommendations.
- [ ] The curation-only button calls `onApply(taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true } })`.
- [ ] With valid or absent validation details, the normal confirmation button still sends `{ previewAcknowledged: true, confirmApply: true }` without `applyCurationOnly`.
- [ ] `PlanningTaskCard` renders the invalid recommendation warning for a completed backlog-curation task whose list item contains `backlogCurationPreview.recommendationValidation.valid: false`.
- [ ] README text states that invalid generated recommendations block normal curation apply and that users may explicitly apply curation only while discarding generated recommendations.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test -- src/views/backlog/backlog-curation-preview.test.tsx src/views/backlog/planning-task-card.test.tsx src/views/backlog/use-planning-task-workflows.test.tsx` exits 0.
