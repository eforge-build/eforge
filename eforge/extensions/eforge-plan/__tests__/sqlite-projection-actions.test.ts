import { describe, expect, it } from 'vitest';
import { invokePlanAction, seedProjectionBacklog, seedRecommendations, withTempProjectionProject } from './sqlite-projection-fixtures.js';

describe('SQLite projection extension actions', () => {
  it('dispatches get-item with SQL user status, effective lifecycle, optional links, and bounded fields', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const compact = await invokePlanAction(cwd, 'get-item', { id: 'running', includeBody: false, includeSections: false, includeLifecycleRows: false });
      const withLinks = await invokePlanAction(cwd, 'get-item', { id: 'running', includeLifecycleRows: true });

      expect(compact.item).toMatchObject({ id: 'running', status: 'active', userStatus: 'active', lifecycleState: 'build', lane: 'in-progress' });
      expect(compact.item).not.toHaveProperty('body');
      expect(compact.item).not.toHaveProperty('sections');
      expect(compact.item).not.toHaveProperty('linkRows');
      expect(compact.item).not.toHaveProperty('failureEvidence');
      expect(withLinks.item).toMatchObject({ reasonCodes: ['running-build'] });
      expect(withLinks.item.linkRows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1' })]));
    });
  });

  it('dispatches get-epic with SQLite item counts and deterministic item pagination', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const first = await invokePlanAction(cwd, 'get-epic', { id: 'epic-a', limit: 1, offset: 0, includeBody: false });
      const second = await invokePlanAction(cwd, 'get-epic', { id: 'epic-a', limit: 1, offset: 1, includeBody: false });

      expect(first.epic).toMatchObject({ id: 'epic-a', totalItems: 10, itemCount: 10, openItemCount: 8 });
      expect(first).toMatchObject({ totalItems: 10, itemCount: 10, limit: 1, offset: 0 });
      expect(first.items).toHaveLength(1);
      expect(second).toMatchObject({ totalItems: 10, itemCount: 10, limit: 1, offset: 1 });
      expect(second.items).toHaveLength(1);
      expect((second.items as Array<{ id: string }>)[0].id).not.toBe((first.items as Array<{ id: string }>)[0].id);
    });
  });

  it('dispatches compact/debug/markdown board actions from the same SQL lifecycle projection', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const compact = await invokePlanAction(cwd, 'list-board-compact', { includeClosed: true, includeArchive: true, limit: 500 });
      const board = await invokePlanAction(cwd, 'list-board', { includeArchive: true });
      const markdown = await invokePlanAction(cwd, 'render-board-markdown', { includeArchive: true });

      expect(compact).toMatchObject({ limit: 100, pagination: expect.objectContaining({ limit: 100 }) });
      expect(compact.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'queued', lane: 'in-progress', reasonCodes: ['queued-build'] })]));
      expect(board.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'queued', lane: 'in-progress', reasonCodes: ['queued-build'] })]));
      expect(markdown.markdown).toContain('queued-build');
    });
  });

  it('dispatches get-recommendations with SQL current model and actionability dispositions', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      seedRecommendations(cwd);

      const output = await invokePlanAction(cwd, 'get-recommendations');

      expect(output.recommendations).toMatchObject({ schemaVersion: 1 });
      expect(output.recommendationActionability).toMatchObject({ schemaVersion: 1 });
      expect(JSON.stringify(output.recommendationActionability)).toContain('planned-session-plan');
      expect(JSON.stringify(output.recommendationActionability)).toContain('suppressed');
      expect(JSON.stringify(output.recommendationActionability)).toContain('de-actioned');
    });
  });
});
