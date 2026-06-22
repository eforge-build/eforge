import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordAcceptedAnalysisBaselineForApply } from '../backlog-curation-accepted-baseline.js';
import { readAcceptedAnalysisBaseline } from '../backlog-curation-git-delta.js';

async function withTempDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-accepted-baseline-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('accepted analysis baseline recording', () => {
  it('records backlog curation baselines with pass kind and coverage diagnostics', async () => {
    await withTempDir(async (cwd) => {
      await recordAcceptedAnalysisBaselineForApply(cwd, { taskId: 'task-full', passKind: 'backlog-curation', sourceFingerprint: 'fingerprint-full', acceptedAt: '2026-01-01T00:00:00.000Z' });

      expect(await readAcceptedAnalysisBaseline(cwd)).toMatchObject({
        taskId: 'task-full',
        passKind: 'backlog-curation',
        sourceFingerprint: 'fingerprint-full',
        coverage: { kind: 'unavailable' },
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'git-unavailable' })]),
      });
    });
  });

  it('keeps recommendation-refresh baseline pass kind unchanged', async () => {
    await withTempDir(async (cwd) => {
      await recordAcceptedAnalysisBaselineForApply(cwd, { taskId: 'task-refresh', passKind: 'recommendation-refresh', sourceFingerprint: 'fingerprint-refresh', acceptedAt: '2026-01-01T00:00:00.000Z' });
      expect(await readAcceptedAnalysisBaseline(cwd)).toMatchObject({ taskId: 'task-refresh', passKind: 'recommendation-refresh', sourceFingerprint: 'fingerprint-refresh' });
    });
  });

  it('skips writes when the source fingerprint is missing', async () => {
    await withTempDir(async (cwd) => {
      await recordAcceptedAnalysisBaselineForApply(cwd, { taskId: 'task-1', passKind: 'recommendation-refresh' });
      expect(await readAcceptedAnalysisBaseline(cwd)).toBeNull();
    });
  });
});
