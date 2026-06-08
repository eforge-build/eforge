---
title: Lifecycle-Driven Recommendation Refresh for eforge-plan
created: 2026-06-08
landing: pr
landing_auto_merge: true
---

# Lifecycle-Driven Recommendation Refresh for eforge-plan

## Problem / Motivation

This session combines two high-priority `eforge-plan` blocker items into one cohesive build slice:

- `backlog-2026-06-05-maintain-recommended-backlog-implementation-order-and-next-w`
- `backlog-2026-06-05-link-backlog-items-session-plans-queue-runs-and-landed-build`

Roadmap alignment from `docs/roadmap.md`:

- The **Console Observability and Control** section calls for planning workflow UX in extension-owned workstations while preserving daemon/client compatibility plumbing.
- The **Extension Platform** section says eforge should remain a small kernel surrounded by trusted extension mechanisms.
- The **Thin integration strategy** says Pi and Claude Code integrations should shrink to launch/deep-link/status/build entry points rather than duplicating rich workflow UX.

Codebase evidence:

- `eforge/extensions/eforge-plan/index.ts` registers generic actions, integration commands, deep links, lifecycle hooks, input source, and the planning workstation.
- `eforge/extensions/eforge-plan/lifecycle.ts` already correlates queue/session/landing events to backlog trace sidecars and conservative shipped status updates.
- `eforge/extensions/eforge-plan/trace-store.ts` stores project-local trace sidecars under `.eforge/storage/extensions/eforge-plan/traces/`.
- `eforge/extensions/eforge-plan/recommendations-store.ts` stores the private recommendation model at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` can prepare open-backlog planner context and apply generated recommendations through safe mutation paths.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` exposes the generic Pi bridge (`/eforge:extensions`, `eforge_extension_contribution`) that should eventually replace host-specific knowledge of `eforge-plan` workflows.

`eforge-plan` has the pieces for planning/backlog ownership, but recommendation freshness is still operator-driven rather than lifecycle-driven.

Evidence:

- Backlog blocker `backlog-2026-06-05-maintain-recommended-backlog-implementation-order-and-next-w` says recommendations are still produced/applied by explicit planning tasks/actions rather than automatically re-evaluated after backlog, queue, run, or landing lifecycle changes.
- Backlog blocker `backlog-2026-06-05-link-backlog-items-session-plans-queue-runs-and-landed-build` says trace sidecars and handoff exist, but richer lifecycle evidence, epic progress/status, partial-completion semantics, and automatic recommendation refresh remain unshipped.
- `eforge/extensions/eforge-plan/lifecycle.ts` already correlates queue/session/landing events to trace sidecars and marks items `shipped` on confirmed merge/auto-merge.
- `eforge/extensions/eforge-plan/recommendations-store.ts` stores the private recommendation model at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`, but has no freshness/dirty semantics.
- `eforge/extensions/eforge-plan/board-actions.ts` reads current recommendations and projects them into the board, but does not expose stale/current recommendation state.

User-visible gap: after a linked build lands, fails, or changes state, `eforge-plan` can update trace evidence but the “next work” recommendation rail can remain stale without a durable signal or refresh workflow. That blocks retiring hardcoded host planning/backlog surfaces in favor of generic extension contributions.

Classification: this is a **feature / focused** change. It adds user-visible recommendation freshness behavior inside an existing extension boundary. It is not a kernel architecture change, but it touches storage schema, lifecycle hooks, action outputs, and workstation UX.

## Goal

Implement a cohesive first slice of lifecycle-driven recommendation freshness inside the project-team `eforge-plan` extension.

Recommendations should become stale automatically when correlated lifecycle evidence changes, become fresh after valid recommendation writes, and expose freshness through generic extension outputs and the workstation.

## Approach

Lifecycle hooks should be freshness invalidators, not autonomous AI planners.

Rationale:

- `EventHookContext` extends the base extension context (`logger`, `paths`, `exec`) and does not expose action-context `ctx.agentTasks`.
- Action handlers do get daemon-owned `ctx.agentTasks`, but event hooks are non-blocking lifecycle observers.
- Starting AI work directly from lifecycle hooks would either require new runtime capabilities or unsafe subprocess/CLI workarounds.
- The first cohesive slice should mark recommendations stale automatically and provide an explicit refresh action/workstation affordance backed by existing daemon-owned planning tasks.

Persist freshness as extension-owned project-local state adjacent to recommendations.

Preferred representation:

- Optional metadata on `current.json` if preserving `BacklogRecommendationModelSchema` compatibility is straightforward.
- A companion `refresh-state.json` if dirty state must exist even when `current.json` is absent.

The companion sidecar is safer if lifecycle events can happen before a recommendation model exists. It avoids fabricating an empty recommendation model only to record staleness.

Keep freshness metadata bounded and schema-validated.

Recommended fields:

- `schemaVersion: 1`
- `status: "fresh" | "stale"`
- `freshAt?: string`
- `staleSince?: string`
- `reasons: Array<{ eventType: string; itemIds: string[]; correlationKind: string; timestamp: string; summary: string }>` with a bounded max/history trimming helper
- `lastRefreshedBy?: "put-recommendations" | "apply-planner-result" | "apply-planning-agent-task-result"`

Bound reason history to avoid unbounded growth from repeated lifecycle events.

Mark recommendations stale only on correlated lifecycle changes.

`applyLifecycleEvent` should mark stale only when it correlates or bootstraps one or more backlog items. Uncorrelated daemon events should not dirty recommendations. This follows the existing lifecycle pattern where unrelated events return without item mutation.

Freshening should happen only after a valid recommendation write succeeds.

`put-recommendations` and planner-result application should validate and write recommendations first, then mark freshness `fresh`. If validation fails, freshness state remains unchanged.

Host integrations should consume freshness generically through contribution outputs.

`get-recommendations`, `list-board`, and `render-board-markdown` should expose enough freshness state for `/eforge:extensions`, `eforge_extension_contribution`, and the workstation to guide users without Pi/Claude knowing about `eforge-plan` internals.

Workstation refresh affordance should reuse existing planning task primitives.

The recommended UI behavior is to show a stale badge/reason summary and offer a “Refresh recommendations” path that invokes the existing `start-planning-agent-task` action with open-backlog context and `requestedOutputSections: ["recommendations"]`, then applies the result via `apply-planning-agent-task-result` with `applyRecommendations: true`.

If the existing action shape is insufficient, add the smallest dedicated wrapper action rather than coupling host integrations to extension-specific commands.

Primary implementation targets:

- `eforge/extensions/eforge-plan/recommendations-store.ts`
  - Existing owner of `current.json` path resolution, schema validation, read/write, and summary projection.
  - Add freshness read/write helpers here or in a new adjacent module to keep recommendation storage cohesive.

- `eforge/extensions/eforge-plan/schema.ts`
  - Existing owner of `BacklogRecommendationModelSchema`, `RecommendationSummarySchema`, and action output schemas.
  - Add a JSON-safe `RecommendationRefreshStateSchema` / freshness fields and thread them into `GetRecommendationsOutputSchema` and board/list output schemas as needed.

- `eforge/extensions/eforge-plan/recommendation-actions.ts`
  - Existing `get-recommendations` and `put-recommendations` actions.
  - Include freshness state in `get-recommendations`.
  - Mark fresh in `put-recommendations` after successful validation/write.

- `eforge/extensions/eforge-plan/planner-orchestration.ts`
  - Existing `applyPlannerResult` and `applyCompletedPlanningAgentTaskResult` write recommendations through safe paths.
  - Mark fresh after recommendation application, especially when `applyRecommendations` writes generated recommendations.

- `eforge/extensions/eforge-plan/lifecycle.ts`
  - Existing event-correlation and trace/status mutation flow.
  - After correlated trace/status updates, mark recommendations stale with bounded reason metadata: event type, correlation kind, item IDs, timestamp, and optionally queue/session/landing identifiers.
  - Avoid marking stale for uncorrelated events to prevent noisy state churn.

- `eforge/extensions/eforge-plan/board-actions.ts`
  - Existing board/list outputs already include recommendation summaries and trace summaries.
  - Add freshness projection so host integrations and workstation can display stale/current state without reading private files directly.

- `eforge/extensions/eforge-plan/kanban.ts`
  - Existing board/list outputs already include recommendation summaries and trace summaries.
  - Add freshness projection so host integrations and workstation can display stale/current state without reading private files directly.

- `eforge/extensions/eforge-plan/index.ts`
  - Existing action and workstation registration.
  - Add any new action/contribution if needed, for example a dedicated `get-recommendation-refresh-state` action or a command/deep-link that starts a recommendation-only planning task.
  - Prefer reusing existing `start-planning-agent-task` if the generic input already covers open-backlog recommendation refresh.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/...`
  - Existing Backlog recommendation rail and planning task flow.
  - Surface stale/current state and provide a clear refresh affordance that invokes the existing daemon-owned planning task flow for recommendations.

Test targets:

- `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` for lifecycle dirtying behavior.
- `eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts` for freshness storage path, validation, and fresh/stale transitions.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` for apply-result freshening.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` if workstation UI/bridge behavior changes.
- Existing top-level tests such as `test/eforge-plan-workstation.test.ts` if manifest/workstation contracts change.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Lifecycle hooks can safely write extension-owned storage during daemon event handling. | `eforge/extensions/eforge-plan/lifecycle.ts` already calls trace-store write helpers from `applyLifecycleEvent`; tests in `__tests__/lifecycle.test.ts` verify trace writes and item status mutation. | high | low | Add tests that `applyLifecycleEvent` writes recommendation freshness state in the same temp-project pattern. | If wrong, automatic stale marking must move to a daemon route/action or queue-time projection instead of event hooks. |
| Event hooks should not start daemon-owned AI planning tasks directly in this slice. | `packages/extension-sdk/src/context.ts` shows `EventHookContext` extends base context only; `packages/extension-sdk/README.md` describes `ctx.agentTasks` on action handlers, not event hooks. | high | medium | Inspect engine event-runtime context construction if implementation needs absolute confirmation. | If wrong and event hooks do have safe `agentTasks`, the implementation could optionally auto-start refresh tasks, but should still avoid unbounded background task storms. |
| A companion freshness sidecar is safer than only embedding freshness in `current.json`. | `readRecommendationsFromPath` returns `null` when `current.json` is missing, and lifecycle events can occur before recommendations exist. | medium | low | Prototype `refresh-state.json` helper and test missing-current behavior. | If embedded-only is chosen, stale state may be impossible to represent before first recommendation write unless an empty model is created. |
| Existing planning task flow can refresh all open-backlog recommendations. | `preparePlannerContext` falls back to all open backlog items when no `itemIds`, `epicId`, or `recommendationRef` is supplied; `start-planning-agent-task` is already exposed as an action with `requestedOutputSections`. | high | low | Add/adjust action test that starts a recommendations-only task with no item selection, or inspect `agent-task-actions.ts` for output-section defaults. | If wrong, add a small `start-recommendation-refresh-task` wrapper action. |
| Stale reasons should be bounded. | Event hooks may fire for enqueue/session/queue/landing events; unbounded reason arrays would grow over time. | high | low | Implement max reason count and test trimming. | If omitted, long-running projects accumulate noisy private metadata. |
| Generic contribution outputs are the right integration boundary for Pi/Claude. | Backlog item `make-eforge-plan-the-exclusive-backlog-planning-extension-su` explicitly states Pi/Claude should rely on `/eforge:extensions` and `eforge_extension_contribution`; code confirms those generic surfaces already exist. | high | low | Keep this slice out of `packages/pi-eforge/extensions/eforge/plan-command.ts` and hardcoded Claude skill surfaces. | If violated, the migration away from host-specific coupling regresses. |

Recommended profile: **excursion**.

Rationale: this is a cohesive multi-file extension feature with clear implementation boundaries in `eforge/extensions/eforge-plan`. A single planner session can enumerate the storage, lifecycle, action, workstation, and test changes without delegating independent module planning. It is broader than an errand because it changes persisted extension state and user-facing contribution outputs, but it does not require expedition-level multi-subsystem planning.

## Scope

In scope:

- Add extension-owned recommendation freshness state under `.eforge/storage/extensions/eforge-plan/recommendations/`, either embedded as optional metadata in `current.json` or as a small companion sidecar such as `refresh-state.json`.
- Mark recommendations stale from `eforge-plan` lifecycle event hooks when correlated backlog/session-plan/queue/run/landing evidence changes.
- Preserve the current recommendation model contract and existing `get-recommendations` / `put-recommendations` behavior for consumers while adding explicit freshness fields to outputs.
- Mark recommendations fresh when recommendations are written through safe mutation paths such as `put-recommendations`, `apply-planner-result`, or `apply-planning-agent-task-result` with `applyRecommendations: true`.
- Surface freshness state in board/list outputs so `/eforge:extensions`, `eforge_extension_contribution`, and the `eforge-plan` workstation can tell users that recommendations need refresh.
- Add tests for lifecycle event → trace update → stale recommendation state.
- Add tests for recommendation write/apply → fresh state.
- Update `eforge/extensions/eforge-plan/README.md` to describe freshness semantics and the supported refresh path.

Out of scope:

- Removing Pi/Claude `/eforge:plan` or hardcoded skill delegation.
- Removing daemon/client compatibility routes for session plans or playbooks.
- Extracting playbooks into `eforge-playbooks`.
- Fully automatic AI task execution from lifecycle hooks unless existing extension runtime context already supports it safely.
- Engine kernel changes unless investigation finds that lifecycle hooks cannot write extension storage reliably.
- Pi-specific `/eforge:plan` changes for this slice.

Current evidence shows event hooks receive `EventHookContext`, not action-context `ctx.agentTasks`; if that remains true, lifecycle hooks should mark recommendations stale and rely on an explicit action/workstation flow to run the daemon-owned planning task.

## Acceptance Criteria

- `eforge-plan` persists JSON-safe recommendation freshness state under `.eforge/storage/extensions/eforge-plan/recommendations/`.
- `eforge-plan` does not write recommendation freshness state to `.backlog/recommendations.json`.
- A correlated lifecycle event processed by `applyLifecycleEvent` updates the relevant backlog trace sidecar.
- A correlated lifecycle event processed by `applyLifecycleEvent` marks recommendation freshness as `stale`.
- A stale recommendation reason records the lifecycle event type.
- A stale recommendation reason records the affected backlog item id.
- A stale recommendation reason records the correlation kind.
- A stale recommendation reason records a timestamp.
- A stale recommendation reason records bounded summary metadata.
- Stale reason history is trimmed to avoid unbounded growth from repeated lifecycle events.
- An uncorrelated lifecycle event processed by `applyLifecycleEvent` does not mark recommendation freshness as `stale`.
- A successful `put-recommendations` action writes the recommendation model.
- A successful `put-recommendations` action marks recommendation freshness as `fresh` after successful validation and write.
- A failed `put-recommendations` action does not mark recommendation freshness as `fresh`.
- An invalid `put-recommendations` action does not create a recommendation model file.
- Existing `get-recommendations` consumers can read the current recommendation model contract.
- Existing `put-recommendations` consumers can submit the current recommendation model contract.
- A successful `apply-planner-result` recommendation write marks recommendation freshness as `fresh` only after the recommendation model write succeeds.
- A successful `apply-planning-agent-task-result` recommendation write with `applyRecommendations: true` marks recommendation freshness as `fresh` only after the recommendation model write succeeds.
- `get-recommendations` returns the current recommendation model path.
- `get-recommendations` returns recommendation freshness state in a JSON-safe output shape.
- `list-board` returns recommendation freshness state alongside existing recommendation summary data.
- `list-board` returns recommendation freshness state alongside existing trace summary data.
- `render-board-markdown` includes a visible stale recommendation freshness note when stale freshness state exists.
- `render-board-markdown` includes a visible current recommendation freshness note when current freshness state exists.
- The `eforge-plan` workstation surfaces stale recommendation state.
- The `eforge-plan` workstation provides a refresh affordance that uses generic extension action invocation.
- The `eforge-plan` workstation refresh affordance does not use Pi-specific hardcoded planning commands.
- The `eforge-plan` workstation refresh affordance does not use Claude-specific hardcoded planning commands.
- Existing generic contribution discovery lists the relevant recommendation freshness outputs or refresh action outputs.
- No new hardcoded Pi `/eforge:plan` dependency is added for recommendation freshness.
- `eforge/extensions/eforge-plan/README.md` documents recommendation freshness storage.
- `eforge/extensions/eforge-plan/README.md` documents stale marking semantics.
- `eforge/extensions/eforge-plan/README.md` documents the supported refresh workflow.
- `pnpm test -- eforge-plan` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- In the workstation, stale recommendation state should be presented as a stale badge/reason summary.
- In the workstation, users should have a clear “Refresh recommendations” path.