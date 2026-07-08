import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent, type EforgeEvent } from '@eforge-build/client';
import type { ReviewIssue } from '@eforge-build/engine/events';
import type { BuildStageContext } from '@eforge-build/engine/pipeline/types';
import type { ReviewCycleFeedback } from '@eforge-build/engine/pipeline/review-cycle-feedback';
import {
  classifySamePlanRecoveryBlockers,
  renderSamePlanRecoveryFixerContext,
  runSamePlanRecovery,
  type SamePlanRecoveryClassifierInput,
  type SamePlanRecoverySkipReason,
} from '@eforge-build/engine/pipeline/same-plan-recovery';

function issue(overrides: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueId: 'ISSUE-1',
    severity: 'critical',
    category: 'test',
    file: 'src/feature.ts',
    line: 12,
    description: 'The active plan behavior is still blocked.',
    fix: 'Fix the active-plan implementation.',
    metadata: { planId: 'plan-active' },
    ...overrides,
  };
}

function classifierInput(overrides: Partial<SamePlanRecoveryClassifierInput> = {}): SamePlanRecoveryClassifierInput {
  return {
    planId: 'plan-active',
    activePlanId: 'plan-active',
    blockerKind: 'review',
    issues: [issue({ metadata: { planId: 'plan-active' } })],
    confidence: 1,
    complete: true,
    worktreeSafe: true,
    hasFreshBlockingCheck: true,
    deterministicActivePlanOwnership: false,
    ...overrides,
  };
}

function context(overrides: Partial<BuildStageContext> = {}): BuildStageContext {
  return {
    planId: 'plan-active',
    reviewIssues: [],
    worktreePath: '/tmp/worktree',
    planFile: { id: 'plan-active', name: 'Active plan', dependsOn: [], branch: 'plan-active', tasks: [] },
    orchConfig: { planSet: 'set-a', plans: [] },
    build: [],
    review: { maxRounds: 3 },
    cwd: '/tmp/repo',
    planSetName: 'set-a',
    sourceContent: '',
    agentRuntimes: {} as BuildStageContext['agentRuntimes'],
    config: {} as BuildStageContext['config'],
    pipeline: {} as BuildStageContext['pipeline'],
    tracing: {} as BuildStageContext['tracing'],
    plans: [],
    modelTracker: {} as BuildStageContext['modelTracker'],
    ...overrides,
  };
}

async function collectRecoveryRun(options: Parameters<typeof runSamePlanRecovery>[0]): Promise<{ result: boolean; events: EforgeEvent[] }> {
  const events: EforgeEvent[] = [];
  const generator = runSamePlanRecovery(options);
  while (true) {
    const next = await generator.next();
    if (next.done) return { result: next.value, events };
    events.push(next.value);
  }
}

async function* eventStream(...events: EforgeEvent[]): AsyncIterable<EforgeEvent> {
  for (const event of events) yield event;
}

const lifecycleEnvelope = { timestamp: new Date().toISOString() };
const safeRecoveryGate = {
  activePlanId: 'plan-active',
  complete: true,
  confidence: 1,
  worktreeSafe: true,
  hasFreshBlockingCheck: true,
  deterministicActivePlanOwnership: false,
};

describe('same-plan recovery classifier', () => {
  it('allows only high-confidence complete blockers for the active plan', () => {
    expect(classifySamePlanRecoveryBlockers(classifierInput())).toMatchObject({
      eligible: true,
      blockerKind: 'review',
      confidence: 1,
    });
  });

  it.each<[string, Partial<SamePlanRecoveryClassifierInput>, SamePlanRecoverySkipReason]>([
    ['other plan blockers', { planId: 'plan-other' }, 'not-active-plan'],
    ['missing preflight/classifier evidence', { complete: undefined }, 'incomplete-classification'],
    ['missing ownership evidence', { issues: [issue({ metadata: {} })], deterministicActivePlanOwnership: false }, 'incomplete-classification'],
    ['manual gates', { issues: [issue({ repairClass: 'manual' })] }, 'manual-gate'],
    ['human-review gates', { issues: [issue({ metadata: { needsHumanReview: true } })] }, 'human-review-gate'],
    ['human-review evaluator feedback', { feedback: { blockingRetryGuidance: [{ file: 'src/feature.ts', action: 'review', reason: 'Needs human decision.', issueOutcome: 'needs_human_review' }], falsePositiveIssues: [], nonBlockingIssues: [], acceptedRiskIssues: [], splitToFollowupIssues: [] } }, 'human-review-gate'],
    ['cross-plan issues', { issues: [issue({ metadata: { planId: 'plan-other' } })] }, 'cross-plan-blocker'],
    ['upstream-owned issues', { issues: [issue({ metadata: { planId: 'plan-active', owner: 'upstream' } })] }, 'upstream-or-base-owned'],
    ['base-owned issues', { issues: [issue({ metadata: { planId: 'plan-active', baseOwned: true } })] }, 'upstream-or-base-owned'],
    ['low-confidence classifier output', { confidence: 0.79 }, 'low-confidence'],
    ['incomplete classifier output', { complete: false }, 'incomplete-classification'],
    ['unsafe worktrees', { worktreeSafe: false }, 'unsafe-worktree'],
    ['stale blocking-check data', { hasFreshBlockingCheck: false }, 'stale-pass-data'],
    ['unsupported empty blocker sets', { issues: [] }, 'unsupported-blocker'],
    ['follow-up scope blockers', { issues: [issue({ repairClass: 'followup' })] }, 'unsupported-blocker'],
  ])('refuses %s', (_name, overrides, reason) => {
    expect(classifySamePlanRecoveryBlockers(classifierInput(overrides))).toMatchObject({ eligible: false, reason });
  });
});

describe('same-plan recovery lifecycle events', () => {
  it('uses typed start, attempt, result, skip, and exhausted evidence accepted by the event schema', () => {
    const events = [
      { ...lifecycleEnvelope, type: 'plan:build:recovery:start', planId: 'plan-active', blockerKind: 'review', issueCount: 1, maxAttempts: 2, attemptsRemaining: 2 },
      { ...lifecycleEnvelope, type: 'plan:build:recovery:attempt:start', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 2, attemptsRemaining: 2 },
      { ...lifecycleEnvelope, type: 'plan:build:recovery:attempt:result', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 2, blockersCleared: true, attemptsRemaining: 1 },
      { ...lifecycleEnvelope, type: 'plan:build:recovery:skip', planId: 'plan-active', blockerKind: 'test', reason: 'stale-pass-data', details: 'blocking data is stale', attemptsRemaining: 0 },
      { ...lifecycleEnvelope, type: 'plan:build:recovery:exhausted', planId: 'plan-active', blockerKind: 'test', attemptsUsed: 2, maxAttempts: 2, details: 'budget exhausted' },
    ];

    for (const event of events) {
      expect(safeParseEforgeEvent(event).success).toBe(true);
    }
  });
});

describe('same-plan recovery orchestrator', () => {
  it('reruns blocking checks after the fix and resumes only after blockers clear', async () => {
    const order: string[] = [];
    let blockersRemaining = true;
    const { result, events } = await collectRecoveryRun({
      ctx: context(),
      blockerKind: 'test',
      issues: [issue()],
      maxAttempts: 2,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* (attempt, renderedContext) {
          order.push(`fix-${attempt}`);
          expect(renderedContext).toContain('Active plan: plan-active');
          yield* eventStream({ timestamp: lifecycleEnvelope.timestamp, type: 'plan:build:progress', planId: 'plan-active', message: `fix ${attempt}` } as EforgeEvent);
        },
        runBlockingCheck: async function* (attempt) {
          order.push(`check-${attempt}`);
          blockersRemaining = attempt === 1;
          yield* eventStream({ timestamp: lifecycleEnvelope.timestamp, type: 'plan:build:progress', planId: 'plan-active', message: `check ${attempt}` } as EforgeEvent);
        },
        hasBlockers: () => blockersRemaining,
      },
    });

    expect(result).toBe(true);
    expect(order).toEqual(['fix-1', 'check-1', 'fix-2', 'check-2']);
    expect(events.map(event => event.type)).toEqual([
      'plan:build:recovery:start',
      'plan:build:recovery:attempt:start',
      'plan:build:progress',
      'plan:build:progress',
      'plan:build:recovery:attempt:result',
      'plan:build:recovery:attempt:start',
      'plan:build:progress',
      'plan:build:progress',
      'plan:build:recovery:attempt:result',
    ]);
    for (const event of events.filter(event => event.type.startsWith('plan:build:recovery:'))) {
      expect(safeParseEforgeEvent(event).success).toBe(true);
    }
    expect(events.filter((event): event is Extract<EforgeEvent, { type: 'plan:build:recovery:attempt:result' }> => event.type === 'plan:build:recovery:attempt:result').map(event => event.blockersCleared)).toEqual([false, true]);
    expect(events.filter(event => event.type.startsWith('plan:build:recovery:')).map(({ timestamp: _timestamp, ...event }) => event)).toEqual([
      { type: 'plan:build:recovery:start', planId: 'plan-active', blockerKind: 'test', issueCount: 1, maxAttempts: 2, attemptsRemaining: 2 },
      { type: 'plan:build:recovery:attempt:start', planId: 'plan-active', blockerKind: 'test', attempt: 1, maxAttempts: 2, attemptsRemaining: 2 },
      { type: 'plan:build:recovery:attempt:result', planId: 'plan-active', blockerKind: 'test', attempt: 1, maxAttempts: 2, blockersCleared: false, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:start', planId: 'plan-active', blockerKind: 'test', attempt: 2, maxAttempts: 2, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:result', planId: 'plan-active', blockerKind: 'test', attempt: 2, maxAttempts: 2, blockersCleared: true, attemptsRemaining: 0 },
    ]);
  });

  it('skips ineligible recovery before invoking callbacks', async () => {
    let fixes = 0;
    const { result, events } = await collectRecoveryRun({
      ctx: context(),
      blockerKind: 'review',
      issues: [issue({ metadata: { planId: 'plan-active', needsHumanReview: true } })],
      maxAttempts: 1,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* () { fixes += 1; },
        runBlockingCheck: async function* () {},
        hasBlockers: () => true,
      },
    });

    expect(result).toBe(false);
    expect(fixes).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'plan:build:recovery:skip', reason: 'human-review-gate', attemptsRemaining: 1 });
    expect(safeParseEforgeEvent(events[0]).success).toBe(true);
  });

  it('accounts for the explicit attempt budget and emits exhausted when blockers remain', async () => {
    const attempts: number[] = [];
    const { result, events } = await collectRecoveryRun({
      ctx: context(),
      blockerKind: 'review',
      issues: [issue()],
      maxAttempts: 1,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* (attempt) {
          attempts.push(attempt);
        },
        runBlockingCheck: async function* () {},
        hasBlockers: () => true,
      },
    });

    expect(result).toBe(false);
    expect(attempts).toEqual([1]);
    for (const event of events.filter(event => event.type.startsWith('plan:build:recovery:'))) {
      expect(safeParseEforgeEvent(event).success).toBe(true);
    }
    expect(events.filter(event => event.type.startsWith('plan:build:recovery:')).map(({ timestamp: _timestamp, ...event }) => event)).toEqual([
      { type: 'plan:build:recovery:start', planId: 'plan-active', blockerKind: 'review', issueCount: 1, maxAttempts: 1, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:start', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 1, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:result', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 1, blockersCleared: false, attemptsRemaining: 0 },
      { type: 'plan:build:recovery:exhausted', planId: 'plan-active', blockerKind: 'review', attemptsUsed: 1, maxAttempts: 1, details: 'Same-plan recovery budget exhausted with blockers still present.' },
    ]);
  });

  it('emits a failed attempt result when a recovery phase throws', async () => {
    const { result, events } = await collectRecoveryRun({
      ctx: context(),
      blockerKind: 'review',
      issues: [issue()],
      maxAttempts: 1,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* () { throw new Error('fix failed'); },
        runBlockingCheck: async function* () {},
        hasBlockers: () => true,
      },
    });

    expect(result).toBe(false);
    expect(events.filter(event => event.type.startsWith('plan:build:recovery:')).map(({ timestamp: _timestamp, ...event }) => event)).toEqual([
      { type: 'plan:build:recovery:start', planId: 'plan-active', blockerKind: 'review', issueCount: 1, maxAttempts: 1, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:start', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 1, attemptsRemaining: 1 },
      { type: 'plan:build:recovery:attempt:result', planId: 'plan-active', blockerKind: 'review', attempt: 1, maxAttempts: 1, blockersCleared: false, attemptsRemaining: 0 },
    ]);
  });

  it('does not spend a recovery attempt when budget is already exhausted', async () => {
    let fixes = 0;
    const { result, events } = await collectRecoveryRun({
      ctx: context(),
      blockerKind: 'review',
      issues: [issue()],
      maxAttempts: 0,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* () { fixes += 1; },
        runBlockingCheck: async function* () {},
        hasBlockers: () => true,
      },
    });

    expect(result).toBe(false);
    expect(fixes).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'plan:build:recovery:exhausted', attemptsUsed: 0, maxAttempts: 0 });
  });

  it('starts recovery attempts from one rather than reusing a prior review counter', async () => {
    const seenAttempts: number[] = [];
    await collectRecoveryRun({
      ctx: context({ review: { maxRounds: 8 } }),
      blockerKind: 'review',
      issues: [issue()],
      maxAttempts: 1,
      ...safeRecoveryGate,
      callbacks: {
        runFix: async function* (attempt) { seenAttempts.push(attempt); },
        runBlockingCheck: async function* () {},
        hasBlockers: () => false,
      },
    });

    expect(seenAttempts).toEqual([1]);
  });
});

describe('same-plan recovery fixer context', () => {
  it('renders rejected and unresolved verifier issue groups with deterministic labels, identifiers, summaries, and reasons', () => {
    const feedback: ReviewCycleFeedback = {
      blockingRetryGuidance: [
        { file: 'src/z.ts', hunk: 2, action: 'accept', reason: 'Still missing observable behavior.', issueOutcome: 'unresolved_blocking', issueIds: ['UNRES-2'], retryGuidance: 'Add the missing assertion.' },
        { file: 'src/y.ts', hunk: 3, action: 'accept', reason: 'Another unresolved issue.', issueOutcome: 'unresolved_blocking', issueIds: ['UNRES-1'] },
        { file: 'src/b.ts', hunk: 2, action: 'reject', reason: 'Second broad rewrite.', issueOutcome: 'unresolved', issueIds: ['REJ-2'] },
        { file: 'src/a.ts', hunk: 1, action: 'reject', reason: 'Broad rewrite regressed neighboring behavior.', issueOutcome: 'unresolved', issueIds: ['REJ-1'], retryGuidance: 'Use a smaller patch.' },
      ],
      falsePositiveIssues: [],
      nonBlockingIssues: [],
      acceptedRiskIssues: [],
      splitToFollowupIssues: [],
    };

    const rendered = renderSamePlanRecoveryFixerContext({
      planId: 'plan-active',
      blockerKind: 'review',
      issues: [issue({ issueId: 'B-2', file: 'b.ts' }), issue({ issueId: 'A-1', file: 'a.ts' })],
      feedback,
    });

    expect(rendered).toContain('## Rejected verifier issues\n\n- REJ-1 — src/a.ts hunk 1 — unresolved: Broad rewrite regressed neighboring behavior. Retry guidance: Use a smaller patch.');
    expect(rendered).toContain('## Unresolved verifier issues\n\n- UNRES-1 — src/y.ts hunk 3 — unresolved_blocking: Another unresolved issue.');
    expect(rendered.indexOf('- A-1 — a.ts')).toBeLessThan(rendered.indexOf('- B-2 — b.ts'));
    expect(rendered.indexOf('- REJ-1 — src/a.ts')).toBeLessThan(rendered.indexOf('- REJ-2 — src/b.ts'));
    expect(rendered.indexOf('- UNRES-1 — src/y.ts')).toBeLessThan(rendered.indexOf('- UNRES-2 — src/z.ts'));
  });

  it('renders defined empty states for rejected and unresolved verifier issue groups', () => {
    const rendered = renderSamePlanRecoveryFixerContext({ planId: 'plan-active', blockerKind: 'test', issues: [] });

    expect(rendered).toContain('- No active blockers were supplied.');
    expect(rendered).toContain('## Rejected verifier issues\n\n- No rejected verifier issues.');
    expect(rendered).toContain('## Unresolved verifier issues\n\n- No unresolved verifier issues.');
  });
});
