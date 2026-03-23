---
title: Plan: Limit Session List in Sidebar
created: 2026-03-23
status: pending
---

## Problem / Motivation

The sidebar session list in the eforge monitor UI currently renders every session from the database with no cap. Over time this grows unbounded and becomes unwieldy, degrading usability as the number of builds increases.

## Goal

Add a paginated display limit with a "Show more" mechanism and a search/filter input so users can efficiently navigate large session lists.

## Approach

All changes are scoped to a single file: `src/monitor/ui/src/components/layout/sidebar.tsx`.

**Pagination — "Show 25 more":**
- Add a `PAGE_SIZE = 25` constant.
- Add `visibleCount` state, initialized to `PAGE_SIZE`.
- Slice `sessionGroups` to `sessionGroups.slice(0, visibleCount)`.
- When there are more sessions beyond `visibleCount`, render a "Show 25 more" button that increments `visibleCount` by `PAGE_SIZE`.
- The button shows remaining count, e.g. "Show 25 more (48 remaining)".
- The currently selected session should always be visible — if `currentSessionId` is beyond the visible slice, include it at the end.

**Search/filter input:**
- Add a search input at the top of the sessions area (below Queue/Enqueue sections, above the session list).
- Compact text input styled to match sidebar aesthetics (small font, muted placeholder).
- Filter `sessionGroups` by matching the query against `group.label` (the planSet/build name).
- Use simple case-insensitive substring matching (sufficient for plan set names — no need for a fuzzy library).
- When a search query is active, show all matching results (no pagination limit) and hide the "Show 25 more" button.
- Clear button (X) in the input to reset the filter.
- Placeholder text: "Search builds..."

## Scope

**In scope:**
- `src/monitor/ui/src/components/layout/sidebar.tsx`: Add `PAGE_SIZE` pagination + search input.

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm build` completes with no type errors.
2. Initially shows at most 25 sessions; a "Show 25 more" button appears if more exist.
3. Clicking the "Show 25 more" button loads 25 additional sessions and displays the remaining count.
4. The currently selected session (`currentSessionId`) is always visible even if it falls beyond the visible slice.
5. A search input above the session list filters sessions by case-insensitive substring match against `group.label`.
6. When a search query is active, all matching results are shown (no pagination limit) and the "Show 25 more" button is hidden.
7. A clear button (X) in the search input resets the filter and restores the paginated view.
8. The search input is compact, with muted placeholder text "Search builds...", styled to match sidebar aesthetics.
