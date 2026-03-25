---
title: Remove Plans Tab, Enhance Slide-in Preview, Default to Changes Tab
created: 2026-03-25
status: pending
---

# Remove Plans Tab, Enhance Slide-in Preview, Default to Changes Tab

## Problem / Motivation

The monitor UI currently has three tabs: Changes, Plans, and Graph. Plan details can be viewed both in the Plans tab (as collapsible cards) and in a slide-in panel triggered by clicking plan IDs in the pipeline. This creates redundancy — two separate surfaces for viewing plan information. The slide-in panel is the more natural interaction point (contextual, triggered from the pipeline), but it is currently missing several details that the Plans tab provides (build config, file changes, status badges). Additionally, the Changes tab is conditionally disabled when no file changes exist, which creates an awkward default tab selection flow.

## Goal

Remove the Plans tab entirely, promote the slide-in preview panel to be the single surface for viewing plan details (with full parity to what the Plans tab showed), and make the Changes tab the always-enabled default tab with placeholder text when empty.

## Approach

### 1. Enhance `PlanPreviewPanel` with missing details from PlanCard

**File**: `src/monitor/ui/src/components/preview/plan-preview-panel.tsx`

The slide-in panel currently shows: `PlanMetadata` (name, id, branch, deps, migrations) + `PlanBodyHighlight`. It is missing:
- **BuildConfigSection** (build pipeline stages + review config)
- **Files changed** list
- **Status badge**
- **Module status badge**

Changes:
- Import `BuildConfigSection` from `@/components/plans/build-config`
- The panel already fetches `PlanData[]` from the API which includes `build` and `review` fields — render them
- For `planStatuses`, `fileChanges`, and `moduleStatuses`, pass these through the `PlanPreviewContext` (or add new props) so the panel can display status badges and file changes
- Render order in the content area (for a selected plan):
  1. Status badge + module status badge (in header area, next to plan name)
  2. PlanMetadata card (existing)
  3. BuildConfigSection (new — from `selectedPlan.build` and `selectedPlan.review`)
  4. Files changed pills (new — from context data)
  5. PlanBodyHighlight (existing)

### 2. Extend `PlanPreviewContext` to carry runtime state

**File**: `src/monitor/ui/src/components/preview/plan-preview-context.tsx`

Add optional runtime data to context so the slide-in panel can render status/files without prop drilling:
- Add `planStatuses: Record<string, PipelineStage>`
- Add `fileChanges: Map<string, string[]>`
- Add `moduleStatuses: Record<string, ModuleStatus>`
- Add setter (`setRuntimeData`) called from `App` to keep these in sync

### 3. Remove Plans tab from App

**File**: `src/monitor/ui/src/app.tsx`

- Change `ContentTab` type from `'plans' | 'graph' | 'changes'` to `'changes' | 'graph'`
- Change default `activeTab` from `'plans'` to `'changes'`
- Remove the Plans tab button from the tab bar
- Remove the Plans tab content rendering (`activeTab === 'plans'` branch)
- Remove the `PlanCards` import
- Remove `hasAnyPlanContent` variable (no longer needed)
- Update tab reset logic: when graph becomes unavailable, fall back to `'changes'` instead of `'plans'`
- Pass `planStatuses`, `fileChanges`, `moduleStatuses` into the `PlanPreviewProvider` (or call the setter)

### 4. Changes tab always enabled with placeholder

**File**: `src/monitor/ui/src/app.tsx`

- Remove the `changesEnabled` guard — Changes tab is always clickable
- Remove `disabled={!changesEnabled}` from the Changes button
- Always use enabled tab styling for Changes
- When `activeTab === 'changes'` and `fileChanges.size === 0`, show placeholder text: `"Changes will appear here once files are modified..."`
- When `fileChanges.size > 0`, show the existing `FileHeatmap` as before
- Remove the `useEffect` that resets `activeTab` when `changesEnabled` becomes false (no longer needed since Changes is always available)

### 5. Move StatusBadge and ModuleStatusBadge to shared location

**File**: `src/monitor/ui/src/components/plans/plan-card.tsx` → extract to shared

Since `PlanCard` is only used by `PlanCards` (which is being removed from the tab), but the slide-in panel needs `StatusBadge` and `ModuleStatusBadge`:
- Preferred approach: export `StatusBadge` and `ModuleStatusBadge` from `plan-card.tsx` so the preview panel can import them (minimal change)
- Alternative: move them to a shared file like `src/monitor/ui/src/components/common/status-badges.tsx` and import from both places
- Keep `plan-card.tsx` and `plan-cards.tsx` files (they may still be useful elsewhere)

### Reusable components (no new code needed)

- `BuildConfigSection` from `src/monitor/ui/src/components/plans/build-config.tsx` — import directly into preview panel
- `StatusBadge` / `ModuleStatusBadge` from `src/monitor/ui/src/components/plans/plan-card.tsx` — just need to export them
- `PlanMetadata` — already in preview panel
- `PlanBodyHighlight` — already in preview panel

## Scope

**In scope:**
- Removing the Plans tab from the tab bar and its content rendering
- Enhancing the `PlanPreviewPanel` slide-in to show build config, file changes, status badge, and module status badge
- Extending `PlanPreviewContext` with runtime state (`planStatuses`, `fileChanges`, `moduleStatuses`)
- Making the Changes tab the default and always-enabled tab
- Adding placeholder text to the Changes tab when no file changes exist
- Exporting `StatusBadge` and `ModuleStatusBadge` for reuse

**Files to modify:**
1. `src/monitor/ui/src/components/preview/plan-preview-context.tsx`
2. `src/monitor/ui/src/components/preview/plan-preview-panel.tsx`
3. `src/monitor/ui/src/components/plans/plan-card.tsx`
4. `src/monitor/ui/src/app.tsx`

**Out of scope:**
- Deleting `plan-card.tsx` or `plan-cards.tsx` files (kept for potential reuse)
- Changes to the Graph tab behavior
- Changes to the pipeline plan ID click interaction (already works)

## Acceptance Criteria

1. `pnpm build` completes without errors for the monitor UI.
2. Changes tab is the default active tab on load.
3. Changes tab is always enabled (never disabled/greyed out), regardless of whether file changes exist.
4. When no files have been changed, the Changes tab displays the placeholder text: `"Changes will appear here once files are modified..."`.
5. When file changes exist, the Changes tab shows the existing `FileHeatmap`.
6. The Plans tab button is no longer present in the tab bar.
7. Clicking a plan ID in the pipeline opens the slide-in preview panel.
8. The slide-in preview panel displays, for a selected plan:
   - Status badge and module status badge (in the header area, next to plan name)
   - PlanMetadata card
   - BuildConfigSection (build pipeline stages + review config)
   - Files changed pills
   - Full plan body (PlanBodyHighlight)
9. The Graph tab still functions correctly when dependency edges exist.
10. When the graph becomes unavailable, the tab falls back to `'changes'` (not `'plans'`).
