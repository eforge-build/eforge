---
title: Increase Review-Fixer Turn Budget and Add Continuation Handoff
created: 2026-05-25
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Increase Review-Fixer Turn Budget and Add Continuation Handoff

## Problem / Motivation

Evidence from the currently running build (`sessionId=1fdc3946-cda9-4634-85a6-fb03a89ae73b`, `runId=08a414a3-e843-4ae1-b5b8-0b0816e11485`) shows the builder exhausted `maxTurns=80` once, emitted `agent:retry` with `label=builder-continuation`, then completed on a continuation attempt.

In the same run, two `review-fixer` agents terminated with `Reached maximum number of turns (30)` and no `agent:retry` event. Their tool usage was almost entirely exploration (`Read`/`Grep`/`Glob`/`Bash`) and no `agent:activity` was emitted for review-fixer candidate changes.

The review-fixer stage can terminate before applying any reviewer fixes because it has a much smaller turn budget than the builder and no continuation handoff.

Observed impact:

- Builder exhausted `maxTurns=80`, emitted `agent:retry`, continued, and completed.
- Review-fixer exhausted `maxTurns=30` in both review-cycle rounds.
- No `agent:retry` was emitted for review-fixer.
- The review-fixer path still emitted `plan:build:review:fix:complete`, after which evaluator skipped because no candidate changes were present.

Affected users: anyone using `review-cycle` or standalone `review-fix`, especially with broad review issue lists where the fixer spends many turns reading/searching before editing.

Why it matters now: review-cycle can appear to run normally while dropping the chance to apply reviewer findings. This weakens the review/fix/evaluate quality gate and makes monitor output misleading because a max-turn stop is followed by `review:fix:complete` rather than a retry or explicit partial-fix signal.

Confirmed reproduction from monitor DB for current run `08a414a3-e843-4ae1-b5b8-0b0816e11485`:

1. Run a build whose pipeline includes `review-cycle` with enough review issues to require non-trivial review-fixer exploration.
2. Observe builder behavior when it hits max turns:
   - `agent:stop` error `Reached maximum number of turns (80)`.
   - `agent:retry` emitted with `agent: builder`, `label: builder-continuation`, `maxAttempts: 4`.
   - A second builder attempt starts and completes.
3. Observe review-fixer behavior in the same run:
   - First review-fixer starts at `2026-05-25T14:57:27.598Z` and stops at `2026-05-25T14:59:53.196Z` with `Reached maximum number of turns (30)`.
   - Second review-fixer starts at `2026-05-25T15:03:36.440Z` and stops at `2026-05-25T15:07:31.535Z` with `Reached maximum number of turns (30)`.
   - No `agent:retry` event exists for `review-fixer`.
   - Both attempts are followed by `plan:build:review:fix:complete`.

## Goal

Implementation-tier agents should receive a builder-sized default turn budget, so `review-fixer` receives 80 turns via eforge defaults unless explicitly overridden.

When `review-fixer` hits `error_max_turns`, it should emit retry activity and continue with a bounded handoff that preserves unstaged candidate changes and discovery context, without staging, committing, or falsely reporting success.

## Approach

Root cause: eforge's default implementation budget is encoded as a builder role exception instead of an implementation-tier default, combined with missing review-fixer retry integration.

Relevant code evidence:

- `packages/engine/src/pipeline/agent-config.ts` gives `builder` a built-in role `maxTurns: 80`, but the implementation tier itself has no default `maxTurns`.
- `review-fixer` and other implementation-tier roles without role defaults therefore fall back to global `agents.maxTurns` (`30` in current config/defaults).
- `packages/engine/src/agents/review-fixer.ts` calls the harness with `maxTurns: 30`, accepts SDK passthrough options, catches non-abort errors, and always emits `plan:build:review:fix:complete` after the catch path.
- `packages/engine/src/pipeline/stages/build-stages.ts` wraps builder/evaluator paths with `withRetry(...)`, but invokes `runReviewFixer(...)` directly inside `reviewFixStageInner`.
- `packages/engine/src/retry.ts` has builder continuation state (`BuilderContinuationInput`, `buildBuilderContinuationInput`, `DEFAULT_RETRY_POLICIES.builder`) and evaluator continuation state, but no review-fixer policy/input type.
- `packages/engine/src/prompts/review-fixer.md` already forbids staging/committing, so review-fixer continuation must preserve unstaged candidate changes for evaluator rather than checkpointing commits like builder continuation.

Confirmed causes:

1. **Budget mismatch in defaults**
   - `packages/engine/src/pipeline/agent-config.ts` defines `AGENT_ROLE_DEFAULTS.builder = { maxTurns: 80 }`.
   - `AGENT_ROLE_TIERS` places `builder`, `review-fixer`, and `validation-fixer` in the `implementation` tier, but `DEFAULT_TIER_RECIPES.implementation` has no `maxTurns` default.
   - `review-fixer` has no built-in role default, so `resolveAgentConfig('review-fixer', ...)` falls through to tier/global defaults. Current config and `DEFAULT_CONFIG.agents.maxTurns` are `30`.
   - `packages/engine/src/agents/review-fixer.ts` also has a hardcoded fallback `maxTurns: 30` before SDK passthrough fields are spread.
   - Desired defaulting model: eforge's built-in implementation tier should carry `maxTurns: 80`, so implementation-tier roles inherit the same budget unless plan/role config explicitly overrides it.

2. **No retry/continuation wrapper**
   - `reviewFixStageInner()` in `packages/engine/src/pipeline/stages/build-stages.ts` calls `runReviewFixer(...)` directly inside `withPeriodicFileCheck(...)`.
   - Builder and evaluator paths use `withRetry(...)` with role-specific continuation inputs and policies.
   - `packages/engine/src/retry.ts` has no `ReviewFixerContinuationInput`, continuation builder, or `DEFAULT_RETRY_POLICIES['review-fixer']` entry.

3. **Terminal error is suppressed as non-fatal**
   - `runReviewFixer()` catches all non-abort errors and does not rethrow or yield a `plan:build:failed` with `terminalSubtype`.
   - Because `error_max_turns` is swallowed there, an outer retry wrapper could not currently observe the terminal condition without changing this behavior.

Desired behavior:

- Implementation-tier agents receive a builder-sized tier default turn budget.
- Review-fixer receives 80 turns via eforge defaults.
- On `error_max_turns`, review-fixer hands off partial progress to a continuation attempt without staging or committing candidate changes.
- Continuation context cannot be only a working-tree diff because observed review-fixer failures happened after mostly read/search/tool exploration, not after edits.
- Handoff should include bounded discovery context:
  - files inspected,
  - searches/commands run,
  - useful findings,
  - unresolved issues,
  - recent relevant agent messages,
  - any candidate diff if one exists.
- If working-tree candidate changes exist, include a bounded diff or file summary so the next attempt does not redo already-applied fixes.
- If no working-tree candidate changes exist, still retry with discovery handoff and remaining issue context rather than treating no diff as no progress.
- Evaluator remains responsible for accepting/rejecting final unstaged candidate changes.

Important design constraints:

- Builder continuation can checkpoint by staging/committing work.
- Review-fixer must not checkpoint by staging or committing:
  - `packages/engine/src/prompts/review-fixer.md` forbids `git add` and `git commit`.
  - Review-fixer changes are intentionally left unstaged and uncommitted so evaluator can accept/reject candidate diffs.
- Review-fixer continuation must not depend on a git diff existing.
- Review-fixer handoff should combine deterministic attempt context and candidate changes.
- `error_max_turns` should be selectively surfaced/rethrown/classified for retry while preserving non-fatal handling for other review-fixer errors.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| The eforge default should put `maxTurns: 80` on the built-in implementation tier rather than only on the builder role. | User clarified this should be an eforge default, not user config. Code inspection shows `builder`, `review-fixer`, and `validation-fixer` are implementation-tier roles; observed failure involved review-fixer stopping at 30 while builder used 80 and continued successfully. | high | low | Add config-resolution tests for review-fixer and validation-fixer using default config/profile resolution; inspect resulting agent debug payload in a build. | If wrong, all implementation-tier agents without role overrides could consume more model time than desired by default. |
| Review-fixer handoff should not commit or stage partial work. | `packages/engine/src/prompts/review-fixer.md` forbids `git add` and `git commit`; evaluator design expects unstaged candidate changes from review-fixer. | high | low | Test git status before/after continuation and assert no staged changes/commits are created. | If wrong, evaluator boundary is bypassed and bad review-fixer changes may be committed. |
| Review-fixer continuation needs discovery handoff, not just working-tree diff. | User pointed out the observed failures spent all turns reading/searching and produced no candidate diff. Monitor DB tool counts confirm mostly `Read`/`Grep`/`Glob`/`Bash` activity with no review-fixer `agent:activity`. | high | low | Build continuation input from attempt events: summarize files read, grep/glob patterns, shell commands, recent relevant agent messages, plus diff summary when present. Add tests for no-diff max-turn continuation. | If wrong, retry after a no-diff exploration attempt would start cold and may burn turns repeating discovery. |
| `error_max_turns` can be safely surfaced for review-fixer without making all fixer failures fatal. | `withRetry()` already handles `AgentTerminalError`/terminal subtype retry; review-fixer currently swallows all non-abort errors. Max-turns can be selectively rethrown or emitted while preserving non-fatal handling for other errors. | medium/high | low | Unit-test max-turn path separately from generic error path. | If wrong, review-fixer could start failing builds on non-critical errors that are currently intentionally non-fatal. |
| A new domain continuation event for review-fixer is preferable to reusing builder's `plan:build:implement:continuation`. | Existing event schema has builder/evaluator continuation events but no review-fixer-specific event found by search. Reusing implement continuation would be semantically misleading. | medium | medium | Inspect client schema/UI rendering and add schema fixture if adding a new event. | If wrong, adding a wire event may create avoidable schema/client churn; using only generic `agent:retry` may be sufficient. |
| No consumer-facing Pi/Claude plugin changes are required. | Change appears engine-internal: config resolution, retry policy, prompt. Existing `agent:retry` is already a wire event. | medium | low | Search integrations after deciding whether to add a new event; update both packages only if user-facing command/behavior docs change. | If wrong, monitor/plugin UI could miss or misrender the new continuation path. |

Recommended profile: **Excursion**.

Rationale: this is a cohesive engine bugfix spanning agent config, review-fixer runner behavior, retry policy, prompt context, and focused tests. A single planner can enumerate the work and dependencies. Expedition is not warranted because it does not require delegated module planning or independent subsystem plans. Errand is too small because the fix crosses retry semantics and evaluator-boundary safety.

## Scope

In scope:

- Add `maxTurns: 80` to eforge's built-in `implementation` tier default.
- Ensure implementation-tier roles such as `builder`, `review-fixer`, and `validation-fixer` inherit the 80-turn default unless explicitly overridden by plan, role, or project/profile tier config.
- Remove or change the hardcoded review-fixer fallback that forces `maxTurns: 30` when config resolution provides a different budget.
- Add retry/continuation integration for `review-fixer`.
- Add review-fixer continuation input/policy support in `packages/engine/src/retry.ts`.
- Wrap `runReviewFixer(...)` with `withRetry(...)` in the review-fix stage path.
- Classify/surface review-fixer `error_max_turns` so retry can observe it.
- Preserve unstaged/uncommitted candidate changes across review-fixer continuation attempts.
- Build bounded continuation handoff context from attempt events and candidate changes when present.
- Add tests for config resolution, max-turn propagation/classification, retry emission, continuation handoff, and no staging/committing behavior.
- Run focused retry/review-fixer tests and `pnpm type-check`.
- Roadmap alignment: Integration & Maturity work that hardens build lifecycle behavior and retry/continuation resilience.

Out of scope:

- Deferred queue reordering.
- Overseer.
- Extension policy gates.
- Stacked-provider.
- TypeScript project-reference roadmap items.
- Staging, committing, resetting, or otherwise checkpointing review-fixer candidate changes.
- Consumer-facing Pi/Claude plugin changes, unless adding a new wire event or changing user-facing command/behavior docs requires updating integrations.

## Acceptance Criteria

- Eforge's built-in `implementation` tier has `maxTurns: 80`, so implementation-tier roles such as `builder`, `review-fixer`, and `validation-fixer` inherit an 80-turn default unless explicitly overridden by plan, role, or project/profile tier config.
- The hardcoded review-fixer fallback no longer forces 30 turns when config resolution provides a different budget.
- A review-fixer max-turn termination is classified as retryable and emits `agent:retry` with `agent: review-fixer` instead of being silently swallowed.
- Review-fixer continuation preserves existing unstaged/uncommitted candidate changes for evaluator; it does not run `git add`, does not commit, and does not reset candidate diffs.
- Continuation prompt context tells the next review-fixer attempt what was already discovered and attempted, even when no files were changed. At minimum it includes bounded attempt context such as files read, searches/globs/commands run, recent relevant agent messages, and unresolved review issues.
- If working-tree candidate changes exist, continuation context also includes a bounded diff or file summary so the next attempt does not redo already-applied fixes.
- If there are no working-tree candidate changes at max-turn handoff, the engine still retries with the discovery handoff and remaining issue context rather than treating no diff as no progress. It must not falsely present a successful fix as complete.
- Evaluator still receives the final unstaged candidate changes after all review-fixer attempts and remains responsible for accepting/rejecting them.
- Tests cover:
  - `resolveAgentConfig('review-fixer', ...)` default max turns equals 80 via the built-in implementation tier.
  - `resolveAgentConfig('validation-fixer', ...)` also inherits 80 via the built-in implementation tier unless overridden.
  - `runReviewFixer()` propagates/classifies max-turn errors in a way `withRetry()` can observe.
  - Review-fixer retry emits `agent:retry` and a review-fix continuation event or equivalent domain-specific event.
  - Review-fixer continuation does not stage or commit changes.
  - Existing builder/evaluator retry tests continue to pass.
- Targeted validation passes:
  - Focused retry/review-fixer tests.
  - `pnpm type-check`.
