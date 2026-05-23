import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStackBaseContext } from '@eforge-build/engine/stacking';
import { upsertStackLayer } from '@eforge-build/engine/stacking';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';

const exec = promisify(execFile);

async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-base-'));
  await exec('git', ['init', '-b', 'main'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  await writeFile(join(cwd, 'README.md'), 'hello\n');
  await exec('git', ['add', '.'], { cwd });
  await exec('git', ['commit', '-m', 'initial'], { cwd });
  return cwd;
}

const config = {
  build: { trunkBranch: 'main' },
  stacking: { enabled: true, provider: 'git-spice', gitSpice: {} },
} as unknown as EforgeConfig;

function queuedPrd(id: string, frontmatter: Partial<QueuedPrd['frontmatter']> = {}): QueuedPrd {
  return {
    id,
    filePath: `/tmp/${id}.md`,
    frontmatter: { title: id, ...frontmatter },
    content: `---\ntitle: ${id}\n---\n\n# ${id}`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

async function parentLayer(cwd: string, artifactBranch: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertStackLayer(cwd, {
    prdId: 'parent-prd',
    stackId: 'stack-1',
    provider: 'git-spice',
    branch: 'eforge/parent-prd',
    baseBranch: 'main',
    artifact: { branch: artifactBranch, commitSha: 'abc123' },
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

async function parentLayerWithoutArtifact(cwd: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertStackLayer(cwd, {
    prdId: 'parent-prd',
    stackId: 'stack-1',
    provider: 'git-spice',
    branch: 'eforge/parent-prd',
    baseBranch: 'main',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

describe('resolveStackBaseContext', () => {
  it('uses configured trunk branch for root stack layers instead of current branch', async () => {
    const cwd = await repo();
    await exec('git', ['checkout', '-b', 'topic'], { cwd });

    const result = await resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('root-prd'),
      planSetName: 'root-prd',
    });

    expect(result.baseBranch).toBe('main');
    expect(result.stackId).toBe('root-prd');
  });

  it('uses the parent recorded artifact branch for child stack layers', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/parent-prd'], { cwd });
    await parentLayer(cwd, 'eforge/parent-prd');

    const result = await resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    });

    expect(result.baseBranch).toBe('eforge/parent-prd');
    expect(result.parentPrdId).toBe('parent-prd');
    expect(result.stackId).toBe('stack-1');
  });

  it('throws instead of falling back to the parent branch when no artifact is recorded', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/parent-prd'], { cwd });
    await parentLayerWithoutArtifact(cwd);

    await expect(resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    })).rejects.toThrow(/child-prd.*parent-prd.*no recorded artifact ref.*Rebuild or repair/);
  });

  it('falls back to recorded commitSha when the artifact branch was removed after landing', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const now = new Date().toISOString();
    await upsertStackLayer(cwd, {
      prdId: 'parent-prd',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/parent-prd',
      baseBranch: 'main',
      artifact: { branch: 'eforge/deleted-parent-prd', commitSha },
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    const result = await resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    });

    expect(result.baseBranch).toBe(commitSha);
  });

  it('throws an actionable error when the recorded parent artifact ref does not resolve', async () => {
    const cwd = await repo();
    await parentLayer(cwd, 'eforge/missing-parent-artifact');

    await expect(resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    })).rejects.toThrow(/child-prd.*parent-prd.*eforge\/missing-parent-artifact.*Rebuild or repair/);
  });
});
