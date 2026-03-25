---
title: Fix ENQUEUING section not clearing in sidebar after formatter completes
created: 2026-03-25
status: pending
---

# Fix ENQUEUING section not clearing in sidebar after formatter completes

## Problem / Motivation

When the formatter finishes and a PRD is enqueued, the monitor sidebar's ENQUEUING section continues to show the session as running. A browser refresh fixes the stale state. The root cause is a gap between backend and frontend state synchronization:

- The DB recorder correctly updates the enqueue run status to `completed` on the `enqueue:complete` event (`recorder.ts:94-96`).
- However, the sidebar never refetches `/api/runs` at that point.

The sidebar's `refreshTrigger` only fires on:
- A new session appearing (2s poll, but gated by `latestId !== knownLatestRef.current`)
- `phase:start` / `phase:end` events from the *currently viewed* session
- `session:end` of the currently viewed session

None of these conditions are met when an enqueue run completes, especially when the user is viewing a different session.

## Goal

The sidebar should automatically reflect enqueue run completion (and any other DB state change) within ~2 seconds, without requiring a manual browser refresh.

## Approach

Modify the existing 2-second poll in `src/monitor/ui/src/app.tsx` (lines 106-120) to always trigger a sidebar refetch, rather than only when a new session appears. The `fetchLatestSessionId` call is already made every 2s — move the `setSidebarRefresh` call outside the `if` guard so it fires unconditionally:

```tsx
const interval = setInterval(async () => {
  try {
    const latestId = await fetchLatestSessionId();
    setSidebarRefresh((c) => c + 1);  // always refetch sidebar
    if (latestId && latestId !== knownLatestRef.current) {
      knownLatestRef.current = latestId;
      if (!userSelectedRef.current) {
        setCurrentSessionId(latestId);
      }
    }
  } catch {
    // ignore
  }
}, 2000);
```

This is low-cost: `/api/runs` is a lightweight SQLite query, and the poll infrastructure already exists at 2-second intervals. The sidebar will self-correct within 2 seconds of any DB state change (enqueue completion, phase transitions, etc.).

## Scope

**In scope:**
- Changing the sidebar refresh trigger in `src/monitor/ui/src/app.tsx` to fire on every poll cycle

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm build` completes with no build errors.
- Starting a build via the daemon (`eforge build "test"`), the monitor sidebar's ENQUEUING entry disappears within ~2 seconds of the formatter completing, without requiring a browser refresh.
- The sidebar correctly reflects all DB state changes (enqueue completion, phase transitions, etc.) within ~2 seconds.
