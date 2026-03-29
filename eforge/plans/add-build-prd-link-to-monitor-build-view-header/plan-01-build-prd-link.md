---
id: plan-01-build-prd-link
name: Add Build PRD Link to Monitor Build View Header
depends_on: []
branch: add-build-prd-link-to-monitor-build-view-header/build-prd-link
---

# Add Build PRD Link to Monitor Build View Header

## Architecture Context

The monitor UI (`src/monitor/ui/src/app.tsx`) renders a build view with `SummaryCards` at the top. The `usePlanPreview()` hook already exposes `openContentPreview(title, content)` for sliding in a markdown viewer panel - this is used by the timeline's "view source" link on `plan:start` events in `event-card.tsx` (line 245). The `plan:start` event carries a `source` field containing the PRD content and an optional `label` field.

Currently, `AppContent` only destructures `setRuntimeData` from `usePlanPreview()`. The `openContentPreview` function is available but unused in `app.tsx`.

## Implementation

### Overview

Add a "Build PRD" link right-justified next to the `SummaryCards` component. The link derives PRD content from the first `plan:start` event in `runState.events` and opens it via `openContentPreview`.

### Key Decisions

1. Derive PRD source from the first `plan:start` event using `useMemo` - this is the same data source the timeline's "view source" link uses, ensuring consistency.
2. Wrap `SummaryCards` in a flex container with `items-center justify-between` so the link sits right-justified on the same row.
3. Only render the link after a `plan:start` event exists - before that, the PRD content is not available.

## Scope

### In Scope
- Destructure `openContentPreview` from `usePlanPreview()` in `AppContent`
- Add a `useMemo` to find the first `plan:start` event and extract its `source` and `label`
- Wrap `SummaryCards` in a flex container
- Add a conditionally rendered "Build PRD" link styled with `text-blue cursor-pointer hover:underline text-xs`

### Out of Scope
- Changes to other components or files
- New preview mechanisms
- Changes to the timeline's existing "view source" link

## Files

### Modify
- `src/monitor/ui/src/app.tsx` - Destructure `openContentPreview` from `usePlanPreview()`, add `useMemo` for PRD source derivation, wrap `SummaryCards` in flex container with right-justified "Build PRD" link

## Verification

- [ ] `openContentPreview` is destructured from `usePlanPreview()` alongside `setRuntimeData` on the existing line 43
- [ ] A `useMemo` derives `prdSource` (object with `label` and `content` fields, or `null`) from the first event where `event.type === 'plan:start'` in `runState.events`
- [ ] `SummaryCards` is wrapped in a `<div className="flex items-center justify-between">` container
- [ ] When `prdSource` is non-null, a `<span>` with text "Build PRD" appears inside the flex container, right-justified
- [ ] The span has className `text-blue cursor-pointer hover:underline text-xs`
- [ ] Clicking the span calls `openContentPreview(prdSource.label, prdSource.content)`
- [ ] When `prdSource` is null (no `plan:start` event yet), no link is rendered
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm --filter monitor-ui build` succeeds
