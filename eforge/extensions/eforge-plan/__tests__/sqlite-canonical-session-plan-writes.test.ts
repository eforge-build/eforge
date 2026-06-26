import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { findCanonicalNonterminalCoverage } from '../canonical/coverage.js';
import { recordSessionPlanSubmitted, syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { withCanonicalTransaction } from '../canonical/store.js';
import { openEforgePlanStore } from '../sqlite/index.js';

function tempProject(): string { return mkdtempSync(join(tmpdir(), 'eforge-plan-canonical-session-')); }
function db(cwd: string): DatabaseSync { const store = openEforgePlanStore(cwd); const out = new DatabaseSync(store.path); store.close(); return out; }

function sessionContent(overrides = ''): string {
  return `---\nsession: s\ntopic: Build thing\nstatus: ready\nplanning_type: feature\nplanning_depth: focused\nprofile: excursion\nagent_profile: reviewer\neforge_plan:\n  source_item_ids: [item-a, item-b]\n  source_epic_ids: [epic-a]\n  source_recommendation_ref: lane:1\n${overrides}---\n# Body\nImplementation details stay in Markdown only.\n`;
}

describe('canonical SQLite session-plan writes', () => {
  it('syncs artifact metadata, many-to-many joins, planned evidence, recommendation provenance, body hash, and dirty markers idempotently', () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, '.eforge/session-plans'), { recursive: true });
    captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'A' });
    captureCanonicalBacklogItem(cwd, { id: 'item-b', title: 'B' });
    upsertCanonicalEpic(cwd, { id: 'epic-a', title: 'Epic A' });
    const path = join(cwd, '.eforge/session-plans/s.md');
    const content = sessionContent();
    writeFileSync(path, content);

    syncSessionPlanArtifact(cwd, { session: 's', path, content, provenance: 'promotion', readinessSummary: { ready: true }, summaryText: 'short summary' });
    syncSessionPlanArtifact(cwd, { session: 's', path, content, provenance: 'promotion', readinessSummary: { ready: true }, summaryText: 'short summary' });

    const raw = db(cwd);
    expect(raw.prepare('SELECT session, path, topic, status, planning_type, planning_depth, profile, agent_profile, summary_text, artifact_body_hash FROM session_plans WHERE session = ?').get('s')).toMatchObject({ session: 's', path: '.eforge/session-plans/s.md', topic: 'Build thing', status: 'ready', planning_type: 'feature', planning_depth: 'focused', profile: 'excursion', agent_profile: 'reviewer', summary_text: 'short summary' });
    expect(raw.prepare('SELECT json_extract(readiness_summary_json, ?) AS ready FROM session_plans WHERE session = ?').get('$.ready', 's')).toMatchObject({ ready: 1 });
    expect((raw.prepare('SELECT instr(COALESCE(frontmatter_json, ?), ?) AS pos FROM session_plans WHERE session = ?').get('{}', 'Implementation details', 's') as { pos: number }).pos).toBe(0);
    expect((raw.prepare('SELECT count(*) AS count FROM session_plan_items WHERE session = ?').get('s') as { count: number }).count).toBe(2);
    expect((raw.prepare('SELECT count(*) AS count FROM session_plan_epics WHERE session = ?').get('s') as { count: number }).count).toBe(1);
    expect((raw.prepare('SELECT count(*) AS count FROM session_plan_items WHERE session = ? AND source_recommendation_ref = ?').get('s', 'lane:1') as { count: number }).count).toBe(2);
    expect((raw.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE session = ? AND lifecycle_state = ?').get('s', 'planned') as { count: number }).count).toBe(2);
    expect((raw.prepare('SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = ? AND document_id = ?').get('session_plan', 's') as { count: number }).count).toBe(1);
    raw.close();
    expect(findCanonicalNonterminalCoverage(cwd, ['item-a']).entries.map((entry) => entry.reasonCode)).toContain('planned-session-plan');
  });

  it('replaces session item and epic links instead of accumulating stale joins', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'A' });
    captureCanonicalBacklogItem(cwd, { id: 'item-b', title: 'B' });
    captureCanonicalBacklogItem(cwd, { id: 'item-c', title: 'C' });
    upsertCanonicalEpic(cwd, { id: 'epic-a', title: 'Epic A' });
    upsertCanonicalEpic(cwd, { id: 'epic-b', title: 'Epic B' });
    const path = join(cwd, '.eforge/session-plans/s.md');

    syncSessionPlanArtifact(cwd, { session: 's', path, content: sessionContent(), provenance: 'promotion' });
    syncSessionPlanArtifact(cwd, { session: 's', path, content: '# Body only', sourceItemIds: ['item-c'], sourceEpicIds: ['epic-b'], status: 'draft', provenance: 'metadata-update' });

    const raw = db(cwd);
    expect((raw.prepare('SELECT count(*) AS count FROM session_plan_items WHERE session = ?').get('s') as { count: number }).count).toBe(1);
    expect(raw.prepare('SELECT item_ref, provenance FROM session_plan_items WHERE session = ?').get('s')).toMatchObject({ item_ref: 'item-c', provenance: 'metadata-update' });
    expect(raw.prepare('SELECT epic_ref, provenance FROM session_plan_epics WHERE session = ?').get('s')).toMatchObject({ epic_ref: 'epic-b', provenance: 'metadata-update' });
    expect(findCanonicalNonterminalCoverage(cwd, ['item-a']).ok).toBe(true);
    raw.close();
  });

  it('omits terminal session plans from duplicate coverage unless terminal reasons are requested', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'A' });
    syncSessionPlanArtifact(cwd, { session: 'terminal', path: join(cwd, '.eforge/session-plans/terminal.md'), status: 'deleted', sourceItemIds: ['item-a'] });

    expect(findCanonicalNonterminalCoverage(cwd, ['item-a']).ok).toBe(true);
    expect(findCanonicalNonterminalCoverage(cwd, ['item-a'], { includeTerminalReasons: true }).entries.map((entry) => entry.reasonCode)).toContain('planned-session-plan');
  });

  it('records handoff queue correlation and submitted evidence linked to the session plan and selected items', () => {
    const cwd = tempProject();
    captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'A' });
    syncSessionPlanArtifact(cwd, { session: 's', path: join(cwd, '.eforge/session-plans/s.md'), status: 'ready', sourceItemIds: ['item-a'] });

    withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 's', queuePrdId: 'queue-1', path: '.eforge/session-plans/s.md', itemIds: ['item-a'], timestamp: '2026-01-01T00:00:00.000Z' }));

    const raw = db(cwd);
    expect(raw.prepare('SELECT session, status, submitted_at, updated_at, path FROM session_plans WHERE session = ?').get('s')).toMatchObject({ session: 's', status: 'submitted', submitted_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', path: '.eforge/session-plans/s.md' });
    expect(raw.prepare('SELECT prd_id, session, source_path, status, submitted_at FROM queue_prds WHERE prd_id = ?').get('queue-1')).toMatchObject({ prd_id: 'queue-1', session: 's', source_path: '.eforge/session-plans/s.md', status: 'queued', submitted_at: '2026-01-01T00:00:00.000Z' });
    expect((raw.prepare('SELECT count(*) AS count FROM lifecycle_evidence WHERE item_ref = ? AND session = ? AND queue_prd_id = ? AND lifecycle_state = ?').get('item-a', 's', 'queue-1', 'submitted') as { count: number }).count).toBe(1);
    raw.close();
  });

  it('preserves submitted canonical status when ready Markdown is synced after handoff', () => {
    const cwd = tempProject();
    const path = join(cwd, '.eforge/session-plans/s.md');
    const content = sessionContent();
    syncSessionPlanArtifact(cwd, { session: 's', path, content, status: 'ready' });
    withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 's', queuePrdId: 'queue-1', path: '.eforge/session-plans/s.md', timestamp: '2026-01-01T00:00:00.000Z' }));

    syncSessionPlanArtifact(cwd, { session: 's', path, content, status: 'ready' });

    const raw = db(cwd);
    expect(raw.prepare('SELECT status FROM session_plans WHERE session = ?').get('s')).toMatchObject({ status: 'submitted' });
    raw.close();
  });

  it('documents duplicate promotion rejection must happen before the requested artifact is created', () => {
    const cwd = tempProject();
    mkdirSync(join(cwd, '.eforge/session-plans'), { recursive: true });
    captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'A' });
    syncSessionPlanArtifact(cwd, { session: 'first', path: join(cwd, '.eforge/session-plans/first.md'), status: 'draft', sourceItemIds: ['item-a'] });
    const secondPath = join(cwd, '.eforge/session-plans/second.md');

    const coverage = findCanonicalNonterminalCoverage(cwd, ['item-a']);

    expect(coverage.ok).toBe(false);
    expect(coverage.entries.map((entry) => entry.reasonCode)).toContain('planned-session-plan');
    expect(existsSync(secondPath)).toBe(false);
  });
});
