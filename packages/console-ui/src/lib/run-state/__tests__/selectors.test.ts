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
} from '../selectors/plan-progress';
import { selectStackLayersForRun } from '../selectors/stack-layers';
import { initialRunState } from '../reducer';
import type { RunState, EforgeEvent } from '../types';
import type { StackLayerWire } from '@eforge-build/client/browser';

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return { ...initialRunState, ...overrides };
}

function makeStoredEvent(event: unknown, eventId = 'evt-1'): { event: EforgeEvent; eventId: string } {
  return { event: event as EforgeEvent, eventId };
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
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [
          { id: 'plan-01', name: 'Plan One', dependsOn: [], build: [], review: { strategy: 'auto', maxRounds: 1 } },
          { id: 'plan-02', name: 'Plan Two', dependsOn: [], build: [], review: { strategy: 'auto', maxRounds: 1 } },
        ],
      },
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
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [
          { id: 'plan-01', name: 'Plan One', dependsOn: [], build: [], review: { strategy: 'auto', maxRounds: 1 } },
          { id: 'plan-02', name: 'Plan Two', dependsOn: ['plan-01'], build: [], review: { strategy: 'auto', maxRounds: 1 } },
        ],
      },
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
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [
          {
            id: 'plan-01',
            name: 'Plan One',
            dependsOn: [],
            build: ['implement', 'test-cycle', 'review-cycle'],
            review: { strategy: 'auto', maxRounds: 1 },
          },
          {
            id: 'plan-02',
            name: 'Plan Two',
            dependsOn: ['plan-01'],
            build: ['implement'],
            review: { strategy: 'auto', maxRounds: 1 },
          },
        ],
      },
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
});

// ---------------------------------------------------------------------------
// selectPlanningLane
// ---------------------------------------------------------------------------
describe('selectPlanningLane', () => {
  it('returns empty lane from initialRunState', () => {
    expect(selectPlanningLane(initialRunState)).toEqual({ agents: [], running: false });
  });

  it('aggregates plan-less agents by role in start order, summing tokens', () => {
    const state = makeRunState({
      agentThreads: [
        { agent: 'planner', startedAt: '2026-05-24T10:00:00.000Z', endedAt: '2026-05-24T10:05:00.000Z', totalTokens: 4_900_000 },
        { agent: 'plan-reviewer', startedAt: '2026-05-24T10:05:00.000Z', endedAt: '2026-05-24T10:06:00.000Z', totalTokens: 100_000 },
        { agent: 'plan-reviewer', startedAt: '2026-05-24T10:07:00.000Z', endedAt: null, totalTokens: 84_500 },
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
