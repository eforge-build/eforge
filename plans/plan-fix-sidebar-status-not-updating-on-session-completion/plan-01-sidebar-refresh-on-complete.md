---
id: plan-01-sidebar-refresh-on-complete
name: Sidebar Refresh on Session Completion
depends_on: []
branch: plan-fix-sidebar-status-not-updating-on-session-completion/sidebar-refresh-on-complete
---

# Sidebar Refresh on Session Completion

## Architecture Context

The monitor UI sidebar shows session status by polling `/api/runs` (SQLite). The main content area receives real-time SSE events and correctly shows "Completed" status. However, the sidebar only refetches when it detects `phase:start` or `phase:end` as the last event in a render batch. React 18 automatic batching can merge `phase:end` and `session:end` into one render, causing the effect to see only `session:end` — the sidebar refetch never fires.

The DB records are already correct. The fix is purely UI-side: trigger a sidebar refresh when `runState.isComplete` becomes true.

## Implementation

### Overview

Add a `useEffect` hook in `app.tsx` that watches `runState.isComplete` and increments the sidebar refresh counter when the session completes. This is batching-proof because `isComplete` is a derived boolean set by the reducer on `session:end` processing — it doesn't depend on event ordering within a batch.

### Key Decisions

1. **Watch `runState.isComplete` instead of event type** — immune to React 18 batching since it's a stable derived state, not dependent on which event happens to be "last" in a render.
2. **Place after the existing `phase:start`/`phase:end` effect** — follows the existing pattern and keeps sidebar refresh logic grouped together.

## Scope

### In Scope
- Adding a `useEffect` to `src/monitor/ui/src/app.tsx` that triggers `setSidebarRefresh` when `runState.isComplete` becomes true

### Out of Scope
- Changes to SSE event handling or reducer logic
- Changes to `/api/runs` API or SQLite recording layer
- Adding periodic polling to the sidebar
- Modifying the existing `phase:start`/`phase:end` refresh effect

## Files

### Modify
- `src/monitor/ui/src/app.tsx` — Add a `useEffect` after line 114 that watches `runState.isComplete` and calls `setSidebarRefresh((c) => c + 1)` when true

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm build` exits with code 0
- [ ] The new `useEffect` hook is present in `app.tsx` with dependency array `[runState.isComplete]`
- [ ] The new effect calls `setSidebarRefresh((c) => c + 1)` when `runState.isComplete` is true
