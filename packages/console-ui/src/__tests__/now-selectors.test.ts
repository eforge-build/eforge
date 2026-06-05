// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RunInfo, QueueItem, EforgeEvent, ExtensionEntry } from '@eforge-build/client/browser';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import type { ConsoleActivityEntry } from '@/lib/types';
import { selectQueueSummary } from '@/lib/selectors/queue';
import {
  selectNowQueueSummary,
  selectNowQueueStacks,
  selectNowAttentionItems,
  selectNowActiveBuildCards,
  selectNowEnqueueCards,
  selectNowStatusSummary,
  selectNowRecentActivity,
  selectNowRecentRuns,
  selectAllNowBuildItems,
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

// ---------------------------------------------------------------------------
// Queue summary tests
// ---------------------------------------------------------------------------

describe('selectNowQueueSummary', () => {
  it('counts every status over the full queue but totals only forward (pending/waiting) preview rows', () => {
    const queue = makeQueue([
      { status: 'running' },
      { status: 'running' },
      { status: 'pending' },
      { status: 'waiting' },
      { status: 'failed' },
    ]);
    const summary = selectNowQueueSummary(queue);
    // total reflects the forward-only queue preview: pending + waiting. Running
    // surfaces as active build cards; failed/skipped surface in attention.
    expect(summary.total).toBe(2);
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

  it('top items are forward-only (pending/waiting); running, failed, and skipped are excluded', () => {
    const queue = makeQueue([
      { id: 'p1', status: 'pending' },
      { id: 'r1', status: 'running' },
      { id: 'f1', status: 'failed' },
      { id: 'w1', status: 'waiting' },
      { id: 's1', status: 'skipped' },
    ]);
    const summary = selectNowQueueSummary(queue);
    const statuses = summary.topItems.map((i) => i.status.toLowerCase());
    expect(statuses).not.toContain('running');
    expect(statuses).not.toContain('failed');
    expect(statuses).not.toContain('skipped');
    // Same-depth forward rows order waiting before pending.
    expect(statuses.indexOf('waiting')).toBeLessThan(statuses.indexOf('pending'));
    expect(summary.total).toBe(2);
  });

  it('truncates after forward filtering, so leading terminal rows never starve the four-item preview', () => {
    // Raw queue starts with four terminal rows. A slice-before-filter bug would
    // consume all four preview slots with failed/skipped rows and hide forward
    // work; forward-only truncation must surface the pending/waiting rows.
    const queue = makeQueue([
      { id: 'f1', status: 'failed' },
      { id: 'f2', status: 'failed' },
      { id: 's1', status: 'skipped' },
      { id: 's2', status: 'skipped' },
      { id: 'p1', status: 'pending' },
      { id: 'w1', status: 'waiting' },
    ]);
    const summary = selectNowQueueSummary(queue);
    expect(summary.topItems.map((i) => i.id).sort()).toEqual(['p1', 'w1']);
    expect(summary.topItems.length).toBeLessThanOrEqual(4);
    expect(summary.total).toBe(2);
    expect(summary.hiddenCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Queue stack selector
// ---------------------------------------------------------------------------

describe('selectNowQueueStacks', () => {
  it('groups dependency-linked running and waiting queue items in unlock order', () => {
    const queue = makeQueue([
      { id: 'base', title: 'Base Build', status: 'running' },
      { id: 'api', title: 'API Build', status: 'waiting', dependsOn: ['base'] },
      { id: 'handoff', title: 'Handoff Build', status: 'waiting', dependsOn: ['api'] },
      { id: 'failed', title: 'Failed Build', status: 'failed' },
    ]);

    const stacks = selectNowQueueStacks(queue);

    expect(stacks).toHaveLength(1);
    expect(stacks[0].totalItems).toBe(3);
    expect(stacks[0].items.map((item) => item.id)).toEqual(['base', 'api', 'handoff']);
    expect(stacks[0].items[1].blockedBy).toEqual(['Base Build']);
    expect(stacks[0].items[2].blockedBy).toEqual(['API Build']);
  });

  it('does not clip stack groups', () => {
    const queue = makeQueue([
      { id: 'a1', status: 'running' },
      { id: 'a2', status: 'waiting', dependsOn: ['a1'] },
      { id: 'b1', status: 'pending' },
      { id: 'b2', status: 'waiting', dependsOn: ['b1'] },
      { id: 'c1', status: 'pending' },
      { id: 'c2', status: 'waiting', dependsOn: ['c1'] },
      { id: 'd1', status: 'pending' },
      { id: 'd2', status: 'waiting', dependsOn: ['d1'] },
    ]);

    const stacks = selectNowQueueStacks(queue);

    expect(stacks).toHaveLength(4);
  });

  it('orders same-status, same-depth items by ascending priority with absent priority last', () => {
    // base unlocks three sibling pending items at the same depth, so the only
    // differentiator is priority. This mirrors the engine dispatch order: lower
    // numeric priority builds first, absent priority sorts last.
    const queue = makeQueue([
      { id: 'base', title: 'Base Build', status: 'running' },
      { id: 'p2', title: 'Priority Two', status: 'pending', dependsOn: ['base'], priority: 2 },
      { id: 'p1', title: 'Priority One', status: 'pending', dependsOn: ['base'], priority: 1 },
      { id: 'pNone', title: 'No Priority', status: 'pending', dependsOn: ['base'] },
    ]);

    const stacks = selectNowQueueStacks(queue);

    expect(stacks).toHaveLength(1);
    // base first (depth 1); then the siblings by priority ascending, undefined last.
    expect(stacks[0].items.map((item) => item.id)).toEqual(['base', 'p1', 'p2', 'pNone']);
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

  it('annotates an applied-recovery row and drops its actionable Recover prompt', () => {
    const state = {
      ...baseState,
      queue: makeQueue([
        {
          id: 'applied-split',
          status: 'failed',
          recoveryVerdict: { verdict: 'split', confidence: 'high' },
          recoveryApplied: { action: 'split', appliedAt: '2026-01-01T00:00:00Z', successorPrdId: 'successor-prd' },
        },
      ]),
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    const item = items.find((i) => i.id === 'queue-failed-verdict-applied-split');
    expect(item).toBeDefined();
    // Applied rows are resolved: annotate the verdict, suppress the prompt.
    expect(item!.detail).toBe('recovery applied: split → successor-prd');
    expect(item!.recovery).toBeUndefined();
  });

  it('deduplicates failed queue items sharing the same PRD key (extension-normalized) to one item', () => {
    const state = {
      ...baseState,
      queue: makeQueue([
        // queue item with verdict — normalised dedup key: prd:my-prd
        { id: 'my-prd', status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } },
        // duplicate failed queue candidate for the same PRD (via extension normalization)
        { id: 'my-prd.md', status: 'failed' },
      ]),
    };
    const { items } = selectNowAttentionItems(state, {}, now);
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

  it('does not surface failed runs whose queue file has been deleted', () => {
    // Historical failed run, but the queue file was removed — no queue entry remains.
    const state = {
      ...baseState,
      queue: makeQueue([]),
      runs: [
        makeRun({
          id: 'run-orphan',
          sessionId: undefined,
          planSet: 'cleaned-up-prd',
          status: 'failed',
          completedAt: new Date().toISOString(),
        }),
      ],
    };
    const { items } = selectNowAttentionItems(state, {}, now);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Extension trust attention items
// ---------------------------------------------------------------------------

function makeExtensionEntry(overrides: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    name: 'sample-ext',
    path: '/repo/eforge/extensions/sample-ext.ts',
    scope: 'project-team',
    source: 'project-team',
    status: 'loaded',
    shadows: [],
    registrations: {
      eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0,
      reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0,
      consoleContributions: 0, integrationCommands: 0, deepLinks: 0,
    },
    diagnostics: [],
    ...overrides,
  };
}

describe('selectNowAttentionItems — extension trust', () => {
  const now = Date.now();
  const baseState = { ...initialConsoleProjectState, connectionStatus: 'connected' as const };

  it('creates a warning item with a Trust action for an untrusted project-team extension', () => {
    const ext = makeExtensionEntry({ name: 'alpha', path: '/repo/a.ts', trustState: 'untrusted' });
    const { items } = selectNowAttentionItems(baseState, {}, now, [ext]);
    const item = items.find((i) => i.extensionTrust);
    expect(item?.severity).toBe('warning');
    expect(item?.extensionTrust).toEqual({
      name: 'alpha',
      path: '/repo/a.ts',
      trustState: 'untrusted',
      actionLabel: 'Trust',
    });
  });

  it('creates a warning item with a Re-trust action for a changed project-team extension', () => {
    const ext = makeExtensionEntry({ name: 'beta', path: '/repo/b.ts', trustState: 'changed' });
    const { items } = selectNowAttentionItems(baseState, {}, now, [ext]);
    const item = items.find((i) => i.extensionTrust);
    expect(item?.severity).toBe('warning');
    expect(item?.extensionTrust).toEqual({
      name: 'beta',
      path: '/repo/b.ts',
      trustState: 'changed',
      actionLabel: 'Re-trust',
    });
  });

  it('creates no extension trust items for trusted or not-required extensions', () => {
    const exts = [
      makeExtensionEntry({ name: 'trusted', path: '/repo/t.ts', trustState: 'trusted' }),
      makeExtensionEntry({ name: 'nr', path: '/repo/nr.ts', trustState: 'not-required' }),
    ];
    const { items } = selectNowAttentionItems(baseState, {}, now, exts);
    expect(items.filter((i) => i.extensionTrust)).toHaveLength(0);
  });

  it('creates a warning item for a legacy coarse-untrusted entry with no trustState', () => {
    const ext = makeExtensionEntry({ name: 'legacy', path: '/repo/l.ts', trust: 'untrusted', trustState: undefined });
    const { items } = selectNowAttentionItems(baseState, {}, now, [ext]);
    const item = items.find((i) => i.extensionTrust);
    expect(item?.extensionTrust?.actionLabel).toBe('Trust');
    expect(item?.extensionTrust?.path).toBe('/repo/l.ts');
  });

  it('ignores non-project-team extensions even when coarse-untrusted', () => {
    const ext = makeExtensionEntry({ name: 'user-ext', path: '/repo/u.ts', scope: 'user', trust: 'untrusted', trustState: undefined });
    const { items } = selectNowAttentionItems(baseState, {}, now, [ext]);
    expect(items.filter((i) => i.extensionTrust)).toHaveLength(0);
  });

  it('includes extension trust items in hiddenCount once the strip is full', () => {
    // Five untrusted extensions plus an already-full set of system/queue items
    // would overflow; here five extensions alone fit, a sixth is hidden.
    const exts = Array.from({ length: 6 }, (_, i) =>
      makeExtensionEntry({ name: `ext-${i}`, path: `/repo/ext-${i}.ts`, trustState: 'untrusted' }),
    );
    const { items, hiddenCount } = selectNowAttentionItems(baseState, {}, now, exts);
    expect(items).toHaveLength(5);
    expect(hiddenCount).toBe(1);
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

  it('excludes enqueue runs from build cards', () => {
    const enqueue = makeRun({ id: 'r1', sessionId: 's1', command: 'enqueue', status: 'running' });
    const build = makeRun({ id: 'r2', sessionId: 's2', command: 'build', status: 'running' });
    const cards = selectNowActiveBuildCards([enqueue, build], {}, {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessionId).toBe('s2');
  });

  it('does not treat a transient backend-transport agent:stop as a terminal error', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const stopEvent: EforgeEvent = {
      type: 'agent:stop',
      agentId: 'agent-1',
      agent: 'implementor',
      planId: 'plan-1',
      error: 'Backend error: WebSocket error',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: stopEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].latestError).toBeNull();
    expect(cards[0].transientNotice).toBe('Transport interrupted — reconnecting');
  });

  it('surfaces a transient retry notice from agent:retry with transient-transport subtype', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const retryEvent: EforgeEvent = {
      type: 'agent:retry',
      agent: 'implementor',
      attempt: 2,
      maxAttempts: 3,
      subtype: 'error_transient_transport',
      label: 'implementor',
      planId: 'plan-1',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: retryEvent, eventId: '1' });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].latestError).toBeNull();
    expect(cards[0].transientNotice).toBe('Transport interrupted — retrying (attempt 2/3)');
  });

  it('clears the transient notice once the build progresses past the hiccup', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const events: EforgeEvent[] = [
      { type: 'agent:stop', agentId: 'a1', agent: 'implementor', planId: 'plan-1', error: 'Backend error: WebSocket error' } as unknown as EforgeEvent,
      { type: 'plan:build:progress', planId: 'plan-1', message: 'Back to work' } as unknown as EforgeEvent,
    ];
    let rs = createInitialRunState();
    events.forEach((event, i) => {
      rs = eforgeReducer(rs, { type: 'ADD_EVENT', event, eventId: String(i + 1) });
    });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].transientNotice).toBeNull();
  });

  it('derives gap-close lifecycle after PRD validation discovers gaps', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1' })];
    const events: EforgeEvent[] = [
      { type: 'planning:complete', plans: [{ id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: '' }] } as unknown as EforgeEvent,
      { type: 'plan:status:change', planId: 'plan-01', status: 'completed' } as unknown as EforgeEvent,
      { type: 'prd_validation:start' } as unknown as EforgeEvent,
      { type: 'prd_validation:complete', passed: false, gaps: [{ requirement: 'Document gaps', explanation: 'Missing detail' }] } as unknown as EforgeEvent,
      { type: 'gap_close:start', gapCount: 1 } as unknown as EforgeEvent,
    ];
    let rs = createInitialRunState();
    events.forEach((event, i) => {
      rs = eforgeReducer(rs, { type: 'ADD_EVENT', event, eventId: String(i + 1) });
    });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowActiveBuildCards(runs, {}, { s1: detail }, now);
    expect(cards[0].lifecycle.phase).toBe('gap-close');
    expect(cards[0].lifecycle.prdValidationComplete).toBe(true);
    expect(cards[0].lifecycle.gapCloseObserved).toBe(true);
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
    // cachePercent = cacheRead / tokensIn * 100 = 50 / 200 * 100 = 25
    expect(cards[0].cachePercent).toBeCloseTo(25);
  });
});

// ---------------------------------------------------------------------------
// Enqueue card tests
// ---------------------------------------------------------------------------

describe('selectNowEnqueueCards', () => {
  const now = Date.now();

  it('returns a card only for active enqueue runs', () => {
    const enqueue = makeRun({ id: 'r1', sessionId: 's1', command: 'enqueue', status: 'running' });
    const build = makeRun({ id: 'r2', sessionId: 's2', command: 'build', status: 'running' });
    const doneEnqueue = makeRun({ id: 'r3', sessionId: 's3', command: 'enqueue', status: 'completed' });
    const cards = selectNowEnqueueCards([enqueue, build, doneEnqueue], {}, now);
    expect(cards).toHaveLength(1);
    expect(cards[0].sessionId).toBe('s1');
  });

  it('derives the current step from the running enqueue agent', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1', command: 'enqueue' })];
    const events: EforgeEvent[] = [
      { type: 'enqueue:start', source: 'inbox/my-prd.md' } as unknown as EforgeEvent,
      { type: 'agent:start', agentId: 'a1', agent: 'formatter' } as unknown as EforgeEvent,
    ];
    let rs = createInitialRunState();
    events.forEach((event, i) => {
      rs = eforgeReducer(rs, { type: 'ADD_EVENT', event, eventId: String(i + 1) });
    });
    const detail = makeActiveDetail('s1', { runState: rs });
    const cards = selectNowEnqueueCards(runs, { s1: detail }, now);
    expect(cards[0].step).toBe('Formatting PRD');
    expect(cards[0].title).toBe('inbox/my-prd.md');
  });

  it('prefers the enqueue:complete title once available', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1', command: 'enqueue' })];
    const events: EforgeEvent[] = [
      { type: 'enqueue:start', source: 'inbox/my-prd.md' } as unknown as EforgeEvent,
      { type: 'enqueue:complete', id: 'uuid', filePath: 'queue/x.md', title: 'My Shiny PRD', planSet: 'my-shiny-prd' } as unknown as EforgeEvent,
    ];
    let rs = createInitialRunState();
    events.forEach((event, i) => {
      rs = eforgeReducer(rs, { type: 'ADD_EVENT', event, eventId: String(i + 1) });
    });
    const cards = selectNowEnqueueCards(runs, { s1: makeActiveDetail('s1', { runState: rs }) }, now);
    expect(cards[0].title).toBe('My Shiny PRD');
  });

  it('surfaces an enqueue:failed error', () => {
    const runs = [makeRun({ id: 'r1', sessionId: 's1', command: 'enqueue' })];
    const failEvent: EforgeEvent = {
      type: 'enqueue:failed',
      error: 'Formatter produced no output',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: failEvent, eventId: '1' });
    const cards = selectNowEnqueueCards(runs, { s1: makeActiveDetail('s1', { runState: rs }) }, now);
    expect(cards[0].latestError).toBe('Formatter produced no output');
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

describe('queue skipped terminal status handling', () => {
  it('counts skipped as a known status in queue summaries', () => {
    const queue = makeQueue([
      { id: 'failed-upstream', status: 'failed' },
      { id: 'skipped-child', status: 'skipped', dependsOn: ['failed-upstream'] },
      { id: 'pending-next', status: 'pending' },
    ]);

    const queueSummary = selectQueueSummary(queue);
    const nowSummary = selectNowQueueSummary(queue);

    expect(queueSummary.skipped).toBe(1);
    expect(nowSummary.skippedCount).toBe(1);
    expect(nowSummary.byStatus.skipped).toBe(1);
    // Forward-only preview: failed/skipped terminal rows never consume preview
    // slots, so only the pending row appears in topItems.
    expect(nowSummary.topItems.map((item) => item.id)).toEqual(['pending-next']);
  });

  it('surfaces skipped queue items as warning attention entries', () => {
    const queue = makeQueue([{ id: 'skipped-child', title: 'Skipped Child', status: 'skipped' }]);
    const result = selectNowAttentionItems(
      { ...initialConsoleProjectState, connectionStatus: 'connected', queue, lastSnapshotAt: Date.now() },
      {},
      Date.now(),
    );

    expect(result.items.some((item) => item.severity === 'warning' && item.message === 'Skipped: Skipped Child')).toBe(true);
  });

  it('does not let unrelated failed or skipped terminal rows alter active stack output', () => {
    const activeOnly = makeQueue([
      { id: 'base', title: 'Base Build', status: 'running' },
      { id: 'api', title: 'API Build', status: 'waiting', dependsOn: ['base'] },
    ]);
    const withTerminals = [
      ...activeOnly,
      ...makeQueue([
        { id: 'failed-upstream', title: 'Failed Upstream', status: 'failed' },
        { id: 'skipped-child', title: 'Skipped Child', status: 'skipped', dependsOn: ['failed-upstream'] },
      ]),
    ];

    expect(selectNowQueueStacks(withTerminals)).toEqual(selectNowQueueStacks(activeOnly));
  });
});

// ---------------------------------------------------------------------------
// selectAllNowBuildItems — per-session build rollup
// ---------------------------------------------------------------------------

describe('selectAllNowBuildItems', () => {
  const T0 = Date.parse('2026-01-01T00:00:00.000Z');
  const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
  const now = T0 + 60 * 60_000; // one hour after T0

  it("rolls a session's phase runs into a single build", () => {
    const runs = [
      makeRun({ id: 'c', sessionId: 's1', command: 'compile', status: 'completed', startedAt: at(0), completedAt: at(5) }),
      makeRun({ id: 'b', sessionId: 's1', command: 'build', status: 'completed', startedAt: at(5), completedAt: at(20) }),
    ];
    const builds = selectAllNowBuildItems(runs, now);
    expect(builds).toHaveLength(1);
    expect(builds[0].sessionId).toBe('s1');
    expect(builds[0].status).toBe('completed');
    expect(builds[0].phase).toBeNull();
  });

  it('reports wall-clock duration from earliest start to latest completion', () => {
    const runs = [
      makeRun({ id: 'c', sessionId: 's1', command: 'compile', status: 'completed', startedAt: at(0), completedAt: at(5) }),
      makeRun({ id: 'b', sessionId: 's1', command: 'build', status: 'completed', startedAt: at(5), completedAt: at(20) }),
    ];
    const [build] = selectAllNowBuildItems(runs, now);
    expect(build.startedAt).toBe(at(0));
    expect(build.durationMs).toBe(20 * 60_000);
  });

  it('reports running status and the live phase', () => {
    const runs = [
      makeRun({ id: 'c', sessionId: 's1', command: 'compile', status: 'completed', startedAt: at(0), completedAt: at(5) }),
      makeRun({ id: 'b', sessionId: 's1', command: 'build', status: 'running', startedAt: at(5) }),
    ];
    const [build] = selectAllNowBuildItems(runs, now);
    expect(build.status).toBe('running');
    expect(build.phase).toBe('build');
    expect(build.durationMs).toBe(now - T0);
  });

  it('reports failed status and the phase it broke in', () => {
    const runs = [
      makeRun({ id: 'c', sessionId: 's1', command: 'compile', status: 'failed', startedAt: at(0), completedAt: at(3) }),
    ];
    const [build] = selectAllNowBuildItems(runs, now);
    expect(build.status).toBe('failed');
    expect(build.phase).toBe('compile');
  });

  it('excludes successful enqueue bookkeeping from the rollup', () => {
    const runs = [
      makeRun({ id: 'e', sessionId: 's1', command: 'enqueue', status: 'completed', startedAt: at(0), completedAt: at(1) }),
      makeRun({ id: 'b', sessionId: 's1', command: 'build', status: 'running', startedAt: at(2) }),
    ];
    const [build] = selectAllNowBuildItems(runs, now);
    expect(build.status).toBe('running');
    expect(build.phase).toBe('build');
  });

  it('surfaces a failed enqueue as a failed build', () => {
    const runs = [
      makeRun({ id: 'e', sessionId: 's1', command: 'enqueue', status: 'failed', startedAt: at(0), completedAt: at(1) }),
    ];
    const [build] = selectAllNowBuildItems(runs, now);
    expect(build.status).toBe('failed');
    expect(build.phase).toBe('enqueue');
  });

  it('drops a session with only a successful enqueue (setup, not a build)', () => {
    // The enqueue phase runs in its own session, so a successful enqueue-only
    // session is pre-build setup — it must not show up as a phantom build row
    // alongside the real compile/build session it spawns.
    const runs = [
      makeRun({ id: 'e', sessionId: 's1', command: 'enqueue', status: 'completed', startedAt: at(0), completedAt: at(1) }),
    ];
    expect(selectAllNowBuildItems(runs, now)).toEqual([]);
  });

  it('keeps the real build when its enqueue ran in a separate session', () => {
    // Mirrors production: enqueue is one session; compile+build is another.
    const runs = [
      makeRun({ id: 'enq', sessionId: 'enq-sess', command: 'enqueue', status: 'completed', startedAt: at(0), completedAt: at(2) }),
      makeRun({ id: 'cmp', sessionId: 'build-sess', command: 'compile', status: 'completed', startedAt: at(3), completedAt: at(8) }),
      makeRun({ id: 'bld', sessionId: 'build-sess', command: 'build', status: 'completed', startedAt: at(8), completedAt: at(20) }),
    ];
    const builds = selectAllNowBuildItems(runs, now);
    expect(builds).toHaveLength(1);
    expect(builds[0].sessionId).toBe('build-sess');
    expect(builds[0].status).toBe('completed');
    expect(builds[0].phase).toBeNull();
  });

  it('returns one build per session, newest first', () => {
    const runs = [
      makeRun({ id: 'a', sessionId: 'old', command: 'build', status: 'completed', startedAt: at(0), completedAt: at(10) }),
      makeRun({ id: 'b', sessionId: 'new', command: 'build', status: 'completed', startedAt: at(30), completedAt: at(40) }),
    ];
    const builds = selectAllNowBuildItems(runs, now);
    expect(builds.map((b) => b.sessionId)).toEqual(['new', 'old']);
  });
});
