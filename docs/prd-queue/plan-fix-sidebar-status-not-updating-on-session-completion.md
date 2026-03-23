---
title: Plan: Fix sidebar status not updating on session completion
created: 2026-03-23
status: pending
---

# Fix Sidebar Status Not Updating on Session Completion

## Problem / Motivation

The monitor sidebar shows a spinner (running status) on completed sessions. The main content area correctly shows "Completed" via SSE events, but the sidebar reads from `/api/runs` (SQLite) and never refetches after the session finishes.

The root cause is in `src/monitor/ui/src/app.tsx` lines 104-112: the sidebar refresh is triggered only when the last event in a batch is `phase:start` or `phase:end`. With React 18 automatic batching, `phase:end` and `session:end` can be batched into a single render — the effect only sees `session:end` as the last event, misses `phase:end`, and the sidebar refetch never fires. There is no periodic polling on the sidebar, so it stays stuck showing "running" forever.

The DB records are correct (the recorder updates run status synchronously on `phase:end` before yielding). The issue is purely that the UI never re-reads them.

## Goal

Ensure the monitor sidebar immediately reflects completed session status when a session finishes, without requiring a page reload.

## Approach

Add a `useEffect` in `src/monitor/ui/src/app.tsx` that watches `runState.isComplete` and triggers a sidebar refresh:

```tsx
// Refresh sidebar when the current session completes
useEffect(() => {
  if (runState.isComplete) {
    setSidebarRefresh((c) => c + 1);
  }
}, [runState.isComplete]);
```

Place this right after the existing `phase:start`/`phase:end` refresh effect (line 112).

This is batching-proof because `runState.isComplete` is a derived boolean set by the reducer when it processes `session:end` — it doesn't depend on which event is "last" in a batched render.

The fix is ~3 lines — one `useEffect` hook.

## Scope

**In scope:**
- Adding a `useEffect` to `src/monitor/ui/src/app.tsx` that triggers sidebar refresh on session completion

**Out of scope:**
- Changes to the SSE event handling or reducer logic
- Changes to the `/api/runs` API or SQLite recording layer (DB records are already correct)
- Adding periodic polling to the sidebar
- Modifying the existing `phase:start`/`phase:end` refresh effect

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm build` produces a clean build
- When a build completes, the sidebar spinner transitions to a green checkmark immediately without requiring a page reload
