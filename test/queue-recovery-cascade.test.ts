import { describe, expect, it } from 'vitest';
import { mkdir, rename, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { analyzeQueueRecovery, applyQueueRecovery } from '@eforge-build/engine/queue/recovery-cascade';

const makeTempDir = useTempDir('eforge-queue-recovery-cascade-');

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writePrd(cwd: string, location: 'queue' | 'waiting' | 'failed' | 'skipped', id: string, dependsOn: string[] = []): Promise<void> {
  const dir = location === 'queue' ? join(cwd, '.eforge', 'queue') : join(cwd, '.eforge', 'queue', location);
  await mkdir(dir, { recursive: true });
  const deps = dependsOn.length > 0 ? `depends_on: [${dependsOn.map((d) => `"${d}"`).join(', ')}]\n` : '';
  await writeFile(join(dir, `${id}.md`), `---\ntitle: ${id}\ncreated: 2026-01-01\n${deps}---\n\n# ${id}\n`, 'utf-8');
}

async function writeSidecars(cwd: string, id: string): Promise<void> {
  const failedDir = join(cwd, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(join(failedDir, `${id}.recovery.md`), '# Recovery', 'utf-8');
  await writeFile(join(failedDir, `${id}.recovery.json`), JSON.stringify({ verdict: { verdict: 'manual', confidence: 'low' } }), 'utf-8');
}

describe('queue recovery cascade engine', () => {
  it('analyzes a failed parent with skipped descendants without moving files', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'skipped', 'grandchild', ['child']);

    const before = await Promise.all([
      exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md')),
      exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md')),
      exists(join(cwd, '.eforge', 'queue', 'skipped', 'grandchild.md')),
    ]);
    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent' });
    const after = await Promise.all([
      exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md')),
      exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md')),
      exists(join(cwd, '.eforge', 'queue', 'skipped', 'grandchild.md')),
    ]);

    expect(analysis.eligible).toBe(true);
    expect(analysis.nodes.map((n) => n.id).sort()).toEqual(['child', 'grandchild', 'parent']);
    expect(analysis.edges).toEqual(expect.arrayContaining([
      { dependentId: 'child', dependencyId: 'parent' },
      { dependentId: 'grandchild', dependencyId: 'child' },
    ]));
    expect(after).toEqual(before);
  });

  it('returns a blocker for an unknown selected PRD', async () => {
    const cwd = makeTempDir();
    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'missing' });
    expect(analysis.eligible).toBe(false);
    expect(analysis.blockers.length).toBeGreaterThan(0);
  });

  it('blocks unsupported strategies without moving queue files', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');

    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent', strategy: 'unsupported-strategy' });
    const applied = await applyQueueRecovery({
      cwd,
      selectedPrdId: 'parent',
      strategy: 'unsupported-strategy',
      expectedOperations: analysis.operations,
    });

    expect(analysis.eligible).toBe(false);
    expect(analysis.blockers.map((b) => b.code)).toContain('unsupported-strategy');
    expect(applied.applied).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
  });

  it('reports manual low-confidence sidecars as warnings without blocking analysis', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');

    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent' });

    expect(analysis.eligible).toBe(true);
    expect(analysis.blockers).toEqual([]);
    expect(analysis.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['manual-sidecar', 'low-confidence-sidecar']));
  });

  it('blocks cascades with an outside failed or missing dependency', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'failed', 'outside-failed');
    await writePrd(cwd, 'skipped', 'child', ['parent', 'outside-failed', 'missing-dep']);

    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent' });

    expect(analysis.eligible).toBe(false);
    expect(analysis.blockers.map((b) => b.code)).toEqual(expect.arrayContaining([
      'outside-terminal-dependency',
      'missing-or-unusable-dependency',
    ]));
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
  });

  it('applies parent retry, removes sidecars, and moves skipped descendants to waiting', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);

    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent' });
    const applied = await applyQueueRecovery({ cwd, selectedPrdId: 'parent', expectedOperations: analysis.operations });

    expect(applied.applied).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
  });

  it('refuses apply on drift before moving the failed parent', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    const analysis = await analyzeQueueRecovery({ cwd, selectedPrdId: 'parent' });

    await mkdir(join(cwd, '.eforge', 'queue', 'waiting'), { recursive: true });
    await rename(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'), join(cwd, '.eforge', 'queue', 'waiting', 'child.md'));
    const applied = await applyQueueRecovery({ cwd, selectedPrdId: 'parent', expectedOperations: analysis.operations });

    expect(applied.applied).toBe(false);
    expect(applied.operationResults.every((r) => r.status === 'blocked')).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
  });
});
