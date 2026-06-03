// --- eforge:region orchestration-validation-gates-suite ---
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

describe('validation no-command policy', () => {
  it('fails closed when all plans are merged and no validation commands or waiver are configured', async () => {
    const state = makeState({});
    const config = makeConfig({ plans: [] });
    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: {} as unknown as WorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
    };

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) events.push(event);

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:start', commands: [] }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:complete', passed: false }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'landing:skipped', reason: 'No validation commands configured and no waiver' }));
  });

  it('passes with an explicit no-command waiver and surfaces the waiver reason', async () => {
    const state = makeState({});
    const config = makeConfig({ plans: [] });
    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: {} as unknown as WorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'leave' as const,
      modelTracker: new ModelTracker(),
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'CI handles validation', allowEmptyPrdDiff: false },
    };

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) events.push(event);

    expect(ctx.state.status).not.toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'planning:progress', message: 'Validation waiver (allowNoCommands): CI handles validation' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:complete', passed: true }));
  });
});

describe('post-gap rerun sequencing', () => {
  const makeTempDir = useTempDir();

  it('reruns validate then prdValidate after gap_close:complete passed=true before artifact recording', async () => {



    let prdValidateCallCount = 0;

    const state = makeState({});
    const config = makeConfig({ plans: [] });

    const ctx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: {} as unknown as WorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),

      validationPolicy: { allowNoCommands: true, noCommandsReason: 'CI handles this', allowEmptyPrdDiff: false },
      gapCloser: async function* () {
        yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: true } as EforgeEvent;
      },
      prdValidator: async function* () {
        prdValidateCallCount++;
        if (prdValidateCallCount === 1) {

          yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps: [{ requirement: 'Feature X', explanation: 'Not implemented', complexity: 'moderate' as const }], completionPercent: 80 } as EforgeEvent;
        } else {

          yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
          yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: true, verdicts: [{ criterion: 'Feature X present', verdict: 'pass', evidence: 'Implementation found in src/feature.ts' }], source: 'prd' as const } as EforgeEvent;
        }
      },
    };

    const allEvents: EforgeEvent[] = [];


    for await (const event of validate(ctx)) {
      allEvents.push(event);
    }
    expect(ctx.state.status).not.toBe('failed');


    for await (const event of prdValidate(ctx)) {
      allEvents.push(event);
    }

    expect(ctx.gapClosePerformed).toBe(true);
    expect(ctx.state.status).not.toBe('failed');


    for await (const event of validate(ctx)) {
      allEvents.push(event);
    }
    expect(ctx.state.status).not.toBe('failed');


    for await (const event of prdValidate(ctx)) {
      allEvents.push(event);
    }
    expect(ctx.state.status).not.toBe('failed');
    expect(prdValidateCallCount).toBe(2);


    const validationCompletes = allEvents.filter((e) => e.type === 'validation:complete');
    expect(validationCompletes).toHaveLength(2);


    const prdCompletes = allEvents.filter((e) => e.type === 'prd_validation:complete');
    expect(prdCompletes).toHaveLength(2);
    expect((prdCompletes[0] as Extract<EforgeEvent, { type: 'prd_validation:complete' }>).passed).toBe(false);
    expect((prdCompletes[1] as Extract<EforgeEvent, { type: 'prd_validation:complete' }>).passed).toBe(true);


    const gapCloseComplete = allEvents.find((e) => e.type === 'gap_close:complete');
    expect(gapCloseComplete).toBeDefined();
    expect((gapCloseComplete as Extract<EforgeEvent, { type: 'gap_close:complete' }>).passed).toBe(true);
  });

  it('exercises the actual Orchestrator.execute ordering after a successful gap close', async () => {
    const repoRoot = makeTempDir();
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoRoot });
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: repoRoot });

    let prdValidateCallCount = 0;
    const orchestrator = new Orchestrator({
      repoRoot,
      mergeWorktreePath: repoRoot,
      planRunner: async function* () {},
      landingAction: 'leave',
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'CI handles this', allowEmptyPrdDiff: false },
      gapCloser: async function* () {
        yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: true } as EforgeEvent;
      },
      prdValidator: async function* () {
        prdValidateCallCount++;
        if (prdValidateCallCount === 1) {
          yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps: [{ requirement: 'Feature X', explanation: 'Not implemented', complexity: 'moderate' as const }], completionPercent: 80 } as EforgeEvent;
        } else {
          yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
          yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: true, verdicts: [{ criterion: 'Feature X present', verdict: 'pass', evidence: 'Implementation found in src/feature.ts' }], source: 'prd' as const } as EforgeEvent;
        }
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of orchestrator.execute(makeConfig({ plans: [] }))) events.push(event);

    const orderedTypes = events
      .filter((event) => ['validation:complete', 'prd_validation:complete', 'gap_close:complete', 'acceptance_validation:complete'].includes(event.type))
      .map((event) => event.type);
    expect(orderedTypes).toEqual([
      'validation:complete',
      'prd_validation:complete',
      'gap_close:complete',
      'validation:complete',
      'prd_validation:complete',
      'acceptance_validation:complete',
    ]);
    expect(prdValidateCallCount).toBe(2);
  });
});

describe('gap-close: clean review does not bypass acceptance gate', () => {
  const makeTempDir = useTempDir('eforge-gap-close-');

  it('acceptance gate fails when prd passes with no acceptance_validation:complete, even after a clean review cycle', async () => {
    const tempDir = makeTempDir();


    const harness = new StubHarness([{ text: '<review-issues></review-issues>' }]);
    const planId = 'plan-gap-close';
    const review = { strategy: 'single' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
    const orchConfig = makeConfig({
      plans: [{ id: planId, name: 'Gap Close Plan', dependsOn: [], branch: 'feature/gap-close', build: ['review-cycle'], review }],
    });
    const planFile = {
      id: planId,
      name: 'Gap Close Plan',
      dependsOn: [],
      branch: 'feature/gap-close',
      body: '# Plan\n\nTest plan.\n',
      filePath: `${tempDir}/plan.md`,
    };

    const buildCtx: BuildStageContext = {
      agentRuntimes: singletonRegistry(harness),
      config: DEFAULT_CONFIG,
      pipeline: TEST_PIPELINE,
      tracing: createNoopTracingContext(),
      cwd: tempDir,
      planSetName: 'gap-close',
      sourceContent: '',
      modelTracker: new ModelTracker(),
      plans: [planFile],
      expeditionModules: [],
      moduleBuildConfigs: new Map(),
      planId,
      worktreePath: tempDir,
      planFile,
      orchConfig,
      planEntry: orchConfig.plans[0],
      reviewIssues: [],
      build: ['review-cycle'],
      review,
    };

    const reviewEvents: EforgeEvent[] = [];
    for await (const event of getBuildStage('review-cycle')(buildCtx)) {
      reviewEvents.push(event);
    }


    expect(buildCtx.reviewIssues).toEqual([]);
    const cycleTerminated = reviewEvents.find(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' &&
        (e as Extract<EforgeEvent, { type: 'plan:build:decision' }>).decision.kind === 'cycle-terminated',
    );
    expect(cycleTerminated).toBeDefined();
    expect((cycleTerminated!.decision as { reason: string }).reason).toBe('no-issues');


    const state = makeState({});
    const config = makeConfig({ plans: [] });
    const prdCtx: PhaseContext = {
      state,
      config,
      repoRoot: '/tmp/repo',
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: {} as unknown as WorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'leave' as const,
      modelTracker: new ModelTracker(),
      validationPolicy: { allowNoCommands: true, noCommandsReason: 'CI handles validation', allowEmptyPrdDiff: false },
      prdValidator: async function* () {
        yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;

      },
    };

    const prdEvents: EforgeEvent[] = [];
    for await (const event of prdValidate(prdCtx)) {
      prdEvents.push(event);
    }


    expect(prdCtx.state.status).toBe('failed');

    expect(prdEvents).toContainEqual(expect.objectContaining({
      type: 'acceptance_validation:complete',
      passed: false,
    }));
  });
});

describe('prdValidate — no-validator acceptance gate', () => {
  function makeBaseCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
    const state = makeState({});
    return {
      state,
      config: makeConfig({ plans: [] }),
      repoRoot: '/tmp/repo',
      planRunner: async function* () {},
      parallelism: 1,
      postMergeCommands: [],
      validateCommands: [],
      maxValidationRetries: 0,
      minCompletionPercent: 0,
      gapClosePerformed: false,
      mergeWorktreePath: '/tmp/merge-worktree',
      featureBranch: state.featureBranch,
      worktreeManager: {} as unknown as WorktreeManager,
      failedMerges: new Set(),
      recentlyMergedIds: [],
      landingSucceeded: false,
      landingAction: 'merge' as const,
      modelTracker: new ModelTracker(),
      ...overrides,
    };
  }

  it('fails build when expectedAcceptanceCriteria is defined and no prdValidator is configured', async () => {
    const ctx = makeBaseCtx({
      expectedAcceptanceCriteria: [
        { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      ],
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:start' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:complete', passed: false }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: false }));
    const progress = events.find(
      (e) => e.type === 'planning:progress' && 'message' in e &&
      (e as { message: string }).message.includes('no PRD validator configured'),
    );
    expect(progress).toBeDefined();
  });

  it('does nothing (no gate) when expectedAcceptanceCriteria is undefined and no prdValidator', async () => {
    const ctx = makeBaseCtx({

    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(events).toHaveLength(0);
    expect(ctx.state.status).not.toBe('failed');
  });

  it('passes build when expectedAcceptanceCriteria is defined and allowNoAcceptanceCriteria waiver is active with a non-empty reason', async () => {
    const ctx = makeBaseCtx({
      expectedAcceptanceCriteria: [
        { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      ],
      validationPolicy: {
        allowNoAcceptanceCriteria: true,
        noAcceptanceCriteriaReason: 'Exploratory build; criteria defined post-hoc',
        allowNoCommands: false,
        allowEmptyPrdDiff: false,
        allowNoCommittedChanges: false,
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).not.toBe('failed');

    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:complete', passed: true }));

    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect((acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).passed).toBe(true);
    const waivers = (acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).waivers;
    expect(waivers).toBeDefined();
    expect(waivers).toContain('Exploratory build; criteria defined post-hoc');
  });

  it('fails build when expectedAcceptanceCriteria is an empty array and no prdValidator is configured', async () => {
    const ctx = makeBaseCtx({
      expectedAcceptanceCriteria: [],
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:start' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:complete', passed: false }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: false }));
    const progress = events.find(
      (e) => e.type === 'planning:progress' && 'message' in e &&
      (e as { message: string }).message.includes('no PRD validator configured'),
    );
    expect(progress).toBeDefined();
  });

  it('passes build when expectedAcceptanceCriteria is an empty array and allowNoAcceptanceCriteria waiver is active with a non-empty reason', async () => {
    const ctx = makeBaseCtx({
      expectedAcceptanceCriteria: [],
      validationPolicy: {
        allowNoAcceptanceCriteria: true,
        noAcceptanceCriteriaReason: 'No plan-level criteria defined; waived for this build',
        allowNoCommands: false,
        allowEmptyPrdDiff: false,
        allowNoCommittedChanges: false,
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).not.toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:complete', passed: true }));
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect((acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).passed).toBe(true);
    const waivers = (acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).waivers;
    expect(waivers).toBeDefined();
    expect(waivers).toContain('No plan-level criteria defined; waived for this build');
  });

  it('derives expected criteria from real PRD markdown and enforces them in the acceptance gate', async () => {

    const prdMarkdown = `
# My Feature PRD

## Acceptance Criteria

- Add login page with username and password
- Support OAuth via Google
- All existing tests pass
`.trim();

    const derived = extractExpectedAcceptanceCriteria(prdMarkdown);

    expect(derived).toHaveLength(3);
    expect(derived[0]).toMatchObject({ id: 'ac-001', text: 'Add login page with username and password' });
    expect(derived[1]).toMatchObject({ id: 'ac-002', text: 'Support OAuth via Google' });
    expect(derived[2]).toMatchObject({ id: 'ac-003', text: 'All existing tests pass' });



    const ctx = makeBaseCtx({
      expectedAcceptanceCriteria: derived,
      prdValidator: async function* () {
        yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
        yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
        yield {
          type: 'acceptance_validation:complete',
          timestamp: new Date().toISOString(),
          passed: true,
          verdicts: [
            { criterion: 'ac-001', verdict: 'pass', evidence: 'Login page found.' },
            { criterion: 'ac-002', verdict: 'pass', evidence: 'OAuth implemented.' },
          ],
          source: 'prd',
        } as EforgeEvent;
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);


    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typed = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typed.passed).toBe(false);

    const unknownVerdict = typed.verdicts.find((v) => v.verdict === 'unknown');
    expect(unknownVerdict).toBeDefined();
    expect(unknownVerdict!.evidence).toContain('ac-003');
  });
});
// --- eforge:endregion orchestration-validation-gates-suite ---
