---
title: Remove timeline card wrappers for compact rows
created: 2026-03-25
status: pending
---



# Remove timeline card wrappers for compact rows

## Problem / Motivation

Each timeline event row in the monitor UI is wrapped in a `div` with `bg-card border border-border rounded-md px-3 py-2 shadow-sm` styling, giving each row a card appearance. This wastes vertical space and adds visual noise.

## Goal

Remove the card wrapper styling from timeline event rows to make them more compact, flush, and readable.

## Approach

Strip card-related CSS classes (background, border, rounded corners, shadow) from the event card outer `div` and reduce padding. Remove the `gap-1` spacing between cards in the timeline container since row padding alone provides sufficient spacing.

### `src/monitor/ui/src/components/timeline/event-card.tsx` (line 213-216)

Replace the outer div's card classes:

```
// Before
'bg-card border border-border rounded-md px-3 py-2 flex items-start gap-2.5 shadow-sm shadow-black/10'

// After
'px-2 py-1 flex items-start gap-2.5'
```

For the verbose variant:

```
// Before
isVerbose && 'opacity-50 border-border/50 bg-card/50 shadow-none'

// After
isVerbose && 'opacity-50'
```

### `src/monitor/ui/src/components/timeline/timeline.tsx` (line 12)

Remove the `gap-1` between cards:

```
// Before
'flex flex-col gap-1 flex-1'

// After
'flex flex-col flex-1'
```

## Scope

**In scope:**
- Removing card wrapper styling from timeline event rows in `event-card.tsx`
- Removing inter-card gap in `timeline.tsx`

**Out of scope:**
- Any other timeline component changes
- Functional or behavioral changes to timeline events

## Acceptance Criteria

- `pnpm build` completes with no build errors.
- Timeline rows render flush (no individual card borders, backgrounds, rounded corners, or shadows).
- Timeline rows are visually compact and readable.
- Verbose variant rows still appear at reduced opacity (`opacity-50`).
