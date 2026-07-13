---
title: Clear Stale Stack Parent on Queue Dependency Override
created: 2026-07-13
landing: pr
landing_auto_merge: true
---

# Clear Stale Stack Parent on Queue Dependency Override

## Problem / Motivation

The queue dependency override path removes an entry from `depends_on` but leaves `stack_parent` unchanged. When the removed dependency is also the stack parent, the PRD becomes internally inconsistent. The scheduler moves the item from waiting to pending, dequeues it, and stacked dispatch validation fails before `session:start` because the retained `stack_parent` is no longer listed in `depends_on`. The queue item is then marked failed and auto-build pauses even though no compile or build ran.

Observed example:

- Before override: `depends_on: [make-failed-queued-build-recovery-evidence-authoritative]` and matching `stack_parent`.
- After override: `depends_on: []` but the old `stack_parent` remained.
- Dispatch failed at `stacking-validation`.

## Goal

Make dependency override preserve valid stacked PRD metadata. When the dependency being removed equals `stack_parent`, clear `stack_parent` in the same queue-control mutation before the item can be moved, discovered, or dispatched.

## Approach

- Update the authoritative queue-control mutation in `packages/engine/src/queue/control.ts` and the relevant PRD frontmatter persistence helpers so removing a dependency that matches `stack_parent` atomically persists both the updated `depends_on` list and an absent `stack_parent`.
- Apply the behavior consistently to pending queue-root items and waiting items, including the claimed-root race-safe path and waiting-to-pending move.
- Preserve `stack_parent` when overriding a different dependency.
- Keep stacking validation fail-closed for independently malformed PRDs; this fix should prevent the override operation from creating that malformed state.
- Preserve queue audit/event and daemon projection behavior. If an additive client-owned response or event field is needed to report stack detachment, define it in `@eforge-build/client` rather than redeclaring a wire shape.
- Ensure the successful override still notifies the scheduler exactly once and does not introduce a claim/move race.

## Scope

### In Scope

- Queue dependency override mutation and persistence.
- Matching `stack_parent` removal.
- Pending and waiting queue locations, including waiting-to-pending movement.
- Queue control route/integration coverage and stacked dispatch regression coverage.

### Out of Scope

- General stacked-workflow redesign.
- Automatic selection of a different stack parent when multiple dependencies remain.
- Changes to compile, build, landing, or recovery semantics.
- Relaxing stacked dispatch validation for malformed PRDs.

## Acceptance Criteria

- Overriding a dependency that equals `stack_parent` removes that dependency and clears `stack_parent` in the persisted PRD.
- A waiting PRD whose final dependency is overridden moves to pending without retaining stale stack metadata.
- The resulting dependency-free PRD passes stacked dispatch validation and can start a session.
- Overriding a dependency that does not equal `stack_parent` leaves `stack_parent` unchanged.
- Pending queue-root and waiting-directory override paths have the same semantics.
- Existing race protection, queue locking/claiming, scheduler notification, and audit-event behavior remain intact.
- Focused tests reproduce the prior pre-session dispatch failure and prove it no longer occurs.
- Existing queue-control route, capability, scheduler, and stacking-validation tests pass.
- `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` exit successfully.