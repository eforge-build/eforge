---
title: Add dynamic minimum time window for pipeline timeline bars
created: 2026-03-25
status: pending
---



# Add dynamic minimum time window for pipeline timeline bars

## Problem / Motivation

When the pipeline view first renders (e.g., only the planner is running at ~30s elapsed), `totalSpan` equals the elapsed time (~30s). Since the planner started at approximately session start, its bar width computes to ~100% of the container. This gives the false impression it has been running for a long time.

## Goal

Introduce a minimum time window so that timeline bars grow naturally from left to right, and only start compressing once total elapsed time exceeds the minimum window — eliminating the misleading full-width bar on initial render.

## Approach

**File:** `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`

**Lines 186–197** — the `useMemo` that computes `sessionStart` and `totalSpan`:

1. Add a constant:
   ```ts
   const MIN_TIMELINE_WINDOW_MS = 60_000; // 1 minute minimum window
   ```

2. Change the return from:
   ```ts
   return { sessionStart: start, totalSpan: Math.max(maxEnd - start, 1) };
   ```
   to:
   ```ts
   return { sessionStart: start, totalSpan: Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS) };
   ```

This single change means:
- When elapsed time < 60s: bars fill proportionally within a 60s window (e.g., a 30s bar = 50% width).
- When elapsed time > 60s: the window naturally expands to fit all content (current behavior).
- The transition is seamless — no jump or resize event.
- The existing `Math.max` already guards against zero/negative spans; the floor is simply raised from 1ms to 60,000ms.

## Scope

**In scope:**
- Modifying the `useMemo` block in `thread-pipeline.tsx` to enforce a 60-second minimum timeline window.

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm build` compiles successfully with the change.
- When starting a build and opening the monitor, the initial planner bar starts small and grows proportionally within a 60-second window (not pinned at ~100% width).
- After elapsed time exceeds 60s, bars transition smoothly to filling the available space (existing behavior preserved).
- No visible jump or resize event occurs at the 60s transition point.
