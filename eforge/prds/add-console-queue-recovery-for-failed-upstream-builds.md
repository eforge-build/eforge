---
title: Add Console queue recovery for failed upstream builds
created: 2026-05-31
profile: pi-codex-5-5
landing: pr
landing_auto_merge: true
---

# Add Console queue recovery for failed upstream builds

## Problem / Motivation

Failed queued PRDs can cascade-skip dependent PRDs, but eforge does not currently provide a safe first-class recovery workflow for that cascade.

Evidence gathered for a fresh successor from current `main`:

- Roadmap alignment: `docs/roadmap.md` names Console Workbench as the canonical local-first control surface and explicitly includes actionable build control: queue management, retry/recovery, validation waivers, stack sync, and lifecycle actions from the console.
- Console scope: `packages/console-ui/README.md` identifies `/console/` as the active Now dashboard for active builds, queue, and live status. `packages/monitor-ui/` is legacy and should not be modified for this successor unless a reviewer explicitly identifies a shared reducer contract issue.
- Current Console queue display is intentionally read-only: `packages/console-ui/src/components/now/queue-card.tsx` states there are zero mutation endpoints and renders failed queue items only as status/recovery-verdict text.
- Current stack selector excludes failed nodes: `packages/console-ui/src/lib/selectors/queue-stacks.ts` filters `status !== 'failed'`; current daemon queue projection also deletes `dependsOn` from failed/skipped items, so terminal cascades cannot be reconstructed from `GET /api/queue` alone.
- Current daemon queue projection loads root, `failed/`, `skipped/`, and `waiting/` entries in `packages/monitor/src/server.ts`, but `postProcessQueueDependsOn` strips failed/skipped dependency edges and filters active dependencies to pending/running/waiting items.
- Current engine queue primitives already support the execution side: `packages/engine/src/prd-queue.ts` has `propagateSkip(...)` to move waiting dependents to `skipped/` on upstream failure, and `unblockWaiting(...)` to move waiting PRDs back to root after dependencies have usable artifacts.
- Existing recovery apply helpers retry/split/abandon/manual the failed item itself, but the current codebase has no `queue-recovery` client API, no queue recovery daemon routes, and no engine `recovery-cascade` helper on `main`.
- The old branch `eforge/console-queue-recovery-for-failed-upstream-builds` is incomplete and stale relative to current `main`: it contains only the foundation commit `f181414d`, did not land, and diverged before recent review-cycle/evaluator commits. A fresh successor should use the failed PRD as context but should not resume or retry that branch.
- Classification: this is a **feature / focused** change. It adds a user-facing Console workflow plus daemon/client APIs, but it is a cohesive queue-recovery slice that a single plan can enumerate.

Confirmed current behavior and gap:

- `propagateSkip(...)` in `packages/engine/src/prd-queue.ts` correctly moves waiting dependents from `.eforge/queue/waiting/` to `.eforge/queue/skipped/` when an upstream fails or is cancelled.
- Existing recovery apply helpers act on the failed item itself and do not reactivate skipped descendants.
- `GET /api/queue` includes failed and skipped items, but `postProcessQueueDependsOn(...)` in `packages/monitor/src/server.ts` removes dependency edges from failed/skipped items. This keeps active scheduling display simple, but it hides terminal dependency cascades needed for recovery UX.
- `packages/console-ui/src/components/now/queue-card.tsx` is display-only and cannot preview or apply a cascade repair.
- Users currently need manual filesystem moves between queue root, `failed/`, `skipped/`, and `waiting/` to recover a failed-upstream/skipped-descendant stack. That is risky because it can bypass dependency readiness, ignore stale preview state, and fail to wake the scheduler.

The user-facing gap is: when a failed upstream should be retried, the Console should show affected skipped descendants, preview the queue repair, and apply the repair through daemon-owned APIs so normal scheduler semantics resume.

## Goal

Add a safe first-class Console workflow for recovering failed-upstream queue cascades. The Console should show affected skipped descendants, preview the queue repair, and apply the repair through daemon-owned APIs so normal scheduler semantics resume.

## Approach

Build a fresh successor from current `main`; do not resume or retry branch `eforge/console-queue-recovery-for-failed-upstream-builds`.

Expected implementation targets on current `main`:

- `packages/client/src/routes.ts`
  - Add `API_ROUTES` entries for queue recovery analyze/apply.
  - Add request/response wire types or export them from a client-owned module.
  - Keep route literals centralized here; do not inline `/api/...` in Console or monitor packages.

- `packages/client/src/api/queue.ts` or new `packages/client/src/api/queue-recovery.ts`
  - Add typed helpers such as `apiAnalyzeQueueRecovery(...)`, `apiAnalyzeQueueRecoveryIfRunning(...)`, `apiApplyQueueRecovery(...)`, and `apiApplyQueueRecoveryIfRunning(...)`, following existing client API helper conventions.

- `packages/client/src/index.ts` and `packages/client/src/browser.ts`
  - Re-export queue recovery types, route helpers, and browser-safe helpers for Console consumption.

- `packages/client/src/types.ts` or route-adjacent client module
  - Define shared wire shapes for strategy, node, edge, operation, operation status, warning/blocker, analyze response, and apply response.
  - Console and monitor packages must import these types rather than declaring local structural duplicates.

- `packages/engine/src/queue/recovery-cascade.ts` or similarly focused new module
  - Load queue PRDs from queue root, `waiting/`, `failed/`, and `skipped/` with raw `depends_on` intact.
  - Build terminal cascade analysis for selected failed upstreams.
  - Plan operations for `retry-and-reactivate-descendants` and optionally `reactivate-descendants-only` if kept.
  - Guard file operations with path-safe IDs, expected locations, and re-read drift checks.
  - Move descendants to `waiting/` by default; move directly to queue root only when dependency readiness can be proven with current queue state and artifact registry semantics.
  - Keep new file under the 600-line new implementation file policy, splitting helpers if needed.

- `packages/engine/src/prd-queue.ts`
  - Reuse existing queue parsing/move helpers where possible, or extract small shared helpers if needed.
  - Avoid broad rewrites of this large existing file.

- `packages/monitor/src/server.ts`
  - Add thin route branches for analyze/apply that call client-owned route constants and engine helpers.
  - Invoke existing queue mutation notification after successful apply so SSE/REST views refresh and scheduler behavior wakes normally.
  - Avoid embedding cascade graph algorithms in `server.ts`.

- `packages/console-ui/src/lib/selectors/queue.ts`, `packages/console-ui/src/lib/selectors/queue-summary.ts`, and `packages/console-ui/src/lib/selectors/queue-stacks.ts`
  - Treat `skipped` as a known/attention status.
  - Preserve current active stack behavior for pending/waiting/running queues.
  - Add recovery-oriented display selectors only when needed; do not rely on filtered `QueueItem.dependsOn` for terminal cascades.

- `packages/console-ui/src/components/now/queue-card.tsx` and `packages/console-ui/src/components/now/queue-stack-card.tsx`
  - Add the recoverable-cascade affordance while keeping non-actionable rows compact.
  - Use shadcn/ui components (`Dialog`/`AlertDialog`, `Button`, `Badge`, `Card`, etc.) rather than custom primitives.

- New focused Console files, likely under `packages/console-ui/src/components/now/` or `packages/console-ui/src/components/recovery/`
  - Implement dialog/panel state for loading analysis, showing blockers/warnings, previewing operations, applying repair, and showing success/error.

- Tests
  - Add client tests for route constants, request/response typing, and helper paths.
  - Add engine tests for failed upstream + skipped child + skipped grandchild analysis and guarded apply behavior.
  - Add monitor route tests that seed queue directories and assert analyze/apply responses plus mutation notification behavior.
  - Add Console selector/component tests for skipped status, cascade affordance, dry-run display, blocker display, apply success, and apply failure.

Evidence supporting this impact list:

- `packages/monitor/src/server.ts` currently owns queue item projection for REST and SSE hello snapshots.
- `packages/client/src/types.ts` currently owns `QueueItem` and recovery verdict wire shape.
- `packages/engine/src/prd-queue.ts` currently owns queue filesystem transitions such as `propagateSkip(...)` and `unblockWaiting(...)`.
- `packages/console-ui/README.md` identifies Console as the active dashboard and documents REST/SSE data flow patterns.
- `packages/console-ui/src/components/now/queue-card.tsx` currently has no mutation UX and therefore needs deliberate new affordance/components.

Design decisions:

- Use explicit daemon/client queue recovery APIs instead of Console filesystem mutation.
  - Rationale: queue state is runtime filesystem-backed state and scheduler wake-up belongs to daemon/engine. Console should only present typed daemon operations.

- Separate read-only analysis from mutation apply.
  - Rationale: users need to see exactly which failed/skipped files will move before a retry/reactivation can wake auto-build.

- Analyze raw queue PRD frontmatter rather than `GET /api/queue` `dependsOn` values.
  - Rationale: current queue projection intentionally deletes failed/skipped dependency edges. Terminal cascade analysis must preserve raw `depends_on` from files in `failed/` and `skipped/`.

- Make `retry-and-reactivate-descendants` the primary strategy.
  - Rationale: the concrete workflow is recovering from a failed upstream that caused dependents to be skipped. Retrying the upstream without restoring descendants leaves the cascade broken.

- Reactivate skipped descendants to `waiting/` by default.
  - Rationale: `unblockWaiting(...)` is the existing dependency/artifact gate. Putting descendants in `waiting/` preserves dependency readiness semantics until the retried upstream produces a usable artifact.

- Allow direct move to queue root only when dependency readiness is proven.
  - Rationale: some descendants may only depend on already-satisfied upstreams. The implementation may place them directly in the root when all dependencies are inactive and have usable artifacts, but must record that reason in the operation plan.

- Use guarded optimistic apply with drift checks.
  - Rationale: queue files can change between preview and apply. Apply must re-read state and refuse when expected source locations or requested descendants no longer match.

- Keep recovery sidecar verdicts separate from queue cascade repair.
  - Rationale: a sidecar verdict of `manual` or low confidence should not block a user-directed queue operation, but the UI must make it visible and require explicit confirmation.

- Keep the existing active queue-stack display stable.
  - Rationale: the current stack card is useful for live pending/waiting/running dependencies. Failed/skipped cascade recovery can use a separate analysis response or dialog rather than changing the live stack selector to depend on terminal edges.

- Add focused modules instead of growing already-large files.
  - Rationale: project policy caps new implementation files at 600 lines and requires bounded edits for large files. Complex logic should live in focused engine/client/Console modules, with `server.ts` route branches kept thin.

- Prefer generated/reference docs updates only for client API/docs surfaces that actually drift.
  - Rationale: client route/helper changes likely require docs generation or docs checks; avoid unnecessary broad docs changes.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The old branch should not be resumed directly. | `git rev-list --left-right --count main...eforge/console-queue-recovery-for-failed-upstream-builds` showed divergence; the branch contains only the foundation commit and lacks current `main` review-cycle/evaluator fixes. | high | low | Attempt a merge-tree or fresh cherry-pick during implementation if salvageing code is considered. | Resuming the old branch could reintroduce stale conflicts or miss recently shipped engine changes. |
| The feature has not already shipped on `main`. | Checked current files: no `packages/client/src/api/queue-recovery.ts`, no `packages/engine/src/queue/recovery-cascade.ts`, no route constants or helpers for queue recovery. | high | low | Re-run `rg "QueueRecovery|queue-recovery|recovery-cascade"` before implementation. | If wrong, the successor may duplicate existing work instead of extending it. |
| Skipped PRD files retain raw `depends_on` frontmatter needed for cascade analysis. | `propagateSkip(...)` moves the PRD file from `waiting/` to `skipped/` rather than rewriting dependencies; queue projection parses `depends_on` before deleting it from failed/skipped `QueueItem`s. | high | low | Add an engine test that seeds skipped files with `depends_on` and asserts analysis preserves edges. | If wrong, analysis needs skip-cause metadata or event-history reconstruction. |
| Moving descendants to `waiting/` is the safe default after reactivating a cascade. | `unblockWaiting(...)` is the existing artifact-aware dependency gate and only scans `waiting/`. | high | low | Add an engine apply test where a descendant remains waiting until a parent artifact is usable. | Moving directly to root could run dependent work before upstream artifacts exist. |
| A daemon queue mutation notification is enough to refresh Console and wake normal scheduling after apply. | Existing server code has queue mutation paths and queue snapshots are served through REST/SSE; exact helper name/placement was not deeply traced during planning. | medium | medium | Inspect `notifyQueueMutation` and scheduler wiring during implementation; add a monitor route test that observes the mutation side effect. | If wrong, repaired files may not be picked up until a daemon restart or polling tick. |
| Existing recovery sidecar verdicts can remain informational for this workflow. | Sidecar verdicts are currently projected on failed queue items; queue repair is a separate filesystem operation not represented by `retry/split/abandon/manual`. | high | low | Add UI copy/tests showing manual/low-confidence sidecars still require explicit confirmation. | If wrong, the UI could imply automated safety where only user-directed recovery exists. |
| Console can host this in the Now dashboard rather than a new route. | `packages/console-ui/README.md` says `/console/` is active builds, queue, and live status; queue card already displays failed/recovery verdict information. | medium | low | Validate layout during implementation; if crowded, use a focused dialog launched from the Queue card. | If wrong, UI may become crowded and should move to a dedicated queue/recovery route later. |
| The first successor should avoid making compiled resume part of cascade recovery. | Current resume behavior was not validated as producing the same durable queue completion and artifact signal that `unblockWaiting(...)` depends on. | medium | medium | Trace resume success events and artifact/completion registry writes in a separate spike if needed. | If wrong, the Console may not offer a useful resume-plus-reactivate path in this slice. |

Profile signal:

Recommended profile: **Excursion**.

Rationale: this is a cohesive cross-package feature spanning client route/type contracts, engine queue filesystem helpers, daemon route delegation, and Console UI. A single planner can enumerate the implementation targets and dependency chain without delegated module planning. It is not an Errand because it adds public daemon/client API surface and guarded queue mutation behavior. It is not an Expedition because the subsystems are sequential and bounded rather than requiring independently planned module strategies.

## Scope

In scope:

- Build a fresh successor from current `main`; do not resume or retry branch `eforge/console-queue-recovery-for-failed-upstream-builds`.
- Add client-owned queue recovery request/response types and route constants in `@eforge-build/client`.
- Add browser-safe client API helpers for queue recovery analysis and apply.
- Add engine queue recovery helpers that read raw queue PRD frontmatter across queue root, `waiting/`, `failed/`, and `skipped/` while preserving terminal `depends_on` edges.
- Add a read-only analysis operation for a selected failed upstream that returns cascade nodes, dependency edges, planned operations, warnings, blockers, and eligibility.
- Add a guarded apply operation that re-reads queue state, detects drift from the preview, moves the failed parent back to the queue root for retry, and reactivates skipped descendants to `waiting/` unless all dependencies are already satisfied.
- Add thin daemon routes that validate requests, delegate to engine helpers, return client-owned wire shapes, and notify queue mutation after successful apply.
- Add Console Now-dashboard affordances for failed upstreams with recoverable skipped descendants: inspect cascade, preview operations, apply repair, and display blockers/warnings/errors.
- Treat `skipped` as a first-class queue display status in Console summaries/selectors.
- Update Console documentation for the new queue recovery control if UI behavior changes.
- Add tests for client wire/helpers, engine cascade analysis/apply, daemon routes/mutation notification, and Console selector/component states.

Out of scope:

- Do not modify `packages/monitor-ui/` for this successor unless required by shared reducer tests; the active dashboard is `packages/console-ui/`.
- Do not add general drag-and-drop queue reordering or priority editing.
- Do not edit arbitrary `depends_on` frontmatter from Console.
- Do not automatically retry failed builds without explicit user confirmation.
- Do not make compiled-artifact resume the primary cascade-recovery path in this slice. Resume can remain separate unless implementation proves it emits the same durable queue completion/artifact signal used by dependency unblocking.
- Do not repair git branches, PRs, or stack-provider state beyond queue file transitions and scheduler wake-up.
- Do not overload recovery sidecar verdict semantics; queue cascade repair is a user-directed operation even when the sidecar verdict is `manual`.

## Acceptance Criteria

- `@eforge-build/client` exports an `API_ROUTES` entry for queue recovery analysis.
- `@eforge-build/client` exports an `API_ROUTES` entry for queue recovery apply.
- `@eforge-build/client` exports request and response types for queue recovery analysis.
- `@eforge-build/client` exports request and response types for queue recovery apply.
- `@eforge-build/client/browser` exports browser-safe queue recovery API helpers and wire types used by Console.
- No Console UI file declares local structural duplicates of queue recovery request or response wire shapes.
- The queue recovery analysis route leaves queue filesystem state unchanged for a failed upstream with skipped descendants.
- The queue recovery analysis response includes the selected failed upstream PRD id when the selected PRD exists in `failed/`.
- The queue recovery analysis response includes skipped child and skipped grandchild descendant PRD ids for a failed-upstream cascade.
- The queue recovery analysis response includes raw dependency edges for failed and skipped PRDs whose `depends_on` entries point at failed or skipped PRDs.
- The queue recovery analysis response returns `eligible: false` when the selected PRD id is unknown.
- The queue recovery analysis response returns at least one human-readable blocker when the selected PRD id is unknown.
- The queue recovery analysis response includes planned operations before mutation is applied.
- The queue recovery apply route re-reads queue state before performing file moves.
- The queue recovery apply route refuses to apply when an expected source item is no longer in the expected queue location.
- The queue recovery apply route moves the selected failed parent PRD from `failed/` to the queue root for the retry-and-reactivate strategy.
- The queue recovery apply route removes the selected parent recovery sidecars only when the parent PRD is actually requeued for retry.
- The queue recovery apply route moves skipped descendant PRDs to `waiting/` when their dependencies are not all currently satisfied.
- The queue recovery apply route moves a skipped descendant PRD to the queue root only when every dependency is already satisfied by current queue state and usable artifacts.
- The queue recovery apply response returns the operations actually applied.
- The queue recovery apply response returns a per-operation status for every requested operation.
- The daemon emits or triggers the existing queue mutation notification path after at least one queue recovery operation is applied.
- Console queue summaries treat `skipped` as a known queue status.
- Console shows a recoverable cascade affordance for a failed queue item when analysis reports skipped descendants.
- Console displays queue recovery dry-run operations before enabling apply.
- Console displays daemon warnings from the analysis response without applying mutations.
- Console displays daemon blockers from the analysis response without applying mutations.
- Console reflects refreshed queue state after successful apply so restored descendants no longer appear as skipped.
- Existing display of pending, waiting, and running queue stacks remains unchanged for queues without failed or skipped cascades.
- A test covers a failed upstream plus skipped descendant plus skipped grand-descendant cascade.
- A test covers an ineligible cascade where a skipped descendant has a dependency outside the selected cascade that is failed or missing.
- A test covers apply drift where a previewed skipped descendant is no longer in `skipped/` at apply time.
- `packages/console-ui/README.md` documents the queue recovery control if the Now dashboard gains the new affordance.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0 if client API reference docs or generated docs are changed.
