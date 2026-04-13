---
title: Fix: Build phase crash when planner generates 0 plans
created: 2026-04-13
---

# Fix: Build phase crash when planner generates 0 plans

## Problem / Motivation

When the planner determines a PRD is already satisfied and generates 0 plan files, the build phase crashes with ENOENT trying to read `orchestration.yaml`. Two root causes:

1. **Prompt weakness** - The skip instruction (line 47 of 469) is buried mid-document, never reinforced, and asymmetrically emphasized compared to plan generation (5 lines vs 370 lines). This is further amplified by the Pi/Codex backend which delivers the entire prompt as a **user message** (via `session.prompt()`), not a system prompt - so the instruction carries even less weight than with Claude SDK (which treats it as a system prompt via `sdkQuery({ prompt })`).

2. **No defensive fallback** - The engine has no safety net for when the agent doesn't emit the `<skip>` XML block but also generates 0 plans. The existing skip path (`<skip>` block -> `plan:skip` event -> pipeline halt -> build skipped) works, but depends entirely on LLM format compliance.

## Goal

Eliminate the ENOENT crash by both strengthening the planner prompt's skip instruction so agents reliably emit `<skip>` when a PRD is already satisfied, and adding defensive engine-level guards so that 0 generated plans never propagate into the build phase.

## Approach

### 1. Strengthen the skip instruction in the planner prompt

**File:** `packages/engine/src/prompts/planner.md`

Three changes:

**a)** Add a prominent early-exit rule near the top (after the Source section, before Process), so it's seen early in the prompt:

```markdown
## Critical Rule: Skip When Fully Implemented

Before planning, you MUST determine whether the source is already fully implemented. If ALL requirements are satisfied with zero gaps, you MUST emit a `<skip>` block and stop - do NOT write any plan files or orchestration.yaml:

\```xml
<skip>All requirements from the source are already implemented - [brief explanation].</skip>
\```

This is mandatory. Producing 0 plan files without a `<skip>` block is an error.
```

**b)** Remove the existing skip paragraph at line 47 (under Scope Boundary) since it's now covered by the new section above. Keep the Scope Boundary DO/DON'T list but replace the skip paragraph with a cross-reference:

```markdown
If the source is fully implemented, follow the **Critical Rule** above - emit `<skip>` and stop.
```

**c)** Add reinforcement at the end (in the Output section, line 466-468):

```markdown
## Output

If you emitted a `<skip>` block, your output is complete - do not write any files.

Otherwise, after generating all artifacts, provide a summary of what was created.
```

### 2. Defensive engine code: Treat 0 plans as implicit skip

**File:** `packages/engine/src/agents/planner.ts` (around line 204-205)

After the plan file scanning loop, if `plans.length === 0`, emit `plan:skip` and return instead of `plan:complete` with empty plans:

```typescript
if (plans.length === 0) {
  yield { timestamp: new Date().toISOString(), type: 'plan:skip', reason: 'No plans generated' };
  return;
}
yield { timestamp: new Date().toISOString(), type: 'plan:complete', plans };
```

This is the safety net. Even if the agent doesn't emit `<skip>`, the engine catches the 0-plans case and routes it through the existing skip infrastructure.

### 3. Belt-and-suspenders: Guard build() against missing orchestration.yaml

**File:** `packages/engine/src/eforge.ts` (around line 488, before `validatePlanSet`)

```typescript
if (!existsSync(configPath)) {
  status = 'failed';
  summary = 'No orchestration.yaml found - compile may not have generated plans';
  return;
}
```

This protects direct `build()` callers (not going through `buildSinglePrd`) from an uncontrolled ENOENT.

### 4. Update test expectations

**File:** `test/agent-wiring.test.ts` (lines 24-38)

The test "emits plan lifecycle events for a basic run" uses a `StubBackend` that produces text but no plan files and no `<skip>` block. With change #2, this now emits `plan:skip` instead of `plan:complete` with empty plans:

```typescript
it('emits plan lifecycle events for a basic run', async () => {
  const backend = new StubBackend([{ text: 'Planning done.' }]);
  const cwd = makeTempDir();
  const events = await collectEvents(runPlanner('Build a widget', { backend, cwd }));

  expect(findEvent(events, 'plan:start')).toBeDefined();
  expect(findEvent(events, 'plan:skip')).toBeDefined();
  expect(findEvent(events, 'plan:skip')!.reason).toBe('No plans generated');
  expect(findEvent(events, 'agent:result')).toBeDefined();
});
```

### 5. Add plan:skip to MCP proxy info events

**File:** `packages/eforge/src/cli/mcp-proxy.ts` (line 67-73)

Add `'plan:skip'` to the `INFO_EVENTS` set so MCP consumers receive a notification when a PRD is skipped.

## Scope

**In scope:**
- Strengthening the planner prompt skip instruction (`packages/engine/src/prompts/planner.md`)
- Defensive 0-plans handling in `packages/engine/src/agents/planner.ts`
- Guard against missing `orchestration.yaml` in `packages/engine/src/eforge.ts`
- Updating test expectations in `test/agent-wiring.test.ts`
- Adding `plan:skip` to the MCP proxy `INFO_EVENTS` set in `packages/eforge/src/cli/mcp-proxy.ts`

**Out of scope:**
- Changes to the Pi/Codex backend's prompt delivery mechanism (user message vs system prompt)
- Broader planner prompt restructuring beyond the skip instruction
- Changes to the existing `<skip>` block parsing or `plan:skip` event infrastructure

## Acceptance Criteria

- `pnpm test` passes - the updated agent-wiring test asserts `plan:skip` with reason `'No plans generated'` when a `StubBackend` produces text but no plan files and no `<skip>` block.
- `pnpm type-check` passes with no type errors.
- The planner prompt contains a prominent early-exit "Critical Rule: Skip When Fully Implemented" section near the top, a cross-reference replacing the old buried skip paragraph, and reinforcement in the Output section.
- When the planner agent generates 0 plan files without emitting a `<skip>` block, the engine emits a `plan:skip` event (with reason `'No plans generated'`) and halts the pipeline instead of crashing.
- Direct `build()` callers encountering a missing `orchestration.yaml` receive a graceful failure (`status = 'failed'` with descriptive summary) instead of an uncontrolled ENOENT.
- `plan:skip` is included in the MCP proxy `INFO_EVENTS` set so MCP consumers are notified when a PRD is skipped.
- The eval scenario `./run.sh --variant pi-codex todo-api-errand-skip` emits a `plan:skip` event and exits 0.
