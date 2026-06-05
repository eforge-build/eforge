/**
 * Engine-level tests for the accept-build-as-successful recovery helper
 * (`@eforge-build/engine/recovery/accept-success`).
 *
 * Named to fall under the `apply-recovery` Vitest filter. Each test builds a
 * real git fixture with a surviving feature branch, seeds the failed PRD + JSON
 * recovery sidecar, then drives previewAcceptSuccess / applyAcceptSuccess and
 * asserts the durable marker, cleanup/landing results, and dependent unblocking.
 *
 * Per AGENTS.md: no harness or git mocks — all tests use real git operations.
 */

import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { previewAcceptSuccess, applyAcceptSuccess } from '@eforge-build/engine/recovery/accept-success';
import { useTempDir } from './test-tmpdir.js';

const makeTmp = useTempDir('eforge-accept-success-');

function git(dir: string, args: string[]): void {
  execFileSync('git', args, { cwd: dir });
}

function seedGitRepo(dir: string): void {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

interface SeedOpts {
  withArtifacts?: boolean;
  dependents?: { id: string; deps: string[] }[];
}

async function seedAcceptScenario(dir: string, prdId: string, opts: SeedOpts = {}) {
  const setName = 'accept-set';
  const feature = `eforge/${setName}`;
  git(dir, ['checkout', '-b', feature]);
  if (opts.withArtifacts !== false) {
    await mkdir(join(dir, 'eforge', 'plans', setName), { recursive: true });
    await writeFile(join(dir, 'eforge', 'plans', setName, 'plan-01.md'), '# plan', 'utf-8');
    await mkdir(join(dir, 'eforge', 'prds'), { recursive: true });
    await writeFile(join(dir, 'eforge', 'prds', `${prdId}.md`), '# prd', 'utf-8');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'feat: landed work with artifacts']);
  } else {
    git(dir, ['commit', '--allow-empty', '-m', 'feat: landed work']);
  }
  git(dir, ['checkout', 'main']);

  const failedDir = join(dir, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(join(failedDir, `${prdId}.md`), `---\ntitle: ${prdId}\n---\n# ${prdId}`, 'utf-8');
  await writeFile(join(failedDir, `${prdId}.recovery.md`), '## Recovery', 'utf-8');
  const sidecar = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    summary: {
      prdId, setName, featureBranch: feature, baseBranch: 'main',
      plans: [], failingPlan: { planId: 'plan-01' },
      landedCommits: [{ sha: 'deadbeef', subject: 'work', author: 'Test', date: new Date().toISOString() }],
      diffStat: '', modelsUsed: [], failedAt: new Date().toISOString(),
      acceptanceValidation: { passed: false, total: 1, pass: 0, fail: 1, unknown: 0, verdicts: [] },
      validationCommands: [{ command: 'pnpm test', exitCode: 0 }],
    },
    verdict: { verdict: 'manual', confidence: 'low', rationale: 'manual', completedWork: [], remainingWork: [], risks: [] },
  };
  await writeFile(join(failedDir, `${prdId}.recovery.json`), JSON.stringify(sidecar, null, 2), 'utf-8');

  for (const dep of opts.dependents ?? []) {
    const skippedDir = join(dir, '.eforge', 'queue', 'skipped');
    await mkdir(skippedDir, { recursive: true });
    const depsLine = `depends_on: [${dep.deps.map((d) => `"${d}"`).join(', ')}]`;
    await writeFile(join(skippedDir, `${dep.id}.md`), `---\ntitle: ${dep.id}\n${depsLine}\n---\n# ${dep.id}`, 'utf-8');
  }

  return { queueDir: join(dir, '.eforge', 'queue'), sidecarJson: join(failedDir, `${prdId}.recovery.json`) };
}

function helperOptions(dir: string, prdId: string, queueDir: string, landingAction: 'pr' | 'merge' | 'leave' = 'leave') {
  return { cwd: dir, prdId, queueDir, landingAction, planOutputDir: 'eforge/plans' };
}

describe('accept-success recovery helper', () => {
  it('previews eligible with cleanup effect and audit fields', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-eligible';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    const preview = await previewAcceptSuccess(helperOptions(dir, prdId, queueDir));
    expect(preview.status).toBe('eligible');
    expect(preview.cleanup.willCommit).toBe(true);
    expect(preview.cleanup.planArtifactsPresent).toBe(true);
    expect(preview.audit.landedCommitCount).toBe(1);
    expect(preview.landingAction).toBe('leave');
  });

  it('rejects invalid reasonCategory and empty reason with status 400', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-validation';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    await expect(applyAcceptSuccess(helperOptions(dir, prdId, queueDir), {
      prdId, reasonCategory: 'nope' as never, reason: 'fine', unblockDependentIds: [],
    })).rejects.toMatchObject({ status: 400 });

    await expect(applyAcceptSuccess(helperOptions(dir, prdId, queueDir), {
      prdId, reasonCategory: 'other', reason: '   ', unblockDependentIds: [],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('applies, commits cleanup, lands leave, and writes the durable marker', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-apply';
    const { queueDir, sidecarJson } = await seedAcceptScenario(dir, prdId);

    const res = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'leave'), {
      prdId, reasonCategory: 'bad_acceptance_criterion', reason: 'criterion was wrong', unblockDependentIds: [],
    });
    expect(res.status).toBe('applied');
    expect(res.applied.action).toBe('accepted-success');
    expect(res.applied.acceptedAt).toBeTruthy();
    expect(res.applied.reasonCategory).toBe('bad_acceptance_criterion');
    expect(res.applied.cleanup.status).toBe('committed');
    expect(res.applied.cleanup.commitSha).toBeTruthy();
    expect(res.applied.landing).toMatchObject({ action: 'leave', status: 'complete', branch: 'eforge/accept-set' });

    const json = JSON.parse(await readFile(sidecarJson, 'utf-8'));
    expect(json.applied.action).toBe('accepted-success');
    expect(json.applied.reason).toBe('criterion was wrong');
    // Failed PRD + sidecars remain as audit records.
    expect(await exists(join(queueDir, 'failed', `${prdId}.md`))).toBe(true);
  });

  it('reports cleanup noop when no plan/PRD artifacts exist', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-noop';
    const { queueDir } = await seedAcceptScenario(dir, prdId, { withArtifacts: false });

    const res = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'leave'), {
      prdId, reasonCategory: 'manual_verification_passed', reason: 'verified by hand', unblockDependentIds: [],
    });
    expect(res.applied.cleanup.status).toBe('noop');
    expect(res.applied.cleanup.commitSha).toBeUndefined();
  });

  it('reports a merge commit sha for merge landing when local merge to trunk is opted in', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-merge';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    // baseBranch is the trunk ('main'), so the merge requires the opt-in.
    const res = await applyAcceptSuccess({ ...helperOptions(dir, prdId, queueDir, 'merge'), allowLocalMergeToTrunk: true }, {
      prdId, reasonCategory: 'other', reason: 'accepting merge', unblockDependentIds: [],
    });
    expect(res.applied.landing.action).toBe('merge');
    expect(res.applied.landing.status).toBe('complete');
    expect(res.applied.landing.mergeCommitSha).toBeTruthy();
  });

  it('skips a merge to the trunk branch when local merge to trunk is not opted in', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-merge-trunk-guard';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    // baseBranch is 'main' (trunk) and allowLocalMergeToTrunk defaults to false,
    // so the landing must be skipped rather than merged into trunk.
    const res = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'merge'), {
      prdId, reasonCategory: 'other', reason: 'accepting merge', unblockDependentIds: [],
    });
    expect(res.applied.landing.action).toBe('merge');
    expect(res.applied.landing.status).toBe('skipped');
    expect(res.applied.landing.mergeCommitSha).toBeUndefined();
    expect(res.applied.landing.reason).toMatch(/not permitted/);
  });

  it('wires the pr landing action and records a failure reason when no remote exists', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-pr';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    // No `origin` remote is configured, so direct-PR base sync fails before PR
    // creation. The helper must still surface action: 'pr' with a typed failure
    // result rather than throwing, and the apply must complete.
    const res = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'pr'), {
      prdId, reasonCategory: 'other', reason: 'accepting via pr', unblockDependentIds: [],
    });
    expect(res.status).toBe('applied');
    expect(res.applied.landing.action).toBe('pr');
    expect(res.applied.landing.status).toBe('failed');
    expect(res.applied.landing.reason).toContain("Remote 'origin' is not a configured git remote");
  });

  it('is idempotent: reapply returns already-applied without new cleanup', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-idempotent';
    const { queueDir } = await seedAcceptScenario(dir, prdId);

    const first = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'leave'), {
      prdId, reasonCategory: 'other', reason: 'accept once', unblockDependentIds: [],
    });
    expect(first.status).toBe('applied');
    const featureShaAfterFirst = execFileSync('git', ['rev-parse', 'eforge/accept-set'], { cwd: dir }).toString().trim();

    const second = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'leave'), {
      prdId, reasonCategory: 'other', reason: 'accept twice', unblockDependentIds: [],
    });
    expect(second.status).toBe('already-applied');
    expect(second.applied.cleanup.commitSha).toBe(first.applied.cleanup.commitSha);
    expect(second.applied.reason).toBe('accept once');

    const featureShaAfterSecond = execFileSync('git', ['rev-parse', 'eforge/accept-set'], { cwd: dir }).toString().trim();
    expect(featureShaAfterSecond).toBe(featureShaAfterFirst);
  });

  it('unblocks selected satisfied dependents and leaves blocked ones in skipped/', async () => {
    const dir = makeTmp();
    seedGitRepo(dir);
    const prdId = 'accept-deps';
    const { queueDir } = await seedAcceptScenario(dir, prdId, {
      dependents: [
        { id: 'dep-ready', deps: [prdId] },
        { id: 'dep-blocked', deps: [prdId, 'other-blocker'] },
      ],
    });

    const res = await applyAcceptSuccess(helperOptions(dir, prdId, queueDir, 'leave'), {
      prdId, reasonCategory: 'other', reason: 'accept with deps', unblockDependentIds: ['dep-ready', 'dep-blocked'],
    });
    expect(res.applied.dependents.unblocked).toEqual(['dep-ready']);
    expect(res.applied.dependents.remainedBlocked).toEqual(['dep-blocked']);

    // dep-ready moved to queue root with the accepted dependency removed.
    expect(await exists(join(queueDir, 'dep-ready.md'))).toBe(true);
    expect(await exists(join(queueDir, 'skipped', 'dep-ready.md'))).toBe(false);
    const movedContent = await readFile(join(queueDir, 'dep-ready.md'), 'utf-8');
    expect(movedContent).not.toContain('depends_on');

    // dep-blocked stays in skipped/.
    expect(await exists(join(queueDir, 'skipped', 'dep-blocked.md'))).toBe(true);
  });
});
