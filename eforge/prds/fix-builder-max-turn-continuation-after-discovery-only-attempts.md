---
title: Fix Builder Max-Turn Continuation After Discovery-Only Attempts
created: 2026-05-26
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Fix Builder Max-Turn Continuation After Discovery-Only Attempts

## Problem / Motivation

The builder retry policy advertises continuation support for `error_max_turns`, but a builder attempt that spends all turns on codebase discovery and produces no git diff fails immediately instead of handing off what it learned to a continuation attempt.

Evidence from the failed `automate-git-spice-stack-sync-and-restack-workflow` build shows `plan-02-daemon-cli-stack-sync` stopped at builder max turns without a continuation handoff. Monitor DB events for run `10d6827f-2f59-4bd4-84d4-88d198a2b1f7` show:

- `agent:stop` for `builder` with `Reached maximum number of turns (80)`.
- `plan:build:failed` with `terminalSubtype: error_max_turns`.
- No `agent:retry` event for `plan-02-daemon-cli-stack-sync`.
- No `plan:build:implement:continuation` event for `plan-02-daemon-cli-stack-sync`.
- Discovery-heavy tool-use counts: `Read` 56, `Grep` 18, `Bash` 18, `Glob` 3.
- No edit/write activity in the tool-use counts.

Confirmed reproduction from persisted events:

1. Run a build whose builder exhausts its turn budget before creating any worktree changes.
2. Inspect monitor DB events for `run_id = 10d6827f-2f59-4bd4-84d4-88d198a2b1f7` and `plan_id = plan-02-daemon-cli-stack-sync`.
3. Observe `agent:stop` with `agent = builder` and `error = Reached maximum number of turns (80)`.
4. Observe `plan:build:failed` with `terminalSubtype = error_max_turns`.
5. Observe that no `agent:retry` event exists for that plan.
6. Observe that no `plan:build:implement:continuation` event exists for that plan.

Expected behavior: eforge emits `agent:retry` and `plan:build:implement:continuation`, then starts another builder attempt with a continuation context containing useful discovery handoff information.

Actual behavior: eforge treats the max-turn terminal as a final build failure because the continuation input builder cannot checkpoint an empty diff.

Workaround today: manually split/retry the remaining work through recovery or enqueue a successor PRD. That preserves progress at the PRD level but does not preserve the failed builder attempt's discovery context.

Why it matters now: broad implementation plans can legitimately spend a first builder attempt reading/searching before editing. Losing that discovery work causes avoidable failed builds, noisy recovery, and successor PRDs for work that eforge should have continued automatically.

## Goal

A builder attempt that reaches `error_max_turns` after discovery-only work should continue automatically with a bounded discovery handoff instead of failing immediately.

The existing diff-checkpoint continuation behavior should remain intact when worktree changes exist.

## Approach

Code inspection confirms the continuation gap:

- `packages/engine/src/retry.ts` has a builder retry policy that should retry `error_max_turns`.
- `buildBuilderContinuationInput()` throws when `hasAnyChanges(worktreePath)` is false.
- `withRetry()` catches a thrown continuation-builder error and propagates the original held-back terminal event instead of retrying.
- The builder continuation prompt in `packages/engine/src/agents/builder.ts` assumes all prior progress was committed and only passes `completedDiff`, so it has no no-diff discovery handoff mode.

Confirmed root cause:

- `packages/engine/src/retry.ts` registers the builder retry policy with `error_max_turns` as retryable and `buildBuilderContinuationInput()` as the continuation input builder.
- `buildBuilderContinuationInput()` calls `hasAnyChanges(worktreePath)` and throws `Builder continuation aborted: no changes to checkpoint` when no changes exist.
- `withRetry()` catches continuation-builder throws and yields the original held-back terminal event instead of emitting `agent:retry` or starting a continuation attempt.
- `packages/engine/src/agents/builder.ts` renders continuation context as a committed-diff handoff and states, `All prior progress has been committed.` That is true only for the current diff-checkpoint path and is false for discovery-only attempts.

Design direction:

- Extend builder continuation context to support both committed-diff handoff and discovery-only handoff.
- Factor or generalize discovery extraction so builder and review-fixer can share the same event-derived handoff logic without duplicating parsing logic.
- Preserve existing checkpoint behavior when a diff exists, including `forgeCommit()` and `composeCommitMessage()` for builder continuation checkpoint commits.
- Avoid treating discovery-only continuation as success; it should retry until the configured continuation budget is exhausted, and then fail with `error_max_turns` if no attempt completes.

Existing pattern to reuse:

- `buildReviewFixerContinuationInput()` in `packages/engine/src/retry.ts` already extracts bounded discovery context from `agent:tool_use`, `agent:tool_result`, and `agent:message` events and continues even when `partialDiff` is empty.
- `extractReviewFixerDiscoveryContext()` already parses `agent:tool_use`, `agent:tool_result`, and `agent:message` events for files inspected, searches, commands, recent messages, and snippets.
- Prompt rendering in `packages/engine/src/agents/review-fixer.ts` includes files inspected, searches, commands, recent messages, and snippets so the next attempt does not restart cold.

Related latent issue:

- `buildShardedBuilderContinuationInput()` has a similar no-scope-changes throw.
- Sharded builders can also spend an attempt on discovery before scoped edits.
- The implementation should either cover sharded builder discovery handoff too, or explicitly test and document why shard behavior remains intentionally stricter.
- Since the same retry helper owns both paths, covering both is likely low incremental cost.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed `plan-02` attempt had no worktree changes, causing `buildBuilderContinuationInput()` to throw. | Monitor DB showed discovery-only tool usage and no `agent:retry`; code inspection shows the only pre-retry no-diff branch throws. The failed worktree had already been removed, so direct `git status` validation was not possible. | medium | medium | Reproduce with a unit test where `withRetry()` receives a builder `plan:build:failed` event with `terminalSubtype: error_max_turns` and a clean temp git worktree. | If wrong, the specific observed failure may have had another continuation-builder failure, but the no-diff bug still exists and is testable. |
| Event-derived discovery context is sufficient for a useful builder handoff. | Review-fixer already uses the same event stream shape for no-diff continuation; harnesses emit `agent:tool_use`, `agent:tool_result`, and `agent:result` in non-verbose paths. | high | low | Add tests with Read/Grep/Bash/Glob events and assert builder continuation context contains bounded summaries. | If wrong, continuation may retry but still waste turns rediscovering context. |
| Discovery extraction can be shared between builder and review-fixer without changing wire schemas. | The extraction is internal to `packages/engine/src/retry.ts`; continuation context is in-process prompt input, not a daemon event payload. | high | low | Refactor the extractor to accept an agent role filter and run existing review-fixer continuation tests. | If wrong, duplicated extractor logic may be safer for the first bugfix. |
| Sharded builder no-diff behavior should be considered with this fix. | `buildShardedBuilderContinuationInput()` has the same throw-on-no-scope-changes pattern; no observed sharded failure was inspected. | medium | low | Add a focused unit test for no-scope-changes shard continuation and decide whether to implement handoff or preserve terminal behavior with documented rationale. | If ignored, the same class of max-turn failure may remain for sharded builds. |
| No public API or documentation update is required. | The change is internal engine retry behavior and prompt context; no route, CLI, config, or integration surface changes were identified. | high | low | Run `rg` for public docs mentioning builder continuation only if implementation introduces new user-facing behavior. | If wrong, docs may omit an operational behavior change, but runtime correctness is unaffected. |

Profile signal: **Excursion**.

Rationale: this is a cohesive engine bugfix with a confirmed root cause and a bounded implementation area (`retry.ts`, builder prompt rendering, and continuation tests). It is more than an Errand because it changes retry semantics and prompt context across builder attempts. It does not need Expedition because a single planner can enumerate the affected paths and acceptance criteria without delegating module planning.

## Scope

In scope:

- Engine bugfix / focused change.
- `packages/engine/src/retry.ts`.
- Builder continuation context.
- Builder continuation prompt rendering in `packages/engine/src/agents/builder.ts`.
- Continuation tests.
- Potential shared discovery-context extraction for builder and review-fixer.
- Preserving existing checkpoint commit behavior when builder continuation has a diff.
- Considering sharded builder no-diff continuation behavior because `buildShardedBuilderContinuationInput()` has the same throw-on-no-scope-changes pattern.
- Ensuring existing review-fixer continuation behavior continues to include discovery context when its diff is empty.

Out of scope:

- New daemon features.
- New wrapper workflow features.
- Public API changes unless implementation introduces new user-facing behavior.
- Documentation updates unless implementation introduces new user-facing behavior.
- Roadmap feature work.

Roadmap alignment: this is not a roadmap feature, but it supports Integration & Maturity by improving build reliability and recovery behavior. It should remain an engine bugfix, not a new daemon or wrapper workflow.

Classification: this is a bugfix / focused change. The defect is confirmed by persisted run events plus direct code inspection. The likely implementation is cohesive enough for one plan: extend builder continuation context and tests rather than adding a new subsystem.

## Acceptance Criteria

- A single-builder attempt that ends with `error_max_turns` and has no worktree changes emits an `agent:retry` event before the final continuation budget is exhausted.
- A single-builder attempt that ends with `error_max_turns` and has no worktree changes emits a `plan:build:implement:continuation` event before the next builder attempt starts.
- The next single-builder attempt receives `builderOptions.continuationContext` containing a marker or equivalent data that distinguishes discovery-only handoff from committed-diff handoff.
- The next single-builder attempt receives bounded discovery context derived from the previous attempt's builder `agent:tool_use`, `agent:tool_result`, and `agent:message` events.
- The builder continuation prompt does not state that prior progress was committed when no checkpoint commit was created.
- A single-builder attempt that ends with `error_max_turns` and has worktree changes still creates a continuation checkpoint commit with `forgeCommit()` before retrying.
- A single-builder attempt that ends with `error_max_turns` and has worktree changes still passes a completed diff summary to the next builder attempt.
- If every single-builder continuation attempt ends with `error_max_turns`, the final output includes `plan:build:failed` with `terminalSubtype: error_max_turns`.
- Sharded builder continuation supports no-diff discovery handoff with `agent:retry` and `plan:build:implement:continuation`, or an explicit regression test documents that no-diff shard attempts intentionally remain terminal failures.
- Existing review-fixer continuation behavior continues to include discovery context when its diff is empty.
- `pnpm vitest test/retry.test.ts test/continuation.test.ts test/review-fixer-continuation.test.ts test/sharded-builder.test.ts` exits 0.
- `pnpm type-check` exits 0.
