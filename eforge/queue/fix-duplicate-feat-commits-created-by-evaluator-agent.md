---
title: Fix duplicate `feat(...)` commits created by evaluator agent
created: 2026-04-02
---

# Fix duplicate `feat(...)` commits created by evaluator agent

## Problem / Motivation

The evaluator agent creates a second `feat(plan-id): Plan Name` commit that is identical to the builder's commit, cluttering git history. This happens because the evaluator prompt always runs `git reset --soft HEAD~1`, which only undoes ONE commit. When intermediate commits exist between the builder and evaluator (e.g., tester's `test(...)` commits), the evaluator only resets the intermediate commit, leaving the builder's original `feat(...)` commit intact, then creates a new `feat(...)` commit on top with the same message.

**Example from git log (the problem):**
```
0f43918 feat(plan-01-evaluator-continuation): Evaluator Agent Continuation Support   <-- evaluator (duplicate)
8b8eec1 feat(plan-01-evaluator-continuation): Evaluator Agent Continuation Support   <-- builder (original)
```

**Affected flow - test-cycle:**
1. Builder commits: `feat(plan-01): ...` (commit A)
2. Tester commits: `test(plan-01): fix test issues` (commit B)
3. Evaluator: `git reset --soft HEAD~1` - only resets B, A remains
4. Evaluator commits: `feat(plan-01): ...` (commit C) - duplicate of A

**Unaffected flow - review-cycle:** Works correctly because reviewer/fixer don't commit, so `HEAD~1` targets the builder's commit directly.

## Goal

Track the pre-builder commit SHA and pass it to the evaluator so it resets to the correct point, squashing ALL intermediate commits into one clean `feat(...)` commit - eliminating duplicate commits in git history.

## Approach

Capture the git commit SHA before the implement stage runs and thread it through the build context to the evaluator agent, which uses it as the reset target instead of the hardcoded `HEAD~1`.

### 1. Add `preImplementCommit` to `BuildStageContext`

**File:** `src/engine/pipeline.ts:85-97`

Add an optional field to track the commit SHA before the builder ran:

```typescript
export interface BuildStageContext extends PipelineContext {
  // ... existing fields ...
  /** Commit SHA before the implement stage ran. Used by evaluator to reset to the right point. */
  preImplementCommit?: string;
}
```

### 2. Capture the SHA at the start of `implementStage`

**File:** `src/engine/pipeline.ts:1314` (top of `implementStage`)

Before the builder runs, capture `git rev-parse HEAD`:

```typescript
// Capture pre-implement commit for evaluator to squash back to
try {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: ctx.worktreePath });
  ctx.preImplementCommit = stdout.trim();
} catch {
  // If we can't get the SHA (e.g., no commits yet), leave undefined
}
```

### 3. Pass the SHA through to the evaluator

**File:** `src/engine/pipeline.ts` - `evaluateStageInner` (~line 1516)

Pass `preImplementCommit` from ctx to `builderEvaluate` options:

```typescript
for await (const event of builderEvaluate(ctx.planFile, {
  // ... existing options ...
  preImplementCommit: ctx.preImplementCommit,
})) {
```

**File:** `src/engine/agents/builder.ts` - `BuilderOptions` interface

Add the field:

```typescript
export interface BuilderOptions extends SdkPassthroughConfig {
  // ... existing fields ...
  /** Pre-implement commit SHA for evaluator reset target */
  preImplementCommit?: string;
}
```

**File:** `src/engine/agents/builder.ts` - `builderEvaluate` function (~line 160)

Pass it to the prompt as a template variable:

```typescript
const prompt = await loadPrompt('evaluator', {
  plan_id: plan.id,
  plan_name: plan.name,
  // ... existing vars ...
  reset_target: options.preImplementCommit ?? 'HEAD~1',
});
```

### 4. Update the evaluator prompt

**File:** `src/engine/prompts/evaluator.md:17-19`

Change from:

```markdown
First, run this command to create the staged vs unstaged comparison:

```bash
git reset --soft HEAD~1
```
```

To:

```markdown
First, run this command to create the staged vs unstaged comparison:

```bash
git reset --soft {{reset_target}}
```
```

### 5. Update continuation context in `builderEvaluate`

The continuation context string in `builderEvaluate` (~line 175) currently says `"Do NOT run \`git reset --soft HEAD~1\` again"`. Update it to reference the actual reset target:

```typescript
continuationContextText = `...Do NOT run \`git reset --soft ${options.preImplementCommit ?? 'HEAD~1'}\` again...`;
```

## Scope

**In scope:**
- Adding `preImplementCommit` field to `BuildStageContext`
- Capturing the commit SHA at the start of `implementStage`
- Threading the SHA through to `builderEvaluate`
- Updating the evaluator prompt to use `{{reset_target}}` instead of hardcoded `HEAD~1`
- Updating the continuation context string to reference the correct reset target

**Out of scope:**
- Changes to the review-cycle flow (already works correctly)
- Changes to builder, tester, or reviewer agents

**Files to modify:**
1. `src/engine/pipeline.ts` - Add `preImplementCommit` to `BuildStageContext`, capture SHA in `implementStage`, pass to `evaluateStageInner`
2. `src/engine/agents/builder.ts` - Add `preImplementCommit` to `BuilderOptions`, pass `reset_target` to evaluator prompt, update continuation context string
3. `src/engine/prompts/evaluator.md` - Use `{{reset_target}}` instead of `HEAD~1`

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm build` compiles successfully
- `pnpm test` passes all existing tests
- When running a build with test-cycle stages, only one `feat(...)` commit appears in git history (no duplicate from evaluator)
- When `preImplementCommit` is unavailable (e.g., no prior commits), the evaluator falls back to `HEAD~1`
- Review-cycle flow continues to work correctly
