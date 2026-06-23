import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceRuntimeIdentity,
} from '@eforge-build/client';
import {
  readBacklogCurationItemAuditCache,
  resolveBacklogCurationItemAuditCachePath,
  writeBacklogCurationItemAuditCache,
} from '../backlog-curation-item-audit-cache.js';

const sourceFingerprint = 'a'.repeat(64);
const packetSha256 = 'b'.repeat(64);
const bodySha256 = 'c'.repeat(64);
const runtimeIdentity: BacklogCurationMapReduceRuntimeIdentity = { provider: 'pi', modelId: 'claude-sonnet-4' };

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-cache-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function finding(overrides: Partial<BacklogCurationMapReduceFinding> = {}): BacklogCurationMapReduceFinding {
  return {
    schemaVersion: 1,
    itemId: 'item-1',
    sourceFingerprint,
    packetSha256,
    bodySha256,
    promptVersion: 'prompt-v1',
    runtimeIdentity,
    disposition: 'recheck',
    summary: 'No source closure found.',
    rationale: 'Keep open for later review.',
    citations: [],
    recommendationSignals: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('backlog curation item audit cache', () => {
  it('hits only when every key dimension matches', async () => {
    await withTempProject(async (cwd) => {
      const key = { cwd, sourceFingerprint, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1', runtimeIdentity };

      await expect(writeBacklogCurationItemAuditCache({ ...key, finding: finding() })).resolves.toMatchObject({ written: true });
      await expect(readBacklogCurationItemAuditCache(key)).resolves.toMatchObject({ hit: true, finding: { itemId: 'item-1' } });

      await expect(readBacklogCurationItemAuditCache({ ...key, sourceFingerprint: 'd'.repeat(64) })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, itemId: 'item-2' })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, packetSha256: 'e'.repeat(64) })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, bodySha256: 'f'.repeat(64) })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, promptVersion: 'prompt-v2' })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, runtimeIdentity: { ...runtimeIdentity, modelId: 'different-model' } })).resolves.toMatchObject({ hit: false });
      await expect(readBacklogCurationItemAuditCache({ ...key, runtimeIdentity: { ...runtimeIdentity, provider: 'claude-code' } })).resolves.toMatchObject({ hit: false });
    });
  });

  it('skips writes and misses reads when required key dimensions are missing', async () => {
    await withTempProject(async (cwd) => {
      await expect(writeBacklogCurationItemAuditCache({ cwd, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1', runtimeIdentity, finding: finding() })).resolves.toMatchObject({ written: false, reason: 'missing-key-dimension' });
      await expect(readBacklogCurationItemAuditCache({ cwd, sourceFingerprint, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1' })).resolves.toMatchObject({ hit: false, reason: 'missing-key-dimension' });
    });
  });

  it('misses malformed and schema-invalid sidecars', async () => {
    await withTempProject(async (cwd) => {
      const key = { cwd, sourceFingerprint, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1', runtimeIdentity };
      const path = resolveBacklogCurationItemAuditCachePath(key);
      expect(path).toBeTruthy();
      await mkdir(dirname(path!), { recursive: true });
      await writeFile(path!, '{bad json', 'utf-8');
      await expect(readBacklogCurationItemAuditCache(key)).resolves.toMatchObject({ hit: false, reason: 'malformed-json' });

      await writeBacklogCurationItemAuditCache({ ...key, finding: finding() });
      await writeFile(path!, JSON.stringify({ schemaVersion: 1, key: {}, cacheKey: 'bad', finding: finding({ itemId: '' as never }) }), 'utf-8');
      await expect(readBacklogCurationItemAuditCache(key)).resolves.toMatchObject({ hit: false });
    });
  });

  it('skips oversized writes and misses byte-invalid sidecars', async () => {
    await withTempProject(async (cwd) => {
      const key = { cwd, sourceFingerprint, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1', runtimeIdentity };
      const oversizedFinding = { ...finding(), oversizedPadding: 'x'.repeat(BACKLOG_CURATION_FINDING_MAX_BYTES) } as unknown as BacklogCurationMapReduceFinding;

      await expect(writeBacklogCurationItemAuditCache({ ...key, finding: oversizedFinding })).resolves.toMatchObject({ written: false, reason: 'byte-invalid' });

      await writeBacklogCurationItemAuditCache({ ...key, finding: finding() });
      const path = resolveBacklogCurationItemAuditCachePath(key);
      expect(path).toBeTruthy();
      const cacheKey = resolveBacklogCurationItemAuditCachePath(key)?.match(/([^/]+)\.json$/)?.[1];
      await writeFile(path!, JSON.stringify({
        schemaVersion: 1,
        key: { sourceFingerprint, itemId: 'item-1', packetSha256, bodySha256, promptVersion: 'prompt-v1', runtimeIdentity },
        cacheKey,
        writtenAt: '2026-01-01T00:00:00.000Z',
        finding: oversizedFinding,
      }), 'utf-8');

      await expect(readBacklogCurationItemAuditCache(key)).resolves.toMatchObject({ hit: false, reason: 'byte-invalid' });
    });
  });
});
