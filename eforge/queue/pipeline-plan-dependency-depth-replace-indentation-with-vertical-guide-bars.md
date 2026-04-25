---
title: Pipeline plan-dependency depth: replace indentation with vertical guide bars
created: 2026-04-25
---

# Pipeline plan-dependency depth: replace indentation with vertical guide bars

## Problem / Motivation

The monitor UI's PIPELINE view conveys plan dependency depth by left-padding the label column 20px per level inside a fixed 100px column. At depth 3+, the padding consumes most of the column and the plan label clips (visible in the screenshot: "Plan 04" → "Pla", and the next row only shows three letters before the pill is cut by the timeline area).

## Goal

Replace the per-level indent with thin vertical "guide bars" (one per depth level) so each level costs only a few pixels instead of 20px, and optionally tint the plan label per depth as a redundant visual cue. This keeps deep plan labels legible while still communicating dependency depth.

## Approach

All work is confined to one file: `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`.

The label column today is fixed at `w-[100px]` and renders `<div style={{ paddingLeft: depth * 20 }}><Button>Plan N</Button></div>` (lines 731–796, three near-identical branches for PRD / plan-with-artifact / fallback). Replace the `paddingLeft` with a leading row of full-height vertical bars, then the pill, all inside the same 100px column. Each bar is 2px wide with a small gap (≈5–6px per level), so depth 6 still leaves ~65px for the label.

### Concrete changes in `thread-pipeline.tsx`

1. **Remove `DEPTH_LEVEL_WIDTH = 20` (line 460).** No longer needed.

2. **Add a depth palette near the existing `AGENT_COLORS` / `TIER_COLORS` (around line 14–76).** Use static class strings — Tailwind's JIT requires literal class names, so do not interpolate:

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

   Keep the existing `planPillClass` constant (line 51) — it remains the depth-0 default and is still used by the Compile row. `prdPillClass` (line 50) is unchanged: PRD is not a plan, has no depth, stays yellow.

3. **Add a small `DepthBars` helper above `PlanRow`:**

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

   `self-stretch` makes each bar span the full height of the plan row, so the bars read as vertical guide lines that visually link a plan back to its parent row above.

4. **Rewrite the three label branches (lines 732–796).** Convert the outer container from padded box to flex row:

   ```tsx
   <div className="w-[100px] shrink-0 flex items-stretch gap-1.5">
     <DepthBars depth={depth ?? 0} />
     <div className="flex-1 min-w-0 mt-0.5">
       <Tooltip>
         <TooltipTrigger asChild>
           <Button … className={planPillClassFor(depth ?? 0)}>
             {abbreviatePlanId(planId)}
           </Button>
         </TooltipTrigger>
         …
       </Tooltip>
     </div>
   </div>
   ```

   For the PRD branch (line 733) keep `prdPillClass` (yellow stays distinct). For the artifact and fallback branches, swap `planPillClass` → `planPillClassFor(depth ?? 0)`. The Compile row (rendered with no `depth` prop, line 607) defaults to 0 → cyan, matching today's appearance.

5. **Outer 100px column stays.** It anchors the timeline strip alignment across rows. Keeping it intact means no layout regressions in the timeline area.

### Why bars + tinted labels (not just bars)

Bars alone work, but at depth 4+ the bars are slim and easy to miss. Color-tinting the label gives a redundant cue (color matches the deepest bar in the bar group, since both cycle through the same palette in the same order), so a glance at the pill tells you the level even when the bars are small. This matches the user's "perhaps we could also use colors to delineate the different levels" note.

### Edge cases

- **Cycle in depth graph** — already handled by the existing `computeDepthMap` (line 427) cycle guard; no change needed.
- **Depth > 7** — palette wraps via modulo. Acceptable; the bar count alone still distinguishes deeper levels.
- **`gap-close` plan** — has no `dependsOn` typically, so depth 0 → cyan, identical to today.

## Scope

### In scope

- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — only file changed.
- Removing `DEPTH_LEVEL_WIDTH = 20`.
- Adding `DEPTH_BAR_BG`, `DEPTH_PILL_CLASS`, and `planPillClassFor` near `AGENT_COLORS` / `TIER_COLORS`.
- Adding `DepthBars` helper above `PlanRow`.
- Rewriting the three label branches (PRD / plan-with-artifact / fallback) at lines 732–796 to use a flex row with `DepthBars` plus the pill.
- Swapping `planPillClass` → `planPillClassFor(depth ?? 0)` for the artifact and fallback branches.

### Out of scope

- The PRD branch's `prdPillClass` (yellow) is unchanged.
- The existing `planPillClass` constant (line 51) is preserved as the depth-0 default and continues to be used by the Compile row.
- The dependency tooltip logic at lines 720–729 is untouched.
- The outer `w-[100px]` column width is preserved to keep timeline strip alignment.
- The `computeDepthMap` cycle guard (line 427) is unchanged.

## Acceptance Criteria

Verification via `pnpm --filter monitor-ui dev` (the package exposes `dev: vite`) against a session whose orchestration has at least four dependency levels (the screenshot's session, or any expedition with linear deps):

- At depth 3+, "Plan 04" / "Plan 05" labels render in full and are no longer clipped.
- Each plan row shows N vertical bars to the left of its pill, where N == depth (depth 0 = no bars).
- Bars span the full row height so they line up vertically across rows, suggesting connection.
- Plan label color cycles through the palette by depth (depth 0 cyan, depth 1 blue, etc.), and the PRD row stays yellow.
- Hovering a plan label still shows the "Depends on: Plan 02, Plan 03" tooltip (logic at lines 720–729 is untouched).
- The Compile / global row (when present) renders unchanged (no bars, cyan pill, since depth defaults to 0).
- A depth-0 row is visually compared against today's build to confirm there is no regression at the shallow case.
