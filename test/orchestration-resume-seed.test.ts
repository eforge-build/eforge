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

describe('applyResumeSeed — resume state seeding', () => {
  it('seeds a merged dependency and leaves dependents pending', () => {
    const config = {
      name: 'test-set',
      baseBranch: 'main',
      mode: 'excursion' as const,
      plans: makePlans([
        { id: 'plan-01' },
        { id: 'plan-02', dependsOn: ['plan-01'] },
      ]),
      pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: TEST_REVIEW },
    };
    const { state } = initializeState(config, '/tmp/repo');
    expect(state.plans['plan-01'].status).toBe('pending');
    expect(state.plans['plan-02'].status).toBe('pending');

    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-01'].merged).toBe(true);
    expect(state.completedPlans).toContain('plan-01');

    expect(state.plans['plan-02'].status).toBe('pending');
    expect(state.plans['plan-02'].merged).toBe(false);
  });

  it('seeds multiple merged plans from a graph with one failed and one blocked', () => {
    const config = {
      name: 'test-set',
      baseBranch: 'main',
      mode: 'excursion' as const,
      plans: makePlans([
        { id: 'plan-01' },
        { id: 'plan-02', dependsOn: ['plan-01'] },
        { id: 'plan-03', dependsOn: ['plan-02'] },
      ]),
      pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: TEST_REVIEW },
    };
    const { state } = initializeState(config, '/tmp/repo');


    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01'],
      resumeContextByPlan: new Map([
        ['plan-02', 'Resume context for plan-02'],
        ['plan-03', 'Resume context for plan-03'],
      ]),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-01'].merged).toBe(true);

    expect(state.plans['plan-02'].status).toBe('pending');
    expect(state.plans['plan-03'].status).toBe('pending');
  });

  it('handles a completed-but-unmerged plan conservatively (stays pending)', () => {
    const config = {
      name: 'test-set',
      baseBranch: 'main',
      mode: 'excursion' as const,
      plans: makePlans([{ id: 'plan-01' }]),
      pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: TEST_REVIEW },
    };
    const { state } = initializeState(config, '/tmp/repo');


    const seed: ResumeSeedOptions = {
      seededMerged: [],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('pending');
    expect(state.plans['plan-01'].merged).toBe(false);
  });

  it('silently ignores plan IDs from seed that are not in state.plans', () => {
    const config = {
      name: 'test-set',
      baseBranch: 'main',
      mode: 'excursion' as const,
      plans: makePlans([{ id: 'plan-01' }]),
      pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: TEST_REVIEW },
    };
    const { state } = initializeState(config, '/tmp/repo');


    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-99'],
      resumeContextByPlan: new Map(),
    };

    expect(() => applyResumeSeed(state, seed)).not.toThrow();
    expect(state.plans['plan-01'].status).toBe('pending');
  });

  it('seeds all plans as merged when the whole graph completed', () => {
    const config = {
      name: 'test-set',
      baseBranch: 'main',
      mode: 'excursion' as const,
      plans: makePlans([
        { id: 'plan-01' },
        { id: 'plan-02', dependsOn: ['plan-01'] },
      ]),
      pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: TEST_REVIEW },
    };
    const { state } = initializeState(config, '/tmp/repo');

    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01', 'plan-02'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-02'].status).toBe('merged');
    expect(state.completedPlans).toContain('plan-01');
    expect(state.completedPlans).toContain('plan-02');
  });
});
