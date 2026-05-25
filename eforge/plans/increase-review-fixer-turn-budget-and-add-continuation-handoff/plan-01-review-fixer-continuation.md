---
id: plan-01-review-fixer-continuation
name: Review-Fixer Turn Budget and Continuation Handoff
branch: increase-review-fixer-turn-budget-and-add-continuation-handoff/plan-01-review-fixer-continuation
agents:
  builder:
    effort: high
    rationale: Touches retry policy, wire events, prompt context, config precedence,
      and git-safety tests; requires careful preservation of evaluator
      boundaries.
  reviewer:
    effort: high
    rationale: Review must verify max-turn retry semantics and that review-fixer
      does not stage, commit, reset, or falsely complete after terminal errors.
---

# Review-Fixer Turn Budget and Continuation Handoff

## Architecture Context

Eforge resolves agent runtime configuration through tier recipes plus role and plan overrides. Builder continuation already uses `withRetry(...)` and commits checkpoint progress, but review-fixer changes are intentionally left unstaged for the evaluator to accept or reject. This plan moves the generic implementation turn budget into the implementation tier and adds a review-fixer continuation path that preserves the working tree without staging, committing, resetting, or depending on a diff existing.

## Implementation

### Overview

Implement the remaining source requirements in one cohesive engine/client slice:

1. Make the built-in implementation tier carry the default 80-turn implementation budget.
2. Ensure `review-fixer` and `validation-fixer` inherit that budget unless a plan, role, or tier override supplies a different value.
3. Stop `runReviewFixer()` from forcing `maxTurns: 30`; pass resolved `maxTurns` through to the harness.
4. Surface only `error_max_turns` from review-fixer as retryable while preserving non-fatal handling for other fixer errors.
5. Add a review-fixer retry policy and continuation input that builds bounded discovery handoff context from failed-attempt events plus candidate worktree state.
6. Wrap the review-fix stage in `withRetry(...)` and emit `agent:retry` plus a domain continuation event before each continuation attempt.
7. Add focused tests for config resolution, retry emission, no-diff continuation, and git boundary safety.

### Key Decisions

1. **Review-fixer continuation does not checkpoint through git.** Builder continuation can stage and commit. Review-fixer must leave all candidate changes unstaged for evaluator, so the continuation builder must only inspect git state and event history.
2. **Max-turn retry is selective.** `runReviewFixer()` must rethrow or otherwise classify `error_max_turns` so `withRetry()` can observe it. Generic review-fixer crashes remain non-fatal and still produce the existing complete event behavior.
3. **Discovery handoff is event-derived, not diff-only.** The failed attempt may have spent all turns reading and searching. The next attempt prompt must include bounded summaries of files read, search/glob/bash inputs, useful tool-result snippets, recent agent messages/results, unresolved issues, and candidate diff/status when available.
4. **Use a review-fixer-specific continuation event.** Add `plan:build:review:fix:continuation` rather than reusing builder or evaluator continuation events. The event carries `planId`, `attempt`, and `maxContinuations`; detailed handoff content stays in the prompt, not the wire event.
5. **Bound the handoff.** Apply explicit caps to avoid huge prompts, for example: files inspected count/list, searches/commands count/list, last few messages, short tool-result snippets, `git status --porcelain`, and a truncated `git diff HEAD --` summary. Exact constants can live near the retry helper and must be covered by unit tests.

## Scope

### In Scope

- Add `maxTurns: 80` to the built-in `implementation` tier recipe.
- Remove builder's redundant built-in role max-turn exception or adjust resolution so builder inherits implementation tier `maxTurns` and project/profile `agents.tiers.implementation.maxTurns` can override it.
- Preserve explicit plan and role max-turn override precedence above tier defaults.
- Ensure `resolveAgentConfig('review-fixer', DEFAULT_CONFIG).maxTurns === 80`.
- Ensure `resolveAgentConfig('validation-fixer', DEFAULT_CONFIG).maxTurns === 80`.
- Ensure project/profile implementation tier `maxTurns` overrides the built-in implementation default for roles that inherit the implementation tier budget.
- Update `runReviewFixer()` to accept/pass `maxTurns` from resolved config and default to 80 when called directly without config.
- Add review-fixer continuation prompt support to `packages/engine/src/prompts/review-fixer.md` and `packages/engine/src/agents/review-fixer.ts`.
- Add `ReviewFixerContinuationInput`, context-building helpers, and `DEFAULT_RETRY_POLICIES['review-fixer']` in `packages/engine/src/retry.ts`.
- Wrap `reviewFixStageInner()` with `withRetry(...)` using the review-fixer policy and plan/global continuation bound.
- Emit `agent:retry` with `agent: review-fixer` and label such as `review-fixer-continuation` on retry.
- Add `plan:build:review:fix:continuation` to the client wire schema, event registry, wire parity fixtures, schema tests, CLI display, and monitor UI reducer event allow-list.
- On final review-fixer max-turn exhaustion, avoid emitting `plan:build:review:fix:complete`; emit an existing `agent:warning` describing the exhausted retry budget, leave candidate changes untouched, and allow evaluator to inspect any final unstaged changes.
- Add tests proving continuation does not run `git add`, does not commit, does not reset staged/unstaged state, and still retries when the failed attempt produced no diff.

### Out of Scope

- Staging, committing, stashing, or resetting review-fixer candidate changes.
- Changing evaluator acceptance/rejection semantics.
- Changing review issue generation or review perspective selection.
- Queue reordering, overseer, extension policy gates, stacked-provider work, or TypeScript project-reference work.
- Claude Code plugin or Pi extension command/MCP changes; no user-facing command surface changes are required.

## Files

### Create

- `test/review-fixer-continuation.test.ts` — focused integration/unit coverage for review-fixer retry behavior, no-diff handoff, prompt continuation context, and git safety using real temporary git repositories plus `StubHarness`.

### Modify

- `packages/engine/src/config.ts` — add `maxTurns: 80` to `DEFAULT_TIER_RECIPES.implementation`.
- `packages/engine/src/pipeline/agent-config.ts` — adjust max-turn defaulting so implementation-tier budget is tier-derived for builder/review-fixer/validation-fixer and still respects plan, role, and tier overrides; update comments describing precedence.
- `packages/engine/src/agents/review-fixer.ts` — add typed `maxTurns` and continuation context options; pass `options.maxTurns ?? 80`; render continuation context; rethrow/classify `error_max_turns` while swallowing other non-abort errors.
- `packages/engine/src/prompts/review-fixer.md` — add an optional continuation section that instructs the agent to use prior discovery, avoid redoing completed work, preserve unstaged changes, and continue resolving the same issue list.
- `packages/engine/src/retry.ts` — add review-fixer continuation input/context types, bounded event/diff summarization helpers, no-git-mutation continuation builder, and `DEFAULT_RETRY_POLICIES['review-fixer']` with `error_max_turns` retryability and continuation event emission.
- `packages/engine/src/pipeline/stages/build-stages.ts` — wrap `runReviewFixer(...)` in `withRetry(...)`, pass continuation context into retry attempts, retain `withPeriodicFileCheck(...)`, keep activity attribution, and emit a warning instead of a false fix-complete on exhausted retry attempts.
- `packages/client/src/events.schemas.ts` — add `plan:build:review:fix:continuation` with `planId`, `attempt`, and `maxContinuations`.
- `packages/client/src/event-registry.ts` — register and summarize `plan:build:review:fix:continuation`.
- `packages/client/src/api-version.ts` — bump the daemon API version and comment because the wire event schema gains a new variant.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add a wire fixture for `plan:build:review:fix:continuation`.
- `packages/client/src/__tests__/events-schemas.test.ts` — add safe-parse coverage for the new continuation event and review-fixer `agent:retry` payload.
- `packages/eforge/src/cli/display.ts` — render the review-fix continuation event as spinner progress or rely on registry summary with an explicit case near review-fix start/complete.
- `packages/monitor-ui/src/lib/reducer/index.ts` — add the new continuation event to the non-state event list so the event union remains exhaustive.
- `test/pipeline.test.ts` or `test/agent-config.resolution.test.ts` — add/update config-resolution tests for review-fixer, validation-fixer, builder tier inheritance, role override, plan override, and project/profile tier override.
- `test/validation-fixer.test.ts` — update max-turn expectation if validation-fixer now receives 80 through resolved config paths used by the test, or add direct config-resolution coverage if the runner remains directly defaulted.
- `test/parallel-reviewer.test.ts` — add review-fixer harness option and max-turn error propagation tests while preserving the generic non-abort swallow test.
- `test/retry.test.ts` — add review-fixer policy assertions and `withRetry(...)` tests for retry emission, domain continuation event emission, no-diff retry, bounded handoff fields, and no git mutation.

## Verification

- [ ] `resolveAgentConfig('review-fixer', DEFAULT_CONFIG).maxTurns` equals `80`.
- [ ] `resolveAgentConfig('validation-fixer', DEFAULT_CONFIG).maxTurns` equals `80`.
- [ ] A custom `agents.tiers.implementation.maxTurns` value is returned for builder/review-fixer/validation-fixer unless a plan or per-role override supplies another value.
- [ ] `runReviewFixer({ maxTurns: 80, ... })` calls the harness with `maxTurns: 80`, and direct calls without `maxTurns` use `80` rather than `30`.
- [ ] `runReviewFixer()` rethrows or emits a classified terminal signal for `AgentTerminalError` subtype `error_max_turns`; it still swallows a generic `Error('Backend failed')` and emits `plan:build:review:fix:complete`.
- [ ] A failed review-fixer attempt with no working-tree diff still emits `agent:retry` and `plan:build:review:fix:continuation`, and the next prompt includes bounded files inspected, read-file paths, grep/glob/search inputs, bash command inputs, useful findings or tool-result snippets, recent relevant agent messages, and unresolved review issues.
- [ ] A failed review-fixer attempt with candidate changes includes bounded git status/diff context in the continuation prompt.
- [ ] Review-fixer continuation leaves `git diff --cached`, `git diff`, current `HEAD`, and untracked files unchanged except for edits made by later review-fixer attempts; the continuation builder itself performs no stage/commit/reset/stash side effects.
- [ ] When all review-fixer max-turn attempts are exhausted, no `plan:build:review:fix:complete` event is emitted for the terminal failed attempt, an `agent:warning` is emitted, and evaluator can still run against any final unstaged candidate changes.
- [ ] Existing builder and evaluator retry tests continue to pass.
- [ ] Client event schema tests accept `plan:build:review:fix:continuation` and review-fixer `agent:retry` payloads.