import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensurePlanRevisionSession, findPlanRevisionSession, findPlanRevisionTurn, listPlanRevisionSessions, markPlanRevisionTurnApplied, readPlanRevisionIndex, recordPlanRevisionTurn, resolvePlanRevisionIndexPath } from '../plan-revision-store.js';
import type { PlanRevisionTurnEntry } from '../planning-agent-task-schemas.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-revision-store-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function turn(id: string, taskId: string, createdAt: string): PlanRevisionTurnEntry {
  return { turnId: id, taskId, userMessage: `message ${id}`, basePlanFingerprint: 'a'.repeat(64), baseSectionHashes: [{ dimension: 'scope', sha256: 'b'.repeat(64) }], createdAt };
}

describe('plan revision store', () => {
  it('resolves project-local extension-private revision index path and falls back for missing or malformed storage', async () => {
    await withTempProject(async (cwd) => {
      expect(resolvePlanRevisionIndexPath(cwd)).toBe(join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'plan-revisions', 'index.json'));
      expect(await readPlanRevisionIndex(cwd)).toEqual({ schemaVersion: 1, sessions: [] });
      await mkdir(dirname(resolvePlanRevisionIndexPath(cwd)), { recursive: true });
      await writeFile(resolvePlanRevisionIndexPath(cwd), '{not json', 'utf-8');
      expect(await readPlanRevisionIndex(cwd)).toEqual({ schemaVersion: 1, sessions: [] });
      await writeFile(resolvePlanRevisionIndexPath(cwd), JSON.stringify({ schemaVersion: 1, sessions: [{ bad: true }] }), 'utf-8');
      expect(await readPlanRevisionIndex(cwd)).toEqual({ schemaVersion: 1, sessions: [] });
    });
  });

  it('orders sessions and turns newest-first and persists applied metadata atomically', async () => {
    await withTempProject(async (cwd) => {
      const olderCreated = await ensurePlanRevisionSession(cwd, 'older', '2026-01-01T00:00:00.000Z');
      const newerCreated = await ensurePlanRevisionSession(cwd, 'newer', '2026-01-02T00:00:00.000Z');
      const olderResumed = await ensurePlanRevisionSession(cwd, 'older', '2026-01-04T00:00:00.000Z');
      expect(olderResumed.threadId).toBe(olderCreated.threadId);
      await recordPlanRevisionTurn(cwd, 'older', turn('turn-old', 'task-old', '2026-01-01T00:00:00.000Z'));
      await recordPlanRevisionTurn(cwd, 'older', turn('turn-new', 'task-new', '2026-01-01T00:01:00.000Z'));
      await recordPlanRevisionTurn(cwd, 'older', { ...turn('turn-replacement', 'task-new', '2026-01-01T00:02:00.000Z'), userMessage: 'replacement' });
      await markPlanRevisionTurnApplied(cwd, 'older', { taskId: 'task-new' }, '2026-01-03T00:00:00.000Z', ['scope', 'scope', 'acceptance-criteria']);

      const index = await readPlanRevisionIndex(cwd);
      expect(index.sessions.map((session) => session.targetSession)).toEqual(['older', 'newer']);
      expect(index.sessions.map((session) => session.threadId).sort()).toEqual([olderCreated.threadId, newerCreated.threadId].sort());
      const older = findPlanRevisionSession(index, { threadId: olderCreated.threadId });
      expect(older).toBeDefined();
      if (older === undefined) throw new Error('expected older revision session');
      expect(listPlanRevisionSessions(index).map((session) => session.targetSession)).toEqual(['older', 'newer']);
      expect(older.turns.map((entry) => entry.turnId)).toEqual(['turn-replacement', 'turn-old']);
      expect(findPlanRevisionTurn(older, { taskId: 'task-new' })).toMatchObject({ turnId: 'turn-replacement', userMessage: 'replacement', appliedAt: '2026-01-03T00:00:00.000Z', appliedSections: ['acceptance-criteria', 'scope'] });
    });
  });
});
