import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem, updateCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { markCanonicalRecommendationsStale, writeCanonicalRecommendations } from '../canonical/recommendation-records.js';
import { openEforgePlanStore } from '../sqlite/index.js';
import type { BacklogRecommendationModel } from '../schema.js';

function tempProject(): string { return mkdtempSync(join(tmpdir(), 'eforge-plan-canonical-backlog-')); }
function raw(cwd: string): DatabaseSync { const store = openEforgePlanStore(cwd); const db = new DatabaseSync(store.path); store.close(); return db; }

function recommendationModel(): BacklogRecommendationModel {
  return {
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    activeWork: [{ itemId: 'active-1', rationale: 'already started', confidence: '0.8' }],
    readyCandidates: [{ itemId: 'ready-1', rationale: 'unblocked' }],
    recommendedNextSequence: [{ itemId: 'next-1', ref: 'rec-next-1' }],
    safeParallelizableGroups: [{ ref: 'group-a', title: 'Group A', itemIds: ['ready-1', 'next-1'], epicIds: ['epic-1'], safeToPlanTogether: true, recommendedProfile: 'excursion' }],
    blockedChains: [{ ref: 'chain-a', itemIds: ['blocked-1'], blockedBy: ['ready-1'], rationale: 'depends on ready work' }],
    rationaleAndAssumptions: ['Prefer ready work.'],
  };
}

describe('canonical SQLite backlog writes', () => {
  it('captures and updates backlog items through SQLite while preserving user status, body, metadata, hashes, and dirty markers', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, {
      id: 'item-1',
      title: 'Item',
      body: 'Body',
      userStatus: 'candidate',
      priority: 'p1',
      tags: ['a'],
      dependsOn: ['dep'],
      epic: 'epic-1',
      frontmatter: { custom: 'value' },
      sections: [{ sectionName: 'Acceptance', content: 'ship it' }],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:01:00.000Z',
    });
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item', body: 'Body', tags: ['a'], dependsOn: ['dep'], epic: 'epic-1' });
    updateCanonicalBacklogItem(cwd, 'item-1', { status: 'active', tags: ['b'], dependsOn: ['dep-2'], epic: 'epic-2' });

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM backlog_items WHERE id = ?').get('item-1') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT user_status, body, epic_ref, priority, body_sha256, record_sha256 FROM backlog_items WHERE id = ?').get('item-1')).toMatchObject({ user_status: 'active', body: 'Body', epic_ref: 'epic-2', priority: 'p1' });
    expect(db.prepare('SELECT json_extract(frontmatter_json, ?) AS custom FROM backlog_items WHERE id = ?').get('$.custom', 'item-1')).toMatchObject({ custom: 'value' });
    expect((db.prepare('SELECT count(*) AS count FROM backlog_item_tags WHERE item_id = ? AND tag = ?').get('item-1', 'b') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM backlog_item_tags WHERE item_id = ? AND tag = ?').get('item-1', 'a') as { count: number }).count).toBe(0);
    expect((db.prepare('SELECT count(*) AS count FROM item_dependencies WHERE item_id = ? AND dependency_ref = ?').get('item-1', 'dep-2') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM backlog_item_sections WHERE item_id = ? AND section_name = ?').get('item-1', 'Acceptance') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = ? AND document_id = ?').get('backlog_item', 'item-1') as { count: number }).count).toBe(1);
    expect(existsSync(join(cwd, '.eforge/backlog/item-1.md'))).toBe(false);
    db.close();
  });

  it('upserts epics and replaces only the touched epic tags and sections', () => {
    const cwd = tempProject();
    upsertCanonicalEpic(cwd, { id: 'epic-1', title: 'Epic 1', body: 'Body 1', tags: ['old'], sections: [{ sectionName: 'Context', content: 'old ctx' }] });
    upsertCanonicalEpic(cwd, { id: 'epic-2', title: 'Epic 2', body: 'Body 2', tags: ['keep'], sections: [{ sectionName: 'Notes', content: 'keep notes' }] });
    upsertCanonicalEpic(cwd, { id: 'epic-1', title: 'Epic 1 updated', body: 'Body 1', tags: ['new'], sections: [{ sectionName: 'Context', content: 'new ctx' }] });

    const db = raw(cwd);
    expect(db.prepare('SELECT title, body FROM epics WHERE id = ?').get('epic-1')).toMatchObject({ title: 'Epic 1 updated', body: 'Body 1' });
    expect((db.prepare('SELECT count(*) AS count FROM epic_tags WHERE epic_id = ? AND tag = ?').get('epic-1', 'old') as { count: number }).count).toBe(0);
    expect((db.prepare('SELECT count(*) AS count FROM epic_tags WHERE epic_id = ? AND tag = ?').get('epic-1', 'new') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM epic_tags WHERE epic_id = ? AND tag = ?').get('epic-2', 'keep') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT content FROM epic_sections WHERE epic_id = ? AND section_name = ?').get('epic-1', 'Context')).toMatchObject({ content: 'new ctx' });
    expect((db.prepare('SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = ? AND document_id = ?').get('epic', 'epic-1') as { count: number }).count).toBe(1);
    db.close();
  });

  it('writes recommendation runs with deterministic current ids, lane items, stale metadata, and dirty markers', () => {
    const cwd = tempProject();
    for (const id of ['active-1', 'ready-1', 'next-1', 'blocked-1']) captureCanonicalBacklogItem(cwd, { id, title: id });
    const first = writeCanonicalRecommendations(cwd, recommendationModel());
    const second = writeCanonicalRecommendations(cwd, recommendationModel());
    expect(second.runId).toBe(first.runId);
    markCanonicalRecommendationsStale(cwd, 'item-updated', ['ready-1']);

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM recommendation_runs WHERE run_id = ? AND is_current = 1').get(first.runId) as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM recommendation_runs WHERE is_current = 1').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM recommendation_lanes WHERE run_id = ?').get(first.runId) as { count: number }).count).toBe(5);
    expect((db.prepare('SELECT count(*) AS count FROM recommendation_lane_items rli JOIN recommendation_lanes rl ON rl.lane_id = rli.lane_id WHERE rl.run_id = ? AND rli.item_ref = ?').get(first.runId, 'ready-1') as { count: number }).count).toBeGreaterThan(0);
    expect(db.prepare('SELECT json_extract(freshness_json, ?) AS status, json_extract(freshness_json, ?) AS reason FROM recommendation_runs WHERE run_id = ?').get('$.status', '$.reason', first.runId)).toMatchObject({ status: 'stale', reason: 'item-updated' });
    expect((db.prepare('SELECT count(*) AS count FROM search_index_dirty_records sir JOIN recommendation_lanes rl ON rl.lane_id = sir.document_id WHERE sir.document_type = ? AND rl.run_id = ?').get('recommendation', first.runId) as { count: number }).count).toBe(5);
    db.close();
  });
});
