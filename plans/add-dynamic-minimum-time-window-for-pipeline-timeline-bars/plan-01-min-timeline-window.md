---
id: plan-01-min-timeline-window
name: Add Minimum Timeline Window
depends_on: []
branch: add-dynamic-minimum-time-window-for-pipeline-timeline-bars/min-timeline-window
---

# Add Minimum Timeline Window

## Architecture Context

The monitor's pipeline view (`thread-pipeline.tsx`) computes a `totalSpan` from the earliest agent start to the latest agent end (or now). When elapsed time is small (e.g., 30s), the single running bar fills ~100% width, giving a misleading impression of long runtime. A minimum window of 60s fixes this by letting bars grow proportionally within a fixed-width timeline until real elapsed time exceeds the minimum.

## Implementation

### Overview

Add a `MIN_TIMELINE_WINDOW_MS` constant and use it as the floor in the `totalSpan` computation inside the existing `useMemo` block.

### Key Decisions

1. 60 seconds chosen as the minimum window — long enough for the planner phase to render proportionally, short enough that the transition to real-time scaling is unnoticeable.
2. Reuse the existing `Math.max` guard — simply raise the floor from `1` to `60_000`.

## Scope

### In Scope
- Adding `MIN_TIMELINE_WINDOW_MS` constant
- Changing the `totalSpan` floor from `1` to `MIN_TIMELINE_WINDOW_MS`

### Out of Scope
- Configurable minimum window
- Any other timeline rendering changes

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` — Add `MIN_TIMELINE_WINDOW_MS = 60_000` constant near the component; change `Math.max(maxEnd - start, 1)` to `Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS)` on line 196.

## Verification

- [ ] `pnpm build` completes with zero errors
- [ ] `pnpm type-check` passes
- [ ] The `totalSpan` computation uses `Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS)` where `MIN_TIMELINE_WINDOW_MS` equals `60_000`
- [ ] No other lines in the file are changed
