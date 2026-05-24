/**
 * Tests for the provider-neutral artifact registry.
 *
 * Covers load/save/upsert/lookup/corruption-fallback behavior for
 * `.eforge/artifacts/builds.json`.
 */

import { describe, it, expect } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadArtifactRegistry,
  saveArtifactRegistry,
  upsertArtifact,
  lookupArtifactByPrdId,
  hasUsableArtifact,
  artifactRegistryPath,
  updateArtifactRecord,
  type ArtifactRecord,
  type ArtifactRegistry,
} from '@eforge-build/engine/artifacts';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(prdId: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const now = new Date().toISOString();
  return {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'leave',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// artifactRegistryPath
// ---------------------------------------------------------------------------

describe('artifactRegistryPath', () => {
  it('returns .eforge/artifacts/builds.json relative to cwd', () => {
    expect(artifactRegistryPath('/projects/my-project')).toBe(
      '/projects/my-project/.eforge/artifacts/builds.json',
    );
  });
});

// ---------------------------------------------------------------------------
// loadArtifactRegistry — empty/missing/corrupt fallback
// ---------------------------------------------------------------------------

describe('loadArtifactRegistry', () => {
  const makeTempDir = useTempDir('eforge-artifact-registry-');

  it('returns empty registry when file does not exist', async () => {
    const cwd = makeTempDir();
    const registry = await loadArtifactRegistry(cwd);
    expect(registry).toEqual({ version: 1, builds: [] });
  });

  it('loads a valid registry from disk', async () => {
    const cwd = makeTempDir();
    const record = makeRecord('prd-a');
    await saveArtifactRegistry(cwd, { version: 1, builds: [record] });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toHaveLength(1);
    expect(registry.builds[0].prdId).toBe('prd-a');
  });

  it('returns empty registry when file contains invalid JSON (corruption fallback)', async () => {
    const cwd = makeTempDir();
    const filePath = artifactRegistryPath(cwd);
    await mkdir(join(cwd, '.eforge', 'artifacts'), { recursive: true });
    await writeFile(filePath, 'not valid json {{{{', 'utf-8');

    const registry = await loadArtifactRegistry(cwd);
    expect(registry).toEqual({ version: 1, builds: [] });
  });

  it('returns empty registry when file contains valid JSON but fails schema validation', async () => {
    const cwd = makeTempDir();
    const filePath = artifactRegistryPath(cwd);
    await mkdir(join(cwd, '.eforge', 'artifacts'), { recursive: true });
    await writeFile(filePath, JSON.stringify({ version: 99, builds: [] }), 'utf-8');

    const registry = await loadArtifactRegistry(cwd);
    expect(registry).toEqual({ version: 1, builds: [] });
  });
});

// ---------------------------------------------------------------------------
// saveArtifactRegistry — atomic write
// ---------------------------------------------------------------------------

describe('saveArtifactRegistry', () => {
  const makeTempDir = useTempDir('eforge-artifact-save-');

  it('writes registry to disk and can be read back', async () => {
    const cwd = makeTempDir();
    const record = makeRecord('prd-b');
    await saveArtifactRegistry(cwd, { version: 1, builds: [record] });

    const raw = await readFile(artifactRegistryPath(cwd), 'utf-8');
    const parsed = JSON.parse(raw) as ArtifactRegistry;
    expect(parsed.version).toBe(1);
    expect(parsed.builds[0].prdId).toBe('prd-b');
  });

  it('creates intermediate directories if they do not exist', async () => {
    const cwd = makeTempDir();
    // Directory should not exist yet
    await saveArtifactRegistry(cwd, { version: 1, builds: [] });

    const raw = await readFile(artifactRegistryPath(cwd), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ version: 1, builds: [] });
  });
});

// ---------------------------------------------------------------------------
// upsertArtifact
// ---------------------------------------------------------------------------

describe('upsertArtifact', () => {
  const makeTempDir = useTempDir('eforge-artifact-upsert-');

  it('inserts a new record when none exists for the prdId', async () => {
    const cwd = makeTempDir();
    const record = makeRecord('prd-new');
    await upsertArtifact(cwd, record);

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toHaveLength(1);
    expect(registry.builds[0].prdId).toBe('prd-new');
    expect(registry.builds[0].status).toBe('built');
  });

  it('replaces an existing record in-place for the same prdId', async () => {
    const cwd = makeTempDir();
    const first = makeRecord('prd-x', { commitSha: 'sha-first' });
    await upsertArtifact(cwd, first);

    const second = makeRecord('prd-x', { commitSha: 'sha-second' });
    await upsertArtifact(cwd, second);

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toHaveLength(1);
    expect(registry.builds[0].commitSha).toBe('sha-second');
  });

  it('preserves recordedAt from the original entry on retry', async () => {
    const cwd = makeTempDir();
    const originalTime = '2025-01-01T00:00:00.000Z';
    const first = makeRecord('prd-retry', { recordedAt: originalTime });
    await upsertArtifact(cwd, first);

    const second = makeRecord('prd-retry', { recordedAt: new Date().toISOString() });
    await upsertArtifact(cwd, second);

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].recordedAt).toBe(originalTime);
  });

  it('always updates updatedAt on upsert', async () => {
    const cwd = makeTempDir();
    const originalUpdatedAt = '2025-01-01T00:00:00.000Z';
    await saveArtifactRegistry(cwd, {
      version: 1,
      builds: [makeRecord('prd-ts', { updatedAt: originalUpdatedAt })],
    });

    await upsertArtifact(cwd, makeRecord('prd-ts', { commitSha: 'new-sha' }));

    const after = await loadArtifactRegistry(cwd);
    expect(after.builds[0].updatedAt).not.toBe(originalUpdatedAt);
    expect(Date.parse(after.builds[0].updatedAt)).toBeGreaterThan(Date.parse(originalUpdatedAt));
  });

  it('preserves other records when upserting', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-alpha'));
    await upsertArtifact(cwd, makeRecord('prd-beta'));
    await upsertArtifact(cwd, makeRecord('prd-alpha', { commitSha: 'updated-sha' }));

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toHaveLength(2);
    const alpha = registry.builds.find((b) => b.prdId === 'prd-alpha');
    const beta = registry.builds.find((b) => b.prdId === 'prd-beta');
    expect(alpha?.commitSha).toBe('updated-sha');
    expect(beta?.prdId).toBe('prd-beta');
  });
});

// ---------------------------------------------------------------------------
// lookupArtifactByPrdId
// ---------------------------------------------------------------------------

describe('lookupArtifactByPrdId', () => {
  it('returns the record for a known prdId', () => {
    const record = makeRecord('prd-found');
    const registry: ArtifactRegistry = { version: 1, builds: [record] };
    expect(lookupArtifactByPrdId(registry, 'prd-found')).toEqual(record);
  });

  it('returns undefined for an unknown prdId', () => {
    const registry: ArtifactRegistry = { version: 1, builds: [makeRecord('prd-a')] };
    expect(lookupArtifactByPrdId(registry, 'prd-ghost')).toBeUndefined();
  });

  it('returns undefined for an empty registry', () => {
    const registry: ArtifactRegistry = { version: 1, builds: [] };
    expect(lookupArtifactByPrdId(registry, 'any')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasUsableArtifact
// ---------------------------------------------------------------------------

describe('hasUsableArtifact', () => {
  it('returns true when a built artifact is present', () => {
    const registry: ArtifactRegistry = { version: 1, builds: [makeRecord('prd-built')] };
    expect(hasUsableArtifact(registry, 'prd-built')).toBe(true);
  });

  it('returns false when no record exists for the prdId', () => {
    const registry: ArtifactRegistry = { version: 1, builds: [] };
    expect(hasUsableArtifact(registry, 'prd-missing')).toBe(false);
  });

  it('returns false when a record exists but is not built', () => {
    const registry = {
      version: 1,
      builds: [{ ...makeRecord('prd-failed'), status: 'failed' }],
    } as unknown as ArtifactRegistry;
    expect(hasUsableArtifact(registry, 'prd-failed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ArtifactRecord — optional landing metadata fields
// ---------------------------------------------------------------------------

describe('ArtifactRecord landing metadata schema', () => {
  it('accepts a record with no landing metadata (all optional fields absent)', () => {
    const record = makeRecord('prd-no-landing');
    // All landing metadata fields are optional — the base record should be valid.
    expect(record.landingStatus).toBeUndefined();
    expect(record.prUrl).toBeUndefined();
    expect(record.landingCompletedAt).toBeUndefined();
    expect(record.landingFailureReason).toBeUndefined();
  });

  it('stores and loads landing metadata round-trip', async () => {
    const makeTempDir = useTempDir('eforge-artifact-landing-schema-');
    const cwd = makeTempDir();
    const record: ArtifactRecord = {
      ...makeRecord('prd-landing'),
      landingStatus: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/42',
      landingCompletedAt: '2026-01-01T12:00:00.000Z',
    };
    await upsertArtifact(cwd, record);

    const registry = await loadArtifactRegistry(cwd);
    const loaded = registry.builds[0];
    expect(loaded.landingStatus).toBe('complete');
    expect(loaded.prUrl).toBe('https://github.com/owner/repo/pull/42');
    expect(loaded.landingCompletedAt).toBe('2026-01-01T12:00:00.000Z');
    expect(loaded.landingFailureReason).toBeUndefined();
  });

  it('stores failed landing metadata including failure reason', async () => {
    const makeTempDir = useTempDir('eforge-artifact-landing-failed-');
    const cwd = makeTempDir();
    const record: ArtifactRecord = {
      ...makeRecord('prd-failed-landing'),
      landingStatus: 'failed',
      landingFailureReason: 'gh pr create failed: repository not found',
      landingCompletedAt: '2026-01-01T12:00:00.000Z',
    };
    await upsertArtifact(cwd, record);

    const registry = await loadArtifactRegistry(cwd);
    const loaded = registry.builds[0];
    expect(loaded.landingStatus).toBe('failed');
    expect(loaded.landingFailureReason).toBe('gh pr create failed: repository not found');
    expect(loaded.prUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateArtifactRecord — locked partial update
// ---------------------------------------------------------------------------

describe('updateArtifactRecord', () => {
  const makeTempDir = useTempDir('eforge-artifact-update-');

  it('is a no-op when no record exists for prdId', async () => {
    const cwd = makeTempDir();
    // Should not throw and should return an empty registry.
    const registry = await updateArtifactRecord(cwd, 'prd-ghost', { landingStatus: 'complete' });
    expect(registry.builds).toHaveLength(0);
  });

  it('merges updates into an existing record', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-update-me'));

    await updateArtifactRecord(cwd, 'prd-update-me', {
      landingStatus: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/1',
      landingCompletedAt: '2026-01-01T12:00:00.000Z',
    });

    const registry = await loadArtifactRegistry(cwd);
    const updated = registry.builds[0];
    expect(updated.landingStatus).toBe('complete');
    expect(updated.prUrl).toBe('https://github.com/owner/repo/pull/1');
    expect(updated.landingCompletedAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('preserves recordedAt from the original record', async () => {
    const cwd = makeTempDir();
    const originalTime = '2025-01-01T00:00:00.000Z';
    await upsertArtifact(cwd, makeRecord('prd-preserve', { recordedAt: originalTime }));

    await updateArtifactRecord(cwd, 'prd-preserve', { landingStatus: 'complete' });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].recordedAt).toBe(originalTime);
  });

  it('preserves status: built on the record', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-status'));

    await updateArtifactRecord(cwd, 'prd-status', { landingStatus: 'skipped' });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].status).toBe('built');
    // hasUsableArtifact must remain true after updating landing metadata.
    expect(hasUsableArtifact(registry, 'prd-status')).toBe(true);
  });

  it('updates updatedAt when merging partial updates', async () => {
    const cwd = makeTempDir();
    const originalTime = '2025-01-01T00:00:00.000Z';
    await saveArtifactRegistry(cwd, {
      version: 1,
      builds: [makeRecord('prd-ts-upd', { updatedAt: originalTime })],
    });

    await updateArtifactRecord(cwd, 'prd-ts-upd', { landingStatus: 'complete' });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].updatedAt).not.toBe(originalTime);
  });

  it('can update commitSha on the artifact record', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-sha', { commitSha: 'old-sha' }));

    await updateArtifactRecord(cwd, 'prd-sha', { commitSha: 'new-sha-after-cleanup' });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].commitSha).toBe('new-sha-after-cleanup');
  });

  it('does not affect other records when updating one', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-a'));
    await upsertArtifact(cwd, makeRecord('prd-b'));

    await updateArtifactRecord(cwd, 'prd-a', { landingStatus: 'complete' });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toHaveLength(2);
    const bRecord = registry.builds.find((b) => b.prdId === 'prd-b');
    expect(bRecord?.landingStatus).toBeUndefined();
  });
});
