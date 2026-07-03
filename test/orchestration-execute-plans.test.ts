// --- eforge:region orchestration-execute-plans-suite ---
// Split from orchestration-logic.test.ts.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { propagateFailure, shouldSkipMerge, computeMaxConcurrency, executePlans, finalize, validate, prdValidate, recordArtifact } from '@eforge-build/engine/orchestrator/phases';
import { extractExpectedAcceptanceCriteria } from '@eforge-build/engine/validation/acceptance-criteria';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { initializeState, applyResumeSeed, type ResumeSeedOptions, Orchestrator } from '@eforge-build/engine/orchestrator';
import type { PlanRunner } from '@eforge-build/engine/orchestrator';
import type { EforgeState, EforgeEvent, OrchestrationConfig, PlanState } from '@eforge-build/engine/events';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { createBuildTerminalFailureTracker } from '@eforge-build/engine/terminal-failure';
import type { PolicyGateKind, PolicyGateMethod, PolicyGateRegistration } from '@eforge-build/engine/extensions/types';
import { useTempDir } from './test-tmpdir.js';
import { getBuildStage, type BuildStageContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { StubHarness } from './stub-harness.js';



function makeState(
  plans: Record<string, Partial<PlanState> & { status: PlanState['status'] }>,
  overrides?: Partial<EforgeState>,
): EforgeState {
  const fullPlans: Record<string, PlanState> = {};
  for (const [id, partial] of Object.entries(plans)) {
    fullPlans[id] = {
      status: partial.status,
      branch: partial.branch ?? `feature/${id}`,
      dependsOn: partial.dependsOn ?? [],
      merged: partial.merged ?? false,
      error: partial.error,
    };
  }
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    baseBranch: 'main',
    featureBranch: overrides?.featureBranch ?? 'eforge/test-set',
    worktreeBase: '/tmp/worktrees',
    plans: fullPlans,
    completedPlans: [],
    ...overrides,
  };
}

const TEST_REVIEW = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const TEST_BUILD = ['implement', 'review-cycle'];

function makePolicyGate(
  gateKind: PolicyGateKind,
  method: PolicyGateMethod,
  value: PolicyGateRegistration['value'],
): PolicyGateRegistration {
  return {
    kind: 'policyGate',
    extensionName: 'test-policy',
    extensionPath: '/tmp/test-policy.js',
    value,
    gateKind,
    method,
    registrationIndex: 0,
  };
}

function makePlans(
  specs: Array<{ id: string; dependsOn?: string[] }>,
): OrchestrationConfig['plans'] {
  return specs.map((s) => ({
    id: s.id,
    name: s.id,
    dependsOn: s.dependsOn ?? [],
    branch: `feature/${s.id}`,
    build: TEST_BUILD,
    review: TEST_REVIEW,
  }));
}









const TEST_PIPELINE: PipelineComposition = {
  scope: 'excursion',
  compile: ['planner', 'plan-review-cycle'],
  defaultBuild: ['implement', 'review-cycle'],
  defaultReview: TEST_REVIEW,
  rationale: 'test pipeline',
};

function makeConfig(
  overrides?: Partial<OrchestrationConfig>,
): OrchestrationConfig {
  return {
    name: 'test-set',
    description: 'test',
    created: '2026-01-01T00:00:00Z',
    mode: 'excursion',
    baseBranch: 'main',
    pipeline: TEST_PIPELINE,
    plans: [
      { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      { id: 'plan-b', name: 'Plan B', dependsOn: ['plan-a'], branch: 'feature/plan-b', build: TEST_BUILD, review: TEST_REVIEW },
    ],
    ...overrides,
  };
}

describe('executePlans - build:failed handling', () => {
  const makeTempDir = useTempDir();

  it('marks plan as failed and blocks dependents when build:failed is yielded', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
        { id: 'plan-b', name: 'Plan B', dependsOn: ['plan-a'], branch: 'feature/plan-b', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });

    const state = initializeState(config, '/tmp/repo').state;


    const planRunner: PlanRunner = async function* (planId) {
      if (planId === 'plan-a') {
        yield { type: 'plan:build:failed', planId: 'plan-a', error: 'JSON parse error', timestamp: new Date().toISOString() } as EforgeEvent;
      }
    };


    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async () => 'abc123',
      reconcile: async () => ({ valid: [], recovered: [], orphaned: [] }),
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false, landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) {
      events.push(event);
    }
    for await (const event of finalize(ctx)) {
      events.push(event);
    }


    expect(state.plans['plan-a'].status).toBe('failed');

    expect(state.plans['plan-b'].status).toBe('blocked');

    expect(events.some((e) => e.type === 'plan:merge:start')).toBe(false);
    expect(events.some((e) => e.type === 'plan:merge:complete')).toBe(false);

    expect(events.some((e) => e.type === 'plan:build:failed' && e.planId === 'plan-a')).toBe(true);

    expect(state.status).toBe('failed');
  });

  it('blocks plan merge before mergePlan and propagates dependent failures', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
        { id: 'plan-b', name: 'Plan B', dependsOn: ['plan-a'], branch: 'feature/plan-b', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;
    let mergePlanCalls = 0;
    let getPlanDiffCalls = 0;
    let seenPolicyContext: { planId?: string; diff?: { files: Array<{ path: string; status: string }> } } | undefined;

    const planRunner: PlanRunner = async function* () {};
    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      getPlanDiff: async () => {
        getPlanDiffCalls++;
        return { files: [{ path: 'blocked.ts', status: 'modified' as const }] };
      },
      mergePlan: async () => { mergePlanCalls++; throw new Error('mergePlan must not be called'); },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false, landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      extensionRegistry: {
        policyGates: [makePolicyGate('plan-merge', 'beforePlanMerge', ((gateContext: unknown) => {
          seenPolicyContext = gateContext as typeof seenPolicyContext;
          return { decision: 'block', reason: 'protected paths changed' };
        }) as PolicyGateRegistration['value'])],
      },
      policyGateTimeoutMs: 5000,
      policyGateFailurePolicy: 'fail-closed',
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) events.push(event);

    expect(getPlanDiffCalls).toBe(1);
    expect(seenPolicyContext).toEqual(expect.objectContaining({
      planId: 'plan-a',
      diff: { files: [{ path: 'blocked.ts', status: 'modified' }] },
    }));
    expect(mergePlanCalls).toBe(0);
    expect(ctx.failedMerges.has('plan-a')).toBe(true);
    expect(state.plans['plan-a'].status).toBe('failed');
    expect(state.plans['plan-b'].status).toBe('blocked');
    expect(events).toContainEqual(expect.objectContaining({
      type: 'extension:policy:decision',
      gateKind: 'plan-merge',
      planId: 'plan-a',
      decision: 'block',
      reason: 'protected paths changed',
    }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plan:build:failed', planId: 'plan-a', error: expect.stringContaining('protected paths changed') }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'plan:build:failed', planId: 'plan-b' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plan:status:change', planId: 'plan-b', status: 'blocked' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plan:error:set', planId: 'plan-b', error: expect.stringContaining('plan-a') }));
  });

  it('keeps terminal failure evidence on the upstream failed plan when blocking a dependency chain', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
        { id: 'plan-b', name: 'Plan B', dependsOn: ['plan-a'], branch: 'feature/plan-b', build: TEST_BUILD, review: TEST_REVIEW },
        { id: 'plan-c', name: 'Plan C', dependsOn: ['plan-b'], branch: 'feature/plan-c', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;
    const blockedError = 'Blocked by failed dependency: plan-a';

    const planRunner: PlanRunner = async function* (planId) {
      if (planId === 'plan-a') {
        yield { type: 'plan:build:failed', planId: 'plan-a', error: 'upstream build failed', timestamp: new Date().toISOString() } as EforgeEvent;
      }
    };

    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async () => 'abc123',
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false, landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
    };

    const events: EforgeEvent[] = [];
    const tracker = createBuildTerminalFailureTracker('run-chain');
    let status: 'completed' | 'failed' = 'completed';
    let summary = 'Build completed';
    for await (const event of executePlans(ctx)) {
      events.push(event);
      tracker.observe(event);
      if (event.type === 'plan:build:failed') {
        status = 'failed';
        summary = event.error.startsWith('Merge failed') ? `Merge failed for ${event.planId}` : `Build failed for ${event.planId}`;
      }
    }
    const terminalFailure = tracker.toEvent(status, summary);
    if (terminalFailure) events.push(terminalFailure);
    const phaseEnd = {
      type: 'phase:end',
      runId: 'run-chain',
      result: { status, summary },
      timestamp: new Date().toISOString(),
    } as EforgeEvent;
    events.push(phaseEnd);

    const failedEvents = events.filter((e): e is Extract<EforgeEvent, { type: 'plan:build:failed' }> => e.type === 'plan:build:failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0].planId).toBe('plan-a');

    for (const planId of ['plan-b', 'plan-c']) {
      expect(events).toContainEqual(expect.objectContaining({ type: 'plan:status:change', planId, status: 'blocked' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'plan:error:set', planId, error: blockedError }));
    }

    expect(terminalFailure).toEqual(expect.objectContaining({
      type: 'build:terminal-failure',
      failure: expect.objectContaining({ scope: 'plan', planId: 'plan-a' }),
    }));
    expect(phaseEnd).toEqual(expect.objectContaining({
      result: expect.objectContaining({ status: 'failed', summary: 'Build failed for plan-a' }),
    }));
    expect((phaseEnd as Extract<EforgeEvent, { type: 'phase:end' }>).result.summary).not.toContain('plan-c');
  });

  it('blocks final merge before mergeToBase and marks final state failed', async () => {
    const repoRoot = makeTempDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot });

    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, repoRoot).state;
    state.plans['plan-a'].status = 'merged';
    state.plans['plan-a'].merged = true;
    let mergeToBaseCalls = 0;
    let getFinalMergeDiffCalls = 0;
    let seenPolicyContext: { featureBranch?: string; baseBranch?: string; planIds?: string[]; diff?: { files: Array<{ path: string; status: string }> } } | undefined;

    const stubWorktreeManager = {
      getFinalMergeDiff: async () => {
        getFinalMergeDiffCalls++;
        return { files: [{ path: 'blocked.ts', status: 'modified' as const }] };
      },
      mergeToBase: async () => { mergeToBaseCalls++; throw new Error('mergeToBase must not be called'); },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot,
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: ['plan-a'],
      landingSucceeded: false, landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      extensionRegistry: {
        policyGates: [makePolicyGate('final-merge', 'beforeFinalMerge', ((gateContext: unknown) => {
          seenPolicyContext = gateContext as typeof seenPolicyContext;
          return { decision: 'require-approval', reason: 'manual approval required' };
        }) as PolicyGateRegistration['value'])],
      },
      policyGateTimeoutMs: 5000,
      policyGateFailurePolicy: 'fail-closed',
    };

    const events: EforgeEvent[] = [];
    for await (const event of finalize(ctx)) events.push(event);

    expect(getFinalMergeDiffCalls).toBe(1);
    expect(seenPolicyContext).toEqual(expect.objectContaining({
      featureBranch: state.featureBranch,
      baseBranch: 'main',
      planIds: ['plan-a'],
      diff: { files: [{ path: 'blocked.ts', status: 'modified' }] },
    }));
    expect(mergeToBaseCalls).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'extension:policy:decision',
      gateKind: 'final-merge',
      featureBranch: state.featureBranch,
      baseBranch: 'main',
      decision: 'require-approval',
      reason: 'manual approval required',
    }));
    expect(events.filter((event) => event.type === 'merge:finalize:skipped')).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('manual approval required') }),
    ]);
    expect(state.status).toBe('failed');
  });

  it('clean no-op builtOnMerge (no committed diff, no waiver) fails merge and emits plan:build:failed', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;

    const planRunner: PlanRunner = async function* () {};

    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async () => {
        throw new Error(
          "builtOnMerge plan 'plan-a' has no committed changes since baseSha (deadbeef). " +
          "Either commit implementation work or configure allowNoCommittedChanges with a noCommittedChangesReason " +
          "in the validation policy.",
        );
      },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: ['echo validation-should-not-run'],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      prdId: 'no-op-prd',
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) events.push(event);
    for await (const event of validate(ctx)) events.push(event);
    for await (const event of recordArtifact(ctx)) events.push(event);

    expect(events.some((e) => e.type === 'plan:build:failed' && e.planId === 'plan-a')).toBe(true);

    expect(events.some((e) => e.type === 'validation:start')).toBe(false);
    expect(events.some((e) => e.type === 'stack:layer:recorded' || e.type === 'daemon:error')).toBe(false);
    expect(state.plans['plan-a'].status).toBe('failed');
    expect(state.status).toBe('failed');
  });

  it('clean no-op builtOnMerge with allowNoCommittedChanges waiver succeeds and emits planning:progress', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;

    const planRunner: PlanRunner = async function* () {};




    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async (_planId: string, _plan: unknown, opts: {
        allowNoCommittedChanges?: boolean;
        noCommittedChangesReason?: string;
        onNoCommittedChangesWaiver?: () => void;
      }) => {
        expect(opts.allowNoCommittedChanges).toBe(true);
        expect(opts.noCommittedChangesReason).toBe('Config-only change recorded in parent PR');
        opts.onNoCommittedChangesWaiver?.();
        return 'abc123';
      },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      validationPolicy: {
        allowNoCommands: false,
        allowEmptyPrdDiff: false,
        allowNoAcceptanceCriteria: false,
        allowNoCommittedChanges: true,
        noCommittedChangesReason: 'Config-only change recorded in parent PR',
      },
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) events.push(event);

    expect(state.plans['plan-a'].status).toBe('merged');
    expect(events.some((e) => e.type === 'plan:merge:complete' && e.planId === 'plan-a')).toBe(true);

    expect(events.some((e) =>
      e.type === 'planning:progress' &&
      (e as Extract<EforgeEvent, { type: 'planning:progress' }>).message.includes('allowNoCommittedChanges') &&
      (e as Extract<EforgeEvent, { type: 'planning:progress' }>).message.includes('Config-only change recorded in parent PR'),
    )).toBe(true);
  });

  it('clean no-op merge with per-plan allowNoOpMerge waiver succeeds without a global validation policy', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Residue Plan', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW, allowNoOpMerge: true },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;

    const planRunner: PlanRunner = async function* () {};

    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async (_planId: string, _plan: unknown, opts: {
        allowNoCommittedChanges?: boolean;
        noCommittedChangesReason?: string;
        onNoCommittedChangesWaiver?: () => void;
      }) => {
        expect(opts.allowNoCommittedChanges).toBe(true);
        expect(opts.noCommittedChangesReason).toContain('compiler residue plan');
        opts.onNoCommittedChangesWaiver?.();
        return 'abc123';
      },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) events.push(event);

    expect(state.plans['plan-a'].status).toBe('merged');
    expect(events.some((e) => e.type === 'plan:merge:complete' && e.planId === 'plan-a')).toBe(true);

    expect(events.some((e) =>
      e.type === 'planning:progress' &&
      (e as Extract<EforgeEvent, { type: 'planning:progress' }>).message.includes('allowNoOpMerge') &&
      (e as Extract<EforgeEvent, { type: 'planning:progress' }>).message.includes('compiler residue plan'),
    )).toBe(true);
  });

  it('dirty builtOnMerge merge failure emits plan:build:failed and does not emit validation:start', async () => {
    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });
    const state = initializeState(config, '/tmp/repo').state;


    const planRunner: PlanRunner = async function* () {};


    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async () => { throw new Error("builtOnMerge plan 'plan-a' has uncommitted changes in the merge worktree.\nCommit all implementation work before marking a plan complete.\nDirty files:\n M dirty-file.ts"); },
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: ['echo validation-should-not-run'],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      prdId: 'dirty-prd',
      prdValidator: async function* () {
        yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      },
    };

    const events: EforgeEvent[] = [];
    for await (const event of executePlans(ctx)) events.push(event);

    for await (const event of validate(ctx)) events.push(event);
    for await (const event of prdValidate(ctx)) events.push(event);
    for await (const event of recordArtifact(ctx)) events.push(event);


    expect(events.some((e) => e.type === 'plan:build:failed' && e.planId === 'plan-a')).toBe(true);

    expect(events.some((e) => e.type === 'validation:start')).toBe(false);
    expect(events.some((e) => e.type === 'prd_validation:start')).toBe(false);
    expect(events.some((e) => e.type === 'stack:layer:recorded' || e.type === 'daemon:error')).toBe(false);

    expect(state.status).toBe('failed');
    const pscA = events.filter((e): e is Extract<EforgeEvent, { type: 'plan:status:change' }> => e.type === 'plan:status:change' && 'planId' in e && (e as Extract<EforgeEvent, { type: 'plan:status:change' }>).planId === 'plan-a');
    const fi = pscA.findIndex((e) => e.status === 'failed');
    expect(fi).not.toBe(-1);
    expect(pscA.slice(fi + 1).some((e) => e.status === 'completed')).toBe(false);
  });

  it('promotes plan failure to run-level state.status without requiring finalize', async () => {



    const config = makeConfig({
      plans: [
        { id: 'plan-a', name: 'Plan A', dependsOn: [], branch: 'feature/plan-a', build: TEST_BUILD, review: TEST_REVIEW },
      ],
    });

    const state = initializeState(config, '/tmp/repo').state;

    const planRunner: PlanRunner = async function* () {
      yield { type: 'plan:build:failed', planId: 'plan-a', error: 'max turns', timestamp: new Date().toISOString() } as EforgeEvent;
    };

    const stubWorktreeManager = {
      acquireForPlan: async () => '/tmp/fake-worktree',
      releaseForPlan: async () => {},
      mergePlan: async () => 'abc123',
      reconcile: async () => ({ valid: [], recovered: [], orphaned: [] }),
    } as unknown as WorktreeManager;

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner,
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: stubWorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false, landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
    };

    for await (const _event of executePlans(ctx)) {

    }


    expect(state.status).toBe('failed');
    expect(state.completedAt).toBeDefined();
  });
});
// --- eforge:endregion orchestration-execute-plans-suite ---
