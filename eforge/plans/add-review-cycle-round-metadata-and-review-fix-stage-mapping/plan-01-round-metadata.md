---
id: plan-01-round-metadata
name: Review-Cycle Round Metadata in Wire Events and Engine Emission
branch: add-review-cycle-round-metadata-and-review-fix-stage-mapping/plan-01-round-metadata
agents:
  builder:
    effort: high
    rationale: Touches the closed client event schema plus engine
      review/retry/evaluator plumbing across several large files; careful
      optional-field propagation is required.
  reviewer:
    effort: high
    rationale: Review must check wire compatibility, no DAEMON_API_VERSION bump,
      standalone no-round behavior, and retry continuation propagation.
---

# Review-Cycle Round Metadata in Wire Events and Engine Emission

## Architecture Context

`packages/client/src/events.schemas.ts` is the source of truth for the `EforgeEvent` wire contract. The engine must emit typed facts and consumers render them. This plan adds a zero-based optional `round` integer to review, review-fix, and evaluate lifecycle events that run inside `review-cycle`.

The field stays optional for old logs and standalone stages. `packages/client/src/api-version-const.ts` explicitly says a new optional response field is not breaking and must not bump `DAEMON_API_VERSION`, so this plan must not edit that constant.

Several target files are larger than 1,000 lines. Use bounded exact edits and do not rewrite whole files.

## Implementation

### Overview

Add optional `round` metadata to review-cycle lifecycle event schemas, thread it through engine helpers, and cover both schema and runtime emission behavior with tests.

### Key Decisions

1. Use `round: Type.Optional(Type.Integer({ minimum: 0 }))` so wire events match existing zero-based `BuildDecision` round semantics.
2. Pass `round` only from `reviewCycleStage`; standalone `review`, `review-fix`, `evaluate`, and validation-provider recovery callbacks omit it.
3. Preserve event registry `scope: 'session'` and `persist: false` entries for these lifecycle events.
4. Do not bump `DAEMON_API_VERSION` because the change adds only optional event fields.

## Scope

### In Scope

- Add optional `round` to these event variants: `plan:build:review:start`, `plan:build:review:complete`, `plan:build:review:parallel:start`, `plan:build:review:parallel:perspective:start`, `plan:build:review:parallel:perspective:complete`, `plan:build:review:parallel:perspective:error`, `plan:build:review:fix:start`, `plan:build:review:fix:complete`, `plan:build:review:fix:continuation`, `plan:build:evaluate:start`, `plan:build:evaluate:continuation`, and `plan:build:evaluate:complete`.
- Thread optional round metadata through reviewer, parallel reviewer, review-fixer, evaluator, retry, and build-stage helpers.
- Add tests for schema acceptance, runtime review-cycle round emission, continuation round propagation, and no-round compatibility.
- Regenerate committed reference artifacts that drift after the event schema change.

### Out of Scope

- No `cycleId` field.
- No issue ID or issue-to-fixer causal tracing.
- No prompt changes.
- No daemon route changes.
- No `DAEMON_API_VERSION` bump.
- No review-cycle inspector sheet.

## Files

### Create

- `test/review-cycle-round-metadata.test.ts` — focused integration coverage for round `0` and `1` lifecycle event emission during `review-cycle`, plus standalone no-round behavior if that assertion is not covered by existing tests.

### Modify

- `packages/client/src/events.schemas.ts` — add a shared optional nonnegative integer `round` schema or equivalent inline fields on the listed lifecycle variants.
- `packages/client/src/event-registry.ts` — preserve `scope` and `persist`; add round-aware summary text only if a small helper keeps summaries concise.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add representative `round: 0` payloads for review/fix/evaluate lifecycle variants.
- `packages/client/src/__tests__/events-schemas.test.ts` — add table-driven tests that accept all listed variants with `round: 0`, accept the same variants without `round`, and reject a negative `round`.
- `packages/client/src/__tests__/events-schemas-build-evaluator.test.ts` — cover `plan:build:evaluate:complete` with `round: 0` and verdict summaries.
- `packages/engine/src/agents/reviewer.ts` — add optional round support to `ReviewerOptions` and include it on review start/complete lifecycle events.
- `packages/engine/src/agents/parallel-reviewer.ts` — add optional round support to `ParallelReviewerOptions`, pass it to single-review fallback, and include it on parallel review lifecycle events.
- `packages/engine/src/agents/review-fixer.ts` — add optional round support to `ReviewFixerOptions` and include it on review-fix start/complete events.
- `packages/engine/src/agents/builder.ts` — add optional evaluator round support and include it on `plan:build:evaluate:start`.
- `packages/engine/src/retry.ts` — preserve round in `ReviewFixerContinuationInput` and `EvaluatorContinuationInput`; include it on review-fix and evaluate continuation events when present.
- `packages/engine/src/pipeline/stages/build-stages.ts` — extend `reviewStageInner`, `reviewFixStageInner`, and `evaluateStageInner` options with optional round; pass `round` from the `reviewCycleStage` loop; include round on synthetic review complete and evaluate complete events; leave standalone stage registrations and validation-provider recovery callbacks without round.
- `test/retry.test.ts` — add or extend continuation policy tests so review-fixer and evaluator continuation events carry round when the retry input carries round and omit it when absent.
- `web/content/reference/events.md` — update generated event field listings if `pnpm docs:generate` changes them.
- `web/public/reference/events.md` — update generated event field listings if `pnpm docs:generate` changes them.
- `web/public/schemas/events.schema.json` — update generated event schema JSON if `pnpm docs:generate` changes it.
- `web/public/llms-full.txt` — update generated reference content if `pnpm docs:generate` changes it.

## Verification

- [ ] `safeParseEforgeEvent` accepts every listed review/fix/evaluate lifecycle event with `round: 0`.
- [ ] `safeParseEforgeEvent` accepts the same lifecycle events without `round`.
- [ ] `safeParseEforgeEvent` rejects at least one listed lifecycle event with `round: -1`.
- [ ] A `review-cycle` run emits round `0` on review, review-fix, and evaluate lifecycle events in its first round.
- [ ] A `review-cycle` run emits round `1` on review, review-fix, and evaluate lifecycle events in its second round.
- [ ] Standalone `review`, `review-fix`, and `evaluate` stage paths emit no `round` field.
- [ ] Review-fixer and evaluator retry continuation events carry `round` when the retry input carries `round`.
- [ ] Review-fixer and evaluator retry continuation events emit no `round` when the retry input omits `round`.
- [ ] `DAEMON_API_VERSION` remains unchanged.
- [ ] Registry metadata for these lifecycle events keeps `scope: 'session'` and `persist: false`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.