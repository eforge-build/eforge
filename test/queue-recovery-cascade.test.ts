import { describe, expect, it } from 'vitest';
import { mkdir, rename, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { analyzeQueueRecovery, applyQueueRecovery } from '@eforge-build/engine/queue/recovery-cascade';
import { beginQueuedResume, finalizeQueuedResumeSuccess, requeueFailedPrdForCompiledResume, rollbackQueuedResume } from '@eforge-build/engine/queue/resume-cascade';
import { loadCompletionRegistry } from '@eforge-build/engine/artifacts/completions';

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

async function writePrdWithFrontmatter(cwd: string, location: 'queue' | 'waiting' | 'failed' | 'skipped', id: string, frontmatterLines: string[]): Promise<void> {
  const dir = location === 'queue' ? join(cwd, '.eforge', 'queue') : join(cwd, '.eforge', 'queue', location);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `---\n${frontmatterLines.join('\n')}\n---\n\n# ${id}\n`, 'utf-8');
}

async function writeSidecars(cwd: string, id: string): Promise<void> {
  const failedDir = join(cwd, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(join(failedDir, `${id}.recovery.md`), '# Recovery', 'utf-8');
  await writeFile(join(failedDir, `${id}.recovery.json`), JSON.stringify({ verdict: { verdict: 'manual', confidence: 'low' } }), 'utf-8');
}

async function writeArtifact(cwd: string, prdId: string, artifactBranch = `eforge/${prdId}`): Promise<void> {
  const dir = join(cwd, '.eforge', 'artifacts');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'builds.json'), JSON.stringify({ version: 1, builds: [{ prdId, artifactBranch, commitSha: 'abc123', resolvedBase: 'main', landingAction: 'leave', status: 'built', recordedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] }), 'utf-8');
}

async function writeCompletion(cwd: string, prdId: string, status: 'failed' | 'skipped' | 'completed'): Promise<void> {
  const dir = join(cwd, '.eforge', 'artifacts');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'completions.json'), JSON.stringify({ version: 1, completions: { [prdId]: { prdId, status, artifactAvailable: false, completedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } }), 'utf-8');
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

  it('starts a queued resume by activating the failed parent and waiting skipped descendants while preserving sidecars', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'skipped', 'grandchild', ['child']);
    await writePrd(cwd, 'skipped', 'unrelated', ['other']);

    const result = await beginQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('started');
    if (result.status === 'started') expect(result.movedDescendantIds).toEqual(['child', 'grandchild']);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'grandchild.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'grandchild.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'unrelated.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(true);
  });

  it('returns no-op for non-queue resume paths without a failed parent', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'skipped', 'child', ['parent']);

    const result = await beginQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('noop');
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
  });

  it('blocks queued resume start for unsafe PRD ids without touching queue files', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');

    const result = await beginQueuedResume({ cwd, prdId: '../parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', '..', 'parent.lock'))).toBe(false);
  });

  it('blocks queued resume start without moving files when a target already exists', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'queue', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);

    const result = await beginQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
  });

  it('blocks queued resume start without moving files when another worker holds the PRD lock', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'parent.lock'), 'existing-worker', 'utf-8');

    const result = await beginQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(true);
  });

  it('blocks queued resume start without moving files when a descendant waiting target exists', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'waiting', 'child', ['parent']);

    const result = await beginQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
  });

  it('requeues a failed PRD with compiled-resume metadata while preserving frontmatter and sidecars', async () => {
    const cwd = makeTempDir();
    await writePrdWithFrontmatter(cwd, 'failed', 'parent', [
      'title: parent',
      'created: 2026-01-01',
      'profile: base-profile',
      'landing: pr',
      'landing_auto_merge: true',
      'depends_on: ["foundation"]',
      'stack_id: stack-a',
      'stack_parent: foundation',
      'stack_provider: git-spice',
    ]);
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'skipped', 'grandchild', ['child']);
    await writePrd(cwd, 'skipped', 'unrelated', ['other']);
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'parent.lock'), String(process.pid), 'utf-8');

    const result = await requeueFailedPrdForCompiledResume({ cwd, prdId: 'parent', setName: 'failed-set', featureBranch: 'eforge/failed-set', baseBranch: 'main' });
    const content = await readFile(join(cwd, '.eforge', 'queue', 'parent.md'), 'utf-8');

    expect(result.status).toBe('queued');
    if (result.status === 'queued') expect(result.movedDescendantIds).toEqual(['child', 'grandchild']);
    expect(content).toContain('resume_mode: compiled');
    expect(content).toContain('resume_from: parent');
    expect(content).toContain('resume_set_name: failed-set');
    expect(content).toContain('resume_feature_branch: eforge/failed-set');
    expect(content).toContain('resume_base_branch: main');
    expect(content).toContain('profile: base-profile');
    expect(content).toContain('landing: pr');
    expect(content).toContain('landing_auto_merge: true');
    expect(content).toContain('depends_on: ["foundation"]');
    expect(content).toContain('stack_id: stack-a');
    expect(content).toContain('stack_parent: foundation');
    expect(content).toContain('stack_provider: git-spice');
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'grandchild.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'unrelated.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(true);
  });

  it('applies explicit profile override during compiled-resume requeue without changing other preserved fields', async () => {
    const cwd = makeTempDir();
    await writePrdWithFrontmatter(cwd, 'failed', 'parent', [
      'title: parent',
      'created: 2026-01-01',
      'profile: base-profile',
      'landing: merge',
    ]);

    const result = await requeueFailedPrdForCompiledResume({ cwd, prdId: 'parent', setName: 'failed-set', featureBranch: 'eforge/failed-set', baseBranch: 'main', profileOverride: 'resume-profile' });
    const content = await readFile(join(cwd, '.eforge', 'queue', 'parent.md'), 'utf-8');

    expect(result.status).toBe('queued');
    expect(content).toContain('profile: resume-profile');
    expect(content).toContain('landing: merge');
  });

  it('returns already-queued for a root PRD with matching compiled-resume metadata', async () => {
    const cwd = makeTempDir();
    await writePrdWithFrontmatter(cwd, 'queue', 'parent', [
      'title: parent',
      'resume_mode: compiled',
      'resume_from: parent',
      'resume_set_name: failed-set',
      'resume_feature_branch: eforge/failed-set',
      'resume_base_branch: main',
    ]);
    await writePrd(cwd, 'skipped', 'child', ['parent']);

    const result = await requeueFailedPrdForCompiledResume({ cwd, prdId: 'parent', setName: 'failed-set', featureBranch: 'eforge/failed-set', baseBranch: 'main' });

    expect(result.status).toBe('already-queued');
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
  });

  it('finalizes queued resume success after a usable artifact and unblocks satisfied descendants', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'skipped', 'grandchild', ['child']);
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writeArtifact(cwd, 'parent', 'eforge/original-parent');
    await writeCompletion(cwd, 'parent', 'failed');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });
    const completions = await loadCompletionRegistry(cwd);

    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.unblockedIds).toEqual(['child']);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'grandchild.md'))).toBe(true);
    expect(completions.completions.parent.status).toBe('completed');
    expect(completions.completions.parent.artifactAvailable).toBe(true);
    expect(completions.completions.parent.artifactBranch).toBe('eforge/original-parent');
  });

  it('finalizes queued resume success by replacing a stale skipped completion entry', async () => {
    const cwd = makeTempDir();
    await writeArtifact(cwd, 'parent');
    await writeCompletion(cwd, 'parent', 'skipped');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });
    const completions = await loadCompletionRegistry(cwd);

    expect(result.status).toBe('completed');
    expect(completions.completions.parent.status).toBe('completed');
    expect(completions.completions.parent.artifactAvailable).toBe(true);
  });

  it('keeps descendants waiting when another dependency is active', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent', 'other']);
    await writePrd(cwd, 'queue', 'other');
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writeArtifact(cwd, 'parent');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.unblockedIds).toEqual([]);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'child.md'))).toBe(false);
  });

  it('keeps descendants waiting when another dependency lacks a usable artifact', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent', 'other']);
    await writePrd(cwd, 'waiting', 'other');
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writeArtifact(cwd, 'parent');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.unblockedIds).toEqual(['other']);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'child.md'))).toBe(false);
  });

  it('blocks success finalization without a usable artifact and leaves queue state and stale completion untouched', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writeCompletion(cwd, 'parent', 'failed');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });
    const completions = await loadCompletionRegistry(cwd);

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(true);
    expect(completions.completions.parent.status).toBe('failed');
  });

  it('rolls back failed or ineligible queued resumes by restoring parent and re-skipping descendants while preserving sidecars', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writeSidecars(cwd, 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await writePrd(cwd, 'skipped', 'grandchild', ['child']);
    await beginQueuedResume({ cwd, prdId: 'parent' });

    const result = await rollbackQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('rolled-back');
    if (result.status === 'rolled-back') expect(result.skippedIds).toEqual(['child', 'grandchild']);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'grandchild.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'grandchild.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.recovery.json'))).toBe(true);
  });

  it('blocks rollback without overwriting an existing skipped descendant target and releases the lock', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writePrd(cwd, 'skipped', 'child', ['parent']);

    const result = await rollbackQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
  });

  it('blocks rollback without overwriting an existing failed parent target and releases the lock', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writePrd(cwd, 'failed', 'parent');

    const result = await rollbackQueuedResume({ cwd, prdId: 'parent' });

    expect(result.status).toBe('blocked');
    expect(await exists(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(await exists(join(cwd, '.eforge', 'queue', 'parent.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(true);
  });

  it('does not clobber an existing queue root target when unblocking waiting descendants', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await beginQueuedResume({ cwd, prdId: 'parent' });
    await writePrd(cwd, 'queue', 'child');
    await writeArtifact(cwd, 'parent');

    const result = await finalizeQueuedResumeSuccess({ cwd, prdId: 'parent' });

    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.unblockedIds).not.toContain('child');
    expect(await exists(join(cwd, '.eforge', 'queue', 'child.md'))).toBe(true);
    expect(await exists(join(cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
  });
});
