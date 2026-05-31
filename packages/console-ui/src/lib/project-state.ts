/**
 * Console project state: reducer, initial state, and action types.
 *
 * Fed by:
 *   1. SNAPSHOT_RECEIVED — from `stream:hello` payloads on (re)connect.
 *   2. EVENT_RECEIVED    — from live daemon SSE events.
 *   3. STREAM_ERROR      — on SSE stream failure.
 */
import type {
  RunInfo,
  QueueItem,
  SessionMetadata,
  AutoBuildState,
  StackLayerWire,
  EforgeEvent,
} from '@eforge-build/client/browser';
import type {
  DaemonStreamSnapshot,
} from '@eforge-build/client/browser';
import type { ProjectableState } from '@eforge-build/client/browser';
import type { ConnectionStatus, ConsoleActivityEntry } from '@/lib/types';
import { daemonEventProjectorRegistry } from '@/lib/daemon-event-projector';

/** Maximum entries in the activity ring buffer. */
export const ACTIVITY_BUFFER_CAP = 500;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface ConsoleProjectState {
  runs: RunInfo[];
  queue: QueueItem[];
  sessionMetadata: Record<string, SessionMetadata>;
  autoBuild: AutoBuildState | null;
  liveness: DaemonStreamSnapshot['liveness'] | null;
  latestHeartbeat: ProjectableState['latestHeartbeat'];
  recentActivity: ConsoleActivityEntry[];
  stackLayers: StackLayerWire[];
  stackSync: DaemonStreamSnapshot['stackSyncStatus'] | null;
  connectionStatus: ConnectionStatus;
  lastSnapshotAt: number | null;
  lastEventAt: number | null;
  error: string | null;
}

export const initialConsoleProjectState: ConsoleProjectState = {
  runs: [],
  queue: [],
  sessionMetadata: {},
  autoBuild: null,
  liveness: null,
  latestHeartbeat: null,
  recentActivity: [],
  stackLayers: [],
  stackSync: null,
  connectionStatus: 'connecting',
  lastSnapshotAt: null,
  lastEventAt: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type ConsoleProjectAction =
  | {
      type: 'SNAPSHOT_RECEIVED';
      snapshot: DaemonStreamSnapshot;
      receivedAt: number;
    }
  | {
      type: 'EVENT_RECEIVED';
      event: EforgeEvent;
      eventId: string;
      receivedAt: number;
    }
  | {
      type: 'STREAM_ERROR';
      error: string;
    }
  | {
      type: 'CONNECTING';
    }
  | {
      type: 'QUEUE_REFRESH_RECEIVED';
      queue: QueueItem[];
    };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Build a `ProjectableState` from `ConsoleProjectState` so the event projector
 * registry can operate on it.
 */
function toProjectable(state: ConsoleProjectState): ProjectableState {
  return {
    runs: state.runs,
    queue: state.queue,
    autoBuild: state.autoBuild,
    latestHeartbeat: state.latestHeartbeat,
    stackLayers: state.stackLayers,
  };
}

function queueDepthFromQueue(queue: QueueItem[]): number {
  return queue.filter((item) => item.status === 'pending' || item.status === 'running').length;
}

export function consoleProjectReducer(
  state: ConsoleProjectState,
  action: ConsoleProjectAction,
): ConsoleProjectState {
  switch (action.type) {
    case 'SNAPSHOT_RECEIVED': {
      const { snapshot, receivedAt } = action;
      const liveness = snapshot.liveness;
      // Seed activity from snapshot recentActivity, deduping by id
      const existingIds = new Set(state.recentActivity.map((e) => e.id));
      const newEntries = snapshot.recentActivity
        .filter((a) => !existingIds.has(String(a.id)))
        .map(
          (a): ConsoleActivityEntry => ({
            id: String(a.id),
            event: a.event as EforgeEvent,
            receivedAt,
          }),
        );
      let recentActivity = state.recentActivity;
      if (newEntries.length > 0) {
        const combined = [...state.recentActivity, ...newEntries];
        recentActivity =
          combined.length <= ACTIVITY_BUFFER_CAP
            ? combined
            : combined.slice(combined.length - ACTIVITY_BUFFER_CAP);
      }

      return {
        ...state,
        runs: snapshot.runs,
        queue: snapshot.queue,
        sessionMetadata: snapshot.sessionMetadata,
        autoBuild: snapshot.autoBuild,
        liveness,
        latestHeartbeat: {
          at: receivedAt,
          payload: {
            uptime: liveness.uptime,
            queueDepth: liveness.queueDepth,
            runningBuilds: liveness.runningBuilds,
            autoBuild: liveness.autoBuild,
            subscribers: liveness.subscribers,
          },
        },
        stackLayers: snapshot.stackLayers ?? state.stackLayers,
        stackSync: snapshot.stackSyncStatus ?? null,
        recentActivity,
        connectionStatus: 'connected',
        lastSnapshotAt: receivedAt,
        error: null,
      };
    }

    case 'EVENT_RECEIVED': {
      const { event, eventId, receivedAt } = action;
      const isHeartbeat = event.type === 'daemon:heartbeat';

      // Apply event projection delta from the registry
      const projector = daemonEventProjectorRegistry[event.type];
      const projectable = toProjectable(state);
      const delta = projector ? projector(event, projectable) : undefined;

      // Build updated latestHeartbeat from heartbeat events.
      // daemon:heartbeat fields are top-level on the event (not nested in payload).
      let updatedHeartbeat = state.latestHeartbeat;
      if (isHeartbeat) {
        type HeartbeatEvent = {
          type: 'daemon:heartbeat';
          uptime: number;
          queueDepth: number;
          runningBuilds: number;
          autoBuild: NonNullable<ProjectableState['latestHeartbeat']>['payload']['autoBuild'];
          subscribers: number;
        };
        const hb = event as unknown as HeartbeatEvent;
        if (typeof hb.uptime === 'number') {
          updatedHeartbeat = {
            at: receivedAt,
            payload: {
              uptime: hb.uptime,
              queueDepth: hb.queueDepth,
              runningBuilds: hb.runningBuilds,
              autoBuild: hb.autoBuild,
              subscribers: hb.subscribers,
            },
          };
        }
      }

      // Update stackSync from stack sync events (no project() functions in registry)
      let updatedStackSync = state.stackSync;
      if (event.type === 'stack:sync:start') {
        const e = event as {
          type: 'stack:sync:start';
          syncId: string;
          trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
          dryRun: boolean;
          timestamp: string;
        };
        updatedStackSync = {
          ...state.stackSync,
          current: {
            id: e.syncId,
            trigger: e.trigger,
            startedAt: e.timestamp,
            dryRun: e.dryRun,
            restackCandidates: [],
          },
        };
      } else if (event.type === 'stack:sync:complete') {
        const e = event as {
          type: 'stack:sync:complete';
          syncId: string;
          trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
          dryRun: boolean;
          restackCandidates: string[];
          localTrunkSha?: string;
          originTrunkSha?: string;
          fastForward?: boolean;
          reason?: string;
          timestamp: string;
        };
        const startedAt = state.stackSync?.current?.id === e.syncId
          ? (state.stackSync.current.startedAt ?? e.timestamp)
          : e.timestamp;
        updatedStackSync = {
          ...state.stackSync,
          last: {
            id: e.syncId,
            trigger: e.trigger,
            startedAt,
            completedAt: e.timestamp,
            outcome: 'complete',
            dryRun: e.dryRun,
            restackCandidates: e.restackCandidates,
            localTrunkSha: e.localTrunkSha,
            originTrunkSha: e.originTrunkSha,
            fastForward: e.fastForward,
            reason: e.reason,
          },
          current: undefined,
        };
      } else if (event.type === 'stack:sync:failed') {
        const e = event as {
          type: 'stack:sync:failed';
          syncId: string;
          trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
          dryRun: boolean;
          outcome: 'failed' | 'conflict';
          reason: string;
          error?: string;
          timestamp: string;
        };
        const startedAt = state.stackSync?.current?.id === e.syncId
          ? (state.stackSync.current.startedAt ?? e.timestamp)
          : e.timestamp;
        updatedStackSync = {
          ...state.stackSync,
          last: {
            id: e.syncId,
            trigger: e.trigger,
            startedAt,
            completedAt: e.timestamp,
            outcome: e.outcome,
            dryRun: e.dryRun,
            restackCandidates: [],
            reason: e.reason,
            error: e.error,
          },
          current: undefined,
        };
      } else if (event.type === 'stack:sync:deferred') {
        const e = event as {
          type: 'stack:sync:deferred';
          syncId: string;
          trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
          reason: string;
          timestamp: string;
        };
        const startedAt = state.stackSync?.current?.id === e.syncId
          ? (state.stackSync.current.startedAt ?? e.timestamp)
          : e.timestamp;
        updatedStackSync = {
          ...state.stackSync,
          last: {
            id: e.syncId,
            trigger: e.trigger,
            startedAt,
            completedAt: e.timestamp,
            outcome: 'deferred',
            dryRun: false,
            restackCandidates: [],
            reason: e.reason,
          },
          current: undefined,
        };
      } else if (event.type === 'stack:sync:skipped') {
        const e = event as {
          type: 'stack:sync:skipped';
          syncId: string;
          trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
          dryRun: boolean;
          reason: string;
          restackCandidates: string[];
          timestamp: string;
        };
        const startedAt = state.stackSync?.current?.id === e.syncId
          ? (state.stackSync.current.startedAt ?? e.timestamp)
          : e.timestamp;
        updatedStackSync = {
          ...state.stackSync,
          last: {
            id: e.syncId,
            trigger: e.trigger,
            startedAt,
            completedAt: e.timestamp,
            outcome: 'skipped',
            dryRun: e.dryRun,
            restackCandidates: e.restackCandidates,
            reason: e.reason,
          },
          current: undefined,
        };
      }

      if (!isHeartbeat) {
        // Append to activity ring buffer
        // Guard against empty eventId (SSE frames where id is absent): generate a
        // stable, namespaced fallback that cannot collide with snapshot numeric ids.
        const entryId = eventId || `live-${receivedAt}-${state.recentActivity.length}`;
        const entry: ConsoleActivityEntry = { id: entryId, event, receivedAt };
        const recentActivity =
          state.recentActivity.length < ACTIVITY_BUFFER_CAP
            ? [...state.recentActivity, entry]
            : [...state.recentActivity.slice(1), entry];

        return {
          ...state,
          ...delta,
          stackSync: updatedStackSync,
          recentActivity,
          lastEventAt: receivedAt,
          latestHeartbeat: updatedHeartbeat,
        };
      }

      // Heartbeat: only apply delta + heartbeat update, no activity append
      if (!delta && updatedHeartbeat === state.latestHeartbeat && updatedStackSync === state.stackSync) return state;
      return {
        ...state,
        ...delta,
        stackSync: updatedStackSync,
        latestHeartbeat: updatedHeartbeat,
        lastEventAt: receivedAt,
      };
    }

    case 'QUEUE_REFRESH_RECEIVED': {
      const queueDepth = queueDepthFromQueue(action.queue);
      return {
        ...state,
        queue: action.queue,
        liveness: state.liveness ? { ...state.liveness, queueDepth } : state.liveness,
        latestHeartbeat: state.latestHeartbeat
          ? {
              ...state.latestHeartbeat,
              payload: { ...state.latestHeartbeat.payload, queueDepth },
            }
          : state.latestHeartbeat,
      };
    }

    case 'STREAM_ERROR':
      return {
        ...state,
        connectionStatus: 'disconnected',
        error: action.error,
      };

    case 'CONNECTING':
      return {
        ...state,
        connectionStatus: 'connecting',
        error: null,
      };

    default:
      return state;
  }
}
