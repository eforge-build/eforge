import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveRecommendationFreshnessView } from '../recommendation-freshness.js';
import { writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import { readRecommendationFreshnessView, recordPlannerRecommendationAppliedForSourceFingerprint, resolveRecommendationStatusPathForCwd } from '../recommendation-status.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-freshness-view-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('recommendation freshness view', () => {
  it('returns missing when no current recommendation model or sidecar exists', () => {
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: false, sidecar: null },
      comparedSourceFingerprint: 'fingerprint-now',
    })).toMatchObject({ state: 'missing', comparedSourceFingerprint: 'fingerprint-now' });
  });

  it('returns fresh when metadata is valid and fingerprints match', () => {
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: { schemaVersion: 1, lastAppliedAt: '2026-01-01T00:00:00.000Z', lastAppliedSourceFingerprint: 'same' } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'fresh', storedSourceFingerprint: 'same' });
  });

  it('returns stale for fingerprint drift, persisted stale reasons, and invalid metadata', () => {
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: { schemaVersion: 1, lastAppliedAt: '2026-01-01T00:00:00.000Z', lastAppliedSourceFingerprint: 'old' } },
      comparedSourceFingerprint: 'new',
    })).toMatchObject({ state: 'stale', reason: expect.stringMatching(/fingerprint/i) });
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: { schemaVersion: 1, lastAppliedAt: '2026-01-01T00:00:00.000Z', lastAppliedSourceFingerprint: 'same', reasons: [{ summary: 'Manual stale reason.' }] } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: 'Manual stale reason.' });
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: { schemaVersion: 1, lastAppliedAt: '2026-01-01T00:00:00.000Z', lastAppliedSourceFingerprint: 'same', staleReasons: [{ message: 'Legacy stale reason.' }] } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: 'Legacy stale reason.' });
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: { schemaVersion: 1 } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: expect.stringMatching(/metadata/i) });
  });

  it('treats one-sided recommendation files as stale instead of trusting sidecar presence', () => {
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: false, sidecar: { schemaVersion: 1, lastAppliedAt: '2026-01-01T00:00:00.000Z', lastAppliedSourceFingerprint: 'same' } },
      comparedSourceFingerprint: 'same',
      baselineTaskId: 'task-one',
    })).toMatchObject({ state: 'stale', baselineTaskId: 'task-one', reason: expect.stringMatching(/current recommendation model is missing/i) });
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: null },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: expect.stringMatching(/sidecar is missing/i) });
  });

  it('uses invalid sidecar reason text before deterministic fallbacks', () => {
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: null, invalidReason: { summary: 'Invalid JSON summary.', message: 'Invalid JSON message.' } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: 'Invalid JSON summary.' });
    expect(deriveRecommendationFreshnessView({
      storedStatus: { currentExists: true, sidecar: null, invalidReason: { message: 'Invalid JSON message.' } },
      comparedSourceFingerprint: 'same',
    })).toMatchObject({ state: 'stale', reason: 'Invalid JSON message.' });
  });

  it('reads current freshness against an explicit prospective fingerprint without rewriting recommendation files', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n' });
      await writeRecommendations(cwd, createEmptyRecommendationModel());
      await recordPlannerRecommendationAppliedForSourceFingerprint(cwd, 'stored-fingerprint', 'test');
      const currentPath = resolveRecommendationsPathForCwd(cwd);
      const statusPath = resolveRecommendationStatusPathForCwd(cwd);
      const beforeCurrent = await readFile(currentPath, 'utf-8');
      const beforeStatus = await readFile(statusPath, 'utf-8');

      const view = await readRecommendationFreshnessView(cwd, 'prospective-fingerprint');

      expect(view).toMatchObject({ state: 'stale', storedSourceFingerprint: 'stored-fingerprint', comparedSourceFingerprint: 'prospective-fingerprint' });
      expect(await readFile(currentPath, 'utf-8')).toBe(beforeCurrent);
      expect(await readFile(statusPath, 'utf-8')).toBe(beforeStatus);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });
});
