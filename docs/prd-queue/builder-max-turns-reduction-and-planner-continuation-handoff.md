---
title: Builder max turns reduction and planner continuation handoff
created: 2026-03-27
status: pending
---

# Builder max turns reduction and planner continuation handoff

## Problem / Motivation

The builder agent's max turns was increased from 50 to 75 before the continuation/handoff mechanism existed. Now that the builder supports up to 3 continuation handoffs - each getting a fresh context window - 75 turns per attempt is excessive and leads to unfocused runs.

The planner agent (max turns: 30) has no continuation mechanism at all. When it hits max turns on complex plans (observed in evaluations), it simply fails with no recovery path. This limits the planner's ability to handle complex planning work.

## Goal

Reduce builder max turns back to 50 (relying on continuations for longer tasks) and add a builder-style continuation handoff mechanism to the planner agent so it can complete complex planning across multiple invocations.

## Approach

### 1. Reduce builder max turns: 75 → 50

**File**: `src/engine/pipeline.ts:229`

Change `builder: 75` to `builder: 50` in `AGENT_MAX_TURNS_DEFAULTS`.

### 2. Add `plan:continuation` event type

**File**: `src/engine/events.ts`

Add alongside the existing `build:implement:continuation`:
```typescript
| { type: 'plan:continuation'; attempt: number; maxContinuations: number }
```

### 3. Add continuation context support to planner agent

**File**: `src/engine/agents/planner.ts`

- Add optional `continuationContext` to `PlannerOptions`:
  ```typescript
  continuationContext?: {
    attempt: number;
    maxContinuations: number;
    existingPlans: string; // summary of plan files already written
  };
  ```
- Format continuation context text (similar to builder pattern) and pass it to `loadPrompt('planner', { ..., continuation_context })`
- The context tells the planner what plans already exist so it doesn't redo them

### 4. Add `{{continuation_context}}` to planner prompt

**File**: `src/engine/prompts/planner.md`

Add `{{continuation_context}}` after `{{priorClarifications}}` (near top of prompt). When populated, it instructs the planner that this is a continuation run and lists already-written plans to avoid redoing work.

### 5. Add continuation loop to `plannerStage` in pipeline

**File**: `src/engine/pipeline.ts` - `plannerStage` (line 386)

This is the main structural change. Wrap the existing `runPlanner()` call in a continuation loop, modeled on the builder's `implementStage`:

1. Resolve `maxContinuations` from config (use per-agent default of 2 for planner via `AGENT_MAX_CONTINUATIONS_DEFAULTS`)
2. Loop `for (let attempt = 0; attempt <= maxContinuations; attempt++)`
3. On each attempt, call `runPlanner()` with continuation context (if attempt > 0)
4. Detect `error_max_turns` failure (catch the error thrown by the backend)
5. On max turns failure with `attempt < maxContinuations`:
   - Scan `plans/{planSetName}/` for .md files already written as the "progress checkpoint"
   - Commit plan artifacts if any exist (reuse `commitPlanArtifacts`, hardened - see below)
   - Build continuation context: list existing plan file names + their frontmatter summaries
   - Yield `plan:continuation` event
   - Continue loop with continuation context injected
6. On success or non-max-turns error: break/throw as normal

**Key difference from builder**: The planner writes files to disk (not git worktree commits), so "checkpointing" means committing whatever plan files exist. The continuation context lists existing plan files rather than a git diff.

**Interaction with clarification loop**: The clarification loop lives inside `runPlanner()`. If the planner hits max turns mid-clarification, the outer continuation loop catches it. On restart, prior clarifications are lost (new agent invocation), but the existing plan files on disk serve as the primary progress indicator. This is acceptable - clarifications are for ambiguity resolution, and any answers that influenced already-written plans are reflected in those plans.

### 6. Harden `commitPlanArtifacts`

**File**: `src/engine/pipeline.ts:1323`

Currently assumes there's always something to commit. With continuation checkpoints, the same artifacts may already be committed. Add a guard:
```typescript
async function commitPlanArtifacts(cwd: string, planSetName: string): Promise<void> {
  const planDir = resolve(cwd, 'plans', planSetName);
  await exec('git', ['add', planDir], { cwd });
  const { stdout } = await exec('git', ['diff', '--cached', '--name-only'], { cwd });
  if (stdout.trim().length > 0) {
    await forgeCommit(cwd, `plan(${planSetName}): initial planning artifacts`);
  }
}
```

### 7. Add CLI display handler

**File**: `src/cli/display.ts`

Add `plan:continuation` case near the existing `build:implement:continuation` handler:
```typescript
case 'plan:continuation': {
  const s = spinners.get('compile');
  if (s) s.text = `Planning - continuing (attempt ${event.attempt}/${event.maxContinuations})`;
  break;
}
```

### 8. Add planner to `AGENT_MAX_CONTINUATIONS_DEFAULTS`

Use **Option A**: Add a new `AGENT_MAX_CONTINUATIONS_DEFAULTS` map in pipeline.ts (like `AGENT_MAX_TURNS_DEFAULTS`) with `planner: 2`. The planner shouldn't need as many retries as the builder, and 2 gives it 3 total attempts (90 turns at 30/attempt), which should be plenty.

## Scope

### In scope

- Reducing builder max turns from 75 to 50
- Adding `plan:continuation` event type
- Adding continuation context support to the planner agent
- Adding `{{continuation_context}}` template variable to the planner prompt
- Adding a continuation loop to `plannerStage` in the pipeline
- Hardening `commitPlanArtifacts` to handle already-committed artifacts
- Adding CLI display handler for `plan:continuation`
- Adding per-agent `AGENT_MAX_CONTINUATIONS_DEFAULTS` with planner defaulting to 2
- Tests covering agent-level, pipeline-level, config, and type-check scenarios
- Updating any existing tests that assert builder maxTurns of 75

### Out of scope

- Changing the planner's per-attempt max turns (remains 30)
- Changing the builder's continuation mechanism or max continuations
- Preserving prior clarifications across continuation boundaries (acceptable loss - answers are reflected in already-written plan files)

### Files to modify

1. `src/engine/events.ts` - add `plan:continuation` event type
2. `src/engine/agents/planner.ts` - add `continuationContext` option + prompt formatting
3. `src/engine/prompts/planner.md` - add `{{continuation_context}}` template variable
4. `src/engine/pipeline.ts` - reduce builder to 50, add planner continuation loop, harden `commitPlanArtifacts`, add `AGENT_MAX_CONTINUATIONS_DEFAULTS`
5. `src/cli/display.ts` - add `plan:continuation` display handler

## Acceptance Criteria

### Compilation and tests

- `pnpm build` compiles cleanly
- `pnpm test` passes all existing and new tests
- `pnpm type-check` passes

### Agent-level tests (in `test/agent-wiring.test.ts` or new `test/planner-continuation.test.ts`)

1. **`runPlanner` with continuation context** - Pass `continuationContext` with attempt/maxContinuations/existingPlans, assert `backend.prompts[0]` contains "Continuation Context", attempt number, and "Do NOT redo"
2. **`runPlanner` without continuation context** - Normal planner call, assert prompt does NOT contain "Continuation Context"
3. **Continuation context coexists with prior clarifications** - Provide both `continuationContext` and trigger a clarification restart, verify both sections appear in the prompt

### Pipeline-level tests (in `test/planner-continuation.test.ts`)

4. **`plan:continuation` event type compiles** - Type-check that `{ type: 'plan:continuation', attempt: 1, maxContinuations: 2 }` satisfies `EforgeEvent`
5. **StubBackend `error_max_turns` propagation** - When StubBackend throws `error_max_turns`, `runPlanner` propagates the error (the pipeline stage handles retry, not the agent)

### Config tests

6. **Builder `AGENT_MAX_TURNS_DEFAULTS` is 50** - Assert `resolveAgentConfig('builder', DEFAULT_CONFIG).maxTurns === 50`
7. **Planner resolves to global default (30)** - Assert `resolveAgentConfig('planner', DEFAULT_CONFIG).maxTurns === 30`

### Existing test updates

8. Update any existing tests that assert builder maxTurns of 75

### Manual verification

- Temporarily lower planner maxTurns to 10 and run on a complex PRD to verify the continuation fires
