---
title: Orphaned queued-build adoption
created: 2026-07-01
depends_on: ["bounded-recovery-auto-resume-policy"]
stack_parent: bounded-recovery-auto-resume-policy
---

# Orphaned queued-build adoption

## Executive Summary

Fix daemon queue recovery so a restarted daemon adopts live queue-lock-owned PRD builds and finalizes them exactly once. The work should touch monitor startup/adoption, engine queued-PRD finalization, scheduler/daemon completion reactions, queue projection/capabilities, and focused regression tests. The intended direction is to factor normal child-exit cleanup into idempotent shared finalization, register or monitor surviving lock PIDs after restart, use persisted queue completion events as safe wake/finalization signals, and classify stale/corrupt/absent locks honestly instead of displaying them as active. Out of scope: redesigning queue scheduling, changing retry policy, broad Console UX beyond actionable cancellation/status diagnostics, or rerunning completed orphan builds. Confidence is medium-high because the source audit points to narrow gaps; build confidence should come from restart/adoption integration tests plus targeted projection/cancellation tests, `pnpm type-check`, and `pnpm test`.

## Problem Statement

Queued PRD builds can survive daemon shutdown or crash because the daemon intentionally aborts its watcher while leaving in-flight subprocesses to drain. After restart, the daemon can see the surviving queue lock and may mark the PRD as running, but it does not inherit the original parent process's child-exit finalization responsibilities. The result can be a root queue PRD and lock that remain stuck, a completed PRD that is later redispatched, failed PRDs without normal failed/ sidecars, dependents that are never unblocked or skipped, and queue projections that report stale/corrupt locks as active running work.

## Reproduction Steps

1. Create a queue with a long-running root PRD and at least one dependent PRD waiting on its artifact.
2. Start daemon auto-build and wait until the root PRD has a live `.eforge/queue-locks/<prd>.lock` and a child build process.
3. Stop or hard-kill only the daemon/watcher while the child build continues.
4. Restart the daemon while the child is still alive; observe that the scheduler treats the live lock as running.
5. Let the child complete successfully. Current behavior can leave the root PRD/lock unreconciled, fail to record normal scheduler completion effects, fail to unblock/launch the dependent, or allow a later mutation tick to redispatch the completed PRD.
6. Repeat with the child exiting non-zero; current behavior can leave the PRD displayed as running or pending without normal failed/ movement and recovery sidecars.
7. Create a root queue PRD with a stale or corrupt lock; current projection paths that check only lock existence can display it as running even when no live worker exists.

## Root Cause

The normal queued-build cleanup path is tied to the original parent process's `child.on('exit')` handler around `spawnPrdChild`, where locks are released and root queue PRDs are cleaned up, moved to failed/skipped, or given recovery sidecars. Startup reconciliation removes dead DB runs and dead/corrupt locks, while scheduler reconciliation promotes live locks to in-memory running state, but no durable adoption monitor is registered for live previous-generation locks. Separately, scheduler completion handling is driven by in-process `queue:prd:complete` bus events, while persisted daemon-stream reactions currently do not turn orphan completion events into finalization/scheduler wakeups. Queue projection compounds this by treating lock-file existence as running instead of classifying live, stale, corrupt, and absent locks.

## Acceptance Criteria

- On daemon startup, live queue-lock PIDs left by previous daemon generations are registered as adopted workers or monitored until they terminate.
- Normal queued child cleanup and adopted-worker cleanup share an idempotent finalizer; a PRD cannot be finalized twice even if both a persisted completion event and PID polling race.
- Adopted successful builds release their queue lock, remove the root queue PRD, preserve/update artifact and completion state, unblock waiting dependents, and allow eligible dependents to launch without rerunning the completed PRD.
- Adopted failed builds release their lock, move the PRD to failed/ when appropriate, write normal recovery sidecars or degraded recovery evidence, and propagate dependent skips consistently with normal queued-build failure handling.
- Dead, stale, corrupt, and absent locks are reconciled so queue items do not remain indefinitely displayed as running.
- Persisted orphan `queue:prd:complete` events safely wake/finalize adoption and scheduler completion handling without duplicate dispatch before cleanup completes.
- Cancellation for adopted orphan builds either sends a signal to a verified adopted PID or reports why ownership could not be verified and how to recover.
- Regression tests cover surviving child success after daemon restart, surviving child failure after daemon restart, dependent unblocking after adopted success, stale/corrupt lock projection, no duplicate dispatch after orphan completion, and cancellation/reconciliation behavior.

## Assumptions And Validation

Implementation should start by extracting shared idempotent queued-PRD finalization primitives from `packages/engine/src/eforge.ts` into a focused engine queue module, then wire daemon adoption in `packages/monitor/src/server-main.ts` or a small adjacent module, persisted `queue:prd:complete` reactions in `packages/monitor/src/daemon-event-reactions.ts`, lock classification in `packages/monitor/src/projections/queue-items.ts`, and verified adopted-PID cancellation in the queue-control path. If user-visible lock diagnostics require new fields, define them in `packages/client/` and consume them elsewhere.

Validation should use temp project queues and short real child processes where practical so restart/PID behavior is exercised through real code paths. Add unit coverage for pure finalizer idempotency and lock classification, integration-style coverage for daemon restart adoption and persisted completion reactions, and route/projection tests for cancellation/status diagnostics. Run targeted suites first, then `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`. Confirm no daemon route literals or queue wire shapes are redefined outside `@eforge-build/client`, and confirm the engine still emits events rather than writing directly to stdout.

Key risks to validate: a restarted daemon cannot reliably wait on arbitrary non-child processes, PID reuse could make a stale lock look live, normal parent cleanup and adopter cleanup can race, recovery analysis may be expensive during startup, and any queue wire-shape changes can drift across daemon/client/Console consumers.