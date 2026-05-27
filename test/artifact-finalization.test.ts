/**
 * Tests for artifact finalization: post-landing commitSha refresh and
 * landing metadata recording.
 *
 * Covers:
 *   - updateArtifactRecord reflects cleanup-created commits via commitSha update
 *   - Landing failure records landingStatus: 'failed' while hasUsableArtifact remains true
 *   - Landing skipped records landingStatus: 'skipped' while hasUsableArtifact remains true
 *   - A completed completion record is written by upsertCompletion with artifactAvailable: true
 *   - A failed completion record is written with artifactAvailable: false
 *   - updateArtifactRecord is a no-op when no artifact exists (preserves registry)
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { finalize, stackLanding, type PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { StackBaseContext } from '@eforge-build/engine/stacking/base-resolver';
import type { ProviderCommandResult, StackProviderAdapter } from '@eforge-build/engine/stacking/provider';
import { upsertStackLayer } from '@eforge-build/engine/stacking/state';
import {
  upsertArtifact,
  updateArtifactRecord,
  loadArtifactRegistry,
  hasUsableArtifact,
  type ArtifactRecord,
} from '@eforge-build/engine/artifacts';
import {
  upsertCompletion,
  loadCompletionRegistry,
  saveCompletionRegistry,
  lookupCompletion,
  completionRegistryPath,
} from '@eforge-build/engine/artifacts';
import { useTempDir } from './test-tmpdir.js';

const execAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(prdId: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  const now = new Date().toISOString();
  return {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'initial-sha',
    resolvedBase: 'main',
    landingAction: 'pr',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function initGitRepo(cwd: string): Promise<void> {
  await execAsync('git', ['init', '-b', 'main'], { cwd });
  await execAsync('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await execAsync('git', ['config', 'user.name', 'Test'], { cwd });
  await writeFile(join(cwd, 'README.md'), 'hello\n');
  await writeFile(join(cwd, '.gitignore'), '.eforge/artifacts/\n.eforge/stacks/\n', 'utf-8');
  await execAsync('git', ['add', '.'], { cwd });
  await execAsync('git', ['commit', '-m', 'initial'], { cwd });
}

async function getCurrentSha(cwd: string): Promise<string> {
  const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

async function getRefSha(cwd: string, ref: string): Promise<string> {
  const { stdout } = await execAsync('git', ['rev-parse', ref], { cwd });
  return stdout.trim();
}

async function setupFeatureBranchWithCleanupFile(cwd: string, branch: string): Promise<string> {
  await initGitRepo(cwd);
  await execAsync('git', ['checkout', '-b', branch], { cwd });
  const planDir = join(cwd, '.eforge', 'output', 'plan-set');
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, 'plan.md'), '# Plan to clean up\n', 'utf-8');
  await execAsync('git', ['add', '.eforge/output/plan-set/plan.md'], { cwd });
  await execAsync('git', ['commit', '-m', 'build output'], { cwd });
  return getCurrentSha(cwd);
}

function makePhaseContext(overrides: Partial<PhaseContext>): PhaseContext {
  return {
    state: {
      status: 'running',
      plans: { 'plan-a': { status: 'merged', dependsOn: [] } },
      completedPlans: [],
    },
    config: {
      name: 'plan-set',
      description: 'Plan set',
      mode: 'feature',
      baseBranch: 'main',
      plans: [{ id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'plan-a' }],
    },
    repoRoot: overrides.repoRoot ?? '',
    planRunner: async function* () {},
    parallelism: 1,
    mergeWorktreePath: overrides.mergeWorktreePath ?? overrides.repoRoot ?? '',
    featureBranch: overrides.featureBranch ?? 'eforge/test-prd',
    worktreeManager: {
      issuePr: async () => ({ url: 'https://github.com/owner/repo/pull/99' }),
      leaveBranch: async () => {},
    } as unknown as PhaseContext['worktreeManager'],
    failedMerges: new Set<string>(),
    recentlyMergedIds: [],
    landingSucceeded: false,
    modelTracker: new ModelTracker(),
    maxValidationRetries: 0,
    minCompletionPercent: 0,
    gapClosePerformed: false,
    shouldCleanup: true,
    cleanupPlanSet: 'plan-set',
    cleanupOutputDir: '.eforge/output',
    landingAction: 'pr',
    ...overrides,
  } as PhaseContext;
}

async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function providerResult(command: string, args: string[], stdout = ''): ProviderCommandResult {
  return { command, args, stdout, stderr: '', exitCode: 0 };
}

function makeStackProvider(prUrl: string): StackProviderAdapter {
  return {
    requireAvailable: async () => {},
    trackBranch: async (_cwd, base) => providerResult('git-spice', ['branch', 'track', '--base', base]),
    submitBranch: async () => providerResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
    submitStack: async () => providerResult('git-spice', ['stack', 'submit']),
    syncRepo: async () => providerResult('git-spice', ['repo', 'sync']),
    restackBranch: async () => providerResult('git-spice', ['branch', 'restack']),
    restackStack: async () => providerResult('git-spice', ['stack', 'restack']),
    upstackOnto: async (_cwd, target) => providerResult('git-spice', ['upstack', 'onto', target]),
    commandPreview: (argv) => ({ command: 'git-spice', args: argv }),
    syncRepoPreview: () => ({ command: 'git-spice', args: ['repo', 'sync'] }),
    restackStackPreview: () => ({ command: 'git-spice', args: ['stack', 'restack'] }),
    parsePrUrl: (stdout) => stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0],
    isValidPrUrl: (url) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url),
    redactMessage: (message) => message,
  };
}

// ---------------------------------------------------------------------------
// finalize / stackLanding — commitSha refresh and landing metadata
// ---------------------------------------------------------------------------

describe('artifact finalization after landing', () => {
  const makeTempDir = useTempDir('eforge-artifact-finalize-flow-');

  it('refreshes the artifact commitSha from the feature branch after generic PR cleanup commits', async () => {
    const cwd = makeTempDir();
    const featureBranch = 'eforge/prd-generic-finalize';
    const preCleanupSha = await setupFeatureBranchWithCleanupFile(cwd, featureBranch);
    await upsertArtifact(cwd, makeRecord('prd-generic-finalize', {
      artifactBranch: featureBranch,
      commitSha: preCleanupSha,
      landingAction: 'pr',
    }));

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      featureBranch,
      prdId: 'prd-generic-finalize',
      landingAction: 'pr',
    });

    const events = await collectEvents(finalize(ctx));
    const featureBranchSha = await getRefSha(cwd, featureBranch);
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-generic-finalize');

    expect(events).toContainEqual(expect.objectContaining({ type: 'cleanup:complete', planSet: 'plan-set' }));
    expect(record?.commitSha).toBe(featureBranchSha);
    expect(record?.commitSha).not.toBe(preCleanupSha);
    expect(record?.landingStatus).toBe('complete');
    expect(record?.prUrl).toBe('https://github.com/owner/repo/pull/99');
  });

  it('preserves the pre-landing commitSha when cleanup leaves the merge worktree dirty', async () => {
    const cwd = makeTempDir();
    const featureBranch = 'eforge/prd-dirty-finalize';
    const preCleanupSha = await setupFeatureBranchWithCleanupFile(cwd, featureBranch);
    await writeFile(join(cwd, 'dirty-untracked.txt'), 'not committed\n', 'utf-8');
    await upsertArtifact(cwd, makeRecord('prd-dirty-finalize', {
      artifactBranch: featureBranch,
      commitSha: preCleanupSha,
      landingAction: 'pr',
    }));

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      featureBranch,
      prdId: 'prd-dirty-finalize',
      landingAction: 'pr',
    });

    await collectEvents(finalize(ctx));
    const featureBranchSha = await getRefSha(cwd, featureBranch);
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-dirty-finalize');

    expect(featureBranchSha).not.toBe(preCleanupSha);
    expect(record?.commitSha).toBe(preCleanupSha);
    expect(record?.landingStatus).toBe('complete');
  });

  it('refreshes generic merge artifacts from the feature branch instead of the base-branch merge SHA', async () => {
    const cwd = makeTempDir();
    const featureBranch = 'eforge/prd-generic-merge-finalize';
    const preCleanupSha = await setupFeatureBranchWithCleanupFile(cwd, featureBranch);
    await upsertArtifact(cwd, makeRecord('prd-generic-merge-finalize', {
      artifactBranch: featureBranch,
      commitSha: preCleanupSha,
      landingAction: 'merge',
    }));

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      featureBranch,
      prdId: 'prd-generic-merge-finalize',
      landingAction: 'merge',
      engineConfig: { build: { allowLocalMergeToTrunk: true } } as unknown as PhaseContext['engineConfig'],
      worktreeManager: {
        mergeToBase: async () => 'base-branch-merge-sha',
      } as unknown as PhaseContext['worktreeManager'],
    });

    const events = await collectEvents(finalize(ctx));
    const featureBranchSha = await getRefSha(cwd, featureBranch);
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-generic-merge-finalize');

    expect(events).toContainEqual(expect.objectContaining({ type: 'landing:complete', action: 'merge', commitSha: 'base-branch-merge-sha' }));
    expect(record?.commitSha).toBe(featureBranchSha);
    expect(record?.commitSha).not.toBe('base-branch-merge-sha');
    expect(record?.commitSha).not.toBe(preCleanupSha);
    expect(record?.landingStatus).toBe('complete');
    expect(record?.prUrl).toBeUndefined();
  });

  it('records complete landing metadata for generic leave without requiring a PR URL', async () => {
    const cwd = makeTempDir();
    const featureBranch = 'eforge/prd-generic-leave-finalize';
    const preLandingSha = await setupFeatureBranchWithCleanupFile(cwd, featureBranch);
    await upsertArtifact(cwd, makeRecord('prd-generic-leave-finalize', {
      artifactBranch: featureBranch,
      commitSha: preLandingSha,
      landingAction: 'leave',
    }));

    let leaveCalled = false;
    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      featureBranch,
      prdId: 'prd-generic-leave-finalize',
      landingAction: 'leave',
      worktreeManager: {
        leaveBranch: async () => { leaveCalled = true; },
      } as unknown as PhaseContext['worktreeManager'],
    });

    await collectEvents(finalize(ctx));
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-generic-leave-finalize');

    expect(leaveCalled).toBe(true);
    expect(record?.commitSha).toBe(preLandingSha);
    expect(record?.landingStatus).toBe('complete');
    expect(record?.prUrl).toBeUndefined();
  });

  it('refreshes the artifact commitSha and PR URL after stacked PR cleanup commits', async () => {
    const cwd = makeTempDir();
    const featureBranch = 'eforge/prd-stacked-finalize';
    const prUrl = 'https://github.com/owner/repo/pull/123';
    const preCleanupSha = await setupFeatureBranchWithCleanupFile(cwd, featureBranch);
    await upsertArtifact(cwd, makeRecord('prd-stacked-finalize', {
      artifactBranch: featureBranch,
      commitSha: preCleanupSha,
      landingAction: 'pr',
    }));

    const now = new Date().toISOString();
    const stackContext: StackBaseContext = {
      prdId: 'prd-stacked-finalize',
      stackId: 'stack-finalize',
      provider: 'git-spice',
      branch: featureBranch,
      baseBranch: 'main',
    };
    await upsertStackLayer(cwd, {
      ...stackContext,
      artifact: { branch: featureBranch, commitSha: preCleanupSha },
      landingAction: 'pr',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      featureBranch,
      prdId: 'prd-stacked-finalize',
      stackContext,
      stackProvider: makeStackProvider(prUrl),
      landingAction: 'pr',
    });

    const events = await collectEvents(stackLanding(ctx));
    const featureBranchSha = await getRefSha(cwd, featureBranch);
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-stacked-finalize');

    expect(events).toContainEqual(expect.objectContaining({ type: 'cleanup:complete', planSet: 'plan-set' }));
    expect(record?.commitSha).toBe(featureBranchSha);
    expect(record?.commitSha).not.toBe(preCleanupSha);
    expect(record?.landingStatus).toBe('complete');
    expect(record?.prUrl).toBe(prUrl);
  });

  it('records skipped landing metadata when stacked landing is bypassed by an earlier build failure', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertArtifact(cwd, makeRecord('prd-stacked-skip'));
    const stackContext: StackBaseContext = {
      prdId: 'prd-stacked-skip',
      stackId: 'stack-skip',
      provider: 'git-spice',
      branch: 'eforge/prd-stacked-skip',
      baseBranch: 'main',
    };
    await upsertStackLayer(cwd, {
      ...stackContext,
      artifact: { branch: stackContext.branch, commitSha: 'initial-sha' },
      landingAction: 'pr',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'prd-stacked-skip',
      stackContext,
      stackProvider: makeStackProvider('https://github.com/owner/repo/pull/999'),
      state: { status: 'failed', plans: { 'plan-a': { status: 'failed', dependsOn: [] } }, completedPlans: [] },
    });

    await collectEvents(stackLanding(ctx));

    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-stacked-skip');
    expect(record?.landingStatus).toBe('skipped');
    expect(record?.landingFailureReason).toBe('Build failed before landing could be attempted');
    expect(hasUsableArtifact(registry, 'prd-stacked-skip')).toBe(true);
  });

  it('records failed landing metadata when stacked PR provider submission fails', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertArtifact(cwd, makeRecord('prd-stacked-provider-fail'));
    const stackContext: StackBaseContext = {
      prdId: 'prd-stacked-provider-fail',
      stackId: 'stack-provider-fail',
      provider: 'git-spice',
      branch: 'eforge/prd-stacked-provider-fail',
      baseBranch: 'main',
    };
    await upsertStackLayer(cwd, {
      ...stackContext,
      artifact: { branch: stackContext.branch, commitSha: 'initial-sha' },
      landingAction: 'pr',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'prd-stacked-provider-fail',
      stackContext,
      stackProvider: {
        ...makeStackProvider('https://github.com/owner/repo/pull/999'),
        trackBranch: async () => { throw new Error('git-spice: branch track failed'); },
      },
    });

    const events = await collectEvents(stackLanding(ctx));

    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-stacked-provider-fail');
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:landing:update', status: 'failed' }));
    expect(record?.landingStatus).toBe('failed');
    expect(record?.landingFailureReason).toContain('git-spice: branch track failed');
    expect(hasUsableArtifact(registry, 'prd-stacked-provider-fail')).toBe(true);
  });

  it('records skipped landing metadata when a final-merge policy gate blocks landing', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-policy-skip', { landingAction: 'merge' }));

    const ctx = makePhaseContext({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'prd-policy-skip',
      landingAction: 'merge',
      shouldCleanup: false,
      worktreeManager: {
        getFinalMergeDiff: async () => ({ files: [] }),
      } as unknown as PhaseContext['worktreeManager'],
      extensionRegistry: {
        policyGates: [{
          kind: 'policyGate',
          extensionName: 'test-extension',
          extensionPath: '/test/extension.js',
          value: (async () => ({ decision: 'block', reason: 'blocked for test' })) as never,
          gateKind: 'final-merge',
          method: 'beforeFinalMerge',
          registrationIndex: 0,
        }],
      },
    });

    await collectEvents(finalize(ctx));

    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((build) => build.prdId === 'prd-policy-skip');
    expect(record?.landingStatus).toBe('skipped');
    expect(record?.landingFailureReason).toContain('Policy gate blocked final merge');
    expect(record?.landingFailureReason).toContain('blocked for test');
    expect(hasUsableArtifact(registry, 'prd-policy-skip')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateArtifactRecord — commitSha refresh and landing metadata
// ---------------------------------------------------------------------------

describe('updateArtifactRecord — commitSha refresh after cleanup commits', () => {
  const makeTempDir = useTempDir('eforge-artifact-finalization-');

  it('reflects a cleanup commit when commitSha is updated', async () => {
    const cwd = makeTempDir();
    await initGitRepo(cwd);

    const initialSha = await getCurrentSha(cwd);
    await upsertArtifact(cwd, makeRecord('prd-cleanup', { commitSha: initialSha }));

    // Simulate a cleanup commit on the feature branch.
    await writeFile(join(cwd, 'cleanup.txt'), 'cleanup content\n');
    await execAsync('git', ['add', '.'], { cwd });
    await execAsync('git', ['commit', '-m', 'cleanup commit'], { cwd });
    const cleanupSha = await getCurrentSha(cwd);

    // Update artifact commitSha to reflect the cleanup commit.
    await updateArtifactRecord(cwd, 'prd-cleanup', { commitSha: cleanupSha });

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].commitSha).toBe(cleanupSha);
    expect(registry.builds[0].commitSha).not.toBe(initialSha);
    // hasUsableArtifact must still return true.
    expect(hasUsableArtifact(registry, 'prd-cleanup')).toBe(true);
  });

  it('does not replace commitSha when skipping SHA refresh (dirty worktree scenario)', async () => {
    const cwd = makeTempDir();
    await initGitRepo(cwd);

    const preLandingSha = await getCurrentSha(cwd);
    await upsertArtifact(cwd, makeRecord('prd-dirty', { commitSha: preLandingSha }));

    // Do NOT call updateArtifactRecord with a new SHA — simulates the case
    // where getWorktreeDirtyFiles returned non-empty files so SHA refresh was skipped.
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds[0].commitSha).toBe(preLandingSha);
    // hasUsableArtifact still true even when SHA was not refreshed.
    expect(hasUsableArtifact(registry, 'prd-dirty')).toBe(true);
  });
});

describe('updateArtifactRecord — landing failure preserves usable artifact', () => {
  const makeTempDir = useTempDir('eforge-artifact-landing-failure-');

  it('records landingStatus: failed while hasUsableArtifact remains true', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-failed-landing'));

    await updateArtifactRecord(cwd, 'prd-failed-landing', {
      landingStatus: 'failed',
      landingFailureReason: 'gh pr create: authentication required',
      landingCompletedAt: new Date().toISOString(),
    });

    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds[0];
    expect(record.landingStatus).toBe('failed');
    expect(record.landingFailureReason).toBe('gh pr create: authentication required');
    // The pre-landing artifact record is preserved — dependency validation can still accept it.
    expect(hasUsableArtifact(registry, 'prd-failed-landing')).toBe(true);
  });

  it('records landingStatus: skipped while hasUsableArtifact remains true', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-skipped-landing'));

    await updateArtifactRecord(cwd, 'prd-skipped-landing', {
      landingStatus: 'skipped',
      landingFailureReason: 'Build failed before landing could be attempted',
      landingCompletedAt: new Date().toISOString(),
    });

    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds[0];
    expect(record.landingStatus).toBe('skipped');
    // hasUsableArtifact remains true — landing outcome does not affect dependency readiness.
    expect(hasUsableArtifact(registry, 'prd-skipped-landing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// upsertCompletion — completion index entries
// ---------------------------------------------------------------------------

describe('upsertCompletion — terminal outcome recording', () => {
  const makeTempDir = useTempDir('eforge-completion-');

  it('records a completed entry with artifactAvailable: true', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'prd-done',
      status: 'completed',
      artifactAvailable: true,
      artifactBranch: 'eforge/prd-done',
      completedAt: now,
      updatedAt: now,
    });

    const registry = await loadCompletionRegistry(cwd);
    const record = lookupCompletion(registry, 'prd-done');
    expect(record).toBeDefined();
    expect(record?.status).toBe('completed');
    expect(record?.artifactAvailable).toBe(true);
    expect(record?.artifactBranch).toBe('eforge/prd-done');
  });

  it('records a failed entry with artifactAvailable: false', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'prd-fail',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    const registry = await loadCompletionRegistry(cwd);
    const record = lookupCompletion(registry, 'prd-fail');
    expect(record?.status).toBe('failed');
    expect(record?.artifactAvailable).toBe(false);
  });

  it('records a skipped entry', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'prd-skip',
      status: 'skipped',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    const registry = await loadCompletionRegistry(cwd);
    const record = lookupCompletion(registry, 'prd-skip');
    expect(record?.status).toBe('skipped');
  });

  it('returns empty registry when file does not exist', async () => {
    const cwd = makeTempDir();
    const registry = await loadCompletionRegistry(cwd);
    expect(registry).toEqual({ version: 1, completions: {} });
  });

  it('writes a registry to disk and creates intermediate directories', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await saveCompletionRegistry(cwd, {
      version: 1,
      completions: {
        'prd-saved': {
          prdId: 'prd-saved',
          status: 'completed',
          artifactAvailable: true,
          artifactBranch: 'eforge/prd-saved',
          completedAt: now,
          updatedAt: now,
        },
      },
    });

    const registry = await loadCompletionRegistry(cwd);
    expect(lookupCompletion(registry, 'prd-saved')).toEqual(expect.objectContaining({
      prdId: 'prd-saved',
      status: 'completed',
      artifactAvailable: true,
      artifactBranch: 'eforge/prd-saved',
    }));
  });

  it('returns empty registry when completions.json contains invalid JSON', async () => {
    const cwd = makeTempDir();
    await mkdir(join(cwd, '.eforge', 'artifacts'), { recursive: true });
    await writeFile(completionRegistryPath(cwd), 'not json {{{', 'utf-8');

    await expect(loadCompletionRegistry(cwd)).resolves.toEqual({ version: 1, completions: {} });
  });

  it('returns empty registry when completions.json fails schema validation', async () => {
    const cwd = makeTempDir();
    await mkdir(join(cwd, '.eforge', 'artifacts'), { recursive: true });
    await writeFile(completionRegistryPath(cwd), JSON.stringify({ version: 99, completions: {} }), 'utf-8');

    await expect(loadCompletionRegistry(cwd)).resolves.toEqual({ version: 1, completions: {} });
  });

  it('overwrites an existing entry for the same prdId', async () => {
    const cwd = makeTempDir();
    const now = new Date().toISOString();
    await upsertCompletion(cwd, {
      prdId: 'prd-overwrite',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });
    await upsertCompletion(cwd, {
      prdId: 'prd-overwrite',
      status: 'completed',
      artifactAvailable: true,
      completedAt: now,
      updatedAt: now,
    });

    const registry = await loadCompletionRegistry(cwd);
    const record = lookupCompletion(registry, 'prd-overwrite');
    expect(record?.status).toBe('completed');
    expect(record?.artifactAvailable).toBe(true);
    // Only one entry per prdId.
    expect(Object.keys(registry.completions)).toHaveLength(1);
  });

  it('completionRegistryPath returns the expected path', () => {
    expect(completionRegistryPath('/projects/my-project')).toBe(
      '/projects/my-project/.eforge/artifacts/completions.json',
    );
  });
});

// ---------------------------------------------------------------------------
// updateArtifactRecord — no-op when record absent
// ---------------------------------------------------------------------------

describe('updateArtifactRecord — absent record handling', () => {
  const makeTempDir = useTempDir('eforge-artifact-absent-');

  it('returns an unchanged registry when no record exists for prdId', async () => {
    const cwd = makeTempDir();
    await upsertArtifact(cwd, makeRecord('prd-exists'));

    const result = await updateArtifactRecord(cwd, 'prd-nonexistent', {
      landingStatus: 'complete',
    });

    // Only the existing record should be in the registry.
    expect(result.builds).toHaveLength(1);
    expect(result.builds[0].prdId).toBe('prd-exists');
    expect(result.builds[0].landingStatus).toBeUndefined();
  });

  it('is safe to call when the registry file does not exist', async () => {
    const cwd = makeTempDir();
    // No registry written — should not throw.
    const result = await updateArtifactRecord(cwd, 'prd-ghost', {
      landingStatus: 'complete',
    });
    expect(result.builds).toHaveLength(0);
  });
});
