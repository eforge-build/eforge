import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  EforgePlanStoreError,
  clearSearchIndexDirty,
  getBacklogItem,
  getEpic,
  getSearchIndexState,
  linkSessionPlanEpics,
  linkSessionPlanItems,
  listItemDependencies,
  markSearchIndexDirty,
  openEforgePlanStore,
  recordLifecycleEvent,
  recordLifecycleEvidence,
  recordMaintenanceRun,
  recordQueueBuildCorrelation,
  replaceBacklogItemSections,
  replaceBacklogItemTags,
  replaceEpicSections,
  replaceEpicTags,
  replaceItemDependencies,
  replacePlanningTaskRefs,
  replaceRecommendationLaneItems,
  replaceSearchDocument,
  rowToBacklogItem,
  rowToLifecycleEvent,
  rowToPlanningTask,
  upsertBacklogItem,
  upsertBuildRun,
  upsertBuildSession,
  upsertEpic,
  upsertLandingLink,
  upsertPlanningTask,
  upsertQueuePrd,
  upsertRecommendationLane,
  upsertRecommendationRun,
  upsertSessionPlan,
} from '../sqlite/index.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'eforge-plan-repos-'));
}

function openRaw(path: string): DatabaseSync {
  return new DatabaseSync(path, {});
}

function count(raw: DatabaseSync, sql: string): number {
  return (raw.prepare(sql).get() as { count: number }).count;
}

describe('eforge-plan SQLite repositories', () => {
  it('uses stable backlog item and epic upserts while preserving JSON, hashes, sections, tags, and unresolved dependency refs', () => {
    const store = openEforgePlanStore(tempProject());

    expect(
      upsertEpic(store, {
        id: 'epic-1',
        title: 'Epic',
        body: 'Epic body',
        userStatus: 'planned',
        frontmatter: { area: 'core' },
        recordSha256: 'epic-record',
      }),
    ).toMatchObject({ id: 'epic-1', frontmatter: { area: 'core' }, recordSha256: 'epic-record' });
    replaceEpicTags(store, 'epic-1', ['foundation', 'foundation', 'sqlite']);
    replaceEpicSections(store, 'epic-1', [{ sectionName: 'Context', content: 'epic section', contentSha256: 'epic-section' }]);

    upsertBacklogItem(store, {
      id: 'item-1',
      title: 'First',
      body: 'Original body',
      userStatus: 'candidate',
      epicId: 'epic-1',
      frontmatter: { a: 1, nested: { ok: true } },
      bodySha256: 'body-one',
      recordSha256: 'record-one',
      importOrigin: 'legacy',
      importPath: 'backlog/item-1.md',
    });
    upsertBacklogItem(store, {
      id: 'item-1',
      title: 'First updated',
      body: 'Updated body',
      userStatus: 'active',
      epicRef: 'legacy-epic-ref',
      frontmatter: { a: 2 },
      bodySha256: 'body-two',
      recordSha256: 'record-two',
    });
    replaceBacklogItemTags(store, 'item-1', ['a', 'a', 'b']);
    replaceBacklogItemSections(store, 'item-1', [
      { sectionName: 'Requirements', content: 'must store data', contentSha256: 'req-hash' },
      { sectionName: 'Notes' },
    ]);
    replaceItemDependencies(store, 'item-1', [
      { dependencyRef: 'legacy-ref', dependencyStatus: 'missing', diagnostic: { unresolved: true } },
      { dependencyRef: 'external-ticket', dependencyKind: 'blocks', dependencyStatus: 'external', sourcePath: 'roadmap.md' },
    ]);

    expect(getBacklogItem(store, 'item-1')).toMatchObject({
      id: 'item-1',
      title: 'First updated',
      body: 'Updated body',
      userStatus: 'active',
      epicRef: 'legacy-epic-ref',
      frontmatter: { a: 2 },
      bodySha256: 'body-two',
      recordSha256: 'record-two',
    });
    expect(getEpic(store, 'epic-1')).toMatchObject({ id: 'epic-1', frontmatter: { area: 'core' } });
    expect(listItemDependencies(store, 'item-1')).toEqual([
      expect.objectContaining({ dependencyRef: 'external-ticket', dependencyKind: 'blocks', dependencyStatus: 'external', sourcePath: 'roadmap.md' }),
      expect.objectContaining({ dependencyRef: 'legacy-ref', dependencyKind: 'depends-on', dependencyStatus: 'missing', diagnostic: { unresolved: true } }),
    ]);

    const raw = openRaw(store.path);
    expect(count(raw, "SELECT count(*) AS count FROM backlog_items WHERE id = 'item-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM backlog_item_tags WHERE item_id = 'item-1'")).toBe(2);
    expect(count(raw, "SELECT count(*) AS count FROM backlog_item_sections WHERE item_id = 'item-1'")).toBe(2);
    expect(count(raw, "SELECT count(*) AS count FROM epic_tags WHERE epic_id = 'epic-1'")).toBe(2);
    expect(count(raw, "SELECT count(*) AS count FROM epic_sections WHERE epic_id = 'epic-1'")).toBe(1);
    raw.close();
    store.close();
  });

  it('stores recommendation runs, lanes, lane items, planning task refs, and session-plan item/epic joins idempotently', () => {
    const store = openEforgePlanStore(tempProject());

    upsertEpic(store, { id: 'epic-1', title: 'Epic', userStatus: 'planned' });
    upsertBacklogItem(store, { id: 'item-1', title: 'Item 1', userStatus: 'candidate' });
    upsertBacklogItem(store, { id: 'item-2', title: 'Item 2', userStatus: 'planned' });

    expect(upsertRecommendationRun(store, { runId: 'rec-1', isCurrent: true, rawModel: { lanes: 1 }, summary: ['ok'] })).toMatchObject({
      runId: 'rec-1',
      isCurrent: true,
      rawModel: { lanes: 1 },
      summary: ['ok'],
    });
    upsertRecommendationRun(store, { runId: 'rec-1', isCurrent: false, rawModel: { lanes: 2 } });
    expect(upsertRecommendationLane(store, { laneId: 'lane-1', runId: 'rec-1', laneKind: 'activeWork', laneRef: 'active', sequence: 2 })).toMatchObject({
      laneId: 'lane-1',
      sequence: 2,
    });
    upsertRecommendationLane(store, { laneId: 'lane-1', runId: 'rec-1', laneKind: 'activeWork', laneRef: 'active', title: 'Updated lane' });
    replaceRecommendationLaneItems(store, 'lane-1', [
      { itemRef: 'item-1', itemId: 'item-1', role: 'member', sequence: 1, confidence: 0.9 },
      { itemRef: 'legacy-unresolved', role: 'blocked', rationale: 'legacy ref retained' },
    ]);

    upsertPlanningTask(store, { taskId: 'task-parent', purpose: 'seed' });
    expect(
      upsertPlanningTask(store, {
        taskId: 'task-1',
        purpose: 'session-plan',
        statusSnapshot: 'ready',
        parentTaskId: 'task-parent',
        rawRequest: { include: ['item-1'] },
        rawPayloadPrunable: false,
      }),
    ).toMatchObject({ taskId: 'task-1', parentTaskId: 'task-parent', rawRequest: { include: ['item-1'] }, rawPayloadPrunable: false });
    replacePlanningTaskRefs(store, {
      taskId: 'task-1',
      items: [{ ref: 'item-1', resolvedId: 'item-1', role: 'primary', metadata: { rank: 1 } }],
      epics: [{ ref: 'legacy-epic', resolvedId: 'epic-1', role: 'scope' }],
      recommendationRefs: [{ ref: 'lane-1', role: 'source' }],
    });

    upsertSessionPlan(store, { session: 's1', topic: 'One', status: 'ready', frontmatter: { topic: 'One' }, readinessSummary: { ok: true } });
    upsertSessionPlan(store, { session: 's2', topic: 'Two' });
    linkSessionPlanItems(store, { session: 's1', items: [{ itemRef: 'item-1', itemId: 'item-1', role: 'primary', provenance: 'manual' }] });
    linkSessionPlanItems(store, { session: 's1', items: [{ itemRef: 'item-1', itemId: 'item-1', role: 'primary', provenance: 'manual', sequence: 10 }] });
    linkSessionPlanItems(store, { session: 's2', items: [{ itemRef: 'item-1', itemId: 'item-1', role: 'primary', provenance: 'manual' }] });
    linkSessionPlanEpics(store, { session: 's1', epics: [{ epicRef: 'epic-1', epicId: 'epic-1', role: 'scope', provenance: 'task', sourceTaskId: 'task-1' }] });

    const raw = openRaw(store.path);
    expect(count(raw, "SELECT count(*) AS count FROM recommendation_runs WHERE run_id = 'rec-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM recommendation_lanes WHERE lane_id = 'lane-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM recommendation_lane_items WHERE lane_id = 'lane-1'")).toBe(2);
    expect(raw.prepare("SELECT item_ref, item_id FROM recommendation_lane_items WHERE item_ref = 'legacy-unresolved'").get()).toMatchObject({
      item_ref: 'legacy-unresolved',
      item_id: null,
    });
    expect(count(raw, "SELECT count(*) AS count FROM planning_task_items WHERE task_id = 'task-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM planning_task_epics WHERE task_id = 'task-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM planning_task_recommendation_refs WHERE task_id = 'task-1'")).toBe(1);
    expect(count(raw, "SELECT count(*) AS count FROM session_plan_items WHERE item_id = 'item-1'")).toBe(2);
    expect(count(raw, "SELECT count(*) AS count FROM session_plan_epics WHERE epic_id = 'epic-1'")).toBe(1);
    raw.close();
    store.close();
  });

  it('preserves queue/build/session/landing correlations and lifecycle/maintenance evidence payloads', () => {
    const store = openEforgePlanStore(tempProject());

    upsertBacklogItem(store, { id: 'item-1', title: 'Item', userStatus: 'candidate' });
    upsertSessionPlan(store, { session: 's1', topic: 'Queue topic' });
    expect(upsertQueuePrd(store, { prdId: 'prd-1', session: 's1', status: 'queued' })).toMatchObject({ prdId: 'prd-1', session: 's1' });
    expect(upsertBuildSession(store, { buildSessionId: 'bs-1', status: 'running' })).toMatchObject({ buildSessionId: 'bs-1', status: 'running' });
    expect(upsertBuildRun(store, { runId: 'run-1', session: 's1', status: 'running', planSet: 'plan-01' })).toMatchObject({ runId: 'run-1' });
    expect(upsertLandingLink(store, { landingId: 'land-1', session: 's1', itemId: 'item-1', status: 'pr-open', prUrl: 'https://example/pr/1', summary: { done: true } })).toMatchObject({
      landingId: 'land-1',
      summary: { done: true },
    });
    recordQueueBuildCorrelation(store, { queuePrdId: 'prd-1', runId: 'run-1', buildSessionId: 'bs-1', landingId: 'land-1' });

    expect(
      recordLifecycleEvent(store, {
        eventKey: 'evt-1',
        eventType: 'plan:status:change',
        session: 's1',
        runId: 'run-1',
        affectedItemRefs: ['item-1'],
        payload: { status: 'active' },
        payloadPrunable: false,
      }),
    ).toMatchObject({ eventKey: 'evt-1', affectedItemRefs: ['item-1'], payload: { status: 'active' }, payloadPrunable: false });
    expect(
      recordLifecycleEvidence(store, {
        evidenceKey: 'evidence-1',
        itemId: 'item-1',
        itemRef: 'item-1',
        session: 's1',
        runId: 'run-1',
        buildSessionId: 'bs-1',
        landingId: 'land-1',
        sourceEventKey: 'evt-1',
        lifecycleState: 'pr-open',
        isCurrent: true,
        isTerminal: false,
        links: { pr: 'https://example/pr/1' },
        retainedSummary: { summary: 'PR opened' },
      }),
    ).toMatchObject({ evidenceKey: 'evidence-1', lifecycleState: 'pr-open', links: { pr: 'https://example/pr/1' } });

    expect(recordMaintenanceRun(store, { runId: 'maint-1', categories: ['search'], prunedCounts: { payloads: 0 }, status: 'ok' })).toMatchObject({
      runId: 'maint-1',
      categories: ['search'],
      prunedCounts: { payloads: 0 },
    });

    const raw = openRaw(store.path);
    expect(raw.prepare("SELECT queue_prd_id FROM build_runs WHERE run_id = 'run-1'").get()).toMatchObject({ queue_prd_id: 'prd-1' });
    expect(raw.prepare("SELECT session FROM build_sessions WHERE build_session_id = 'bs-1'").get()).toMatchObject({ session: 's1' });
    expect(raw.prepare("SELECT queue_prd_id FROM landing_links WHERE landing_id = 'land-1'").get()).toMatchObject({ queue_prd_id: 'prd-1' });
    expect(count(raw, "SELECT count(*) AS count FROM lifecycle_evidence WHERE item_id = 'item-1' AND is_current = 1")).toBe(1);
    raw.close();
    store.close();
  });

  it('replaces search documents, updates FTS rows, and tracks/clears dirty state metadata', () => {
    const store = openEforgePlanStore(tempProject());

    expect(
      replaceSearchDocument(store, {
        documentType: 'backlog_item',
        documentId: 'item-1',
        title: 'Needle title',
        tagsText: 'sqlite storage',
        bodyText: 'haystack body',
        sourceSha256: 'search-sha',
      }),
    ).toMatchObject({ documentType: 'backlog_item', documentId: 'item-1', title: 'Needle title', dirty: false });
    replaceSearchDocument(store, { documentType: 'backlog_item', documentId: 'item-1', title: 'Updated needle', bodyText: 'replacement body' });
    markSearchIndexDirty(store, { documentType: 'backlog_item', documentId: 'item-1', reason: 'repository-test', markedAt: '2026-01-01T00:00:00.000Z' });

    expect(getSearchIndexState(store)).toMatchObject({ dirty: true, dirtySince: '2026-01-01T00:00:00.000Z', dirtyReason: 'repository-test' });

    const raw = openRaw(store.path);
    expect(raw.prepare("SELECT document_id FROM search_documents_fts WHERE search_documents_fts MATCH 'Updated'").get()).toMatchObject({ document_id: 'item-1' });
    expect(raw.prepare("SELECT dirty FROM search_documents WHERE document_type = 'backlog_item' AND document_id = 'item-1'").get()).toMatchObject({ dirty: 1 });
    expect(count(raw, "SELECT count(*) AS count FROM search_documents_fts WHERE document_type = 'backlog_item' AND document_id = 'item-1'")).toBe(1);

    clearSearchIndexDirty(store, { rebuiltAt: '2026-01-02T00:00:00.000Z' });
    expect(getSearchIndexState(store)).toMatchObject({ dirty: false, lastRebuiltAt: '2026-01-02T00:00:00.000Z' });
    expect(count(raw, 'SELECT count(*) AS count FROM search_index_dirty_records')).toBe(0);
    expect(raw.prepare("SELECT dirty FROM search_documents WHERE document_type = 'backlog_item' AND document_id = 'item-1'").get()).toMatchObject({ dirty: 0 });
    raw.close();
    store.close();
  });

  it('row mappers convert nullable JSON and boolean columns and report invalid JSON with stable error codes', () => {
    expect(
      rowToBacklogItem({
        id: 'item-1',
        title: 'Mapped',
        body: '',
        user_status: 'candidate',
        priority: null,
        source: null,
        created_at: null,
        updated_at: null,
        last_checked_at: null,
        stale_after: null,
        epic_ref: null,
        epic_id: null,
        frontmatter_json: '{"ok":true}',
        body_sha256: null,
        record_sha256: null,
        import_origin: null,
        import_path: null,
      }),
    ).toEqual({ id: 'item-1', title: 'Mapped', body: '', userStatus: 'candidate', frontmatter: { ok: true } });

    expect(rowToPlanningTask({ task_id: 'task-1', raw_payload_prunable: 0 })).toMatchObject({ taskId: 'task-1', rawPayloadPrunable: false });
    expect(rowToLifecycleEvent({ event_key: 'evt-1', event_type: 'x', affected_item_refs_json: '["item-1"]', payload_prunable: 0 })).toMatchObject({
      eventKey: 'evt-1',
      affectedItemRefs: ['item-1'],
      payloadPrunable: false,
    });
    expect(() =>
      rowToBacklogItem({
        id: 'bad-json',
        title: 'Bad JSON',
        body: '',
        user_status: 'candidate',
        priority: null,
        source: null,
        created_at: null,
        updated_at: null,
        last_checked_at: null,
        stale_after: null,
        epic_ref: null,
        epic_id: null,
        frontmatter_json: '{not json',
        body_sha256: null,
        record_sha256: null,
        import_origin: null,
        import_path: null,
      }),
    ).toThrow(expect.objectContaining<EforgePlanStoreError>({ code: 'invalid-json-column' }));
  });
});
