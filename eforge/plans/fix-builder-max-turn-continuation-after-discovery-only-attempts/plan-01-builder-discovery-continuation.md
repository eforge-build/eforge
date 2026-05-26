---
id: plan-01-builder-discovery-continuation
name: Builder Discovery-Only Continuation
branch: fix-builder-max-turn-continuation-after-discovery-only-attempts/plan-01-builder-discovery-continuation
---

# Builder Discovery-Only Continuation

## Architecture Context

The engine retry layer owns continuation decisions for builder, sharded builder, evaluator, planner, and review-fixer agents. Builder continuation already checkpoints worktree changes with `forgeCommit()` and passes a `completedDiff` to the next attempt, while review-fixer continuation already supports an empty diff by extracting bounded discovery context from agent events.

This plan fixes the builder gap by adding a discovery-only continuation mode for clean worktrees, while preserving the existing checkpoint commit path whenever builder worktree changes exist.

## Implementation

### Overview

Extend builder continuation context to distinguish checkpointed-diff handoffs from discovery-only handoffs. When a builder max-turn attempt has no worktree changes, build the next attempt input from bounded builder discovery events instead of throwing. Apply the same no-diff discovery handoff to sharded builders, and keep review-fixer discovery behavior intact by sharing the extractor logic.

### Key Decisions

1. Use a discriminated continuation context such as `handoffMode: 'checkpointed-diff' | 'discovery-only'` so prompt rendering can avoid saying prior work was committed in discovery-only retries.
2. Keep the current checkpoint behavior for changed worktrees: `git add -A`, `forgeCommit()`, `composeCommitMessage()`, and `buildContinuationDiff()` remain on the diff path.
3. Generalize the review-fixer discovery extractor into an agent-filtered helper, then keep `extractReviewFixerDiscoveryContext()` as a compatibility wrapper for existing tests and call sites.
4. For sharded builders, return a discovery-only retry when there are no scoped changes to stash, rather than throwing. Preserve the existing stash path when scoped working-tree changes exist.

## Scope

### In Scope

- Single-builder no-diff continuation after `error_max_turns`.
- Sharded-builder no-diff continuation after `error_max_turns`.
- Builder continuation prompt text for checkpointed-diff and discovery-only modes.
- Shared bounded discovery extraction from `agent:tool_use`, `agent:tool_result`, and `agent:message` events.
- Regression tests for retry events, continuation events, prompt text, checkpoint commits, final exhaustion, and review-fixer discovery preservation.

### Out of Scope

- Daemon routes, monitor UI, CLI, MCP, plugin, or Pi integration changes.
- Public API or event schema changes.
- Documentation updates.
- Retry policies for unrelated agent roles.

## Files

### Modify

- `packages/engine/src/retry.ts` — export a shared `DiscoveryContext`; add an agent-filtered discovery extractor; update `BuilderContinuationInput` / builder continuation context to include a handoff mode and optional discovery fields; make `buildBuilderContinuationInput()` return a discovery-only retry for clean worktrees; make `buildShardedBuilderContinuationInput()` return a discovery-only retry for no scoped changes; preserve checkpoint commit and stash behavior when changes exist.
- `packages/engine/src/agents/builder.ts` — update `BuilderOptions.continuationContext` to the new discriminated context shape; render checkpointed-diff continuation with the existing committed-progress guidance; render discovery-only continuation with files inspected, searches, commands, recent messages, and tool-result snippets; omit the committed-progress statement when no checkpoint commit was created.
- `test/retry.test.ts` — add unit/integration coverage for single-builder clean-worktree continuation, discovery extraction for builder events, preserved diff checkpoint continuation, and final `error_max_turns` exhaustion after all builder attempts fail.
- `test/continuation.test.ts` — update builder prompt continuation tests for the new context marker; add discovery-only prompt assertions that the prompt includes discovery sections and excludes `All prior progress has been committed`.
- `test/review-fixer-continuation.test.ts` — adjust imports or expectations if the extractor is factored; retain tests proving review-fixer empty-diff continuation includes discovery context.
- `test/sharded-builder.test.ts` — replace the throw-on-no-scope-changes assertion with discovery-only retry assertions; add or update a `withRetry` + shard policy test that emits `agent:retry` and `plan:build:implement:continuation` for no-diff shard retries.

## Implementation Notes

### Shared discovery extraction

- Introduce a helper such as `extractDiscoveryContext(events, agent)` or `extractAgentDiscoveryContext(events, agent)` in `packages/engine/src/retry.ts`.
- Preserve the current bounds: files inspected, searches, commands, recent messages, and tool-result snippets stay limited by the existing constants.
- Keep `extractReviewFixerDiscoveryContext(events)` as a wrapper around the shared helper with `agent = 'review-fixer'`.
- Add a builder wrapper such as `extractBuilderDiscoveryContext(events)` or call the shared helper directly with `agent = 'builder'`.

### Builder continuation input

- Define a builder continuation context shape equivalent to:

```ts
type BuilderContinuationContext = {
  attempt: number;
  maxContinuations: number;
} & (
  | { handoffMode: 'checkpointed-diff'; completedDiff: string }
  | { handoffMode: 'discovery-only'; filesInspected: string[]; searches: string[]; commands: string[]; recentMessages: string[]; toolResultSnippets: string[] }
);
```

- In `buildBuilderContinuationInput()`, call `hasAnyChanges(worktreePath)`.
  - If true, keep the existing checkpoint commit and completed diff behavior, and set `handoffMode: 'checkpointed-diff'`.
  - If false, do not commit, do not throw, and return `{ kind: 'retry' }` with `handoffMode: 'discovery-only'` plus builder discovery context.

### Sharded builder continuation input

- In `buildShardedBuilderContinuationInput()`, preserve the existing stash path when scoped working-tree changes exist.
- When no scoped changes exist, return a retry with `handoffMode: 'discovery-only'` and builder discovery context instead of throwing.
- Preserve the existing tests for stash message format, stash diff capture, `--keep-index`, and attempt number.

### Builder prompt rendering

- For `handoffMode: 'checkpointed-diff'`, keep the existing committed-progress message and `<completed_diff>` block.
- For `handoffMode: 'discovery-only'`, render a section that says no checkpoint commit was created and lists the bounded discovery context. Include instructions to use the handoff and avoid restarting codebase exploration from scratch.
- Render empty discovery lists without adding misleading claims; if all lists are empty, include a concise sentence that no discovery events were captured.

## Verification

- [ ] A clean single-builder retry path emits exactly one `agent:retry` before the second attempt when `maxAttempts` is 2.
- [ ] A clean single-builder retry path emits `plan:build:implement:continuation` before the second attempt starts.
- [ ] The second single-builder input contains `builderOptions.continuationContext.handoffMode === 'discovery-only'`.
- [ ] The discovery-only builder context contains file, search, command, message, and tool-result data from builder events used in the test.
- [ ] The discovery-only builder prompt does not contain `All prior progress has been committed`.
- [ ] The changed-worktree builder continuation path creates a checkpoint commit and passes a `completedDiff` with `handoffMode === 'checkpointed-diff'`.
- [ ] When all single-builder attempts fail with `error_max_turns`, the emitted final build failure has `terminalSubtype === 'error_max_turns'`.
- [ ] A no-diff sharded builder retry emits `agent:retry` and `plan:build:implement:continuation`.
- [ ] Review-fixer empty-diff continuation tests still show discovery context in the next prompt.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/retry.test.ts test/continuation.test.ts test/review-fixer-continuation.test.ts test/sharded-builder.test.ts` exits 0.
