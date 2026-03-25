---
title: Increase minimum timeline span to 5 minutes
created: 2026-03-25
status: pending
---



# Increase minimum timeline span to 5 minutes

## Problem / Motivation

The activity heatstrip was recently integrated into the pipeline view with synced timelines. The minimum timeline window is currently set to 1 minute, which causes short runs to appear overly compressed in the visualization.

## Goal

Increase the minimum timeline span from 1 minute to 5 minutes so that short builds display with a reasonable visual width in the pipeline view.

## Approach

In `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` line 171, change the `MIN_TIMELINE_WINDOW_MS` constant from `60_000` (1 minute) to `300_000` (5 minutes). No other changes are needed — `computeTimeSpan` already references this constant via `Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS)` on line 285.

## Scope

**In scope:**
- Updating the single constant `MIN_TIMELINE_WINDOW_MS` in `thread-pipeline.tsx`

**Out of scope:**
- Any other timeline or heatstrip behavior changes

## Acceptance Criteria

1. `MIN_TIMELINE_WINDOW_MS` is set to `300_000` in `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`.
2. `pnpm type-check` passes with no type errors.
3. `pnpm test` passes with no test failures.
4. Visual verification: opening the monitor on a short build confirms the timeline spans at least 5 minutes.
