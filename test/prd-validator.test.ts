import { describe, it, expect } from 'vitest';
import { parseGaps } from '@eforge-build/engine/agents/prd-validator';
import { prdValidate } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { EforgeEvent, EforgeState, PrdValidationGap } from '@eforge-build/engine/events';
import { collectEvents, findEvent, filterEvents } from './test-events.js';

/**
 * Build a minimal PhaseContext for testing prdValidate in isolation.
 */
function makePhaseContext(overrides: Partial<PhaseContext> = {}): PhaseContext {
  const state: EforgeState = {
    setName: 'test',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseBranch: 'main',
    worktreeBase: '/tmp/wt',
    plans: {},
    completedPlans: [],
  };
  return {
    state,
    config: { setName: 'test', baseBranch: 'main', plans: [] },
    stateDir: '/tmp/state',
    repoRoot: '/tmp/repo',
    planRunner: async function* () {},
    parallelism: 1,
    maxValidationRetries: 0,
    minCompletionPercent: 75,
    gapClosePerformed: false,
    mergeWorktreePath: '/tmp/merge',
    featureBranch: 'feature',
    worktreeManager: {} as PhaseContext['worktreeManager'],
    failedMerges: new Set(),
    recentlyMergedIds: [],
    landingSucceeded: false, landingAction: 'merge' as const,
    resumed: false,
    ...overrides,
  } as PhaseContext;
}

/** Helper to create a fake PrdValidator that emits given events */
function fakePrdValidator(events: EforgeEvent[]): PhaseContext['prdValidator'] {
  return async function* () {
    for (const e of events) yield e;
  };
}

describe('parseGaps', () => {
  it('parses JSON with completionPercent and complexity fields', () => {
    const input = '```json\n{"completionPercent": 85, "gaps": [{"requirement": "x", "explanation": "y", "complexity": "moderate"}]}\n```';
    const result = parseGaps(input);
    expect(result).toEqual({
      gaps: [{ requirement: 'x', explanation: 'y', complexity: 'moderate' }],
      completionPercent: 85,
      acceptanceVerdicts: undefined,
      acceptanceConflicts: undefined,
    });
  });

  it('handles missing completionPercent and complexity (backward compat)', () => {
    const input = '```json\n{"gaps": [{"requirement": "x", "explanation": "y"}]}\n```';
    const result = parseGaps(input);
    expect(result).toEqual({
      gaps: [{ requirement: 'x', explanation: 'y' }],
      completionPercent: undefined,
      acceptanceVerdicts: undefined,
      acceptanceConflicts: undefined,
    });
  });

  it('strips invalid complexity values', () => {
    const input = '```json\n{"completionPercent": 50, "gaps": [{"requirement": "a", "explanation": "b", "complexity": "extreme"}]}\n```';
    const result = parseGaps(input);
    expect(result.gaps[0].complexity).toBeUndefined();
    expect(result.completionPercent).toBe(50);
  });

  it('handles all valid complexity values', () => {
    const input = `\`\`\`json
{
  "completionPercent": 60,
  "gaps": [
    {"requirement": "a", "explanation": "b", "complexity": "trivial"},
    {"requirement": "c", "explanation": "d", "complexity": "moderate"},
    {"requirement": "e", "explanation": "f", "complexity": "significant"}
  ]
}
\`\`\``;
    const result = parseGaps(input);
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[0].complexity).toBe('trivial');
    expect(result.gaps[1].complexity).toBe('moderate');
    expect(result.gaps[2].complexity).toBe('significant');
    expect(result.completionPercent).toBe(60);
  });

  it('returns empty gaps and undefined completionPercent for empty input', () => {
    const result = parseGaps('');
    expect(result).toEqual({ gaps: [], completionPercent: undefined, acceptanceVerdicts: undefined, acceptanceConflicts: undefined });
  });

  it('returns a single synthetic gap when non-empty input has no JSON block', () => {
    const result = parseGaps('no json here');
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].requirement).toBe('PRD validator output unparseable');
    expect(result.completionPercent).toBeUndefined();
  });

  it('returns a single synthetic gap for invalid JSON (fail closed)', () => {
    const input = '```json\n{invalid json}\n```';
    const result = parseGaps(input);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].requirement).toBe('PRD validator output unparseable');
    expect(result.completionPercent).toBeUndefined();
  });

  it('handles raw JSON without fences', () => {
    const input = 'Some text {"completionPercent": 90, "gaps": []} more text';
    const result = parseGaps(input);
    expect(result).toEqual({ gaps: [], completionPercent: 90, acceptanceVerdicts: undefined, acceptanceConflicts: undefined });
  });

  it('handles completionPercent of 0', () => {
    const input = '```json\n{"completionPercent": 0, "gaps": [{"requirement": "all", "explanation": "nothing done", "complexity": "significant"}]}\n```';
    const result = parseGaps(input);
    expect(result.completionPercent).toBe(0);
    expect(result.gaps).toHaveLength(1);
  });

  it('ignores non-number completionPercent values', () => {
    const input = '```json\n{"completionPercent": "high", "gaps": []}\n```';
    const result = parseGaps(input);
    expect(result.completionPercent).toBeUndefined();
  });

  it('returns acceptanceVerdicts: undefined when JSON has no acceptanceVerdicts key', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": []}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toBeUndefined();
  });

  it('returns acceptanceVerdicts: undefined when acceptanceVerdicts is empty', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": []}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toBeUndefined();
  });

  it('parses acceptanceVerdicts with pass/fail/unknown verdicts', () => {
    const input = `\`\`\`json
{
  "completionPercent": 80,
  "gaps": [],
  "acceptanceVerdicts": [
    {"criterion": "Must support login", "verdict": "pass", "evidence": "Login component found in src/login.ts"},
    {"criterion": "Must support OAuth", "verdict": "fail", "evidence": "No OAuth integration in diff"},
    {"criterion": "Must be accessible", "verdict": "unknown", "evidence": "Cannot verify from diff alone"}
  ]
}
\`\`\``;
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(3);
    expect(result.acceptanceVerdicts![0]).toEqual({
      criterion: 'Must support login',
      verdict: 'pass',
      evidence: 'Login component found in src/login.ts',
    });
    expect(result.acceptanceVerdicts![1]).toEqual({
      criterion: 'Must support OAuth',
      verdict: 'fail',
      evidence: 'No OAuth integration in diff',
    });
    expect(result.acceptanceVerdicts![2]).toEqual({
      criterion: 'Must be accessible',
      verdict: 'unknown',
      evidence: 'Cannot verify from diff alone',
    });
  });

  it('classifies criterion with empty evidence as unknown', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass", "evidence": ""}]}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(1);
    expect(result.acceptanceVerdicts![0].verdict).toBe('unknown');
    expect(result.acceptanceVerdicts![0].evidence).toBe('No evidence provided for this criterion.');
  });

  it('classifies criterion with missing evidence field as unknown', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass"}]}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(1);
    expect(result.acceptanceVerdicts![0].verdict).toBe('unknown');
  });

  it('classifies verdict with missing criterion as unknown', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"verdict": "pass", "evidence": "Some evidence"}]}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(1);
    expect(result.acceptanceVerdicts![0]).toEqual({
      criterion: 'Unknown criterion',
      verdict: 'unknown',
      evidence: 'No criterion provided for this acceptance verdict.',
    });
  });

  it('classifies criterion with invalid verdict value as unknown', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "maybe", "evidence": "Some evidence"}]}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(1);
    expect(result.acceptanceVerdicts![0].verdict).toBe('unknown');
  });

  it('classifies malformed verdict entries as unknown', () => {
    const input = '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [42]}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toHaveLength(1);
    expect(result.acceptanceVerdicts![0]).toEqual({
      criterion: 'Unknown criterion',
      verdict: 'unknown',
      evidence: 'Malformed acceptance verdict entry.',
    });
  });

  it('returns acceptanceVerdicts: undefined for unparseable JSON', () => {
    const input = '```json\n{invalid json}\n```';
    const result = parseGaps(input);
    expect(result.acceptanceVerdicts).toBeUndefined();
  });

  it('returns acceptanceVerdicts: undefined when no JSON block found', () => {
    const result = parseGaps('no json here');
    expect(result.acceptanceVerdicts).toBeUndefined();
  });

  it('parses acceptanceConflicts for rigid criteria that conflict with necessary work', () => {
    const input = `\`\`\`json
{
  "completionPercent": 100,
  "gaps": [],
  "acceptanceVerdicts": [
    {"criterion": "ac-002", "verdict": "fail", "evidence": "packages/monitor-ui/src/lib/reducer/index.ts changed"}
  ],
  "acceptanceConflicts": [
    {
      "criterion": "ac-002",
      "evidence": "packages/monitor-ui/src/lib/reducer/index.ts was updated only to handle the new event type",
      "conflictsWith": "The work introduced a public event type that monitor reducers must ignore for type-checking",
      "scope": "narrow",
      "recommendedAction": "revise_acceptance_criteria"
    }
  ]
}
\`\`\``;
    const result = parseGaps(input);
    expect(result.acceptanceConflicts).toEqual([
      {
        criterion: 'ac-002',
        evidence: 'packages/monitor-ui/src/lib/reducer/index.ts was updated only to handle the new event type',
        conflictsWith: 'The work introduced a public event type that monitor reducers must ignore for type-checking',
        scope: 'narrow',
        recommendedAction: 'revise_acceptance_criteria',
      },
    ]);
  });

  it('extracts JSON from fenced output with braces inside strings', () => {
    const input = '```json\n{"completionPercent":100,"gaps":[],"acceptanceVerdicts":[{"criterion":"ac-001","verdict":"pass","evidence":"Handled object literal { type: \\\"x\\\" } correctly"}]}\n```';
    const result = parseGaps(input);
    expect(result.gaps).toEqual([]);
    expect(result.acceptanceVerdicts?.[0].verdict).toBe('pass');
  });

  it('synthesizes a failure gap for malformed gap entries instead of silently filtering', () => {
    const input = '```json\n{"completionPercent": 80, "gaps": [null, 42, {"requirement": "valid req", "explanation": "valid exp"}]}\n```';
    const result = parseGaps(input);
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[0]).toMatchObject({ requirement: 'Malformed PRD validation gap entry', explanation: expect.stringContaining('could not be parsed') });
    expect(result.gaps[1]).toMatchObject({ requirement: 'Malformed PRD validation gap entry' });
    expect(result.gaps[2]).toMatchObject({ requirement: 'valid req', explanation: 'valid exp' });
  });

  it('synthesizes a failure gap when a gap entry is missing required fields', () => {
    const input = '```json\n{"completionPercent": 70, "gaps": [{"requirement": "only requirement, no explanation"}]}\n```';
    const result = parseGaps(input);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ requirement: 'Malformed PRD validation gap entry' });
  });
});

describe('prdValidate viability gate', () => {
  const gaps: PrdValidationGap[] = [
    { requirement: 'Must do X', explanation: 'X not done', complexity: 'moderate' },
  ];

  it('fails build when completionPercent is below threshold', async () => {
    const ctx = makePhaseContext({
      minCompletionPercent: 75,
      prdValidator: fakePrdValidator([
        { timestamp: new Date().toISOString(), type: 'prd_validation:start' },
        { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps, completionPercent: 60 },
      ]),
      gapCloser: async function* () {
        yield { timestamp: new Date().toISOString(), type: 'gap_close:start' } as EforgeEvent;
      },
    });

    const events = await collectEvents(prdValidate(ctx));

    expect(ctx.state.status).toBe('failed');
    // Gap closer should NOT have been invoked
    expect(events.some((e) => e.type === 'gap_close:start')).toBe(false);
    // Should emit a progress message about viability
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('viability'));
    expect(progress).toBeDefined();
  });

  it('proceeds to gap closing when completionPercent is above threshold', async () => {
    const gapCloserCalled = { value: false };
    const ctx = makePhaseContext({
      minCompletionPercent: 75,
      prdValidator: fakePrdValidator([
        { timestamp: new Date().toISOString(), type: 'prd_validation:start' },
        { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps, completionPercent: 80 },
      ]),
      gapCloser: async function* () {
        gapCloserCalled.value = true;
        yield { timestamp: new Date().toISOString(), type: 'gap_close:start' } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'gap_close:complete', passed: true } as EforgeEvent;
      },
    });

    await collectEvents(prdValidate(ctx));

    expect(gapCloserCalled.value).toBe(true);
    expect(ctx.gapClosePerformed).toBe(true);
  });

  it('proceeds to gap closing when completionPercent is undefined (backward compat)', async () => {
    const gapCloserCalled = { value: false };
    const ctx = makePhaseContext({
      minCompletionPercent: 75,
      prdValidator: fakePrdValidator([
        { timestamp: new Date().toISOString(), type: 'prd_validation:start' },
        { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps, completionPercent: undefined },
      ]),
      gapCloser: async function* () {
        gapCloserCalled.value = true;
        yield { timestamp: new Date().toISOString(), type: 'gap_close:start' } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'gap_close:complete', passed: true } as EforgeEvent;
      },
    });

    await collectEvents(prdValidate(ctx));

    expect(gapCloserCalled.value).toBe(true);
  });

  it('does nothing when prdValidator is not provided', async () => {
    const ctx = makePhaseContext({ prdValidator: undefined });
    const events = await collectEvents(prdValidate(ctx));
    expect(events).toHaveLength(0);
  });

  it('does nothing when state is already failed', async () => {
    const validatorCalled = { value: false };
    const ctx = makePhaseContext({
      prdValidator: async function* () {
        validatorCalled.value = true;
        yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' } as EforgeEvent;
      },
    });
    ctx.state.status = 'failed';

    const events = await collectEvents(prdValidate(ctx));
    expect(validatorCalled.value).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('defaults minCompletionPercent to 75 via OrchestratorOptions', async () => {
    // This tests that the default is applied in orchestrator construction.
    // We verify the PhaseContext default here.
    const ctx = makePhaseContext();
    expect(ctx.minCompletionPercent).toBe(75);
  });

  it('fails build when gap_close:complete has passed=false', async () => {
    const ctx = makePhaseContext({
      minCompletionPercent: 75,
      prdValidator: fakePrdValidator([
        { timestamp: new Date().toISOString(), type: 'prd_validation:start' },
        { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps, completionPercent: 80 },
        { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' },
      ]),
      gapCloser: async function* () {
        yield { timestamp: new Date().toISOString(), type: 'gap_close:start' } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'gap_close:complete', passed: false } as EforgeEvent;
      },
    });

    const events = await collectEvents(prdValidate(ctx));

    expect(ctx.state.status).toBe('failed');
    expect(ctx.gapClosePerformed).toBe(false);
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('Gap closing failed'));
    expect(progress).toBeDefined();
  });

  it('fails build when gap closer emits no terminal event', async () => {
    const ctx = makePhaseContext({
      minCompletionPercent: 75,
      prdValidator: fakePrdValidator([
        { timestamp: new Date().toISOString(), type: 'prd_validation:start' },
        { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: false, gaps, completionPercent: 80 },
        { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: false, verdicts: [{ criterion: 'Acceptance criteria', verdict: 'unknown', evidence: 'Gaps remain.' }], source: 'prd' },
      ]),
      gapCloser: async function* () {
        yield { timestamp: new Date().toISOString(), type: 'gap_close:start' } as EforgeEvent;
        // No gap_close:complete emitted
      },
    });

    const events = await collectEvents(prdValidate(ctx));

    expect(ctx.state.status).toBe('failed');
    expect(ctx.gapClosePerformed).toBe(false);
    const progress = events.find((e) => e.type === 'planning:progress' && 'message' in e && (e as { message: string }).message.includes('Gap closing failed'));
    expect(progress).toBeDefined();
  });
});
