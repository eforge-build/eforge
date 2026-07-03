import { describe, it, expect } from 'vitest';
import {
  handleMapReduceAtoms,
  handleMapReduceReduceTree,
  handleMapReduceAtomStatus,
  handleMapReduceReduceStatus,
} from '../handlers/handle-map-reduce';
import { eforgeReducer, initialRunState, isMapReduceRun } from '../reducer';
import { buildMapReduceSummary, buildMapReduceTimeline } from '../selectors/map-reduce';
import type { AgentThread, EforgeEvent, RunState } from '../types';

function makeEvent<T extends EforgeEvent['type']>(type: T, extra: object): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

const ATOMS_EVENT = makeEvent('planning:map-reduce:atoms', {
  graphId: 'g1',
  atomCount: 3,
  edgeCount: 1,
  atoms: [
    { atomId: 'atom-a', title: 'A', reason: 'foundation-contract', criterionIds: ['c1'], dependencyAtomIds: [] },
    { atomId: 'atom-b', title: 'B', reason: 'general', criterionIds: ['c2'], dependencyAtomIds: ['atom-a'] },
    { atomId: 'atom-c', title: 'C', reason: 'subsystem', criterionIds: [], dependencyAtomIds: ['atom-a'] },
  ],
  edges: [{ fromAtomId: 'atom-a', toAtomId: 'atom-b', reason: 'depends' }],
});

const TREE_EVENT = makeEvent('planning:map-reduce:reduce-tree', {
  graphId: 'g1',
  rootNodeId: 'reduce-001',
  maxDepth: 1,
  nodeCount: 2,
  nodes: [
    { nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-a', 'atom-b'], inputNodeIds: [] },
    { nodeId: 'reduce-001', depth: 1, inputAtomIds: ['atom-c'], inputNodeIds: ['reduce-000'] },
  ],
});

describe('handle-map-reduce', () => {
  describe('handleMapReduceAtoms', () => {
    it('seeds the orchestration model with every atom queued', () => {
      const delta = handleMapReduceAtoms(ATOMS_EVENT, initialRunState);
      const mr = delta?.mapReduce;
      expect(mr?.graphId).toBe('g1');
      expect(mr?.atomOrder).toEqual(['atom-a', 'atom-b', 'atom-c']);
      expect(mr?.atoms['atom-b']).toMatchObject({ title: 'B', reason: 'general', dependencyAtomIds: ['atom-a'], status: 'queued' });
      expect(mr?.edges).toHaveLength(1);
      expect(mr?.reduceOrder).toEqual([]);
    });

    it('preserves an already-folded reduce tree when the atom snapshot arrives second', () => {
      const treeFirst = handleMapReduceReduceTree(TREE_EVENT, initialRunState);
      const state = { ...initialRunState, mapReduce: treeFirst!.mapReduce! };
      const delta = handleMapReduceAtoms(ATOMS_EVENT, state);
      expect(delta?.mapReduce?.reduceOrder).toEqual(['reduce-000', 'reduce-001']);
      expect(delta?.mapReduce?.atomOrder).toEqual(['atom-a', 'atom-b', 'atom-c']);
      // The reduce-tree root must survive the later atom snapshot too.
      expect(delta?.mapReduce?.rootNodeId).toBe('reduce-001');
    });
  });

  describe('handleMapReduceReduceTree', () => {
    it('folds the reduce nodes queued and preserves prior atoms', () => {
      const atomsDelta = handleMapReduceAtoms(ATOMS_EVENT, initialRunState);
      const state = { ...initialRunState, mapReduce: atomsDelta!.mapReduce! };
      const delta = handleMapReduceReduceTree(TREE_EVENT, state);
      const mr = delta?.mapReduce;
      expect(mr?.rootNodeId).toBe('reduce-001');
      expect(mr?.maxDepth).toBe(1);
      expect(mr?.reduceNodes['reduce-000']).toMatchObject({ depth: 0, status: 'queued', inputAtomIds: ['atom-a', 'atom-b'] });
      expect(mr?.atomOrder).toEqual(['atom-a', 'atom-b', 'atom-c']);
    });
  });

  describe('status updates', () => {
    it('updates a single atom status with reason and leaves the rest untouched', () => {
      const state = { ...initialRunState, mapReduce: handleMapReduceAtoms(ATOMS_EVENT, initialRunState)!.mapReduce! };
      const running = handleMapReduceAtomStatus(makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-a', status: 'running' }), state);
      expect(running?.mapReduce?.atoms['atom-a'].status).toBe('running');
      const next = { ...state, mapReduce: running!.mapReduce! };
      const skipped = handleMapReduceAtomStatus(makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-b', status: 'skipped', reason: 'no work' }), next);
      expect(skipped?.mapReduce?.atoms['atom-b']).toMatchObject({ status: 'skipped', statusReason: 'no work' });
      expect(skipped?.mapReduce?.atoms['atom-a'].status).toBe('running');
    });

    it('updates a reduce node status', () => {
      const withTree = { ...initialRunState, mapReduce: handleMapReduceReduceTree(TREE_EVENT, initialRunState)!.mapReduce! };
      const delta = handleMapReduceReduceStatus(makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-000', status: 'completed' }), withTree);
      expect(delta?.mapReduce?.reduceNodes['reduce-000'].status).toBe('completed');
    });

    it('ignores status events that arrive before any snapshot', () => {
      expect(handleMapReduceAtomStatus(makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-a', status: 'running' }), initialRunState)).toBeUndefined();
      expect(handleMapReduceReduceStatus(makeEvent('planning:map-reduce:reduce:status', { nodeId: 'x', status: 'completed' }), initialRunState)).toBeUndefined();
    });

    it('ignores status events for unknown ids', () => {
      const state = { ...initialRunState, mapReduce: handleMapReduceAtoms(ATOMS_EVENT, initialRunState)!.mapReduce! };
      expect(handleMapReduceAtomStatus(makeEvent('planning:map-reduce:atom:status', { atomId: 'nope', status: 'failed' }), state)).toBeUndefined();
      // Same guard on the reduce path: a populated tree but an unknown nodeId.
      const withTree = { ...initialRunState, mapReduce: handleMapReduceReduceTree(TREE_EVENT, initialRunState)!.mapReduce! };
      expect(handleMapReduceReduceStatus(makeEvent('planning:map-reduce:reduce:status', { nodeId: 'nope', status: 'failed' }), withTree)).toBeUndefined();
    });
  });

  describe('isMapReduceRun', () => {
    it('is false on a fresh state and true once atoms arrive', () => {
      expect(isMapReduceRun(initialRunState)).toBe(false);
      const state = eforgeReducer(initialRunState, { type: 'ADD_EVENT', event: ATOMS_EVENT, eventId: 'e1' });
      expect(isMapReduceRun(state)).toBe(true);
    });
  });

  describe('reducer integration', () => {
    it('folds the full snapshot+status sequence through BATCH_LOAD', () => {
      const events: Array<{ event: EforgeEvent; eventId: string }> = [
        { event: ATOMS_EVENT, eventId: 'e1' },
        { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-a', status: 'completed' }), eventId: 'e2' },
        { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-b', status: 'failed', reason: 'boom' }), eventId: 'e3' },
        { event: TREE_EVENT, eventId: 'e4' },
        { event: makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-000', status: 'running' }), eventId: 'e5' },
      ];
      const state = eforgeReducer(initialRunState, { type: 'BATCH_LOAD', events });
      expect(state.mapReduce?.atoms['atom-a'].status).toBe('completed');
      expect(state.mapReduce?.atoms['atom-b']).toMatchObject({ status: 'failed', statusReason: 'boom' });
      expect(state.mapReduce?.reduceNodes['reduce-000'].status).toBe('running');
      expect(state.mapReduce?.reduceNodes['reduce-001'].status).toBe('queued');
    });
  });
});

describe('buildMapReduceSummary', () => {
  function baseState(): RunState {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      { event: ATOMS_EVENT, eventId: 'e1' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-a', status: 'completed' }), eventId: 'e2' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-b', status: 'running' }), eventId: 'e3' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-c', status: 'skipped' }), eventId: 'e4' },
      { event: TREE_EVENT, eventId: 'e5' },
      { event: makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-000', status: 'running' }), eventId: 'e6' },
    ];
    return eforgeReducer(initialRunState, { type: 'BATCH_LOAD', events });
  }

  function thread(planId: string, input: number, output: number, cost: number): AgentThread {
    return {
      agentId: planId, agent: 'planner', planId, startedAt: '', endedAt: null, durationMs: null,
      inputTokens: input, outputTokens: output, totalTokens: input + output, cacheRead: null,
      cacheCreation: null, costUsd: cost, numTurns: null, model: 'claude',
    };
  }

  it('counts atom and reduce statuses from an interleaved state and identifies the in-flight level', () => {
    const summary = buildMapReduceSummary(baseState().mapReduce!, []);
    // Full count objects (not partial) so zero-valued buckets are also pinned.
    // The reduce tree/status folded while atom-b is still running and atom-c is skipped.
    expect(summary.atomCounts).toEqual({ total: 3, queued: 0, running: 1, completed: 1, skipped: 1, failed: 0 });
    expect(summary.reduceCounts).toEqual({ total: 2, queued: 1, running: 1, completed: 0, failed: 0, incomplete: 0 });
    expect(summary.currentLevel).toBe(1);
    expect(summary.maxLevel).toBe(2);
  });

  it('sums tokens and cost only from member agent threads', () => {
    const threads = [
      thread('atom-a', 100, 20, 0.5),
      thread('reduce-000', 200, 40, 1.0),
      thread('some-other-plan', 999, 999, 9.9), // not a member — must be excluded
    ];
    const summary = buildMapReduceSummary(baseState().mapReduce!, threads);
    expect(summary.tokensIn).toBe(300);
    expect(summary.tokensOut).toBe(60);
    expect(summary.totalTokens).toBe(360);
    expect(summary.costUsd).toBeCloseTo(1.5, 5);
  });

  it('reports currentLevel null once all reduce nodes are terminal', () => {
    const state = eforgeReducer(baseState(), {
      type: 'ADD_EVENT',
      event: makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-000', status: 'completed' }),
      eventId: 'e7',
    });
    const done = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-001', status: 'completed' }),
      eventId: 'e8',
    });
    expect(buildMapReduceSummary(done.mapReduce!, []).currentLevel).toBeNull();
  });
});

describe('buildMapReduceTimeline', () => {
  function baseState(): RunState {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      { event: ATOMS_EVENT, eventId: 'e1' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-a', status: 'completed' }), eventId: 'e2' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-b', status: 'running' }), eventId: 'e3' },
      { event: makeEvent('planning:map-reduce:atom:status', { atomId: 'atom-c', status: 'skipped', reason: 'covered elsewhere' }), eventId: 'e4' },
      { event: TREE_EVENT, eventId: 'e5' },
      { event: makeEvent('planning:map-reduce:reduce:status', { nodeId: 'reduce-000', status: 'running' }), eventId: 'e6' },
    ];
    return eforgeReducer(initialRunState, { type: 'BATCH_LOAD', events });
  }

  function thread(planId: string, agentId = planId): AgentThread {
    return {
      agentId, agent: 'planner', planId, startedAt: '', endedAt: null, durationMs: 12_000,
      inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheRead: null,
      cacheCreation: null, costUsd: 0.5, numTurns: 2, model: 'claude',
    };
  }

  it('maps every atom to the map-atoms lane and reduce nodes to one lane per depth', () => {
    const model = buildMapReduceTimeline(baseState().mapReduce!, []);
    expect(model.laneIdByMember).toEqual({
      'atom-a': 'map-atoms',
      'atom-b': 'map-atoms',
      'atom-c': 'map-atoms',
      'reduce-000': 'reduce-level-0',
      'reduce-001': 'reduce-level-1',
    });
    expect(model.lanes.map((l) => l.id)).toEqual(['map-atoms', 'reduce-level-0', 'reduce-level-1']);
    expect([...model.laneIds].sort()).toEqual(['map-atoms', 'reduce-level-0', 'reduce-level-1']);
  });

  it('labels lanes with member counts and 1-indexed reduce levels when multi-level', () => {
    const model = buildMapReduceTimeline(baseState().mapReduce!, []);
    expect(model.lanes[0].label).toBe('Map atoms (3)');
    expect(model.lanes[1].label).toBe('Reduce L1 (1)');
    expect(model.lanes[2].label).toBe('Reduce L2 (1)');
  });

  it('labels a single-level reduce lane without a level suffix', () => {
    const singleTree = makeEvent('planning:map-reduce:reduce-tree', {
      graphId: 'g1',
      rootNodeId: 'reduce-000',
      maxDepth: 0,
      nodeCount: 1,
      nodes: [{ nodeId: 'reduce-000', depth: 0, inputAtomIds: ['atom-a'], inputNodeIds: [] }],
    });
    const state = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events: [{ event: ATOMS_EVENT, eventId: 'e1' }, { event: singleTree, eventId: 'e2' }],
    });
    const model = buildMapReduceTimeline(state.mapReduce!, []);
    expect(model.lanes[1].label).toBe('Reduce (1)');
  });

  it('summarizes status counts and skip reasons in the lane tooltip', () => {
    const model = buildMapReduceTimeline(baseState().mapReduce!, []);
    expect(model.lanes[0].tooltip[0]).toBe('3 map atoms: 1 running, 1 done, 1 skipped');
    expect(model.lanes[0].tooltip[1]).toBe('atom-c skipped: covered elsewhere');
    expect(model.lanes[1].tooltip[0]).toBe('1 reduce node: 1 running');
  });

  it('builds per-agent bar display for member threads only, titled from the atom', () => {
    const model = buildMapReduceTimeline(baseState().mapReduce!, [
      thread('atom-a', 'agent-1'),
      thread('reduce-000', 'agent-2'),
      thread('planning', 'agent-3'), // not a member — no display entry
    ]);
    expect(model.displayByAgentId['agent-1']).toEqual({ barLabel: 'atom-a', tooltipLines: ['atom-a — A'] });
    expect(model.displayByAgentId['agent-2']).toEqual({ barLabel: 'reduce-000', tooltipLines: ['reduce-000'] });
    expect(model.displayByAgentId['agent-3']).toBeUndefined();
  });

  it('appends a status line to the bar tooltip for non-running, non-completed members', () => {
    const model = buildMapReduceTimeline(baseState().mapReduce!, [thread('atom-c', 'agent-c')]);
    expect(model.displayByAgentId['agent-c'].tooltipLines).toEqual([
      'atom-c — C',
      'skipped: covered elsewhere',
    ]);
  });
});
