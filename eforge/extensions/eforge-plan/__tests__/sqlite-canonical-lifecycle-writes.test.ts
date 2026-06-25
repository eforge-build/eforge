import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { findCanonicalNonterminalCoverage } from '../canonical/coverage.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { openEforgePlanStore, recordLifecycleEvidence } from '../sqlite/index.js';
import { withCanonicalTransaction } from '../canonical/store.js';

function tempProject(): string { return mkdtempSync(join(tmpdir(), 'eforge-plan-canonical-lifecycle-')); }
function raw(cwd: string): DatabaseSync { const store = openEforgePlanStore(cwd); const db = new DatabaseSync(store.path); store.close(); return db; }

describe('canonical SQLite lifecycle writes', () => {
  it('records session start as a build-session row and current active-build evidence linked to the source item', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    syncSessionPlanArtifact(cwd, { session: 'plan-session-1', path: join(cwd, '.eforge/session-plans/s.md'), status: 'ready', sourceItemIds: ['item-1'] });

    recordCanonicalLifecycleEvent(cwd, { eventKey: 'session-start-1', type: 'session:start', session: 'plan-session-1', sessionId: 'build-session-1', runId: 'run-1', timestamp: '2026-01-01T00:00:00.000Z' }, ['item-1']);

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM build_sessions WHERE build_session_id = ?').get('build-session-1') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM build_runs WHERE run_id = ?').get('run-1') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT lifecycle_state, reason_code, build_session_id, run_id FROM lifecycle_evidence WHERE item_ref = ? AND source_event_key = ?').get('item-1', 'session-start-1')).toMatchObject({ lifecycle_state: 'build', reason_code: 'active-build', build_session_id: 'build-session-1', run_id: 'run-1' });
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1']).entries.map((entry) => entry.reasonCode)).toContain('active-build');
    db.close();
  });

  it('records PR-open landing evidence without changing user-authored status', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item', status: 'active' });

    recordCanonicalLifecycleEvent(cwd, { eventKey: 'pr-open-1', type: 'landing:complete', action: 'pr', prUrl: 'https://example.test/pr/1', timestamp: '2026-01-01T00:01:00.000Z' }, ['item-1']);

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM landing_links WHERE pr_url = ? AND status = ?').get('https://example.test/pr/1', 'pr-open') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT lifecycle_state, reason_code FROM lifecycle_evidence WHERE item_ref = ? AND source_event_key = ?').get('item-1', 'pr-open-1')).toMatchObject({ lifecycle_state: 'pr-open', reason_code: 'pr-open' });
    expect(db.prepare('SELECT user_status FROM backlog_items WHERE id = ?').get('item-1')).toMatchObject({ user_status: 'active' });
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1']).entries.map((entry) => entry.reasonCode)).toContain('pr-open');
    db.close();
  });

  it('records merge and auto-merge evidence as shipped, updates user status, and replays event keys idempotently', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    captureCanonicalBacklogItem(cwd, { id: 'item-2', title: 'Second item' });

    recordCanonicalLifecycleEvent(cwd, { eventKey: 'merge-1', type: 'landing:complete', action: 'merge', commitSha: 'abc', timestamp: '2026-01-01T00:02:00.000Z' }, ['item-1', 'item-2']);
    recordCanonicalLifecycleEvent(cwd, { eventKey: 'merge-1', type: 'landing:complete', action: 'merge', commitSha: 'abc', timestamp: '2026-01-01T00:02:00.000Z' }, ['item-1', 'item-2']);
    recordCanonicalLifecycleEvent(cwd, { eventKey: 'auto-merge-1', type: 'landing:auto-merge:complete', commitSha: 'def', timestamp: '2026-01-01T00:03:00.000Z' }, ['item-1']);

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM lifecycle_events WHERE event_key = ?').get('merge-1') as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE source_event_key = ? AND lifecycle_state = ?').get('merge-1', 'shipped') as { count: number }).count).toBe(2);
    expect((db.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE source_event_key = ? AND lifecycle_state = ?').get('auto-merge-1', 'shipped') as { count: number }).count).toBe(1);
    expect(db.prepare('SELECT user_status FROM backlog_items WHERE id = ?').get('item-1')).toMatchObject({ user_status: 'shipped' });
    expect(db.prepare('SELECT user_status FROM backlog_items WHERE id = ?').get('item-2')).toMatchObject({ user_status: 'shipped' });
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1'])).toMatchObject({ ok: false, entries: [expect.objectContaining({ reasonCode: 'shipped-result', lifecycleState: 'shipped' })] });
    db.close();
  });

  it('records failed lifecycle evidence and preserves partial/current-link explainability for multi-item sessions', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-1', title: 'Item' });
    captureCanonicalBacklogItem(cwd, { id: 'item-2', title: 'Second item' });
    syncSessionPlanArtifact(cwd, { session: 'plan-session-1', path: join(cwd, '.eforge/session-plans/s.md'), status: 'ready', sourceItemIds: ['item-1', 'item-2'] });

    recordCanonicalLifecycleEvent(cwd, { eventKey: 'session-fail-1', type: 'session:end', session: 'plan-session-1', sessionId: 'build-session-1', status: 'failed', timestamp: '2026-01-01T00:04:00.000Z' }, ['item-1', 'item-2']);

    const db = raw(cwd);
    expect((db.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE source_event_key = ? AND lifecycle_state = ? AND session = ?').get('session-fail-1', 'failed', 'plan-session-1') as { count: number }).count).toBe(2);
    expect((db.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE item_ref IN (?, ?) AND is_current = 1').get('item-1', 'item-2') as { count: number }).count).toBeGreaterThanOrEqual(2);
    expect(findCanonicalNonterminalCoverage(cwd, ['item-1'])).toMatchObject({ ok: false, entries: expect.arrayContaining([expect.objectContaining({ reasonCode: 'failed-result', lifecycleState: 'failed' })]) });
    db.close();
  });

  it.each([
    ['partial', 'partial-plan'],
    ['merged', 'merged-result'],
  ])('treats current %s result evidence as canonical coverage', (state, reasonCode) => {
    const cwd = tempProject();
    const itemId = `item-${state}`;
    captureCanonicalBacklogItem(cwd, { id: itemId, title: itemId });
    withCanonicalTransaction(cwd, (store) => recordLifecycleEvidence(store, { evidenceKey: `manual-${state}`, itemRef: itemId, itemId, lifecycleState: state as never, reasonCode, evidenceKind: 'event', status: state, isCurrent: true, isTerminal: true, occurredAt: '2026-01-01T00:05:00.000Z' }));

    expect(findCanonicalNonterminalCoverage(cwd, [itemId])).toMatchObject({ ok: false, entries: [expect.objectContaining({ reasonCode, lifecycleState: state })] });
  });
});
