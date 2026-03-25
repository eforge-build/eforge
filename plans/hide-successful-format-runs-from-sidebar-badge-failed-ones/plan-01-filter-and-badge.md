---
id: plan-01-filter-and-badge
name: Filter Successful Format Runs and Badge Failed Ones
depends_on: []
branch: hide-successful-format-runs-from-sidebar-badge-failed-ones/filter-and-badge
---

# Filter Successful Format Runs and Badge Failed Ones

## Architecture Context

The monitor sidebar partitions session groups via `partitionEnqueueSessions()` in `session-utils.ts`. Currently, enqueue-only sessions that are running go into a separate "enqueue" section, while all others (completed and failed) fall through to the main sessions list. This plan tightens the filter so only failed enqueue-only sessions reach the sessions list, and adds a visual badge to distinguish them from build failures.

## Implementation

### Overview

Two changes:
1. In `partitionEnqueueSessions()`, change the `else` branch to `else if (group.status === 'failed')` so completed (successful) enqueue-only sessions are silently dropped.
2. In the `SessionItem` component, detect enqueue-only groups and render a red-tinted "enqueue" badge before the profile badge.

### Key Decisions

1. Completed enqueue-only sessions are dropped entirely rather than hidden behind a toggle, because they provide no value to the user — they represent successful PRD normalization with no build activity.
2. The "enqueue" badge uses the existing `Badge` component with a red color scheme to signal failure context, placed before the profile badge in the metadata row.

## Scope

### In Scope
- Filtering completed enqueue-only sessions from the sidebar
- Retaining failed enqueue-only sessions in the sidebar
- Adding a red-tinted "enqueue" outline badge to failed format runs

### Out of Scope
- Changes to the EnqueueSection component (running enqueue sessions)
- Changes to event recording or backend filtering
- Any new test files

## Files

### Modify
- `src/monitor/ui/src/lib/session-utils.ts` — Change `else` to `else if (group.status === 'failed')` on line 109 so completed enqueue-only sessions are dropped from the sessions list
- `src/monitor/ui/src/components/layout/sidebar.tsx` — Add enqueue-only detection and red "enqueue" badge in `SessionItem` metadata area, before the profile badge

## Verification

- [ ] `partitionEnqueueSessions()` returns enqueue-only groups with status `'completed'` in neither the `enqueue` nor `sessions` arrays
- [ ] `partitionEnqueueSessions()` returns enqueue-only groups with status `'failed'` in the `sessions` array
- [ ] `partitionEnqueueSessions()` returns enqueue-only groups with status `'running'` in the `enqueue` array (unchanged behavior)
- [ ] `SessionItem` renders a `Badge` with text "enqueue" and red-tinted classes when all runs in the group have `command === 'enqueue'`
- [ ] `SessionItem` does not render the "enqueue" badge for groups with mixed or non-enqueue commands
- [ ] `pnpm build` completes with zero errors
- [ ] `pnpm test` passes all existing tests
