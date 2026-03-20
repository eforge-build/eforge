---
id: plan-01-rename-changes-tab
name: Rename Heatmap Tab to Changes and Fix Enable Condition
depends_on: []
branch: rename-heatmap-tab-to-changes-fix-tooltip/rename-changes-tab
---

# Rename Heatmap Tab to Changes and Fix Enable Condition

## Architecture Context

The monitor UI has a tabbed content area in `app.tsx`. The "Heatmap" tab was extended with a diff viewer but the tab label, internal value, enable condition, and tooltip were not updated to reflect the broader scope.

## Implementation

### Overview

Rename the tab from "Heatmap" to "Changes" across all references in `app.tsx`, fix the enable condition to check for file modifications instead of multi-plan status, and update the disabled tooltip.

### Key Decisions

1. Use `runState.fileChanges.size > 0` as the enable condition - this activates the tab whenever any files have been modified, regardless of plan count
2. Rename internal tab value from `'heatmap'` to `'changes'` for consistency with the visible label

## Scope

### In Scope
- Tab label: `Heatmap` → `Changes`
- `ContentTab` type: `'heatmap'` → `'changes'`
- All `setActiveTab('heatmap')` → `setActiveTab('changes')`
- All `activeTab === 'heatmap'` → `activeTab === 'changes'`
- All `tabClass('heatmap', ...)` → `tabClass('changes', ...)`
- Variable rename: `heatmapEnabled` → `changesEnabled`
- Condition change: `isMultiPlan` → `runState.fileChanges.size > 0`
- Tooltip: `"Available for multi-plan runs"` → `"Available after files are modified"`

### Out of Scope
- Component renaming (`FileHeatmap`)
- Any other tabs or components

## Files

### Modify
- `src/monitor/ui/src/app.tsx` — Rename tab value/label, fix enable condition, update tooltip text, rename variable

## Verification

- [ ] `pnpm build` completes with zero errors
- [ ] `ContentTab` type includes `'changes'` and does not include `'heatmap'`
- [ ] Tab button text reads "Changes"
- [ ] `changesEnabled` is defined as `runState.fileChanges.size > 0`
- [ ] Disabled tooltip text is "Available after files are modified"
- [ ] No remaining references to `heatmapEnabled` or `'heatmap'` as a tab value in `app.tsx`
