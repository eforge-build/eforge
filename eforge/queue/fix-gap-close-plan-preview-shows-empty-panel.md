---
title: Fix: Gap Close plan preview shows empty panel
created: 2026-04-04
---



# Fix: Gap Close plan preview shows empty panel

## Problem / Motivation

When the monitor UI displays a build with a PRD gap-closing stage, clicking the "Gap Close" swimlane pill or timeline links opens the Plan Preview panel with "Plan 'gap-close' not found." The gap-closer agent generates a plan markdown and passes it to the build pipeline, but this plan body is never emitted in any event - so neither the client-side `planArtifacts` nor the server-side `/api/plans` endpoint can find it.

## Goal

Emit a new `gap_close:plan_ready` event from the gap-closer after plan generation, then consume it on both the server and client side to populate the preview panel so users can view the gap-close plan inline.

## Approach

Add a `gap_close:plan_ready` event type to the engine event system. The gap-closer agent yields this event after generating the plan markdown. The monitor server includes it in the `/api/plans` response, the client extracts it into `planArtifacts`, and the timeline event card renders a summary and detail view for it.

### 1. Add `gap_close:plan_ready` event type
**File:** `src/engine/events.ts` (~line 251)

Add after `gap_close:complete`:
```typescript
| { type: 'gap_close:plan_ready'; planBody: string; gaps: PrdValidationGap[] }
```

### 2. Emit the event from gap-closer
**File:** `src/engine/agents/gap-closer.ts` (after line 98, before "Stage 2" comment)

```typescript
yield {
  timestamp: new Date().toISOString(),
  type: 'gap_close:plan_ready',
  planBody: planMarkdown,
  gaps: options.gaps,
};
```

### 3. Server: include gap-close plan in `/api/plans` response
**File:** `src/monitor/server.ts` - in `servePlans()`, after `compiledPlans` extraction (~line 480)

Look up `gap_close:plan_ready` events and append to `compiledPlans`:
```typescript
const gapCloseEvents = db.getEventsByTypeForSession(sessionId, 'gap_close:plan_ready');
if (gapCloseEvents.length > 0) {
  try {
    const data = JSON.parse(gapCloseEvents[gapCloseEvents.length - 1].data);
    compiledPlans.push({
      id: 'gap-close',
      name: 'PRD Gap Close',
      body: data.planBody,
      dependsOn: [],
      type: 'plan' as const,
    });
  } catch { /* ignore */ }
}
```

Use last event (`length - 1`) in case multiple gap-close rounds occurred. This fixes the event card timeline links which call `openPreview(planId)` triggering an API lookup.

### 4. Client: include gap-close in planArtifacts
**File:** `src/monitor/ui/src/app.tsx` - in `planArtifacts` useMemo (~line 217)

Add a check for `gap_close:plan_ready` events inside the loop:
```typescript
if (event.type === 'gap_close:plan_ready' && !seen.has('gap-close')) {
  seen.add('gap-close');
  plans.push({ id: 'gap-close', name: 'PRD Gap Close', body: event.planBody });
}
```

This makes the swimlane pill use `openContentPreview` (the `planArtifact` branch in `PlanRow`) instead of the fallback `openPreview` path.

### 5. Timeline event card: handle new event
**File:** `src/monitor/ui/src/components/timeline/event-card.tsx`

In `eventSummary()`:
```typescript
case 'gap_close:plan_ready': {
  const gapCount = event.gaps?.length ?? 0;
  return `Gap close plan generated (${gapCount} gap${gapCount !== 1 ? 's' : ''})`;
}
```

In `eventDetail()`:
```typescript
case 'gap_close:plan_ready': {
  const parts: string[] = [];
  for (const gap of (event.gaps ?? [])) {
    const complexitySuffix = gap.complexity ? ` [${gap.complexity}]` : '';
    parts.push(`Requirement: ${gap.requirement}${complexitySuffix}\n  Gap: ${gap.explanation}`);
  }
  return parts.join('\n\n') || null;
}
```

## Scope

**In scope:**
- New `gap_close:plan_ready` event type in `src/engine/events.ts`
- Yielding the event from `src/engine/agents/gap-closer.ts`
- Server-side inclusion of the gap-close plan in `/api/plans` response in `src/monitor/server.ts`
- Client-side extraction into `planArtifacts` in `src/monitor/ui/src/app.tsx`
- Timeline event card summary and detail rendering in `src/monitor/ui/src/components/timeline/event-card.tsx`

**Out of scope:**
- Changes to the gap-closer agent logic itself (plan generation, gap detection)
- Changes to the PRD validation pipeline
- Any other event types or monitor UI panels

**Files to modify:**

| File | Change |
|------|--------|
| `src/engine/events.ts` | Add `gap_close:plan_ready` event variant |
| `src/engine/agents/gap-closer.ts` | Yield event after plan generation |
| `src/monitor/server.ts` | Include gap-close plan in API response |
| `src/monitor/ui/src/app.tsx` | Extract plan into `planArtifacts` |
| `src/monitor/ui/src/components/timeline/event-card.tsx` | Summary/detail for new event |

## Acceptance Criteria

- `pnpm build` completes with no type errors
- `pnpm test` passes with no regressions
- Running a build with PRD validation that finds gaps confirms:
  - The Gap Close swimlane pill opens the preview panel with the generated plan markdown (no longer shows "Plan 'gap-close' not found.")
  - Timeline "PRD Gap Close" links open the same preview content
  - The `gap_close:plan_ready` event appears in the timeline with gap details expandable (showing requirement, explanation, and complexity)
