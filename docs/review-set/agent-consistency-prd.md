# Agent Runner Consistency

Addresses three related code smells identified in the architecture review: inconsistent error handling across agents, repeated boilerplate in every agent runner, and the planner-specific clarification loop. These are tightly coupled - fixing one without the others leaves half the inconsistency in place.

## 1. Unified Error Handling

### Problem

Three different error patterns exist across 11 agent runners:
- **Builder** (`builder.ts`): yields `build:failed` event, returns gracefully (no throw)
- **Plan evaluator** (`plan-evaluator.ts`): yields zero-count completion event, then re-throws
- **Validation fixer** (`validation-fixer.ts`): swallows non-abort errors, doesn't yield completion event

Pipeline stages can't predict whether an agent failure will surface as an event, an exception, or silence. This forces defensive try/catch in every stage and makes the monitor's view of failures incomplete (silent swallowing means no event to record).

### Design

Standardize on the builder's pattern: yield a typed failure/completion event, return cleanly. Reserve thrown exceptions for two cases only:
- `AbortError` (user cancellation) - always re-throw
- Backend crash (SDK subprocess died) - always re-throw

Every other failure becomes an event. Agents that currently throw after yielding should stop throwing. Agents that swallow errors should yield a completion event with error context before returning.

### Implementation

For each agent runner:
1. Wrap the `backend.run()` loop in try/catch
2. On non-abort error: yield the agent's completion event (with zero counts or empty results as appropriate), then return
3. On abort error: re-throw
4. Remove any existing re-throws after completion events

Affected agents: `plan-evaluator.ts`, `validation-fixer.ts`, `cohesion-evaluator.ts`, `review-fixer.ts`. The builder, planner, and reviewer already follow the correct pattern or are close to it.

## 2. `collectAgentOutput` Helper

### Problem

Every agent runner repeats the same ~8-line pattern:

```typescript
let fullText = '';
for await (const event of backend.run(...)) {
  if (isAlwaysYieldedAgentEvent(event) || verbose) yield event;
  if (event.type === 'agent:message' && event.content) fullText += event.content;
}
```

This appears 8+ times with subtle inconsistencies - some agents check `options.verbose`, others check bare `verbose`. The verbose-filtering logic and text accumulation are identical in every case.

### Design

Extract a helper in `src/engine/agents/common.ts`:

```typescript
async function* collectAgentOutput(
  backend: AgentBackend,
  runOptions: AgentRunOptions,
  agent: AgentRole,
  opts: { verbose?: boolean; planId?: string }
): AsyncGenerator<EforgeEvent, string> {
  let fullText = '';
  for await (const event of backend.run(runOptions, agent, opts.planId)) {
    if (isAlwaysYieldedAgentEvent(event) || opts.verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
  }
  return fullText;
}
```

The return value of the generator is the accumulated text. Callers use it like:

```typescript
const gen = collectAgentOutput(backend, runOpts, 'reviewer', { verbose });
let result = await gen.next();
while (!result.done) {
  yield result.value;  // forward events
  result = await gen.next();
}
const fullText = result.value;  // accumulated text
// parse fullText for structured output
```

Or wrap the forwarding in a small utility if the yield-forwarding is still too noisy.

### Implementation

1. Add `collectAgentOutput` to `src/engine/agents/common.ts`
2. Refactor each agent runner to use it instead of the inline loop
3. Verify verbose filtering is consistent everywhere (should use `opts.verbose`, not destructured locals)

## 3. Reusable Clarification Middleware

### Problem

The multi-turn clarification loop is ~90 lines embedded in the planner agent runner (`planner.ts`). It handles: parsing clarification XML from output, invoking the `onClarification` callback, formatting prior answers into the next prompt, restarting the agent, and enforcing a max-iteration limit.

No other agent can ask clarifying questions without reimplementing this. Module-planner and builder are candidates for clarification support but can't use it today.

### Design

Extract clarification handling into a wrapper function that any agent can opt into:

```typescript
async function* withClarification(
  runAgent: (prompt: string) => AsyncGenerator<EforgeEvent>,
  opts: {
    onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
    maxIterations?: number;  // default 5
  }
): AsyncGenerator<EforgeEvent, string>
```

The wrapper:
1. Calls `runAgent(prompt)` and collects output (via `collectAgentOutput` or equivalent)
2. Parses clarification blocks from the accumulated text
3. If clarifications found and `onClarification` callback exists: yields `plan:clarification` event, calls callback, formats answers into next prompt, restarts
4. If no clarifications or no callback: returns accumulated text
5. Enforces max iteration limit

The planner becomes a thin wrapper around `withClarification` + XML parsing for scope/profile/modules. Other agents that want clarification support just wrap their `backend.run()` call.

### Implementation

1. Add `withClarification` to `src/engine/agents/common.ts` (or a new `clarification.ts` if it gets large)
2. Refactor `planner.ts` to use `withClarification` - the planner-specific logic (scope parsing, profile parsing, module parsing) stays in the planner; only the clarification loop moves out
3. Add tests for the clarification wrapper using StubBackend (can largely reuse existing clarification tests from `agent-wiring.test.ts`)

## 4. PipelineContext Data Flow Documentation

### Problem

`PipelineContext` has mutable fields that stages read and write as side effects. The planner stage mutates `ctx.profile`, downstream stages see the change implicitly. `BuildStageContext` adds `reviewIssues` and `buildFailed`. There's no documentation of which stages write which fields.

### Implementation

Add a data-flow comment block at the top of the stage registry section in `pipeline.ts`:

```typescript
// Stage data flow:
// Compile stages:
//   planner        → writes: plans, scopeAssessment, profile (via profile selection)
//   plan-review    → reads: plans (reviews plan files on disk)
//   module-planning → reads: plans, expeditionModules; writes: plans (module plans)
//   cohesion-review → reads: plans
//   compile-expedition → reads: expeditionModules; writes: plans
//
// Build stages:
//   implement → reads: planFile; writes: buildFailed (on error)
//   review    → reads: planFile; writes: reviewIssues
//   review-fix → reads: reviewIssues
//   evaluate  → reads: (unstaged changes)
```

Also: make `buildFailed` a return convention rather than a context mutation - the pipeline runner checks whether the implement stage yielded a `build:failed` event instead of reading a mutable flag.

## Verification

- `pnpm test` passes (existing agent-wiring tests cover the key scenarios)
- `pnpm type-check` passes
- Run `eforge run` on a small PRD and verify events stream correctly (no missing completion events, no thrown exceptions surfacing to CLI)
- Verify verbose/non-verbose modes produce the expected event filtering
- Verify clarification flow still works in planner (existing test coverage + manual run)
