---
title: Rename Heatmap Tab to "Changes" + Fix Tooltip
created: 2026-03-20
status: pending
---

## Problem / Motivation

The diff viewer build added a diff panel to the heatmap component but didn't rename the tab. The tab now shows both a file heatmap and per-file diffs, making "Heatmap" an inaccurate label. Additionally, the disabled tooltip ("Available for multi-plan runs") doesn't explain what the tab actually shows, and the enable condition (`isMultiPlan`) is wrong - the tab should be available whenever files have been modified, not only for multi-plan runs.

## Goal

Rename the "Heatmap" tab to "Changes," fix the enabled condition to activate when any files are modified, and update the disabled tooltip to accurately describe availability.

## Approach

All changes are in `src/monitor/ui/src/app.tsx`:

1. Rename the tab label from `Heatmap` to `Changes`
2. Rename the internal tab value from `'heatmap'` to `'changes'` across the file:
   - `ContentTab` type on line 21: `'heatmap'` → `'changes'`
   - All `setActiveTab('heatmap')` → `setActiveTab('changes')`
   - All `activeTab === 'heatmap'` → `activeTab === 'changes'`
   - `tabClass('heatmap', ...)` → `tabClass('changes', ...)`
3. Change the enabled condition from `isMultiPlan` to `runState.fileChanges.size > 0` (lines 219-226)
4. Rename the variable on line 145 from `const heatmapEnabled = isMultiPlan` to `const changesEnabled = runState.fileChanges.size > 0`
5. Update the fallback check on line 166 to reference `changesEnabled`
6. Update the disabled tooltip from `"Available for multi-plan runs"` to `"Available after files are modified"`

## Scope

**In scope:**
- Tab label rename (`Heatmap` → `Changes`)
- Internal tab value rename (`'heatmap'` → `'changes'`)
- Enabled condition fix (`isMultiPlan` → `runState.fileChanges.size > 0`)
- Variable rename (`heatmapEnabled` → `changesEnabled`)
- Disabled tooltip text update

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm build` compiles without errors
- Monitor shows "Changes" tab instead of "Heatmap"
- Tab enables when any files have been modified, regardless of plan count
- Hovering the disabled "Changes" tab shows the tooltip "Available after files are modified"
