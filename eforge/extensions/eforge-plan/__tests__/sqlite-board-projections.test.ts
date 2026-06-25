import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { listBoardCompactProjection } from '../projections/index.js';
import { invokePlanAction, seedProjectionBacklog, withTempProjectionProject, writeSessionPlan } from './sqlite-projection-fixtures.js';

function byId(items: unknown[]): Map<string, Record<string, unknown>> {
  return new Map(items.map((entry) => [(entry as { id: string }).id, entry as Record<string, unknown>]));
}

describe('SQLite board projections', () => {
  it('assigns lanes and reason codes from SQL lifecycle evidence and dependencies', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const output = await listBoardCompactProjection(cwd, { includeClosed: true, includeArchive: true, limit: 100 });
      const cards = byId(output.items);

      expect(cards.get('candidate')).toMatchObject({ lane: 'inbox', lifecycleState: 'none', reasonCodes: ['candidate-no-evidence'] });
      expect(cards.get('planned')).toMatchObject({ lane: 'ready', lifecycleState: 'planned', reasonCodes: ['planned-session-plan'] });
      expect(cards.get('submitted')).toMatchObject({ lane: 'in-progress', lifecycleState: 'queue', reasonCodes: ['submitted-session-plan'] });
      expect(cards.get('queued')).toMatchObject({ lane: 'in-progress', lifecycleState: 'queue', reasonCodes: ['queued-build'] });
      expect(cards.get('running')).toMatchObject({ lane: 'in-progress', lifecycleState: 'build', reasonCodes: ['running-build'] });
      expect(cards.get('pr-open')).toMatchObject({ lane: 'in-progress', lifecycleState: 'pr-open', reasonCodes: ['open-pr'] });
      expect(cards.get('failed')).toMatchObject({ lane: 'blocked', lifecycleState: 'failed', reasonCodes: ['failed-result'] });
      expect(cards.get('blocked')).toMatchObject({ lane: 'blocked', reasonCodes: ['unresolved-dependency'], unresolvedDependsOn: ['missing-dep'] });
      expect(cards.get('shipped')).toMatchObject({ lane: 'done', lifecycleState: 'shipped', reasonCodes: ['shipped-result'] });
      expect(cards.get('archived')).toMatchObject({ lane: 'archive', reasonCodes: ['explicit-archive-status'] });
    });
  });

  it('keeps explicit shipped status closed even with historical session-plan links', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      captureCanonicalBacklogItem(cwd, { id: 'curated-shipped', title: 'Curated shipped', status: 'shipped', epicId: 'epic-a' });
      writeSessionPlan(cwd, 'historical-submitted', ['curated-shipped'], { status: 'submitted', provenance: 'selected-item' });

      const output = await listBoardCompactProjection(cwd, { includeClosed: true, includeArchive: true, limit: 100 });
      const cards = byId(output.items);

      expect(cards.get('curated-shipped')).toMatchObject({ lane: 'done', lifecycleState: 'shipped', closed: true, reasonCodes: ['explicit-shipped-status'] });
    });
  });

  it('caps large page limits and reports lane/open/closed counts without item bodies', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const output = await listBoardCompactProjection(cwd, { includeClosed: true, includeArchive: true, limit: 500 });

      expect(output).toMatchObject({ limit: 100, pagination: expect.objectContaining({ limit: 100, offset: 0, returned: 10, hasMore: false }) });
      expect(output.counts).toMatchObject({ total: 10, open: expect.any(Number), closed: expect.any(Number) });
      expect(output.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'inbox', count: 1, openCount: 1, closedCount: 0 }),
        expect.objectContaining({ lane: 'in-progress', count: 4 }),
        expect.objectContaining({ lane: 'blocked', count: 2 }),
        expect.objectContaining({ lane: 'done', count: 1, closedCount: 1 }),
        expect.objectContaining({ lane: 'archive', count: 1, closedCount: 1 }),
      ]));
      expect(JSON.stringify(output)).not.toContain('Candidate body.');
    });
  });

  it('keeps debug board and rendered markdown lanes aligned with the compact projection', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const compact = await invokePlanAction(cwd, 'list-board-compact', { includeClosed: true, includeArchive: true, limit: 100 });
      const debug = await invokePlanAction(cwd, 'list-board', { includeArchive: true });
      const markdown = await invokePlanAction(cwd, 'render-board-markdown', { includeArchive: true });

      const compactIds = new Set((compact.items as Array<{ id: string }>).map((item) => item.id));
      const debugIds = new Set((debug.items as Array<{ id: string }>).map((item) => item.id));
      expect(debugIds).toEqual(compactIds);
      expect(markdown.markdown).toContain('## In Progress');
      expect(markdown.markdown).toContain('**running**');
      expect(markdown.markdown).toContain('running-build');
    });
  });
});
