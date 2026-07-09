import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { listSessionPlansWire, setStatusWire, showSessionPlan } from '@eforge-build/monitor/routes/session-plan-service';
import { showSessionPlanProjection } from '../eforge/extensions/eforge-plan/projections/index.js';
import { withTempProjectionProject } from '../eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.js';
import { captureCanonicalBacklogItem } from '../eforge/extensions/eforge-plan/canonical/backlog-records.js';
import { syncSessionPlanArtifact } from '../eforge/extensions/eforge-plan/canonical/session-plan-records.js';

function readySessionPlanContent(session: string, status: string): string {
  return `---\nsession: ${session}\ntopic: ${session}\nstatus: ${status}\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\n---\n# ${session}\n\n## Problem Statement\n\nA concrete user-visible problem is documented.\n\n## Scope\n\nUpdate only the session-plan status bridge.\n\n## Acceptance Criteria\n\n- Kernel status writes use the canonical status source.\n\n## Assumptions And Validation\n\nVitest covers the canonical bridge.\n`;
}

describe('session-plan canonical set-status bridge', () => {
  it('uses canonical SQLite status for kernel list/show when Markdown is stale', async () => {
    await withTempProjectionProject(async (cwd) => {
      const session = 'canonical-list-show-status';
      const path = resolve(cwd, '.eforge/session-plans', `${session}.md`);
      const content = readySessionPlanContent(session, 'ready');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      syncSessionPlanArtifact(cwd, { session, path, content, status: 'ready', sourceItemIds: [] });
      const db = new DatabaseSync(resolve(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite'));
      try {
        db.prepare('UPDATE session_plans SET status = ?, eforge_session_id = ? WHERE session = ?').run('submitted', 'run-1', session);
      } finally {
        db.close();
      }

      await expect(listSessionPlansWire(cwd, false)).resolves.toMatchObject({ plans: [] });
      await expect(listSessionPlansWire(cwd, true)).resolves.toMatchObject({
        plans: [expect.objectContaining({ session, status: 'submitted', eforge_session: 'run-1', statusSource: 'eforge-plan-sqlite-session-plan-status', statusSourceDisclosure: expect.stringContaining('canonical eforge-plan SQLite session-plan status records') })],
      });
      await expect(showSessionPlan(cwd, session)).resolves.toMatchObject({
        plan: expect.objectContaining({ session, status: 'submitted', eforge_session: 'run-1', statusSource: 'eforge-plan-sqlite-session-plan-status', statusSourceDisclosure: expect.stringContaining('canonical eforge-plan SQLite session-plan status records') }),
      });
    });
  });

  it('updates canonical eforge-plan SQLite status when the kernel set-status route succeeds', async () => {
    await withTempProjectionProject(async (cwd) => {
      const session = 'canonical-status-bridge';
      const path = resolve(cwd, '.eforge/session-plans', `${session}.md`);
      const content = readySessionPlanContent(session, 'submitted');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      captureCanonicalBacklogItem(cwd, { id: 'bridge-item', title: 'Bridge item', status: 'planned' });
      syncSessionPlanArtifact(cwd, { session, path, content, status: 'submitted', sourceItemIds: ['bridge-item'] });

      const response = await setStatusWire(cwd, { session, status: 'abandoned' });
      const projected = await showSessionPlanProjection(cwd, session);
      const markdown = await readFile(path, 'utf8');
      const db = new DatabaseSync(resolve(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite'));
      try {
        const row = db.prepare('SELECT status FROM session_plans WHERE session = ?').get(session) as { status: string };
        const evidence = db.prepare("SELECT status, is_current, is_terminal, superseded_at FROM lifecycle_evidence WHERE session = ? AND reason_code = 'planned-session-plan' AND item_ref = ?").get(session, 'bridge-item') as { status: string; is_current: number; is_terminal: number; superseded_at: string | null };
        expect(row.status).toBe('abandoned');
        expect(evidence).toMatchObject({ status: 'abandoned', is_current: 0, is_terminal: 1, superseded_at: expect.any(String) });
      } finally {
        db.close();
      }

      expect(response).toMatchObject({
        session,
        status: 'abandoned',
        statusSource: 'session-plan-set-status-bridge',
        statusSourceDisclosure: expect.stringContaining('canonical eforge-plan SQLite session-plan status records'),
      });
      expect(projected).toMatchObject({
        session,
        plan: expect.objectContaining({ status: 'abandoned' }),
        statusSource: 'eforge-plan-sqlite-session-plan-status',
      });
      expect(markdown).toContain('status: abandoned');
    });
  });

  it('persists submitted canonical fields through set-status and exposes them on read surfaces', async () => {
    await withTempProjectionProject(async (cwd) => {
      const session = 'canonical-submitted-bridge';
      const path = resolve(cwd, '.eforge/session-plans', `${session}.md`);
      const content = readySessionPlanContent(session, 'ready');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      syncSessionPlanArtifact(cwd, { session, path, content, status: 'ready', sourceItemIds: [] });

      const response = await setStatusWire(cwd, { session, status: 'submitted', eforge_session: 'build-session-42' });
      const listed = await listSessionPlansWire(cwd, true);
      const shown = await showSessionPlan(cwd, session);
      const projected = await showSessionPlanProjection(cwd, session);
      const db = new DatabaseSync(resolve(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite'));
      try {
        const row = db.prepare('SELECT status, eforge_session_id, submitted_at FROM session_plans WHERE session = ?').get(session) as { status: string; eforge_session_id: string; submitted_at: string | null };
        expect(row).toMatchObject({ status: 'submitted', eforge_session_id: 'build-session-42' });
        expect(row.submitted_at).toEqual(expect.any(String));
      } finally {
        db.close();
      }

      expect(response).toMatchObject({ session, status: 'submitted', statusSource: 'session-plan-set-status-bridge' });
      expect(listed.plans).toEqual(expect.arrayContaining([expect.objectContaining({ session, status: 'submitted', eforge_session: 'build-session-42', statusSource: 'eforge-plan-sqlite-session-plan-status' })]));
      expect(shown.plan).toMatchObject({ session, status: 'submitted', eforge_session: 'build-session-42', statusSource: 'eforge-plan-sqlite-session-plan-status' });
      expect(projected).toMatchObject({ session, plan: expect.objectContaining({ status: 'submitted' }), statusSource: 'eforge-plan-sqlite-session-plan-status', submittedAt: expect.any(String) });
    });
  });

  it('fails closed and rolls Markdown back when canonical status update fails', async () => {
    await withTempProjectionProject(async (cwd) => {
      const session = 'canonical-update-fails';
      const path = resolve(cwd, '.eforge/session-plans', `${session}.md`);
      const content = readySessionPlanContent(session, 'ready');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      syncSessionPlanArtifact(cwd, { session, path, content, status: 'ready', sourceItemIds: [] });
      const dbPath = resolve(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite');
      const db = new DatabaseSync(dbPath);
      try {
        db.exec("CREATE TRIGGER fail_session_plan_status_update BEFORE UPDATE OF status ON session_plans BEGIN SELECT RAISE(FAIL, 'blocked canonical update'); END;");
      } finally {
        db.close();
      }

      await expect(setStatusWire(cwd, { session, status: 'abandoned' })).rejects.toMatchObject({ statusCode: 500, body: expect.objectContaining({ statusSourceDisclosure: expect.stringContaining('canonical eforge-plan SQLite session-plan status records') }) });
      await expect(readFile(path, 'utf8')).resolves.toContain('status: ready');
      const verify = new DatabaseSync(dbPath);
      try {
        const row = verify.prepare('SELECT status FROM session_plans WHERE session = ?').get(session) as { status: string };
        expect(row.status).toBe('ready');
      } finally {
        verify.close();
      }
    });
  });

  it('uses Markdown compatibility status when set-status targets a markdown-only plan', async () => {
    await withTempProjectionProject(async (cwd) => {
      const session = 'missing-canonical-row';
      const other = 'other-canonical-row';
      const path = resolve(cwd, '.eforge/session-plans', `${session}.md`);
      const content = readySessionPlanContent(session, 'ready');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
      syncSessionPlanArtifact(cwd, { session: other, path: resolve(cwd, '.eforge/session-plans', `${other}.md`), content: readySessionPlanContent(other, 'ready'), status: 'ready', sourceItemIds: [] });

      await expect(setStatusWire(cwd, { session, status: 'abandoned' })).resolves.toMatchObject({
        session,
        status: 'abandoned',
        statusSource: 'markdown-compatibility-fallback',
        statusSourceDisclosure: expect.stringContaining('Markdown compatibility fallback'),
      });
      await expect(readFile(path, 'utf8')).resolves.toContain('status: abandoned');
    });
  });
});
