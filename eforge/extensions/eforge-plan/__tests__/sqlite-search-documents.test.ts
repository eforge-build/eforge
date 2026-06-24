import { describe, expect, it } from 'vitest';
import { buildSearchDocuments, getSearchIndexStatus, rebuildSearchIndex, refreshDirtySearchDocuments, refreshSearchDocuments } from '../search/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { dirtyItemAfterRebuild, seedSearchCorpus, withSearchStore, withTempSearchProject } from './sqlite-search-fixtures.js';

function tableCount(store: Parameters<typeof getDatabase>[0], table: string): number {
  return (getDatabase(store).prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function documentText(store: Parameters<typeof getDatabase>[0], type: string, id: string): string {
  const row = getDatabase(store).prepare('SELECT title, tags_text, summary_text, body_text, item_ids_text, epic_ids_text, recommendation_refs_text FROM search_documents WHERE document_type = ? AND document_id = ?').get(type, id) as Record<string, string | null> | undefined;
  expect(row).toBeDefined();
  return Object.values(row ?? {}).filter(Boolean).join('\n');
}

describe('SQLite FTS search document projection and maintenance', () => {
  it('projects canonical items, epics, session plans, and recommendations into bounded search documents', async () => {
    await withTempSearchProject((cwd) => {
      seedSearchCorpus(cwd);

      withSearchStore(cwd, (store) => {
        const docs = buildSearchDocuments(store);
        expect(docs.map((doc) => doc.documentType).sort()).toEqual([
          'backlog_item', 'backlog_item', 'backlog_item',
          'epic', 'epic',
          'recommendation', 'recommendation', 'recommendation', 'recommendation',
          'session_plan',
        ]);
        expect(docs.find((doc) => doc.documentType === 'backlog_item' && doc.documentId === 'item-body')).toMatchObject({
          title: 'Gateway body hit',
          itemIdsText: 'item-body',
          epicIdsText: 'epic-orion',
        });
        expect(docs.find((doc) => doc.documentType === 'backlog_item' && doc.documentId === 'item-body')?.bodyText).toContain('zetaonly');
        expect(docs.find((doc) => doc.documentType === 'session_plan')?.bodyText).toBe('');
        expect(JSON.stringify(docs.find((doc) => doc.documentType === 'session_plan'))).not.toContain('DO_NOT_INDEX_MARKDOWN_BODY');
        for (const doc of docs) expect(doc.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      });
    });
  });

  it('rebuilds idempotently, populates FTS rows, clears dirty state, and omits session-plan markdown bodies', async () => {
    await withTempSearchProject((cwd) => {
      seedSearchCorpus(cwd);

      withSearchStore(cwd, (store) => {
        const first = rebuildSearchIndex(store);
        const afterFirst = { docs: tableCount(store, 'search_documents'), fts: tableCount(store, 'search_documents_fts') };
        const hashes = getDatabase(store).prepare('SELECT document_type, document_id, source_sha256 FROM search_documents ORDER BY document_type, document_id').all();
        const second = rebuildSearchIndex(store);

        expect(first.refreshed).toBe(afterFirst.docs);
        expect(second.refreshed).toBe(afterFirst.docs);
        expect({ docs: tableCount(store, 'search_documents'), fts: tableCount(store, 'search_documents_fts') }).toEqual(afterFirst);
        expect(getDatabase(store).prepare('SELECT document_type, document_id, source_sha256 FROM search_documents ORDER BY document_type, document_id').all()).toEqual(hashes);
        expect(getSearchIndexStatus(store)).toMatchObject({ dirty: false, dirtyCount: 0, dirtyTypes: [] });
        expect(documentText(store, 'session_plan', 'session-orion')).toContain('Session summary mentions orion readiness');
        expect(documentText(store, 'session_plan', 'session-orion')).not.toContain('DO_NOT_INDEX_MARKDOWN_BODY');
      });
    });
  });

  it('refreshes selected dirty records without implicitly rebuilding the full index', async () => {
    await withTempSearchProject((cwd) => {
      seedSearchCorpus(cwd);
      withSearchStore(cwd, (store) => rebuildSearchIndex(store));
      dirtyItemAfterRebuild(cwd);

      withSearchStore(cwd, (store) => {
        expect(getSearchIndexStatus(store)).toMatchObject({ dirty: true, dirtyCount: 1, dirtyTypes: ['backlog_item'] });
        const report = refreshDirtySearchDocuments(store, { limit: 1, reason: 'test-refresh' });
        expect(report).toMatchObject({ refreshed: 1, clearedDirty: 1, types: ['backlog_item'] });
        expect(getSearchIndexStatus(store)).toMatchObject({ dirty: false, dirtyCount: 0 });
      });
    });
  });

  it('refreshSearchDocuments replaces requested documents and clears matching dirty markers', async () => {
    await withTempSearchProject((cwd) => {
      seedSearchCorpus(cwd);
      withSearchStore(cwd, (store) => rebuildSearchIndex(store));
      dirtyItemAfterRebuild(cwd);

      withSearchStore(cwd, (store) => {
        refreshSearchDocuments(store, { records: [{ type: 'backlog_item', id: 'item-title' }], reason: 'single-record' });
        expect(documentText(store, 'backlog_item', 'item-title')).toContain('updated');
        expect(getSearchIndexStatus(store)).toMatchObject({ dirty: false, dirtyCount: 0 });
      });
    });
  });
});
