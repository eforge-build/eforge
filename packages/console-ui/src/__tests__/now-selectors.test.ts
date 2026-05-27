// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RunInfo, QueueItem, EforgeEvent } from '@eforge-build/client/browser';
import type { StackLayerWire } from '@eforge-build/client/browser';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import type { ConsoleActivityEntry } from '@/lib/types';
import {
  selectNowQueueSummary,
  selectNowAttentionItems,
  selectNowActiveBuildCards,
  selectNowStatusSummary,
  selectNowStackSummary,
  selectNowRecentActivity,
  selectNowRecentRuns,
  selectNowStackSyncStatus,
  mergeSeverity,
  isLivenessStale,
} from '@/lib/selectors/now';
import { initialConsoleProjectState } from '@/lib/project-state';
import { eforgeReducer, createInitialRunState } from '@/lib/run-state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeQueue(overrides: Partial<QueueItem>[] = []): QueueItem[] {
  return overrides.map((o, i) => ({
    id: `q-${i}`,
    title: `Item ${i}`,
    status: 'pending',
    ...o,
  }));
}

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    planSet: 'my-plans',
    command: 'build',
    status: 'running',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    cwd: '/project',
    ...overrides,
  };
}

function makeActiveDetail(
  sessionId: string,
  overrides: Partial<ActiveSessionDetail> = {},
): ActiveSessionDetail {
  return {
    sessionId,
    connectionStatus: 'connected',
    status: 'running',
    runState: createInitialRunState(),
    lastEventAt: Date.now(),
    error: null,
    ...overrides,
  };
}

function makeStackLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'prd-1',
    stackId: 'stack-a',
    provider: 'git-spice',
    branch: 'feature/prd-1',
    baseBranch: 'main',
    status: 'building',
    recordedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Queue summary tests
// ---------------------------------------------------------------------------

describe('selectNowQueueSummary', () => {
  it('counts running, pending, waiting, and failed items', () => {
    const queue = makeQueue([
      { status: 'running' },
      { status: 'running' },
      { status: 'pending' },
      { status: 'waiting' },
      { status: 'failed' },
    ]);
    const summary = selectNowQueueSummary(queue);
    expect(summary.total).toBe(5);
    expect(summary.runningCount).toBe(2);
    expect(summary.pendingCount).toBe(1);
    expect(summary.waitingCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it('counts items with dependencies', () => {
    const queue = makeQueue([
      { dependsOn: ['q-0'] },
      { dependsOn: [] },
      {},
    ]);
    const summary = selectNowQueueSummary(queue);
    expect(summary.withDependenciesCount).toBe(1);
  });

  it('counts items with recovery verdicts', () => {
    const queue = makeQueue([
      {
        status: 'failed',
        recoveryVerdict: { verdict: 'retry', confidence: 'high' },
      },
      { status: 'failed' },
      { status: 'pending' },
    ]);
    const summary = selectNowQueueSummary(queue);
    expect(summary.withRecoveryVerdictCount).toBe(1);
  });

  it('orders top items: failed before running, waiting, pending', () => {
    const queue = makeQueue([
      { id: 'p1', status: 'pending' },
      { id: 'r1', status: 'running' },
      { id: 'f1', status: 'failed' },
      { id: 'w1', status: 'waiting' },
    ]);
    const summary = selectNowQueueSummary(queue);
    const statuses = summary.topItems.map((i) => i.status.toLowerCase());
    expect(statuses.indexOf('failed')).toBeLessThan(statuses.indexOf('running'));
    expect(statuses.indexOf('running')).toBeLessThan(statuses.indexOf('waiting'));
    expect(statuses.indexOf('waiting')).toBeLessThan(statuses.indexOf('pending'));
  });
});

// ---------------------------------------------------------------------------
// Queue summary – label normalization
// ---------------------------------------------------------------------------

describe('selectNowQueueSummary – label normalization', () => {
  it('falls back to slug-derived label when queue item title is markdown-shaped', () => {
    const queue = makeQueue([{ id: 'my-feature', title: '## My Feature' }]);
    const summary = selectNowQueueSummary(queue);
    // '## My Feature' is markdown-shaped → fall back to slugToDisplayLabel('my-feature')
    expect(summary.topItems[0].title).toBe('My Feature');
  });

  it('uses clean title as-is when it is not markdown-shaped', () => {
    const queue = makeQueue([{ id: 'my-feature', title: 'My Feature' }]);
    const summary = selectNowQueueSummary(queue);
    expect(summary.topItems[0].title).toBe('My Feature');
  });
});

// ---------------------------------------------------------------------------
// Recent runs – label normalization
// ---------------------------------------------------------------------------

describe('selectNowRecentRuns – label normalization', () => {
  const now = Date.now();

  it('normalizes a slug-like planSet to a title-cased display label', () => {
    const runs = [makeRun({ id: 'r1', planSet: 'add-mcp-server-support' })];
    const result = selectNowRecentRuns(runs, now);
    expect(result[0].planSet).toBe('Add MCP Server Support');
  });

  it('normalizes an acronym-containing slug preserving known uppercase acronyms', () => {
    const runs = [makeRun({ id: 'r1', planSet: 'refactor-ui-layout' })];
    const result = selectNowRecentRuns(runs, now);
    expect(result[0].planSet).toBe('Refactor UI Layout');
  });
});

// ---------------------------------------------------------------------------
// Attention items tests
// ---------------------------------------------------------------------------

describe('selectNowAttentionItems', () => {
  const now = Date.now();
  const baseState = {
    ...initialConsoleProjectState,
    connectionStatus: 'connected' as const,
  };

  it('returns empty when no issues', () => {
    const result = selectNowAttentionItems(baseState, {}, now);
    expect(result.items).toHaveLength(0);
    expect(result.hiddenCount).toBe(0);
  });

  it('places stream error before stale heartbeat and failed queue items', () => {
    const state = {
      ...baseState,
      connectionStatus: 'disconnected' as const,
      error: 'connection refused',
      queue: makeQueue([{ status: 'failed' }]),
      // old lastSnapshotAt so stale would trigger (if connected)
      lastSnapshotAt: now - 60_000,
      latestHeartbeat: null,
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    const types = items.map((i) => i.id);
    // stream-error is first
    expect(types[0]).toBe('stream-error');
  });

  it('labels failed queue items with recovery verdict text', () => {
    const state = {
      ...baseState,
      queue: makeQueue([
        {
          id: 'rv1',
          status: 'failed',
          recoveryVerdict: { verdict: 'retry', confidence: 'high' },
        },
        {
          id: 'rv2',
          status: 'failed',
          recoveryVerdict: { verdict: 'split', confidence: 'medium' },
        },
        {
          id: 'rv3',
          status: 'failed',
          recoveryVerdict: { verdict: 'abandon', confidence: 'low' },
        },
        {
          id: 'rv4',
          status: 'failed',
          recoveryVerdict: { verdict: 'manual', confidence: 'high' },
        },
      ]),
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    const detailsMap: Record<string, string | undefined> = {};
    for (const item of items) {
      detailsMap[item.id] = item.detail;
    }
    expect(detailsMap['queue-failed-verdict-rv1']).toBe('retry / high');
    expect(detailsMap['queue-failed-verdict-rv2']).toBe('split / medium');
    expect(detailsMap['queue-failed-verdict-rv3']).toBe('abandon / low');
    expect(detailsMap['queue-failed-verdict-rv4']).toBe('manual / high');
  });

  it('labels failed queue items without recovery verdict as "recovery pending"', () => {
    const state = {
      ...baseState,
      queue: makeQueue([{ id: 'nrv', status: 'failed' }]),
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    const item = items.find((i) => i.id === 'queue-failed-nrv');
    expect(item).toBeDefined();
    expect(item!.detail).toBe('recovery pending');
  });

  it('deduplicates failed queue and run attention items sharing the same PRD key to one item', () => {
    const state = {
      ...baseState,
      queue: makeQueue([
        // queue item with verdict — normalised dedup key: prd:my-prd
        { id: 'my-prd', status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        // duplicate failed queue candidate for the same PRD (via extension normalization)
        { id: 'my-prd.md', status: 'failed' },
      ]),
      runs: [
        // failed run for the same PRD
        makeRun({
          id: 'run-prd-1',
          sessionId: undefined,
          planSet: 'my-prd',
          status: 'failed',
          completedAt: new Date().toISOString(),
        }),
      ],
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    // All three candidates share dedupKey 'prd:my-prd' → one attention item
    expect(items).toHaveLength(1);
  });

  it('hiddenCount reflects deduplicated candidate count, not raw candidate count', () => {
    // 12 raw attention candidates that deduplicate to 6 unique PRD keys.
    // With dedup: hiddenCount = max(0, 6 - 5) = 1.
    // Without dedup (bug): hiddenCount would be max(0, 12 - 5) = 7.
    const state = {
      ...baseState,
      queue: makeQueue([
        { id: 'prd-a',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-a.md', status: 'failed' },
        { id: 'prd-b',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-b.md', status: 'failed' },
        { id: 'prd-c',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-c.md', status: 'failed' },
        { id: 'prd-d',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-d.md', status: 'failed' },
        { id: 'prd-e',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-e.md', status: 'failed' },
        { id: 'prd-f',    status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        { id: 'prd-f.md', status: 'failed' },
      ]),
    };
    const { items, hiddenCount } = selectNowAttentionItems(state, {}, now);
    // 6 unique deduplicated items; 5 visible, 1 hidden
    expect(items).toHaveLength(5);
    expect(hiddenCount).toBe(1);
  });

  it('severity ordering: critical > warning > info via mergeSeverity helper', () => {
    expect(mergeSeverity('critical', 'warning')).toBe('critical');
    expect(mergeSeverity('warning', 'critical')).toBe('critical');
    expect(mergeSeverity('critical', 'info')).toBe('critical');
    expect(mergeSeverity('info', 'critical')).toBe('critical');
    expect(mergeSeverity('warning', 'info')).toBe('warning');
    expect(mergeSeverity('info', 'warning')).toBe('warning');
  });

  it('merges severity to worst when deduplicating attention items: warning beats info', () => {
    const state = {
      ...baseState,
      queue: makeQueue([
        // warning severity — no recovery verdict
        { id: 'feat', status: 'failed' },
      ]),
      runs: [
        // info severity for the same PRD
        makeRun({
          id: 'run-feat',
          sessionId: undefined,
          planSet: 'feat',
          status: 'failed',
          completedAt: new Date().toISOString(),
        }),
      ],
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    // 'warning' (queue) beats 'info' (run) — worst severity wins
    const item = items.find((i) => i.id === 'queue-failed-feat');
    expect(item).toBeDefined();
    expect(item!.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Active build card derivation tests
// ---------------------------------------------------------------------------

describe('selectNowActiveBuildCards', () => {
  const now = Date.now();

  it('returns two cards for two active runs with distinct session IDs', () => {
    const runs = [
      makeRun({ id: 'run-A', sessionId: 'sess-A', planSet: 'plans-A' }),
      makeRun({ id: 'run-B', sessionId: 'sess-B', planSet: 'plans-B' }),
    ];
    const cards = selectNowActiveBuildCards(runs, {}, {}, now);
    expect(cards).toHaveLength(2);
    const sessionIds = cards.map((c) => c.sessionId);
    expect(sessionIds).toContain('sess-A');
    expect(sessionIds).toContain('sess-B');
  });

  it('de-duplicates multiple active runs for one session, selecting newest startedAt', () => {
    const older = makeRun({
      id: 'run-old',
      sessionId: 'sess-1',
      startedAt: new Date(now - 20_000).toISOString(),
    });
    const newer = makeRun({
      id: 'run-new',
      sessionId: 'sess-1',
      startedAt: new Date(now - 5_000).toISOString(),
    });
    const cards = selectNowActiveBuildCards([older, newer], {}, {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].runId).toBe('run-new');
  });

  it('excludes completed runs with completedAt', () => {
    const active = makeRun({ id: 'active', sessionId: 'sess-A', status: 'running' });
    const done = makeRun({
      id: 'done',
      sessionId: 'sess-B',
      status: 'running',
      completedAt: new Date().toISOString(),
    });
    const cards = selectNowActiveBuildCards([active, done], {}, {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessionId).toBe('sess-A');
  });

  it('excludes terminal status runs', () => {
    const active = makeRun({ id: 'r1', sessionId: 's1', status: 'running' });
    const failed = makeRun({ id: 'r2', sessionId: 's2', status: 'failed' });
    const cards = selectNowActiveBuildCards([active, failed], {}, {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessionId).toBe('s1');
  });

  it('derives current phase from a phase:start event', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const phaseEvent: EforgeEvent = {
      type: 'phase:start',
      runId: 'r1',
      planSet: 'my-plans',
      command: 'build',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: phaseEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].currentPhase).toBe('My Plans / build');
  });

  it('derives latest agent from an agent:start event', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const agentEvent: EforgeEvent = {
      type: 'agent:start',
      agentId: 'agent-1',
      agent: 'implementor',
      planId: 'plan-1',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: agentEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].latestAgent).toBe('implementor');
  });

  it('derives latest progress from plan:build:progress', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const progressEvent: EforgeEvent = {
      type: 'plan:build:progress',
      planId: 'plan-1',
      message: 'Implementing feature X',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: progressEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].latestProgress).toBe('Implementing feature X');
  });

  it('derives latest error from plan:build:failed', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const failEvent: EforgeEvent = {
      type: 'plan:build:failed',
      planId: 'plan-1',
      error: 'TypeScript compilation failed',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: failEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].latestError).toBe('TypeScript compilation failed');
  });

  it('preserves a card when active detail is missing (streamStatus: connecting)', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const cards = selectNowActiveBuildCards(runs, {}, {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].streamStatus).toBe('connecting');
    expect(cards[0].planProgress.total).toBe(0);
    expect(cards[0].tokens).toBe(0);
    expect(cards[0].cost).toBe(0);
    expect(cards[0].cachePercent).toBe(0);
  });

  it('exposes planProgress counts from reduced RunState', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    // Simulate a planning:complete event so plan IDs are known
    const orchEvent: EforgeEvent = {
      type: 'planning:complete',
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: '' },
        { id: 'plan-b', name: 'Plan B', dependsOn: [], branch: '' },
      ],
    } as unknown as EforgeEvent;
    let rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: orchEvent, eventId: '1' });
    // Complete plan-a
    const completeEvent: EforgeEvent = {
      type: 'plan:status:change',
      planId: 'plan-a',
      status: 'completed',
    } as unknown as EforgeEvent;
    rs = eforgeReducer(rs, { type: 'ADD_EVENT', event: completeEvent, eventId: '2' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].planProgress.total).toBe(2);
    expect(cards[0].planProgress.complete).toBe(1);
  });

  it('exposes tokens and cost from agent:result events in RunState', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const agentResultEvent: EforgeEvent = {
      type: 'agent:result',
      agent: 'implementor',
      result: {
        durationMs: 1000,
        durationApiMs: 900,
        numTurns: 1,
        totalCostUsd: 0.005,
        usage: { input: 200, output: 100, total: 300, cacheRead: 50, cacheCreation: 0 },
        modelUsage: {},
      },
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: agentResultEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].tokens).toBe(200);
    expect(cards[0].cost).toBeCloseTo(0.005);
    // cachePercent = cacheRead / (tokensIn + cacheRead) * 100 = 50 / (200 + 50) * 100 = 20
    expect(cards[0].cachePercent).toBeCloseTo(20);
  });
});

// ---------------------------------------------------------------------------
// Status summary tests
// ---------------------------------------------------------------------------

describe('selectNowStatusSummary', () => {
  const now = Date.now();

  it('uses autoBuild.scheduler.runningCount and .limit when present', () => {
    const state = {
      ...initialConsoleProjectState,
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: null, sessionId: null },
        scheduler: { alive: true, paused: false, runningCount: 2, limit: 4 },
      },
    };
    const summary = selectNowStatusSummary(state, {}, now);
    expect(summary.schedulerRunningCount).toBe(2);
    expect(summary.schedulerLimit).toBe(4);
  });

  it('falls back to active card count when scheduler running count is absent', () => {
    const state = {
      ...initialConsoleProjectState,
      runs: [
        makeRun({ id: 'r1', sessionId: 's1', status: 'running' }),
        makeRun({ id: 'r2', sessionId: 's2', status: 'running' }),
      ],
      autoBuild: null,
    };
    const summary = selectNowStatusSummary(state, {}, now);
    expect(summary.schedulerRunningCount).toBeNull();
    expect(summary.activeBuildCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Stack summary tests
// ---------------------------------------------------------------------------

describe('selectNowStackSummary', () => {
  it('returns null for empty stack layer array', () => {
    expect(selectNowStackSummary([])).toBeNull();
  });

  it('returns status counts for populated layers', () => {
    const layers = [
      makeStackLayer({ prdId: 'prd-1', status: 'building' }),
      makeStackLayer({ prdId: 'prd-2', status: 'built' }),
      makeStackLayer({ prdId: 'prd-3', status: 'building' }),
    ];
    const summary = selectNowStackSummary(layers);
    expect(summary).not.toBeNull();
    expect(summary!.totalCount).toBe(3);
    expect(summary!.byStatus['building']).toBe(2);
    expect(summary!.byStatus['built']).toBe(1);
  });

  it('limits topRows to 6 and sets hiddenCount', () => {
    const layers = Array.from({ length: 8 }, (_, i) =>
      makeStackLayer({ prdId: `prd-${i}`, stackId: 'stack-a' }),
    );
    const summary = selectNowStackSummary(layers);
    expect(summary!.topRows).toHaveLength(6);
    expect(summary!.hiddenCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Recent activity tests
// ---------------------------------------------------------------------------

describe('selectNowRecentActivity', () => {
  it('filters out daemon:heartbeat events', () => {
    const entries: ConsoleActivityEntry[] = [
      {
        id: '1',
        event: { type: 'daemon:heartbeat' } as unknown as import('@eforge-build/client/browser').EforgeEvent,
        receivedAt: Date.now(),
      },
      {
        id: '2',
        event: { type: 'queue:item:added', id: 'q1', title: 'Task' } as unknown as import('@eforge-build/client/browser').EforgeEvent,
        receivedAt: Date.now(),
      },
    ];
    const { items } = selectNowRecentActivity(entries);
    expect(items).toHaveLength(1);
    expect(items[0].eventType).toBe('queue:item:added');
  });

  it('uses event type as fallback when getEventSummary returns undefined', () => {
    const entries: ConsoleActivityEntry[] = [
      {
        id: '10',
        event: { type: 'session:start', sessionId: 'sess-X' } as unknown as import('@eforge-build/client/browser').EforgeEvent,
        receivedAt: Date.now(),
      },
    ];
    const { items } = selectNowRecentActivity(entries);
    // summary should be either the real summary or the event type as fallback
    expect(typeof items[0].summary).toBe('string');
    expect(items[0].summary.length).toBeGreaterThan(0);
  });

  it('limits to 6 rows and exposes hiddenCount', () => {
    const entries: ConsoleActivityEntry[] = Array.from({ length: 9 }, (_, i) => ({
      id: String(i),
      event: { type: 'session:start', sessionId: `sess-${i}` } as unknown as import('@eforge-build/client/browser').EforgeEvent,
      receivedAt: Date.now() - i * 1000,
    }));
    const { items, hiddenCount } = selectNowRecentActivity(entries);
    expect(items).toHaveLength(6);
    expect(hiddenCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Stack sync status selector tests
// ---------------------------------------------------------------------------

describe('selectNowStackSyncStatus', () => {
  it('returns null for null input', () => {
    expect(selectNowStackSyncStatus(null)).toBeNull();
  });

  it('returns null when stackSync has neither last nor current', () => {
    expect(selectNowStackSyncStatus({} as never)).toBeNull();
    expect(selectNowStackSyncStatus({ last: undefined, current: undefined } as never)).toBeNull();
  });

  it('returns view model for complete outcome', () => {
    const stackSync = {
      last: {
        id: 'sync-1',
        trigger: 'manual' as const,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:01Z',
        outcome: 'complete' as const,
        dryRun: false,
        restackCandidates: ['feat/a', 'feat/b'],
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm).not.toBeNull();
    expect(vm!.lastOutcome).toBe('complete');
    expect(vm!.lastTrigger).toBe('manual');
    expect(vm!.lastRestackCandidateCount).toBe(2);
    expect(vm!.lastDryRun).toBe(false);
    expect(vm!.inProgress).toBe(false);
  });

  it('returns view model for deferred outcome', () => {
    const stackSync = {
      last: {
        id: 'sync-deferred',
        trigger: 'after-build' as const,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:01Z',
        outcome: 'deferred' as const,
        dryRun: false,
        restackCandidates: [],
        reason: 'active build in progress',
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm!.lastOutcome).toBe('deferred');
    expect(vm!.lastReason).toBe('active build in progress');
    expect(vm!.inProgress).toBe(false);
  });

  it('returns view model for failed outcome with error', () => {
    const stackSync = {
      last: {
        id: 'sync-failed',
        trigger: 'manual' as const,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:02Z',
        outcome: 'failed' as const,
        dryRun: false,
        restackCandidates: [],
        reason: 'provider command failed',
        error: 'git exited with code 1',
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm!.lastOutcome).toBe('failed');
    expect(vm!.lastError).toBe('git exited with code 1');
    expect(vm!.lastReason).toBe('provider command failed');
  });

  it('returns view model for conflict outcome', () => {
    const stackSync = {
      last: {
        id: 'sync-conflict',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:02Z',
        outcome: 'conflict' as const,
        dryRun: false,
        restackCandidates: [],
        reason: 'merge conflict on feat/a',
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm!.lastOutcome).toBe('conflict');
    expect(vm!.lastReason).toBe('merge conflict on feat/a');
  });

  it('marks inProgress when current is present', () => {
    const stackSync = {
      last: {
        id: 'sync-prev',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:01Z',
        outcome: 'complete' as const,
        dryRun: false,
        restackCandidates: [],
      },
      current: {
        id: 'sync-current',
        startedAt: '2024-01-01T00:01:00Z',
        dryRun: false,
        restackCandidates: [],
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm!.inProgress).toBe(true);
    // last fields still come from last record
    expect(vm!.lastOutcome).toBe('complete');
  });

  it('returns non-null when only current is present (no previous sync)', () => {
    const stackSync = {
      current: {
        id: 'sync-only-current',
        startedAt: '2024-01-01T00:00:00Z',
        dryRun: false,
        restackCandidates: [],
      },
    };
    const vm = selectNowStackSyncStatus(stackSync as never);
    expect(vm).not.toBeNull();
    expect(vm!.inProgress).toBe(true);
    expect(vm!.lastOutcome).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stale liveness helper tests
// ---------------------------------------------------------------------------

describe('isLivenessStale', () => {
  it('returns true when last heartbeat is older than 30 seconds', () => {
    const now = Date.now();
    const state = {
      ...initialConsoleProjectState,
      latestHeartbeat: {
        at: now - 35_000,
        payload: {
          uptime: 100,
          queueDepth: 0,
          runningBuilds: 0,
          autoBuild: { enabled: false, paused: false },
          subscribers: 1,
        },
      },
    };
    expect(isLivenessStale(state, now)).toBe(true);
  });

  it('returns false when last heartbeat is within 30 seconds', () => {
    const now = Date.now();
    const state = {
      ...initialConsoleProjectState,
      latestHeartbeat: {
        at: now - 10_000,
        payload: {
          uptime: 100,
          queueDepth: 0,
          runningBuilds: 0,
          autoBuild: { enabled: false, paused: false },
          subscribers: 1,
        },
      },
    };
    expect(isLivenessStale(state, now)).toBe(false);
  });
});
