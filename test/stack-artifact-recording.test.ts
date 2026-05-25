import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
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
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'No validation commands for artifact recording test', allowEmptyPrdDiff: false },
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
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'No validation commands for artifact recording test', allowEmptyPrdDiff: false },
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

  // --- eforge:region plan-03-parser-and-committed-work-hardening ---
  it('does not write builds.json after a no-committed-diff merge failure (no-op plan without waiver)', async () => {
    // When mergePlan() throws because the builtOnMerge plan has no committed changes
    // (and allowNoCommittedChanges is not set), executePlans() marks state.status='failed'.
    // recordArtifact() must then short-circuit without writing the artifact registry.
    const cwd = await repo();
    const state: EforgeState = {
      setName: 'no-op-prd',
      status: 'failed', // Simulates the state after a no-committed-diff merge failure
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/no-op-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'failed', branch: 'plan1', dependsOn: [], merged: false, error: 'no committed changes' },
      },
      completedPlans: [],
    };
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'no-op-prd',
      landingAction: 'merge' as const,
      featureBranch: 'eforge/no-op-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    // recordArtifact must emit nothing and write no artifact
    expect(events).toHaveLength(0);
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'no-op-prd')).toBeUndefined();
  });
  // --- eforge:endregion plan-03-parser-and-committed-work-hardening ---

  // --- eforge:region plan-04-committed-work-artifact-safety ---
  it('refuses to write builds.json when the merge worktree has dirty tracked files', async () => {
    const cwd = await repo();
    // Stage a file but do NOT commit it (dirty tracked)
    await writeFile(join(cwd, 'dirty-tracked.ts'), 'uncommitted changes\n');
    await exec('git', ['add', 'dirty-tracked.ts'], { cwd });

    const state: EforgeState = {
      setName: 'dirty-tracked-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/dirty-tracked-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    };
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'dirty-tracked-prd',
      landingAction: 'merge' as const,
      featureBranch: 'eforge/dirty-tracked-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    expect(state.status).toBe('failed');
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'dirty-tracked-prd')).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:error',
      source: 'stack:artifact-recording',
      message: expect.stringContaining('dirty-tracked-prd'),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'landing:skipped',
      reason: 'Stack artifact recording failed',
    }));
  });

  it('refuses to write builds.json when the merge worktree has untracked files', async () => {
    const cwd = await repo();
    // Write a file but do NOT add or commit it (untracked)
    await writeFile(join(cwd, 'untracked-impl.ts'), 'untracked content\n');

    const state: EforgeState = {
      setName: 'untracked-prd',
      status: 'running',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/untracked-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    };
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'untracked-prd',
      landingAction: 'leave' as const,
      featureBranch: 'eforge/untracked-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    expect(state.status).toBe('failed');
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'untracked-prd')).toBeUndefined();
    expect(existsSync(join(cwd, '.eforge', 'artifacts', 'builds.json'))).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:error',
      source: 'stack:artifact-recording',
      message: expect.stringContaining('untracked-impl.ts'),
    }));
  });
  // --- eforge:endregion plan-04-committed-work-artifact-safety ---

  // --- eforge:region plan-02-final-validation-gates ---
  it('yields nothing and does not write builds.json when state.status is failed', async () => {
    // Simulate a post-gap-close rerun where validation or acceptance failed,
    // leaving state.status=failed. recordArtifact must short-circuit so the
    // artifact registry is not written for a build that did not fully pass.
    const cwd = await repo();
    const state: EforgeState = {
      setName: 'failed-prd',
      status: 'failed',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/failed-prd',
      worktreeBase: cwd,
      plans: {
        plan1: { status: 'merged', branch: 'plan1', dependsOn: [], merged: true },
      },
      completedPlans: [],
    };
    const ctx = {
      state,
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      prdId: 'failed-prd',
      landingAction: 'merge' as const,
      featureBranch: 'eforge/failed-prd',
      config: { baseBranch: 'main' } as OrchestrationConfig,
    } as unknown as PhaseContext;

    const events = await collectRecordArtifactEvents(ctx);

    // No events emitted — recordArtifact short-circuits on failed state
    expect(events).toHaveLength(0);

    // Artifact registry must NOT have been written for this build
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'failed-prd')).toBeUndefined();
  });

  it('does not write builds.json when the post-gap acceptance rerun fails', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/rerun-failed-prd'], { cwd });
    let prdValidateCallCount = 0;
    const config = {
      name: 'rerun-failed-prd',
      description: 'test',
      created: new Date().toISOString(),
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: [],
      plans: [],
    } as unknown as OrchestrationConfig;
    const orchestrator = new Orchestrator({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      planRunner: async function* () {},
      prdId: 'rerun-failed-prd',
      landingAction: 'leave',
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'No validation commands for artifact recording test', allowEmptyPrdDiff: false },
      gapCloser: async function* () {
        yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: true } as EforgeEvent;
      },
      prdValidator: async function* () {
        prdValidateCallCount++;
        if (prdValidateCallCount === 1) {
          yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps: [{ requirement: 'Feature X', explanation: 'Missing', complexity: 'moderate' as const }], completionPercent: 80 } as EforgeEvent;
          return;
        }
        yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
        yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Feature X present', verdict: 'unknown', evidence: 'Cannot verify from rerun diff' }], source: 'prd' } as EforgeEvent;
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of orchestrator.execute(config)) events.push(event);

    expect(prdValidateCallCount).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: false }));
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'rerun-failed-prd')).toBeUndefined();
  });

  it('does not write builds.json when the post-gap deterministic validation rerun fails', async () => {
    const cwd = await repo();
    await exec('git', ['branch', 'eforge/rerun-command-failed-prd'], { cwd });
    let prdValidateCallCount = 0;
    const config = {
      name: 'rerun-command-failed-prd',
      description: 'test',
      created: new Date().toISOString(),
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: [],
      plans: [],
    } as unknown as OrchestrationConfig;
    const orchestrator = new Orchestrator({
      repoRoot: cwd,
      mergeWorktreePath: cwd,
      planRunner: async function* () {},
      prdId: 'rerun-command-failed-prd',
      landingAction: 'leave',
      validateCommands: [
        'if [ -f .eforge/validation-rerun-marker ]; then exit 1; else mkdir -p .eforge && touch .eforge/validation-rerun-marker; fi',
      ],
      gapCloser: async function* () {
        yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: true } as EforgeEvent;
      },
      prdValidator: async function* () {
        prdValidateCallCount++;
        yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps: [{ requirement: 'Feature X', explanation: 'Missing', complexity: 'moderate' as const }], completionPercent: 80 } as EforgeEvent;
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of orchestrator.execute(config)) events.push(event);

    expect(prdValidateCallCount).toBe(1);
    expect(events.filter((event) => event.type === 'validation:complete')).toEqual([
      expect.objectContaining({ passed: true }),
      expect.objectContaining({ passed: false }),
    ]);
    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds.find((b) => b.prdId === 'rerun-command-failed-prd')).toBeUndefined();
  });
  // --- eforge:endregion plan-02-final-validation-gates ---
});
