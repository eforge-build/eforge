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

// --- eforge:region plan-02-engine-acceptance-gates ---
describe('prdValidate phase — expectedAcceptanceCriteria synthesis', () => {
  const makeTempDir = useTempDir();

  it('augments acceptance_validation:complete with unknown verdicts for missing criteria', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      // Validator only covers one of two criteria
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [{ criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Build should fail — ac-002 has no verdict and gets synthesized as unknown
    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const verdicts = (acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).verdicts;
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({ criterion: 'Must support login', verdict: 'pass' });
    expect(verdicts[1]).toMatchObject({ criterion: 'Must support OAuth', verdict: 'unknown' });
  });

  it('passes when all expected criteria have pass verdicts', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [
          { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
          { criterion: 'Must support OAuth', verdict: 'pass', evidence: 'OAuth flow found in src/auth.ts' },
        ],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).not.toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const verdicts = (acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).verdicts;
    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.verdict === 'pass')).toBe(true);
  });

  it('fails build when no prdValidator is configured and expectedAcceptanceCriteria is defined', async () => {
    const stateDir = makeTempDir();
    const ctx = makeCtx(stateDir, undefined);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).toBe('failed');
    const progress = events.find(
      (e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('no PRD validator configured'),
    );
    expect(progress).toBeDefined();
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect((acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).passed).toBe(false);
  });

  it('does nothing when no prdValidator and expectedAcceptanceCriteria is undefined', async () => {
    const stateDir = makeTempDir();
    const ctx = makeCtx(stateDir, undefined);
    // expectedAcceptanceCriteria is undefined — no gate

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
    expect(ctx.state.status).not.toBe('failed');
  });

  it('passes build when acceptance_validation:complete uses waivers field with unknown verdicts (empty-diff waiver metadata)', async () => {
    // Verifies that a prdValidator emitting acceptance evidence via the waivers field
    // (e.g., for an empty-diff allowEmptyPrdDiff scenario) passes the gate, and
    // that evidence does NOT need to say "Waiver: ..." in the evidence text.
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'No implementation diff to evaluate (waived).' }],
        waivers: ['Config-only change; no source diff expected'],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    expect(ctx.state.status).not.toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typedAcceptance = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typedAcceptance.passed).toBe(true);
    // The waiver reason must be in the waivers field — not embedded in evidence text
    expect(typedAcceptance.waivers).toBeDefined();
    expect(typedAcceptance.waivers).toContain('Config-only change; no source diff expected');
    // Evidence must NOT use the legacy "Waiver: ..." pattern
    expect(typedAcceptance.verdicts[0].evidence).not.toMatch(/^Waiver:/i);
  });

  it('fails build when validator returns a generic passing verdict that does not match any expected criterion', async () => {
    // Verifies that a generic pass verdict like "Acceptance criteria satisfied" does NOT
    // count as covering specific expected criteria — each criterion must be matched by text.
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        // Generic verdict whose criterion text does not match either expected item
        verdicts: [{ criterion: 'Acceptance criteria satisfied', verdict: 'pass', evidence: 'All criteria met.' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Both expected criteria are unmatched — synthesized as unknown → build fails
    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const verdicts = (acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).verdicts;
    // The generic verdict is preserved plus two synthesized unknown verdicts
    const loginVerdict = verdicts.find((v) => v.criterion === 'Must support login');
    const oauthVerdict = verdicts.find((v) => v.criterion === 'Must support OAuth');
    expect(loginVerdict).toBeDefined();
    expect(loginVerdict!.verdict).toBe('unknown');
    expect(oauthVerdict).toBeDefined();
    expect(oauthVerdict!.verdict).toBe('unknown');
  });

  it('fails build when validator returns explicit fail/unknown verdicts for expected criteria even when validator emits passed:true', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        // Validator claims passed:true, but verdicts include fail and unknown
        passed: true,
        verdicts: [
          { criterion: 'Must support login', verdict: 'fail', evidence: 'Login component not found in diff.' },
          { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot determine OAuth support from diff alone.' },
        ],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Gate recomputes result — non-passing verdicts override validator's passed:true
    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typedAcceptance = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typedAcceptance.passed).toBe(false);
    const failVerdict = typedAcceptance.verdicts.find((v) => v.criterion === 'Must support login');
    const unknownVerdict = typedAcceptance.verdicts.find((v) => v.criterion === 'Must support OAuth');
    expect(failVerdict!.verdict).toBe('fail');
    expect(unknownVerdict!.verdict).toBe('unknown');
  });

  it('passes build when explicit non-passing verdicts for expected criteria are covered by a non-empty waiver', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: false,
        verdicts: [
          { criterion: 'Must support login', verdict: 'fail', evidence: 'Login component not found.' },
          { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot determine OAuth support.' },
        ],
        waivers: ['Auth is out of scope for this iteration; deferred to follow-up'],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Non-empty waiver overrides the non-passing verdicts
    expect(ctx.state.status).not.toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typedAcceptance = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typedAcceptance.passed).toBe(true);
    expect(typedAcceptance.waivers).toBeDefined();
    expect(typedAcceptance.waivers).toContain('Auth is out of scope for this iteration; deferred to follow-up');
  });

  it('fails build when expected criteria have non-passing verdicts and waivers contain only whitespace', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: false,
        verdicts: [
          { criterion: 'Must support login', verdict: 'fail', evidence: 'Login component not found.' },
        ],
        waivers: ['   '],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Whitespace-only waiver must not be treated as a valid waiver
    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typedAcceptance = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typedAcceptance.passed).toBe(false);
  });

  it('does not synthesize unknown verdicts when validator references expected criteria by stable ID', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [
          { criterion: 'ac-001', verdict: 'pass', evidence: 'Login component found at src/login.ts.' },
          { criterion: 'ac-002', verdict: 'pass', evidence: 'OAuth flow implemented at src/oauth.ts.' },
        ],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [
      { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Verdicts matched by ID — no unknown synthesis — build passes
    expect(ctx.state.status).not.toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    const typedAcceptance = acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(typedAcceptance.passed).toBe(true);
    // No synthesized unknowns — only the two verdicts the validator returned
    expect(typedAcceptance.verdicts).toHaveLength(2);
    expect(typedAcceptance.verdicts.every((v) => v.verdict === 'pass')).toBe(true);
  });
});
// --- eforge:endregion plan-02-engine-acceptance-gates ---

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
