---
title: Builder Continuation on maxTurns Exhaustion
created: 2026-03-25
status: pending
---

# Builder Continuation on maxTurns Exhaustion

## Problem / Motivation

A build for `fix-activity-indicators-not-showing-in-pipeline-bars` failed with `error_max_turns` after 118 tool uses (75 turn limit). The task required editing ~100+ event yield sites across 17+ files — a large but mechanical refactor that simply exceeded the builder's turn budget.

Dynamically scaling `maxTurns` is undesirable because it creates unbounded agent runs and stale context windows. There is currently no mechanism to recover from turn exhaustion when partial progress has been made, causing entire builds to fail even when the work is straightforward but voluminous.

## Goal

Enable the implement stage to chain multiple builder invocations with managed handoff when one maxes out on turns, keeping a fixed per-agent `maxTurns` while allowing large mechanical refactors to complete across continuation attempts.

## Approach

**Builder continuation** — when a builder hits `error_max_turns`:

1. Detect progress via `git diff` in the worktree.
2. Create an intermediate commit (via `forgeCommit()`) to checkpoint the work.
3. Generate a continuation prompt containing the original plan + diff of completed work.
4. Launch a new builder with fresh context that picks up where the previous one left off.
5. Repeat up to `maxContinuations` times (default: 3).

This is modeled on the existing `review-cycle` composite stage pattern (`pipeline.ts:914-937`).

### Benefits over dynamic maxTurns

- Each builder stays within predictable context bounds (fresh context = better attention on remaining work).
- Natural checkpointing via git commits.
- No risk of runaway agents.
- Continuation count is tunable per-plan and via config.

### Implementation Details

#### 1. Continuation loop in `implementStage` (`src/engine/pipeline.ts`)

Wrap the `builderImplement()` call in a continuation loop. On `error_max_turns`:
- Check `git status --porcelain` for changes.
- If no changes → no progress, bail (real failure).
- If changes exist → intermediate commit, build continuation prompt, retry.

```
for continuation 0..maxContinuations:
  try:
    yield* builderImplement(planFile, { maxTurns, continuationContext })
    break  // success
  catch error_max_turns:
    changes = git status --porcelain
    if no changes: fail (no progress)
    git add -A && forgeCommit("WIP: continuation {n}")
    diff = git diff baseBranch...HEAD
    continuationContext = { attempt: n, completedDiff: diff }
    yield build:implement:continuation event
    continue
```

The continuation prompt prepends to the plan:

```
## Continuation Context (attempt {n} of {max})
A previous builder ran out of turns. Below is the diff of work completed so far.
Continue implementing the remaining items from the plan. Do NOT redo already-completed work.

<completed_diff>
{git diff output}
</completed_diff>
```

#### 2. Continuation event (`src/engine/events.ts`)

```typescript
| { type: 'build:implement:continuation'; planId: string; attempt: number; completedFiles: string[] }
```

#### 3. `maxContinuations` config (`src/engine/config.ts`)

Add to the `agents` config section:

```typescript
agents: { maxTurns: 30, maxContinuations: 3, permissionMode: 'bypass', settingSources: ['project'] }
```

Overridable in `eforge.yaml` under `agents.maxContinuations`.

#### 4. Per-plan `maxContinuations` override (`src/engine/events.ts`)

Add to `OrchestrationConfig.plans` entries:

```typescript
plans: Array<{ ...; maxContinuations?: number }>
```

Priority: per-plan override > config value > default (3).

#### 5. Builder prompt update (`src/engine/prompts/builder.md`)

Add a section to handle continuation context when provided:

```
{{#if continuation_context}}
## Continuation Notice
This is continuation attempt {{continuation_attempt}} of {{max_continuations}}.
A previous builder ran out of turns after completing partial work.
The diff below shows what has already been implemented — do NOT redo this work.
Focus on the remaining unimplemented items from the plan.

<completed_diff>
{{completed_diff}}
</completed_diff>
{{/if}}
```

Also add a general instruction: "If you are running low on turns and have many files remaining, use the Agent tool to parallelize edits across multiple files."

#### 6. Error discrimination

In the catch block, check if the error message contains `error_max_turns`. Only attempt continuation for turn exhaustion — other errors (permission, abort, etc.) should fail immediately.

#### 7. Intermediate commits

Use the existing `forgeCommit()` helper from `src/engine/git.ts`. These WIP commits get squashed during the final merge, so they're invisible in the final history.

#### 8. Diff size management

If the completed diff is very large, truncate to last N lines or summarize file names only, to avoid filling the continuation builder's context.

#### 9. Progress detection

`git status --porcelain` is the right check — if the builder made zero changes, continuation won't help (it's stuck, not just slow).

### Files to Modify

| File | Change |
|------|--------|
| `src/engine/pipeline.ts` | Add continuation loop to `implementStage`, detect `error_max_turns`, build continuation context |
| `src/engine/events.ts` | Add `build:implement:continuation` event, add `maxContinuations?` to `OrchestrationConfig.plans` |
| `src/engine/config.ts` | Add `maxContinuations` to `agents` config defaults |
| `src/engine/agents/builder.ts` | Accept `continuationContext` in `BuilderOptions`, inject into prompt template |
| `src/engine/prompts/builder.md` | Add continuation context section, encourage Agent tool for bulk edits |
| `src/cli/renderer.ts` | Render `build:implement:continuation` event in CLI output |
| `test/pipeline.test.ts` | Test continuation loop logic (mock backend that fails with max_turns) |

## Scope

### In Scope

- Continuation loop in `implementStage` triggered by `error_max_turns`.
- Intermediate git commit checkpointing via `forgeCommit()`.
- Continuation prompt generation with completed diff context.
- `maxContinuations` config at global and per-plan levels.
- New `build:implement:continuation` event and CLI rendering.
- Builder prompt updates for continuation context and parallelization guidance.
- Error type discrimination (`error_max_turns` vs. other errors).
- Diff size management / truncation for large diffs.
- Unit tests for continuation loop logic.

### Out of Scope

- Dynamic scaling of `maxTurns`.
- Changes to the review-cycle or other existing composite stage patterns.
- Modifications to the MCP/Claude agent SDK itself.

## Acceptance Criteria

- `pnpm type-check` passes.
- `pnpm build` succeeds.
- `pnpm test` passes, including new continuation tests (mock backend that fails with `max_turns`).
- When a builder hits `error_max_turns` and has made progress (dirty worktree), the implement stage automatically creates an intermediate commit and launches a new builder with continuation context.
- When a builder hits `error_max_turns` with no changes (clean worktree), the build fails immediately without retrying.
- Non-`error_max_turns` errors (permission, abort, etc.) fail immediately without attempting continuation.
- `maxContinuations` is configurable globally via `agents.maxContinuations` in config and overridable per-plan in `orchestration.yaml`.
- Default `maxContinuations` is 3.
- The `build:implement:continuation` event is emitted and rendered in CLI output.
- The continuation prompt includes the original plan and a diff of completed work, instructing the builder not to redo already-completed work.
- Large diffs are truncated or summarized to avoid filling the continuation builder's context window.
- Re-running the failed PRD (`fix-activity-indicators-not-showing-in-pipeline-bars`) results in the builder continuing successfully after hitting `maxTurns` on the first attempt.
