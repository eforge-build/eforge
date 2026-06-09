import { describe, expect, it } from 'vitest';
import { assertBacklogStatus, type BacklogItem, type TraceSummary } from '../backlog-domain.js';
import { isDerivedBlocked, projectKanbanBoard } from '../kanban.js';

function item(input: Partial<BacklogItem> & Pick<BacklogItem, 'id' | 'status'>): BacklogItem {
  return {
    id: input.id,
    status: input.status,
    tags: input.tags ?? [],
    depends_on: input.depends_on ?? [],
    title: input.title ?? input.id,
    body: input.body ?? `# ${input.id}\n`,
    epic: input.epic,
    priority: input.priority,
    source: input.source,
    created: input.created,
    updated: input.updated,
    last_checked: input.last_checked,
    stale_after: input.stale_after,
    eforge_plan: input.eforge_plan,
  };
}

function laneIds(board: ReturnType<typeof projectKanbanBoard>, lane: string): string[] {
  return board.lanes.find((candidate) => candidate.lane === lane)?.items.map((card) => card.id) ?? [];
}

describe('eforge-plan kanban projection', () => {
  it('derives blocked lane membership without accepting blocked as persisted status', () => {
    expect(() => assertBacklogStatus('blocked')).toThrow(/Invalid backlog status/);
    const board = projectKanbanBoard([
      item({ id: 'blocked-item', status: 'planned', depends_on: ['missing'] }),
    ]);
    const card = board.items[0];
    expect(card.status).toBe('planned');
    expect(card.lane).toBe('blocked');
    expect(isDerivedBlocked(card)).toBe(true);
    expect(card.reasons).toEqual(['unresolved dependencies: missing']);
  });

  it('projects persisted statuses to inbox, ready, in progress, done, and archive lanes', () => {
    const board = projectKanbanBoard([
      item({ id: 'candidate', status: 'candidate' }),
      item({ id: 'planned', status: 'planned' }),
      item({ id: 'active', status: 'active' }),
      item({ id: 'shipped', status: 'shipped' }),
      item({ id: 'stale', status: 'stale' }),
      item({ id: 'superseded', status: 'superseded' }),
    ]);

    expect(laneIds(board, 'inbox')).toEqual(['candidate']);
    expect(laneIds(board, 'ready')).toEqual(['planned']);
    expect(laneIds(board, 'in-progress')).toEqual(['active']);
    expect(laneIds(board, 'done')).toEqual(['shipped']);
    expect(laneIds(board, 'archive')).toEqual(['stale', 'superseded']);
  });

  it('moves open items with unresolved dependencies to blocked and unblocks closed dependencies', () => {
    const withOpenDependency = projectKanbanBoard([
      item({ id: 'dep', status: 'planned' }),
      item({ id: 'child', status: 'planned', depends_on: ['dep'] }),
    ]);
    expect(laneIds(withOpenDependency, 'blocked')).toEqual(['child']);
    expect(withOpenDependency.items.find((card) => card.id === 'child')?.unresolvedDependsOn).toEqual(['dep']);

    const withClosedDependency = projectKanbanBoard([
      item({ id: 'dep', status: 'shipped' }),
      item({ id: 'child', status: 'planned', depends_on: ['dep'] }),
    ]);
    expect(laneIds(withClosedDependency, 'ready')).toEqual(['child']);
    expect(laneIds(withClosedDependency, 'blocked')).toEqual([]);
  });

  it('moves items with active session-plan, queue, run, or session traces to in progress', () => {
    const traces: TraceSummary[] = [
      trace('planned-session', ['active session-plan trace s1']),
      trace('planned-queue', ['active queue trace prd1']),
      trace('candidate-run', ['active build run trace run1']),
      trace('candidate-build-session', ['active build session trace bs1']),
    ];
    const board = projectKanbanBoard([
      item({ id: 'planned-session', status: 'planned' }),
      item({ id: 'planned-queue', status: 'planned' }),
      item({ id: 'candidate-run', status: 'candidate' }),
      item({ id: 'candidate-build-session', status: 'candidate' }),
    ], traces);

    expect(laneIds(board, 'in-progress')).toEqual([
      'planned-session',
      'planned-queue',
      'candidate-run',
      'candidate-build-session',
    ]);
    expect(board.items.find((card) => card.id === 'planned-session')?.reasons).toEqual(['active session-plan trace s1']);
  });

  it('keeps terminal done and archive statuses out of active trace lanes', () => {
    const traces = [trace('shipped', ['active queue trace prd1']), trace('stale', ['active build run trace run1'])];
    const board = projectKanbanBoard([
      item({ id: 'shipped', status: 'shipped' }),
      item({ id: 'stale', status: 'stale' }),
    ], traces);

    expect(laneIds(board, 'done')).toEqual(['shipped']);
    expect(laneIds(board, 'archive')).toEqual(['stale']);
    expect(laneIds(board, 'in-progress')).toEqual([]);
  });

  it('enriches cards with priority, tags, dependency refs, dependents, and notes', () => {
    const board = projectKanbanBoard([
      item({ id: 'dep', status: 'shipped', title: 'Dependency' }),
      item({ id: 'child', status: 'planned', priority: 'high', tags: ['ux'], depends_on: ['dep', 'ghost'], body: '# Child\n\n## Claim\n\nDo the thing.\n' }),
    ], [], { epics: [{ id: 'epic-a', status: 'active', title: 'Epic A', tags: [], body: '' }] });

    const child = board.items.find((card) => card.id === 'child');
    expect(child?.priority).toBe('high');
    expect(child?.tags).toEqual(['ux']);
    expect(child?.notes.claim).toBe('Do the thing.');
    const ghost = child?.dependencies.find((ref) => ref.id === 'ghost');
    expect(ghost).toMatchObject({ missing: true, blocking: true });
    const dep = child?.dependencies.find((ref) => ref.id === 'dep');
    expect(dep).toMatchObject({ missing: false, blocking: false, title: 'Dependency' });
    expect(board.items.find((card) => card.id === 'dep')?.dependents.map((ref) => ref.id)).toEqual(['child']);
  });

  it('resolves epic refs and flags missing epics', () => {
    const board = projectKanbanBoard([
      item({ id: 'a', status: 'planned', epic: 'epic-a' }),
      item({ id: 'b', status: 'planned', epic: 'gone' }),
    ], [], { epics: [{ id: 'epic-a', status: 'active', title: 'Epic A', tags: [], body: '' }] });

    expect(board.items.find((card) => card.id === 'a')?.epicRef).toMatchObject({ title: 'Epic A', missing: false });
    expect(board.items.find((card) => card.id === 'b')?.epicRef).toMatchObject({ missing: true });
  });

  it('flags review-due items past their stale_after date and projects recommendation signals', () => {
    const board = projectKanbanBoard([
      item({ id: 'overdue', status: 'planned', stale_after: '2000-01-01' }),
      item({ id: 'fresh', status: 'planned', stale_after: '2999-01-01' }),
    ], [], {
      now: '2026-06-07',
      recommendationIndex: {
        rankById: new Map([['overdue', 1]]),
        lanesById: new Map([['overdue', ['Foundations']]]),
        unblockById: new Map([['overdue', 'Resolve the blocker.']]),
      },
    });

    const overdue = board.items.find((card) => card.id === 'overdue');
    expect(overdue?.reviewDue).toBe(true);
    expect(overdue?.recRank).toBe(1);
    expect(overdue?.recLanes).toEqual(['Foundations']);
    expect(overdue?.recUnblock).toBe('Resolve the blocker.');
    expect(board.items.find((card) => card.id === 'fresh')?.reviewDue).toBe(false);
  });

  it('can filter by epic and omit archive lane output', () => {
    const board = projectKanbanBoard([
      item({ id: 'a', status: 'planned', epic: 'epic-a' }),
      item({ id: 'b', status: 'planned', epic: 'epic-b' }),
      item({ id: 'old', status: 'stale', epic: 'epic-a' }),
    ], [], { epic: 'epic-a', includeArchive: false });

    expect(board.items.map((card) => card.id)).toEqual(['a', 'old']);
    expect(board.lanes.some((lane) => lane.lane === 'archive')).toBe(false);
  });
});

function trace(itemId: string, activeReasons: string[]): TraceSummary {
  return {
    itemId,
    hasActiveSessionPlan: activeReasons.some((reason) => reason.includes('session-plan')),
    hasActiveQueuePrd: activeReasons.some((reason) => reason.includes('queue')),
    hasActiveBuildRun: activeReasons.some((reason) => reason.includes('build run')),
    hasActiveBuildSession: activeReasons.some((reason) => reason.includes('build session')),
    hasActiveTrace: activeReasons.length > 0,
    activeReasons,
    lifecycleState: activeReasons.length > 0 ? 'active' : 'none',
    linkRows: [],
    prRefs: [],
    landingRefs: [],
    failureEvidence: [],
  };
}
