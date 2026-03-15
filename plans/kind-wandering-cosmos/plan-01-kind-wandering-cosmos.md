---
id: plan-01-kind-wandering-cosmos
name: Add scope assessment to adopt flow + fix semantic naming
depends_on: []
branch: kind-wandering-cosmos/main
---

# Add scope assessment to adopt flow + fix semantic naming

## Context

When `eforge run --adopt` is used, the `adopt()` method wraps an existing implementation plan into eforge artifacts without any AI assessment. It hardcodes `mode: 'errand'` regardless of the plan's actual scope. This means large, multi-module plans adopted from Claude Code (or elsewhere) are always treated as single errands - no architecture decomposition, no parallel worktrees, no module planning.

Additionally, adopted plans inherit silly filenames from their source (e.g., Claude Code's `peppy-painting-tulip.md` becomes plan set name `peppy-painting-tulip`). The H1 heading is already extracted for the human-readable plan name but isn't used for the plan set name.

## Approach

1. **Add a lightweight assessor agent** that explores the codebase and determines scope (errand/excursion/expedition/complete) before wrapping
2. **Branch on assessment**: errand wraps as-is (current behavior), excursion/expedition delegates to the full planner for proper decomposition
3. **Derive plan set name from content** (H1 heading) instead of the source filename

## Files to create

### `src/engine/prompts/assessor.md`

Assessment-only prompt. Reuse the scope assessment rules from `planner.md` (Phase 1-3: scope understanding, codebase exploration, scope assessment) but omit all plan generation, orchestration.yaml, index.yaml, and clarification formats. The agent must:
- Explore the codebase to understand the delta between the plan and current state
- Emit exactly one `<scope>` block with assessment and justification
- NOT create or write any files

Template variables: `{{source}}`, `{{cwd}}`

### `src/engine/agents/assessor.ts`

New `runAssessor()` function following the pattern of `runPlanReview` (one-shot query, parse XML, yield events).

```typescript
export interface AssessorOptions {
  backend: AgentBackend;
  sourceContent: string;
  cwd: string;
  verbose?: boolean;
  abortController?: AbortController;
}

export async function* runAssessor(options: AssessorOptions): AsyncGenerator<EforgeEvent>
```

Behavior:
- Load prompt via `loadPrompt('assessor', { source, cwd })`
- Run `backend.run({ prompt, cwd, maxTurns: 20, tools: 'coding' }, 'assessor')`
- Parse `parseScopeBlock()` from accumulated `agent:message` content (reuse from `common.ts`)
- Yield `plan:scope` event when scope block found
- Default to `'errand'` if no scope block found (safe fallback - matches current adopt behavior)
- Gate `agent:message` on `verbose`; always yield `agent:result`, `agent:tool_use`, `agent:tool_result`

## Files to modify

### `src/engine/events.ts`

1. Add `'assessor'` to `AgentRole` union (line 7)
2. Add `auto?: boolean` to `AdoptOptions` (needed when delegating to planner for excursion/expedition)

### `src/engine/plan.ts`

1. Add `mode?: 'errand' | 'excursion'` to `WritePlanArtifactsOptions` (line 415-422)
2. Use `options.mode ?? 'errand'` at line 449 instead of hardcoded `'errand'`
3. Add `deriveNameFromContent()` function:
   ```typescript
   export function deriveNameFromContent(content: string): string | undefined {
     const title = extractPlanTitle(content);
     if (!title) return undefined;
     // Reuse the same kebab-case conversion logic from deriveNameFromSource
     const name = title
       .replace(/([a-z])([A-Z])/g, '$1-$2')
       .replace(/[\s_]+/g, '-')
       .replace(/[^a-z0-9-]/gi, '-')
       .replace(/-+/g, '-')
       .replace(/^-|-$/g, '')
       .toLowerCase();
     return name || undefined;
   }
   ```

### `src/engine/eforge.ts` — rewrite `adopt()`

The core change. New flow:

```
adopt(source, options):
  resolve source content (existing)

  // NEW: derive plan set name from content H1, fall back to filename
  planSetName = options.name
    ?? deriveNameFromContent(sourceContent)
    ?? deriveNameFromSource(source)

  yield phase:start, plan:start

  // NEW: Run assessor agent
  for await (event of runAssessor({ backend, sourceContent, cwd, verbose })):
    track scopeAssessment from plan:scope event
    yield event

  // Branch on scope
  if complete:
    yield plan:complete (empty plans)

  else if errand:
    writePlanArtifacts({ mode: 'errand', ... })   // current behavior
    git commit
    yield plan:complete
    plan review cycle (if !skipReview)

  else (excursion / expedition):
    yield plan:progress "Scope is {assessment} — running planner..."

    // Delegate to runPlanner (suppress duplicate plan:start, plan:scope)
    for await (event of runPlanner(source, { cwd, name, auto, backend, onClarification })):
      if event.type === 'plan:start' || event.type === 'plan:scope': continue
      track expedition modules from agent:message (same as plan())
      suppress plan:complete in expedition mode (same as plan())
      track finalPlans
      yield event

    // Expedition module planning (if needed)
    if expedition && modules.length > 0:
      yield* planExpeditionModules(...)

    // Git commit
    git add + commit

    // Cohesion review (expedition only, non-fatal)
    // Plan review (if !skipReview, non-fatal)

  yield phase:end
```

Key details:
- Engine emits `phase:start`/`phase:end`. Session wrapping (`withSessionId()`) is CLI-level and needs no changes - it already handles adopt phases via the `run` command's shared sessionId.
- `plan:start` emitted once by `adopt()`, before assessor. Planner's `plan:start` suppressed.
- Assessor's `plan:scope` is authoritative. Planner's `plan:scope` suppressed.
- `this.onClarification` already exists on the engine - used when delegating to planner.
- `this.planExpeditionModules()` is private but accessible from `adopt()` (same class).
- Post-planner orchestration (git commit, cohesion review, plan review) is duplicated from `plan()` rather than extracted, keeping both methods self-contained (~40 lines of stable code).

### `src/cli/index.ts`

Pass `auto` through to `engine.adopt()` in the `run` command (line 214):
```typescript
engine.adopt(source, {
  verbose: options.verbose,
  name: options.name,
  auto: options.auto,  // NEW
  skipReview: options.review === false,
  abortController,
})
```

### `eforge-plugin/skills/run/run.md`

Update adopt documentation to reflect that adopted plans now undergo scope assessment and may be decomposed.

## Tests

### New: `test/assessor-wiring.test.ts`

Using `StubBackend` (same pattern as `test/agent-wiring.test.ts`):
- Detects scope assessment from agent output
- Defaults to errand when no scope block found
- Gates agent:message on verbose flag
- Always yields agent:result

### Update: `test/adopt.test.ts`

- Test `writePlanArtifacts` with explicit `mode` parameter
- Test `deriveNameFromContent()` — extracts H1 and kebab-cases it
- Test `deriveNameFromContent()` returns undefined for content without H1

## Verification

1. `pnpm type-check` passes
2. `pnpm test` passes (existing + new tests)
3. Manual: `pnpm dev -- run --adopt some-plan.md --verbose` shows scope assessment before wrapping
4. Manual: adopted plan from a Claude Code plan file gets a semantic name (from H1) instead of the silly filename
