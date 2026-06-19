# Improve Recovery, Failed-Enqueue, and Queue Control UX — Architecture

## Vision and Goals

This expedition closes the remaining operator recovery/control gaps while preserving existing eforge boundaries:

- Recovery sidecars remain the durable source of failure evidence, and a new explicit prepare/apply path patches only the failed root plan artifacts with idempotent `## Recovery Guidance` before compiled-artifact resume.
- Failed enqueue attempts become durable Now-dashboard attention items with source labels, failure reasons, timestamps, and a confirmed re-enqueue path when the daemon can reconstruct the source.
- Queue controls gain per-item hold/unhold, scheduler pause/resume, cascade preview/apply for remove/cancel, PRD-id cancellation for owned running workers, and daemon-owned capability metadata so Console renders safe controls without reimplementing scheduler rules.
- All HTTP routes, wire types, event/snapshot schema changes, browser helpers, and response types originate in `@eforge-build/client`.

## Current-State Delta

Already present:

- Recovery sidecars contain bounded evidence, root failing plan fields, multi-root `failingPlans`, continue-and-repair eligibility, and applied metadata.
- Continue-and-repair and queue recovery routes exist, with read-only eligibility/analyze routes and mutating apply routes.
- Queue priority, removal, and dependency override helpers/routes/UI exist.
- `QueueScheduler` already has internal `pause()` / `resume()` behavior and `AutoBuildSupervisor` already tracks paused scheduler state.
- Failed enqueue runs are recorded in `runs` and `events`, and failed enqueue-only sessions are included in Build history.

Gaps to fill:

- No helper patches compiled plan markdown with recovery guidance before resume.
- No durable failed-enqueue attention projection or one-click re-enqueue route/UX.
- No queue hold/unhold state, no scheduler pause/resume HTTP route/UI, no cascade preview/apply for remove/cancel, no PRD-id cancel route semantics, and no per-item queue capability metadata.

## Core Architectural Principles

1. **Client-owned contracts.** Add every route constant, request/response type, event variant, snapshot field, browser helper, and API helper in `packages/client/src`. Console/monitor must import these; no inline `/api/...` strings or local wire interfaces.
2. **Read-only stays read-only.** Existing recovery sidecar, continue-repair eligibility, and queue recovery analyze routes remain mutation-free. New mutation happens only through explicit prepare/apply routes.
3. **Root-only recovery guidance.** Sidecar `boundedEvidence.failingPlans` (fallback `failingPlan`) selects exact root failed plan ids. Do not patch blocked/skipped downstream dependents.
4. **Idempotent plan artifact mutation.** Patch one canonical `## Recovery Guidance` section using a stable heading/marker; unchanged guidance returns `already-current` and does not rewrite files or commit.
5. **Git helper discipline.** Any tracked plan artifact guidance change commits through `forgeCommit()` with path-limited staging. Do not use raw `git commit` outside `git.ts`.
6. **Scheduler safety.** Hold state and scheduler pause both prevent new launches without killing active builds. Queue mutations use root-queue claims plus drift preflight instead of optimistic filesystem edits.
7. **Two-phase destructive flows.** Remove/cancel cascade operations preview affected dependents first. Default apply refuses when dependents exist; dependent mutation requires explicit confirmed cascade strategy.
8. **Projection parity.** REST `/api/queue`, stream hello `queue`, REST `/api/runs`/failed-enqueue route, and live daemon events use the same projection helpers so snapshot/live drift becomes a test failure.
9. **Console renders, daemon decides.** Queue item capability metadata includes allowed/disabled reasons. Console disables or hides controls using daemon reasons and never duplicates scheduler rules.
10. **Console-only exposure unless deliberately expanded.** This architecture exposes the new controls in Console. If a later module chooses to add CLI/MCP/Pi/Claude commands, it must update both integration packages and bump only the Claude plugin version.

## Shared Data Model

### Recovery guidance

Add focused client-owned route types, for example:

- `RecoveryGuidancePrepareRequest`: `{ prdId: string; setName?: string }`
- `RecoveryGuidancePatchStatus`: `'patched' | 'already-current' | 'artifact-missing' | 'blocked'`
- `RecoveryGuidancePatchedPlan`: `{ planId; path; status; reason? }`
- `RecoveryGuidancePrepareResponse`: includes `prdId`, resolved `setName`, `featureBranch`, `baseBranch`, `outputDir`, `sidecarPath`, `sidecarGeneratedAt`, patched plan results, and optional `commitSha`.

Guidance content must include:

- failure summary / root failure
- recommended action
- remaining work
- retry/continue-and-repair guidance
- sidecar timestamp
- source sidecar identity/path

### Queue item control metadata

Extend `QueueItem` and snapshot queue item schema with client-owned optional fields:

- `hold?: { held: boolean; reason?: string; heldAt?: string }`
- `capabilities: QueueItemCapabilities`

`QueueItemCapabilities` should cover at least:

- `priority`
- `remove`
- `hold`
- `unhold`
- `cascadeRemove`
- `cancel`
- `cascadeCancel`

Each capability uses `{ allowed: boolean; reason?: string }`. Reasons are daemon-authored and displayed by Console for disabled controls.

### Queue control route responses

Every new route must have an explicit client-owned response type; queue mutation routes must not return status-only payloads because Console depends on daemon-authored capabilities after each mutation.

- `QueueHoldRequest`: `{ reason?: string }`; `QueueHoldResponse`: `{ status: 'held' | 'already-held'; item: QueueItem; queue?: QueueItem[]; autoBuild?: AutoBuildState }`.
- `QueueUnholdRequest`: `{}`; `QueueUnholdResponse`: `{ status: 'unheld' | 'already-unheld'; item: QueueItem; queue?: QueueItem[]; autoBuild?: AutoBuildState }`.
- `QueueCascadeApplyResponse`: includes `applied`, target result, dependent results, warnings/blockers, and either a refreshed projected `queue: QueueItem[]` or updated surviving `QueueItem` entries. Any returned item includes recomputed `capabilities`.
- `FailedEnqueueReenqueueResponse`: `{ enqueued: boolean; failedEnqueue: FailedEnqueueInfo; queue: QueueItem[]; runs: RunInfo[]; newRunId?: string; disabledReason?: string; nextCommand?: string }`. When source data is unavailable, `enqueued` is `false`, `disabledReason`/`nextCommand` are populated, and queue/run projections reflect current state.

### Queue hold/unhold

Use queue PRD frontmatter as runtime state:

- `held: true`
- `hold_reason?: string`
- `held_at?: string`

Pending/waiting held items keep their file location and ordering metadata. Scheduler skips held root-queue PRDs; waiting held PRDs remain waiting until unheld and dependencies clear.

### Queue cascade remove/cancel

Client-owned model:

- `QueueCascadeOperation`: `'remove' | 'cancel'`
- `QueueCascadeStrategy`: `'target-only' | 'cascade-dependents'`
- `QueueCascadePreviewRequest`: `{ operation }`
- `QueueCascadeAffectedItem`: `prdId`, `title`, `status`, `location`, `dependsOn`, `depth`, `runningOwnership?`, `effect`, `blockers[]`
- `QueueCascadePreviewResponse`: target, dependents, default refusal reason when applicable, safe strategies, warnings, `expectedAffected` drift token/summary.
- `QueueCascadeApplyRequest`: operation, strategy, expected affected summary, `confirmDependents: boolean`.
- `QueueCascadeApplyResponse`: applied flag, target result, dependent results, warnings/blockers.

Default apply with dependents present must return a conflict/refusal. `cascade-dependents` with `confirmDependents: true` is required before any dependent file/session mutation.

### Failed enqueue

Add a durable client-owned projection type:

- `FailedEnqueueInfo`: `runId`, `sessionId?`, `sourceLabel`, `source?`, `failureReason`, `failedAt`, `canReenqueue`, `disabledReason?`, `nextCommand`, `resolvedAt?`.

Expose it through:

- stream hello `failedEnqueues: FailedEnqueueInfo[]`
- GET `/api/enqueue/failed`
- live daemon events such as `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved` (or an equivalent client-owned projection event) so snapshot/live dedupe is keyed by `runId`.

### Scheduler pause/resume

Add routes returning `AutoBuildState`:

- `POST /api/scheduler/pause`
- `POST /api/scheduler/resume`

Pause leaves `desired: 'enabled'`, sets mode/scheduler paused, and prevents `notifyQueueMutation()` from launching new work while paused. Resume clears paused state and kicks discovery.

## Integration Contracts

### Dependency graph

The intended module dependency graph is acyclic:

1. `client-contracts` owns shared wire contracts and is consumed by all other implementation modules.
2. `engine-recovery-guidance` and `engine-queue-controls` own headless helpers and do not depend on daemon or Console code.
3. `daemon-routes-projections` consumes client contracts plus engine helpers and produces daemon routes, projections, and live/snapshot events.
4. `console-ux` consumes client contracts and daemon projections only.
5. `docs-validation` documents the final client/Console surface and does not feed implementation modules.

### Route additions in `@eforge-build/client`

Add constants, request/response types, browser helpers, and node helpers for these routes (exact names may vary but must be client-owned):

- `recoveryGuidancePrepare`: `POST /api/recover/guidance/prepare`
- `queueHold`: `POST /api/queue/:prdId/hold`
- `queueUnhold`: `POST /api/queue/:prdId/unhold`
- `queueCascadePreview`: `POST /api/queue/:prdId/cascade/preview`
- `queueCascadeApply`: `POST /api/queue/:prdId/cascade/apply`
- `failedEnqueues`: `GET /api/enqueue/failed`
- `failedEnqueueReenqueue`: `POST /api/enqueue/failed/:runId/reenqueue`
- `schedulerPause`: `POST /api/scheduler/pause`
- `schedulerResume`: `POST /api/scheduler/resume`

Evaluate `DAEMON_API_VERSION` using the existing compatibility policy. These changes are intended to be additive; keep new fields optional/backward-compatible and bump only if an existing route, snapshot, or version-negotiation contract becomes incompatible or requires an explicit minimum-version gate.

### Monitor route/security contract

- Mutating endpoints use `localMutation(...)` and validate all route params/body fields.
- Read endpoints use `localOnly(...)` plus `rejectCrossSiteBrowser(...)`.
- Every mutating endpoint gets focused security/validation tests.
- Queue mutation routes call `context.notifyQueueMutation('external')` only after successful queue state mutation, except scheduler pause remains paused and must not wake dispatch.

### Recovery guidance integration

- Producer: `engine-recovery-guidance` reads `.eforge/queue/failed/<prdId>.recovery.json` through existing sidecar parsing/projection, renders guidance, patches root plan artifacts, and returns `RecoveryGuidancePrepareResponse` data.
- Consumer: `daemon-routes-projections` exposes the prepare route and forwards the helper result using client-owned types; continue/retry callers use the same helper before compiled-artifact resume.
- Helper resolves set name, root failed plan ids, feature/base branches, and output dir with existing config/resume metadata validators.
- Helper resolves or materializes plan artifacts on the feature branch/merge worktree before patching.
- Continue-and-repair preparation invokes the helper before queuing/resuming compiled artifacts.
- `EforgeEngine.resumeBuild()` defensively invokes/requires guidance before reading compiled plan files, so non-Console callers get the same behavior.
- Read-only recovery analysis and eligibility routes do not patch files.

### Queue control integration

- Producer: `engine-queue-controls` owns held-frontmatter mutation, scheduler gating, cascade preview/apply decisions, running-cancel ownership checks, and capability derivation primitives.
- Producer/adapter: `daemon-routes-projections` adapts those helpers to client-owned `QueueItem`, `QueueItemCapabilities`, and route response types; it recomputes capabilities after each queue mutation before responding or emitting snapshots/events.
- Consumer: `console-ux` renders held state, disabled actions, cascade previews, and confirmations from daemon-authored capabilities and route responses only.
- Add hold fields to `PrdFrontmatter` parsing/serialization.
- `QueueScheduler.startReadyPrds()` treats held root-queue PRDs as not dispatchable and emits no dequeue for them.
- `AutoBuildSupervisor.notifyQueueMutation()` must not transition paused scheduler state to starting/running.
- Running cancellation by PRD id uses live lock PID plus monitor-owned run/session evidence; if no owned session/worker is found, return refusal with a clear reason instead of killing arbitrary processes.

### Failed enqueue integration

- Producer: recorder/projection code captures enqueue source/failure context durably, including legacy fallback for older runs with only `enqueue:start`/`enqueue:failed` events, and emits `FailedEnqueueInfo` projection updates keyed by `runId`.
- Consumer: Console stores `FailedEnqueueInfo` from stream hello, live events, and `GET /api/enqueue/failed`, dedupes by `runId`, and renders an `Enqueue failed` attention row distinct from failed-build recovery rows.
- Re-enqueue route reconstructs a safe `EnqueueRequest` only when source data exists. If unavailable, it returns disabled metadata/clear next command rather than guessing.
- A successful re-enqueue action returns refreshed queue/run projections in `FailedEnqueueReenqueueResponse`; Console may also refetch queue and runs after the mutation to preserve existing refresh behavior.

## Shared / High-Risk File Registry

These files are high coordination points. Module planners should respect the owner column and avoid cross-module edits unless they add explicit non-overlapping region markers in their module plans.

| File | Owner Module | Region Strategy |
|------|--------------|-----------------|
| `packages/client/src/routes/route-map.ts` | `client-contracts` | Single route-addition block for all new routes; dependent modules consume constants only. |
| `packages/client/src/routes.ts` | `client-contracts` | Single export block for all new queue/recovery/failed-enqueue contracts. |
| `packages/client/src/types.ts` | `client-contracts` | QueueItem/RunInfo/AutoBuild/failed-enqueue type additions only here. |
| `packages/client/src/events/snapshots.ts` | `client-contracts` | Snapshot schema additions for queue capabilities and failed enqueue projection. |
| `packages/client/src/event-registry.ts` | `client-contracts` | New daemon event registry entries/projectors for failed enqueue and scheduler/queue state. |
| `packages/client/src/index.ts` / `packages/client/src/browser.ts` | `client-contracts` | Export new helpers/types in one consolidated section. |
| `packages/monitor/src/routes/control-monitor.ts` | `daemon-routes-projections` | Add all new monitor route keys in a single block. |
| `packages/monitor/src/routes/index.ts` | `daemon-routes-projections` | Register new route factory imports in one block. |
| `packages/monitor/src/routes/monitor-data.ts` | `daemon-routes-projections` | Use shared projections for queue/runs/failed enqueue; no local wire shapes. |
| `packages/monitor/src/streams/daemon-stream.ts` | `daemon-routes-projections` | Snapshot construction must call the same projection helpers as REST routes. |
| `packages/console-ui/src/lib/project-state.ts` | `console-ux` | Add failed enqueue / refresh state and event projection consumption in one reducer region. |
| `packages/console-ui/src/lib/selectors/now.ts` | `console-ux` | Add failed-enqueue attention and queue capability view model fields in focused selector regions. |
| `packages/console-ui/README.md` | `docs-validation` | Document final user-facing Console data flow after implementation. |

No file is intentionally edited by multiple modules in this architecture. If a downstream module discovers it must edit a file owned by another module, it must declare a temporary `// --- eforge:region plan-NN-... ---` region in its module plan and keep the edit non-overlapping.

## Technical Decisions

1. **Use a dedicated failed-enqueue projection instead of recent activity.** Recent activity is capped and transient; durable attention needs DB-backed runs/events and a snapshot field.
2. **Use queue frontmatter for hold state.** Queue runtime files are already the durable queue source under `.eforge/queue`; frontmatter preserves order and avoids a new DB migration.
3. **Keep scheduler pause separate from disabling auto-build.** Disable changes desired state and watcher lifecycle; pause leaves desired enabled and only gates new launches.
4. **Use capability metadata as the UI contract.** Console receives daemon-authored allowed/reason values and does not infer queue-control validity from statuses.
5. **Use two-phase cascade APIs rather than extending DELETE.** Preview/apply requests make destructive dependent changes auditable and prevent accidental cascade removal/cancellation.
6. **Keep new controls Console-only.** The source explicitly calls out CLI/MCP/Pi/Claude only if intentionally exposed. This architecture avoids integration command churn; if later exposed, both consumer integrations must be updated together.

## Quality Attributes

- **Safety:** fail-closed cascade defaults; path-segment validation; queue root confinement checks; running cancellation requires ownership evidence.
- **Idempotency:** recovery guidance no-op status; no duplicate `## Recovery Guidance`; failed-enqueue dedupe by run id; hold/unhold no-op statuses when already held/unheld if implemented.
- **Parity:** REST and stream snapshots share projection helpers for queue, failed enqueue, runs, session metadata, and auto-build.
- **Compatibility:** existing priority/remove/dependency override behavior and current recovery routes remain compatible; new fields are additive and optional unless the existing compatibility policy requires a minimum-version gate.
- **Maintainability:** keep new helpers focused and under file-size limits; add durable semantic regions only in large files that already require them.

## Module Guidance

### `client-contracts`

Owns all route constants, request/response types, browser/node helpers, event/schema additions, snapshot fields, capability types, failed-enqueue types, and any required API-version/min-version metadata. Also adds focused client contract tests.

### `engine-recovery-guidance`

Adds recovery guidance rendering/patching helpers and wires them into continue-and-repair/resume preparation. Tests cover sidecar parsing, safe path resolution, root-only targeting, idempotency, no-op status, and forgeCommit behavior.

### `engine-queue-controls`

Adds hold/unhold helpers, held frontmatter parsing, scheduler dispatch gating, cascade preview/apply helpers, capability derivation primitives, and running-cancel ownership primitives. Tests cover pending/waiting hold, scheduler held skip, cascade cases across pending/waiting/failed/skipped/running, and existing priority/remove/dependency compatibility.

### `daemon-routes-projections`

Implements monitor routes/projections/recorder changes using client contracts and engine helpers: recovery guidance route, failed-enqueue route/re-enqueue, scheduler pause/resume, hold/unhold, cascade preview/apply, cancel by PRD id, queue capability projection, and snapshot/live parity. Tests cover validation, security, projection parity, failed enqueue durability, and queue mutation wakeups.

### `console-ux`

Updates Now dashboard selectors/components/hooks to render failed enqueue rows, Re-enqueue confirmations, disabled fallback text/commands, held queue rows, capability-driven disabled actions/reasons, scheduler pause/resume controls, cascade preview dialogs, and refresh-after-mutation behavior. Tests cover selectors, components, confirmations, disabled reasons, refreshes, pause/resume status, held rows, and cascade previews.

### `docs-validation`

Updates Console/client docs and any generated/reference docs needed for new first-party routes. Confirms no CLI/MCP/Pi/Claude docs changed unless a module deliberately exposes commands outside Console.

## Validation

Final merged validation must run:

1. `pnpm type-check`
2. `pnpm test`
3. `pnpm maintainability:check`
