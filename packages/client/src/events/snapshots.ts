import { Type, type Static } from '@sinclair/typebox';
import { EforgeEventSchema } from './root.js';
import {
  AutoBuildDetailFields,
  FailedEnqueueInfoSchema,
  QueueItemCapabilitiesSchema,
  QueueItemHoldSchema,
  StackLayerWireSchema,
} from './shared/schemas.js';

export const DaemonStreamLivenessSchema = Type.Object({
  type: Type.Literal('daemon:heartbeat'),
  timestamp: Type.String(),
  uptime: Type.Number(),
  queueDepth: Type.Number(),
  runningBuilds: Type.Number(),
  autoBuild: Type.Object({
    enabled: Type.Boolean(),
    paused: Type.Boolean(),
    ...AutoBuildDetailFields,
  }),
  subscribers: Type.Number(),
});

/** Shape of a single item in `DaemonStreamSnapshot.recentActivity`. */
export const DaemonRecentActivityItemSchema = Type.Object({
  id: Type.Number(),
  event: EforgeEventSchema,
});

/** Shape of a run record as returned by `GET /api/runs`. */
export const DaemonRunRecordSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.Optional(Type.String()),
  planSet: Type.String(),
  command: Type.String(),
  status: Type.String(),
  startedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
  cwd: Type.String(),
  pid: Type.Optional(Type.Number()),
});

/** Shape of a single queue item as returned by `GET /api/queue`. */
export const DaemonQueueItemSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: Type.String(),
  priority: Type.Optional(Type.Number()),
  created: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  dispatchFailure: Type.Optional(Type.Object({
    reason: Type.String(),
    stage: Type.Union([
      Type.Literal('stacking-validation'),
      Type.Literal('policy-gate'),
      Type.Literal('profile-routing'),
      Type.Literal('dispatch'),
    ]),
    timestamp: Type.String(),
  })),
  recoveryVerdict: Type.Optional(
    Type.Object({
      verdict: Type.Union([
        Type.Literal('retry'),
        Type.Literal('continue-repair'),
        Type.Literal('abandon'),
        Type.Literal('manual'),
      ]),
      confidence: Type.Union([
        Type.Literal('low'),
        Type.Literal('medium'),
        Type.Literal('high'),
      ]),
    }),
  ),
  // Base recovery actions use an `appliedAt` marker; `accepted-success` uses the rich AcceptSuccessAppliedSummary shape (keyed by `acceptedAt`).
  hold: Type.Optional(QueueItemHoldSchema),
  capabilities: QueueItemCapabilitiesSchema,
  recoveryApplied: Type.Optional(Type.Union([
    Type.Object({ action: Type.Union([Type.Literal('retry'), Type.Literal('continue-repair'), Type.Literal('abandon')]), appliedAt: Type.String(), commitSha: Type.Optional(Type.String()) }),
    Type.Object({ action: Type.Literal('accepted-success'), acceptedAt: Type.String(), reasonCategory: Type.Union([Type.Literal('bad_acceptance_criterion'), Type.Literal('manual_verification_passed'), Type.Literal('external_or_inconclusive_criterion_waived'), Type.Literal('other')]), reason: Type.String(), cleanup: Type.Object({ status: Type.Union([Type.Literal('committed'), Type.Literal('noop')]), commitSha: Type.Optional(Type.String()) }), landing: Type.Object({ action: Type.Union([Type.Literal('pr'), Type.Literal('merge'), Type.Literal('leave')]), status: Type.Union([Type.Literal('complete'), Type.Literal('skipped'), Type.Literal('failed')]), prUrl: Type.Optional(Type.String()), mergeCommitSha: Type.Optional(Type.String()), branch: Type.Optional(Type.String()), reason: Type.Optional(Type.String()), autoMerge: Type.Optional(Type.Union([Type.Object({ status: Type.Literal('complete') }), Type.Object({ status: Type.Literal('skipped'), reason: Type.String() }), Type.Object({ status: Type.Literal('failed'), reason: Type.String() })])) }), dependents: Type.Object({ unblocked: Type.Array(Type.String()), remainedBlocked: Type.Array(Type.String()), notFound: Type.Array(Type.String()) }) }),
  ])),
});

/** Shape of a per-session metadata entry as returned by `GET /api/session-metadata`. */
export const DaemonSessionMetadataItemSchema = Type.Object({
  planCount: Type.Union([Type.Number(), Type.Null()]),
  baseProfile: Type.Union([Type.String(), Type.Null()]),
});

/** Shape of the auto-build response as returned by `GET /api/auto-build`. */
export const DaemonAutoBuildSchema = Type.Object({
  enabled: Type.Boolean(),
  watcher: Type.Object({
    running: Type.Boolean(),
    pid: Type.Union([Type.Number(), Type.Null()]),
    sessionId: Type.Union([Type.String(), Type.Null()]),
  }),
  ...AutoBuildDetailFields,
});

/**
 * Snapshot payload embedded in the `stream:hello` frame for the
 * `/api/daemon-events` SSE stream.
 *
 * `cursor` is the max daemon-wide event id at connect time; used as the
 * authoritative `Last-Event-ID` for reconnects.
 *
 * All other fields match the response shapes of existing REST endpoints
 * byte-for-byte so plan-02 consumers can feed them into existing reducers.
 */
export const DaemonStreamSnapshotSchema = Type.Object({
  cursor: Type.Number(),
  liveness: DaemonStreamLivenessSchema,
  recentActivity: Type.Array(DaemonRecentActivityItemSchema),
  runs: Type.Array(DaemonRunRecordSchema),
  queue: Type.Array(DaemonQueueItemSchema),
  sessionMetadata: Type.Record(Type.String(), DaemonSessionMetadataItemSchema),
  autoBuild: DaemonAutoBuildSchema,
  stackLayers: Type.Array(StackLayerWireSchema),
  failedEnqueues: Type.Array(FailedEnqueueInfoSchema),
  stackSyncStatus: Type.Optional(Type.Object({
    last: Type.Optional(Type.Object({
      id: Type.String(),
      trigger: Type.Optional(Type.Union([
        Type.Literal('manual'),
        Type.Literal('after-build'),
        Type.Literal('scheduled'),
        Type.Literal('retry-deferred'),
      ])),
      activeBuildPolicy: Type.Optional(Type.Union([
        Type.Literal('skip'),
        Type.Literal('defer'),
      ])),
      startedAt: Type.String(),
      completedAt: Type.Optional(Type.String()),
      outcome: Type.Union([
        Type.Literal('skipped'),
        Type.Literal('complete'),
        Type.Literal('failed'),
        Type.Literal('conflict'),
        Type.Literal('deferred'),
      ]),
      reason: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
      dryRun: Type.Boolean(),
      localTrunkSha: Type.Optional(Type.String()),
      originTrunkSha: Type.Optional(Type.String()),
      fastForward: Type.Optional(Type.Boolean()),
      restackCandidates: Type.Array(Type.String()),
      activeBuildSkips: Type.Optional(Type.Array(Type.Object({
        branch: Type.String(),
        worktree: Type.Optional(Type.String()),
        reason: Type.String(),
      }))),
      providerCommands: Type.Optional(Type.Array(Type.Object({
        command: Type.String(),
        args: Type.Array(Type.String()),
        dryRun: Type.Boolean(),
        ran: Type.Boolean(),
        stdout: Type.Optional(Type.String()),
        stderr: Type.Optional(Type.String()),
        exitCode: Type.Optional(Type.Number()),
      }))),
    })),
    current: Type.Optional(Type.Object({
      id: Type.String(),
      trigger: Type.Optional(Type.Union([
        Type.Literal('manual'),
        Type.Literal('after-build'),
        Type.Literal('scheduled'),
        Type.Literal('retry-deferred'),
      ])),
      activeBuildPolicy: Type.Optional(Type.Union([
        Type.Literal('skip'),
        Type.Literal('defer'),
      ])),
      startedAt: Type.String(),
      completedAt: Type.Optional(Type.String()),
      outcome: Type.Optional(Type.Union([
        Type.Literal('skipped'),
        Type.Literal('complete'),
        Type.Literal('failed'),
        Type.Literal('conflict'),
        Type.Literal('deferred'),
      ])),
      reason: Type.Optional(Type.String()),
      error: Type.Optional(Type.String()),
      dryRun: Type.Boolean(),
      localTrunkSha: Type.Optional(Type.String()),
      originTrunkSha: Type.Optional(Type.String()),
      fastForward: Type.Optional(Type.Boolean()),
      restackCandidates: Type.Array(Type.String()),
      activeBuildSkips: Type.Optional(Type.Array(Type.Object({
        branch: Type.String(),
        worktree: Type.Optional(Type.String()),
        reason: Type.String(),
      }))),
      providerCommands: Type.Optional(Type.Array(Type.Object({
        command: Type.String(),
        args: Type.Array(Type.String()),
        dryRun: Type.Boolean(),
        ran: Type.Boolean(),
        stdout: Type.Optional(Type.String()),
        stderr: Type.Optional(Type.String()),
        exitCode: Type.Optional(Type.Number()),
      }))),
    })),
  })),
});

/**
 * Snapshot payload embedded in the `stream:hello` frame for the
 * `/api/events/:sessionId` SSE stream.
 *
 * `cursor` is the max event id for the session at connect time.
 * `status` and `events` match the `RunState` shape from `GET /api/runs/:id/state`.
 */
export const SessionStreamSnapshotSchema = Type.Object({
  cursor: Type.Number(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  events: Type.Array(
    Type.Object({
      id: Type.Number(),
      data: Type.String(),
    }),
  ),
});

export type DaemonStreamSnapshot = Static<typeof DaemonStreamSnapshotSchema>;
export type SessionStreamSnapshot = Static<typeof SessionStreamSnapshotSchema>;
