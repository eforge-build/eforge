---
title: Improve Recovery, Failed-Enqueue, and Queue Control UX
created: 2026-06-19
---

# Improve Recovery, Failed-Enqueue, and Queue Control UX

## Problem / Motivation

Operators still have gaps in the recovery/control loop after build or enqueue failures:

- Recovery sidecars and metadata can identify the failed root plan, but the root plan artifact that builders read before resume is not patched with explicit retry guidance.
- Failed enqueue runs are visible as failed enqueue/build-history entries, but the Now dashboard Needs attention strip does not provide a durable failed-enqueue row with the failure reason and a guided re-enqueue path.
- Queue surgery currently covers priority, removal, dependency override, and recovery flows, but it lacks per-PRD hold/unhold, an operator-facing scheduler pause/resume control, cascade-aware cancellation/removal, and capability metadata that tells Console which actions are safe.

The result is unnecessary manual intervention, unclear recovery next steps, and queue edits that can race auto-build or fail closed without a safe cascade option.

Key risks to watch:

- Auto-build races while mutating queue state.
- Over-broad plan patch targeting.
- Missing failed-enqueue source data.
- Destructive cascade surprises.
- UI clutter.
- API drift if route contracts are not kept client-owned.

## Goal

Improve the operator recovery/control loop by adding explicit recovery-guidance patching, durable failed-enqueue attention with guided re-enqueue, and safer queue hold, pause, cancellation, removal, and capability controls.

## Approach

- Add recovery-guidance patching for failed root plan artifacts before retry/resume.
- Use recovery sidecar/root-failure evidence to target only root failed plan artifacts.
- Add or replace a canonical `Recovery Guidance` section idempotently.
- Keep read-only analysis routes side-effect-free.
- Make mutation explicit and auditable.
- Add failed enqueue attention and re-enqueue UX in Console.
- Persist/project enough failed-enqueue context to show a Needs attention row with the error reason.
- Provide a confirmed re-enqueue action when the original source can be reconstructed.
- Provide a clear disabled/fallback state when automatic re-enqueue is not possible.
- Add queue hold/pause/cascade-aware control surfaces.
- Add typed daemon/client APIs and Console controls for per-item hold/unhold.
- Add scheduler pause/resume separate from disabling auto-build entirely.
- Add cascade preview/apply semantics for remove/cancel flows that affect dependents.
- Add per-item capability metadata so Console renders only valid actions and disabled reasons.
- Add all new wire shapes, route constants, and response types in `@eforge-build/client`.
- Ensure daemon and Console import client-owned contracts rather than declaring local API shapes or inline `/api/...` paths.
- Keep recovery patching explicit and idempotent.
- Allow recovery analysis to describe guidance, but only an apply/prepare route may mutate plan artifacts.
- Use a machine-bounded stable marker or stable heading for the guidance section so updates replace prior guidance instead of appending duplicates.
- Derive failed enqueue attention from durable daemon state/events, not only the transient recent-activity ring buffer.
- Preserve the distinction between disabling auto-build and pausing the scheduler.
- Treat disable as changing desired state and stopping/restarting watcher behavior.
- Treat pause as keeping desired auto-build enabled while preventing new launches.
- Ensure queue mutation APIs return capability metadata/reasons so Console can render safe controls without duplicating scheduler rules.
- Implement cascade operations as two-phase flows that preview affected items first, then apply an explicit operator-selected strategy.
- Keep default cascade behavior as refusal when dependents exist.
- Preserve the architecture guardrail that the engine stays headless and emits/consumes typed state, the daemon owns local mutation routes/projections, and Console renders controls/confirmations.

Expected impact areas:

- `packages/client/src/routes/route-map.ts`, client route/type modules, browser helpers, and API versioning if any daemon HTTP surface changes are breaking.
- `packages/engine/src/recovery/*`, `packages/engine/src/resume/*`, and git/worktree helpers for idempotent recovery-guidance patching and commit discipline.
- `packages/engine/src/queue/control.ts` and `packages/engine/src/queue/scheduler.ts` for hold/unhold, scheduler dispatch gating, cascade preview/apply, and running cancellation semantics.
- `packages/monitor/src/routes/*`, projections, recorder/event reads, and `AutoBuildSupervisor` integration for typed routes, pause/resume control, failed-enqueue projection, and queue mutation wakeups.
- `packages/console-ui/src/lib/selectors/now.ts`, Queue/Attention components, `use-auto-build`, Now dashboard wiring, and tests for the new control states.
- `packages/eforge/src/cli/queue-control.ts`, MCP proxy, Pi/Claude plugin surfaces only if the new controls are intentionally exposed outside Console.
- Pi and Claude integrations must stay in sync when adding user-facing commands/tools.
- Documentation in `packages/console-ui/README.md`, client README/API docs, and any CLI/MCP/skill docs for exposed controls.

Assumptions:

- Current plan artifacts live under the configured plan output directory, commonly `eforge/plans/<setName>/<planId>.md`.
- Recovery sidecars already contain enough root-failure data to identify root failed plan artifacts, with fallback to current `summary.failingPlan` when multi-root data is absent.
- Queue runtime state remains under `.eforge/queue` and is not itself committed.
- Only tracked plan artifact guidance changes require git commit discipline.
- Existing internal scheduler pause support can be reused, but it needs a typed operator-facing route/state transition.

## Scope

In scope:

- Recovery-guidance patching for failed root plan artifacts before retry/resume.
- Failed enqueue attention and re-enqueue UX in Console.
- Queue hold/pause/cascade-aware control surfaces.
- Typed daemon/client APIs and Console controls for per-item hold/unhold.
- Scheduler pause/resume separate from disabling auto-build entirely.
- Cascade preview/apply semantics for remove/cancel flows that affect dependents.
- Per-item capability metadata so Console renders only valid actions and disabled reasons.

Out of scope:

- New wrapper-app scheduling policy.
- Arbitrary process cancellation outside known eforge worker/session ownership.
- Broad Console route redesign.
- Non-additive recovery sidecar rewrites.

## Acceptance Criteria

- A typed engine/daemon helper reads the failed PRD recovery sidecar.
- The typed engine/daemon helper resolves the set name safely.
- The typed engine/daemon helper resolves the root failing plan id or root failing plan ids safely.
- The typed engine/daemon helper resolves feature/base branch context safely.
- The typed engine/daemon helper resolves the plan output directory safely.
- The recovery-guidance helper patches only root failed plan artifacts.
- The recovery-guidance helper does not patch downstream blocked dependents.
- The recovery-guidance helper does not patch downstream skipped dependents.
- The recovery-guidance patch adds or replaces exactly one canonical `## Recovery Guidance` section.
- The canonical `## Recovery Guidance` section contains the failure summary.
- The canonical `## Recovery Guidance` section contains the recommended action.
- The canonical `## Recovery Guidance` section contains the remaining work.
- The canonical `## Recovery Guidance` section contains retry/resume guidance.
- The canonical `## Recovery Guidance` section contains the sidecar timestamp.
- The canonical `## Recovery Guidance` section contains the source sidecar identity.
- Re-running the recovery-guidance helper with unchanged guidance does not change the plan artifact.
- Re-running the recovery-guidance helper with unchanged guidance reports `already-current` or an equivalent status.
- Tracked plan artifact changes are committed through the engine git helper discipline rather than raw git commit calls.
- Continue-and-repair preparation invokes or requires recovery-guidance patching before resuming from compiled artifacts.
- Retry preparation invokes or requires recovery-guidance patching before resuming from compiled artifacts.
- Read-only recovery analysis remains mutation-free.
- Failed enqueue runs produce a durable Console attention candidate.
- The durable failed-enqueue attention candidate includes run/session identity.
- The durable failed-enqueue attention candidate includes a source/plan-set label.
- The durable failed-enqueue attention candidate includes the failure reason.
- The durable failed-enqueue attention candidate includes a timestamp.
- Needs attention renders an `Enqueue failed` row distinct from failed build recovery rows.
- The `Enqueue failed` row includes a confirmed `Re-enqueue` action when daemon-side source data is sufficient.
- A successful `Re-enqueue` action refreshes queue data.
- A successful `Re-enqueue` action refreshes run data.
- If source data is unavailable, the `Enqueue failed` row explains why one-click re-enqueue is disabled.
- If source data is unavailable, the `Enqueue failed` row shows the operator's next command/path.
- Duplicate failed-enqueue attention rows are deduped across snapshot updates.
- Duplicate failed-enqueue attention rows are deduped across live event updates.
- Successful enqueue-only runs remain hidden from attention.
- Pending queue items can be held through typed APIs.
- Waiting queue items can be held through typed APIs.
- Pending queue items can be unheld through typed APIs.
- Waiting queue items can be unheld through typed APIs.
- Held queue items keep their queue order.
- Held queue items are not dispatched by the scheduler.
- Console displays held state for held queue items.
- Console disables invalid priority actions using reasons from client-owned capability metadata.
- Console disables invalid remove actions using reasons from client-owned capability metadata.
- Console disables invalid cascade actions using reasons from client-owned capability metadata.
- Scheduler pause is exposed as a user-facing control.
- Scheduler resume is exposed as a user-facing control.
- Scheduler pause leaves desired auto-build enabled.
- Scheduler pause prevents new launches.
- Already-running builds continue while the scheduler is paused unless explicitly cancelled.
- Queue remove supports preview-first cascade semantics with affected dependents.
- Queue cancel supports preview-first cascade semantics with affected dependents.
- Queue remove defaults to fail-closed behavior when dependents exist.
- Queue cancel defaults to fail-closed behavior when dependents exist.
- Queue remove requires explicit confirmation before mutating any dependent.
- Queue cancel requires explicit confirmation before mutating any dependent.
- Running cancellation by PRD id resolves to an owned session/worker when one is available.
- Running cancellation by PRD id refuses with a clear reason when no owned session/worker is available.
- Focused tests verify client route contracts.
- Focused tests verify daemon route validation.
- Focused tests verify daemon route security.
- Focused tests verify engine queue helpers.
- Focused tests verify engine recovery helpers.
- Focused tests verify Console selectors.
- Focused tests verify Console components.
- Focused tests verify snapshot/live projection parity.
- Existing queue priority behavior remains compatible.
- Existing queue remove behavior remains compatible.
- Existing dependency override behavior remains compatible.
- Unit tests verify recovery guidance rendering.
- Unit tests verify recovery path safety.
- Unit tests verify root-only recovery patch targeting.
- Unit tests verify recovery patch idempotency.
- Unit tests verify recovery commit behavior.
- Unit tests verify recovery no-op behavior.
- Unit tests verify failed enqueue projection from persisted events/runs.
- Unit tests verify Console attention dedupe.
- Unit tests verify Console attention action rendering.
- Unit tests verify queue hold/unhold on pending items.
- Unit tests verify queue hold/unhold on waiting items.
- Unit tests verify cascade preview/apply on pending cases.
- Unit tests verify cascade preview/apply on waiting cases.
- Unit tests verify cascade preview/apply on failed cases.
- Unit tests verify cascade preview/apply on skipped cases.
- Unit tests verify cascade preview/apply on running cases.
- Route security/validation tests cover every new mutating endpoint.
- Console component tests verify disabled reasons.
- Console component tests verify confirmations.
- Console component tests verify refresh-after-mutation.
- Console component tests verify pause/resume status.
- Console component tests verify held rows.
- Console component tests verify cascade previews.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Manually create a failed root plan with sidecar, run patching, and start continue-and-repair.
- Manually trigger a malformed enqueue failure and re-enqueue.
- Manually pause the scheduler.
- Manually hold an item.
- Manually preview cascade removal.
- Manually verify no unexpected dispatch while paused or held.