---
id: plan-02-engine-queue-controls
name: Engine queue hold/unhold, scheduler held gating, cascade preview/apply
  primitives, capabilities, and PRD-owned cancellation helpers.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/engine-queue-controls
---

# Engine Queue Controls

## Architecture Reference

This module implements the engine side of **Queue control integration**, **Queue hold/unhold**, **Queue cascade remove/cancel**, **Scheduler pause/resume** as it relates to scheduler gating, and **Queue item control metadata** from the architecture.

Key constraints from architecture:
- Engine helpers stay headless: they mutate queue runtime files, derive decisions, and return typed data; daemon routes own HTTP validation, local-only security, projection refreshes, and SSE events.
- Queue hold state is stored in queue PRD frontmatter under `.eforge/queue`; held pending/waiting items keep their file location and ordering metadata.
- Held PRDs are not dispatched by scheduler ticks; active builds continue until completion unless an explicit cancel operation targets them.
- Remove/cancel cascade flows are two-phase: preview first, apply only after the caller supplies the expected affected token and explicit dependent confirmation for cascading strategies.
- Default cascade apply refuses when dependents exist.
- Running cancellation by PRD id requires live queue lock evidence plus daemon-supplied run/session ownership evidence; helpers refuse without ownership and never kill arbitrary processes.
- Existing queue priority, dependency override, and non-cascade remove behavior remain source-compatible.
- New wire types used by engine results come from `@eforge-build/client` as produced by the `client-contracts` module.
- Files over 1,000 lines receive bounded exact edits only; new implementation files stay below 600 lines.

## Scope

### In Scope
- Add `held`, `hold_reason`, and `held_at` PRD frontmatter parsing/validation.
- Add engine helpers for holding and unholding pending/waiting queue items.
- Gate `QueueScheduler` and the legacy `EforgeEngine.runQueue()` scheduler path so held PRDs never launch.
- Add reusable queue snapshot helpers for queue/waiting/failed/skipped records, read-only root lock classification, dependent graph traversal, and drift-token generation.
- Add engine capability derivation primitives that produce `QueueItemCapabilities` from daemon/projected queue state.
- Add cascade preview/apply primitives for remove and cancel operations, with fail-closed defaults, drift checks, dependent confirmation, and path-safe file mutations.
- Add PRD-owned running cancellation primitives: ownership classification, cancellation request markers, and child-exit classification so an operator PRD cancel is finalized as skipped rather than failed.
- Add focused engine tests for hold/unhold, scheduler gating, capabilities, cascade preview/apply, running cancellation refusal/ownership, and compatibility with existing priority/remove/dependency override behavior.

### Out of Scope
- Client route constants, request/response interfaces, browser helpers, event schemas, and API versioning; these are owned by `client-contracts`.
- Monitor route handlers, route validation/security, DB projections, snapshot/live parity, auto-build supervisor routes, and queue mutation wakeups; these are owned by `daemon-routes-projections`.
- Console selectors, components, dialogs, disabled states, and refresh behavior; these are owned by `console-ux`.
- CLI, MCP, Pi, and Claude plugin command exposure.
- Recovery-guidance plan artifact patching.
- Arbitrary process cancellation without queue lock and daemon run/session ownership evidence.

## Implementation Approach

### Overview

Implement the engine features as focused helpers under `packages/engine/src/queue/` and keep existing large files to small integration edits. The daemon module will call these helpers and then project refreshed `QueueItem` objects with client-owned capability fields.

The implementation has six parts:

1. **Frontmatter and hold helpers** — extend `PrdFrontmatter`, then write hold/unhold helpers that claim root pending PRDs before mutation and edit waiting PRDs in place.
2. **Scheduler gating** — skip held PRDs in both `QueueScheduler.startReadyPrds()` and the legacy `runQueue()` loop before dependency checks or dequeue emission.
3. **Queue snapshot and capability primitives** — load queue records from all runtime locations, classify root locks read-only for previews/projections, compute dependents, and derive `QueueItemCapabilities` with daemon-displayable reasons.
4. **Cascade preview/apply** — return client-owned preview/apply shapes, generate opaque drift tokens, refuse target-only apply when dependents exist, and require `confirmDependents: true` for `cascade-dependents`.
5. **PRD-owned cancellation** — resolve running ownership from live locks plus daemon-supplied run/session evidence; write cancellation markers before a daemon kills an owned worker; consume the marker in the child finalizer to classify the signal as an operator cancel.
6. **Tests** — add isolated filesystem tests for helpers and scheduler tests using real queue files and existing `AsyncEventQueue`/`QueueScheduler` patterns.

### Frontmatter and Hold/Unhold

Extend `packages/engine/src/prd-queue.ts`:

- `held?: boolean`
- `hold_reason?: string`
- `held_at?: string`

No enqueue path writes these fields. They are runtime-only fields added by queue-control helpers. Existing parsing already supports booleans and strings; existing serialization supports booleans and strings.

Create `holdQueuedPrd()` and `unholdQueuedPrd()` in `packages/engine/src/queue/hold.ts`:

- Inputs: `{ cwd; queueDir; prdId; reason?; now?: () => string; __testHooks? }` for hold and `{ cwd; queueDir; prdId; __testHooks? }` for unhold.
- Validate `prdId` with the same path-segment rules used by current queue-control helpers.
- Accept only `pending` and `waiting` statuses.
- For root pending items, call `claimPrd()` before reloading and writing; release in `finally`.
- For waiting items, reload the exact file path immediately before writing.
- Hold writes `{ held: true, held_at: nowIso }` and writes `hold_reason` only when `reason` is a non-empty string after trimming.
- Reject hold reasons containing control characters/newlines or longer than 500 UTF-16 code units with `QueueControlError('validation', ...)`.
- Holding an already-held item returns `status: 'already-held'` and leaves content unchanged.
- Unholding an unheld item returns `status: 'already-unheld'` and leaves content unchanged.
- Unhold removes `held`, `hold_reason`, and `held_at` with `deleteQueuedPrdFrontmatterFieldsExistingOnly()`.
- Results include the mutated/reloaded `QueuedPrd`, queue-control status, location, and hold timestamp so daemon routes can project the updated item.

Use `QueueControlError` from `queue/control.ts` for consistent HTTP mapping in the daemon module, but do not grow `control.ts` with the new implementation.

### Scheduler Held Gating

Modify `packages/engine/src/queue/scheduler.ts` with a bounded edit in `startReadyPrds()`:

- After loading `candidateState` for each `prd`, if `candidateState.status === 'pending'` and `prd.frontmatter.held === true`, continue to the next PRD.
- The skip occurs before dependency-blocked events and before `isReady()` so held PRDs do not emit `daemon:scheduler:dequeued` and do not enter `launching`.
- Running builds already in progress remain running even if their file later gains hold frontmatter; hold helpers refuse live running items, so this is only a defensive invariant.

Modify the legacy `EforgeEngine.runQueue()` start-ready loop in `packages/engine/src/eforge.ts` with the same guard. This keeps direct CLI queue execution and daemon watch execution aligned.

### Queue Snapshot and Capability Primitives

Create `packages/engine/src/queue/snapshot.ts` with reusable internals for hold/cascade/capability helpers:

- `loadQueueControlSnapshot({ cwd, queueDir, classifyRootLocks })`
- `QueueControlSnapshot`: resolved `queueDir`, `records`, `byId`, `duplicates`, and deterministic `orderedIds`.
- `QueueControlRecord`: `id`, `title`, `location`, `status`, `dependsOn`, `filePath`, `frontmatter`, `content`, `prd`, optional `lock`, and optional `hold` projection.
- `classifyRootLocks: 'read-only' | 'mutation'`
  - read-only mode never deletes stale/corrupt lock files and marks ambiguous locks with a blocker-friendly `lock` field.
  - mutation mode may reuse existing stale-lock cleanup behavior before a claimed mutation.
- `findCascadeDependents(targetId, records)` returns transitive dependents with `depth` and deterministic ordering.
- `buildCascadeExpectedAffected(target, dependents)` returns `{ token, prdIds }` using a SHA-256 hash over id, location, status, dependsOn, file basename, held state, and lock classification.
- `assertQueueRecordStillAtExpectedPath(record)` and path helpers confine all file work under the resolved queue root.

Create `packages/engine/src/queue/capabilities.ts`:

- `deriveQueueItemCapabilities(record, snapshot, ownership?)` returns client-owned `QueueItemCapabilities`.
- `deriveQueueCapabilitiesForSnapshot(snapshot, ownershipByPrdId?)` returns a `Map<string, QueueItemCapabilities>` for daemon projections.
- Capability rules:
  - `priority`: allowed for pending/waiting, including held items; denied for running/failed/skipped.
  - `dependencyOverride`: allowed for pending/waiting with at least one `depends_on`; denied with reason when no dependency exists.
  - `hold`: allowed for unheld pending/waiting; denied for already-held, running, failed, and skipped.
  - `unhold`: allowed for held pending/waiting; denied for unheld and terminal/running items.
  - `remove`: allowed for non-running pending/waiting/failed/skipped only when no live dependents exist; denied with a reason directing operators to cascade remove when dependents exist.
  - `cascadeRemove`: allowed for non-running pending/waiting/failed/skipped; denied for running.
  - `cancel`: allowed for pending/waiting; allowed for running only when ownership is `owned: true`; denied for failed/skipped.
  - `cascadeCancel`: allowed for pending/waiting/running when every running affected item has ownership; denied for failed/skipped or missing ownership.
- Reasons are stable strings tested in engine unit tests because Console renders them directly.

### Cascade Preview

Create `packages/engine/src/queue/cascade-control.ts` and export:

- `previewQueueCascade(options: PreviewQueueCascadeOptions): Promise<QueueCascadePreviewResponse>`
- `applyQueueCascade(options: ApplyQueueCascadeOptions): Promise<QueueCascadeApplyResponse>`

`PreviewQueueCascadeOptions`:

- `cwd: string`
- `queueDir: string`
- `prdId: string`
- `operation: QueueCascadeOperation`
- `resolveRunningOwnership?: (record: QueueControlRecord) => Promise<QueueCascadeRunningOwnership> | QueueCascadeRunningOwnership`

Preview behavior:

- Validate `prdId` and `operation` before any filesystem reads that use the id.
- Load a read-only snapshot from queue, waiting, failed, and skipped locations.
- Return blockers when the target is missing, duplicated across locations, or has an unsafe id.
- Build target and dependent `QueueCascadeAffectedItem` values from snapshot records.
- Mark effects:
  - remove target: `target-remove`
  - remove dependent: `dependent-remove`
  - cancel target: `target-cancel`
  - cancel active dependent: `dependent-cancel`
  - cancel terminal/skipped dependent: `none` with warning or blocker depending on target strategy
  - blocked/refused item: `refused`
- Populate `runningOwnership` for running target/dependents from the resolver. If no resolver is supplied, running ownership is `{ owned: false, reason: 'No running ownership resolver supplied.' }`.
- Set `defaultRefusalReason` whenever dependents exist.
- Set `safeStrategies` to `['target-only']` when there are no dependents and no blockers; add `cascade-dependents` only when dependent mutation can be confirmed without unresolved running ownership blockers.
- Return `expectedAffected` from the drift helper. The token is opaque to callers.
- Preview performs no writes, no lock cleanup, no renames, no deletes, and no cancellation marker creation.

### Cascade Apply

`ApplyQueueCascadeOptions`:

- `cwd: string`
- `queueDir: string`
- `prdId: string`
- `operation: QueueCascadeOperation`
- `strategy: QueueCascadeStrategy`
- `expectedAffected: QueueCascadeExpectedAffected`
- `confirmDependents: boolean`
- `reason?: string`
- `resolveRunningOwnership?: ...`
- `cancelRunning?: (ownership: QueueCascadeRunningOwnership, record: QueueControlRecord) => Promise<{ cancelled: boolean; reason?: string }> | { cancelled: boolean; reason?: string }`
- `now?: () => string`

Apply behavior:

- Re-run preview first and compare both `expectedAffected.token` and `expectedAffected.prdIds` exactly.
- Return `applied: false` with a drift blocker when the snapshot changed.
- If dependents exist and `strategy === 'target-only'`, return `applied: false` with the preview default refusal reason before any mutation.
- If dependents exist and either `strategy !== 'cascade-dependents'` or `confirmDependents !== true`, return `applied: false` before any mutation.
- If preview has blockers, return `applied: false` before any mutation.
- Preflight every source path, target skipped path, sidecar path, and root-claim requirement before the first mutation.
- Claim all pending root-queue records that will be moved/deleted in deterministic id order; release all claims in `finally`.
- Remove operation:
  - Refuse running records.
  - Delete pending/waiting/failed/skipped markdown files; delete failed recovery sidecars for failed records.
  - Delete dependents deepest-first, then target.
- Cancel operation:
  - Pending/waiting target records move to `skipped/` with `skip_reason: cancelled by operator` or the supplied reason.
  - Pending/waiting dependent records move to `skipped/` with a reason that names the cancelled upstream.
  - Running records require `owned: true`, call `requestQueuePrdCancellation()` before `cancelRunning()`, and report the returned `sessionId`/`runId`/`pid` in the item result. The queue file is left for the child finalizer.
  - Failed records are refused for target cancel with reason `Failed queue items cannot be cancelled; use remove or recovery.`
  - Already skipped dependents produce `effect: none` and an item result with `currentStatus: 'skipped'`.
- Return target and dependent `QueueCascadeApplyItemResult` entries with previous status, result status, reason, optional `sessionId`, and `removedSidecars`.
- Do not include refreshed `queue` or `autoBuild` in engine return values; daemon routes add those projections after mutation.

### PRD-Owned Running Cancellation

Create `packages/engine/src/queue/cancellation.ts`:

- `resolveRunningPrdOwnership(options)` reads `readPrdLockStatus(prdId, cwd)` and combines it with daemon-supplied evidence:
  - `runs?: RunInfo[]`
  - `sessionIdsByPrdId?: Map<string, string>` or an array of `{ prdId; sessionId; runId? }` built by the daemon from DB events
  - optional `workerSessions?: Set<string>` for in-memory worker tracker evidence
- Ownership is `owned: true` only when a live lock exists and the helper can map the PRD id to a running run/session that the daemon can cancel.
- Ownership is `owned: false` with a clear reason when the lock is absent, stale, corrupt, has no matching running run, has no session id, or is not daemon-owned.
- `requestQueuePrdCancellation({ cwd, prdId, reason?, sessionId?, runId?, pid?, now? })` writes `.eforge/queue-cancellations/<prdId>.json` with exclusive path-segment validation.
- `consumeQueuePrdCancellation({ cwd, prdId })` reads and removes the marker; malformed markers are removed and treated as absent.
- `classifyQueueChildExit({ exitCode, signal, schedulerAborted, operatorCancellation })` is a pure function used by `EforgeEngine.spawnPrdChild()` to preserve current exit-code behavior and add the operator-cancel branch.

Modify `packages/engine/src/eforge.ts` with bounded non-overlapping edits `[region: engine-queue-controls, spawnPrdChild cancellation marker branch and runQueue held gating]`:

- Import `consumeQueuePrdCancellation` and `classifyQueueChildExit`.
- In `spawnPrdChild().finalize()`, consume an operator cancellation marker when `signal !== null` before exit classification.
- When the marker exists, classify as `status: 'skipped'` and `moveTo: 'skipped'` instead of the current unsolicited-signal failed path.
- Leave the existing scheduler-abort branch unchanged: whole-scheduler abort still leaves the PRD in queue for retry.
- Keep inline recovery invocation limited to actual failures.
- Add held gating in the legacy `runQueue()` `startReadyPrds()` loop.

Coordination note: `eforge.ts` is not listed in the shared-file registry, but the recovery-guidance module may edit resume/build paths in this same large file. Keep queue-control edits limited to imports, the child exit classification branch, and legacy runQueue held gating; do not edit continue-and-repair or recovery-guidance sections.

### Existing Queue-Control Compatibility

Leave `packages/engine/src/queue/control.ts` source-compatible:

- `updateQueuedPrdPriority()` behavior and response stay unchanged.
- `overrideQueuedPrdDependency()` behavior and response stay unchanged.
- `removeQueuedPrd()` remains the legacy fail-closed target-only remove path.
- New cascade helpers live in `cascade-control.ts`; daemon routes choose between legacy remove and new cascade apply routes.
- Reuse `QueueControlError` for new helper failures so daemon status mapping remains consistent.

### Key Decisions

1. **New queue modules instead of growing `control.ts`.** `control.ts` is near the 600-line implementation limit. New hold/cascade/capability modules keep each file under 600 lines and preserve existing behavior.
2. **Read-only snapshot classification for previews.** Preview routes must not delete stale locks or rewrite files; mutation helpers perform claims and stale-lock handling only during apply/hold/remove.
3. **Frontmatter-only hold state.** Holds do not move queue files, so queue order and dependency metadata remain unchanged.
4. **Claim before root-file mutation.** Root pending PRDs can race scheduler dispatch; hold/unhold/cascade apply claim all root pending records before writing, moving, or deleting them.
5. **Opaque drift token.** Apply compares token and affected ids from preview, allowing daemon/client to treat the token as an implementation detail.
6. **Cancellation marker for PRD cancel.** A direct SIGTERM currently looks like an unsolicited failure to the child finalizer. The marker lets PRD cancel produce a skipped queue outcome while preserving failure handling for unknown external kills.
7. **Daemon supplies ownership evidence.** Engine helpers read locks and evaluate evidence, but daemon routes supply DB/worker-session context and perform the actual worker cancellation call.
8. **Stable capability reasons.** Console depends on daemon-authored disabled reasons; engine tests lock the reason strings consumed by daemon projections.

## Files

### Create
- `packages/engine/src/queue/snapshot.ts` — queue-control snapshot loader, path safety helpers, read-only/mutation lock classification, dependent traversal, and cascade drift-token generation.
- `packages/engine/src/queue/hold.ts` — hold/unhold mutations for pending/waiting PRDs using frontmatter and root claims.
- `packages/engine/src/queue/capabilities.ts` — `QueueItemCapabilities` derivation primitives and stable disabled reasons.
- `packages/engine/src/queue/cascade-control.ts` — cascade preview/apply helpers for remove/cancel operations.
- `packages/engine/src/queue/cancellation.ts` — running ownership resolution, cancellation marker read/write/consume helpers, and pure child-exit classification.
- `test/queue-hold-controls.test.ts` — engine hold/unhold filesystem and race-safety coverage.
- `test/queue-cascade-controls.test.ts` — engine cascade preview/apply coverage across pending, waiting, failed, skipped, and running cases.
- `test/queue-capabilities.test.ts` — pure capability derivation coverage for allowed flags and disabled reasons.
- `test/queue-cancellation-ownership.test.ts` — ownership resolution, marker path safety, marker consumption, and exit classification coverage.
- `test/queue-scheduler-held.test.ts` — scheduler held gating coverage for `QueueScheduler` and, if feasible with existing harnesses, legacy `runQueue()`.

### Modify
- `packages/engine/src/prd-queue.ts` — add hold frontmatter fields to `prdFrontmatterSchema` and `PrdFrontmatter` output; use bounded exact edits because the file is over 1,000 lines.
- `packages/engine/src/queue/scheduler.ts` — skip held pending PRDs before dependency checks/dequeue emission in `startReadyPrds()`; use a bounded exact edit under the existing no-growth ceiling.
- `packages/engine/src/eforge.ts` — consume operator cancellation markers in `spawnPrdChild()` exit handling and add legacy `runQueue()` held gating `[region: engine-queue-controls, spawnPrdChild cancellation marker branch and runQueue held gating]`.
- `test/prd-frontmatter-onsuccess.test.ts` or a new focused frontmatter test file — verify held frontmatter fields validate and round-trip through `loadQueue()`.
- `test/queue-control-race-safety.test.ts` — add compatibility assertions only if new shared helpers touch existing remove/priority internals; otherwise leave existing tests unchanged.

## Testing Strategy

### Unit Tests
- Frontmatter validation accepts `held: true`, `hold_reason`, and `held_at`, and rejects malformed values through `validatePrdFrontmatter()` when Zod validation applies.
- `holdQueuedPrd()` writes exactly one `held: true`, `held_at`, and optional `hold_reason` field on a pending root item.
- `holdQueuedPrd()` writes hold fields on a waiting item without moving it.
- `holdQueuedPrd()` returns `already-held` and leaves file content byte-identical when the item is already held.
- `unholdQueuedPrd()` removes `held`, `hold_reason`, and `held_at` from pending and waiting items.
- Hold/unhold reject running, failed, skipped, unknown, and unsafe PRD ids with `QueueControlError.kind` values matching daemon status mapping.
- Root hold/unhold claim the PRD before writing and release the lock after success or failure.
- `QueueScheduler` does not call `spawnPrdChild` for held pending PRDs and emits no `daemon:scheduler:dequeued` event for them.
- A held dependency keeps its dependent unlaunched because dependency satisfaction remains false.
- Capability derivation returns every required `QueueItemCapabilities` key for pending, waiting, held, running with ownership, running without ownership, failed, and skipped records.
- Capability derivation disables legacy `remove` with a dependent-specific reason when dependents exist and enables `cascadeRemove` for non-running targets.
- Cascade preview returns target, transitive dependents, depths, effects, default refusal reason, safe strategies, blockers, warnings, and an expected affected token without changing files.
- Cascade apply with `target-only` and dependents returns `applied: false` and leaves every source file present.
- Cascade apply with `cascade-dependents` and `confirmDependents: false` returns `applied: false` and leaves every source file present.
- Cascade apply with a mismatched token returns `applied: false` and leaves every source file present.
- Cascade remove deletes pending, waiting, failed, and skipped records in deepest-first order and removes failed recovery sidecars.
- Cascade cancel moves pending/waiting records to `skipped/` with a cancellation skip reason.
- Cascade cancel refuses running records when ownership is missing and does not invoke the cancel delegate.
- Cascade cancel writes a cancellation marker and invokes the cancel delegate when ownership is present.
- `resolveRunningPrdOwnership()` returns `owned: false` with distinct reasons for absent, stale, corrupt, missing run, missing session, and unowned session cases.
- `classifyQueueChildExit()` maps operator cancellation markers to skipped/skipped-move, maps scheduler abort to skipped/no-move, and preserves current failed/completed/skipped/already-claimed mappings.
- Existing `updateQueuedPrdPriority()`, `overrideQueuedPrdDependency()`, and `removeQueuedPrd()` tests continue to pass without response-shape changes.

### Integration Tests
- Use the existing real-filesystem scheduler harness to verify that a held PRD stays in the queue while an unheld sibling dispatches.
- Use real queue directories to verify cascade remove/cancel across mixed pending, waiting, failed, skipped, and running fixtures.
- Use real lock files with the current process pid and daemon-style `RunInfo` evidence to verify running ownership and cancellation-marker flow.
- Do not add daemon HTTP route tests in this module; the daemon module owns route validation/security and projection refresh tests.

## Verification

- [ ] `PrdFrontmatter` includes `held`, `hold_reason`, and `held_at` fields.
- [ ] `loadQueue()` returns held frontmatter values for PRDs containing hold fields.
- [ ] Holding a pending root PRD writes hold fields and leaves the file in the queue root.
- [ ] Holding a waiting PRD writes hold fields and leaves the file in `waiting/`.
- [ ] Unholding pending and waiting PRDs removes all hold fields.
- [ ] Repeating hold on an already-held item returns `already-held` and produces identical file bytes.
- [ ] Repeating unhold on an unheld item returns `already-unheld` and produces identical file bytes.
- [ ] Hold/unhold reject running items with `QueueControlError.kind === 'conflict'`.
- [ ] Hold/unhold reject failed and skipped items with `QueueControlError.kind === 'conflict'`.
- [ ] Hold/unhold reject unsafe ids with `QueueControlError.kind === 'validation'`.
- [ ] `QueueScheduler` launches zero held PRDs in a scheduler tick.
- [ ] `QueueScheduler` emits no `daemon:scheduler:dequeued` event for a held PRD.
- [ ] Legacy `EforgeEngine.runQueue()` launches zero held PRDs in a queue cycle.
- [ ] A held PRD keeps its queue order fields and path unchanged.
- [ ] Capability derivation returns all required keys: `priority`, `remove`, `dependencyOverride`, `hold`, `unhold`, `cascadeRemove`, `cancel`, and `cascadeCancel`.
- [ ] Capability derivation disables invalid actions with non-empty reasons.
- [ ] Cascade preview performs no file writes, deletes, renames, lock removals, or cancellation marker writes.
- [ ] Cascade preview returns a non-empty `expectedAffected.token` and the complete affected PRD id list.
- [ ] Cascade apply with dependents and `target-only` returns `applied: false` before mutation.
- [ ] Cascade apply with dependents and `confirmDependents: false` returns `applied: false` before mutation.
- [ ] Cascade apply with a drifted `expectedAffected` token returns `applied: false` before mutation.
- [ ] Cascade remove deletes target and confirmed dependents for pending, waiting, failed, and skipped fixtures.
- [ ] Cascade remove deletes failed recovery sidecars for removed failed fixtures.
- [ ] Cascade cancel moves pending and waiting target/dependent fixtures to `skipped/`.
- [ ] Cascade cancel refuses running fixtures without ownership and returns a reason containing the PRD id.
- [ ] Cascade cancel with ownership writes a cancellation marker before invoking the cancel delegate.
- [ ] Operator cancellation markers are consumed exactly once by the child finalizer helper.
- [ ] Operator cancellation exit classification returns skipped status and skipped move target.
- [ ] Existing priority, remove, and dependency override tests pass without response changes.
- [ ] New implementation files are each 600 lines or fewer.
- [ ] Edited legacy oversized files remain at or below their `noGrowthCeiling` values.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
