---
id: plan-02-thread-line-swimlane-ui
name: Thread-Line Swimlane UI for Dependency Depth
depends_on:
  - plan-01-transitive-reduction
branch: transitive-reduction-for-plan-dependencies-and-thread-line-swimlane-ui/thread-line-swimlane-ui
---

# Thread-Line Swimlane UI for Dependency Depth

## Architecture Context

The `ThreadPipeline` component in `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` renders plan rows in a swimlane layout. Currently, dependency depth is communicated via binary `pl-4` indentation: plans with any dependencies get 16px left padding, plans without get none. This means all dependent plans appear at the same visual level regardless of actual chain depth.

After plan-01 lands, `dependsOn` arrays contain only direct (reduced) dependencies. This plan adds a thread-line column to the left of plan rows that uses vertical connector lines (like Reddit/GitHub comment threading) to show dependency depth visually.

## Implementation

### Overview

1. Compute a `depth` map from the orchestration config's reduced dependency graph (depth = longest path from any root to this node).
2. Replace the binary `pl-4` indentation with a narrow thread-line gutter column that renders vertical lines for each depth level.
3. Each plan row's gutter shows: a vertical line segment for each ancestor depth level it passes through, and a horizontal connector at its own depth.

### Key Decisions

1. **Depth = longest path from root, not wave index** - a plan at depth 3 means it's 3 hops from a root in the longest dependency chain. This matches visual intuition better than Kahn's wave (which groups by earliest-possible execution).
2. **Thread-line gutter as a separate column** - a fixed-width column (e.g., 8px per depth level) to the left of the existing 100px plan label column. Maximum width is capped to prevent runaway indentation for deep chains.
3. **Minimal per-level width (8px)** - keeps deep chains (5+ levels) visually readable without consuming excessive horizontal space. At 8px/level, a 5-deep chain uses only 40px.
4. **Use Tailwind/CSS for line rendering** - vertical lines via `border-left` on depth-level divs, horizontal connector via a short `border-bottom` segment. No SVG needed.

## Scope

### In Scope
- `computeDepthMap()` utility that takes orchestration plans and returns a `Map<string, number>` of plan ID to depth
- Thread-line gutter column rendering in `PlanRow`
- Remove existing binary `pl-4` indentation logic
- Visual indicators: vertical lines for ancestor levels, horizontal tick at own depth

### Out of Scope
- Changes to the dependency graph tab (it already benefits from plan-01's reduced edges)
- Changes to tooltip content (already shows dependency info)
- Animation or interactivity on thread lines

## Files

### Modify
- `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx` - Add `computeDepthMap()` function; compute depth map in `ThreadPipeline` via `useMemo`; pass `depth` and `maxDepth` to `PlanRow`; replace binary `pl-4` with thread-line gutter column in `PlanRow`'s `leftLabel` rendering; update `PlanRowProps` interface to include `depth: number` and `maxDepth: number`

## Verification

- [ ] Plans with no dependencies render at depth 0 with no thread lines
- [ ] A linear chain A->B->C renders A at depth 0, B at depth 1 (one vertical line), C at depth 2 (two vertical lines)
- [ ] A diamond A->{B,C}->D renders D at depth 2 with thread lines, B and C both at depth 1
- [ ] The binary `pl-4` class is no longer applied to plan row labels
- [ ] Thread-line gutter width scales with depth: a 5-deep chain uses ~40px, not 5*16px
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes (includes monitor UI build)
