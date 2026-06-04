---
id: plan-01-durable-recovery-applied-state
name: Durable Recovery Applied State and Split Idempotency
branch: fix-recovery-actions-ux-after-successor-enqueue-or-resume/plan-01-durable-recovery-applied-state
agents:
  builder:
    effort: high
    rationale: This plan changes client-owned wire shapes, engine filesystem
      mutation semantics, daemon projection, and recovery tests in one
      dependency layer.
  reviewer:
    effort: high
    rationale: The review must verify idempotency, additive API compatibility, and
      daemon/client wire-shape ownership.
---

# Durable Recovery Applied State and Split Idempotency

## Architecture Context

Recovery sidecars under `.eforge/queue/failed/` are retained as audit artifacts. The missing durable `applied` state is the root cause for repeated split applies and repeated Console prompts. This plan establishes the shared applied-state contract first, because later accept-success and Console work must consume the same client-owned metadata rather than inventing local shapes.

Client-owned daemon wire shapes live in `@eforge-build/client`; monitor and Console code must import those shapes. The engine owns filesystem mutations and sidecar writes. Queue state remains filesystem-only and gitignored.

## Implementation

### Overview

Add optional applied metadata to recovery sidecars and queue-item projections, make split recovery apply idempotent, and preserve the applied marker when the daemon reads sidecars. A repeated split apply must return the original successor id rather than enqueueing a `-2` successor.

### Key Decisions

1. Store durable applied state in `<prdId>.recovery.json` as an optional `applied` object. The sidecar is already retained as the audit anchor, so it is the least invasive idempotency store.
2. Represent applied state in queue projections as a separate `QueueItem.recoveryApplied` field while preserving `QueueItem.recoveryVerdict` for verdict/confidence summaries.
3. Close the split crash window by scanning live queue locations for an existing successor with `recovery_from: <prdId>` before enqueueing a new successor when no marker exists.
4. Bump `DAEMON_API_VERSION` for the applied sidecar/queue wire contract that first-party Console will rely on.

## Scope

### In Scope

- Optional client-owned `RecoveryAppliedMetadata`/sidecar applied types.
- Optional `ApplyRecoveryResponse.status` and `detail` fields.
- Optional `QueueItem.recoveryApplied` and matching `DaemonStreamSnapshot` queue-item schema support.
- Engine helper functions to read and atomically write recovery sidecar applied metadata.
- Split apply idempotency via applied marker and live successor scan.
- Monitor sidecar read/projection paths preserving applied metadata.
- Recovery apply/projection/schema tests for split idempotency and applied metadata.

### Out of Scope

- Console rendering changes; plan-03 consumes the metadata.
- Accepted-success recovery; plan-02 adds that action.
- Removing failed PRDs or sidecars after split.
- Changing retry, abandon, manual, or compiled-resume semantics beyond additive response typing.

## Files

### Create

- `packages/engine/src/recovery/applied-sidecar.ts` — shared engine helpers for reading, validating, and atomically writing optional recovery sidecar `applied` metadata.

### Modify

- `packages/client/src/routes/recovery.ts` — add `RecoveryAppliedMetadata`, split applied fields, accepted-success-compatible applied fields reserved for plan-02, and `ApplyRecoveryResponse.status?: 'applied' | 'already-applied'` plus `detail?: string`.
- `packages/client/src/routes.ts` — re-export the new recovery applied metadata types.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — export the new client-owned types.
- `packages/client/src/types.ts` — add optional `QueueItem.recoveryApplied?: RecoveryAppliedMetadata` without redeclaring monitor-owned shapes.
- `packages/client/src/events.schemas.ts` — add a TypeBox schema for queue-item `recoveryApplied` in `DaemonQueueItemSchema`; use bounded edits because this file is oversized.
- `packages/client/src/api-version-const.ts` — bump the daemon API version and document the applied recovery metadata contract.
- `packages/engine/src/schemas.ts` — add optional `status`/`detail` to `ApplyRecoveryResult`.
- `packages/engine/src/recovery/apply.ts` — check an existing split marker, scan queue root/waiting for a successor whose recovery continuation points at the failed PRD, write the split applied marker after enqueue, and return `status`.
- `packages/engine/src/eforge.ts` — propagate split `status`/`detail` from `applyRecoverySplit()` into the `ApplyRecoveryResult` returned by `EforgeEngine.applyRecovery()`.
- `packages/monitor/src/routes/recovery-sidecar-service.ts` — parse and return optional sidecar `applied` metadata; do not strip unknown valid applied fields.
- `packages/monitor/src/projections/queue-items.ts` — project `recoveryApplied` alongside `recoveryVerdict` for failed queue rows with parseable sidecars.
- `packages/monitor/src/__tests__/projections-queue-items.test.ts` — assert sync/async projection parity for applied metadata.
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — add an applied sidecar queue item to the stream snapshot parity fixture if needed after the schema change.
- `packages/client/src/__tests__/events-schemas.test.ts` or the nearest daemon snapshot schema test — assert `safeParseDaemonStreamSnapshot` accepts a queue item with `recoveryApplied`.
- `test/apply-recovery.test.ts` — add split idempotency tests for direct engine apply, marker write/read, and crash-window successor scan.
- `test/apply-recovery-route.test.ts` — add route-level assertions that repeated split apply returns `status: 'already-applied'` and the same `successorPrdId`.
- `packages/monitor/src/__tests__/routes-recovery.test.ts` — assert `readRecoverySidecar()` returns `json.applied` when present.

## Implementation Notes

- The `applied` object must include at least `action`, `appliedAt`, and for split `successorPrdId`. Use ISO timestamps.
- `applyRecoverySplit()` must return `status: 'applied'` on the first successful enqueue and `status: 'already-applied'` when an applied marker or live successor scan finds prior application.
- The live successor scan must inspect `.eforge/queue/` and `.eforge/queue/waiting/`; running PRDs remain represented by queue-root files with locks.
- The split scan must use `getRecoveryContinuationFrontmatter()` or equivalent parsed frontmatter; do not infer from slug text.
- Sidecar writes must preserve existing `schemaVersion`, `generatedAt`, `summary`, `verdict`, and unrelated fields.
- Invalid optional applied metadata in a sidecar may be ignored for queue projection, but `readRecoverySidecar()` must not crash on legacy sidecars without the field.

## Verification

- [ ] `pnpm test -- apply-recovery` returns 0 and includes a test where two split applies create exactly one successor PRD file.
- [ ] The second split apply response contains `status: 'already-applied'` and the same `successorPrdId` as the first response.
- [ ] A split sidecar read after first apply returns `json.applied.action === 'split'`, a non-empty `json.applied.appliedAt`, and `json.applied.successorPrdId`.
- [ ] A crash-window fixture with a live successor carrying `recovery_from: <prdId>` but no marker writes the marker and does not enqueue another successor.
- [ ] `loadQueueItems()` and `loadQueueItemsSync()` return the same `recoveryApplied` value for a failed queue row with applied sidecar metadata.
- [ ] `safeParseDaemonStreamSnapshot()` accepts a queue item with `recoveryApplied`.
- [ ] `pnpm type-check` exits 0.
