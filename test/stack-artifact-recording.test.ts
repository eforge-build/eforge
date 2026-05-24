import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordSuccessfulBuildArtifact } from '@eforge-build/engine/stacking';
import { loadStackState, updateStackLayerLanding } from '@eforge-build/engine/stacking';
import { loadArtifactRegistry } from '@eforge-build/engine/artifacts';
import { Orchestrator, type PlanRunner } from '@eforge-build/engine/orchestrator';
import { recordArtifact } from '@eforge-build/engine/orchestrator/phases';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { StackBaseContext } from '@eforge-build/engine/stacking';

const exec = promisify(execFile);

async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-artifact-'));
  await exec('git', ['init', '-b', 'main'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  await writeFile(join(cwd, 'README.md'), 'hello\n');
  await exec('git', ['add', '.'], { cwd });
  await exec('git', ['commit', '-m', 'initial'], { cwd });
  await writeFile(join(cwd, 'feature.txt'), 'feature\n');
  await exec('git', ['add', '.'], { cwd });
  await exec('git', ['commit', '-m', 'feature'], { cwd });
  return cwd;
}

async function collectRecordArtifactEvents(ctx: PhaseContext): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of recordArtifact(ctx)) {
    events.push(event);
  }
  return events;
}

describe('recordSuccessfulBuildArtifact', () => {
  it('records the stack layer before landing starts in the orchestrator pipeline', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/queued-prd'], { cwd });
    const stackContext: StackBaseContext = {
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      provider: 'git-spice',
      branch: 'eforge/queued-prd',
      baseBranch: 'main',
    };
    const config = {
      name: 'queued-prd',
      description: 'test',
      created: new Date().toISOString(),
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: [],
      plans: [],
    } as unknown as OrchestrationConfig;
    const planRunner: PlanRunner = async function* () {};
    const orchestrator = new Orchestrator({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      planRunner,
      prdId: stackContext.prdId,
      stackContext,
      landingAction: 'leave',
    });

    const events: EforgeEvent[] = [];
    for await (const event of orchestrator.execute(config)) events.push(event);

    const recordedIndex = events.findIndex((event) => event.type === 'stack:layer:recorded');
    const landingStartIndex = events.findIndex((event) => event.type === 'landing:start');
    expect(recordedIndex).toBeGreaterThanOrEqual(0);
    expect(landingStartIndex).toBeGreaterThanOrEqual(0);
    expect(recordedIndex).toBeLessThan(landingStartIndex);
  });

  it('writes the non-stacked artifact registry record before landing starts in the orchestrator pipeline', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/non-stacked-prd'], { cwd });
    const config = {
      name: 'non-stacked-prd',
      description: 'test',
      created: new Date().toISOString(),
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: [],
      plans: [],
    } as unknown as OrchestrationConfig;
    const planRunner: PlanRunner = async function* () {};
    const orchestrator = new Orchestrator({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      planRunner,
      prdId: 'non-stacked-prd',
      landingAction: 'leave',
    });

    let sawLandingStart = false;
    let registryRecordExistedAtLandingStart = false;
    for await (const event of orchestrator.execute(config)) {
      if (event.type === 'landing:start') {
        sawLandingStart = true;
        const registry = await loadArtifactRegistry(cwd);
        registryRecordExistedAtLandingStart = registry.builds.some(
          (record) => record.prdId === 'non-stacked-prd' && record.status === 'built',
        );
      }
    }

    expect(sawLandingStart).toBe(true);
    expect(registryRecordExistedAtLandingStart).toBe(true);
  });

  it('writes durable stack layer artifact metadata for a queued PRD', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const stackContext: StackBaseContext = {
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      parentPrdId: 'parent-prd',
      provider: 'git-spice',
      branch: 'eforge/queued-prd',
      baseBranch: 'eforge/parent-prd',
    };

    const event = await recordSuccessfulBuildArtifact({
      cwd,
      mergeWorktreePath: cwd,
      stackContext,
      landingAction: 'leave',
    });

    expect(event).toEqual(expect.objectContaining({
      type: 'stack:layer:recorded',
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      branch: 'eforge/queued-prd',
      baseBranch: 'eforge/parent-prd',
      status: 'built',
    }));

    const state = await loadStackState(cwd);
    const layer = state.layers.find((entry) => entry.prdId === 'queued-prd');
    expect(layer).toEqual(expect.objectContaining({
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      parentPrdId: 'parent-prd',
      branch: 'eforge/queued-prd',
      baseBranch: 'eforge/parent-prd',
      status: 'built',
      landingAction: 'leave',
    }));
    expect(layer?.artifact).toEqual({ branch: 'eforge/queued-prd', commitSha });

    const raw = await readFile(join(cwd, '.eforge', 'stacks', 'layers.json'), 'utf-8');
    expect(raw).toContain('queued-prd');
    expect(raw).toContain(commitSha);
  });

  it('preserves existing landing record when re-recording the artifact on retry', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const stackContext: StackBaseContext = {
      prdId: 'retry-prd',
      stackId: 'stack-retry',
      provider: 'git-spice',
      branch: 'eforge/retry-prd',
      baseBranch: 'main',
    };

    // First recording
    await recordSuccessfulBuildArtifact({
      cwd,
      mergeWorktreePath: cwd,
      stackContext,
      landingAction: 'pr',
    });

    // Simulate a landing that completed
    const now = new Date().toISOString();
    await updateStackLayerLanding(cwd, 'retry-prd', {
      action: 'pr',
      status: 'complete',
      prUrl: 'https://github.com/owner/repo/pull/42',
      startedAt: now,
      completedAt: now,
    });

    // Retry artifact recording (e.g., after a partial failure and re-run)
    await recordSuccessfulBuildArtifact({
      cwd,
      mergeWorktreePath: cwd,
      stackContext,
      landingAction: 'pr',
    });

    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'retry-prd');
    // Landing persisted from the first run must survive the artifact re-record
    expect(layer?.landing?.status).toBe('complete');
    expect(layer?.landing?.prUrl).toBe('https://github.com/owner/repo/pull/42');
    // Artifact is updated with the current HEAD
    expect(layer?.artifact?.commitSha).toBe(commitSha);
  });

  it('does not record a stack artifact when the build was aborted before artifact recording', async () => {
    const cwd = await repo();
    const stackContext: StackBaseContext = {
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      provider: 'git-spice',
      branch: 'eforge/queued-prd',
      baseBranch: 'main',
    };
    const controller = new AbortController();
    controller.abort();
    const state = {
      setName: 'queued-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/queued-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      stackContext,
      signal: controller.signal,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    expect(events).toHaveLength(0);
    expect((await loadStackState(cwd)).layers).toHaveLength(0);
  });

  it('does not record a stack artifact until all plans are merged', async () => {
    const cwd = await repo();
    const stackContext: StackBaseContext = {
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      provider: 'git-spice',
      branch: 'eforge/queued-prd',
      baseBranch: 'main',
    };
    const state = {
      setName: 'queued-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/queued-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'completed', branch: 'plan1', dependsOn: [], merged: false },
      },
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      stackContext,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    expect(events).toHaveLength(0);
    expect((await loadStackState(cwd)).layers).toHaveLength(0);
  });

  it('marks the phase failed and skips landing when artifact recording fails', async () => {
    const cwd = await repo();
    const stackContext: StackBaseContext = {
      prdId: 'queued-prd',
      stackId: 'stack-queued',
      provider: 'git-spice',
      branch: 'eforge/queued-prd',
      baseBranch: 'main',
    };
    const state = {
      setName: 'queued-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/queued-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: join(cwd, 'missing-worktree'),
      stackContext,
      prdId: 'queued-prd',
      landingAction: 'leave',
      featureBranch: 'eforge/queued-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    expect(state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:error',
      source: 'stack:artifact-recording',
      message: expect.stringContaining("queued-prd"),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'landing:skipped',
      reason: 'Stack artifact recording failed',
    }));
  });
});

// ---------------------------------------------------------------------------
// Artifact registry integration: non-stacked and stacked builds
// ---------------------------------------------------------------------------

describe('recordArtifact — artifact registry writes', () => {
  it('writes to the artifact registry for a non-stacked queued build', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const state = {
      setName: 'non-stacked-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/non-stacked-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'non-stacked-prd',
      // No stackContext — this is a non-stacked queued build.
      landingAction: 'merge' as const,
      featureBranch: 'eforge/non-stacked-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    // No stack:layer:recorded event — no stackContext
    expect(events.some((e) => e.type === 'stack:layer:recorded')).toBe(false);

    // But the artifact registry must have the entry
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((b) => b.prdId === 'non-stacked-prd');
    expect(record).toBeDefined();
    expect(record?.status).toBe('built');
    expect(record?.artifactBranch).toBe('eforge/non-stacked-prd');
    expect(record?.commitSha).toBe(commitSha);
    expect(record?.landingAction).toBe('merge');
  });

  it('writes to both artifact registry AND stack layer for a stacked queued build', async () => {
    const cwd = await repo();
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    const commitSha = stdout.trim();
    const stackContext: StackBaseContext = {
      prdId: 'stacked-prd',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/stacked-prd',
      baseBranch: 'main',
    };
    const state = {
      setName: 'stacked-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/stacked-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      stackContext,
      prdId: 'stacked-prd',
      landingAction: 'pr' as const,
      featureBranch: 'eforge/stacked-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    // stack:layer:recorded event is yielded for stacked builds
    expect(events.some((e) => e.type === 'stack:layer:recorded')).toBe(true);

    // Artifact registry also has the entry
    const registry = await loadArtifactRegistry(cwd);
    const record = registry.builds.find((b) => b.prdId === 'stacked-prd');
    expect(record).toBeDefined();
    expect(record?.status).toBe('built');
    expect(record?.artifactBranch).toBe('eforge/stacked-prd');
    expect(record?.commitSha).toBe(commitSha);

    // Stack layer projection also written
    const stackState = await loadStackState(cwd);
    const layer = stackState.layers.find((l) => l.prdId === 'stacked-prd');
    expect(layer).toBeDefined();
    expect(layer?.status).toBe('built');
  });
});
