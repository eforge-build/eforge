---
title: Fix pipeline swimlane indentation for dependent plans
created: 2026-04-01
---



# Fix pipeline swimlane indentation for dependent plans

## Problem / Motivation

The previous build applied `marginLeft` on PlanRow's outer div, which shifts the entire row (pill + swimlane) right. This misaligns the swimlane bars across rows at different depth levels. Only the pill label should be indented, not the swimlane itself.

Additionally, the `ThreadLineGutter` component provides a vertical connecting bar that doesn't work well with the row-based flex layout.

## Goal

Indent only the pill label for dependent plans while keeping swimlane bars aligned across all rows, and remove the unnecessary `ThreadLineGutter` component.

## Approach

- **File**: `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`
- In PlanRow's render, remove the `marginLeft` from the outer container div.
- Apply `paddingLeft: (depth ?? 0) * DEPTH_LEVEL_WIDTH` on the `leftLabel` wrapper divs (the `w-[100px] shrink-0` elements at ~lines 755, 772, 796). Since Tailwind's default `box-sizing: border-box` means padding eats into the 100px width, the pill text shifts right while the swimlane stays aligned across all rows.
- Remove the `ThreadLineGutter` component and any references to it. Indentation alone is sufficient; the Graph tab handles dependency visualization.

## Scope

**In scope:**
- Removing `marginLeft` from PlanRow's outer container div
- Adding `paddingLeft` based on depth to the `leftLabel` wrapper divs
- Removing the `ThreadLineGutter` component and all references to it

**Out of scope:**
- Dependency visualization (handled by the Graph tab)

## Acceptance Criteria

- PlanRow outer container div has no `marginLeft` based on depth
- The `leftLabel` wrapper divs (`w-[100px] shrink-0` elements at ~lines 755, 772, 796) apply `paddingLeft: (depth ?? 0) * DEPTH_LEVEL_WIDTH`
- Pill text for dependent plans is visually indented proportional to depth
- Swimlane bars remain vertically aligned across all rows regardless of depth
- `ThreadLineGutter` component and all references to it are removed
- No regressions in pipeline rendering for plans at depth 0
