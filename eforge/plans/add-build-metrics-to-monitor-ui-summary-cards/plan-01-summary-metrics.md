---
id: plan-01-summary-metrics
name: Add Build Metrics to Summary Cards
depends_on: []
branch: add-build-metrics-to-monitor-ui-summary-cards/summary-metrics
---

# Add Build Metrics to Summary Cards

## Architecture Context

The monitor UI's SummaryCards strip renders at-a-glance build stats. `getSummaryStats()` in `reducer.ts` derives display values from `RunState`, and the result is spread into `<SummaryCards {...stats}>` in `app.tsx`. Adding new metrics requires only: (1) deriving new fields in `getSummaryStats()`, (2) accepting and rendering them in SummaryCards. No changes to `app.tsx` or event processing are needed.

## Implementation

### Overview

Derive `totalTurns`, `filesChanged`, `reviewCritical`, and `reviewWarning` from existing `RunState` fields in `getSummaryStats()`, then render three new conditionally-visible `StatGroup` blocks in `summary-cards.tsx`.

### Key Decisions

1. **Use `AnimatedCounter` for turns and files** - consistent with existing token/cost cards. Issues use static color-coded text because the split red/yellow rendering doesn't fit AnimatedCounter's single-value model.
2. **Deduplicate file paths across plans** - `fileChanges` is `Map<planId, filePaths[]>`, so the same file modified in multiple plans should count once. Use a `Set` to deduplicate.
3. **Handle null `numTurns`** - `AgentThread.numTurns` is `number | null`. Treat null as 0 when summing.
4. **Card ordering** - Insert Turns after Plans (effort metrics grouped), Files and Issues at the end (output/quality metrics).

## Scope

### In Scope
- Deriving `totalTurns`, `filesChanged`, `reviewCritical`, `reviewWarning` in `getSummaryStats()`
- Updating `SummaryCardsProps` interface with new fields
- Three new `StatGroup` blocks: Turns (MessageSquare), Files (FileCode), Issues (AlertTriangle)
- Conditional rendering (hidden when value is 0)
- AnimatedCounter for turns and files; color-coded static text for issues

### Out of Scope
- Changes to `RunState`, `processEvent`, or event types
- Changes to `app.tsx` (spread pattern handles new fields automatically)
- Agent call counts or tool call counts

## Files

### Modify
- `src/monitor/ui/src/lib/reducer.ts` - Add `totalTurns`, `filesChanged`, `reviewCritical`, `reviewWarning` to `getSummaryStats()` return value. Derive from `state.agentThreads`, `state.fileChanges`, and `state.reviewIssues`.
- `src/monitor/ui/src/components/common/summary-cards.tsx` - Add 4 new props to `SummaryCardsProps`. Import `MessageSquare`, `FileCode`, `AlertTriangle` from lucide-react. Add three new `StatGroup` blocks with `Separator` between existing cards. Turns and Files use `AnimatedCounter` with identity formatter. Issues use inline red/yellow spans.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with exit code 0
- [ ] `pnpm test` passes all existing tests
- [ ] `getSummaryStats()` return type includes `totalTurns: number`, `filesChanged: number`, `reviewCritical: number`, `reviewWarning: number`
- [ ] SummaryCards renders card order: Status, Duration, Plans, Turns, Tokens, Cost, Files, Issues
- [ ] Turns card uses `MessageSquare` icon and `AnimatedCounter`
- [ ] Files card uses `FileCode` icon and `AnimatedCounter`
- [ ] Issues card uses `AlertTriangle` icon with critical count in red (`text-red`) and warning count in yellow (`text-yellow`)
- [ ] Cards with value 0 do not render (conditional `{value > 0 && ...}` pattern)
