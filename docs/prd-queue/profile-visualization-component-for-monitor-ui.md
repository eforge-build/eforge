---
title: Profile Visualization Component for Monitor UI
created: 2026-03-18
status: pending
---

## Problem / Motivation

The monitor dashboard shows real-time pipeline execution (agent timeline bars) but has no visual representation of the *declared* workflow profile - the blueprint for what stages will run and in what order. Currently, profile info only appears as plain text in the timeline event list (the `plan:profile` event card). Users lack immediate context for what the pipeline is doing and why, forcing them to scan event cards to understand the workflow shape.

## Goal

Add a dedicated `ProfileCard` visual component above the pipeline view that makes the selected workflow profile immediately legible and gives context for the execution happening below.

## Approach

A new `ProfileCard` component rendered between `ActivityHeatstrip` and `ThreadPipeline` in `app.tsx`. It renders only when profile data is available (returns null otherwise). The card uses the standard card styling and shows three sections: a profile badge with description, stage flow diagrams for compile and build pipelines, and a compact review config summary.

### Layout

```
+------------------------------------------------------------------+
| [dot] PROFILE                                                     |
|                                                                   |
| [errand]  Small, self-contained changes...                        |
|                                                                   |
| Compile  [prd-passthrough]                                        |
|                                                                   |
| Build    [implement ] ---> [review] ---> [review-fix] ---> [evaluate]
|          [doc-update]                                             |
|                                                                   |
| Review   auto · code · 1 round · standard                        |
+------------------------------------------------------------------+
```

**1. Profile badge + description** - Profile name as a colored rounded pill. Description text in dim beside it. Rationale available on tooltip hover over the badge.

**2. Stage flows** - Two horizontal rows (Compile, Build) with stage names as small pills connected by arrows/chevrons. Parallel stages (e.g., `['implement', 'doc-update']`) rendered as a vertical stack within their position in the flow. Labels left-aligned at ~80px to match the compact layout.

**3. Review summary** - Single compact line with dot-separated items: strategy, perspectives, round count, strictness.

### Profile tier colors (for the name badge)

| Profile | Color | Reasoning |
|---------|-------|-----------|
| errand | green (#3fb950) | Quick/simple |
| excursion | blue (#58a6ff) | Medium, primary accent |
| expedition | orange (#f0883e) | Large, stands out |
| custom/other | purple (#bc8cff) | Special/unique |

### Stage pill colors

Map stage names to semantic color families for consistency with existing agent colors:

- Planning stages (prd-passthrough, planner, module-planning): `yellow/20`
- Review stages (plan-review-cycle, cohesion-review-cycle, review, review-fix): `green/20`
- Build stages (implement): `blue/20`
- Utility stages (doc-update): `cyan/20`
- Evaluation stages (evaluate): `purple/20`
- Expedition stages (compile-expedition): `orange/20`

### Parallel stage rendering

For `BuildStageSpec[]`, each element is `string | string[]`:
- `string`: single pill
- `string[]`: vertical flex-col stack of pills with a subtle left border accent to visually group them

Arrow connectors between steps: small `ChevronRight` icon or a thin line+arrow in dim color.

### Files to modify

**1. `src/monitor/ui/src/lib/reducer.ts`**
- Add `profileInfo: { profileName: string; rationale: string; config?: ResolvedProfileConfig } | null` to `RunState`
- Initialize as `null` in `initialRunState`
- Handle `plan:profile` event in `processEvent` to populate it
- Add to `BATCH_LOAD` accumulator initialization

**2. `src/monitor/ui/src/lib/types.ts`**
- Define local types for the UI layer (avoids importing from engine config.ts which has Node.js deps):
  ```typescript
  type BuildStageSpec = string | string[];
  interface ReviewProfileConfig { strategy: string; perspectives: string[]; maxRounds: number; evaluatorStrictness: string; autoAcceptBelow?: string; }
  interface ProfileConfig { description: string; compile: string[]; build: BuildStageSpec[]; review: ReviewProfileConfig; agents: Record<string, unknown>; }
  interface ProfileInfo { profileName: string; rationale: string; config?: ProfileConfig; }
  ```

**3. `src/monitor/ui/src/components/common/profile-card.tsx` (NEW)**
- Self-contained React component
- Props: `{ profileInfo: ProfileInfo }`
- Uses existing Tooltip components, Tailwind classes, card styling
- Stage flow rendering with parallel group support
- Profile badge with tier-based coloring

**4. `src/monitor/ui/src/app.tsx`**
- Import `ProfileCard`
- Render `{runState.profileInfo && <ProfileCard profileInfo={runState.profileInfo} />}` between `ActivityHeatstrip` and `ThreadPipeline` (after line 208)

**5. `src/monitor/mock-server.ts`**
- Update mock `plan:profile` events to include parallel build stages (`[['implement', 'doc-update'], ...]` instead of flat arrays) so dev testing exercises the parallel rendering. Currently the mock data uses flat string arrays.

## Scope

**In scope:**
- New `ProfileCard` React component with profile badge, stage flow diagrams, and review summary
- UI-local type definitions for profile data (no engine imports)
- Reducer changes to extract and store profile info from `plan:profile` events
- Integration into `app.tsx` between `ActivityHeatstrip` and `ThreadPipeline`
- Mock server data updates to exercise parallel stage rendering

**Out of scope:**
- Changes to the engine's profile resolution or event emission
- Changes to any other monitor components
- Persisting profile info beyond the current session state

## Acceptance Criteria

1. `pnpm build` passes
2. `pnpm type-check` passes
3. With mock dev server running (`cd src/monitor/ui && pnpm dev`):
   - Profile card appears between activity heatstrip and pipeline
   - Profile badge shows correct tier color (green for errand, blue for excursion, orange for expedition, purple for custom/other)
   - Stage flows render correctly with arrows/chevrons between stages
   - Parallel stages (e.g., implement + doc-update) stack vertically with a subtle left border accent
   - Review config line shows all fields (strategy, perspectives, round count, strictness) dot-separated
   - Rationale tooltip appears on badge hover
   - Card does not render when no profile event exists (e.g., before compile starts)
4. All mock server sessions render their profiles correctly
