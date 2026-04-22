---
id: plan-01-unified-retry-policy
name: Unified retry policy for pipeline agents
depends_on: []
branch: hardening-06-unified-retry-policy-for-pipeline-agents/unified-retry-policy
agents:
  builder:
    effort: xhigh
    rationale: Cross-cutting refactor touching pipeline.ts, three agent files,
      events, and tests; preserving existing semantics (checkpointing,
      dropped-submission vs max_turns branching, evaluator unstaged-changes
      short-circuit) while deleting three separate retry loops requires careful
      coordination.
  reviewer:
    effort: high
    rationale: Refactor must preserve behavior exactly — reviewer needs to verify no
      retry branch, event, or checkpoint was lost in the migration.
---

# Unified Retry Policy for Pipeline Agents

## Architecture Context

Retry/continuation handling in `packages/engine/src/pipeline.ts` is currently ad-hoc — each agent (planner, builder, evaluator) has its own inline retry loop grown incrementally as incidents accumulated:

- **Planner retry loop**: `pipeline.ts` ~lines 820-973. Handles both `error_max_turns` (via `isMaxTurnsError`) and dropped-submission (via `PlannerSubmissionError` / `isPlannerSubmissionError`). Builds reason-dependent continuation context (scans plan dir for max_turns, skips scan for dropped_submission), checkpoints plan artifacts via `commitPlanArtifacts`, yields `plan:continuation` event.
- **Evaluator retry loop**: `pipeline.ts` ~lines 1619-1682. Handles `error_max_turns` only, short-circuits to success if no unstaged changes remain, yields `build:evaluate:continuation` event.
- **Builder continuation**: `builderEvaluate` in `packages/engine/src/agents/builder.ts` lines 206-209 re-throws `error_max_turns` so the pipeline-level retry catches it. `builderImplement` has its own continuation handling as well (build:implement:continuation event).

The `AgentTerminalSubtype` union (`packages/engine/src/backend.ts:192-196`) covers terminal reasons but has no notion of retryability — each new agent gets a bespoke branch or none. The most recent commit (`enqueue(retry-planner-on-dropped-submission-tool-call)`) added yet another branch for dropped-submission, confirming the pattern is scaling poorly.

Per-agent max continuations defaults already exist as `AGENT_MAX_CONTINUATIONS_DEFAULTS` in `pipeline.ts` (~lines 433-440): `planner: 2, evaluator: 1, plan-evaluator: 1, cohesion-evaluator: 1, architecture-evaluator: 1`. Preserve these exact numbers in the new registry.

## Implementation

### Overview

Introduce a single `RetryPolicy` type and `withRetry` async-generator wrapper in `packages/engine/src/retry.ts`. Register per-agent policies in `DEFAULT_RETRY_POLICIES`. Migrate every ad-hoc retry branch in `pipeline.ts` to call `withRetry(runAgent, policy, initialInput)`. Add an `agent:retry` event to `packages/engine/src/events.ts` for consumer rendering. Stop re-throwing `error_max_turns` from `builderEvaluate` — the policy owns continuation now.

### Key Decisions

1. **Generic continuation-input model**: The wrapper is parameterized over an `AgentInput` type. `buildContinuationInput` receives `{ events, prevInput, attempt, maxAttempts, subtype }` and returns the next `AgentInput`. This supports both fresh re-invocation (planner: returns a new input with `continuationContext`) and unstaged-changes-preserving continuation (evaluator). Existing continuation context shapes (`continuationContext: { attempt, maxContinuations, existingPlans, reason }` for planner; `evaluatorContinuationContext: { attempt, maxContinuations }` for evaluator; `continuationContext: { attempt, maxContinuations, completedDiff }` for builder) are constructed inside each policy's `buildContinuationInput`.

2. **Side-effectful continuation pre-steps move into the builder**: `commitPlanArtifacts` for the planner and `hasUnstagedChanges` check for the evaluator are performed inside the `buildContinuationInput` of the respective policy (which can be async — the signature must allow a Promise return). The evaluator's short-circuit-on-clean-worktree becomes a distinct outcome: if there are no unstaged changes, the policy signals "stop retrying and return success" via a sentinel (e.g., `buildContinuationInput` returns `{ abort: true }`).

3. **Stop throwing for continuation**: `builderEvaluate` currently re-throws `error_max_turns` to the pipeline. With the policy model, agents wrap their backend call in a try/catch that converts `AgentTerminalError` into a normal generator termination carrying the subtype as part of the `AgentResult`. `withRetry` inspects `AgentResult.terminalSubtype` (or catches the thrown `AgentTerminalError` at the boundary) rather than the agent re-throwing.

4. **Centralize predicates and builders**: Move `isDroppedSubmission` (check if any event in the attempt indicates `PlannerSubmissionError`-style dropped submission) and `continueFromEvents` (plan-dir scan + checkpoint for planner; diff builder for builder; unstaged-changes check for evaluator) into `retry.ts` so they are not scattered across `pipeline.ts`.

5. **Preserve telemetry events**: The new `agent:retry` event is emitted in addition to the existing domain events (`plan:continuation`, `build:implement:continuation`, `build:evaluate:continuation`). Keep the existing events for now — consumers (monitor UI, CLI renderer) still rely on them. `withRetry` emits both: the generic `agent:retry` and the agent-specific continuation event via a policy-provided hook, so we don't break the monitor UI. Alternative considered: replace domain events with `agent:retry` only. Rejected because it would cascade into monitor UI / renderer changes outside this plan's scope.

6. **Agents covered by the registry**: Policies for `planner`, `builder`, `evaluator`, `plan-evaluator`, `cohesion-evaluator`, `architecture-evaluator` (all agents currently in `AGENT_MAX_CONTINUATIONS_DEFAULTS`). All other `AgentRole` values get `{ maxAttempts: 1, retryableSubtypes: new Set() }`.

### Retry type sketch

```ts
// packages/engine/src/retry.ts
import type { AgentTerminalSubtype } from './backend.js';
import type { EforgeEvent, AgentRole } from './events.js';

export interface RetryAttemptInfo<Input> {
  attempt: number;           // 1-indexed attempt that just failed
  maxAttempts: number;
  subtype: AgentTerminalSubtype;
  events: EforgeEvent[];     // events collected during this attempt
  prevInput: Input;
}

export type ContinuationDecision<Input> =
  | { kind: 'retry'; input: Input }
  | { kind: 'abort-success' };   // evaluator clean-worktree case

export interface RetryPolicy<Input> {
  maxAttempts: number;
  retryableSubtypes: ReadonlySet<AgentTerminalSubtype>;
  shouldRetry?: (info: RetryAttemptInfo<Input>) => boolean;
  buildContinuationInput?: (info: RetryAttemptInfo<Input>) => Promise<ContinuationDecision<Input>> | ContinuationDecision<Input>;
  /** Emit agent-specific continuation event before the next attempt starts. */
  onRetry?: (info: RetryAttemptInfo<Input>) => EforgeEvent[];
  label: string;
}

export async function* withRetry<Input, Result>(
  runAgent: (input: Input) => AsyncGenerator<EforgeEvent, Result>,
  policy: RetryPolicy<Input>,
  initialInput: Input,
): AsyncGenerator<EforgeEvent, Result> { /* ... */ }
```

## Scope

### In Scope

- New `packages/engine/src/retry.ts` defining `RetryPolicy`, `withRetry`, `DEFAULT_RETRY_POLICIES`, and centralized `isDroppedSubmission` predicate plus continuation-input builders (planner, builder, evaluator).
- New `agent:retry` event type in `packages/engine/src/events.ts` (fields: `agent: AgentRole`, `attempt`, `maxAttempts`, `subtype`, `label`, `planId?`).
- Replace the planner retry loop in `pipeline.ts` (~820-973) with a `withRetry(runPlanner, DEFAULT_RETRY_POLICIES.planner, initialInput)` call; delete the inline max_turns/dropped-submission branching, inline `lastRetryReason` tracking, inline plan-dir scan, and inline `commitPlanArtifacts` invocation. The policy's `buildContinuationInput` owns these.
- Replace the evaluator retry loop in `pipeline.ts` (~1619-1682) with `withRetry(builderEvaluate, DEFAULT_RETRY_POLICIES.evaluator, initialInput)`; the policy's `buildContinuationInput` performs the `hasUnstagedChanges` check and returns `{ kind: 'abort-success' }` when clean.
- Replace the builder implement continuation loop in `pipeline.ts` (find and migrate the `build:implement:continuation` path) with `withRetry(builderImplement, DEFAULT_RETRY_POLICIES.builder, initialInput)`.
- Update `packages/engine/src/agents/builder.ts` so `builderEvaluate` no longer re-throws `error_max_turns` (lines 206-209) — instead it yields a `build:failed`-equivalent terminal marker or returns a result object carrying the subtype. `withRetry` treats the subtype as retryable per policy.
- Update `packages/engine/src/agents/planner.ts` so `PlannerSubmissionError` is surfaced as a retryable terminal outcome (either via a synthetic `AgentTerminalError` with a new subtype like `error_dropped_submission`, OR via an event the `shouldRetry` predicate can detect). Preferred: introduce `isDroppedSubmission(events)` that inspects emitted events, keeping `PlannerSubmissionError` as the thrown sentinel but caught at the `withRetry` boundary. The agent no longer needs pipeline-level special handling.
- New `test/retry.test.ts`:
  - Unit tests for each registered policy's `shouldRetry` predicate using fixture events (max_turns subtype retryable for planner/builder/evaluator; dropped-submission detected only for planner; non-retryable subtypes bubble up).
  - Integration test using `StubBackend` (`test/stub-backend.ts`) scripting a first attempt terminating with `error_max_turns`, confirming `withRetry` starts a second attempt, confirming `agent:retry` event fires, and confirming the final result matches the second attempt's output.
  - Exhaustion test: two consecutive `error_max_turns` terminations; wrapper returns the terminal result from the final attempt without further retry.
  - Evaluator clean-worktree abort-success test: first attempt terminates with `error_max_turns` but worktree is clean; wrapper returns success without running a second attempt.
- Extend `test/agent-wiring.test.ts` to confirm each pipeline agent call site goes through `withRetry` (e.g., by asserting the policy registry is used, or by scripting a failure and observing retry behavior end-to-end).
- Preserve emission of existing domain events (`plan:continuation`, `build:implement:continuation`, `build:evaluate:continuation`) via the policy's `onRetry` hook so monitor UI and CLI renderer keep working.

### Out of Scope

- Retries for transient network or provider errors (backend concern, not agent policy).
- Exponential backoff / timing control — continuation is the mechanism, timing is not an issue here.
- Unifying cleanup / PRD-validation retry logic (different shape; deferred).
- Monitor UI or CLI renderer changes to display `agent:retry` distinctly from the existing domain continuation events.
- Changes to `AGENT_MAX_CONTINUATIONS_DEFAULTS` numeric values — preserve existing (`planner: 2, evaluator: 1`, etc.).

## Files

### Create

- `packages/engine/src/retry.ts` — `RetryPolicy` type, `withRetry` async-generator wrapper, `DEFAULT_RETRY_POLICIES` registry keyed by `AgentRole`, `isDroppedSubmission` predicate, and continuation-input builder helpers (`buildPlannerContinuationInput`, `buildBuilderContinuationInput`, `buildEvaluatorContinuationInput`).
- `test/retry.test.ts` — unit tests for each policy's `shouldRetry` predicate; integration tests for retry-then-success, retry exhaustion, and evaluator abort-success-on-clean-worktree paths using `StubBackend`.

### Modify

- `packages/engine/src/events.ts` — add `agent:retry` variant to the `EforgeEvent` discriminated union with fields `agent: AgentRole`, `attempt: number`, `maxAttempts: number`, `subtype: AgentTerminalSubtype`, `label: string`, `planId?: string`.
- `packages/engine/src/pipeline.ts` — delete the inline planner retry loop (~820-973), evaluator retry loop (~1619-1682), and builder implement continuation loop. Replace each with a `withRetry(runAgent, DEFAULT_RETRY_POLICIES.<agent>, initialInput)` call site. Preserve the existing domain continuation event emissions by wiring them through each policy's `onRetry` hook. `AGENT_MAX_CONTINUATIONS_DEFAULTS` (~lines 433-440) is retained only if still referenced elsewhere; otherwise removed and the numbers moved into `DEFAULT_RETRY_POLICIES`.
- `packages/engine/src/agents/builder.ts` — `builderEvaluate` (lines 206-209) no longer re-throws `error_max_turns`. It either yields a terminal event with the subtype and returns normally, or allows the `AgentTerminalError` to propagate to `withRetry` at the boundary (decision recorded during implementation). Similar treatment for `builderImplement` continuation path.
- `packages/engine/src/agents/planner.ts` — `PlannerSubmissionError` handling migrated: the policy's `shouldRetry`/`isDroppedSubmission` detects the condition via either emitted events or the caught error. Agent code no longer needs to coordinate with pipeline-level retry state.
- `test/agent-wiring.test.ts` — add assertions that each pipeline agent invocation is wrapped in `withRetry` with the expected policy (e.g., by inspecting the policy registry or by scripting a failure and observing retry behavior).
- `test/evaluator-continuation.test.ts` and `test/planner-submission.test.ts` — update to reflect that continuation is now owned by the policy; rewrite assertions about re-thrown errors to assert retry-wrapper behavior and `agent:retry` event emission. Preserve coverage of dropped-submission detection and evaluator clean-worktree short-circuit.

## Verification

- [ ] `packages/engine/src/retry.ts` exists and exports `RetryPolicy`, `withRetry`, `DEFAULT_RETRY_POLICIES`, `isDroppedSubmission`, and the three continuation-input builder helpers (`buildPlannerContinuationInput`, `buildBuilderContinuationInput`, `buildEvaluatorContinuationInput`).
- [ ] `RetryPolicy` type has fields `maxAttempts: number`, `retryableSubtypes: ReadonlySet<AgentTerminalSubtype>`, optional `shouldRetry`, optional `buildContinuationInput` (sync or async, returning either `{ kind: 'retry'; input }` or `{ kind: 'abort-success' }`), optional `onRetry` returning events, and `label: string`.
- [ ] `withRetry` iterates up to `maxAttempts` attempts, yields every event from each attempt through to the caller, captures the terminal subtype of each attempt, emits the `agent:retry` event plus policy-provided `onRetry` events on retryable termination, and returns the last attempt's result after exhaustion.
- [ ] `agent:retry` event is a member of the `EforgeEvent` discriminated union in `packages/engine/src/events.ts` with fields `agent: AgentRole`, `attempt: number`, `maxAttempts: number`, `subtype: AgentTerminalSubtype`, `label: string`, optional `planId: string`.
- [ ] `DEFAULT_RETRY_POLICIES.planner` has `maxAttempts: 2`, `retryableSubtypes` including `error_max_turns`, a `shouldRetry` that returns true when `isDroppedSubmission(events)` matches, a `buildContinuationInput` that (a) checkpoints plan artifacts via `commitPlanArtifacts` and (b) scans the plan directory and injects `continuationContext: { attempt, maxContinuations, existingPlans, reason }` into the input, and `label: 'planner-continuation'`.
- [ ] `DEFAULT_RETRY_POLICIES.builder` has `maxAttempts` matching the prior builder default, `retryableSubtypes` including `error_max_turns`, and `buildContinuationInput` that builds the completed diff via the existing `buildContinuationDiff` helper and injects `continuationContext: { attempt, maxContinuations, completedDiff }` into the input.
- [ ] `DEFAULT_RETRY_POLICIES.evaluator` has `maxAttempts: 2` (equivalent to previous `maxContinuations: 1`), `retryableSubtypes` including `error_max_turns`, and a `buildContinuationInput` that returns `{ kind: 'abort-success' }` when `hasUnstagedChanges(worktreePath)` returns false and otherwise returns `{ kind: 'retry', input }` with `evaluatorContinuationContext` injected.
- [ ] All `AgentRole` values not explicitly registered default to `{ maxAttempts: 1, retryableSubtypes: new Set() }` (resolved via a `getPolicy(role)` helper or an object with all roles filled in).
- [ ] `pipeline.ts` contains no inline retry loops — the planner retry block (~820-973), evaluator retry block (~1619-1682), and builder implement continuation block are replaced with single `withRetry(...)` call sites.
- [ ] `builderEvaluate` in `packages/engine/src/agents/builder.ts` no longer contains the `if (isMaxTurnsError(err)) throw err;` re-throw at lines 206-209.
- [ ] `rg "error_max_turns" packages/engine/src` returns matches only in `retry.ts` (policies + helpers) and `backend.ts` (type definition) — not in `pipeline.ts` or the agent files.
- [ ] `rg "isMaxTurnsError\b" packages/engine/src` returns matches only in `retry.ts` and `backend.ts` (where it is exported).
- [ ] Unit tests in `test/retry.test.ts` cover `shouldRetry` for each registered policy: planner returns true for `error_max_turns` and true for dropped-submission fixture events, false for unrelated subtypes; builder returns true only for `error_max_turns`; evaluator returns true only for `error_max_turns`; unregistered roles return false for everything.
- [ ] Integration test in `test/retry.test.ts` using `StubBackend` scripts a first attempt that throws `AgentTerminalError('error_max_turns', ...)`, a second attempt that returns a successful result, and asserts: (a) `withRetry` yields all first-attempt events, (b) an `agent:retry` event with `attempt: 1, maxAttempts: 2, subtype: 'error_max_turns'` is emitted, (c) all second-attempt events are yielded, (d) the returned `AgentResult` matches the second attempt's output exactly.
- [ ] Exhaustion integration test in `test/retry.test.ts` scripts two consecutive `error_max_turns` terminations and asserts the wrapper returns the terminal result after `maxAttempts` attempts without starting a third.
- [ ] Evaluator abort-success test in `test/retry.test.ts` scripts a first attempt throwing `error_max_turns` while the worktree is clean (stub `hasUnstagedChanges` returns false) and asserts the wrapper returns the first-attempt result without a second attempt.
- [ ] `test/agent-wiring.test.ts` includes a test that pipeline agent invocations are wrapped by `withRetry` with `DEFAULT_RETRY_POLICIES[<role>]` — e.g., by scripting a backend failure and asserting the retry event fires at the pipeline level.
- [ ] `pnpm type-check` exits zero.
- [ ] `pnpm test` exits zero.
- [ ] `pnpm build` exits zero.
