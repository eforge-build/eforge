import { describe, expect, it } from 'vitest';
import { buildFtsQuery, searchItems, searchPlanningRecords, tokenizeFtsQuery } from '../search/index.js';
import { dirtyItemAfterRebuild, seedAndRebuildSearchCorpus, withTempSearchProject } from './sqlite-search-fixtures.js';

describe('FTS query builder', () => {
  it('tokenizes hyphenated IDs and escapes punctuation, operators, quotes, and colons as quoted terms', () => {
    expect(tokenizeFtsQuery('ITEM-123: (alpha OR "beta")')).toEqual(['item', '123', 'alpha', 'or', 'beta']);
    const built = buildFtsQuery('ITEM-123: (alpha OR "beta")', { searchBody: true });
    expect(built.empty).toBe(false);
    expect(built.expression).toContain('{title tags_text item_ids_text epic_ids_text recommendation_refs_text summary_text body_text}');
    expect(built.expression).toContain('"item"');
    expect(built.expression).toContain('"123"');
    expect(built.expression).not.toContain('(alpha OR');
  });

  it('returns an empty query for punctuation-only input and scopes body columns only when requested', () => {
    expect(buildFtsQuery('--- : () !!!').empty).toBe(true);
    expect(buildFtsQuery('zetaonly', { searchBody: false }).expression).toBe('{title tags_text item_ids_text epic_ids_text recommendation_refs_text} : "zetaonly"');
    expect(buildFtsQuery('zetaonly', { searchBody: true }).expression).toContain('summary_text body_text');
  });
});

describe('SQLite FTS search behavior', () => {
  it('search-items ranks title hits before body-only hits and returns highlighted snippets without raw item bodies', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      const output = await searchItems(cwd, { query: 'orion', searchBody: true, includeArchive: true, limit: 10 });
      expect(output.items.map((item) => item.id).slice(0, 2)).toEqual(['item-title', 'item-body']);
      expect(output.items[0]).toMatchObject({ id: 'item-title', rank: expect.any(Number), snippet: { text: expect.stringContaining('<mark>') } });
      expect(output.snippets?.['item-title']?.highlights.length).toBeGreaterThan(0);
      expect(JSON.stringify(output)).not.toContain('The rare acceptance token zetaonly is indexed only with body search.');
    });
  });

  it('search-items matches IDs and tags without body search, but requires searchBody for section-only text', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      await expect(searchItems(cwd, { query: 'item-title', limit: 10 })).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 'item-title' })],
      });
      await expect(searchItems(cwd, { query: 'frontend', limit: 10 })).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 'item-title' })],
      });
      await expect(searchItems(cwd, { query: 'zetaonly', searchBody: false, limit: 10 })).resolves.toMatchObject({ items: [] });
      await expect(searchItems(cwd, { query: 'zetaonly', searchBody: true, limit: 10 })).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 'item-body' })],
      });
    });
  });

  it('search-items applies epic, status, lane, tag, archive, limit cap, and offset pagination filters through compact projections', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      const filtered = await searchItems(cwd, { query: 'orion', searchBody: true, epic: 'epic-orion', status: 'candidate', lane: 'ready', tags: ['launch'], includeArchive: false, includeDependencies: true, limit: 10 });
      expect(filtered.items).toEqual([expect.objectContaining({ id: 'item-title', epic: 'epic-orion', lane: 'ready' })]);
      expect(filtered.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'item-archive' })]));

      const capped = await searchItems(cwd, { query: 'orion', searchBody: true, includeArchive: true, limit: 500 });
      expect(capped.limit).toBe(100);
      expect(capped.items.length).toBeLessThanOrEqual(100);

      const secondPage = await searchItems(cwd, { query: 'orion', searchBody: true, includeArchive: true, limit: 1, offset: 1 });
      expect(secondPage).toMatchObject({ limit: 1, offset: 1, pagination: expect.objectContaining({ offset: 1, returned: 1 }) });
      expect(secondPage.items).toHaveLength(1);
    });
  });

  it('search-planning-records searches all domains, counts by type, filters by type, caps limits, and honors selected fields', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);

      const output = await searchPlanningRecords(cwd, { query: 'orion', fields: ['rank', 'snippet', 'refs', 'updatedAt'], limit: 20 });
      expect(new Set(output.results.map((result) => result.type))).toEqual(new Set(['backlog_item', 'epic', 'session_plan', 'recommendation']));
      expect(output.countsByType).toMatchObject({ backlog_item: expect.any(Number), epic: expect.any(Number), session_plan: expect.any(Number), recommendation: expect.any(Number) });
      expect(output.results[0]).toEqual(expect.objectContaining({ id: expect.any(String), type: expect.any(String), title: expect.any(String), rank: expect.any(Number) }));

      const epicsOnly = await searchPlanningRecords(cwd, { query: 'orion', types: ['epic'], limit: 20 });
      expect(epicsOnly.results.length).toBeGreaterThan(0);
      expect(epicsOnly.results.every((result) => result.type === 'epic')).toBe(true);

      const snippetOnly = await searchPlanningRecords(cwd, { query: 'orion', fields: ['snippet'], limit: 1 });
      expect(snippetOnly.results[0]).toEqual(expect.objectContaining({ id: expect.any(String), type: expect.any(String), title: expect.any(String), snippet: expect.any(Object) }));
      expect(snippetOnly.results[0]).not.toHaveProperty('rank');
      expect(snippetOnly.results[0]).not.toHaveProperty('refs');
      expect(snippetOnly.results[0]).not.toHaveProperty('updatedAt');

      const capped = await searchPlanningRecords(cwd, { query: 'orion', limit: 500 });
      expect(capped.page.limit).toBe(100);
      expect(capped.results.length).toBeLessThanOrEqual(100);
    });
  });

  it('returns explicit dirty index metadata without rebuilding on read-only search paths', async () => {
    await withTempSearchProject(async (cwd) => {
      seedAndRebuildSearchCorpus(cwd);
      dirtyItemAfterRebuild(cwd);

      const itemOutput = await searchItems(cwd, { query: 'orion', limit: 10 });
      expect(itemOutput).toMatchObject({ indexDirty: true, indexStatus: expect.objectContaining({ dirty: true, dirtyCount: 1, dirtyTypes: ['backlog_item'] }) });

      const allDomainOutput = await searchPlanningRecords(cwd, { query: 'orion', limit: 10 });
      expect(allDomainOutput).toMatchObject({ indexDirty: true, indexStatus: expect.objectContaining({ dirty: true, dirtyCount: 1, dirtyTypes: ['backlog_item'] }) });
    });
  });
});
