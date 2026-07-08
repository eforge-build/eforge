/**
 * Tests for run-state selectors:
 *   - getSummaryStats (summary-stats.ts)
 *   - selectPlanStatusCounts, selectCurrentStageForPlan, selectMiniGanttRows (plan-progress.ts)
 *   - selectStackLayersForRun (stack-layers.ts)
 */
import { describe, it, expect } from 'vitest';
import { getSummaryStats } from '../selectors/summary-stats';
import {
  selectPlanStatusCounts,
  selectCurrentStageForPlan,
  selectMiniGanttRows,
  selectPlanLanes,
  selectPlanningLane,
  PRE_PLANNING_AGENT_LABELS,
} from '../selectors/plan-progress';
import { LANE_REGISTRY } from '../lane-registry';
import { selectStackLayersForRun } from '../selectors/stack-layers';
import { selectBuildPhaseProgress } from '../selectors/phase-progress';
import { createInitialRunState, initialRunState, reduce } from '../reducer';
import type { RunState, EforgeEvent } from '../types';
import type { StackLayerWire } from '@eforge-build/client/browser';

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return { ...initialRunState, ...overrides };
}

function makeStoredEvent(event: unknown, eventId = 'evt-1'): { event: EforgeEvent; eventId: string } {
  return { event: event as EforgeEvent, eventId };
}

type OrchestrationConfig = NonNullable<RunState['earlyOrchestration']>;

function makeOrchestration(
  plans: Array<{ id: string; name: string } & Partial<OrchestrationConfig['plans'][number]>> = [],
): OrchestrationConfig {
  return {
    mode: 'compile',
    pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
    plans: plans.map((plan) => ({ dependsOn: [], build: [], review: { strategy: 'auto', maxRounds: 1 }, ...plan })),
  };
}

function makeLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'current-plan',
    stackId: 'stack-current',
    provider: 'git-spice',
    branch: 'eforge/current-plan',
    baseBranch: 'main',
    status: 'built',
    recordedAt: '2026-05-24T10:00:00.000Z',
    updatedAt: '2026-05-24T10:05:00.000Z',
    ...overrides,
  } as StackLayerWire;
}

// ---------------------------------------------------------------------------
// getSummaryStats
// ---------------------------------------------------------------------------
describe('getSummaryStats', () => {
  it('returns zero counts from initialRunState', () => {
    const stats = getSummaryStats(initialRunState);
    expect(stats.plansTotal).toBe(0);
    expect(stats.plansCompleted).toBe(0);
    expect(stats.tokensIn).toBe(0);
    expect(stats.tokensOut).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  it('reflects plan status counts', () => {
    const state = makeRunState({
      planStatuses: {
        'plan-01': 'complete',
        'plan-02': 'failed',
        'plan-03': 'implement',
      },
    });
    const stats = getSummaryStats(state);
    expect(stats.plansTotal).toBe(3);
    expect(stats.plansCompleted).toBe(1);
    expect(stats.plansFailed).toBe(1);
  });

  it('reflects accumulated token counts', () => {
    const state = makeRunState({
      tokensIn: 5000,
      tokensOut: 2500,
      totalCost: 0.025,
    });
    const stats = getSummaryStats(state);
    expect(stats.tokensIn).toBe(5000);
    expect(stats.tokensOut).toBe(2500);
    expect(stats.totalCost).toBeCloseTo(0.025, 8);
  });

  it('does not count unbacked resume seed ids before artifacts identify real plans', () => {
    const state = reduce(createInitialRunState(), {
      type: 'build:resume:state',
      timestamp: '2025-01-01T00:00:00.000Z',
      seededMerged: ['plan-01', 'plan-02'],
      seededPending: ['acceptance-validation'],
      featureBranch: 'eforge/feature-x',
      landedCommitCount: 2,
      diffStat: '2 files changed',
    } as EforgeEvent, 'resume-state');

    const stats = getSummaryStats(state);
    const counts = selectPlanStatusCounts(state);
    expect(stats.plansCompleted).toBe(0);
    expect(counts.complete).toBe(0);
    expect(counts.pending).toBe(0);
  });

  it('ignores stale synthetic statuses when orchestration identifies real plans', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'acceptance-validation': 'plan' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
    });

    expect(getSummaryStats(state).plansTotal).toBe(1);
    expect(selectPlanStatusCounts(state)).toEqual({ pending: 0, running: 0, complete: 1, failed: 0, total: 1 });
    expect(selectMiniGanttRows(state).map((row) => row.planId)).toEqual(['plan-01']);
  });

  it('ignores stale synthetic statuses when resume artifacts identify real plans', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'acceptance-validation': 'plan' },
      resumeArtifacts: [{ id: 'plan-01', name: 'Plan One', body: '# Plan One' }],
    });

    expect(getSummaryStats(state).plansTotal).toBe(1);
    expect(selectPlanStatusCounts(state)).toEqual({ pending: 0, running: 0, complete: 1, failed: 0, total: 1 });
    expect(selectMiniGanttRows(state).map((row) => row.planId)).toEqual(['plan-01']);
  });

  it('does not fall back to stale statuses when orchestration context is present but empty', () => {
    const state = makeRunState({
      planStatuses: { 'acceptance-validation': 'plan' },
      earlyOrchestration: makeOrchestration(),
    });

    expect(getSummaryStats(state).plansTotal).toBe(0);
    expect(selectPlanStatusCounts(state)).toEqual({ pending: 0, running: 0, complete: 0, failed: 0, total: 0 });
    expect(selectMiniGanttRows(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectPlanStatusCounts
// ---------------------------------------------------------------------------
describe('selectPlanStatusCounts', () => {
  it('returns all-zero counts from initialRunState', () => {
    const counts = selectPlanStatusCounts(initialRunState);
    expect(counts).toEqual({ pending: 0, running: 0, complete: 0, failed: 0, total: 0 });
  });

  it('counts plan stages correctly', () => {
    const state = makeRunState({
      planStatuses: {
        'plan-01': 'complete',
        'plan-02': 'failed',
        'plan-03': 'implement',
        'plan-04': 'review',
        'plan-05': 'plan',
      },
    });
    const counts = selectPlanStatusCounts(state);
    expect(counts.complete).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.running).toBe(2); // implement + review
    expect(counts.pending).toBe(1); // plan
    expect(counts.total).toBe(5);
  });

  it('includes plans from earlyOrchestration not yet in planStatuses', () => {
    const state = makeRunState({
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One' },
        { id: 'plan-02', name: 'Plan Two' },
      ]),
    });
    const counts = selectPlanStatusCounts(state);
    expect(counts.total).toBe(2);
    expect(counts.pending).toBe(2); // no stages yet → pending
  });
});

// ---------------------------------------------------------------------------
// selectCurrentStageForPlan
// ---------------------------------------------------------------------------
describe('selectCurrentStageForPlan', () => {
  it('returns undefined for unknown planId', () => {
    expect(selectCurrentStageForPlan(initialRunState, 'unknown')).toBeUndefined();
  });

  it('returns the current stage for a tracked plan', () => {
    const state = makeRunState({ planStatuses: { 'plan-01': 'review' } });
    expect(selectCurrentStageForPlan(state, 'plan-01')).toBe('review');
  });
});

// ---------------------------------------------------------------------------
// selectMiniGanttRows
// ---------------------------------------------------------------------------
describe('selectMiniGanttRows', () => {
  it('returns empty array from initialRunState', () => {
    expect(selectMiniGanttRows(initialRunState)).toEqual([]);
  });

  it('returns rows ordered by earlyOrchestration plans when present', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'plan-02': 'implement' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One' },
        { id: 'plan-02', name: 'Plan Two', dependsOn: ['plan-01'] },
      ]),
    });
    const rows = selectMiniGanttRows(state);
    expect(rows).toHaveLength(2);
    expect(rows[0].planId).toBe('plan-01');
    expect(rows[0].planName).toBe('Plan One');
    expect(rows[0].isComplete).toBe(true);
    expect(rows[0].isFailed).toBe(false);
    expect(rows[1].planId).toBe('plan-02');
    expect(rows[1].dependsOn).toEqual(['plan-01']);
    expect(rows[1].isComplete).toBe(false);
  });

  it('falls back to alphabetically sorted planStatuses keys when no earlyOrchestration', () => {
    const state = makeRunState({
      planStatuses: { 'plan-02': 'complete', 'plan-01': 'failed' },
    });
    const rows = selectMiniGanttRows(state);
    expect(rows).toHaveLength(2);
    expect(rows[0].planId).toBe('plan-01'); // alphabetically first
    expect(rows[0].isFailed).toBe(true);
    expect(rows[1].planId).toBe('plan-02');
    expect(rows[1].isComplete).toBe(true);
  });

  it('fallback rows have empty dependsOn and planId as planName', () => {
    const state = makeRunState({ planStatuses: { 'plan-01': 'implement' } });
    const rows = selectMiniGanttRows(state);
    expect(rows[0].dependsOn).toEqual([]);
    expect(rows[0].planName).toBe('plan-01');
  });

  it('counts active worker threads per plan', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [
        { planId: 'plan-01', agent: 'builder', endedAt: null },
        { planId: 'plan-01', agent: 'tester', endedAt: null },
        { planId: 'plan-01', agent: 'reviewer', endedAt: '2026-05-24T10:00:00.000Z' },
        { agent: 'planner', endedAt: null },
      ] as RunState['agentThreads'],
    });
    const rows = selectMiniGanttRows(state);
    expect(rows[0].activeWorkerCount).toBe(2);
    expect(rows[0].activeAgents).toEqual(['builder', 'tester']);
  });
});

// ---------------------------------------------------------------------------
// selectPlanLanes
// ---------------------------------------------------------------------------
describe('selectPlanLanes', () => {
  it('returns empty array from initialRunState', () => {
    expect(selectPlanLanes(initialRunState)).toEqual([]);
  });

  it('carries build-stage sequence and every plan agent (running and done) in start order', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'review', 'plan-02': 'complete' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One', build: ['implement', 'test-cycle', 'review-cycle'] },
        { id: 'plan-02', name: 'Plan Two', dependsOn: ['plan-01'], build: ['implement'] },
      ]),
      agentThreads: [
        // builder finished, reviewer still running — both must appear, builder first.
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 1_700_000 },
        { planId: 'plan-01', agent: 'reviewer', startedAt: '2026-05-24T10:03:00.000Z', endedAt: null, totalTokens: 5000 },
        { planId: 'plan-02', agent: 'builder', startedAt: '2026-05-24T09:00:00.000Z', endedAt: '2026-05-24T09:30:00.000Z', totalTokens: 42_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes).toHaveLength(2);

    expect(lanes[0].planId).toBe('plan-01');
    expect(lanes[0].buildStages).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(lanes[0].isComplete).toBe(false);
    expect(lanes[0].agents).toEqual([
      { agent: 'builder', tokens: 1_700_000, running: false },
      { agent: 'reviewer', tokens: 5000, running: true },
    ]);

    expect(lanes[1].planId).toBe('plan-02');
    expect(lanes[1].isComplete).toBe(true);
    expect(lanes[1].agents).toEqual([{ agent: 'builder', tokens: 42_000, running: false }]);
  });

  it('sums tokens across repeated agent roles (e.g. review rounds)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'review' },
      agentThreads: [
        { planId: 'plan-01', agent: 'reviewer', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:01:00.000Z', totalTokens: 100_000 },
        { planId: 'plan-01', agent: 'reviewer', startedAt: '2026-05-24T10:05:00.000Z', endedAt: null, totalTokens: 30_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes[0].agents).toEqual([{ agent: 'reviewer', tokens: 130_000, running: true }]);
  });

  it('treats missing token totals as zero and marks failed plans', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'failed' },
      agentThreads: [
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: null, totalTokens: null },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes[0].isFailed).toBe(true);
    expect(lanes[0].buildStages).toEqual([]); // no orchestration
    expect(lanes[0].agents).toEqual([{ agent: 'builder', tokens: 0, running: true }]);
  });

  it('appends a dynamically-added gap-close lane after the orchestration plans', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'gap-close': 'review' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One', build: ['implement', 'review-cycle'] },
      ]),
      agentThreads: [
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 100_000 },
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:05:00.000Z', totalTokens: 200_000 },
        { planId: 'gap-close', agent: 'reviewer', startedAt: '2026-05-24T11:06:00.000Z', endedAt: null, totalTokens: 5_900_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes.map((l) => l.planId)).toEqual(['plan-01', 'gap-close']);

    const gapClose = lanes[1];
    expect(gapClose.planName).toBe('Gap Close');
    expect(gapClose.stage).toBe('review');
    expect(gapClose.buildStages).toEqual([]); // compiled on demand, not in orchestration
    expect(gapClose.agents).toEqual([
      { agent: 'builder', tokens: 200_000, running: false },
      { agent: 'reviewer', tokens: 5_900_000, running: true },
    ]);
  });

  it('surfaces a feature-branch base-sync lane present only via live merge-resolver threads', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One', build: ['implement'] },
      ]),
      agentThreads: [
        { planId: 'eforge/feature-x', agent: 'merge-conflict-resolver', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 1_000 },
      ] as RunState['agentThreads'],
    });

    const lanes = selectPlanLanes(state);
    expect(lanes.map((l) => l.planId)).toEqual(['plan-01', 'eforge/feature-x']);
    expect(lanes[1].planName).toBe('Feature branch: eforge/feature-x');
    expect(lanes[1].agents).toEqual([{ agent: 'merge-conflict-resolver', tokens: 1_000, running: true }]);
  });

  it('surfaces a gap-close lane present only via live threads (no status yet)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One', build: ['implement'] },
      ]),
      agentThreads: [
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 1_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes.map((l) => l.planId)).toEqual(['plan-01', 'gap-close']);
    expect(lanes[1].planName).toBe('Gap Close');
  });
});

// ---------------------------------------------------------------------------
// selectBuildPhaseProgress
// ---------------------------------------------------------------------------
describe('selectBuildPhaseProgress', () => {
  it('keeps planning running while map/reduce reduce work is queued or running', () => {
    const state = makeRunState({
      events: [
        makeStoredEvent({
          type: 'planning:map-reduce:atoms',
          timestamp: '2026-05-24T10:00:00.000Z',
          graphId: 'graph-1',
          atomCount: 1,
          edgeCount: 0,
          atoms: [{ atomId: 'atom-a', title: 'Atom A', reason: 'subsystem', criterionIds: [], dependencyAtomIds: [] }],
          edges: [],
        }),
      ],
      mapReduce: {
        graphId: 'graph-1',
        atomCount: 1,
        edgeCount: 0,
        edges: [],
        atoms: { 'atom-a': { atomId: 'atom-a', title: 'Atom A', reason: 'subsystem', criterionIds: [], dependencyAtomIds: [], status: 'completed' } },
        atomOrder: ['atom-a'],
        maxDepth: 1,
        nodeCount: 2,
        reduceNodes: {
          'reduce-000': { nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-a'], inputNodeIds: [], status: 'running' },
          'reduce-001': { nodeId: 'reduce-001', depth: 1, inputAtomIds: [], inputNodeIds: ['reduce-000'], status: 'queued' },
        },
        reduceOrder: ['reduce-000', 'reduce-001'],
      },
      agentThreads: [
        // The reduce-000 thread has ended, so ONLY the queued/running node
        // statuses can drive the running verdict here.
        { planId: 'reduce-000', agent: 'planner', agentId: 'agent-1', startedAt: '2026-05-24T10:01:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', durationMs: null, durationApiMs: null, inputTokens: null, outputTokens: null, totalTokens: null, cacheRead: null, cacheCreation: null, costUsd: null, numTurns: null, model: 'test' },
      ],
    });

    expect(selectBuildPhaseProgress(state).prd).toBe('running');
    // The same state must be safe for the planning lane, which iterates the
    // atoms event payload, and it must agree planning is still live.
    expect(selectPlanningLane(state).running).toBe(true);
  });

  it('keeps planning running via a live map/reduce member thread when node statuses are already terminal', () => {
    const state = makeRunState({
      mapReduce: {
        graphId: 'graph-1',
        atomCount: 1,
        edgeCount: 0,
        edges: [],
        atoms: { 'atom-a': { atomId: 'atom-a', title: 'Atom A', reason: 'subsystem', criterionIds: [], dependencyAtomIds: [], status: 'completed' } },
        atomOrder: ['atom-a'],
        maxDepth: 0,
        nodeCount: 1,
        reduceNodes: {
          'reduce-000': { nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-a'], inputNodeIds: [], status: 'completed' },
        },
        reduceOrder: ['reduce-000'],
      },
      agentThreads: [
        { planId: 'reduce-000', agent: 'planner', agentId: 'agent-1', startedAt: '2026-05-24T10:01:00.000Z', endedAt: null, durationMs: null, durationApiMs: null, inputTokens: null, outputTokens: null, totalTokens: null, cacheRead: null, cacheCreation: null, costUsd: null, numTurns: null, model: 'test' },
      ],
    });

    expect(selectBuildPhaseProgress(state).prd).toBe('running');
  });

  it('treats command validation as PRD-check work before prd_validation starts', () => {
    const state = makeRunState({
      earlyOrchestration: makeOrchestration(),
      validationCommands: [
        { command: 'pnpm test', startedAt: '2026-05-24T10:00:00.000Z', endedAt: null, status: 'running', exitCode: null },
      ],
    });

    expect(selectBuildPhaseProgress(state).prdValidation).toBe('running');
  });

  it('marks completed PRD validation done instead of active', () => {
    const state = makeRunState({
      events: [
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T10:00:00.000Z' }, '1'),
        makeStoredEvent({ type: 'prd_validation:complete', timestamp: '2026-05-24T10:01:00.000Z', passed: true, gaps: [], completionPercent: 100 }, '2'),
      ],
    });

    expect(selectBuildPhaseProgress(state).prdValidation).toBe('passed');
  });

  it('does not mark failed gap close as done', () => {
    const state = makeRunState({
      events: [
        makeStoredEvent({ type: 'gap_close:start', timestamp: '2026-05-24T10:00:00.000Z', gapCount: 1 }, '1'),
        makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T10:01:00.000Z', passed: false }, '2'),
      ],
    });

    const progress = selectBuildPhaseProgress(state);
    expect(progress.gapClose).toBe('failed');
    expect(progress.finalValidation).toBe('pending');
  });

  it('fails planning immediately on planning:error even with a live planning thread', () => {
    const state = makeRunState({
      events: [makeStoredEvent({ type: 'planning:error', timestamp: '2026-05-24T09:05:00.000Z', message: 'compiler crashed' })],
      agentThreads: [
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: null, totalTokens: 1_000 },
      ] as RunState['agentThreads'],
    });

    expect(selectBuildPhaseProgress(state).prd).toBe('failed');
  });

  it('marks planning skipped on planning:skip and passed on planning:complete', () => {
    const skipped = makeRunState({
      events: [makeStoredEvent({ type: 'planning:skip', timestamp: '2026-05-24T09:00:00.000Z', reason: 'compiled plan supplied' })],
    });
    const completed = makeRunState({
      events: [makeStoredEvent({ type: 'planning:complete', timestamp: '2026-05-24T09:00:00.000Z', plans: [] })],
    });

    expect(selectBuildPhaseProgress(skipped).prd).toBe('skipped');
    expect(selectBuildPhaseProgress(completed).prd).toBe('passed');
  });

  it('keeps planning running after planning:complete while a planning thread is still live', () => {
    const state = makeRunState({
      events: [makeStoredEvent({ type: 'planning:complete', timestamp: '2026-05-24T09:05:00.000Z', plans: [] })],
      agentThreads: [
        { planId: 'planning', agent: 'plan-reviewer', startedAt: '2026-05-24T09:04:00.000Z', endedAt: null, totalTokens: 500 },
      ] as RunState['agentThreads'],
    });

    expect(selectBuildPhaseProgress(state).prd).toBe('running');
  });

  it('keeps plans running when some plans are complete and none are currently active', () => {
    // 3 plans, 2 complete, 1 not started: the phase already showed progress,
    // so it must not fall back to pending while the next plan waits.
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'plan-02': 'complete' },
      earlyOrchestration: makeOrchestration([
        { id: 'plan-01', name: 'Plan One' },
        { id: 'plan-02', name: 'Plan Two' },
        { id: 'plan-03', name: 'Plan Three', dependsOn: ['plan-02'] },
      ]),
    });

    expect(selectBuildPhaseProgress(state).plans).toBe('running');
  });

  it('partitions validation activity around the earliest gap_close:complete regardless of its outcome', () => {
    const state = makeRunState({
      events: [
        // First-round check: completed with gaps (passed:false) still reads as
        // passed — the follow-up work renders as the gap-close phase.
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T10:01:00.000Z' }, '1'),
        makeStoredEvent({ type: 'prd_validation:complete', timestamp: '2026-05-24T10:02:00.000Z', passed: false, gaps: [{ id: 'gap-1' }], completionPercent: 80 }, '2'),
        // Boundary: earliest gap_close:complete of ANY outcome, here a failure.
        makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T11:00:00.000Z', passed: false }, '3'),
        // Final check: honors the event verdict — passed:false means failed.
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T11:06:00.000Z' }, '4'),
        makeStoredEvent({ type: 'prd_validation:complete', timestamp: '2026-05-24T11:07:00.000Z', passed: false, gaps: [{ id: 'gap-1' }], completionPercent: 90 }, '5'),
      ],
      validationCommands: [
        { command: 'pnpm test', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:00:30.000Z', status: 'passed', exitCode: 0 },
        // Starts exactly at the gap-close boundary: at/after counts as final validation.
        { command: 'pnpm test', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:05:00.000Z', status: 'passed', exitCode: 0 },
      ],
    });

    expect(selectBuildPhaseProgress(state)).toEqual({
      prd: 'pending',
      plans: 'pending',
      prdValidation: 'passed',
      gapClose: 'failed',
      finalValidation: 'failed',
      landing: 'pending',
    });
  });

  it('lets a later passing final prd_validation:complete supersede an earlier failing one', () => {
    const state = makeRunState({
      events: [
        makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T11:00:00.000Z', passed: true }, '1'),
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T11:06:00.000Z' }, '2'),
        makeStoredEvent({ type: 'prd_validation:complete', timestamp: '2026-05-24T11:07:00.000Z', passed: false, gaps: [{ id: 'gap-1' }], completionPercent: 90 }, '3'),
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T11:10:00.000Z' }, '4'),
        makeStoredEvent({ type: 'prd_validation:complete', timestamp: '2026-05-24T11:12:00.000Z', passed: true, gaps: [], completionPercent: 100 }, '5'),
      ],
    });

    expect(selectBuildPhaseProgress(state).finalValidation).toBe('passed');
  });

  it('maps landing lifecycle events to landing status with the last event winning', () => {
    const landingFor = (events: unknown[]) =>
      selectBuildPhaseProgress(makeRunState({
        events: events.map((event, index) => makeStoredEvent(event, `evt-${index}`)),
      })).landing;

    expect(landingFor([{ type: 'landing:start', timestamp: '2026-05-24T11:00:00.000Z' }])).toBe('running');
    expect(landingFor([{ type: 'landing:auto-merge:start', timestamp: '2026-05-24T11:00:00.000Z' }])).toBe('running');
    expect(landingFor([
      { type: 'landing:start', timestamp: '2026-05-24T11:00:00.000Z' },
      { type: 'landing:complete', timestamp: '2026-05-24T11:05:00.000Z' },
    ])).toBe('passed');
    expect(landingFor([
      { type: 'landing:auto-merge:start', timestamp: '2026-05-24T11:00:00.000Z' },
      { type: 'landing:auto-merge:complete', timestamp: '2026-05-24T11:05:00.000Z' },
    ])).toBe('passed');
    expect(landingFor([{ type: 'landing:skipped', timestamp: '2026-05-24T11:00:00.000Z' }])).toBe('skipped');
    expect(landingFor([{ type: 'landing:auto-merge:skipped', timestamp: '2026-05-24T11:00:00.000Z' }])).toBe('skipped');
    expect(landingFor([{ type: 'stack:landing:update', timestamp: '2026-05-24T11:00:00.000Z', status: 'started' }])).toBe('running');
    expect(landingFor([
      { type: 'stack:landing:update', timestamp: '2026-05-24T11:00:00.000Z', status: 'started' },
      { type: 'stack:landing:update', timestamp: '2026-05-24T11:05:00.000Z', status: 'complete' },
    ])).toBe('passed');
    expect(landingFor([{ type: 'stack:landing:update', timestamp: '2026-05-24T11:00:00.000Z', status: 'skipped' }])).toBe('skipped');
  });

  it('backfills earlier phases when landing starts, preserving skipped prd and pending gap phases', () => {
    const state = makeRunState({
      // One plan mid-flight: plans reads 'running' before backfill.
      planStatuses: { 'plan-01': 'complete', 'plan-02': 'implement' },
      events: [
        makeStoredEvent({ type: 'planning:skip', timestamp: '2026-05-24T09:00:00.000Z', reason: 'compiled plan supplied' }, '1'),
        // prd_validation started with no complete: 'running' before backfill.
        makeStoredEvent({ type: 'prd_validation:start', timestamp: '2026-05-24T10:00:00.000Z' }, '2'),
        makeStoredEvent({ type: 'landing:start', timestamp: '2026-05-24T11:00:00.000Z' }, '3'),
      ],
    });

    expect(selectBuildPhaseProgress(state)).toEqual({
      // planning:skip is preserved — no phantom green check from the backfill.
      prd: 'skipped',
      plans: 'passed',
      prdValidation: 'passed',
      // Gap-free builds never ran these: pending is preserved.
      gapClose: 'pending',
      finalValidation: 'pending',
      landing: 'running',
    });
  });

  it('reports landing failed on stack:landing:update failed while backfilling earlier phases', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      events: [
        makeStoredEvent({ type: 'planning:complete', timestamp: '2026-05-24T09:00:00.000Z', plans: [] }, '1'),
        makeStoredEvent({ type: 'stack:landing:update', timestamp: '2026-05-24T11:00:00.000Z', status: 'started' }, '2'),
        makeStoredEvent({ type: 'stack:landing:update', timestamp: '2026-05-24T11:05:00.000Z', status: 'failed' }, '3'),
      ],
    });

    expect(selectBuildPhaseProgress(state)).toEqual({
      prd: 'passed',
      plans: 'passed',
      prdValidation: 'passed',
      gapClose: 'pending',
      finalValidation: 'pending',
      landing: 'failed',
    });
  });
});

// ---------------------------------------------------------------------------
// selectPlanningLane
// ---------------------------------------------------------------------------
describe('selectPlanningLane', () => {
  it('returns empty lane from initialRunState', () => {
    expect(selectPlanningLane(initialRunState)).toEqual({ agents: [], running: false });
  });

  it('aggregates planning-lane agents by role in start order, summing tokens', () => {
    const state = makeRunState({
      agentThreads: [
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:05:00.000Z', totalTokens: 4_900_000 },
        { planId: 'planning', agent: 'plan-reviewer', startedAt: '2026-05-24T10:05:00.000Z', endedAt: '2026-05-24T10:06:00.000Z', totalTokens: 100_000 },
        { planId: 'planning', agent: 'plan-reviewer', startedAt: '2026-05-24T10:07:00.000Z', endedAt: null, totalTokens: 84_500 },
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:08:00.000Z', endedAt: null, totalTokens: 1000 },
      ] as RunState['agentThreads'],
    });
    const lane = selectPlanningLane(state);
    expect(lane.running).toBe(true); // second plan-reviewer thread still running
    expect(lane.agents).toEqual([
      { agent: 'planner', tokens: 4_900_000, running: false },
      { agent: 'plan-reviewer', tokens: 184_500, running: true },
    ]);
  });

  it('includes planning agents and excludes validation/final-validation threads', () => {
    const state = makeRunState({
      agentThreads: [
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:05:00.000Z', totalTokens: 1_000_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T10:06:00.000Z', endedAt: null, totalTokens: 500_000 },
        { planId: 'final-validation', agent: 'prd-validator', startedAt: '2026-05-24T10:07:00.000Z', endedAt: null, totalTokens: 200_000 },
      ] as RunState['agentThreads'],
    });
    const lane = selectPlanningLane(state);
    expect(lane.agents).toEqual([
      { agent: 'planner', tokens: 1_000_000, running: false },
    ]);
    expect(lane.running).toBe(false);
  });

  it('folds pre-planning phase threads (satisfaction gate, repo exploration) into the planning lane with phase labels', () => {
    const state = makeRunState({
      agentThreads: [
        { planId: 'satisfaction-gate', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: '2026-05-24T09:02:00.000Z', totalTokens: 899_000 },
        { planId: 'repository-exploration', agent: 'planner', startedAt: '2026-05-24T09:02:00.000Z', endedAt: '2026-05-24T09:05:00.000Z', totalTokens: 404_200 },
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T09:05:00.000Z', endedAt: null, totalTokens: 100_000 },
      ] as RunState['agentThreads'],
    });
    const lane = selectPlanningLane(state);
    // Phase threads are relabelled so they do not merge with the planner role,
    // and ordering follows first start: gate → exploration → planner.
    expect(lane.agents).toEqual([
      { agent: 'satisfaction-gate', tokens: 899_000, running: false },
      { agent: 'repo-exploration', tokens: 404_200, running: false },
      { agent: 'planner', tokens: 100_000, running: true },
    ]);
    expect(lane.running).toBe(true);
  });

  it('reports running while only pre-planning phase agents are live', () => {
    const state = makeRunState({
      agentThreads: [
        { planId: 'satisfaction-gate', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: null, totalTokens: 10_000 },
      ] as RunState['agentThreads'],
    });
    const lane = selectPlanningLane(state);
    expect(lane.agents).toEqual([{ agent: 'satisfaction-gate', tokens: 10_000, running: true }]);
    expect(lane.running).toBe(true);
  });

  it('adds compact map/reduce groups to the planning lane', () => {
    const state = makeRunState({
      mapReduce: {
        graphId: 'graph-1',
        atomCount: 2,
        edgeCount: 0,
        edges: [],
        atoms: {
          'atom-a': { atomId: 'atom-a', title: 'Atom A', reason: 'subsystem', criterionIds: [], dependencyAtomIds: [], status: 'completed' },
          'atom-b': { atomId: 'atom-b', title: 'Atom B', reason: 'subsystem', criterionIds: [], dependencyAtomIds: [], status: 'completed' },
        },
        atomOrder: ['atom-a', 'atom-b'],
        maxDepth: 1,
        nodeCount: 1,
        reduceNodes: {
          'reduce-000': { nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-a', 'atom-b'], inputNodeIds: [], status: 'running' },
        },
        reduceOrder: ['reduce-000'],
      },
      agentThreads: [
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: '2026-05-24T09:01:00.000Z', totalTokens: 100 },
        { planId: 'atom-a', agent: 'planner', startedAt: '2026-05-24T09:01:00.000Z', endedAt: '2026-05-24T09:02:00.000Z', totalTokens: 1_000 },
        { planId: 'atom-b', agent: 'planner', startedAt: '2026-05-24T09:01:00.000Z', endedAt: '2026-05-24T09:02:00.000Z', totalTokens: 2_000 },
        { planId: 'reduce-000', agent: 'planner', startedAt: '2026-05-24T09:02:00.000Z', endedAt: null, totalTokens: 500 },
        { planId: 'planning', agent: 'plan-reviewer', startedAt: '2026-05-24T09:03:00.000Z', endedAt: null, totalTokens: 200 },
      ] as RunState['agentThreads'],
    });

    const lane = selectPlanningLane(state);
    expect(lane.agents).toEqual([
      { agent: 'planner', tokens: 100, running: false },
      { agent: 'map atoms (2)', tokens: 3_000, running: false },
      { agent: 'reduce L1 (1)', tokens: 500, running: true },
      { agent: 'plan-reviewer', tokens: 200, running: true },
    ]);
    expect(lane.running).toBe(true);
  });

  it('excludes plan-less threads (no planId) from the planning lane', () => {
    const state = makeRunState({
      agentThreads: [
        { agent: 'planner', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:05:00.000Z', totalTokens: 1_000_000 },
        { planId: 'planning', agent: 'plan-reviewer', startedAt: '2026-05-24T10:06:00.000Z', endedAt: null, totalTokens: 100_000 },
      ] as RunState['agentThreads'],
    });
    const lane = selectPlanningLane(state);
    // Only the thread with planId 'planning' is included
    expect(lane.agents).toEqual([
      { agent: 'plan-reviewer', tokens: 100_000, running: true },
    ]);
  });

  it('keeps PRE_PLANNING_AGENT_LABELS in sync with the order-0 phase lanes in the lane registry', () => {
    // Every order-0 phase lane folds into the planning row: 'planning' itself
    // directly, and each other order-0 lane via PRE_PLANNING_AGENT_LABELS. If a
    // new order-0 lane is registered without a label entry, its threads would
    // silently vanish from the swimlane (excluded as a separate lane by
    // selectPlanLanes but never folded in by selectPlanningLane).
    const orderZeroPhaseIds = LANE_REGISTRY
      .filter((entry) => entry.kind === 'phase' && entry.order === 0)
      .map((entry) => entry.id)
      .filter((id) => id !== 'planning')
      .sort();
    expect(Object.keys(PRE_PLANNING_AGENT_LABELS).sort()).toEqual(orderZeroPhaseIds);
  });
});

// ---------------------------------------------------------------------------
// selectPlanLanes - lane registry ordering and exclusion
// ---------------------------------------------------------------------------
describe('selectPlanLanes - lane registry', () => {
  it('orders extras as plans, then validation, then gap-close, then final-validation', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 100_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 50_000 },
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:05:00.000Z', endedAt: null, totalTokens: 60_000 },
        { planId: 'final-validation', agent: 'prd-validator', startedAt: '2026-05-24T11:10:00.000Z', endedAt: null, totalTokens: 30_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes.map((l) => l.planId)).toEqual(['plan-01', 'validation', 'gap-close', 'final-validation']);
  });

  it('omits gap-close and final-validation lanes when no threads carry those lane ids', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 100_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 50_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes.map((l) => l.planId)).toEqual(['plan-01', 'validation']);
    // gap-close and final-validation are absent
    expect(lanes.find((l) => l.planId === 'gap-close')).toBeUndefined();
    expect(lanes.find((l) => l.planId === 'final-validation')).toBeUndefined();
  });

  it('does NOT emit a planning lane, but DOES emit validation/gap-close/final-validation when their threads exist', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'planning', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: '2026-05-24T09:05:00.000Z', totalTokens: 100_000 },
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 100_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 50_000 },
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:05:00.000Z', endedAt: null, totalTokens: 60_000 },
        { planId: 'final-validation', agent: 'prd-validator', startedAt: '2026-05-24T11:10:00.000Z', endedAt: null, totalTokens: 30_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    const ids = lanes.map((l) => l.planId);
    expect(ids).not.toContain('planning');
    expect(ids).toContain('validation');
    expect(ids).toContain('gap-close');
    expect(ids).toContain('final-validation');
  });

  it('labels backed phase lanes via the lane registry', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'gap-close': 'implement', 'validation': 'implement', 'final-validation': 'implement' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      events: [makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T11:08:00.000Z', passed: true })],
      validationCommands: [
        { command: 'pnpm type-check', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:01:00.000Z', status: 'passed', exitCode: 0 },
        { command: 'pnpm test', startedAt: '2026-05-24T11:10:00.000Z', endedAt: '2026-05-24T11:11:00.000Z', status: 'passed', exitCode: 0 },
      ],
      agentThreads: [
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:05:00.000Z', endedAt: null, totalTokens: 60_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    const gapClose = lanes.find((l) => l.planId === 'gap-close');
    const validation = lanes.find((l) => l.planId === 'validation');
    const finalValidation = lanes.find((l) => l.planId === 'final-validation');
    expect(gapClose?.planName).toBe('Gap Close');
    expect(validation?.planName).toBe('Validation');
    expect(finalValidation?.planName).toBe('Final Validation');
  });

  it('excludes unbacked synthetic resume seed ids while retaining backed phase lanes', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', 'acceptance-validation': 'plan', 'gap-close': 'implement' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:05:00.000Z', endedAt: null, totalTokens: 60_000 },
      ] as RunState['agentThreads'],
    });
    const ids = selectPlanLanes(state).map((lane) => lane.planId);
    expect(ids).toEqual(['plan-01', 'gap-close']);
    expect(ids).not.toContain('acceptance-validation');
  });

  it('excludes thread-only synthetic resume seed ids while retaining real plans and backed phase lanes', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'acceptance-validation', agent: 'builder', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 50_000 },
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:05:00.000Z', endedAt: null, totalTokens: 60_000 },
      ] as RunState['agentThreads'],
    });
    const ids = selectPlanLanes(state).map((lane) => lane.planId);
    expect(ids).toEqual(['plan-01', 'gap-close']);
    expect(ids).not.toContain('acceptance-validation');
  });

  it('excludes unbacked registered phase statuses', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete', validation: 'implement', 'gap-close': 'implement', 'final-validation': 'implement' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
    });

    expect(selectPlanLanes(state).map((lane) => lane.planId)).toEqual(['plan-01']);
  });

  it('creates validation and final-validation lanes from validation command spans without plan statuses', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      events: [makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T11:08:00.000Z', passed: true })],
      validationCommands: [
        { command: 'pnpm type-check', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:01:00.000Z', status: 'passed', exitCode: 0 },
        { command: 'pnpm test', startedAt: '2026-05-24T11:10:00.000Z', endedAt: '2026-05-24T11:11:00.000Z', status: 'passed', exitCode: 0 },
      ],
    });

    expect(selectPlanLanes(state).map((lane) => lane.planId)).toEqual(['plan-01', 'validation', 'final-validation']);
  });

  it('never emits separate lanes for pre-planning phases (they fold into the planning row)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'implement' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'satisfaction-gate', agent: 'planner', startedAt: '2026-05-24T09:00:00.000Z', endedAt: '2026-05-24T09:02:00.000Z', totalTokens: 899_000 },
        { planId: 'repository-exploration', agent: 'planner', startedAt: '2026-05-24T09:02:00.000Z', endedAt: '2026-05-24T09:05:00.000Z', totalTokens: 404_200 },
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: null, totalTokens: 100_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: null, totalTokens: 50_000 },
      ] as RunState['agentThreads'],
    });
    expect(selectPlanLanes(state).map((lane) => lane.planId)).toEqual(['plan-01', 'validation']);
  });

  it('derives completion for phase lanes whose threads have all ended (no plan:status:change ever arrives)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:05:00.000Z', totalTokens: 50_000 },
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:06:00.000Z', endedAt: null, totalTokens: 60_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    const validation = lanes.find((l) => l.planId === 'validation');
    const gapClose = lanes.find((l) => l.planId === 'gap-close');
    expect(validation?.isComplete).toBe(true); // all threads ended
    expect(validation?.isFailed).toBe(false);
    expect(validation?.stage).toBeUndefined(); // derivation does not fabricate a stage
    expect(gapClose?.isComplete).toBe(false); // still running
  });

  it('derives completion from ended validation command spans (command-only lanes)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      validationCommands: [
        { command: 'pnpm type-check', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:01:00.000Z', status: 'passed', exitCode: 0 },
      ],
    });
    const validation = selectPlanLanes(state).find((l) => l.planId === 'validation');
    expect(validation?.isComplete).toBe(true);
  });

  it('does not derive completion when the last final-validation command failed (run aborted on the failure)', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      events: [makeStoredEvent({ type: 'gap_close:complete', timestamp: '2026-05-24T11:08:00.000Z', passed: true })],
      validationCommands: [
        // Pre-gap-close validation passed → validation lane still derives done.
        { command: 'pnpm type-check', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:01:00.000Z', status: 'passed', exitCode: 0 },
        // Final validation failed and the run aborted: everything has ended,
        // but the phase must not render as complete.
        { command: 'pnpm test', startedAt: '2026-05-24T11:10:00.000Z', endedAt: '2026-05-24T11:11:00.000Z', status: 'failed', exitCode: 1 },
      ],
    });
    const lanes = selectPlanLanes(state);
    const validation = lanes.find((l) => l.planId === 'validation');
    const finalValidation = lanes.find((l) => l.planId === 'final-validation');
    expect(validation?.isComplete).toBe(true); // passed phase still derives done
    expect(finalValidation?.isComplete).toBe(false); // last outcome failed
  });

  it('does not derive completion when the last validation command timed out', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      validationCommands: [
        { command: 'pnpm test', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:20:00.000Z', status: 'timeout', exitCode: null },
      ],
    });
    const validation = selectPlanLanes(state).find((l) => l.planId === 'validation');
    expect(validation?.isComplete).toBe(false);
  });

  it('derives completion again when a later command run supersedes an earlier failure', () => {
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      validationCommands: [
        { command: 'pnpm test', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:01:00.000Z', status: 'failed', exitCode: 1 },
        { command: 'pnpm test', startedAt: '2026-05-24T11:05:00.000Z', endedAt: '2026-05-24T11:06:00.000Z', status: 'passed', exitCode: 0 },
      ],
    });
    const validation = selectPlanLanes(state).find((l) => l.planId === 'validation');
    expect(validation?.isComplete).toBe(true);
  });

  it('does not derive completion when a new running thread re-activates a phase lane', () => {
    // One fixer round ended, a fresh round just started: the lane is live
    // again, not complete.
    const state = makeRunState({
      planStatuses: { 'plan-01': 'complete' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:05:00.000Z', totalTokens: 50_000 },
        { planId: 'validation', agent: 'validation-fixer', startedAt: '2026-05-24T11:06:00.000Z', endedAt: null, totalTokens: 1_000 },
      ] as RunState['agentThreads'],
    });
    const validation = selectPlanLanes(state).find((l) => l.planId === 'validation');
    expect(validation?.isComplete).toBe(false);
  });

  it('does not derive completion when an explicit stage exists or for real plans without status', () => {
    const state = makeRunState({
      planStatuses: { 'gap-close': 'implement' },
      earlyOrchestration: makeOrchestration([{ id: 'plan-01', name: 'Plan One' }]),
      agentThreads: [
        // Real plan with ended threads but no status entry: stays not-complete.
        { planId: 'plan-01', agent: 'builder', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:02:00.000Z', totalTokens: 100_000 },
        // Phase lane with an explicit non-terminal stage: explicit status wins.
        { planId: 'gap-close', agent: 'builder', startedAt: '2026-05-24T11:00:00.000Z', endedAt: '2026-05-24T11:05:00.000Z', totalTokens: 60_000 },
      ] as RunState['agentThreads'],
    });
    const lanes = selectPlanLanes(state);
    expect(lanes.find((l) => l.planId === 'plan-01')?.isComplete).toBe(false);
    expect(lanes.find((l) => l.planId === 'gap-close')?.isComplete).toBe(false);
  });

  it('does not fall back to stale statuses when selecting lanes with empty orchestration context', () => {
    const state = makeRunState({
      planStatuses: { 'acceptance-validation': 'plan' },
      earlyOrchestration: makeOrchestration(),
    });

    expect(selectPlanLanes(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectStackLayersForRun
// ---------------------------------------------------------------------------
describe('selectStackLayersForRun', () => {
  it('only returns daemon stack layers referenced by the selected run plans', () => {
    const layers = [
      makeLayer({
        prdId: 'harden-eforge-build-validation-gates',
        stackId: 'harden-eforge-build-validation-gates',
        status: 'failed',
      }),
      makeLayer({ prdId: 'close-stacked-pr-followup', stackId: 'close-stacked-pr-followup' }),
    ];
    const runState = makeRunState({
      events: [
        makeStoredEvent({
          type: 'planning:complete',
          timestamp: '2026-05-24T10:00:00.000Z',
          plans: [{ id: 'close-stacked-pr-followup', name: 'Close stacked PR followup', body: '...' }],
        }),
      ],
    });

    expect(selectStackLayersForRun(layers, runState)).toEqual([layers[1]]);
  });

  it('returns no layers when run has no known plan IDs', () => {
    const layers = [makeLayer({ prdId: 'older-build', stackId: 'older-build', status: 'failed' })];
    expect(selectStackLayersForRun(layers, makeRunState())).toEqual([]);
  });

  it('matches layers by planStatuses keys', () => {
    const layers = [
      makeLayer({ prdId: 'plan-a', stackId: 'stack-a' }),
      makeLayer({ prdId: 'plan-b', stackId: 'stack-b' }),
    ];
    const runState = makeRunState({ planStatuses: { 'plan-a': 'complete' } });
    const result = selectStackLayersForRun(layers, runState);
    expect(result).toHaveLength(1);
    expect(result[0].prdId).toBe('plan-a');
  });

  it('matches layers by parentPrdId when parentPrdId is a known run plan', () => {
    const layers = [
      makeLayer({ prdId: 'child-plan', stackId: 'stack-child', parentPrdId: 'parent-plan' }),
      makeLayer({ prdId: 'unrelated', stackId: 'stack-unrelated' }),
    ];
    const runState = makeRunState({ planStatuses: { 'parent-plan': 'complete' } });
    const result = selectStackLayersForRun(layers, runState);
    expect(result).toHaveLength(1);
    expect(result[0].prdId).toBe('child-plan');
  });

  it('uses stack events in the selected run when orchestration has not been projected yet', () => {
    const layers = [
      makeLayer({ prdId: 'older-build', stackId: 'older-build', status: 'failed' }),
      makeLayer({ prdId: 'current-plan', stackId: 'current-stack' }),
    ];
    const runState = makeRunState({
      events: [
        makeStoredEvent({
          type: 'stack:layer:recorded',
          timestamp: '2026-05-24T10:00:00.000Z',
          prdId: 'current-plan',
          stackId: 'current-stack',
          provider: 'git-spice',
          branch: 'eforge/current-plan',
          status: 'built',
        }),
      ],
    });

    expect(selectStackLayersForRun(layers, runState)).toEqual([layers[1]]);
  });
});
