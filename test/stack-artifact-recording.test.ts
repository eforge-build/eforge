import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordSuccessfulBuildArtifact } from '@eforge-build/engine/stacking';
import { loadStackState } from '@eforge-build/engine/stacking';
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
      onSuccess: 'leave-branch',
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
      plans: {},
      completedPlans: [],
    } as EforgeState;
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: join(cwd, 'missing-worktree'),
      stackContext,
      prdId: 'queued-prd',
      landingAction: 'leave',
      onSuccess: 'leave-branch',
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
