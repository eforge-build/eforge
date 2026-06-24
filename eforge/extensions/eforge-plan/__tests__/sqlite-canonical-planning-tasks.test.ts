import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { findCanonicalNonterminalCoverage } from '../canonical/coverage.js';
import { markPlanningTaskWorkflowEntryApplied, markPlanningTaskWorkflowEntryDismissed, recordPlanningTaskWorkflowEntry } from '../canonical/planning-task-records.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { openEforgePlanStore } from '../sqlite/index.js';

function tempProject(): string { return mkdtempSync(join(tmpdir(), 'eforge-plan-canonical-task-')); }
function raw(cwd: string): DatabaseSync { const store = openEforgePlanStore(cwd); const db = new DatabaseSync(store.path); store.close(); return db; }

describe('canonical SQLite planning task writes', () => {
  it('records parent links, selections, summaries, raw payloads, dirty markers, and active duplicate coverage', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    upsertCanonicalEpic(cwd, { id: 'epic-1', title: 'Epic' });
    recordPlanningTaskWorkflowEntry(cwd, { taskId: 'parent-task', purpose: 'refresh', status: 'running', sourceFingerprint: 'parent-fp' });

    recordPlanningTaskWorkflowEntry(cwd, {
      taskId: 'task-1',
      purpose: 'session-plan-creation',
      status: 'running',
      sourceFingerprint: 'fp',
      requestedSections: ['problem', 'solution'],
      selectionSummary: { itemCount: 1, epicCount: 1 },
      compactResultSummary: { draftCount: 1 },
      rawRequest: { prompt: 'plan item' },
      rawResult: { draftSession: 's' },
      parentTaskId: 'parent-task',
      itemRefs: ['item-1'],
      epicRefs: ['epic-1'],
      recommendationRefs: ['lane:1'],
    });

    expect(findCanonicalNonterminalCoverage(cwd, ['item-1']).entries.map((entry) => entry.reasonCode)).toContain('active-planning-task');
    const db = raw(cwd);
    expect(db.prepare('SELECT task_id, parent_task_id, purpose, status_snapshot, source_fingerprint FROM planning_tasks WHERE task_id = ?').get('task-1')).toMatchObject({ task_id: 'task-1', parent_task_id: 'parent-task', purpose: 'session-plan-creation', status_snapshot: 'running', source_fingerprint: 'fp' });
    expect(db.prepare('SELECT json_extract(selection_summary_json, ?) AS itemCount, json_extract(compact_result_summary_json, ?) AS draftCount FROM planning_tasks WHERE task_id = ?').get('$.itemCount', '$.draftCount', 'task-1')).toMatchObject({ itemCount: 1, draftCount: 1 });
    expect((db.prepare('SELECT count(*) AS count FROM planning_task_items WHERE task_id = ? AND item_ref = ?').get('task-1', 'item-1') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM planning_task_epics WHERE task_id = ? AND epic_ref = ?').get('task-1', 'epic-1') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM planning_task_recommendation_refs WHERE task_id = ? AND recommendation_ref = ?').get('task-1', 'lane:1') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = ? AND document_id = ?').get('backlog_item', 'item-1') as { count: number }).count).toBe(1);
    db.close();
  });

  it('marks entries applied and dismisses entries so duplicate coverage no longer blocks consumed work', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    captureCanonicalBacklogItem(cwd, { id: 'item-2', title: 'Item 2' });
    recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-1', purpose: 'session-plan-creation', status: 'running', sourceFingerprint: 'fp', itemRefs: ['item-1'] });
    recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-2', purpose: 'curation', status: 'running', sourceFingerprint: 'fp-2', itemRefs: ['item-2'] });

    markPlanningTaskWorkflowEntryApplied(cwd, 'task-1', '2026-01-01T00:00:00.000Z');
    markPlanningTaskWorkflowEntryDismissed(cwd, 'task-2', '2026-01-01T00:01:00.000Z');

    const db = raw(cwd);
    expect(db.prepare('SELECT applied_at, status_snapshot FROM planning_tasks WHERE task_id = ?').get('task-1')).toMatchObject({ applied_at: '2026-01-01T00:00:00.000Z', status_snapshot: 'applied' });
    expect(db.prepare('SELECT status_snapshot FROM planning_tasks WHERE task_id = ?').get('task-2')).toMatchObject({ status_snapshot: 'dismissed' });
    db.close();
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1']).ok).toBe(true);
    expect(findCanonicalNonterminalCoverage(cwd, ['item-2']).ok).toBe(true);
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1'], { includeTerminalReasons: true }).entries.map((entry) => entry.reasonCode)).toContain('active-planning-task');
  });

  it('detects active build coverage before starting a selected planning task', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    let startCalls = 0;
    syncSessionPlanArtifact(cwd, { session: 'plan-session-1', path: join(cwd, '.eforge/session-plans/s.md'), status: 'ready', sourceItemIds: ['item-1'] });
    recordCanonicalLifecycleEvent(cwd, { eventKey: 'session-start-1', type: 'session:start', session: 'plan-session-1', sessionId: 'build-session-1', runId: 'run-1', timestamp: '2026-01-01T00:00:00.000Z' }, ['item-1']);

    const coverage = findCanonicalNonterminalCoverage(cwd, ['item-1']);
    if (!coverage.ok) {
      // Action handlers must return this rejection before they invoke ctx.agentTasks.start.
    } else {
      startCalls += 1;
    }

    expect(coverage.entries.map((entry) => entry.reasonCode)).toContain('active-build');
    expect(startCalls).toBe(0);
  });

  it('keeps the same active task for repeated recommendation or background refresh fingerprints', () => {
    const cwd = tempProject();
    recordPlanningTaskWorkflowEntry(cwd, { taskId: 'refresh-1', purpose: 'recommendation-refresh', status: 'running', sourceFingerprint: 'refresh-fp' });
    recordPlanningTaskWorkflowEntry(cwd, { taskId: 'refresh-1', purpose: 'recommendation-refresh', status: 'running', sourceFingerprint: 'refresh-fp' });

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM planning_tasks WHERE purpose = ? AND source_fingerprint = ?').get('recommendation-refresh', 'refresh-fp') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT task_id FROM planning_tasks WHERE purpose = ? AND source_fingerprint = ?').get('recommendation-refresh', 'refresh-fp')).toMatchObject({ task_id: 'refresh-1' });
    db.close();
  });
});
