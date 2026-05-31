/**
 * Tests for piggyback scheduling: waiting/skipped state transitions, recursive
 * skip propagation, multi-dependent fan-out, persistence across restart, and
 * enqueue-time validation.
 *
 * All helpers use real filesystem operations but do not require a full daemon.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import {
  findDependents,
  propagateSkip,
  unblockWaiting,
  validateDependsOnExists,
  enqueuePrd,
  loadQueue,
  classifyAfterQueueId,
  type QueuedPrd,
} from '@eforge-build/engine/prd-queue';
import { upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueuedPrd(overrides: Partial<QueuedPrd> & { id: string }): QueuedPrd {
  return {
    filePath: `/tmp/${overrides.id}.md`,
    frontmatter: { title: overrides.id },
    content: `---\ntitle: ${overrides.id}\n---\n\n# ${overrides.id}`,
    lastCommitHash: '',
    lastCommitDate: '',
    ...overrides,
  };
}

/**
 * Set up a minimal git repo with a queue directory structure.
 * Returns the cwd and queueDir string.
 */
function setupGitQueue(dir: string): { cwd: string; queueDir: string } {
  const queueDir = 'eforge/queue';
  mkdirSync(join(dir, queueDir, 'waiting'), { recursive: true });
  mkdirSync(join(dir, queueDir, 'failed'), { recursive: true });
  mkdirSync(join(dir, queueDir, 'skipped'), { recursive: true });

  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

  return { cwd: dir, queueDir };
}

/**
 * Write a PRD file to the waiting/ subdirectory and stage+commit it.
 */
function writePrdToWaiting(
  cwd: string,
  queueDir: string,
  id: string,
  depends_on: string[],
): string {
  const waitingDir = join(cwd, queueDir, 'waiting');
  const filePath = join(waitingDir, `${id}.md`);
  const depsLine = `depends_on: [${depends_on.map((d) => `"${d}"`).join(', ')}]`;
  writeFileSync(
    filePath,
    `---\ntitle: ${id}\ncreated: 2026-04-30\n${depsLine}\n---\n\n# ${id}\n`,
  );
  execFileSync('git', ['add', filePath], { cwd });
  execFileSync('git', ['commit', '-m', `add waiting PRD ${id}`, '--allow-empty-message'], { cwd });
  return filePath;
}

/**
 * Write a PRD file to the queue root and stage+commit it.
 */
function writePrdToQueue(cwd: string, queueDir: string, id: string): string {
  const filePath = join(cwd, queueDir, `${id}.md`);
  writeFileSync(
    filePath,
    `---\ntitle: ${id}\ncreated: 2026-04-30\n---\n\n# ${id}\n`,
  );
  execFileSync('git', ['add', filePath], { cwd });
  execFileSync('git', ['commit', '-m', `add queue PRD ${id}`, '--allow-empty-message'], { cwd });
  return filePath;
}

async function recordArtifact(cwd: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertArtifact(cwd, {
    prdId: id,
    artifactBranch: `eforge/${id}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'leave',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

// ---------------------------------------------------------------------------
// findDependents (pure, no filesystem)
// ---------------------------------------------------------------------------

describe('findDependents', () => {
  it('returns PRDs whose depends_on includes the upstream id', () => {
    const prds = [
      makeQueuedPrd({ id: 'a', frontmatter: { title: 'A' } }),
      makeQueuedPrd({ id: 'b', frontmatter: { title: 'B', depends_on: ['a'] } }),
      makeQueuedPrd({ id: 'c', frontmatter: { title: 'C', depends_on: ['a', 'd'] } }),
      makeQueuedPrd({ id: 'd', frontmatter: { title: 'D' } }),
    ];

    const dependents = findDependents(prds, 'a');
    expect(dependents.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('returns empty array when no PRDs depend on the upstream', () => {
    const prds = [
      makeQueuedPrd({ id: 'a', frontmatter: { title: 'A' } }),
      makeQueuedPrd({ id: 'b', frontmatter: { title: 'B' } }),
    ];

    expect(findDependents(prds, 'a')).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(findDependents([], 'any')).toHaveLength(0);
  });

  it('handles PRDs with no depends_on field', () => {
    const prds = [
      makeQueuedPrd({ id: 'x', frontmatter: { title: 'X' } }), // no depends_on
    ];
    expect(findDependents(prds, 'x')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// propagateSkip — upstream failed → dependents move to skipped/
// ---------------------------------------------------------------------------

describe('propagateSkip', () => {
  const makeTempDir = useTempDir('eforge-piggyback-skip-');

  it('moves waiting dependents to skipped/ when upstream failed', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream']);

    await propagateSkip(queueDir, cwd, 'upstream', 'failed');

    const skippedDir = join(cwd, queueDir, 'skipped');
    expect(existsSync(join(skippedDir, 'feature.md'))).toBe(true);
    // Original waiting file must be gone
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(false);
  });

  it('moves waiting dependents to skipped/ when upstream cancelled', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'docs-update', ['build-x']);

    await propagateSkip(queueDir, cwd, 'build-x', 'cancelled');

    expect(existsSync(join(cwd, queueDir, 'skipped', 'docs-update.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'docs-update.md'))).toBe(false);
  });

  it('recursively skips dependents of skipped PRDs', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    // Chain: upstream → level1 → level2
    writePrdToWaiting(cwd, queueDir, 'level1', ['upstream']);
    writePrdToWaiting(cwd, queueDir, 'level2', ['level1']);

    await propagateSkip(queueDir, cwd, 'upstream', 'failed');

    const skippedDir = join(cwd, queueDir, 'skipped');
    expect(existsSync(join(skippedDir, 'level1.md'))).toBe(true);
    expect(existsSync(join(skippedDir, 'level2.md'))).toBe(true);
  });

  it('multi-dependent fan-out: one upstream, three dependents all skipped', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'dep-a', ['root']);
    writePrdToWaiting(cwd, queueDir, 'dep-b', ['root']);
    writePrdToWaiting(cwd, queueDir, 'dep-c', ['root']);

    await propagateSkip(queueDir, cwd, 'root', 'failed');

    const skippedDir = join(cwd, queueDir, 'skipped');
    expect(existsSync(join(skippedDir, 'dep-a.md'))).toBe(true);
    expect(existsSync(join(skippedDir, 'dep-b.md'))).toBe(true);
    expect(existsSync(join(skippedDir, 'dep-c.md'))).toBe(true);
  });

  it('is a no-op when waiting/ directory does not exist', async () => {
    const dir = makeTempDir();
    // No git init, no waiting directory
    const queueDir = 'eforge/queue';
    // Should not throw
    await expect(propagateSkip(queueDir, dir, 'nonexistent', 'failed')).resolves.toBeUndefined();
  });

  it('is a no-op when no PRD depends on the upstream', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    writePrdToWaiting(cwd, queueDir, 'unrelated', ['other-upstream']);

    await propagateSkip(queueDir, cwd, 'nonexistent', 'failed');

    // unrelated should still be in waiting/
    expect(existsSync(join(cwd, queueDir, 'waiting', 'unrelated.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// unblockWaiting — upstream completed → dependents move to queue/
// ---------------------------------------------------------------------------

describe('unblockWaiting', () => {
  const makeTempDir = useTempDir('eforge-piggyback-unblock-');

  it('moves waiting dependents to queue/ when upstream completed', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream']);
    await recordArtifact(cwd, 'upstream');

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream');

    expect(unblocked).toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'feature.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(false);
  });

  it('does not unblock when the completed upstream has no recorded artifact', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream']);

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream', { requireArtifacts: true });

    expect(unblocked).not.toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'feature.md'))).toBe(false);
  });

  it('does not unblock a PRD when the upstream has no usable artifact in the registry', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream']);
    // No artifact written to registry — upstream completed without a usable artifact record.

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream', { requireArtifacts: true });

    expect(unblocked).not.toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'feature.md'))).toBe(false);
  });

  it('does not unblock a PRD when the upstream is terminal even if a stale artifact exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream']);
    writeFileSync(
      join(cwd, queueDir, 'failed', 'upstream.md'),
      '---\ntitle: Failed Upstream\n---\n\n# Failed Upstream\n',
    );
    await recordArtifact(cwd, 'upstream');

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream');

    expect(unblocked).not.toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'feature.md'))).toBe(false);
  });

  it('does not unblock a PRD that still has unsatisfied deps', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    // feature depends on both 'upstream' and 'other'
    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream', 'other']);
    // 'other' is still pending in queue/
    writePrdToQueue(cwd, queueDir, 'other');
    await recordArtifact(cwd, 'upstream');

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream');

    // feature has 'other' still active, so not unblocked
    expect(unblocked).not.toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'waiting', 'feature.md'))).toBe(true);
  });

  it('unblocks when all deps are completed (multi-dep)', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    // feature depends on upstream-a and upstream-b; both need durable artifacts
    writePrdToWaiting(cwd, queueDir, 'feature', ['upstream-a', 'upstream-b']);
    await recordArtifact(cwd, 'upstream-a');
    await recordArtifact(cwd, 'upstream-b');

    const unblocked = await unblockWaiting(queueDir, cwd, 'upstream-a');

    expect(unblocked).toContain('feature');
    expect(existsSync(join(cwd, queueDir, 'feature.md'))).toBe(true);
  });

  it('returns empty array when waiting/ is empty', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // waiting/ exists but is empty

    const unblocked = await unblockWaiting(queueDir, cwd, 'any');
    expect(unblocked).toHaveLength(0);
  });

  it('returns empty array when waiting/ does not exist', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    // No waiting/ directory

    const unblocked = await unblockWaiting(queueDir, dir, 'any');
    expect(unblocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Persistence across restart: waiting and skipped state survives on disk
// ---------------------------------------------------------------------------

describe('piggyback state persistence across restart', () => {
  const makeTempDir = useTempDir('eforge-piggyback-persist-');

  it('waiting state survives daemon restart (files on disk)', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    // Simulate: piggybacked PRD written to waiting/
    writePrdToWaiting(cwd, queueDir, 'piggybacked', ['running-upstream']);

    // Simulate daemon restart: load waiting queue fresh
    const waitingPrds = await loadQueue(`${queueDir}/waiting`, cwd);
    expect(waitingPrds).toHaveLength(1);
    expect(waitingPrds[0].id).toBe('piggybacked');
    expect(waitingPrds[0].frontmatter.depends_on).toEqual(['running-upstream']);
  });

  it('skipped state survives daemon restart (files on disk)', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    writePrdToWaiting(cwd, queueDir, 'to-be-skipped', ['failed-upstream']);
    await propagateSkip(queueDir, cwd, 'failed-upstream', 'failed');

    // Simulate daemon restart: load skipped queue
    const skippedPrds = await loadQueue(`${queueDir}/skipped`, cwd);
    expect(skippedPrds.some((p) => p.id === 'to-be-skipped')).toBe(true);

    // And the waiting/ directory should now be empty
    const waitingPrds = await loadQueue(`${queueDir}/waiting`, cwd);
    expect(waitingPrds.some((p) => p.id === 'to-be-skipped')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDependsOnExists — reject enqueue when upstream not in queue
// ---------------------------------------------------------------------------

describe('validateDependsOnExists', () => {
  const makeTempDir = useTempDir('eforge-piggyback-validate-');

  it('resolves when upstream exists in queue/', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'upstream.md'),
      '---\ntitle: Upstream\n---\n\n# Upstream\n',
    );

    await expect(validateDependsOnExists(['upstream'], queueDir, dir)).resolves.toBeUndefined();
  });

  it('resolves when upstream exists in waiting/', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir, 'waiting'), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'waiting', 'in-waiting.md'),
      '---\ntitle: In Waiting\ndepends_on: ["other"]\n---\n\n# In Waiting\n',
    );

    await expect(validateDependsOnExists(['in-waiting'], queueDir, dir)).resolves.toBeUndefined();
  });

  it('resolves for an active queue item even when a stale completion index entry exists', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'active-upstream.md'),
      '---\ntitle: Active Upstream\n---\n\n# Active Upstream\n',
    );
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'active-upstream',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(validateDependsOnExists(['active-upstream'], queueDir, dir)).resolves.toBeUndefined();
  });

  it('resolves for an active waiting item even when a stale completion index entry exists', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir, 'waiting'), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'waiting', 'waiting-upstream.md'),
      '---\ntitle: Waiting Upstream\n---\n\n# Waiting Upstream\n',
    );
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'waiting-upstream',
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(validateDependsOnExists(['waiting-upstream'], queueDir, dir)).resolves.toBeUndefined();
  });

  it('throws when upstream does not exist anywhere in the queue', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });

    await expect(
      validateDependsOnExists(['ghost-id'], queueDir, dir),
    ).rejects.toThrow(/ghost-id/);
  });

  it('resolves for empty depends_on array without checking filesystem', async () => {
    const dir = makeTempDir();
    // No queue directory at all — should not throw for empty array
    await expect(validateDependsOnExists([], 'does-not-exist', dir)).resolves.toBeUndefined();
  });

  it('resolves when upstream has a usable artifact in the registry (completed prior run)', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    // No queue file — upstream completed in a prior session. But it has a registry artifact.
    await recordArtifact(dir, 'prior-upstream');

    await expect(validateDependsOnExists(['prior-upstream'], queueDir, dir)).resolves.toBeUndefined();
  });

  it('throws with "artifact" message when upstream is in failed/ without a registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir, 'failed'), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'failed', 'failed-upstream.md'),
      '---\ntitle: Failed Upstream\n---\n\n# Failed Upstream\n',
    );

    await expect(
      validateDependsOnExists(['failed-upstream'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "artifact" message when upstream is in skipped/ without a registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir, 'skipped'), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'skipped', 'skipped-upstream.md'),
      '---\ntitle: Skipped Upstream\n---\n\n# Skipped Upstream\n',
    );

    await expect(
      validateDependsOnExists(['skipped-upstream'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws when upstream is terminal even if a stale registry artifact exists', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir, 'failed'), { recursive: true });
    writeFileSync(
      join(dir, queueDir, 'failed', 'failed-upstream.md'),
      '---\ntitle: Failed Upstream\n---\n\n# Failed Upstream\n',
    );
    await recordArtifact(dir, 'failed-upstream');

    await expect(
      validateDependsOnExists(['failed-upstream'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "unknown queue item" message when dep is not found anywhere', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });

    await expect(
      validateDependsOnExists(['truly-unknown'], queueDir, dir),
    ).rejects.toThrow(/unknown queue item/);
  });


  it('throws with "artifact" message when completion index has failed entry even with stale registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    // Stale artifact exists but completion index says failed — completion index wins.
    await recordArtifact(dir, 'ci-failed-upstream');
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-failed-upstream',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      validateDependsOnExists(['ci-failed-upstream'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "artifact" message when completion index has skipped entry even with stale registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    // Stale artifact exists but completion index says skipped — completion index wins.
    await recordArtifact(dir, 'ci-skipped-upstream');
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-skipped-upstream',
      status: 'skipped',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      validateDependsOnExists(['ci-skipped-upstream'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "artifact" message when completion index has completed entry with artifactAvailable: false', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-completed-no-artifact',
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      validateDependsOnExists(['ci-completed-no-artifact'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "artifact" message when completion index completed without artifact even with stale registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    await recordArtifact(dir, 'ci-completed-no-artifact-stale');
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-completed-no-artifact-stale',
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      validateDependsOnExists(['ci-completed-no-artifact-stale'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('throws with "artifact" message when completion index completed but no registry artifact', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    // completion index says completed+artifactAvailable:true but no actual artifact record
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-completed-missing-artifact',
      status: 'completed',
      artifactAvailable: true,
      artifactBranch: 'eforge/ci-completed-missing-artifact',
      completedAt: now,
      updatedAt: now,
    });
    // No upsertArtifact call — registry has no record.

    await expect(
      validateDependsOnExists(['ci-completed-missing-artifact'], queueDir, dir),
    ).rejects.toThrow(/artifact/);
  });

  it('resolves when completion index completed with artifactAvailable: true and registry artifact present', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });
    await recordArtifact(dir, 'ci-completed-with-artifact');
    const now = new Date().toISOString();
    await upsertCompletion(dir, {
      prdId: 'ci-completed-with-artifact',
      status: 'completed',
      artifactAvailable: true,
      artifactBranch: 'eforge/ci-completed-with-artifact',
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      validateDependsOnExists(['ci-completed-with-artifact'], queueDir, dir),
    ).resolves.toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// enqueuePrd with intoWaiting flag
// ---------------------------------------------------------------------------

describe('enqueuePrd with intoWaiting', () => {
  const makeTempDir = useTempDir('eforge-piggyback-enqueue-');

  it('writes PRD to waiting/ when intoWaiting is true', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });

    const result = await enqueuePrd({
      body: '# Feature\n\nDo something.',
      title: 'My Feature',
      queueDir,
      cwd: dir,
      depends_on: ['some-upstream'],
      intoWaiting: true,
    });

    const expectedPath = join(dir, queueDir, 'waiting', `${result.id}.md`);
    expect(existsSync(expectedPath)).toBe(true);
    // Should NOT be in queue root
    expect(existsSync(join(dir, queueDir, `${result.id}.md`))).toBe(false);
  });

  it('writes PRD to queue/ root when intoWaiting is false', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });

    const result = await enqueuePrd({
      body: '# Feature\n\nDo something.',
      title: 'My Feature',
      queueDir,
      cwd: dir,
      intoWaiting: false,
    });

    const expectedPath = join(dir, queueDir, `${result.id}.md`);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(join(dir, queueDir, 'waiting', `${result.id}.md`))).toBe(false);
  });

  it('preserves depends_on in frontmatter when writing to waiting/', async () => {
    const dir = makeTempDir();
    const queueDir = 'eforge/queue';
    mkdirSync(join(dir, queueDir), { recursive: true });

    const result = await enqueuePrd({
      body: '# Feature',
      title: 'Piggybacked',
      queueDir,
      cwd: dir,
      depends_on: ['upstream-build'],
      intoWaiting: true,
    });

    const prds = await loadQueue(`${queueDir}/waiting`, dir);
    const prd = prds.find((p) => p.id === result.id);
    expect(prd).toBeDefined();
    expect(prd!.frontmatter.depends_on).toEqual(['upstream-build']);
  });
});

// ---------------------------------------------------------------------------
// classifyAfterQueueId — placement helper
// ---------------------------------------------------------------------------

describe('classifyAfterQueueId', () => {
  const makeTempDir = useTempDir('eforge-classify-after-');

  it('returns intoWaiting: true for an active root queue item', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    writePrdToQueue(cwd, queueDir, 'pending-upstream');

    const result = await classifyAfterQueueId('pending-upstream', queueDir, cwd);
    expect(result).toEqual({ dependsOn: ['pending-upstream'], intoWaiting: true });
  });

  it('returns intoWaiting: true for an active waiting queue item', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    writePrdToWaiting(cwd, queueDir, 'waiting-upstream', ['some-parent']);

    const result = await classifyAfterQueueId('waiting-upstream', queueDir, cwd);
    expect(result).toEqual({ dependsOn: ['waiting-upstream'], intoWaiting: true });
  });

  it('returns intoWaiting: false for a completed upstream with usable artifact', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // No queue file — upstream has already completed
    await recordArtifact(cwd, 'completed-upstream');

    const result = await classifyAfterQueueId('completed-upstream', queueDir, cwd);
    expect(result).toEqual({ dependsOn: ['completed-upstream'], intoWaiting: false });
  });

  it('throws for a failed upstream in the failed/ directory', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    const failedDir = join(cwd, queueDir, 'failed');
    mkdirSync(failedDir, { recursive: true });
    writeFileSync(
      join(failedDir, 'failed-upstream.md'),
      '---\ntitle: failed-upstream\n---\n\n# failed\n',
    );

    await expect(
      classifyAfterQueueId('failed-upstream', queueDir, cwd),
    ).rejects.toThrow('failed-upstream');
  });

  it('throws for a skipped upstream in the skipped/ directory', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    const skippedDir = join(cwd, queueDir, 'skipped');
    mkdirSync(skippedDir, { recursive: true });
    writeFileSync(
      join(skippedDir, 'skipped-upstream.md'),
      '---\ntitle: skipped-upstream\n---\n\n# skipped\n',
    );

    await expect(
      classifyAfterQueueId('skipped-upstream', queueDir, cwd),
    ).rejects.toThrow('skipped-upstream');
  });

  it('throws for a completed upstream without a usable artifact (completion registry)', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'completed-no-artifact',
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      classifyAfterQueueId('completed-no-artifact', queueDir, cwd),
    ).rejects.toThrow('completed-no-artifact');
  });

  it('throws for an unknown upstream id', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    await expect(
      classifyAfterQueueId('nonexistent-id', queueDir, cwd),
    ).rejects.toThrow('nonexistent-id');
  });

  it('error messages contain the afterQueueId for all failure cases', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);

    const unknownErr = await classifyAfterQueueId('unknown-xyz', queueDir, cwd).catch((e: Error) => e);
    expect(unknownErr).toBeInstanceOf(Error);
    expect((unknownErr as Error).message).toContain('unknown-xyz');
  });

  it('throws for a failed upstream even when a stale usable artifact record exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // Stale artifact record for the same id
    await recordArtifact(cwd, 'stale-failed');
    // But the PRD is in the failed/ directory
    const failedDir = join(cwd, queueDir, 'failed');
    writeFileSync(
      join(failedDir, 'stale-failed.md'),
      '---\ntitle: stale-failed\n---\n\n# stale-failed\n',
    );

    await expect(
      classifyAfterQueueId('stale-failed', queueDir, cwd),
    ).rejects.toThrow('stale-failed');
  });

  it('throws for a skipped upstream even when a stale usable artifact record exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // Stale artifact record for the same id
    await recordArtifact(cwd, 'stale-skipped');
    // But the PRD is in the skipped/ directory
    const skippedDir = join(cwd, queueDir, 'skipped');
    writeFileSync(
      join(skippedDir, 'stale-skipped.md'),
      '---\ntitle: stale-skipped\n---\n\n# stale-skipped\n',
    );

    await expect(
      classifyAfterQueueId('stale-skipped', queueDir, cwd),
    ).rejects.toThrow('stale-skipped');
  });

  it('throws for a completion-registry failed upstream even when a stale usable artifact record exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // Stale artifact record
    await recordArtifact(cwd, 'stale-completion-failed');
    // But the completion registry says failed
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'stale-completion-failed',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      classifyAfterQueueId('stale-completion-failed', queueDir, cwd),
    ).rejects.toThrow('stale-completion-failed');
  });

  it('throws for a completion-registry skipped upstream even when a stale usable artifact record exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // Stale artifact record
    await recordArtifact(cwd, 'stale-completion-skipped');
    // But the completion registry says skipped
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'stale-completion-skipped',
      status: 'skipped',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      classifyAfterQueueId('stale-completion-skipped', queueDir, cwd),
    ).rejects.toThrow('stale-completion-skipped');
  });

  it('throws for a completion-registry completed-without-artifact upstream even when a stale usable artifact record exists', async () => {
    const dir = makeTempDir();
    const { cwd, queueDir } = setupGitQueue(dir);
    // Stale artifact record
    await recordArtifact(cwd, 'stale-completed-no-artifact');
    // But the completion registry says completed without artifact
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'stale-completed-no-artifact',
      status: 'completed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    await expect(
      classifyAfterQueueId('stale-completed-no-artifact', queueDir, cwd),
    ).rejects.toThrow('stale-completed-no-artifact');
  });
});
