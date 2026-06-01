---
id: plan-01-evaluator-late-error-preservation
name: Evaluator Late Error Verdict Preservation
branch: downgrade-evaluator-late-transport-errors-after-verdict-submission/plan-01-evaluator-late-error-preservation
agents:
  builder:
    effort: high
    rationale: The change is small but touches core evaluator fail-closed semantics
      and oversized legacy test files with no-growth ceilings, so targeted edits
      and careful regression coverage are required.
  reviewer:
    effort: high
    rationale: Review needs to verify the downgrade only applies after valid
      evaluator verdict evidence and does not broaden retry policy behavior.
---

# Evaluator Late Error Verdict Preservation

## Architecture Context

`builderEvaluate` is the build-stage evaluator entry point. It gathers evaluator evidence from two channels: structured `submit_evaluation_verdicts` tool submissions stored in `structuredSubmission`, and XML fallback text accumulated in `fullText` from `agent:message` and `agent:result.resultText`. Downstream, `runEvaluatorAttempt` and `withRetry` treat a yielded `plan:build:failed` with a terminal subtype as retryable according to `DEFAULT_RETRY_POLICIES.evaluator`; `build-stages.ts` then fails the plan when the final evaluator result is missing, marked failed, or has zero verdicts.

The bug is local to `builderEvaluate`: a late retryable transport or Pi infrastructure error thrown after verdict evidence is already available currently yields `plan:build:failed` and returns `{ failed: true, verdicts: [] }`. The fix belongs in evaluator result preservation, not in the general retry policy.

Project maintainability constraints matter for this plan: `test/agent-wiring.test.ts` and `test/retry.test.ts` are legacy oversized files with no-growth ceilings in `scripts/agent-maintainability-baseline.json`. Keep edits bounded and keep their final line counts at or below the recorded ceilings by adapting existing nearby tests and compacting comments rather than appending large new blocks.

## Implementation

### Overview

Teach `builderEvaluate` to return already-available evaluator verdicts when the harness throws a late `error_transient_transport` or `error_pi_tool_infrastructure` after verdict submission or parseable XML evidence. Emit an `agent:warning` for the downgrade. Preserve all existing fail-closed behavior for pre-verdict failures, empty/unparseable content, and non-retryable terminal subtypes.

### Key Decisions

1. Preserve verdicts inside `builderEvaluate` before emitting `plan:build:failed`. This prevents `withRetry` from observing a terminal failed event and starting an unnecessary evaluator continuation.
2. Prefer structured submissions over XML fallback in the late-error path using the same precedence as the success path: if `structuredSubmission` exists, use it only when it contains at least one verdict; do not parse XML as a replacement for an empty structured submission.
3. Handle only `error_transient_transport` and `error_pi_tool_infrastructure` as downgrade candidates. All other classified terminal subtypes continue down the existing failure path.
4. Keep the warning schema unchanged by emitting the existing `agent:warning` event shape with a stable code such as `evaluator-late-infrastructure-error-downgraded`.

## Scope

### In Scope

- Add a small local helper in `packages/engine/src/agents/builder.ts` that builds a completed `BuilderEvaluationResult` from either non-empty `structuredSubmission.verdicts` or non-empty `parseEvaluationBlock(fullText)` verdicts.
- Add a local predicate for retryable late evaluator infrastructure subtypes: `error_transient_transport` and `error_pi_tool_infrastructure`.
- In the `builderEvaluate` catch block, return the completed result and emit `agent:warning` when the caught subtype is one of those retryable infrastructure subtypes and the helper finds at least one verdict.
- Preserve the current `plan:build:failed` emission and failed empty result when no verdict evidence exists or the subtype is not a retryable infrastructure subtype.
- Add or adapt direct `builderEvaluate` regression coverage in `test/agent-wiring.test.ts` using an `evaluatorSnapshot` and a `submit_evaluation_verdicts` tool call whose verdicts cover that snapshot, followed by `StubHarness.lateError`.
- Add or adapt retry-wrapper regression coverage in `test/retry.test.ts` proving no second evaluator attempt starts when the first attempt returns verdicts despite a late retryable transport error.
- Keep `test/agent-wiring.test.ts` at or below its no-growth ceiling of 2452 lines and `test/retry.test.ts` at or below its no-growth ceiling of 2201 lines.

### Out of Scope

- Changes to `DEFAULT_RETRY_POLICIES.evaluator` or generic retry policy semantics.
- Converting pre-verdict evaluator transport or infrastructure failures into success.
- Downgrading `error_max_turns`, execution errors, aborts, schema validation failures, or other non-transport terminal subtypes.
- Daemon, client, or event schema changes.
- Documentation updates.

## Files

### Create

- None.

### Modify

- `packages/engine/src/agents/builder.ts` — Add the completed-result helper and late retryable infrastructure downgrade branch in `builderEvaluate`'s catch block. The branch must run before the existing classified-terminal `plan:build:failed` emission.
- `test/agent-wiring.test.ts` — Adapt the existing `builderEvaluate wiring` tests to cover structured verdict submission followed by `lateError: new Error('Backend error: WebSocket error')`; assert returned structured verdicts, one warning, and zero `plan:build:failed` events. Also cover no-verdict retryable transport failure, structured-over-XML precedence with a late error, and XML fallback late-error preservation when no structured submission exists and parseable XML yields verdicts. Keep the added coverage compact and near the existing evaluator XML/structured submission tests.
- `test/retry.test.ts` — Add a compact `withRetry + StubHarness + builderEvaluate` regression where the first evaluator attempt submits valid structured verdicts and then throws a late WebSocket error; assert one backend prompt, zero `agent:retry`, zero `plan:build:evaluate:continuation`, and zero `plan:build:failed`. Preserve the existing pre-verdict transient transport retry test with unstaged changes present.

## Implementation Notes

A suitable helper shape in `builder.ts`:

```ts
function completedEvaluationResultFromEvidence(
  structuredSubmission: EvaluationSubmission | undefined,
  fullText: string,
  agentId: string | undefined,
): BuilderEvaluationResult | undefined {
  if (structuredSubmission) {
    if (structuredSubmission.verdicts.length === 0) return undefined;
    return { verdicts: structuredSubmission.verdicts, source: 'structured', failed: false, ...(agentId && { agentId }) };
  }
  const verdicts = parseEvaluationBlock(fullText);
  if (verdicts.length === 0) return undefined;
  return { verdicts, source: 'xml', failed: false, ...(agentId && { agentId }) };
}
```

In the catch block, after computing `terminalSubtype` and `message`, check the retryable late infrastructure predicate. When the helper returns a result, yield an `agent:warning` with `agent: 'evaluator'`, `planId: plan.id`, `agentId: evaluatorAgentId ?? 'unknown-evaluator'`, a stable downgrade code, and a message containing the original error message. Then `return completedResult` without yielding `plan:build:failed`.

## Verification

- [ ] A direct `builderEvaluate` test with an `evaluatorSnapshot`, a covering `submit_evaluation_verdicts` call, and `lateError: new Error('Backend error: WebSocket error')` returns `failed: false`, `source: 'structured'`, and the submitted verdict array.
- [ ] The same direct test records one `agent:warning` for the evaluator and records zero `plan:build:failed` events.
- [ ] A no-verdict WebSocket evaluator failure records a `plan:build:failed` event with `terminalSubtype: 'error_transient_transport'` and returns `failed: true`, `source: 'none'`, and an empty verdict array.
- [ ] A late-error case containing both structured verdicts and conflicting XML returns `source: 'structured'` and the structured verdict reason.
- [ ] An XML fallback late-error case returns `source: 'xml'` and the parsed XML verdicts when no structured submission exists.
- [ ] The retry-wrapper late-error regression records `backend.prompts.length === 1`, no `agent:retry`, no `plan:build:evaluate:continuation`, and no `plan:build:failed`.
- [ ] The existing pre-verdict transient transport retry test keeps unstaged changes present and records two evaluator prompts and one `agent:retry` with subtype `error_transient_transport`.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/agent-wiring.test.ts test/retry.test.ts` exits 0.