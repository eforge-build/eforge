---
id: plan-01-depth-guide-bars
name: Replace depth indentation with vertical guide bars in thread-pipeline.tsx
depends_on: []
branch: pipeline-plan-dependency-depth-replace-indentation-with-vertical-guide-bars/depth-guide-bars
---

# Replace depth indentation with vertical guide bars in thread-pipeline.tsx

## Architecture Context

The monitor UI's PIPELINE view (`packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`) renders one row per plan. The leftmost column is a fixed-width label column (`w-[100px]`) containing a clickable plan pill. Today, plan-dependency depth is conveyed by left-padding that column 20px per level (`DEPTH_LEVEL_WIDTH = 20`, line 460). At depth 3+, padding consumes most of the 100px column and the label clips (e.g. "Plan 04" rendering as "Pla").

The label column is rendered in three near-identical branches inside `PlanRow.leftLabel` (lines 732–796): a PRD branch (yellow pill), a plan-with-artifact branch, and a fallback branch. The Compile / global row is rendered with no `depth` prop and must continue to render with no bars and the existing cyan plan pill.

The outer 100px column anchors timeline strip alignment across rows; it must remain `w-[100px] shrink-0` so the timeline area is unaffected.

Depth is computed by `computeDepthMap` (line 427) which already has a cycle guard — no change needed there. The dependency tooltip logic (lines 720–729) is also untouched.

## Implementation

### Overview

Replace per-level padding with a leading row of full-height vertical "guide bars" (one 2px-wide bar per depth level, ~5–6px per level) and tint the plan pill per depth as a redundant color cue. All work is confined to `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`.

### Key Decisions

1. **Static Tailwind class strings for the depth palette.** Tailwind's JIT requires literal class names, so we declare arrays of full class strings rather than interpolating color names. Cycle through the palette with `index % palette.length` for depth > palette length.
2. **`self-stretch` on each bar** so bars span the full row height and read as vertical guide lines linking a plan back to its parent row above.
3. **Tinted pill in addition to bars.** Bars alone are easy to miss at depth 4+; tinting the pill by depth provides a redundant cue. The pill color matches the deepest bar in its bar group because both arrays cycle through the same palette in the same order.
4. **Preserve `planPillClass` constant (line 51)** as the depth-0 default; the Compile / global row keeps using it via `planPillClassFor(0)` semantics (cyan) and renders unchanged. **Preserve `prdPillClass`** (yellow) for the PRD branch — PRD is not a plan, has no depth.
5. **Keep the outer `w-[100px] shrink-0` column.** Convert it from a padded box to a flex row (`flex items-stretch gap-1.5`) holding `<DepthBars />` + the pill wrapper. Timeline strip alignment is preserved.

## Scope

### In Scope

- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` only.
- Remove `DEPTH_LEVEL_WIDTH = 20` constant (line 460) — no longer used.
- Add `DEPTH_BAR_BG`, `DEPTH_PILL_CLASS`, and `planPillClassFor(depth)` near the existing `AGENT_COLORS` / `TIER_COLORS` (~lines 14–76 region, after the existing pill constants). Use static class strings (no string interpolation of color names).
- Add a small `DepthBars` helper component above `PlanRow` (before line 694).
- Rewrite the three label branches in `PlanRow.leftLabel` (lines 732–796):
  - Convert outer container from `w-[100px] shrink-0 mt-0.5` + inline `paddingLeft` style to `w-[100px] shrink-0 flex items-stretch gap-1.5`.
  - Move `mt-0.5` onto the inner pill wrapper (`flex-1 min-w-0 mt-0.5`).
  - PRD branch keeps `prdPillClass` (yellow). Plan-with-artifact and fallback branches swap `planPillClass` → `planPillClassFor(depth ?? 0)`.
  - Render `<DepthBars depth={depth ?? 0} />` as the first child.

### Out of Scope

- The PRD branch's `prdPillClass` (yellow) is unchanged.
- The existing `planPillClass` constant (line 51) is preserved as the depth-0 default and continues to be used by the Compile row via the natural `depth ?? 0` path.
- The dependency tooltip logic at lines 720–729 (`planTooltipText` useMemo) is untouched.
- The outer `w-[100px]` column width is preserved.
- The `computeDepthMap` cycle guard (line 427) is unchanged.
- No new files, no new dependencies, no other components touched.

## Files

### Modify

- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — remove `DEPTH_LEVEL_WIDTH`; add `DEPTH_BAR_BG`, `DEPTH_PILL_CLASS`, `planPillClassFor`; add `DepthBars` helper; rewrite the three label branches inside `PlanRow.leftLabel` to use a flex row with `<DepthBars />` + pill wrapper, dropping the `paddingLeft` inline style and using `planPillClassFor(depth ?? 0)` for the artifact and fallback branches.

### Concrete edits

1. **Add depth palette** (insert after line 51, the existing `planPillClass`):

   ```ts
   const DEPTH_BAR_BG = [
     'bg-cyan/40', 'bg-blue/40', 'bg-purple/40',
     'bg-green/40', 'bg-yellow/40', 'bg-orange/40', 'bg-pink/40',
   ];
   const DEPTH_PILL_CLASS = [
     `${pillClass} bg-cyan/15 text-cyan/70 hover:bg-cyan/25 hover:text-cyan/90`,
     `${pillClass} bg-blue/15 text-blue/70 hover:bg-blue/25 hover:text-blue/90`,
     `${pillClass} bg-purple/15 text-purple/70 hover:bg-purple/25 hover:text-purple/90`,
     `${pillClass} bg-green/15 text-green/70 hover:bg-green/25 hover:text-green/90`,
     `${pillClass} bg-yellow/15 text-yellow/70 hover:bg-yellow/25 hover:text-yellow/90`,
     `${pillClass} bg-orange/15 text-orange/70 hover:bg-orange/25 hover:text-orange/90`,
     `${pillClass} bg-pink/15 text-pink/70 hover:bg-pink/25 hover:text-pink/90`,
   ];
   const planPillClassFor = (d: number) => DEPTH_PILL_CLASS[d % DEPTH_PILL_CLASS.length];
   ```

2. **Remove `DEPTH_LEVEL_WIDTH = 20`** (and its `/** Width in pixels per depth level for indentation */` comment) at lines 459–460.

3. **Add `DepthBars` helper** (insert above `PlanRow`, before line 694):

   ```tsx
   function DepthBars({ depth }: { depth: number }) {
     if (depth <= 0) return null;
     return (
       <div className="flex items-stretch gap-1 self-stretch">
         {Array.from({ length: depth }).map((_, i) => (
           <div key={i} className={`w-0.5 self-stretch rounded-sm ${DEPTH_BAR_BG[i % DEPTH_BAR_BG.length]}`} />
         ))}
       </div>
     );
   }
   ```

4. **Rewrite the three label branches** (lines 732–796). Each branch's outer container becomes:

   ```tsx
   <div className="w-[100px] shrink-0 flex items-stretch gap-1.5">
     <DepthBars depth={depth ?? 0} />
     <div className="flex-1 min-w-0 mt-0.5">
       <Tooltip>
         <TooltipTrigger asChild>
           <Button … className={<pillClassForBranch>}>
             {<labelForBranch>}
           </Button>
         </TooltipTrigger>
         …
       </Tooltip>
     </div>
   </div>
   ```

   Per branch:
   - PRD (line 733+): `className={prdPillClass}` (unchanged), label `PRD`, tooltip side="left" with `prdSource.label`.
   - Plan-with-artifact (line 753+): `className={planPillClassFor(depth ?? 0)}`, label `abbreviatePlanId(planId)`, tooltip with `planTooltipText` lines.
   - Fallback (line 778+): `className={planPillClassFor(depth ?? 0)}`, label `abbreviatePlanId(planId)`, tooltip with `planId`.

   Drop the `style={{ paddingLeft: (depth ?? 0) * DEPTH_LEVEL_WIDTH }}` from all three branches.

## Verification

Manual verification via `pnpm --filter @eforge-build/monitor-ui dev` against a session whose orchestration has at least four dependency levels. Type-check via `pnpm --filter @eforge-build/monitor-ui type-check` (and the repo-wide `pnpm type-check`).

- [ ] `DEPTH_LEVEL_WIDTH` constant is no longer present in `thread-pipeline.tsx` (`grep -n DEPTH_LEVEL_WIDTH packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` returns no matches).
- [ ] `DEPTH_BAR_BG`, `DEPTH_PILL_CLASS`, and `planPillClassFor` are declared in `thread-pipeline.tsx` with the exact static class strings listed above (no string interpolation of Tailwind color names).
- [ ] `DepthBars` component is declared above `PlanRow`, returns `null` when `depth <= 0`, and otherwise renders exactly `depth` child `<div>` elements each with class `w-0.5 self-stretch rounded-sm` plus a depth-indexed background from `DEPTH_BAR_BG`.
- [ ] All three label-branch outer containers use `className="w-[100px] shrink-0 flex items-stretch gap-1.5"` and contain `<DepthBars depth={depth ?? 0} />` followed by a `<div className="flex-1 min-w-0 mt-0.5">` wrapping the existing `<Tooltip>`.
- [ ] No `paddingLeft` inline style remains in `PlanRow.leftLabel` (`grep -n paddingLeft packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` returns no matches).
- [ ] PRD branch still uses `prdPillClass`. Plan-with-artifact and fallback branches use `planPillClassFor(depth ?? 0)`. The Compile row (`PlanRow` invoked at line 607 with no `depth` prop) renders with no bars and the cyan depth-0 pill (visually identical to today).
- [ ] In the running dev server against a 4+-deep orchestration: "Plan 04" and "Plan 05" labels render in full with no clipping; each plan row shows N vertical bars equal to its depth (depth 0 = no bars); bars span the full row height and align vertically across rows.
- [ ] Plan label color cycles cyan → blue → purple → green → yellow → orange → pink with depth (matching `DEPTH_PILL_CLASS` order); the PRD row remains yellow.
- [ ] Hovering a plan label still shows the "Depends on: Plan 02, Plan 03" tooltip (lines 720–729 untouched).
- [ ] `pnpm --filter @eforge-build/monitor-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/monitor-ui build` exits 0.
