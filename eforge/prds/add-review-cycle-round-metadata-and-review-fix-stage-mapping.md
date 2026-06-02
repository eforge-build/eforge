---
title: Add Review-Cycle Round Metadata and Review-Fix Stage Mapping
created: 2026-06-02
landing: pr
landing_auto_merge: true
---

# Add Review-Cycle Round Metadata and Review-Fix Stage Mapping

## 1. Problem / Motivation

This session promotes backlog item `backlog-2026-06-02-review-cycle-inspector-foundation-round-metadata-and-review-`.

The console run-detail review-cycle inspector needs reliable stage and round metadata before the visual sheet is built. Today the UI can infer review-cycle rounds only from decision ordering, and the visible stage mapping omits the review-fix phase even though review-fixer agents run inside review-cycle.

This creates two problems:

- Future stage-level UI would need brittle timestamp/order inference to associate reviewer, fixer, and evaluator activity with a specific review round.
- Hover/highlight/status behavior for `review-cycle` does not fully cover the review-fixer contribution because `review-fix` is not represented as part of the composite.

The gap matters now because the next backlog item will add a clickable review-cycle inspector sheet. This foundation should make that downstream work durable and reduce rework.

Evidence gathered on current `main`:

- `packages/client/src/events.schemas.ts` owns the closed `EforgeEvent` wire schema. Review-cycle lifecycle events currently include `planId` and payload-specific fields, but no `round` field for `plan:build:review:*`, `plan:build:review:fix:*`, or `plan:build:evaluate:*` events.
- `packages/engine/src/pipeline/stages/build-stages.ts` has a `reviewCycleStage` loop with a `round` variable and emits `plan:build:decision` events (`perspectives-respawned`, `cycle-terminated`) carrying that round. The inner helpers `reviewStageInner`, `reviewFixStageInner`, and `evaluateStageInner` currently do not accept or emit round metadata.
- `packages/console-ui/src/components/pipeline/agent-stage-map.ts` maps `COMPOSITE_STAGES['review-cycle']` to `['review', 'evaluate']`, omitting the `review-fix` stage used by the `review-fixer` agent.
- `packages/console-ui/src/lib/run-state/types.ts` defines `PipelineStage` without a `review-fix` value, and `packages/console-ui/src/lib/run-state/handlers/handle-plan-build.ts` does not advance the visible stage on `plan:build:review:fix:start`.
- Existing tests to update include `packages/console-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts`, `packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts`, `packages/client/src/__tests__/events-schemas.test.ts`, and `packages/client/src/__tests__/events-schemas-build-evaluator.test.ts`.

Roadmap alignment:

- Aligns with `docs/roadmap.md` under Console Observability and Control by making run detail review-cycle behavior more inspectable.
- Also aligns with kernel typed-event discipline: engine emits typed facts, consumers render them.

Classification: this is a **feature / focused** change with high confidence. It adds a small user-visible observability foundation and typed event metadata rather than changing core build behavior.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| `round` can remain optional without breaking old logs or standalone stages. | Existing event schemas use optional fields elsewhere; old emitted events lack `round`; the desired UI can fall back for old runs. | high | low | Add schema tests for both with-round and without-round payloads. | If wrong, older run detail rendering or schema validation could fail. |
| `planId + round` is enough for the next inspector UI and no `cycleId` is needed now. | Build-stage config normally has one `review-cycle` composite per plan; no evidence found of multiple independent review-cycle composites in one plan. | medium | medium | Inspect build-stage composer validation and plan schema more deeply if multiple duplicate stages are supported. | If wrong, UI grouping could conflate two cycles with the same round number in one plan. |
| Review/fix/evaluate agent helper functions need optional round plumbing because some lifecycle events are emitted inside helpers. | `runReviewFixer` emits review-fix start/complete; `builderEvaluate` emits evaluate start; `build-stages.ts` synthesizes evaluate complete and some review complete events. | high | low | Inspect `parallel-reviewer.ts`, `review-fixer.ts`, and `builder.ts` during implementation. | If missed, some events in a cycle will still lack round metadata. |
| Adding `review-fix` to `PipelineStage` is safe for consumers. | `AGENT_TO_STAGE` already maps `review-fixer` to `review-fix`; current type lacks this value, so adding it matches existing runtime intent. | high | low | Run type-check and console reducer tests. | If wrong, UI status mapping or tests may need adjusted handling. |
| `DAEMON_API_VERSION` may need a bump even though `round` is optional. | Project instructions require client/daemon wire-shape discipline; current API version history documents event-schema changes. | medium | low | Check existing policy and tests around API version drift while implementing. | If omitted when required, stale first-party clients/daemons might not fail version verification as expected. |

Recommended profile: **Excursion**.

Rationale:

- The change is cohesive and can be planned as a single sequence across client schemas, engine event emission, and console reducer/stage mapping.
- It touches multiple packages but does not require delegated module planning or architecture decomposition.
- It is not an Errand because it changes a closed event contract, engine emission paths, and UI state semantics with test updates.
- It is not an Expedition because the boundaries and dependencies are already known and the implementation can be covered by one focused plan.

## 2. Goal

Add a focused observability foundation for the future review-cycle inspector by carrying optional review-cycle `round` metadata through review, review-fix, and evaluate lifecycle events, and by making `review-fix` a first-class console pipeline stage that resolves into the `review-cycle` composite.

The desired outcome is durable typed metadata and stage mapping without changing core build behavior, event persistence behavior, daemon route shapes, or building the inspector sheet itself.

## 3. Approach

Add optional `round` metadata to build review-cycle lifecycle event schemas for review, review-fix, and evaluate phases.

Use `round` as a zero-based optional integer to match existing `BuildDecision` round semantics. UI can render human-friendly one-based labels.

Keep `round` optional on wire events for backward compatibility with old run logs and standalone stages.

Pass round only from the composite `review-cycle` loop. Standalone `review`, `review-fix`, `evaluate`, and validation-provider recovery invocations should omit it unless they are explicitly running inside a known review-cycle round.

Do not add a `cycleId` in this foundation. Current plan build config does not indicate multiple independent review-cycle composites in one plan, and `planId + round` is sufficient for the next inspector UI.

Do not add issue IDs in this foundation. Issue-level causal traceability is a separate, higher-scope follow-up.

Treat `review-fix` as a first-class console `PipelineStage`, while still resolving it to the `review-cycle` composite when the plan build stages include `review-cycle`.

Preserve event persistence behavior. These lifecycle events are currently session-scoped and non-persisted in `event-registry`; persisted run detail still stores run-correlated emitted events through the monitor recorder, so registry persistence semantics should not be changed casually.

Prefer exact, bounded edits because several target files are large or central, especially `events.schemas.ts` and `build-stages.ts`.

Expected implementation targets:

- `packages/client/src/events.schemas.ts`: add optional `round: Type.Optional(Type.Integer({ minimum: 0 }))` to review-cycle lifecycle variants that can occur within a round.
- `packages/client/src/event-registry.ts`: update summaries only if useful; preserve existing `scope: 'session'` and `persist: false` metadata for these lifecycle events.
- `packages/client/src/api-version-const.ts`: bump `DAEMON_API_VERSION` if adding the optional field is treated as first-party client/daemon wire-contract drift. Because `EforgeEvent` is a closed schema and client version discipline is strict, this should be checked during implementation rather than assumed unnecessary.
- `packages/engine/src/pipeline/stages/build-stages.ts`: thread an optional round parameter through `reviewStageInner`, `reviewFixStageInner`, and `evaluateStageInner`; add the field to events synthesized in this file; preserve no-round behavior for standalone stage registrations and validation-provider recovery callbacks.
- `packages/engine/src/agents/review-fixer.ts` and `packages/engine/src/agents/builder.ts`: likely need optional round options only if lifecycle start/complete events are emitted inside these agent helpers. If round is instead added by wrapper code, these may not need changes. Cheap validation found `runReviewFixer` emits `plan:build:review:fix:start/complete`, and `builderEvaluate` emits `plan:build:evaluate:start`, so these helpers probably need optional `round` support.
- `packages/engine/src/agents/parallel-reviewer.ts` or reviewer helper path: likely need optional round support because review lifecycle events are produced by `runParallelReview`; validate exact emit sites during implementation.
- `packages/console-ui/src/lib/run-state/types.ts`: extend `PipelineStage` with `review-fix`.
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-build.ts`: handle `plan:build:review:fix:start` by setting visible stage to `review-fix`.
- `packages/console-ui/src/components/pipeline/agent-stage-map.ts`: update `COMPOSITE_STAGES['review-cycle']` to include `review-fix`.
- Tests: update or add cases in event schema tests, wire parity tests, agent-stage-map tests, and handle-plan-build tests.

Existing pattern evidence:

- Event variants are co-located in `packages/client/src/events.schemas.ts`.
- `reviewCycleStage` already has a `round` loop variable and emits it in build decisions.
- Console stage resolution already maps raw agent stages into composite build stages via `resolveBuildStage` and `COMPOSITE_STAGES`.

## 4. Scope

In scope:

- Add optional `round` metadata to build review-cycle lifecycle event schemas for review, review-fix, and evaluate phases.
- Propagate round metadata from the `reviewCycleStage` loop into `reviewStageInner`, `reviewFixStageInner`, and `evaluateStageInner` when those helpers are invoked from the composite review-cycle stage.
- Preserve standalone `review`, `review-fix`, and `evaluate` stage behavior by leaving `round` absent when no review-cycle round is known.
- Update event registry summaries or tests as needed without changing event persistence behavior.
- Add `review-fix` to console-ui pipeline stage modeling and to `COMPOSITE_STAGES['review-cycle']`.
- Update console run-state handling so `plan:build:review:fix:start` can mark the current visible stage as `review-fix`.
- Update tests covering event schema acceptance/parity and console stage mapping/reducer behavior.

Out of scope:

- Do not build the review-cycle inspector sheet in this change.
- Do not make stage pills clickable in this change.
- Do not add issue IDs or exact issue-to-fixer-to-evaluator causal traceability.
- Do not alter reviewer, review-fixer, or evaluator prompts except if absolutely necessary for typed metadata plumbing; no prompt change is expected.
- Do not change daemon route shapes or add new REST/SSE routes.

## 5. Acceptance Criteria

- `safeParseEforgeEvent` accepts `plan:build:review:start` with `round: 0`.
- `safeParseEforgeEvent` accepts `plan:build:review:complete` with `round: 0` and a valid `issues` array.
- `safeParseEforgeEvent` accepts `plan:build:review:parallel:start` with `round: 0` and valid `perspectives`.
- `safeParseEforgeEvent` accepts `plan:build:review:parallel:perspective:start` with `round: 0` and a valid `perspective`.
- `safeParseEforgeEvent` accepts `plan:build:review:parallel:perspective:complete` with `round: 0` and a valid `issues` array.
- `safeParseEforgeEvent` accepts `plan:build:review:parallel:perspective:error` with `round: 0` and a valid `error`.
- `safeParseEforgeEvent` accepts `plan:build:review:fix:start` with `round: 0` and a valid `issueCount`.
- `safeParseEforgeEvent` accepts `plan:build:review:fix:complete` with `round: 0`.
- `safeParseEforgeEvent` accepts `plan:build:review:fix:continuation` with `round: 0`, `attempt`, and `maxContinuations`.
- `safeParseEforgeEvent` accepts `plan:build:evaluate:start` with `round: 0`.
- `safeParseEforgeEvent` accepts `plan:build:evaluate:continuation` with `round: 0`, `attempt`, and `maxContinuations`.
- `safeParseEforgeEvent` accepts `plan:build:evaluate:complete` with `round: 0`, `accepted`, `rejected`, and valid verdict summaries.
- Existing valid review/fix/evaluate lifecycle events without `round` still pass `safeParseEforgeEvent`.
- Review-cycle execution emits review/fix/evaluate lifecycle events with `round: 0` during the first review-cycle round.
- Review-cycle execution emits review/fix/evaluate lifecycle events with `round: 1` during the second review-cycle round when a second round runs.
- Standalone `review`, `review-fix`, and `evaluate` stage registrations do not require a `round` value.
- `resolveBuildStage('review-fix', ['implement', 'review-cycle'])` returns `review-cycle`.
- `getBuildStageStatuses(['implement', 'review-cycle'], 'review-fix')` marks `review-cycle` active.
- The console run-state reducer sets `planStatuses[planId]` to `review-fix` when it handles `plan:build:review:fix:start`.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
