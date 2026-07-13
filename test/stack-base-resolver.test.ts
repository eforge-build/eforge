import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStackBaseContext } from '@eforge-build/engine/stacking';
import { upsertStackLayer } from '@eforge-build/engine/stacking';
import { upsertArtifact } from '@eforge-build/engine/artifacts';
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

async function parentLayer(cwd: string, artifactBranch: string, commitSha = 'abc123'): Promise<void> {
  const now = new Date().toISOString();
  await upsertStackLayer(cwd, {
    prdId: 'parent-prd',
    stackId: 'stack-1',
    provider: 'git-spice',
    branch: 'eforge/parent-prd',
    baseBranch: 'main',
    artifact: { branch: artifactBranch, commitSha },
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

async function createUnlandedArtifactBranch(cwd: string, branch: string): Promise<string> {
  await exec('git', ['checkout', '-b', branch], { cwd });
  const fileName = `${branch.replace(/[^A-Za-z0-9_-]/g, '_')}.txt`;
  await writeFile(join(cwd, fileName), `${branch}\n`);
  await exec('git', ['add', fileName], { cwd });
  await exec('git', ['commit', '-m', `artifact ${branch}`], { cwd });
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
  await exec('git', ['checkout', 'main'], { cwd });
  return stdout.trim();
}

async function createRemoteMainRef(cwd: string): Promise<void> {
  const { stdout } = await exec('git', ['rev-parse', 'main'], { cwd });
  await exec('git', ['update-ref', 'refs/remotes/origin/main', stdout.trim()], { cwd });
}

async function createUnlandedCommit(cwd: string): Promise<string> {
  const branch = 'tmp/unlanded-parent';
  const commitSha = await createUnlandedArtifactBranch(cwd, branch);
  await exec('git', ['branch', '-D', branch], { cwd });
  return commitSha;
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

  it('carries configured trunk sync remote for root stack layers', async () => {
    const cwd = await repo();
    const upstreamConfig = {
      ...config,
      build: { trunkBranch: 'main', trunkSync: { remote: 'upstream' } },
    } as unknown as EforgeConfig;

    const result = await resolveStackBaseContext({
      cwd,
      config: upstreamConfig,
      prd: queuedPrd('root-prd'),
      planSetName: 'root-prd',
    });

    expect(result.baseBranch).toBe('main');
    expect(result.trunkBranch).toBe('main');
    expect(result.trunkRemote).toBe('upstream');
  });

  it('resolves trunk from the configured remote HEAD when trunkBranch is unset', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'develop'], { cwd });
    const { stdout: mainSha } = await exec('git', ['rev-parse', 'main'], { cwd });
    const { stdout: developSha } = await exec('git', ['rev-parse', 'develop'], { cwd });
    await exec('git', ['update-ref', 'refs/remotes/origin/main', mainSha.trim()], { cwd });
    await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd });
    await exec('git', ['update-ref', 'refs/remotes/upstream/develop', developSha.trim()], { cwd });
    await exec('git', ['symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/develop'], { cwd });
    const upstreamConfig = {
      ...config,
      build: { trunkSync: { remote: 'upstream' } },
    } as unknown as EforgeConfig;

    const result = await resolveStackBaseContext({
      cwd,
      config: upstreamConfig,
      prd: queuedPrd('root-prd'),
      planSetName: 'root-prd',
    });

    expect(result.baseBranch).toBe('develop');
    expect(result.trunkBranch).toBe('develop');
    expect(result.trunkRemote).toBe('upstream');
  });

  it('uses the parent recorded artifact branch for child stack layers', async () => {
    const cwd = await repo();
    const commitSha = await createUnlandedArtifactBranch(cwd, 'eforge/parent-prd');
    await parentLayer(cwd, 'eforge/parent-prd', commitSha);

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

  it('collapses an already-integrated parent artifact branch to trunk', async () => {
    const cwd = await repo();
    await createRemoteMainRef(cwd);
    await exec('git', ['branch', 'eforge/parent-prd'], { cwd });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    await parentLayer(cwd, 'eforge/parent-prd', stdout.trim());

    const result = await resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    });

    expect(result.baseBranch).toBe('main');
    expect(result.originalBaseBranch).toBe('eforge/parent-prd');
    expect(result.effectiveBaseBranch).toBe('main');
    expect(result.parentArtifactRef).toBe('eforge/parent-prd');
    expect(result.repairReason).toBe('parent-artifact-already-integrated');
    expect(result.trunkIntegrationRef).toBe('refs/remotes/origin/main');
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

  it('collapses to trunk using recorded commitSha when the artifact branch was removed after landing', async () => {
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

    expect(result.baseBranch).toBe('main');
    expect(result.parentArtifactCommit).toBe(commitSha);
    expect(result.repairReason).toBe('parent-artifact-already-integrated');
  });

  it('throws an actionable error when the missing parent artifact commit is not integrated into trunk', async () => {
    const cwd = await repo();
    const commitSha = await createUnlandedCommit(cwd);
    await parentLayer(cwd, 'eforge/missing-parent-artifact', commitSha);

    await expect(resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    })).rejects.toThrow(/child-prd.*parent-prd.*eforge\/missing-parent-artifact.*retargeting the child to trunk/);
  });

  it('prefers artifact registry over stack layer when both have artifact refs', async () => {
    const cwd = await repo();
    // Create two different unlanded branches: one in the stack layer, one in the registry.
    const registryCommit = await createUnlandedArtifactBranch(cwd, 'eforge/parent-prd-registry');
    await createUnlandedArtifactBranch(cwd, 'eforge/parent-prd-stale');

    // Write stack layer with stale branch
    await parentLayer(cwd, 'eforge/parent-prd-stale');

    // Write registry with fresher branch (simulates a rebuild)
    const now = new Date().toISOString();
    await upsertArtifact(cwd, {
      prdId: 'parent-prd',
      artifactBranch: 'eforge/parent-prd-registry',
      commitSha: registryCommit,
      resolvedBase: 'main',
      landingAction: 'leave',
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

    // Registry branch is preferred
    expect(result.baseBranch).toBe('eforge/parent-prd-registry');
  });

  it('falls back to stack layer artifact when registry has no entry for parent', async () => {
    const cwd = await repo();
    const commitSha = await createUnlandedArtifactBranch(cwd, 'eforge/parent-prd');
    // Only stack layer written — no registry entry (e.g., older build).
    await parentLayer(cwd, 'eforge/parent-prd', commitSha);

    const result = await resolveStackBaseContext({
      cwd,
      config,
      prd: queuedPrd('child-prd', { stack_parent: 'parent-prd' }),
      planSetName: 'child-prd',
    });

    // Falls back to stack layer artifact ref
    expect(result.baseBranch).toBe('eforge/parent-prd');
  });

  it('resolves a parent from the registry alone and collapses to trunk when the missing branch commit is integrated', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const now = new Date().toISOString();
    await upsertArtifact(cwd, {
      prdId: 'parent-prd',
      artifactBranch: 'eforge/deleted-parent-prd',
      commitSha,
      resolvedBase: 'main',
      landingAction: 'leave',
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

    expect(result.baseBranch).toBe('main');
    expect(result.parentArtifactCommit).toBe(commitSha);
    expect(result.stackId).toBe('parent-prd');
  });
});
