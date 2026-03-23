---
id: plan-01-sidebar-pagination-search
name: Sidebar Session List Pagination and Search
dependsOn: []
branch: plan-limit-session-list-in-sidebar/sidebar-pagination-search
---

# Sidebar Session List Pagination and Search

## Architecture Context

The monitor UI sidebar (`src/monitor/ui/src/components/layout/sidebar.tsx`) renders all sessions from the database with no cap. This plan adds client-side pagination ("Show 25 more") and a search/filter input so users can navigate large session lists efficiently. All changes are confined to this single file — no new components, API changes, or shared state modifications.

The project uses shadcn/ui components. No `Input` component exists yet in `src/monitor/ui/src/components/ui/`. Since this is a single compact search input, use a plain `<input>` element styled with Tailwind to match sidebar aesthetics rather than adding a full shadcn Input component for one usage.

## Implementation

### Overview

Add two features to the `Sidebar` component:

1. **Pagination**: Display at most 25 sessions initially. A "Show 25 more" button at the bottom loads more. The currently selected session is always visible even if beyond the visible slice.
2. **Search/filter**: A text input above the session list filters by case-insensitive substring match on `group.label`. When a query is active, all matches display (no pagination limit) and the "Show 25 more" button is hidden.

### Key Decisions

1. **Client-side filtering and pagination** — Sessions are already fully loaded from the API (`/api/runs`). No server-side pagination needed; slicing the `sessionGroups` array in a `useMemo` is sufficient.
2. **Plain `<input>` over shadcn Input** — Adding a full shadcn `Input` component for a single compact search field is unnecessary overhead. A Tailwind-styled `<input>` matches sidebar aesthetics and avoids a new component dependency.
3. **Reset `visibleCount` on search clear** — When the user clears the search query, `visibleCount` resets to `PAGE_SIZE` to avoid showing a stale expanded count.
4. **Selected session guarantee** — If `currentSessionId` maps to a `SessionGroup` that falls outside the visible slice, append it to the visible list so the active session is never hidden.

## Scope

### In Scope
- `PAGE_SIZE = 25` constant and `visibleCount` state in `Sidebar`
- `searchQuery` state with controlled `<input>` element
- Filtering logic: case-insensitive substring match on `group.label`
- "Show 25 more (N remaining)" button when more sessions exist and no search query is active
- Ensure `currentSessionId` group is always in the visible list
- Clear button (X icon from lucide-react) in the search input to reset the filter

### Out of Scope
- Server-side pagination or API changes
- Adding a shadcn `Input` component
- Filtering by fields other than `group.label`
- Persisting pagination/search state across navigation

## Files

### Modify
- `src/monitor/ui/src/components/layout/sidebar.tsx` — Add `useState` import, `PAGE_SIZE` constant, `searchQuery` and `visibleCount` state, search input element, filtering/slicing logic in `useMemo`, "Show 25 more" button, and `X` (lucide-react) icon import for the clear button.

## Verification

- [ ] `pnpm build` completes with zero type errors
- [ ] With >25 sessions, the sidebar renders exactly 25 session items on initial load
- [ ] A "Show 25 more" button appears below the session list when total sessions exceed the visible count
- [ ] Clicking "Show 25 more" increases visible sessions by 25 and the button label shows the updated remaining count
- [ ] When all sessions are visible, the "Show 25 more" button is not rendered
- [ ] If `currentSessionId` refers to a session beyond the visible slice, that session still appears in the list
- [ ] Typing in the search input filters sessions by case-insensitive substring match on `group.label`
- [ ] When a search query is active, all matching sessions display and the "Show 25 more" button is hidden
- [ ] Clicking the X clear button resets the search query to empty and restores paginated view
- [ ] The search input has placeholder text "Search builds..." and is compact with muted styling
