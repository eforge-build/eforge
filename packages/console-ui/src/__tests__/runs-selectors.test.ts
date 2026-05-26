import { describe, it, expect } from 'vitest';
import {
  selectRunGroups,
  selectRunStatusRollup,
  partitionRunGroups,
  selectPlanStatusCounts,
  filterRunGroups,
  bucketRunGroupsByDay,
  projectBasename,
} from '@/lib/selectors/runs';
import type { RunGroupViewModel } from '@/lib/selectors/runs';
import type { RunInfo, SessionMetadata } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    command: 'build',
    status: 'running',
    startedAt: '2024-01-01T10:00:00Z',
    cwd: '/project',
    planSet: 'my-plan-set',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<RunGroupViewModel> = {}): RunGroupViewModel {
  return {
    key: 'test-key',
    detailId: 'test-detail',
    sessionId: undefined,
    label: 'Test Label',
    isSession: false,
    runs: [],
    status: 'completed',
    startedAt: '2024-01-15T10:00:00Z',
    completedAt: '2024-01-15T11:00:00Z',
    durationSeconds: 3600,
    commands: ['build'],
    cwd: '/project',
    metadata: undefined,
    planCountLabel: undefined,
    profileLabel: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectRunStatusRollup
// ---------------------------------------------------------------------------

describe('selectRunStatusRollup', () => {
  it('returns unknown for empty run list', () => {
    expect(selectRunStatusRollup([])).toBe('unknown');
  });

  it('returns running when a run lacks completedAt and has non-terminal status', () => {
    const runs = [makeRun({ status: 'running', completedAt: undefined })];
    expect(selectRunStatusRollup(runs)).toBe('running');
  });

  it('returns running for pending status without completedAt', () => {
    const runs = [makeRun({ status: 'pending', completedAt: undefined })];
    expect(selectRunStatusRollup(runs)).toBe('running');
  });

  it('returns failed when any run has status failed', () => {
    const runs = [
      makeRun({ status: 'completed', completedAt: '2024-01-01T11:00:00Z' }),
      makeRun({ id: 'run-2', status: 'failed', completedAt: '2024-01-01T11:30:00Z' }),
    ];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns failed for status error', () => {
    const runs = [makeRun({ status: 'error', completedAt: '2024-01-01T11:00:00Z' })];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns failed for status killed', () => {
    const runs = [makeRun({ status: 'killed' })];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns failed for status cancelled', () => {
    const runs = [makeRun({ status: 'cancelled' })];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns failed for status canceled', () => {
    const runs = [makeRun({ status: 'canceled' })];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns completed when all runs have success statuses and completedAt', () => {
    const runs = [
      makeRun({ status: 'completed', completedAt: '2024-01-01T11:00:00Z' }),
      makeRun({
        id: 'run-2',
        status: 'success',
        completedAt: '2024-01-01T11:30:00Z',
      }),
    ];
    expect(selectRunStatusRollup(runs)).toBe('completed');
  });

  it('returns running (not completed) for success status without completedAt', () => {
    const runs = [makeRun({ status: 'success', completedAt: undefined })];
    expect(selectRunStatusRollup(runs)).toBe('running');
  });

  it('prioritises failed over running', () => {
    const runs = [
      makeRun({ status: 'running', completedAt: undefined }),
      makeRun({ id: 'run-2', status: 'failed', completedAt: '2024-01-01T11:00:00Z' }),
    ];
    expect(selectRunStatusRollup(runs)).toBe('failed');
  });

  it('returns unknown for an unrecognized status with completedAt (terminal-looking but unknown)', () => {
    const runs = [makeRun({ status: 'mystery-status', completedAt: '2024-01-01T11:00:00Z' })];
    expect(selectRunStatusRollup(runs)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// selectRunGroups – grouping
// ---------------------------------------------------------------------------

describe('selectRunGroups – grouping', () => {
  it('groups two runs with the same sessionId into one session group', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', startedAt: '2024-01-01T10:00:00Z' }),
      makeRun({ id: 'r2', sessionId: 'sess-a', startedAt: '2024-01-01T10:01:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe('sess-a');
    expect(groups[0].runs).toHaveLength(2);
  });

  it('produces a session: key for runs with sessionId', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].key).toBe('session:sess-a');
    expect(groups[0].isSession).toBe(true);
  });

  it('groups runs without sessionId by planSet:<name>', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'my-feature' }),
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'my-feature' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('planSet:my-feature');
    expect(groups[0].isSession).toBe(false);
  });

  it('uses run:<id> key when sessionId and planSet are absent', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: '' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].key).toBe('run:r1');
  });

  it('creates separate groups for different sessionIds', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', startedAt: '2024-01-01T10:00:00Z' }),
      makeRun({ id: 'r2', sessionId: 'sess-b', startedAt: '2024-01-01T09:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(2);
  });

  it('creates separate groups for different planSets when no sessionId', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'feat-a' }),
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'feat-b' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// selectRunGroups – label normalization
// ---------------------------------------------------------------------------

describe('selectRunGroups – label normalization', () => {
  it('produces a title-cased display label for a slug-like planSet with an acronym', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'add-mcp-server-support' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].label).toBe('Add MCP Server Support');
  });

  it('normalizes title-vs-slug planSet variants to the same display label', () => {
    // Both variants should produce the same normalized display label.
    const slugRuns: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'add-mcp-server' }),
    ];
    const titleRuns: RunInfo[] = [
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'Add MCP Server' }),
    ];
    const slugGroups = selectRunGroups(slugRuns, {});
    const titleGroups = selectRunGroups(titleRuns, {});
    expect(slugGroups[0].label).toBe(titleGroups[0].label);
  });
});

// ---------------------------------------------------------------------------
// selectRunGroups – sorting
// ---------------------------------------------------------------------------

describe('selectRunGroups – sorting', () => {
  it('sorts groups by newest startedAt descending', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'old', startedAt: '2024-01-01T08:00:00Z' }),
      makeRun({ id: 'r2', sessionId: 'new', startedAt: '2024-01-01T10:00:00Z' }),
      makeRun({ id: 'r3', sessionId: 'mid', startedAt: '2024-01-01T09:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].sessionId).toBe('new');
    expect(groups[1].sessionId).toBe('mid');
    expect(groups[2].sessionId).toBe('old');
  });

  it('sorts runs within a group chronologically ascending', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r2', sessionId: 'sess', startedAt: '2024-01-01T10:02:00Z' }),
      makeRun({ id: 'r1', sessionId: 'sess', startedAt: '2024-01-01T10:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].runs[0].id).toBe('r1');
    expect(groups[0].runs[1].id).toBe('r2');
  });

  it('tie-breaks runs within a second by canonical command order', () => {
    const base = '2024-01-01T10:00:00Z';
    const runs: RunInfo[] = [
      makeRun({ id: 'r-build', sessionId: 'sess', command: 'build', startedAt: base }),
      makeRun({ id: 'r-enqueue', sessionId: 'sess', command: 'enqueue', startedAt: base }),
      makeRun({ id: 'r-compile', sessionId: 'sess', command: 'compile', startedAt: base }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups[0].runs.map((r) => r.command)).toEqual(['enqueue', 'compile', 'build']);
  });
});

// ---------------------------------------------------------------------------
// selectRunGroups – metadata projection
// ---------------------------------------------------------------------------

describe('selectRunGroups – metadata projection', () => {
  it('attaches SessionMetadata to matching session groups', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a' }),
    ];
    const metadata: Record<string, SessionMetadata> = {
      'sess-a': { planCount: 5, baseProfile: 'expedition' },
    };
    const groups = selectRunGroups(runs, metadata);
    expect(groups[0].metadata?.planCount).toBe(5);
    expect(groups[0].metadata?.baseProfile).toBe('expedition');
    expect(groups[0].planCountLabel).toBe('5 plans');
    expect(groups[0].profileLabel).toBe('expedition');
  });

  it('does not attach metadata to non-session groups', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'feat' }),
    ];
    const metadata: Record<string, SessionMetadata> = {
      'feat': { planCount: 3, baseProfile: 'errand' },
    };
    const groups = selectRunGroups(runs, metadata);
    expect(groups[0].metadata).toBeUndefined();
  });

  it('planCountLabel is "1 plan" when planCount is 1', () => {
    const runs: RunInfo[] = [makeRun({ id: 'r1', sessionId: 'sess-a' })];
    const metadata: Record<string, SessionMetadata> = {
      'sess-a': { planCount: 1, baseProfile: null },
    };
    const groups = selectRunGroups(runs, metadata);
    expect(groups[0].planCountLabel).toBe('1 plan');
  });

  it('planCountLabel is "2 plans" when planCount is 2', () => {
    const runs: RunInfo[] = [makeRun({ id: 'r1', sessionId: 'sess-a' })];
    const metadata: Record<string, SessionMetadata> = {
      'sess-a': { planCount: 2, baseProfile: null },
    };
    const groups = selectRunGroups(runs, metadata);
    expect(groups[0].planCountLabel).toBe('2 plans');
  });
});

// ---------------------------------------------------------------------------
// selectRunGroups – planSet time-window coalescing
// ---------------------------------------------------------------------------

describe('selectRunGroups – planSet time-window coalescing', () => {
  it('coalesces enqueue and build runs with matching planSet slug within 5 minutes', () => {
    const base = '2024-01-01T10:00:00Z';
    const twoMinLater = '2024-01-01T10:02:00Z';
    const runs: RunInfo[] = [
      makeRun({ id: 'r-enqueue', sessionId: undefined, command: 'enqueue', planSet: 'feature-x', startedAt: base }),
      makeRun({ id: 'r-build', sessionId: undefined, command: 'build', planSet: 'feature-x', startedAt: twoMinLater }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].runs).toHaveLength(2);
  });

  it('does not coalesce runs with the same planSet when start times differ by more than 5 minutes', () => {
    const base = '2024-01-01T10:00:00Z';
    const sixMinLater = '2024-01-01T10:06:00Z';
    const runs: RunInfo[] = [
      makeRun({ id: 'r-enqueue', sessionId: undefined, command: 'enqueue', planSet: 'feature-x', startedAt: base }),
      makeRun({ id: 'r-build', sessionId: undefined, command: 'build', planSet: 'feature-x', startedAt: sixMinLater }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(2);
  });

  it('coalesces runs with normalised-equivalent planSet slugs within 5 minutes', () => {
    const base = '2024-01-01T10:00:00Z';
    const oneMinLater = '2024-01-01T10:01:00Z';
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'feature-x.md', startedAt: base }),
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'feature-x', startedAt: oneMinLater }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].runs).toHaveLength(2);
  });

  it('coalesces runs whose planSet values differ only by title-vs-slug formatting (e.g. "Feature X" and "feature-x")', () => {
    const base = '2024-01-01T10:00:00Z';
    const oneMinLater = '2024-01-01T10:01:00Z';
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'Feature X', startedAt: base }),
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'feature-x', startedAt: oneMinLater }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].runs).toHaveLength(2);
  });

  it('coalesces runs starting exactly five minutes apart (inclusive boundary)', () => {
    const baseMs = new Date('2024-01-01T10:00:00Z').getTime();
    const exactlyFiveMin = new Date(baseMs + 5 * 60 * 1000).toISOString();
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'feature-x', startedAt: '2024-01-01T10:00:00Z' }),
      makeRun({ id: 'r2', sessionId: undefined, planSet: 'feature-x', startedAt: exactlyFiveMin }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].runs).toHaveLength(2);
  });

  it('coalesced group containing a failed enqueue run has status failed', () => {
    const base = '2024-01-01T10:00:00Z';
    const twoMinLater = '2024-01-01T10:02:00Z';
    const runs: RunInfo[] = [
      makeRun({
        id: 'r-enqueue',
        sessionId: undefined,
        command: 'enqueue',
        planSet: 'feature-x',
        startedAt: base,
        status: 'failed',
        completedAt: '2024-01-01T10:01:00Z',
      }),
      makeRun({
        id: 'r-build',
        sessionId: undefined,
        command: 'build',
        planSet: 'feature-x',
        startedAt: twoMinLater,
        status: 'running',
      }),
    ];
    const groups = selectRunGroups(runs, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// partitionRunGroups
// ---------------------------------------------------------------------------

describe('partitionRunGroups', () => {
  it('classifies a session group as active when its sessionId is in activeSessionIds', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'active-a', startedAt: '2024-01-01T10:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    const { active, history } = partitionRunGroups(groups, ['active-a']);
    expect(active).toHaveLength(1);
    expect(history).toHaveLength(0);
  });

  it('classifies two active session ids into two active groups', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', startedAt: '2024-01-01T10:00:00Z' }),
      makeRun({ id: 'r2', sessionId: 'sess-b', startedAt: '2024-01-01T09:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    const { active, history } = partitionRunGroups(groups, ['sess-a', 'sess-b']);
    expect(active).toHaveLength(2);
    expect(history).toHaveLength(0);
  });

  it('does not classify non-session historical groups as active', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: undefined, planSet: 'feat' }),
    ];
    const groups = selectRunGroups(runs, {});
    const { active, history } = partitionRunGroups(groups, ['feat']);
    // planSet groups are never active even if key appears in activeSessionIds
    expect(active).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it('leaves completed session groups in history when not in activeSessionIds', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'done', status: 'completed', completedAt: '2024-01-01T11:00:00Z' }),
    ];
    const groups = selectRunGroups(runs, {});
    const { active, history } = partitionRunGroups(groups, []);
    expect(active).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it('returns empty active and all history when no active session ids', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a' }),
      makeRun({ id: 'r2', sessionId: 'sess-b' }),
    ];
    const groups = selectRunGroups(runs, {});
    const { active, history } = partitionRunGroups(groups, []);
    expect(active).toHaveLength(0);
    expect(history).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// selectPlanStatusCounts
// ---------------------------------------------------------------------------

describe('selectPlanStatusCounts', () => {
  it('counts each status category correctly', () => {
    const plans = [
      { id: 'p1', status: 'pending' as const },
      { id: 'p2', status: 'running' as const },
      { id: 'p3', status: 'running' as const },
      { id: 'p4', status: 'completed' as const },
      { id: 'p5', status: 'failed' as const },
    ];
    const counts = selectPlanStatusCounts(plans);
    expect(counts.pending).toBe(1);
    expect(counts.running).toBe(2);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
  });

  it('returns all zeros for empty array', () => {
    const counts = selectPlanStatusCounts([]);
    expect(counts).toEqual({ pending: 0, running: 0, completed: 0, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// bucketRunGroupsByDay
// ---------------------------------------------------------------------------

describe('bucketRunGroupsByDay', () => {
  // Use local-time constructors so calendar-day comparisons in bucketRunGroupsByDay
  // (which uses getDate/getMonth/getFullYear) are stable in any test timezone.
  const NOW = new Date(2024, 0, 15, 12); // local Jan 15, noon

  it('groups two current-day runs under a Today header', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', startedAt: new Date(2024, 0, 15, 9).toISOString() }),
      makeGroup({ key: 'g2', startedAt: new Date(2024, 0, 15, 10).toISOString() }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].bucket).toBe('Today');
    expect(result[0].groups).toHaveLength(2);
  });

  it('groups a yesterday run under a Yesterday header', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', startedAt: new Date(2024, 0, 14, 10).toISOString() }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].bucket).toBe('Yesterday');
    expect(result[0].groups).toHaveLength(1);
  });

  it('groups an older run under an Older header', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', startedAt: new Date(2024, 0, 10, 10).toISOString() }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].bucket).toBe('Older');
    expect(result[0].groups).toHaveLength(1);
  });

  it('renders Yesterday and Older headers when fixtures include those timestamps', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', startedAt: new Date(2024, 0, 14, 10).toISOString() }),
      makeGroup({ key: 'g2', startedAt: new Date(2024, 0, 10, 10).toISOString() }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    const yesterdayBucket = result.find((b) => b.bucket === 'Yesterday');
    const olderBucket = result.find((b) => b.bucket === 'Older');
    expect(yesterdayBucket?.groups).toHaveLength(1);
    expect(olderBucket?.groups).toHaveLength(1);
  });

  it('returns all three buckets when fixtures span today, yesterday, and older', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'today', startedAt: new Date(2024, 0, 15, 8).toISOString() }),
      makeGroup({ key: 'yesterday', startedAt: new Date(2024, 0, 14, 8).toISOString() }),
      makeGroup({ key: 'older', startedAt: new Date(2024, 0, 1, 8).toISOString() }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    expect(result).toHaveLength(3);
    expect(result[0].bucket).toBe('Today');
    expect(result[1].bucket).toBe('Yesterday');
    expect(result[2].bucket).toBe('Older');
  });

  it('places a group with null startedAt into Older', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', startedAt: null }),
    ];
    const result = bucketRunGroupsByDay(groups, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].bucket).toBe('Older');
  });

  it('returns an empty array when given no groups', () => {
    expect(bucketRunGroupsByDay([], NOW)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterRunGroups
// ---------------------------------------------------------------------------

describe('filterRunGroups', () => {
  it('returns all groups when filter is the default all/all/empty', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', status: 'completed' }),
      makeGroup({ key: 'g2', status: 'failed' }),
      makeGroup({ key: 'g3', status: 'running' }),
    ];
    const result = filterRunGroups(groups, { status: 'all', command: 'all', search: '' });
    expect(result).toHaveLength(3);
  });

  it('filters to only failed groups when status is failed', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', status: 'completed' }),
      makeGroup({ key: 'g2', status: 'failed' }),
      makeGroup({ key: 'g3', status: 'running' }),
    ];
    const result = filterRunGroups(groups, { status: 'failed', command: 'all', search: '' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g2');
  });

  it('filters to only running groups when status is running', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', status: 'completed' }),
      makeGroup({ key: 'g2', status: 'running' }),
    ];
    const result = filterRunGroups(groups, { status: 'running', command: 'all', search: '' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g2');
  });

  it('filters by command: only groups that include the specified command', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', commands: ['build'] }),
      makeGroup({ key: 'g2', commands: ['enqueue', 'build'] }),
      makeGroup({ key: 'g3', commands: ['compile'] }),
    ];
    const result = filterRunGroups(groups, { status: 'all', command: 'enqueue', search: '' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g2');
  });

  it('filters by search: matches label case-insensitively', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', label: 'Add OAuth Support' }),
      makeGroup({ key: 'g2', label: 'Fix Database Bug' }),
    ];
    const result = filterRunGroups(groups, { status: 'all', command: 'all', search: 'oauth' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g1');
  });

  it('filters by search: matches sessionId case-insensitively', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', label: 'Run A', sessionId: 'session-abc' }),
      makeGroup({ key: 'g2', label: 'Run B', sessionId: 'session-xyz' }),
    ];
    const result = filterRunGroups(groups, { status: 'all', command: 'all', search: 'ABC' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g1');
  });

  it('combines status and command filters', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', status: 'failed', commands: ['build'] }),
      makeGroup({ key: 'g2', status: 'failed', commands: ['compile'] }),
      makeGroup({ key: 'g3', status: 'completed', commands: ['build'] }),
    ];
    const result = filterRunGroups(groups, { status: 'failed', command: 'build', search: '' });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('g1');
  });

  it('returns empty array when no groups match', () => {
    const groups: RunGroupViewModel[] = [
      makeGroup({ key: 'g1', status: 'completed' }),
    ];
    const result = filterRunGroups(groups, { status: 'failed', command: 'all', search: '' });
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// projectBasename
// ---------------------------------------------------------------------------

describe('projectBasename', () => {
  it('returns the last path segment of a Unix path', () => {
    expect(projectBasename('/home/user/my-project')).toBe('my-project');
  });

  it('returns the directory name for a root-level path', () => {
    expect(projectBasename('/project')).toBe('project');
  });

  it('handles trailing slashes', () => {
    expect(projectBasename('/home/user/my-project/')).toBe('my-project');
  });

  it('returns null for null input', () => {
    expect(projectBasename(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(projectBasename('')).toBeNull();
  });

  it('returns the segment itself when there is no slash', () => {
    expect(projectBasename('my-project')).toBe('my-project');
  });
});
