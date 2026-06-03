import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prdValidate, validate } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { AcceptanceUnknownResolution } from '@eforge-build/engine/validation/acceptance-unknown-resolution';
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

function makeCtx(stateDir: string, prdValidator: PhaseContext['prdValidator'], overrides: Partial<PhaseContext> = {}): PhaseContext {
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
    ...overrides,
  };
}

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

  it('fails by default when non-passing verdicts include acceptanceConflicts', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false,
        verdicts: [{ criterion: 'ac-002', verdict: 'fail', evidence: 'packages/monitor-ui/src/lib/reducer/index.ts changed.' }],
        acceptanceConflicts: [{ criterion: 'ac-002', evidence: 'monitor-ui reducer needed to ignore the new event type.', conflictsWith: 'The new client event must type-check in all consumers.', scope: 'narrow', recommendedAction: 'revise_acceptance_criteria' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [{ id: 'ac-002', text: 'packages/monitor-ui/ must have zero modified files', raw: 'packages/monitor-ui/ must have zero modified files' }];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'planning:progress', message: expect.stringContaining('manual review required') }));
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete') as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(acceptance.acceptanceConflicts).toHaveLength(1);
    expect(acceptance.waivers).toBeUndefined();
  });

  it('auto-waives narrow acceptanceConflicts when policy allows it and deterministic validation passed', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false,
        verdicts: [{ criterion: 'ac-002', verdict: 'fail', evidence: 'packages/monitor-ui/src/lib/reducer/index.ts changed.' }],
        acceptanceConflicts: [{ criterion: 'ac-002', evidence: 'monitor-ui reducer needed to ignore the new event type.', conflictsWith: 'The new client event must type-check in all consumers.', scope: 'narrow', recommendedAction: 'revise_acceptance_criteria' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.expectedAcceptanceCriteria = [{ id: 'ac-002', text: 'packages/monitor-ui/ must have zero modified files', raw: 'packages/monitor-ui/ must have zero modified files' }];
    ctx.validationCommandEvidence = [{ command: 'pnpm type-check', exitCode: 0 }];
    ctx.validationPolicy = { allowNoCommands: false, allowEmptyPrdDiff: false, allowNoAcceptanceCriteria: false, acceptanceConflictPolicy: 'auto-waive-narrow', allowNoCommittedChanges: false };

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).not.toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete') as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>;
    expect(acceptance.passed).toBe(true);
    expect(acceptance.waivers?.[0]).toContain('Acceptance criterion conflict (ac-002)');
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

describe('prdValidate phase — validationCommandEvidence plumbing', () => {
  const makeTempDir = useTempDir();

  it('validate resets command evidence on retry and retains only the final attempt', async () => {
    const stateDir = makeTempDir();
    const ctx = makeCtx(stateDir, async function* () {});
    ctx.mergeWorktreePath = stateDir;
    ctx.state.plans = { 'plan-01': { status: 'merged', merged: true } as unknown as EforgeState['plans'][string] };
    ctx.validateCommands = [
      'if [ -f .validation-attempt ]; then exit 0; else touch .validation-attempt; exit 1; fi',
    ];
    ctx.maxValidationRetries = 1;
    ctx.validationFixer = async function* () {};

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) {
      events.push(event);
    }

    expect(events.filter((e) => e.type === 'validation:complete')).toHaveLength(2);
    expect(ctx.validationCommandEvidence).toHaveLength(1);
    expect(ctx.validationCommandEvidence![0].exitCode).toBe(0);
    expect(ctx.validationCommandEvidence![0].output).not.toContain('exit 1');
  });

  it('passes validationCommandEvidence from PhaseContext to the prdValidator callback', async () => {
    const stateDir = makeTempDir();
    let capturedContext: { validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }> } | undefined;

    const validator: PhaseContext['prdValidator'] = async function* (
      _cwd: string,
      context?: { validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }> },
    ) {
      capturedContext = context;
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [{ criterion: 'pnpm type-check passes', verdict: 'pass', evidence: 'Confirmed by exit code 0' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.validationCommandEvidence = [
      { command: 'pnpm type-check', exitCode: 0, output: 'No errors found' },
    ];

    for await (const _ of prdValidate(ctx)) {
      // drain
    }

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.validationCommandEvidence).toBeDefined();
    expect(capturedContext!.validationCommandEvidence).toHaveLength(1);
    expect(capturedContext!.validationCommandEvidence![0].command).toBe('pnpm type-check');
    expect(capturedContext!.validationCommandEvidence![0].exitCode).toBe(0);
  });

  it('passes undefined context when validationCommandEvidence is not set', async () => {
    const stateDir = makeTempDir();
    let capturedContext: unknown = 'not-called';

    const validator: PhaseContext['prdValidator'] = async function* (
      _cwd: string,
      context?: { validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }> },
    ) {
      capturedContext = context;
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: true,
        verdicts: [{ criterion: 'Must support login', verdict: 'pass', evidence: 'Found' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    // validationCommandEvidence is NOT set on ctx

    for await (const _ of prdValidate(ctx)) {
      // drain
    }

    // When ctx.validationCommandEvidence is undefined, the callback receives undefined context
    expect(capturedContext).toBeUndefined();
  });

  it('still fails build when unknown verdicts emitted even with passing validationCommandEvidence', async () => {
    const stateDir = makeTempDir();
    const validator: PhaseContext['prdValidator'] = async function* () {
      yield { type: 'prd_validation:start', timestamp: new Date().toISOString() } as EforgeEvent;
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      // Unknown verdict — fail-closed even when validation commands passed
      yield {
        type: 'acceptance_validation:complete',
        timestamp: new Date().toISOString(),
        passed: false,
        verdicts: [{ criterion: 'Must support login', verdict: 'unknown', evidence: 'Cannot determine from diff alone' }],
        source: 'prd',
      } as EforgeEvent;
    };

    const ctx = makeCtx(stateDir, validator);
    ctx.validationCommandEvidence = [
      { command: 'pnpm type-check', exitCode: 0, output: 'No errors' },
      { command: 'pnpm test', exitCode: 0, output: 'All tests pass' },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) {
      events.push(event);
    }

    // Unknown verdict must still fail the build regardless of passing commands
    expect(ctx.state.status).toBe('failed');
    const acceptance = events.find((e) => e.type === 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect((acceptance as Extract<EforgeEvent, { type: 'acceptance_validation:complete' }>).passed).toBe(false);
  });
});

describe('prdValidate phase — acceptance unknown resolver', () => {
  const makeTempDir = useTempDir();

  function initCleanGitRepo(dir: string): void {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  }

  function validatorWithUnknown(): PhaseContext['prdValidator'] {
    return async function* () {
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Must report success', verdict: 'unknown', evidence: 'Diff was inconclusive' }], source: 'prd' } as EforgeEvent;
    };
  }

  it('invokes resolver and converts an expected unknown to pass with evidence', async () => {
    const repo = makeTempDir();
    initCleanGitRepo(repo);
    let calls = 0;
    const resolver: PhaseContext['acceptanceUnknownResolver'] = async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> {
      calls++;
      return [{ criterion: 'ac-001', verdict: 'pass', evidence: { type: 'file', path: 'src/a.ts', excerpt: 'success branch exists' } }];
    };
    const ctx = makeCtx(makeTempDir(), validatorWithUnknown(), {
      mergeWorktreePath: repo,
      validationCommandEvidence: [{ command: 'pnpm type-check', exitCode: 0 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: resolver,
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(calls).toBe(1);
    expect(ctx.state.status).not.toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: true }));
  });

  it('does not invoke resolver when an explicit acceptance verdict fails', async () => {
    let calls = 0;
    const ctx = makeCtx(makeTempDir(), async function* () {
      yield { type: 'prd_validation:complete', timestamp: new Date().toISOString(), passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
      yield { type: 'acceptance_validation:complete', timestamp: new Date().toISOString(), passed: false, verdicts: [{ criterion: 'Must report success', verdict: 'fail', evidence: 'Missing' }], source: 'prd' } as EforgeEvent;
    }, {
      validationCommandEvidence: [{ command: 'pnpm type-check', exitCode: 0 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> { calls++; return []; },
    });

    for await (const _ of prdValidate(ctx)) { /* drain */ }

    expect(calls).toBe(0);
    expect(ctx.state.status).toBe('failed');
  });

  it('does not invoke resolver when deterministic validation evidence failed or timed out', async () => {
    let calls = 0;
    const ctx = makeCtx(makeTempDir(), validatorWithUnknown(), {
      validationCommandEvidence: [{ command: 'pnpm test', exitCode: 124 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> { calls++; return []; },
    });

    for await (const _ of prdValidate(ctx)) { /* drain */ }

    expect(calls).toBe(0);
    expect(ctx.state.status).toBe('failed');
  });

  it('keeps build failed when resolver leaves an expected unknown unresolved', async () => {
    const repo = makeTempDir();
    initCleanGitRepo(repo);
    const ctx = makeCtx(makeTempDir(), validatorWithUnknown(), {
      mergeWorktreePath: repo,
      validationCommandEvidence: [{ command: 'pnpm type-check', exitCode: 0 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> { return []; },
    });

    const events: EforgeEvent[] = [];
    for await (const event of prdValidate(ctx)) events.push(event);

    expect(ctx.state.status).toBe('failed');
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: false }));
  });

  it('fails closed on resolver crash and dirty worktree', async () => {
    const crashedRepo = makeTempDir();
    initCleanGitRepo(crashedRepo);
    const crashCtx = makeCtx(makeTempDir(), validatorWithUnknown(), {
      mergeWorktreePath: crashedRepo,
      validationCommandEvidence: [{ command: 'pnpm type-check', exitCode: 0 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> { throw new Error('backend unavailable'); },
    });
    for await (const _ of prdValidate(crashCtx)) { /* drain */ }
    expect(crashCtx.state.status).toBe('failed');

    const dirtyRepo = makeTempDir();
    initCleanGitRepo(dirtyRepo);
    writeFileSync(join(dirtyRepo, 'dirty.txt'), 'untracked\n');
    let dirtyCalls = 0;
    const dirtyCtx = makeCtx(makeTempDir(), validatorWithUnknown(), {
      mergeWorktreePath: dirtyRepo,
      validationCommandEvidence: [{ command: 'pnpm type-check', exitCode: 0 }],
      expectedAcceptanceCriteria: [{ id: 'ac-001', text: 'Must report success', raw: '- Must report success' }],
      acceptanceUnknownResolver: async function* (): AsyncGenerator<EforgeEvent, AcceptanceUnknownResolution[], void> { dirtyCalls++; return []; },
    });
    for await (const _ of prdValidate(dirtyCtx)) { /* drain */ }
    expect(dirtyCalls).toBe(0);
    expect(dirtyCtx.state.status).toBe('failed');
  });
});
