/**
 * Shared test/story data factories for the Now dashboard.
 *
 * Both Vitest tests and Storybook stories build their inputs here so there is
 * one place to update when the underlying wire/view models move. The discipline
 * that keeps stories from going brittle: never hand-author selector *output*
 * (view models like NowActiveBuildCard). Build wire-level inputs (RunInfo,
 * QueueItem, event streams) with these helpers and run them through the real
 * selectors in the story/test. When a view model changes shape, the selector
 * update fixes every consumer for free.
 *
 * Not part of the app bundle — nothing under src reachable from main.tsx imports
 * this module, so Vite tree-shakes it out of production builds.
 */
import type { QueueItem, RunInfo } from '@eforge-build/client/browser';
import type {
  ActiveSessionDetail,
  UseActiveSessionStreamsResult,
} from '@/hooks/use-active-session-streams';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import { createInitialRunState, eforgeReducer } from '@/lib/run-state';
import type { RunState } from '@/lib/run-state';
import type { EforgeEvent } from '@eforge-build/client/browser';
import sampleBuildEvents from '@/lib/run-state/__tests__/fixtures/sample-build.json';

// ---------------------------------------------------------------------------
// Wire-shape factories (RunInfo / QueueItem)
// ---------------------------------------------------------------------------

let runSeq = 0;

/** A running build RunInfo. Override any field; ids auto-increment when omitted. */
export function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  runSeq += 1;
  return {
    id: `run-${runSeq}`,
    sessionId: `sess-${runSeq}`,
    planSet: 'plans-set',
    command: 'build',
    status: 'running',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    cwd: '/project',
    ...overrides,
  };
}

let queueSeq = 0;

/** A pending queue item. Override any field; ids auto-increment when omitted. */
export function makeQueue(overrides: Partial<QueueItem> = {}): QueueItem {
  queueSeq += 1;
  return {
    id: `q-${queueSeq}`,
    title: 'My task',
    status: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Project-state / active-session factories
// ---------------------------------------------------------------------------

/** Active-session streams result with no live sessions. */
export const emptyActiveSessions: UseActiveSessionStreamsResult = {
  sessions: {},
  activeSessionIds: [],
  subscriptionCount: 0,
};

/** A connected ConsoleProjectState with a fresh snapshot timestamp. */
export function connectedState(
  overrides: Partial<ConsoleProjectState> = {},
): ConsoleProjectState {
  return {
    ...initialConsoleProjectState,
    connectionStatus: 'connected',
    lastSnapshotAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RunState builders — fold real events through the real reducer
// ---------------------------------------------------------------------------

type FixtureEntry = { event: EforgeEvent; eventId: string };

const SAMPLE_BUILD_ENTRIES = sampleBuildEvents as unknown as FixtureEntry[];

/**
 * Fold a list of events through the production reducer into a RunState. This is
 * the same path `use-active-session-streams` takes for live SSE, so a RunState
 * built here exercises real reduction logic rather than a hand-authored snapshot.
 */
export function runStateFromEvents(entries: FixtureEntry[]): RunState {
  return entries.reduce(
    (acc, { event, eventId }) => eforgeReducer(acc, { type: 'ADD_EVENT', event, eventId }),
    createInitialRunState(),
  );
}

/**
 * Build a RunState from the captured sample-build fixture (34 events: planning →
 * plans → PRD validation → gap close → final validation → landing → complete).
 *
 * Pass `limit` to fold only the first N events and stop mid-flight — e.g. a
 * smaller limit lands in the "plans running" phase, a larger one in
 * "final validation". This yields realistic in-progress states for active-build
 * stories without fabricating partial RunState by hand.
 */
export function sampleBuildRunState(limit: number = SAMPLE_BUILD_ENTRIES.length): RunState {
  return runStateFromEvents(SAMPLE_BUILD_ENTRIES.slice(0, limit));
}

/** Total number of events in the sample-build fixture. */
export const SAMPLE_BUILD_EVENT_COUNT = SAMPLE_BUILD_ENTRIES.length;

/**
 * Index of `plan:build:start plan-02` in the fixture — folding up to here lands
 * mid-pipeline with plan-01 merged and plan-02 just beginning, i.e. the common
 * "plans running" active state. Resolved by lookup so it survives fixture edits.
 */
export const SAMPLE_BUILD_PLANS_RUNNING_LIMIT =
  SAMPLE_BUILD_ENTRIES.findIndex(
    (e) => e.event.type === 'plan:build:start' && (e.event as { planId?: string }).planId === 'plan-02',
  ) + 1;

/** Index just after planning completes — folding to here sits in the PRD/planning phase. */
export const SAMPLE_BUILD_PLANNING_LIMIT =
  SAMPLE_BUILD_ENTRIES.findIndex((e) => e.event.type === 'planning:complete') + 1;

/** Per-variant `Omit` — distributes over the union so each variant keeps its own fields. */
type EventPayload = EforgeEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'timestamp'>
    : never
  : never;

/**
 * Build a synthetic event, type-checked against its wire variant. The caller
 * supplies the variant payload (sans the `timestamp` envelope field, which is
 * irrelevant to the reducer and injected here); the discriminated-union
 * parameter means a future schema rename or a changed payload field surfaces as
 * a compile error here rather than slipping through an `as unknown as
 * EforgeEvent` cast.
 */
function synthEvent(payload: EventPayload): EforgeEvent {
  return { timestamp: '2024-01-15T10:00:00.000Z', ...payload } as EforgeEvent;
}

/**
 * Append more event entries onto an existing fixture-prefix and fold the whole
 * thing through the reducer. Synthesized events match the wire schema exactly so
 * the production reducer's handlers run against real-shaped data.
 */
function foldWith(limit: number, extra: EforgeEvent[]): RunState {
  const entries: FixtureEntry[] = [
    ...SAMPLE_BUILD_ENTRIES.slice(0, limit),
    ...extra.map((event, i) => ({ event, eventId: `synth-${i + 1}` })),
  ];
  return runStateFromEvents(entries);
}

/**
 * RunState for a build that has cleared both plans, passed PRD validation, run
 * gap-close, and reached the landing phase — the late-pipeline state the live
 * dashboard rarely sits in long enough to inspect by hand.
 */
export function landingRunState(): RunState {
  return foldWith(SAMPLE_BUILD_ENTRIES.length, [
    synthEvent({ type: 'prd_validation:start' }),
    synthEvent({ type: 'prd_validation:complete', passed: true, gaps: [] }),
    synthEvent({ type: 'gap_close:start' }),
    synthEvent({ type: 'gap_close:complete', passed: true }),
    synthEvent({ type: 'prd_validation:complete', passed: true, gaps: [] }),
  ]);
}

/**
 * RunState for a build that failed during plan-02 — drives the active-build
 * card's hard error styling via `plan:build:failed`.
 */
export function failedRunState(error = 'plan-02 implementation aborted: type errors unresolved'): RunState {
  return foldWith(SAMPLE_BUILD_PLANS_RUNNING_LIMIT, [
    synthEvent({ type: 'plan:build:failed', planId: 'plan-02', error }),
  ]);
}

/** Wrap a RunState in an ActiveSessionDetail for a connected, running session. */
export function activeSessionDetail(
  overrides: Partial<ActiveSessionDetail> = {},
): ActiveSessionDetail {
  return {
    sessionId: 'sess-active',
    connectionStatus: 'connected',
    status: 'running',
    runState: createInitialRunState(),
    lastEventAt: Date.now(),
    error: null,
    ...overrides,
  };
}

/** Build a UseActiveSessionStreamsResult from a map of session details. */
export function activeSessions(
  sessions: Record<string, ActiveSessionDetail>,
): UseActiveSessionStreamsResult {
  const ids = Object.keys(sessions);
  return {
    sessions,
    activeSessionIds: ids,
    subscriptionCount: ids.length,
  };
}
