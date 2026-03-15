---
id: plan-01-monitor-ui-improvements
name: Monitor UI Improvements
depends_on: []
branch: monitor-ui-improvements/main
---

# Monitor UI Improvements

## Context

The eforge monitor dashboard is functional but visually static - active build stages look the same as just-started ones, and `eforge run` sessions (which create separate plan + build runs) appear as disconnected items in the sidebar. The roadmap already calls out session-aware grouping. This plan adds session orientation, animated stage visualization, and a handful of polish improvements that make the monitor feel alive while a build runs.

## 1. Session-Aware Sidebar

The DB plumbing is already in place (`session_id` column, `getRunsBySession()`, `/api/runs` returns `sessionId` via column alias). The gap is purely UI-side.

### Changes

**`src/monitor/ui/src/lib/types.ts`** - Add `sessionId?: string` to `RunInfo` (the field is already in the JSON response, just not declared)

**`src/monitor/ui/src/lib/session-utils.ts`** (new) - Session grouping logic:
- `SessionGroup` type: `{ key, label, isSession, runs, status, startedAt, completedAt? }`
- `groupRunsBySessions(runs)`: groups runs sharing a `sessionId` into one group with `isSession: true`. Runs without a session fall back to `planSet` grouping (current behavior). Status rollup: any running = running, any failed = failed, else completed. Duration: earliest start to latest completion.
- Within each group, sort plan/adopt before build, then chronological. Groups sorted newest-first.

**`src/monitor/ui/src/components/layout/sidebar.tsx`** - Replace `groupByPlanSet` with `groupRunsBySessions`. `GroupHeader` gets a session indicator (e.g. `Link2` icon from lucide) when `isSession: true`, plus a status dot showing session-level status.

**`src/monitor/ui/src/components/layout/run-item.tsx`** - Add optional `compact?: boolean` prop. When compact (inside a session group), suppress the planSet subtitle since the group header already shows it.

## 2. Animated Active Pipeline Stages

Currently `pipeline-row.tsx` uses a flat `bg-blue/20` for all active stages. The DAG graph already has stage-specific colors (blue/purple/cyan) and pulse animation - the pipeline should match.

### Changes

**`src/monitor/ui/src/globals.css`** - Add keyframes:
```css
@keyframes stage-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--stage-glow-color); }
  50% { box-shadow: 0 0 8px 2px var(--stage-glow-color); }
}

@keyframes stage-shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}

@keyframes stage-complete-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
```

**`src/monitor/ui/src/components/pipeline/pipeline-row.tsx`** - Major rework of stage styling:

- **Stage-specific colors** (matching graph-status.ts palette):
  - implement: blue (`bg-blue/20 text-blue`, glow `rgba(88,166,255,0.4)`)
  - review: purple (`bg-purple/20 text-purple`, glow `rgba(188,140,255,0.4)`)
  - evaluate: cyan (`bg-cyan/20 text-cyan`, glow `rgba(57,210,192,0.4)`)

- **Active stage animation**: Combine `stage-pulse` (breathing box-shadow glow, 2s cycle) + `stage-shimmer` (gradient sweep, 2.5s cycle) on the active pill. Set `--stage-glow-color` via inline style.

- **Completion pop**: Track previous stage via `useRef`. When stage advances, apply `stage-complete-pop` (400ms, one-shot) to the newly-completed pill. Clear via `setTimeout`.

- **Connectors**: Small 2px-wide dividers between stage pills. Color transitions from gray to the next stage's accent when stages advance (`transition: background-color 0.3s`).

## 3. Additional Improvements

### 3a. Activity Heatstrip

A single-row heatmap strip between SummaryCards and Pipeline showing event density over time. Each cell = 30-second bucket, colored from cool (idle) to warm (busy). Gives a "heartbeat" view - idle gaps and burst periods are instantly visible. The rightmost cell (current window) pulses.

**`src/monitor/ui/src/components/common/activity-heatstrip.tsx`** (new) - Accepts `events` + `startTime`. Buckets events, renders as a flex row of tiny colored cells (4px wide, 16px tall). Color scale: bg-tertiary (0) through blue, cyan, yellow, orange by density. Time labels every 5 minutes.

**`src/monitor/ui/src/app.tsx`** - Render `<ActivityHeatstrip>` between SummaryCards and Pipeline.

### 3b. Animated Token/Cost Counters

Replace static number display in Tokens and Cost summary cards with smoothly counting animations. When `agent:result` events arrive (causing jumps), the numbers ramp up over ~300ms with an easing curve. Brief delta flash (`+1.2k`) fades alongside.

**`src/monitor/ui/src/components/common/animated-counter.tsx`** (new) - Uses `requestAnimationFrame` to interpolate from previous to current value. `useRef` tracks prev value. Delta badge fades via CSS opacity transition.

**`src/monitor/ui/src/components/common/summary-cards.tsx`** - Swap static `{value}` with `<AnimatedCounter>` for Tokens and Cost cards.

### 3c. Review Issue Severity Gauge

After `build:review:complete`, show a compact horizontal gauge in the pipeline row with severity distribution - red (critical), yellow (warning), gray (suggestion). Small count badges below.

**`src/monitor/ui/src/lib/reducer.ts`** - Add `reviewIssues: Record<string, ReviewIssue[]>` to `RunState`. Populate on `build:review:complete`.

**`src/monitor/ui/src/components/pipeline/review-gauge.tsx`** (new) - Horizontal stacked bar + counts.

**`src/monitor/ui/src/components/pipeline/pipeline-row.tsx`** - Render gauge below stage pills when review data exists. Accept `reviewIssues` prop.

**`src/monitor/ui/src/components/pipeline/pipeline.tsx`** - Thread `reviewIssues` from parent.

## File Change Summary

| File | Action | What |
|------|--------|------|
| `lib/types.ts` | modify | Add `sessionId` to `RunInfo` |
| `lib/session-utils.ts` | new | Session grouping logic |
| `layout/sidebar.tsx` | modify | Session-aware grouping |
| `layout/run-item.tsx` | modify | Compact mode for session groups |
| `globals.css` | modify | Animation keyframes |
| `pipeline/pipeline-row.tsx` | modify | Stage colors, animations, connectors, review gauge slot |
| `pipeline/pipeline.tsx` | modify | Thread events + reviewIssues props |
| `pipeline/review-gauge.tsx` | new | Review severity gauge |
| `common/activity-heatstrip.tsx` | new | Event density heatstrip |
| `common/animated-counter.tsx` | new | Smooth counting animation |
| `common/summary-cards.tsx` | modify | Use AnimatedCounter |
| `lib/reducer.ts` | modify | Add reviewIssues to RunState |
| `app.tsx` | modify | Wire heatstrip, thread events to Pipeline |

All paths relative to `src/monitor/ui/src/components/` or `src/monitor/ui/src/`.

## Sequencing

**Phase 1** (core, independent tracks):
- Track A: Session sidebar (types.ts → session-utils.ts → sidebar.tsx + run-item.tsx)
- Track B: Pipeline animations (globals.css → pipeline-row.tsx)

**Phase 2** (polish, all independent):
- Activity heatstrip
- Animated counters
- Review severity gauge

## Verification

1. `pnpm build` - ensure no type errors
2. `pnpm test` - existing tests pass
3. Manual testing with monitor:
   - Run `pnpm dev -- run <prd>` and open monitor at localhost:4567
   - Verify sidebar groups plan+build under one session header
   - Verify active pipeline stage pulses/shimmers with correct color per stage
   - Verify stage transition triggers completion pop on the previous stage
   - Verify heatstrip renders and updates as events arrive
   - Verify token/cost counters animate on jumps
   - Verify review gauge appears after review:complete events
4. Test degradation: runs without sessionId should group by planSet as before
