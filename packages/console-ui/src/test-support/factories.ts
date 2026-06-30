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
import type { QueueItem, QueueItemCapabilities, RunInfo } from '@eforge-build/client/browser';
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

export function makeQueueCapabilities(overrides: Partial<QueueItemCapabilities> = {}): QueueItemCapabilities {
  const allowed = { allowed: true };
  return {
    priority: allowed,
    remove: allowed,
    dependencyOverride: allowed,
    hold: allowed,
    unhold: allowed,
    cascadeRemove: allowed,
    cancel: allowed,
    cascadeCancel: allowed,
    ...overrides,
  };
}

/** A pending queue item. Override any field; ids auto-increment when omitted. */
export function makeQueue(overrides: Partial<QueueItem> = {}): QueueItem {
  queueSeq += 1;
  return {
    id: `q-${queueSeq}`,
    title: 'My task',
    status: 'pending',
    capabilities: makeQueueCapabilities(overrides.capabilities),
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
  return eventAt('2024-01-15T10:00:00.000Z', payload);
}

function eventAt(timestamp: string, payload: EventPayload): EforgeEvent {
  return { timestamp, ...payload } as EforgeEvent;
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

/**
 * Reproduces the validation swimlane regression from real-shaped historical events:
 * - a compile-phase plan-evaluator emits without planId and therefore lands in
 *   the synthetic Compile row;
 * - post-merge validation command spans are unscoped at the event level and
 *   should still render on the Validation lane;
 * - the PRD validator is correctly scoped to the `validation` phase lane, and
 *   the Now card should treat that running agent as active even without a
 *   planStatuses stage entry.
 */
export function validationSwimlaneBugRunState(): RunState {
  const events: EforgeEvent[] = [
    eventAt('2024-01-15T10:00:00.000Z', { type: 'session:start', sessionId: 'sess-validation-bug' }),
    eventAt('2024-01-15T10:00:01.000Z', { type: 'phase:start', sessionId: 'sess-validation-bug', runId: 'run-validation-bug', planSet: 'validation-swimlane-bug', command: 'build' }),
    eventAt('2024-01-15T10:00:02.000Z', { type: 'planning:start', sessionId: 'sess-validation-bug', label: 'Validation swimlane bug PRD', source: '# Validation swimlane bug repro' }),
    eventAt('2024-01-15T10:00:03.000Z', { type: 'agent:start', sessionId: 'sess-validation-bug', planId: 'planning', agentId: 'agent-planner', agent: 'planner', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'max', tierSource: 'role' }),
    eventAt('2024-01-15T10:00:25.000Z', { type: 'agent:result', sessionId: 'sess-validation-bug', planId: 'planning', agentId: 'agent-planner', agent: 'planner', result: { durationMs: 22_000, durationApiMs: 20_000, numTurns: 1, totalCostUsd: 0.03, usage: { input: 180_000, output: 45_000, total: 225_000, cacheRead: 20_000, cacheCreation: 0 }, modelUsage: {}, resultText: 'Planning complete.' } }),
    eventAt('2024-01-15T10:00:25.000Z', { type: 'agent:stop', sessionId: 'sess-validation-bug', planId: 'planning', agentId: 'agent-planner', agent: 'planner' }),
    eventAt('2024-01-15T10:00:30.000Z', {
      type: 'planning:complete',
      sessionId: 'sess-validation-bug',
      plans: [{ id: 'plan-01', name: 'Acceptance Recovery Evidence', dependsOn: [], branch: 'fix/plan-01', body: 'Implement acceptance evidence', filePath: '.eforge/plans/plan-01.md' }],
      planConfigs: [{ id: 'plan-01', build: ['implement', 'test-cycle', 'review-cycle'] }],
    }),
    eventAt('2024-01-15T10:00:31.000Z', { type: 'agent:start', sessionId: 'sess-validation-bug', agentId: 'agent-plan-eval', agent: 'plan-evaluator', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'balanced', tierSource: 'role' }),
    eventAt('2024-01-15T10:01:00.000Z', { type: 'agent:result', sessionId: 'sess-validation-bug', agentId: 'agent-plan-eval', agent: 'plan-evaluator', result: { durationMs: 29_000, durationApiMs: 27_000, numTurns: 1, totalCostUsd: 0.02, usage: { input: 120_000, output: 30_000, total: 150_000, cacheRead: 0, cacheCreation: 0 }, modelUsage: {}, resultText: 'Plan fixes accepted.' } }),
    eventAt('2024-01-15T10:01:00.000Z', { type: 'agent:stop', sessionId: 'sess-validation-bug', agentId: 'agent-plan-eval', agent: 'plan-evaluator' }),
    eventAt('2024-01-15T10:01:02.000Z', { type: 'plan:status:change', sessionId: 'sess-validation-bug', planId: 'plan-01', status: 'running' }),
    eventAt('2024-01-15T10:01:03.000Z', { type: 'agent:start', sessionId: 'sess-validation-bug', planId: 'plan-01', agentId: 'agent-builder', agent: 'builder', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'max', tierSource: 'role' }),
    eventAt('2024-01-15T10:03:00.000Z', { type: 'agent:result', sessionId: 'sess-validation-bug', planId: 'plan-01', agentId: 'agent-builder', agent: 'builder', result: { durationMs: 117_000, durationApiMs: 110_000, numTurns: 3, totalCostUsd: 0.08, usage: { input: 650_000, output: 170_000, total: 820_000, cacheRead: 300_000, cacheCreation: 20_000 }, modelUsage: {}, resultText: 'Implementation complete.' } }),
    eventAt('2024-01-15T10:03:00.000Z', { type: 'agent:stop', sessionId: 'sess-validation-bug', planId: 'plan-01', agentId: 'agent-builder', agent: 'builder' }),
    eventAt('2024-01-15T10:03:01.000Z', { type: 'plan:status:change', sessionId: 'sess-validation-bug', planId: 'plan-01', status: 'completed' }),
    eventAt('2024-01-15T10:03:02.000Z', { type: 'validation:start', sessionId: 'sess-validation-bug', commands: ['pnpm type-check', 'pnpm test'] }),
    eventAt('2024-01-15T10:03:02.000Z', { type: 'validation:command:start', sessionId: 'sess-validation-bug', command: 'pnpm type-check' }),
    eventAt('2024-01-15T10:03:08.000Z', { type: 'validation:command:complete', sessionId: 'sess-validation-bug', command: 'pnpm type-check', exitCode: 0, output: 'ok' }),
    eventAt('2024-01-15T10:03:08.000Z', { type: 'validation:command:start', sessionId: 'sess-validation-bug', command: 'pnpm test' }),
    eventAt('2024-01-15T10:03:45.000Z', { type: 'validation:command:complete', sessionId: 'sess-validation-bug', command: 'pnpm test', exitCode: 0, output: 'ok' }),
    eventAt('2024-01-15T10:03:45.000Z', { type: 'validation:complete', sessionId: 'sess-validation-bug', passed: true }),
    eventAt('2024-01-15T10:03:46.000Z', { type: 'prd_validation:start', sessionId: 'sess-validation-bug' }),
    eventAt('2024-01-15T10:03:47.000Z', { type: 'agent:start', sessionId: 'sess-validation-bug', planId: 'validation', agentId: 'agent-prd-validator', agent: 'prd-validator', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'balanced', tierSource: 'role' }),
  ];

  return runStateFromEvents(events.map((event, i) => ({ event, eventId: `validation-bug-${i + 1}` })));
}

/**
 * RunState for a large-plan bounded-compiler (map/reduce) run, mid-flight: the
 * map phase has cleared some atoms and one is still running; the reduce tree is
 * built with wave 0 running and the root (wave 1) still queued. Atom/reduce
 * agent threads are keyed `planId === atomId / nodeId`, so the board's per-node
 * enrichment join (model/tokens/duration/turns) exercises real reduced data.
 *
 * Folds the four `planning:map-reduce:*` events plus `agent:*` threads through
 * the production reducer, so the orchestration selectors run against real-shaped
 * state rather than a hand-authored `mapReduce` snapshot.
 */
export function mapReduceRunState(): RunState {
  const sessionId = 'sess-map-reduce';
  const events: EforgeEvent[] = [
    eventAt('2024-01-15T10:00:00.000Z', { type: 'session:start', sessionId }),
    eventAt('2024-01-15T10:00:01.000Z', { type: 'phase:start', sessionId, runId: 'run-map-reduce', planSet: 'large-plan-refactor', command: 'build' }),
    eventAt('2024-01-15T10:00:02.000Z', { type: 'planning:start', sessionId, label: 'Payments refactor PRD', source: '# Payments refactor' }),

    // Atom graph snapshot (known up front, before the map phase runs).
    eventAt('2024-01-15T10:00:03.000Z', {
      type: 'planning:map-reduce:atoms',
      sessionId,
      graphId: 'graph-payments-refactor-7f3a',
      atomCount: 5,
      edgeCount: 2,
      atoms: [
        { atomId: 'atom-001', title: 'Define payment intent contract', reason: 'foundation-contract', criterionIds: ['c1', 'c2'], dependencyAtomIds: [] },
        { atomId: 'atom-002', title: 'Migrate ledger schema', reason: 'subsystem', criterionIds: ['c3'], dependencyAtomIds: ['atom-001'] },
        { atomId: 'atom-003', title: 'Wire refund webhook', reason: 'general', criterionIds: ['c4'], dependencyAtomIds: ['atom-001'] },
        { atomId: 'atom-004', title: 'Backfill legacy charges', reason: 'general', criterionIds: [], dependencyAtomIds: ['atom-002'] },
        { atomId: 'atom-005', title: 'Update reconciliation report', reason: 'general', criterionIds: ['c5'], dependencyAtomIds: ['atom-002'] },
      ],
      edges: [
        { fromAtomId: 'atom-001', toAtomId: 'atom-002', reason: 'depends' },
        { fromAtomId: 'atom-001', toAtomId: 'atom-003', reason: 'depends' },
      ],
    }),

    // Map phase: atom-001 + atom-002 done, atom-003 running, atom-004 skipped, atom-005 queued.
    eventAt('2024-01-15T10:00:04.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-001', status: 'running' }),
    eventAt('2024-01-15T10:00:04.000Z', { type: 'agent:start', sessionId, planId: 'atom-001', agentId: 'agent-atom-001', agent: 'planner', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'balanced', tierSource: 'role' }),
    eventAt('2024-01-15T10:00:40.000Z', { type: 'agent:result', sessionId, planId: 'atom-001', agentId: 'agent-atom-001', agent: 'planner', result: { durationMs: 36_000, durationApiMs: 34_000, numTurns: 2, totalCostUsd: 0.21, usage: { input: 142_000, output: 38_000, total: 180_000, cacheRead: 40_000, cacheCreation: 0 }, modelUsage: {}, resultText: 'Contract drafted.' } }),
    eventAt('2024-01-15T10:00:40.000Z', { type: 'agent:stop', sessionId, planId: 'atom-001', agentId: 'agent-atom-001', agent: 'planner' }),
    eventAt('2024-01-15T10:00:41.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-001', status: 'completed' }),

    eventAt('2024-01-15T10:00:42.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-002', status: 'running' }),
    eventAt('2024-01-15T10:00:42.000Z', { type: 'agent:start', sessionId, planId: 'atom-002', agentId: 'agent-atom-002', agent: 'planner', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'balanced', tierSource: 'role' }),
    eventAt('2024-01-15T10:01:30.000Z', { type: 'agent:result', sessionId, planId: 'atom-002', agentId: 'agent-atom-002', agent: 'planner', result: { durationMs: 48_000, durationApiMs: 45_000, numTurns: 3, totalCostUsd: 0.34, usage: { input: 210_000, output: 56_000, total: 266_000, cacheRead: 80_000, cacheCreation: 0 }, modelUsage: {}, resultText: 'Schema migrated.' } }),
    eventAt('2024-01-15T10:01:30.000Z', { type: 'agent:stop', sessionId, planId: 'atom-002', agentId: 'agent-atom-002', agent: 'planner' }),
    eventAt('2024-01-15T10:01:31.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-002', status: 'completed' }),

    eventAt('2024-01-15T10:01:32.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-003', status: 'running' }),
    eventAt('2024-01-15T10:01:32.000Z', { type: 'agent:start', sessionId, planId: 'atom-003', agentId: 'agent-atom-003', agent: 'planner', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'balanced', tierSource: 'role' }),

    eventAt('2024-01-15T10:01:33.000Z', { type: 'planning:map-reduce:atom:status', sessionId, atomId: 'atom-004', status: 'skipped', reason: 'no acceptance criteria mapped' }),

    // Reduce tree snapshot (built synchronously before the reduce loop).
    eventAt('2024-01-15T10:01:34.000Z', {
      type: 'planning:map-reduce:reduce-tree',
      sessionId,
      graphId: 'graph-payments-refactor-7f3a',
      rootNodeId: 'reduce-001',
      maxDepth: 1,
      nodeCount: 2,
      nodes: [
        { nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-001', 'atom-002', 'atom-003'], inputNodeIds: [] },
        { nodeId: 'reduce-001', depth: 1, inputAtomIds: ['atom-004', 'atom-005'], inputNodeIds: ['reduce-000'] },
      ],
    }),
    eventAt('2024-01-15T10:01:35.000Z', { type: 'planning:map-reduce:reduce:status', sessionId, nodeId: 'reduce-000', status: 'running' }),
    eventAt('2024-01-15T10:01:35.000Z', { type: 'agent:start', sessionId, planId: 'reduce-000', agentId: 'agent-reduce-000', agent: 'planner', model: 'pi-codex-5-5', harness: 'pi', harnessSource: 'tier', tier: 'max', tierSource: 'role' }),
  ];

  return runStateFromEvents(events.map((event, i) => ({ event, eventId: `map-reduce-${i + 1}` })));
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
