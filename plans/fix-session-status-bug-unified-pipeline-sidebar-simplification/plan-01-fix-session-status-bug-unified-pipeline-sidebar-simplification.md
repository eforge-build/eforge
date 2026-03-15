---
id: plan-01-fix-session-status-bug-unified-pipeline-sidebar-simplification
name: "Fix: Session status bug + unified pipeline + sidebar simplification"
depends_on: []
branch: fix-session-status-bug-unified-pipeline-sidebar-simplification/main
---

# Fix: Session status bug + unified pipeline + sidebar simplification

## Context

Three related issues in the session-scoped monitor, all stemming from the old run-centric design leaking through:

1. **Status bug**: Summary card shows "Completed" while build is actively running. The reducer sets `isComplete` on `phase:end` (fires after plan phase), but the session isn't done until `session:end`. The hook also caches aggressively during the gap between plan completion and build start.

2. **Missing plan stage**: Pipeline only shows build stages (implement → review → evaluate → complete). Planning should be the first stage.

3. **Sidebar still run-centric**: Shows collapsible groups with individual runs (plan, build) as selectable sub-items. With session-scoped viewing, each entry should be a flat session card - no expand/collapse, no sub-items. Just a list of sessions with status details.

## Changes

### 1. Reducer: Use `session:end` for completion (`src/monitor/ui/src/lib/reducer.ts`)

- **`phase:end`**: Do NOT set `isComplete` or `resultStatus`.
- **`session:end`**: Set `isComplete = true` and `resultStatus` from `event.result.status`.
- **`plan:complete`**: Initialize `planStatuses[plan.id] = 'plan'` for each plan in the event.

### 2. Hook: Cache based on `session:end` event (`src/monitor/ui/src/hooks/use-eforge-events.ts`)

After batch-loading events, check if any event has `type === 'session:end'` instead of using `data.status` from server. If `session:end` is present → cache and skip SSE. Otherwise → open SSE for live updates.

### 3. Pipeline: Add 'plan' as first stage

**`src/monitor/ui/src/lib/types.ts`**:
```typescript
export type PipelineStage = 'plan' | 'implement' | 'review' | 'evaluate' | 'complete' | 'failed';
```

Also add `session:end` and `plan:complete` to the UI's `EforgeEvent` type union.

**`src/monitor/ui/src/components/pipeline/pipeline-row.tsx`**:
```typescript
const STAGES: PipelineStage[] = ['plan', 'implement', 'review', 'evaluate', 'complete'];
```

Add plan stage color:
```typescript
plan: { bg: 'bg-yellow/20', text: 'text-yellow', glow: 'rgba(227,179,65,0.4)' },
```

### 4. Sidebar: Flat session list (`src/monitor/ui/src/components/layout/sidebar.tsx`)

Replace the current collapsible group + run sub-item design with a flat list of session cards. Each card shows:
- Status icon (running/completed/failed) - use `SessionGroup.status` rollup
- Plan set name (label)
- Relative time ("5m ago")
- Duration
- Run count badge (e.g. "2 runs" if multi-phase)

No expand/collapse, no sub-items. Clicking a card selects that session. Active card gets the highlight ring.

Props simplify:
- `currentRunId` → `currentSessionId`
- `onSelectRun` → `onSelectSession` (passes `sessionId`)

The `SessionGroup` data from `session-utils.ts` already has everything needed (key, label, status, startedAt, completedAt, runs array). Reuse `groupRunsBySessions` as-is - just render each group as a single flat card instead of a collapsible tree.

`RunItem` component (`src/monitor/ui/src/components/layout/run-item.tsx`) can be deleted or replaced with `SessionItem`.

### 5. App: Wire session selection (`src/monitor/ui/src/app.tsx`)

Already uses `currentSessionId` from the previous session-scoped work. Just update the sidebar props to match the simplified API.

## Files modified

- `src/monitor/ui/src/lib/types.ts` - add 'plan' to PipelineStage, add session:end + plan:complete to EforgeEvent
- `src/monitor/ui/src/lib/reducer.ts` - session:end for isComplete, plan:complete for planStatuses
- `src/monitor/ui/src/hooks/use-eforge-events.ts` - cache on session:end event presence
- `src/monitor/ui/src/components/pipeline/pipeline-row.tsx` - add 'plan' to STAGES + color
- `src/monitor/ui/src/components/layout/sidebar.tsx` - flat session cards, remove collapsible groups
- `src/monitor/ui/src/components/layout/run-item.tsx` - delete or replace with SessionItem
- `src/monitor/ui/src/app.tsx` - update sidebar props if needed

## Verification

1. `pnpm build`
2. `eforge run` on a PRD, open monitor
3. Status stays "Running" through both plan and build phases, "Completed" only after session:end
4. Pipeline shows: plan → implement → review → evaluate → complete
5. Sidebar shows flat session list - no sub-items, no expand/collapse
6. Clicking a session selects it, shows all events from that session
7. `pnpm test` passes
