---
title: Fix monitor hover highlighting for composite build stages
created: 2026-03-30
status: pending
---

# Fix monitor hover highlighting for composite build stages

## Problem / Motivation

Hovering composite build stage breadcrumbs (`test-cycle`, `review-cycle`) in the monitor UI does not highlight the corresponding agent bars, and hovering those agent bars does not highlight the breadcrumb. The `implement` stage works because it has a simple 1:1 mapping. Two root causes exist:

1. **Missing `AGENT_TO_STAGE` entries** - `tester` and `test-writer` agents have no mapping, so hovering their bars emits `null`.
2. **No composite stage resolution** - Agent bars emit their raw pipeline stage (e.g. `review` for the reviewer agent) as `hoveredStage`, but the breadcrumb checks `hoveredStage === stage` where `stage` is `review-cycle`. The static `PIPELINE_TO_BUILD_STAGE` map was meant to bridge this gap but is never used in the hover path and is incomplete.

## Goal

Hovering any agent bar or breadcrumb in the monitor pipeline view should bidirectionally highlight its counterpart, including for composite stages like `test-cycle` and `review-cycle`.

## Approach

All changes are in a single file: `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`.

### 1. Make `AGENT_TO_STAGE` type-safe and complete (lines 57-73)

Import `AgentRole` from `@/lib/types` (already re-exported from engine). Change the type to `Record<AgentRole, string>` to get compile-time errors when new roles are added:

```ts
const AGENT_TO_STAGE: Record<AgentRole, string> = {
  'planner': 'planner',
  'plan-reviewer': 'plan-review-cycle',
  'plan-evaluator': 'plan-review-cycle',
  'module-planner': 'module-planning',
  'architecture-reviewer': 'architecture-review-cycle',
  'architecture-evaluator': 'architecture-review-cycle',
  'cohesion-reviewer': 'cohesion-review-cycle',
  'cohesion-evaluator': 'cohesion-review-cycle',
  'builder': 'implement',
  'doc-updater': 'doc-update',
  'reviewer': 'review',
  'review-fixer': 'review-fix',
  'evaluator': 'evaluate',
  'validation-fixer': 'validate',
  'tester': 'test',
  'test-writer': 'test-write',
  'merge-conflict-resolver': 'merge',
  'staleness-assessor': 'staleness',
  'formatter': 'format',
};
```

Remove `parallel-reviewer` from this map - it is not in `AgentRole` and the engine emits `'reviewer'` for parallel review runs (confirmed in `parallel-reviewer.ts:177`).

### 2. Make `AGENT_COLORS` type-safe and complete (lines 14-31)

Use `Record<AgentRole, { bg: string; border: string }>` to ensure completeness. Add missing entries:

- `tester`: blue (implementation family, like builder)
- `test-writer`: blue
- `merge-conflict-resolver`: red (like validation-fixer)
- `staleness-assessor`: cyan (utility, like formatter)

Remove `parallel-reviewer` (uses role `reviewer` at runtime).

### 3. Replace `PIPELINE_TO_BUILD_STAGE` with a dynamic resolver (lines 189-195)

The static map cannot handle ambiguous stages like `evaluate` which appear in both `test-cycle` and `review-cycle`. Replace with:

```ts
const COMPOSITE_STAGES: Record<string, string[]> = {
  'review-cycle': ['review', 'review-fix', 'evaluate'],
  'test-cycle': ['test', 'test-write', 'test-fix', 'evaluate'],
};

function resolveBuildStage(pipelineStage: string, buildStages?: BuildStageSpec[]): string {
  if (!buildStages || buildStages.length === 0) return pipelineStage;

  // Direct match
  for (const spec of buildStages) {
    const name = Array.isArray(spec) ? spec.join('+') : spec;
    if (name === pipelineStage) return name;
    if (Array.isArray(spec) && spec.includes(pipelineStage)) return pipelineStage;
  }

  // Composite expansion - last match wins (review-cycle after test-cycle)
  let match: string | undefined;
  for (const spec of buildStages) {
    const name = Array.isArray(spec) ? spec.join('+') : spec;
    const components = COMPOSITE_STAGES[name];
    if (components && components.includes(pipelineStage)) {
      match = name;
    }
  }

  return match ?? pipelineStage;
}
```

### 4. Update `getBuildStageStatuses` to use the resolver (lines 219, 239)

**Line 219** (failed state thread matching):
```ts
// Before:
const mappedName = PIPELINE_TO_BUILD_STAGE[AGENT_TO_STAGE[thread.agent] ?? ''];
// After:
const agentStage = AGENT_TO_STAGE[thread.agent as AgentRole];
const mappedName = agentStage ? resolveBuildStage(agentStage, buildStages) : undefined;
```

**Line 239** (normal state):
```ts
// Before:
const mappedName = PIPELINE_TO_BUILD_STAGE[currentStage];
// After:
const mappedName = resolveBuildStage(currentStage, buildStages);
```

### 5. Fix agent bar hover logic in `PlanRow` (lines 622-637)

```ts
// Before:
const stripStage = AGENT_TO_STAGE[thread.agent];
// After:
const pipelineStage = AGENT_TO_STAGE[thread.agent as AgentRole];
const stripStage = pipelineStage ? resolveBuildStage(pipelineStage, buildStages) : undefined;
```

This resolves chains like `reviewer` -> `review` -> `review-cycle` and `tester` -> `test` -> `test-cycle`.

## Scope

**In scope:**

- Completing and type-safing `AGENT_TO_STAGE` with all `AgentRole` values
- Completing and type-safing `AGENT_COLORS` with all `AgentRole` values
- Replacing the static `PIPELINE_TO_BUILD_STAGE` map with a dynamic `resolveBuildStage` function
- Updating `getBuildStageStatuses` and `PlanRow` hover logic to use the new resolver
- All changes scoped to `src/monitor/ui/src/components/pipeline/thread-pipeline.tsx`

**Out of scope:**

- Changes to engine agent role definitions
- Changes to any other monitor UI components

## Acceptance Criteria

1. `pnpm type-check` passes - type errors surface if any `AgentRole` is missing from `AGENT_TO_STAGE` or `AGENT_COLORS`.
2. `pnpm build` produces a clean build with no errors or warnings related to these changes.
3. Hovering a `test-cycle` breadcrumb highlights all agent bars belonging to that composite stage (`tester`, `test-writer`).
4. Hovering a `review-cycle` breadcrumb highlights all agent bars belonging to that composite stage (`reviewer`, `review-fixer`, `evaluator`).
5. Hovering an agent bar within a composite stage highlights the corresponding composite breadcrumb (bidirectional).
6. Existing hover behavior for non-composite stages (e.g. `implement`) is unchanged.
