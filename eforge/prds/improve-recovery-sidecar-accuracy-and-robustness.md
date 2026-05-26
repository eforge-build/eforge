---
title: Improve Recovery Sidecar Accuracy and Robustness
created: 2026-05-26
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Improve Recovery Sidecar Accuracy and Robustness

## Problem / Motivation

The recovery sidecar and recovery verdict for failed eforge builds are often incomplete or misleading.

In the observed failed expedition build, `monitor.db` proved that two plans failed, `plan-04-queue-view` and `plan-06-static-serving-package-integration`, while five plans completed. However, `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.recovery.md` listed only `plan-06-static-serving-package-integration` and contained an empty degraded manual verdict.

This matters because recovery output is both a human handoff artifact and a decision source for recovery actions. If deterministic facts omit failed plans, or if verdict logic falls back to `manual` without applying obvious recovery policy, a human or automation may retry, split, or abandon using incorrect or low-value guidance.

This is defect repair in existing daemon/recovery behavior, not a new roadmap feature. `docs/roadmap.md` does not list recovery-sidecar quality as a future roadmap item.

### Evidence

- `AGENTS.md` requires engine communication through typed `EforgeEvent`s, event schemas to remain co-located in `packages/client/src/events.schemas.ts`, and no parallel daemon wire-shape declarations.
- Any recovery summary shape change must update shared client schemas/types and consumers.
- `.eforge/monitor.db` for run `03ea77d4-8b69-4774-ba3e-0ac30635468b` showed seven plans.
- `plan-01-console-shell`, `plan-02-activity-audit-view`, `plan-03-now-dashboard`, `plan-05-runs-build-entrypoints`, and `plan-07-system-configuration-view` completed/merged.
- `plan-04-queue-view` and `plan-06-static-serving-package-integration` failed with API 529 errors.
- The generated sidecar only listed `plan-06-static-serving-package-integration`.
- `packages/engine/src/recovery/event-history.ts` currently selects only the latest `plan:build:failed` event with `ORDER BY id DESC LIMIT 1`, then creates `summary.plans` from that single row.
- `packages/engine/src/recovery/failure-summary.ts` merges monitor DB synthesis with git log/diff, but it trusts `synthesizeFromEvents()` for plan status content.
- `packages/engine/src/recovery/sidecar.ts` renders `summary.plans`, `summary.failingPlan`, landed commits, model usage, validation evidence, and diff stat. It cannot render plan facts that are not present in the summary.
- `packages/engine/src/agents/recovery-analyst.ts` runs the analyst with `tools: 'none'`, so the analyst cannot inspect `monitor.db`, git, or plan files to compensate for an incomplete summary.
- Inline queue finalization in `packages/engine/src/eforge.ts` aborts recovery analysis after `90_000ms`.
- The observed sidecar's `Claude Code process aborted by user` error is consistent with the inline recovery timeout path.
- `runRecoveryAnalyst()` accumulates only `agent:message` content before parsing XML.
- Other agents such as `plan-evaluator` and `builder` also consider `agent:result.resultText`, which suggests a plausible parse-failure path for harnesses that primarily populate result text.
- Existing tests in `test/recovery.test.ts`, `test/daemon-recovery.test.ts`, and `test/pi-transport-resilience.test.ts` cover single failed plan synthesis, fallback sidecars, and transport failure classification.
- Search found no regression test for multiple failed plans in one run.

### Confirmed Reproduction

1. Inspect `.eforge/monitor.db` for run `03ea77d4-8b69-4774-ba3e-0ac30635468b`.
2. Query latest plan status by `plan:status:change` for that run.
3. Observe completed plans: `plan-01-console-shell`, `plan-02-activity-audit-view`, `plan-03-now-dashboard`, `plan-05-runs-build-entrypoints`, and `plan-07-system-configuration-view`.
4. Observe failed plans: `plan-04-queue-view` at `2026-05-26T06:15:04Z` and `plan-06-static-serving-package-integration` at `2026-05-26T06:15:10Z`.
5. Read `.eforge/queue/failed/add-eforge-console-side-by-side-with-legacy-monitor-ui.recovery.md`.
6. Observe that the sidecar plan table lists only `plan-06-static-serving-package-integration` and does not report `plan-04-queue-view`.
7. Observe that the sidecar verdict is fallback `MANUAL` with `Recovery analyst failed or timed out` and empty completed/remaining/risk lists.

### Minimal Synthetic Reproduction To Add In Tests

1. Create a temporary monitor DB with one failed build run for a set name.
2. Insert `plan:status:change` events for at least five completed plans and two failed plans.
3. Insert two `plan:build:failed` events for different plan IDs.
4. Call `buildFailureSummary({ setName, prdId, cwd, dbPath })`.
5. Assert the summary includes both failed plan IDs and the completed plan statuses.
6. Write a sidecar with a fallback/manual verdict.
7. Assert the Markdown and JSON sidecars still contain the deterministic multi-plan summary.

### Root Causes

1. `synthesizeFromEvents()` is latest-failure-only.
   - Evidence: `packages/engine/src/recovery/event-history.ts` queries `plan:build:failed` with `ORDER BY id DESC LIMIT 1` and then sets `plans = [{ planId: failingPlanId, status: 'failed', ... }]`.
   - Impact: concurrent expedition builds with multiple failures lose every failed plan except the last one.

2. Recovery summary does not reconstruct lifecycle state for all plans.
   - Evidence: `synthesizeFromEvents()` does not query latest `plan:status:change` per plan, `plan:merge:complete`, or `plan:build:test:complete` when a `plan:build:failed` exists.
   - Impact: completed/merged plan state and test outcomes are absent from the deterministic `summary.plans` table even though `monitor.db` contains them.

3. Recovery decision-making has no deterministic policy layer.
   - Evidence: inline recovery builds a summary, runs `runRecoveryAnalyst()`, and writes the analyst verdict or a fallback manual verdict. There is no engine-owned classifier that turns clear facts such as all failed plans being API 529 transient failures into a structured recommendation.
   - Impact: obvious cases degrade to low-value `manual` when the analyst times out, is aborted, or cannot parse output.

4. The analyst cannot compensate for summary defects.
   - Evidence: `packages/engine/src/agents/recovery-analyst.ts` passes `tools: 'none'` to the harness.
   - Impact: the LLM cannot inspect `monitor.db`, git, or plan files to discover omitted failures or completed work.

5. The sidecar renderer can only render the incomplete summary and verdict it receives.
   - Evidence: `packages/engine/src/recovery/sidecar.ts` renders `summary.plans`, `summary.failingPlan`, and the provided verdict; it has no independent DB access or verdict sanity checker.
   - Impact: fallback sidecars look sparse and can imply the recovery decision is better grounded than it is.

6. Inline recovery is vulnerable to producing degraded sidecars under API load.
   - Evidence: `packages/engine/src/eforge.ts` inline queue finalization aborts recovery analysis after `90_000ms` and writes a fallback manual verdict when the agent fails or times out.
   - Impact: a large or overloaded recovery session produces empty `completedWork`, `remainingWork`, and `risks` unless deterministic summary rendering and deterministic recommendation generation are sufficient.

7. Analyst verdicts are not validated against summary invariants.
   - Evidence: the code accepts a parsed `recovery:complete` verdict as final; there is no check that a split/retry/manual rationale mentions all failed plans, that a suggested successor covers every failed/remaining plan, or that a non-manual verdict is supported by known failure classes.
   - Impact: even a successful analyst run can produce a poor decision that ignores part of the failed build.

### Likely Contributing Issue

- `runRecoveryAnalyst()` accumulates only `agent:message` text before XML parsing.
- Evidence: the implementation appends `event.content` only for `agent:message`.
- Other agents such as `plan-evaluator` and `builder` also use `agent:result.resultText` as a fallback.
- This could cause parse failures if a harness reports final output primarily in `agent:result.resultText`.
- This should be validated with a focused `StubHarness` regression test.

## Goal

Deterministic recovery facts must accurately reconstruct failed runs even when the analyst fails.

Recovery verdicts must apply explicit, testable policy for common cases such as transient API failures, partial completion, multiple failed plans, and analyst timeout or parse failure.

Sidecars should report both the reconstructed facts and the recommendation source/rationale. The analyst should augment a deterministic recovery recommendation, not be the only component that decides what to do.

## Approach

This is a bugfix/deep change. The root defect is specific and reproducible, but the fix spans event-history synthesis, shared recovery summary schema, analyst robustness, sidecar rendering, inline timeout behavior, and regression tests.

### `packages/engine/src/recovery/event-history.ts`

- Replace latest-failure-only synthesis with run-level reconstruction.
- Query all `plan:build:failed` events for the run.
- Query latest `plan:status:change` per plan to build `summary.plans` for all observed plans.
- Enrich plan entries with error details from `plan:error:set` / `plan:build:failed`.
- Enrich plan entries with merge timestamps from `plan:merge:complete`.
- Enrich plan entries with test outcomes from `plan:build:test:complete` if schema is extended for that data.
- Preserve terminal failure fallback paths for compile, PRD validation, and acceptance validation failures.

### Recovery Decision Module Under `packages/engine/src/recovery/`

- Add a deterministic recovery recommendation function that consumes `BuildFailureSummary` and returns a typed recommendation/verdict candidate plus rationale/evidence.
- Recommended behavior should cover all failed plans being transient API/transport errors.
- Recommended behavior should cover partial completion with remaining failed plans.
- Recommended behavior should cover validation/acceptance failures.
- Recommended behavior should cover missing/corrupt monitor DB context.
- Recommended behavior should cover mixed/ambiguous failures.
- Add verdict invariant checks that compare analyst output to deterministic summary facts before accepting it as final.
- Define final verdict precedence as deterministic recommendation when analyst is unavailable.
- Define final verdict precedence as analyst verdict when it passes invariant checks.
- Define final verdict precedence as manual fallback with explicit invalidation reason when analyst contradicts required facts.

### `packages/engine/src/recovery/failure-summary.ts`

- Consume the richer event-history fragment without discarding existing git-derived landed commits, diff stats, and model usage.
- Keep `failingPlan` as a backwards-compatible primary failure only if chosen as a deliberate compatibility boundary.
- The truth source should be the complete failure list.

### `packages/client/src/events.schemas.ts`

- If new fields are added to `BuildFailureSummary`, `PlanSummaryEntry`, or recovery verdict metadata, update the TypeBox schemas in the shared client schema file.
- Candidate compatible additions include optional `failingPlans: FailingPlanEntry[]`.
- Candidate compatible additions include optional `commitSha`.
- Candidate compatible additions include optional `testPassed`.
- Candidate compatible additions include optional `testFailed`.
- Candidate compatible additions include optional `completedAt`.
- Candidate compatible additions include optional `recommendationSource`.
- Candidate compatible additions include optional `recommendationRationale`.
- Candidate compatible additions include optional `verdictInvalidationReason`.

### `packages/client/src/routes.ts` And Exported Browser/Client Types

- Inspect for duplicated `ReadSidecarResponse` or recovery summary shape references.
- Update references if schema additions need to be reflected there.
- Search evidence shows `routes.ts` contains a recovery sidecar response shape comment/interface area.

### `packages/engine/src/recovery/sidecar.ts`

- Render all failed plans when present.
- Render deterministic recovery recommendation metadata separately from raw analyst verdict text.
- Render whether the final recommendation came from deterministic policy, analyst output, analyst output after invariant validation, or manual fallback.
- Keep existing Markdown sections readable for old and new sidecars.

### `packages/engine/src/agents/recovery-analyst.ts`

- Add `agent:result.resultText` fallback when assembling text to parse.
- Pass the deterministic recommendation and explicit invariants to the prompt so the analyst reviews and refines rather than inventing from scratch.

### `packages/engine/src/prompts/recovery-analyst.md`

- Tell the analyst to account for every failed plan in `failingPlans` / `summary.plans`.
- Tell the analyst to explain when it disagrees with deterministic recommendation evidence.
- Keep `manual` as the safe default for ambiguous/mixed cases.

### `packages/engine/src/eforge.ts`

- Use the deterministic recommendation if the analyst times out, fails, or returns an invalid verdict.
- Make inline recovery timeout configurable or raise it only after deterministic fallback is in place.
- Prefer deterministic transient verdicts for clear all-failed-plan API 529 cases if implemented in engine code.
- Emit or persist recovery lifecycle events if feasible without disrupting queue finalization.

### Tests

- Extend `test/recovery.test.ts` for multi-plan event-history synthesis.
- Extend `test/recovery.test.ts` for deterministic recommendation generation.
- Extend `test/recovery.test.ts` for analyst verdict invariant checks.
- Extend `test/recovery.test.ts` for resultText fallback parsing.
- Extend `test/daemon-recovery.test.ts` for fallback sidecar content.
- Extend `test/daemon-recovery.test.ts` for final verdict behavior when analyst output is malformed/timed out.
- Extend `packages/client/src/__tests__/events-schemas.test.ts` if the recovery summary schema changes.
- Extend wire parity tests if the recovery summary schema changes.
- Add or update tests around read sidecar route compatibility if the JSON payload gains optional fields.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The primary sidecar incompleteness is caused by latest-failure-only DB synthesis. | Verified `event-history.ts` uses `ORDER BY id DESC LIMIT 1` for `plan:build:failed`; verified the real DB had two failed plans while the sidecar listed only the later failure. | high | low | Add a unit/integration test with two failed plans and assert both appear in `BuildFailureSummary`. | If wrong, fixing the query alone would not materially improve sidecar quality. |
| Poor recovery decisions are a separate defect from poor sidecar rendering. | Verified inline recovery accepts analyst verdict or fallback manual; found no deterministic recovery policy/invariant layer between summary creation and sidecar writing. | high | low | Add tests where analyst times out but deterministic evidence supports retry/split; assert final verdict is not empty fallback manual. | If wrong, decision quality would still depend on analyst availability and remain poor under API load. |
| `monitor.db` contains sufficient events to reconstruct useful plan status summaries after the build process exits. | Verified real DB includes `plan:status:change`, `plan:build:failed`, `plan:build:test:complete`, and `plan:merge:complete` events for the failed run. | high | low | Build a temp DB fixture using existing monitor DB helpers and validate reconstructed summary fields. | If wrong, recovery summaries would still need another state artifact or orchestration file fallback. |
| Adding optional fields to `BuildFailureSummary` is safer than replacing `failingPlan`, unless the implementation intentionally updates every consumer. | Search showed `summary.failingPlan` is used by apply-recovery decision emission and monitor timeline rendering; AGENTS requires shared wire schemas in `packages/client/src/events.schemas.ts`. | high | low | Run TypeScript type-check and update schema/wire parity tests for optional fields or replacement fields. | If wrong, consumers may silently ignore needed data or existing recovery apply behavior could break. |
| Deterministic 529/transient handling can be added without over-automating unrelated failures. | The real failure had clear API 529 messages and zero usage/tool events for both failed plans; existing code has `classifyAgentTerminalSubtype()`. | medium | medium | Add narrowly scoped tests for all-failed-plan transient transport errors and mixed transient/non-transient failures. | If wrong, eforge could recommend retry/split too aggressively or under-report manual-review cases. |
| Partial completion plus transient failures should usually produce a split-style recommendation rather than retrying the original full PRD. | The observed branch had five landed plan commits and two plans that never meaningfully started due to 529. Retrying the original PRD could duplicate completed work. | medium | medium | Encode the policy in tests and review against recent failed builds before generalizing. | If wrong, recovery could over-split when a clean retry would be simpler. |
| Analyst verdict invariant checks can detect materially incomplete analyst recommendations. | The failure mode is concrete: sidecar listed one failed plan when DB showed two. A rule can require all failed plan IDs to appear in rationale or successor PRD for split/manual details. | medium | medium | Add tests for analyst output that mentions only one of two failed plans and assert downgrade/invalidation. | If wrong, invalidation may reject useful but concise analyst verdicts; prompts may need to require explicit plan IDs. |
| A resultText fallback in `runRecoveryAnalyst()` is useful for some harness outputs. | Code inspection showed recovery only accumulates `agent:message`, while `plan-evaluator` and `builder` also use `agent:result.resultText`; no failing live example was isolated yet. | medium | low | Add a `StubHarness` test whose only final text is `agent:result.resultText`. | If wrong, the fallback is harmless but may add unnecessary code. |
| Raising or making the inline recovery timeout configurable improves sidecar quality. | The observed sidecar generated about 92 seconds after build end and inline recovery has a 90s abort; this correlation is strong but not a full runtime proof. | medium | medium | Add a focused design/test around timeout configuration or defer timeout changes until deterministic summary/decision fixes land. | If wrong, timeout changes may slow queue finalization without improving sidecar content. |
| Emitting persisted `recovery:*` events from inline finalization is feasible. | Manual `recover()` emits recovery events; inline finalization currently writes sidecars but the real DB had no `recovery:*` rows for the inline sidecar generation. | medium | medium | Inspect daemon event persistence path for queue finalizer and add an integration test if scope permits. | If wrong, event emission may require broader queue/daemon plumbing and should be deferred. |

No low-confidence, high-impact assumptions remain. The highest-impact evidence and decision root causes were validated directly against source code and the real monitor DB.

## Scope

### In Scope

- Recovery event-history synthesis.
- Recovery summary construction.
- Shared client schema/type updates for recovery summary or verdict metadata if fields change.
- Recovery sidecar Markdown and JSON rendering.
- Deterministic recovery recommendation policy.
- Analyst verdict invariant validation.
- Analyst parsing robustness for `agent:result.resultText`.
- Recovery analyst prompt updates.
- Inline recovery behavior when analyst fails, times out, or returns invalid output.
- Regression tests for multi-plan failure synthesis and deterministic fallback behavior.
- Compatibility with legacy sidecars and existing `summary.failingPlan` consumers unless all consumers are intentionally updated.

### Out Of Scope

- Treating this as a new roadmap feature.
- Broad scheduling or wrapper-app workflow changes.
- Over-automating ambiguous failures beyond narrow evidence-based deterministic rules.
- Making recovery fail closed when `monitor.db` is missing or corrupt.
- Replacing shared client schemas with engine-only recovery summary shapes.
- Unbounded full event-table scans for large monitor databases.

### Risks And Edge Cases

- Backward compatibility risk: `summary.failingPlan` is consumed by recovery apply decision emission in `packages/engine/src/eforge.ts`, which reads `parsed.summary?.failingPlan?.planId`, and by monitor timeline rendering.
- If the build chooses to replace the singular `summary.failingPlan` field instead of keeping it, update all consumers and sidecar reading paths in one coordinated change.
- Decision overreach risk: deterministic policy should improve obvious decisions, not pretend to solve ambiguous failures.
- Deterministic rules must be narrow and evidence-based.
- False retry risk: API 529 and transport failures are usually transient, but retrying the entire original PRD after several plans already landed may duplicate or conflict with completed work.
- The deterministic recommendation should distinguish `retry same PRD` from `split successor for only remaining failed plans` when meaningful work landed.
- Multi-plan split risk: when multiple sibling plans fail, the successor PRD must cover every failed/remaining plan, not just the last terminal failure.
- Analyst contradiction risk: if the analyst returns a verdict that ignores a failed plan or contradicts deterministic facts, the engine should not blindly accept it.
- Analyst contradictions should be downgraded to manual or deterministic fallback with an explicit invalidation reason.
- Schema drift risk: `BuildFailureSummary` is a shared wire shape owned by `packages/client/src/events.schemas.ts`.
- Any new fields must be represented in `packages/client/src/events.schemas.ts` and in client exports.
- Do not create engine-only recovery summary shapes that consumers cannot parse.
- Performance risk: reconstructing plan state from `monitor.db` should use bounded queries scoped by `run_id` and indexed columns.
- Avoid scanning the full event table for large monitor databases.
- Concurrent plan ordering risk: if a singular primary failure remains, define stable semantics for it, such as latest failed plan for backward compatibility, while `failingPlans` carries the complete set.
- Degraded-context risk: if `monitor.db` is missing or corrupt, sidecar generation should continue to write a partial manual sidecar.
- Timeout risk: simply increasing the 90s timeout may improve analyst quality but can slow queue finalization.
- Prefer improving deterministic summary and deterministic recommendation first, then make timeout configurable or asynchronous as a secondary robustness improvement.
- Test brittleness risk: tests should build small real monitor DB fixtures and assert durable summary/recommendation facts, not exact full Markdown formatting beyond key headings/rows.

### Profile Signal

Recommended profile: **Excursion**.

Rationale: this is a cross-cutting bugfix, but it is cohesive. A single planner can enumerate the affected recovery summary synthesis, deterministic recovery policy, verdict invariant checks, shared schema, sidecar rendering, analyst parsing, inline timeout behavior, and regression tests without requiring delegated module planning. The work should be implemented as a focused sequence of engine/client/test changes rather than an Expedition.

## Acceptance Criteria

- `buildFailureSummary()` includes every plan with a latest `plan:status:change` event for the selected failed build run in `summary.plans`.
- `buildFailureSummary()` includes `plan-04-queue-view` in failure summary data when a monitor DB fixture contains failed events for both `plan-04-queue-view` and `plan-06-static-serving-package-integration` in one run.
- `buildFailureSummary()` includes `plan-06-static-serving-package-integration` in failure summary data when a monitor DB fixture contains failed events for both `plan-04-queue-view` and `plan-06-static-serving-package-integration` in one run.
- The recovery summary JSON exposes a complete list of failed plans when more than one plan failed in the same run.
- `summary.failingPlan` remains populated for existing consumers or all consumers are updated to use a replacement multi-failure field.
- `writeRecoverySidecar()` writes Markdown that lists every failed plan present in the recovery summary.
- `writeRecoverySidecar()` writes Markdown that lists completed or merged plans present in the recovery summary even when the recovery analyst verdict is fallback manual.
- A malformed recovery analyst response still produces a sidecar whose JSON summary contains all reconstructed plan statuses from `monitor.db`.
- A timed-out recovery analyst response still produces a sidecar whose JSON summary contains all reconstructed plan statuses from `monitor.db`.
- An unparsable recovery analyst response still produces a sidecar whose JSON summary contains all reconstructed plan statuses from `monitor.db`.
- A malformed recovery analyst response still produces a final recovery verdict based on deterministic recovery policy when deterministic policy has high-confidence evidence.
- A timed-out recovery analyst response still produces a final recovery verdict based on deterministic recovery policy when deterministic policy has high-confidence evidence.
- An unparsable recovery analyst response still produces a final recovery verdict based on deterministic recovery policy when deterministic policy has high-confidence evidence.
- The deterministic recovery policy recommends a transient recovery path when every failed plan has a transient API or transport error and no failed plan performed meaningful tool work.
- The deterministic recovery policy recommends a split-style recovery path when some plans completed or merged and only a subset of plans remain failed due to transient API or transport errors.
- The deterministic recovery policy recommends manual review when failed plans contain mixed transient and non-transient failure causes.
- The deterministic recovery policy recommends manual review when monitor DB context is missing.
- The deterministic recovery policy recommends manual review when monitor DB context is corrupt.
- The deterministic recovery policy recommends manual review when monitor DB context is insufficient to determine all failed plans.
- The recovery analyst prompt includes deterministic recommendation evidence.
- The recovery analyst prompt requires the analyst to account for every failed plan in the summary.
- An analyst verdict that omits one or more failed plans from its rationale is not accepted as the final verdict without downgrade or invalidation metadata.
- An analyst verdict that omits one or more failed plans from its successor recommendation is not accepted as the final verdict without downgrade or invalidation metadata.
- An analyst split verdict without a successor PRD that covers every failed plan is not accepted as the final split verdict.
- An analyst split verdict without a successor PRD that covers every remaining plan is not accepted as the final split verdict.
- The sidecar JSON records when the final verdict came from deterministic policy.
- The sidecar JSON records when the final verdict came from analyst output.
- The sidecar JSON records when the final verdict came from analyst output after invariant validation.
- The sidecar JSON records when the final verdict came from manual fallback.
- The sidecar Markdown displays the final verdict source.
- The sidecar Markdown displays any analyst invalidation reason when an analyst verdict is rejected.
- `runRecoveryAnalyst()` parses a valid recovery XML block when the harness provides the final assistant text through `agent:result.resultText` and no `agent:message` content is available.
- API 529 failures are classified as transient transport failures in recovery summary or recovery decision data when the error message matches the existing transport classifier.
- The recovery sidecar route continues to return valid existing v2 sidecar JSON for sidecars that do not contain the new optional fields.
- `packages/client/src/events.schemas.ts` accepts recovery summary events containing the new optional multi-failure fields.
- `packages/client/src/events.schemas.ts` accepts recovery summary events containing the new optional verdict-source fields.
- Existing recovery apply behavior still emits a recovery verdict decision for a deterministic target plan when reading a legacy sidecar with only the singular `summary.failingPlan.planId` field.
- A regression test fails against the old latest-failure-only query behavior and passes after the multi-plan synthesis fix.
- A regression test fails against old analyst-only timeout behavior for clear API 529 failures and passes after deterministic fallback verdict selection is implemented.
- `pnpm test -- recovery` exits 0.
- `pnpm type-check` exits 0.
