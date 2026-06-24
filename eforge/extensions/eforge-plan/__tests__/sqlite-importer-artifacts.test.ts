import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPlanningStoreImport } from '../importer/index.js';
import { openEforgePlanStore } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';

async function temp<T>(fn: (cwd: string) => Promise<T>) { const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-importer-artifacts-')); try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); } }
async function seedItem(cwd: string) { await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/backlog/items'), { recursive: true }); await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/backlog/items/item-one.md'), '---\nid: item-one\nstatus: candidate\n---\n# Item One\n'); }

describe('sqlite importer artifacts', () => {
  it('imports recommendations, queue, traces, planning tasks, and monitor rows conservatively', async () => {
    await temp(async (cwd) => {
      await seedItem(cwd);
      await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/recommendations'), { recursive: true });
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/recommendations/current.json'), JSON.stringify({ activeWork: [{ itemId: 'item-one' }], readyCandidates: [{ itemId: 'missing-rec' }], safeParallelizableGroups: [{ itemIds: ['item-one', 'missing-two'] }] }));
      await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/traces'), { recursive: true });
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/traces/item-one.json'), JSON.stringify({ itemId: 'item-one', promotedPlans: [{ session: 's1' }], queuePrds: [{ prdId: 'q1', status: 'queued' }], buildSessions: [{ buildSessionId: 'b1', status: 'running' }], landingResults: [{ status: 'pr-open', prUrl: 'https://example.test/pr/1' }], lastEvent: { type: 'session:start', sessionId: 's1' } }));
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/traces/bad.json'), '{');
      await mkdir(join(cwd, '.eforge/queue/waiting'), { recursive: true });
      await writeFile(join(cwd, '.eforge/queue/waiting/q2.md'), '---\neforge_plan:\n  source_item_id: item-one\n---\n# Queue\n');
      await mkdir(join(cwd, '.eforge/storage/extensions/eforge-plan/planning-tasks'), { recursive: true });
      await writeFile(join(cwd, '.eforge/storage/extensions/eforge-plan/planning-tasks/index.json'), JSON.stringify({ schemaVersion: 1, entries: [{ taskId: 'task-one', originalRequest: 'Plan item one', derivedRequest: 'Plan item one', selection: { itemIds: ['item-one'], recommendationRef: 'lane' }, requestedOutputSections: ['recommendations'], createdAt: '2026-01-01T00:00:00.000Z' }] }));
      const mdb = new DatabaseSync(join(cwd, '.eforge/monitor.db')); mdb.exec('CREATE TABLE runs (id TEXT, status TEXT, session_id TEXT); CREATE TABLE events (id TEXT, type TEXT, payload TEXT);'); mdb.prepare('INSERT INTO runs VALUES (?,?,?)').run('run-one', 'complete', 'build-session-one'); mdb.prepare('INSERT INTO events VALUES (?,?,?)').run('evt-one', 'session:start', JSON.stringify({ itemId: 'item-one' })); mdb.close();
      const report = await runPlanningStoreImport(cwd, { dryRun: false, diagnosticLimit: 2 }); expect(report.diagnosticCount).toBeGreaterThanOrEqual(2); expect(report.diagnostics.length).toBeLessThanOrEqual(2);
      const store = openEforgePlanStore(cwd, { readonly: true }); try { const db = getDatabase(store); expect((db.prepare('SELECT count(*) AS count FROM recommendation_lane_items').get() as { count: number }).count).toBeGreaterThan(1); expect((db.prepare('SELECT count(*) AS count FROM queue_prds').get() as { count: number }).count).toBeGreaterThan(0); expect((db.prepare('SELECT count(*) AS count FROM build_sessions').get() as { count: number }).count).toBeGreaterThan(0); expect((db.prepare('SELECT count(*) AS count FROM landing_links').get() as { count: number }).count).toBeGreaterThan(0); expect((db.prepare('SELECT count(*) AS count FROM planning_tasks').get() as { count: number }).count).toBe(1); expect((db.prepare('SELECT count(*) AS count FROM lifecycle_events').get() as { count: number }).count).toBeGreaterThan(0); } finally { store.close(); }
    });
  });

  it('correlates monitor events only through already imported session and queue refs', async () => {
    await temp(async (cwd) => {
      await seedItem(cwd);
      await mkdir(join(cwd, '.eforge/session-plans'), { recursive: true });
      await writeFile(join(cwd, '.eforge/session-plans/session-one.md'), '---\nsession: session-one\ntopic: session-one\nstatus: ready\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\neforge_plan:\n  source_item_ids: [item-one]\n---\n# Session One\n\n## Problem Statement\n\nProblem.\n\n## Scope\n\nScope.\n\n## Acceptance Criteria\n\n- Works.\n\n## Assumptions And Validation\n\nValidated.\n');
      await mkdir(join(cwd, '.eforge/queue/waiting'), { recursive: true });
      await writeFile(join(cwd, '.eforge/queue/waiting/prd-one.md'), '---\nsession: session-one\neforge_plan:\n  source_item_id: item-one\n---\n# Queue\n');
      await mkdir(join(cwd, '.eforge'), { recursive: true });
      const mdb = new DatabaseSync(join(cwd, '.eforge/monitor.db')); mdb.exec('CREATE TABLE events (id TEXT, type TEXT, payload TEXT);'); mdb.prepare('INSERT INTO events VALUES (?,?,?)').run('evt-known-session', 'session:progress', JSON.stringify({ sessionId: 'session-one' })); mdb.prepare('INSERT INTO events VALUES (?,?,?)').run('evt-known-prd', 'queue:progress', JSON.stringify({ prdId: 'prd-one' })); mdb.close();
      await runPlanningStoreImport(cwd, { dryRun: false });
      const store = openEforgePlanStore(cwd, { readonly: true }); try { const db = getDatabase(store); expect((db.prepare("SELECT count(*) AS count FROM lifecycle_evidence WHERE evidence_key LIKE 'monitor:event:%' AND item_ref = 'item-one'").get() as { count: number }).count).toBe(2); expect((db.prepare('SELECT count(*) AS count FROM queue_prds').get() as { count: number }).count).toBe(1); expect((db.prepare('SELECT count(*) AS count FROM landing_links').get() as { count: number }).count).toBe(0); } finally { store.close(); }
    });
  });

  it('does not synthesize queue, landing, or item evidence rows from arbitrary monitor event fields', async () => {
    await temp(async (cwd) => {
      await mkdir(join(cwd, '.eforge'), { recursive: true });
      const mdb = new DatabaseSync(join(cwd, '.eforge/monitor.db')); mdb.exec('CREATE TABLE events (id TEXT, type TEXT, payload TEXT);'); mdb.prepare('INSERT INTO events VALUES (?,?,?)').run('evt-arbitrary', 'landing:complete', JSON.stringify({ prdId: 'queue-from-event', sessionId: 'session-from-event', runId: 'run-from-event', prUrl: 'https://example.test/pr/unsafe', featureBranch: 'feature/unsafe', commitSha: 'abc123' })); mdb.close();
      await runPlanningStoreImport(cwd, { dryRun: false, include: ['monitor'] });
      const store = openEforgePlanStore(cwd, { readonly: true }); try { const db = getDatabase(store); expect((db.prepare('SELECT count(*) AS count FROM lifecycle_events').get() as { count: number }).count).toBe(1); expect((db.prepare('SELECT count(*) AS count FROM queue_prds').get() as { count: number }).count).toBe(0); expect((db.prepare('SELECT count(*) AS count FROM landing_links').get() as { count: number }).count).toBe(0); expect((db.prepare('SELECT count(*) AS count FROM lifecycle_evidence').get() as { count: number }).count).toBe(0); } finally { store.close(); }
    });
  });
});
