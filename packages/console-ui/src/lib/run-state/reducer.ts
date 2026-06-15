/**
 * Console-owned reducer for eforge session run state.
 *
 * ## Action types
 *
 * ### `ADD_EVENT`
 * Appends a single `EforgeEvent` to the event log and updates all derived
 * aggregates (token counts, cost, plan statuses, agent threads, file changes,
 * review issues, etc.) incrementally. Use for live SSE events received after
 * the initial batch load.
 *
 * Dispatch is O(1) via the handler registry in `./handlers/index`. Each handler
 * narrows on `event.type` (discriminated union — no casts, no `'in' event`
 * guards) and returns a `Partial<RunState>` delta describing only the slices it
 * mutated. Only those slices are spread into the next state; unrelated containers
 * keep the same ref across events so downstream `React.memo` fires only when the
 * relevant container actually changed.
 *
 * ### `BATCH_LOAD`
 * Rebuilds the entire state from scratch by replaying a full array of stored
 * events. Accepts an optional `serverStatus` that acts as an authoritative
 * override for `isComplete`/`resultStatus` when the event array alone would
 * leave those fields unset (e.g. the terminal `session:end` event was missed).
 * Use for the initial HTTP snapshot or when loading a cached completed session.
 *
 * ### `RESET`
 * Returns the initial empty state with freshly allocated mutable containers
 * (`fileChanges: new Map()`, etc.). Use when the session changes to `null` or
 * when the hook is cleaning up.
 */
import type { EforgeEvent } from './types';
import type { RunState } from './types';
export type { RunState, AgentThread, AgentActivityFacts, Decision, DecisionPoint, ModuleStatus, StoredEvent } from './types';

import { handlerRegistry } from './handlers/index';

export const initialRunState: RunState = {
  events: [],
  startTime: null,
  planStatuses: {},
  resumeSeededMerged: [],
  resumeSeededPending: [],
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheCreation: 0,
  totalCost: 0,
  isComplete: false,
  resultStatus: null,
  fileChanges: new Map(),
  reviewIssues: {},
  agentThreads: [],
  expeditionModules: [],
  moduleStatuses: {},
  earlyOrchestration: null,
  resumeArtifacts: [],
  resumeSource: null,
  profile: null,
  endTime: null,
  mergeCommits: {},
  liveAgentUsage: {},
  enqueueStatus: null,
  enqueueTitle: null,
  enqueueSource: null,
  validationCommands: [],
  autoBuildPausedReason: null,
  autoBuildPausedAt: null,
  perspectiveErrors: {},
  reviewIssuesByPerspective: {},
  decisions: {},
};

export type RunAction =
  | { type: 'ADD_EVENT'; event: EforgeEvent; eventId: string }
  | { type: 'BATCH_LOAD'; events: Array<{ event: EforgeEvent; eventId: string }>; serverStatus?: string }
  | { type: 'RESET' };

export function eforgeReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'RESET':
      return { ...initialRunState, fileChanges: new Map(), reviewIssues: {}, agentThreads: [], expeditionModules: [], moduleStatuses: {}, earlyOrchestration: null, resumeArtifacts: [], resumeSource: null, resumeSeededMerged: [], resumeSeededPending: [], profile: null, mergeCommits: {}, liveAgentUsage: {}, enqueueStatus: null as 'running' | 'complete' | 'failed' | null, enqueueTitle: null, enqueueSource: null, validationCommands: [], autoBuildPausedReason: null, autoBuildPausedAt: null, perspectiveErrors: {}, reviewIssuesByPerspective: {}, decisions: {} };

    case 'BATCH_LOAD': {
      // Replay all events through the handler registry, accumulating state.
      // Handlers are called with a running accumulator (not the original state).
      // events is set at the end from action.events to avoid O(n²) array growth.
      let acc: RunState = {
        ...initialRunState,
        fileChanges: new Map(),
        resumeArtifacts: [],
        resumeSource: null,
        resumeSeededMerged: [],
        resumeSeededPending: [],
        events: [],
      };

      for (const { event } of action.events) {
        const handler = (handlerRegistry as Record<string, ((e: never, s: Readonly<RunState>) => Partial<RunState> | undefined) | undefined>)[event.type];
        const delta = handler ? handler(event as never, acc) : undefined;
        if (delta) {
          acc = { ...acc, ...delta };
        }
      }

      // Apply server status as authoritative override when events are incomplete
      if (action.serverStatus && !acc.isComplete) {
        if (action.serverStatus === 'completed' || action.serverStatus === 'failed') {
          acc = { ...acc, isComplete: true, resultStatus: action.serverStatus };
        }
      }

      return { ...acc, events: action.events };
    }

    case 'ADD_EVENT': {
      const { event, eventId } = action;
      const handler = (handlerRegistry as Record<string, ((e: never, s: Readonly<RunState>) => Partial<RunState> | undefined) | undefined>)[event.type];
      const delta = handler ? handler(event as never, state) : undefined;
      const events = [...state.events, { event, eventId }];
      return delta ? { ...state, events, ...delta } : { ...state, events };
    }

    default:
      return state;
  }
}

/**
 * Creates a fresh initial RunState with all mutable containers allocated.
 * Prefer `initialRunState` for read-only defaults; use this function when
 * you need a fully isolated instance (e.g. in tests or on reset).
 */
export function createInitialRunState(): RunState {
  return {
    ...initialRunState,
    fileChanges: new Map(),
    reviewIssues: {},
    agentThreads: [],
    expeditionModules: [],
    moduleStatuses: {},
    earlyOrchestration: null,
    resumeArtifacts: [],
    resumeSource: null,
    resumeSeededMerged: [],
    resumeSeededPending: [],
    profile: null,
    mergeCommits: {},
    liveAgentUsage: {},
    enqueueStatus: null,
    enqueueTitle: null,
    enqueueSource: null,
    validationCommands: [],
    autoBuildPausedReason: null,
    autoBuildPausedAt: null,
    perspectiveErrors: {},
    reviewIssuesByPerspective: {},
    decisions: {},
  };
}

/**
 * Selector for auto-build pause state derived from the SSE event stream.
 *
 * Returns `{ paused: false, reason: null }` when no `daemon:auto-build:paused`
 * event has been received for the current session. Returns `{ paused: true,
 * reason: string }` after such an event arrives via the reducer.
 */
export function selectAutoBuild(state: RunState): { paused: boolean; reason: string | null } {
  return {
    paused: state.autoBuildPausedReason !== null,
    reason: state.autoBuildPausedReason,
  };
}

/**
 * Reduces a single event into state.
 * Convenience wrapper for use outside of React dispatch.
 */
export function reduce(state: RunState, event: EforgeEvent, eventId: string): RunState {
  return eforgeReducer(state, { type: 'ADD_EVENT', event, eventId });
}
