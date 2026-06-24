import { describe, expect, it } from 'vitest';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { dirtyItemAfterRebuild, invokeSearchAction, seedAndRebuildSearchCorpus, withTempSearchProject } from './sqlite-search-fixtures.js';

function registeredActions() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return state.actions.map((entry) => entry.value);
}

describe('FTS-backed search extension actions', () => {
  it('registers search-items and search-planning-records as bounded read-only paginated actions', () => {
    const actions = registeredActions();
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'search-items', outputProfile: 'agent-paginated', sideEffects: ['local-read'] }),
      expect.objectContaining({ id: 'search-planning-records', outputProfile: 'agent-paginated', sideEffects: ['local-read'] }),
    ]));
    const searchItemsOutput = actions.find((action) => action.id === 'search-items')?.outputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(searchItemsOutput.properties ?? {}).sort()).toEqual(expect.arrayContaining(['counts', 'indexDirty', 'indexStatus', 'pagination', 'snippets']));
    const planningInput = actions.find((action) => action.id === 'search-planning-records')?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(planningInput.properties ?? {}).sort()).toEqual(expect.arrayContaining(['fields', 'limit', 'offset', 'query', 'types']));
  });

  it('dispatches search-items through the extension registry with bounded snippets, counts, pagination, and index status', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      const output = await invokeSearchAction(cwd, 'search-items', { query: 'orion', searchBody: true, includeArchive: true, limit: 500 });
      expect(output).toMatchObject({
        schemaVersion: 1,
        limit: 100,
        offset: 0,
        counts: { total: expect.any(Number) },
        pagination: expect.objectContaining({ limit: 100, offset: 0 }),
        indexDirty: false,
        indexStatus: expect.objectContaining({ dirty: false, dirtyCount: 0 }),
      });
      expect(output.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'item-title', snippet: expect.objectContaining({ text: expect.stringContaining('<mark>') }) })]));
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain('The rare acceptance token zetaonly is indexed only with body search.');
      expect(serialized).not.toContain('rawModel');
      expect(serialized).not.toContain('import diagnostics');
    });
  });

  it('dispatches search-planning-records with selected fields and omits raw domain payloads', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      const output = await invokeSearchAction(cwd, 'search-planning-records', { query: 'orion', fields: ['snippet'], limit: 20 });
      expect(output).toMatchObject({
        schemaVersion: 1,
        countsByType: expect.objectContaining({ backlog_item: expect.any(Number), epic: expect.any(Number), session_plan: expect.any(Number), recommendation: expect.any(Number) }),
        page: expect.objectContaining({ limit: 20, offset: 0 }),
        indexDirty: false,
      });
      const results = output.results as Array<Record<string, unknown>>;
      expect(new Set(results.map((result) => result.type))).toEqual(new Set(['backlog_item', 'epic', 'session_plan', 'recommendation']));
      expect(results[0]).toEqual(expect.objectContaining({ id: expect.any(String), type: expect.any(String), title: expect.any(String), snippet: expect.any(Object) }));
      expect(results[0]).not.toHaveProperty('rank');
      expect(results[0]).not.toHaveProperty('refs');
      expect(results[0]).not.toHaveProperty('updatedAt');

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain('DO_NOT_INDEX_MARKDOWN_BODY');
      expect(serialized).not.toContain('rawModel');
      expect(serialized).not.toContain('lifecycle event');
      expect(serialized).not.toContain('import diagnostics');
    });
  });

  it('dispatch reports dirty-index metadata for both search actions without implicit rebuild', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);
      dirtyItemAfterRebuild(cwd);

      await expect(invokeSearchAction(cwd, 'search-items', { query: 'orion', limit: 10 })).resolves.toMatchObject({
        indexDirty: true,
        indexStatus: expect.objectContaining({ dirty: true, dirtyCount: 1, dirtyTypes: ['backlog_item'] }),
      });
      await expect(invokeSearchAction(cwd, 'search-planning-records', { query: 'orion', limit: 10 })).resolves.toMatchObject({
        indexDirty: true,
        indexStatus: expect.objectContaining({ dirty: true, dirtyCount: 1, dirtyTypes: ['backlog_item'] }),
      });
    });
  });
});
