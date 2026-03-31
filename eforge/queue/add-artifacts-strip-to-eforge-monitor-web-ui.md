---
title: Add Artifacts Strip to eforge Monitor Web UI
created: 2026-03-31
status: pending
---



# Add Artifacts Strip to eforge Monitor Web UI

## Problem / Motivation

Planning artifacts in the eforge monitor web UI are scattered across the interface. The Build PRD is a small blue link tucked in the top-right corner, and plan files are only accessible via swim lane labels in the ThreadPipeline. There is no cohesive, always-visible listing that consolidates all planning artifacts in one place, making them hard to discover and access.

## Goal

Provide a compact, always-visible horizontal bar that consolidates all planning artifacts (Build PRD, plan files, architecture doc) as clickable links in a single dense strip between the ThreadPipeline and the tab bar.

## Approach

- Create a new component `src/monitor/ui/src/components/common/artifacts-strip.tsx` that renders a horizontal bar of clickable artifact links.
- The component uses the existing `usePlanPreview()` context to access artifact data - no new APIs or reducer changes needed.
- Modify `src/monitor/ui/src/app.tsx` to:
  - Move the existing PRD link out of the top-right and into the strip.
  - Insert the strip between the ThreadPipeline and the tab bar.

## Scope

**In scope:**
- New `artifacts-strip.tsx` component
- Modifications to `app.tsx` (move PRD link, insert strip)
- Displaying Build PRD, plan files, and architecture doc as clickable links

**Out of scope:**
- Reducer changes
- New APIs
- Changes to existing data fetching or context providers

## Acceptance Criteria

- A horizontal "Artifacts Strip" bar is rendered between the ThreadPipeline and the tab bar.
- The strip consolidates all planning artifacts: Build PRD, plan files, and architecture doc as clickable links.
- The existing PRD link is removed from its current top-right position and rendered within the strip instead.
- The strip uses the existing `usePlanPreview()` context for data.
- The component lives at `src/monitor/ui/src/components/common/artifacts-strip.tsx`.
- No new APIs are introduced and no reducer changes are made.
- The strip is compact, dense, and always visible.
