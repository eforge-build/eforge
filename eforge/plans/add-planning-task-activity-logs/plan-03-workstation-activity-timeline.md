---
id: plan-03-workstation-activity-timeline
name: Planning Task Projections and Workstation Timeline
branch: add-planning-task-activity-logs/plan-03-workstation-activity-timeline
agents:
  reviewer:
    effort: high
    rationale: The review must verify result payload omission remains intact while
      UI surfaces activity without cluttering task cards.
---

# Planning Task Projections and Workstation Timeline

## Architecture Context

Plan 01 adds the shared task metadata contract and Plan 02 fills the backlog curation history with meaningful milestones. This plan carries the bounded metadata through eforge-plan projections and renders recent activity as a drawer-only timeline. The task rail/card remains scannable and continues to show the existing latest progress, section progress, and backlog curation item-agent summary.

## Implementation

### Overview

Update workstation-facing types to use the shared browser activity entry type, add projection tests for activity preservation in list/get outputs, and render activity in the planning task detail drawer. The task card may show a compact latest-activity affordance, but it must not render the full timeline by default.

### Key Decisions

1. Treat `metadata.progressMessage` as the compact summary and `metadata.activityLog` as bounded history. Do not replace existing progress, section, or backlog curation summaries with activity entries.
2. Render the drawer timeline from oldest to newest to match persisted order, plus a distinct `Latest activity` row derived from the newest entry.
3. Keep task list result omission behavior unchanged: when a completed result is omitted because it contains heavy generated payloads, `metadata.activityLog` remains in the compact task record and no `result` field is reintroduced.
4. Use `formatRelativeTime` with the full timestamp in `title` attributes so the drawer displays relative time and preserves exact daemon timestamps for inspection.

## Scope

### In Scope

- Workstation type updates for activity entries.
- eforge-plan task list/get projection tests that preserve bounded activity and keep heavy result payload omission intact.
- Task card compact latest activity display only if it does not render the full timeline.
- Drawer full recent activity timeline with timestamps/relative time and newest-entry label.
- Fixture/docs updates for user-visible planning activity behavior.

### Out of Scope

- A global daemon event-log viewer.
- Cross-session observability UI.
- Raw transcripts, raw prompts, or raw source display.
- Changes to cancellation, retry, redraft, apply, or recommendation freshness semantics.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-activity.tsx` — shared UI helpers/components for latest activity and drawer timeline rendering, kept focused and below the new-file size limit.

### Modify

- `eforge/extensions/eforge-plan/planning-agent-task-projection.ts` — verify metadata pass-through preserves bounded `activityLog`; avoid adding result data to compact summaries. Change only if tests reveal stripping or over-copying.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — add assertions that list projections preserve `metadata.activityLog` in compact task rows, get projections preserve it in full task records, and omitted heavy results remain omitted.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — import the shared browser activity entry type and add `activityLog?: PlanningTaskActivityEntry[]` to `PlanningAgentTaskMetadata`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — keep current progress, section progress, and backlog curation summary visible; optionally show only the newest activity entry as a compact line and never map the full activity list in the card.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.tsx` — render the full recent activity timeline below the task card and add a distinct latest-activity label derived from the newest entry.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — verify current progress summaries remain visible when activity history is present and the card omits older timeline entries.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.test.tsx` — verify running task activity rendering, newest-entry label, and timestamp/relative-time display.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add representative `activityLog` entries to a running planning task fixture without inflating result payloads.
- `eforge/extensions/eforge-plan/README.md` — update user-facing workstation/task-record text to mention bounded recent activity in the task detail drawer and keep the rail/card compact.

## Verification

- [ ] `list-planning-agent-tasks` returns compact task rows whose `task.metadata.activityLog` is present when the daemon record has activity entries.
- [ ] `list-planning-agent-tasks` still omits heavy completed `result` payloads and sets `resultOmitted: true` for the existing heavy result cases.
- [ ] `get-planning-agent-task` returns the full daemon task record with `metadata.activityLog` unchanged from the supplied record.
- [ ] `PlanningTaskCard` renders the existing `progressMessage`, section progress, and backlog curation item-agent summary when activity history is present.
- [ ] `PlanningTaskCard` does not render older activity timeline entries by default.
- [ ] `PlanningTaskDrawer` renders a `Latest activity` label from the newest activity entry.
- [ ] `PlanningTaskDrawer` renders recent activity entries with either a relative timestamp text or a title containing the exact timestamp.
- [ ] Workstation fixtures include activity entries and no generated `workstation-assets/` files are committed.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.test.tsx --silent` exits 0.
