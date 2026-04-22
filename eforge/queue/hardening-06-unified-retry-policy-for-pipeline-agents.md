---
title: Hardening 06: unified retry policy for pipeline agents
created: 2026-04-22
---

# Hardening 06: unified retry policy for pipeline agents

## Problem / Motivation

Retry and continuation handling is ad-hoc, accumulated per incident:

- `packages/engine/src/pipeline.ts:927-943` — planner retry on `error_max_turns` (continuation).
- `packages/engine/src/agents/builder.ts:206` — builder re-throws `error_max_turns` to trigger a continuation at the pipeline level.
- `packages/engine/src/pipeline.ts:1474` — evaluator retry variant.
- The most recent commit on `main` ("enqueue(retry-planner-on-dropped-submission-tool-call)") added *another* retry branch specifically for a dropped submission tool call.

The error taxonomy (`AgentTerminalSubtype` in `packages/engine/src/backend.ts:192-196`) covers terminal reasons but has no concept of retryability. New agents added to the pipeline have no pattern to inherit — each gets its own bespoke retry branches or none.

## Goal

A single `RetryPolicy` type and a `withRetry(agent, policy)` wrapper that the pipeline uses for every agent invocation. Each agent has a registered policy. Adding a new agent means registering a policy, not writing new retry code.

## Approach

### 1. Define the retry policy type

In a new `packages/engine/src/retry.ts`:

```ts
export interface RetryPolicy {
  /** Max attempts including the first (so 1 = no retry). */
  maxAttempts: number;
  /** Which terminal subtypes trigger a retry vs bubble up. */
  retryableSubtypes: ReadonlySet<AgentTerminalSubtype>;
  /** Optional additional predicate (e.g. for dropped-submission detection). */
  shouldRetry?: (attempt: { subtype: AgentTerminalSubtype; events: EforgeEvent[] }) => boolean;
  /** How to construct the continuation input from the previous attempt. */
  buildContinuationInput?: (attempt: { events: EforgeEvent[]; prevInput: AgentInput }) => AgentInput;
  /** Telemetry label for the retry event. */
  label: string;
}
```

Model the continuation semantics accurately — some agents run a genuinely fresh invocation on retry, others pass the prior turn history as continuation context. Support both via `buildContinuationInput`.

### 2. `withRetry` wrapper

```ts
export async function* withRetry(
  runAgent: (input: AgentInput) => AsyncGenerator<EforgeEvent, AgentResult>,
  policy: RetryPolicy,
  initialInput: AgentInput
): AsyncGenerator<EforgeEvent, AgentResult> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const events: EforgeEvent[] = [];
    const gen = runAgent(attempt === 1 ? initialInput : policy.buildContinuationInput?.({ events: /* from last attempt */, prevInput: initialInput }) ?? initialInput);
    // ... iterate, collect events, yield them through, capture terminal subtype ...
    // If retryable: emit `agent:retry` event, loop. Otherwise return result.
  }
  // Exhausted retries: emit final terminal event and return the last result.
}
```

Add an `agent:retry` event to `packages/engine/src/events.ts` so consumers can render retry attempts distinctly.

### 3. Registry of per-agent policies

In `packages/engine/src/retry.ts` or a sibling file:

```ts
export const DEFAULT_RETRY_POLICIES: Record<AgentName, RetryPolicy> = {
  planner: {
    maxAttempts: 2,
    retryableSubtypes: new Set(['error_max_turns']),
    shouldRetry: (a) => a.events.some(isDroppedSubmission),
    buildContinuationInput: (a) => continueFromEvents(a.events, a.prevInput),
    label: 'planner-continuation',
  },
  builder: { /* continuation on error_max_turns */ },
  evaluator: { /* whatever the current variant is */ },
  // Other agents default to `{ maxAttempts: 1, retryableSubtypes: new Set() }`.
};
```

Centralize the `isDroppedSubmission` predicate and the continuation-input builder helpers so they're not scattered through pipeline.ts.

### 4. Migrate pipeline call sites

Replace each ad-hoc retry branch in `packages/engine/src/pipeline.ts`:

- planner (lines ~927-943)
- builder (lines around the `error_max_turns` re-throw handling)
- evaluator (line ~1474)
- any agent in the most-recent "retry planner on dropped submission" branch

Each becomes:

```ts
const result = yield* withRetry(
  (input) => runAgent(plannerConfig, input, ctx),
  DEFAULT_RETRY_POLICIES.planner,
  initialInput,
);
```

Delete the now-dead retry branches.

### Files touched

- `packages/engine/src/{retry,events,pipeline}.ts`
- `packages/engine/src/agents/{builder,planner,evaluator}.ts` (stop throwing for continuation — the policy owns continuation now; agents just return their terminal result)
- Tests: `test/retry.test.ts` (new), `test/agent-wiring.test.ts` (extend)

## Scope

**Metadata:**
- `scope: excursion`
- `depends_on: []`

**In scope:**

- New `packages/engine/src/retry.ts` defining `RetryPolicy` type, `withRetry` wrapper, `DEFAULT_RETRY_POLICIES` registry, and centralized `isDroppedSubmission` / continuation-input builder helpers.
- New `agent:retry` event in `packages/engine/src/events.ts`.
- Migration of every ad-hoc retry branch in `packages/engine/src/pipeline.ts` (planner ~927-943, builder `error_max_turns` re-throw handling, evaluator ~1474, the recent "retry planner on dropped submission" branch) to use `withRetry`.
- Updates to `packages/engine/src/agents/{builder,planner,evaluator}.ts` so they stop throwing for continuation — the policy owns continuation; agents just return their terminal result.
- Tests covering each registered policy's `shouldRetry` predicate, the retry-then-success path, and the retry-exhaustion path.

**Out of scope:**

- Retries for transient network or provider errors (those are a backend concern, not an agent policy).
- Exponential backoff — continuation is the mechanism; timing is not an issue here.
- Unifying the cleanup / PRD-validation retry logic (different shape; defer to a follow-up if needed).

## Acceptance Criteria

- A single `RetryPolicy` type and `withRetry(agent, policy)` wrapper exist; the pipeline uses them for every agent invocation, and adding a new agent means registering a policy rather than writing new retry code.
- `packages/engine/src/retry.ts` exists and exports `RetryPolicy`, `withRetry`, `DEFAULT_RETRY_POLICIES`, and the centralized `isDroppedSubmission` predicate and continuation-input builder helpers.
- `RetryPolicy` supports `maxAttempts` (including first attempt, so `1` = no retry), `retryableSubtypes`, optional `shouldRetry` predicate, optional `buildContinuationInput` (supporting both fresh re-invocation and prior-turn-history continuation), and a `label` for telemetry.
- `withRetry` iterates attempts up to `maxAttempts`, yields through events, captures the terminal subtype, emits an `agent:retry` event on retryable termination, and returns the last result after exhaustion.
- `agent:retry` event is defined in `packages/engine/src/events.ts` so consumers can render retry attempts distinctly.
- `DEFAULT_RETRY_POLICIES` registers policies for `planner` (maxAttempts 2, retry on `error_max_turns`, dropped-submission `shouldRetry`, `continueFromEvents` builder, label `planner-continuation`), `builder` (continuation on `error_max_turns`), `evaluator` (matching current variant), with other agents defaulting to `{ maxAttempts: 1, retryableSubtypes: new Set() }`.
- All prior ad-hoc retry branches in `packages/engine/src/pipeline.ts` (planner ~927-943, builder `error_max_turns` re-throw, evaluator ~1474, dropped-submission planner branch) are deleted and replaced with `withRetry` call sites.
- `packages/engine/src/agents/{builder,planner,evaluator}.ts` no longer throw for continuation; they return their terminal result and the policy owns continuation.
- Unit tests cover each registered policy's `shouldRetry` predicate with fixture events.
- Integration test using `StubBackend` (`test/stub-backend.ts`) scripts a first attempt terminating with `error_max_turns`, confirms `withRetry` runs a second attempt, confirms the `agent:retry` event fires, and confirms the final result matches the second attempt's output.
- Integration test for exhaustion scripts two consecutive `error_max_turns` terminations and confirms the wrapper returns the terminal result after `maxAttempts`.
- `pnpm test && pnpm build` pass.
- Manual verification: a build that intentionally exhausts `max_turns` on the builder (tight turn limit + large PRD) fires the continuation attempt, emits an `agent:retry` event in the stream, and completes successfully.
- `rg "error_max_turns" packages/engine/src` shows the subtype referenced only in `retry.ts` (policies) and `backend.ts` (type definition) — not scattered through pipeline.
