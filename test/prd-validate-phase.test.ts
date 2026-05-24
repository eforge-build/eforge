import { describe, it, expect } from 'vitest';
import { prdValidate } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { useTempDir } from './test-tmpdir.js';

const TEST_PIPELINE = {
  planner: { enabled: true },
  reviewer: { enabled: true },
  defaultBuild: ['implement', 'review-cycle'],
  defaultReview: { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const },
  rationale: 'test pipeline',
};

function makeState(): EforgeState {
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    baseBranch: 'main',
    featureBranch: 'eforge/test-set',
    worktreeBase: '/tmp/worktrees',
    plans: {},
    completedPlans: [],
  };
}

function makeConfig(): OrchestrationConfig {
  return {
    name: 'test-set',
    description: 'test',
    created: '2026-01-01T00:00:00Z',
    mode: 'excursion',
    baseBranch: 'main',
    pipeline: TEST_PIPELINE,
    plans: [],
  };
}

function makeCtx(stateDir: string, prdValidator: PhaseContext['prdValidator']): PhaseContext {
  const stubWorktreeManager = {
    acquireForPlan: async () => '/tmp/fake-worktree',
    releaseForPlan: async () => {},
    mergePlan: async () => 'abc123',
    reconcile: async () => ({ valid: [], recovered: [], orphaned: [] }),
  } as unknown as WorktreeManager;

  const state = makeState();
  return {
    state,
    config: makeConfig(),
    stateDir,
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
    worktreeManager: stubWorktreeManager,
    failedMerges: new Set(),
    recentlyMergedIds: [],
    landingSucceeded: false, landingAction: 'merge' as const,
    resumed: false,
    modelTracker: new ModelTracker(),
    prdValidator,
  };
}

// --- eforge:region plan-02-final-validation-gates ---
describe('prdValidate phase — acceptance gate', () => {
  const makeTempDir = useTempDir();

  it('fails build when prd passes but acceptance_validation:complete is absent', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      // No acceptance_validation:complete emitted
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('Acceptance'));
    expect(progress).toBeDefined();
  });

  it('fails build when acceptance_validation:complete has passed=false', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Must support login', verdict: 'fail', evidence: 'Not found' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
  });

  it('fails build when acceptance_validation:complete claims passed=true but includes an unknown verdict', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: true, verdicts: [{ criterion: 'Must support login', verdict: 'unknown', evidence: 'Cannot verify login from diff' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'planning:progress', message: expect.stringContaining('Acceptance criteria validation failed') }));
  });

  it('succeeds when prd passes and acceptance_validation:complete has passed=true with only pass verdicts', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: true, verdicts: [{ criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).not.toBe('failed');
  });
});

describe('prdValidate phase — gap close strict handling', () => {
  const makeTempDir = useTempDir();

  it('fails build when gap_close:complete has passed=false', async () => {
    const stateDir = makeTempDir();
    const gaps = [{ requirement: 'Must do X', explanation: 'X not done', complexity: 'moderate' as const }];
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps, completionPercent: 80 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.gapCloser = async function* () {
      yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: false } as EforgeEvent;
    };

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
    expect(ctx.gapClosePerformed).toBe(false);
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('Gap closing failed'));
    expect(progress).toBeDefined();
  });

  it('fails build when gap closer emits no terminal event', async () => {
    const stateDir = makeTempDir();
    const gaps = [{ requirement: 'Must do X', explanation: 'X not done', complexity: 'moderate' as const }];
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps, completionPercent: 80 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.gapCloser = async function* () {
      yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
      // No gap_close:complete emitted
    };

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
    expect(ctx.gapClosePerformed).toBe(false);
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('Gap closing failed'));
    expect(progress).toBeDefined();
  });

  it('fails build when gap closer throws after starting', async () => {
    const stateDir = makeTempDir();
    const gaps = [{ requirement: 'Must do X', explanation: 'X not done', complexity: 'moderate' as const }];
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps, completionPercent: 80 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.gapCloser = async function* () {
      yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
      throw new Error('gap closer backend failed');
    };

    for await (const _ of prdValidate(ctx)) {
      // drain
    }

    expect(ctx.state.status).toBe('failed');
    expect(ctx.gapClosePerformed).toBe(false);
  });

  it('sets gapClosePerformed when gap_close:complete has passed=true', async () => {
    const stateDir = makeTempDir();
    const gaps = [{ requirement: 'Must do X', explanation: 'X not done', complexity: 'moderate' as const }];
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: false, gaps, completionPercent: 80 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.gapCloser = async function* () {
      yield { type: 'gap_close:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'gap_close:complete', timestamp: new Date().toISOString(), passed: true } as EforgeEvent;
    };

    for await (const _ of prdValidate(ctx)) {
      // drain
    }

    expect(ctx.gapClosePerformed).toBe(true);
    expect(ctx.state.status).not.toBe('failed');
  });
});
// --- eforge:endregion plan-02-final-validation-gates ---

describe('prdValidate phase error propagation', () => {
  const makeTempDir = useTempDir();

  it('yields a failing prd_validation:complete when the validator throws a non-abort error', async () => {
    // Regression: a thrown PRD validator must fail the build. The outer build
    // loop in eforge.ts derives final status from events — if only plan:progress
    // is yielded, the earlier validation:complete verdict stands and the build
    // is silently reported as completed.
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      throw new Error('loadPrompt(prd-validator.md): unresolved template variables: foo, bar');
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    const complete = events.find((e) => e.type === 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete).toMatchObject({ type: 'prd_validation:complete', passed: false });
    const gaps = (complete as Extract<EforgeEvent, { type: 'prd_validation:complete' }>).gaps;
    expect(gaps).toHaveLength(1);
    expect(gaps[0].explanation).toContain('unresolved template variables');

    const progress = events.find((e) => e.type === 'planning:progress');
    expect(progress).toBeDefined();
    expect((progress as Extract<EforgeEvent, { type: 'planning:progress' }>).message)
      .toContain('PRD validation failed');

    expect(ctx.state.status).toBe('failed');
    expect(ctx.state.completedAt).toBeDefined();
  });

  it('re-throws AbortError without yielding a prd_validation:complete', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };

    const ctx = makeCtx(stateDir, validator);
    await expect(async () => {
      for await (const _ of prdValidate(ctx)) {
        // drain
      }
    }).rejects.toMatchObject({ name: 'AbortError' });
  });
});
