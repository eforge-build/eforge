---
title: Add Build Metrics to Monitor UI Summary Cards
created: 2026-03-31
status: pending
---



# Add Build Metrics to Monitor UI Summary Cards

## Problem / Motivation

The monitor UI's SummaryCards strip currently shows only Status, Duration, Plans, Tokens, Cost, and Backend. This doesn't give a full picture of build activity. Key metrics like work volume (agent turns), tangible output (files changed), and quality signals (review issues) are missing from the summary view, requiring users to drill into individual plans to get this information. All the necessary data is already accumulated in `RunState` - it just isn't surfaced.

## Goal

Add three new summary metrics - Agent Turns, Files Changed, and Review Issues - to the SummaryCards strip, giving users a fuller at-a-glance view of build activity without any new event tracking.

## Approach

This is purely a UI/derivation change with no new event tracking required. The implementation touches three areas:

1. **Derive new stats from existing `RunState`** in `getSummaryStats()` (`src/monitor/ui/src/lib/reducer.ts`):
   - `totalTurns: number` - sum of `agentThreads[].numTurns`
   - `filesChanged: number` - unique count from `fileChanges` Map values
   - `reviewCritical: number` and `reviewWarning: number` - aggregated from `reviewIssues` values

2. **Render new cards** in `src/monitor/ui/src/components/common/summary-cards.tsx`:
   - Add `totalTurns`, `filesChanged`, `reviewCritical`, `reviewWarning` to `SummaryCardsProps`
   - Import `MessageSquare`, `FileCode`, `AlertTriangle` from lucide-react
   - Three new conditionally-rendered `<StatGroup>` blocks:
     - **Turns**: `MessageSquare` icon + `AnimatedCounter` + "turns" label (when > 0)
     - **Files**: `FileCode` icon + `AnimatedCounter` + "files" label (when > 0)
     - **Issues**: `AlertTriangle` icon + red critical count / yellow warning count + "issues" label (when > 0)
   - Turns and files use `AnimatedCounter`; issues use color-coded static text (split red/yellow rendering)

3. **No changes needed in `src/monitor/ui/src/app.tsx`** - `getSummaryStats()` return is spread into `<SummaryCards {...stats}>` so new fields flow through automatically.

**Card ordering**: Status | Duration | Plans | **Turns** | Tokens | Cost | **Files** | **Issues** - input/effort metrics grouped together, output/quality metrics at the end.

## Scope

**In scope:**
- Deriving `totalTurns`, `filesChanged`, `reviewCritical`, `reviewWarning` from existing `RunState` data in `getSummaryStats()`
- Adding three new `<StatGroup>` blocks to the SummaryCards component
- Conditional rendering (metrics hidden when value is 0)

**Out of scope:**
- Agent call count (already visible in ThreadPipeline)
- Tool call count (too granular for summary level - can add later if desired)
- Any changes to `RunState` or `processEvent`
- Any new event tracking

## Acceptance Criteria

1. `pnpm build` completes with no type errors.
2. `pnpm test` passes all existing tests.
3. Opening the monitor UI against a completed build session shows the new Turns, Files, and Issues metrics with correct values.
4. New metrics do not render when their values are 0 (e.g., before any agent results arrive).
5. The SummaryCards strip wraps gracefully on narrower viewports.
6. Card ordering is: Status | Duration | Plans | Turns | Tokens | Cost | Files | Issues.
7. Issues card displays critical count in red and warning count in yellow.
8. Turns and Files cards use `AnimatedCounter`; Issues card uses color-coded static text.
