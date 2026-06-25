import { describe, expect, it } from 'vitest';
import type { AgentThread, DecisionPoint, ReviewIssue, StoredEvent } from '@/lib/run-state';
import { buildReviewCycleDetail } from '../review-cycle-detail-model';

const PLAN_ID = 'plan-01';

function stored(eventId: string, event: Record<string, unknown>): StoredEvent {
  return { eventId, event: event as unknown as StoredEvent['event'] };
}

function issue(file: string, description = 'Fix this', issueId?: string): ReviewIssue {
  return {
    ...(issueId ? { issueId } : {}),
    severity: 'warning',
    category: 'code',
    file,
    line: 12,
    description,
    fix: 'Apply the suggested change.',
  };
}

function thread(overrides: Partial<AgentThread>): AgentThread {
  return {
    agentId: 'agent-id',
    agent: 'reviewer',
    planId: PLAN_ID,
    startedAt: '2025-01-01T00:00:00.000Z',
    endedAt: '2025-01-01T00:01:00.000Z',
    durationMs: 60_000,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'model',
    ...overrides,
  };
}

describe('buildReviewCycleDetail', () => {
  it('groups a two-round cycle with reviewer issues, fixer activity, evaluator verdicts, and termination summary', () => {
    const events = [
      stored('r0-code', { type: 'plan:build:review:parallel:perspective:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: PLAN_ID, perspective: 'code', issues: [issue('src/a.ts')], round: 0 }),
      stored('r0-fix-start', { type: 'plan:build:review:fix:start', timestamp: '2025-01-01T00:02:00.000Z', planId: PLAN_ID, issueCount: 1, round: 0 }),
      stored('r0-fix-cont', { type: 'plan:build:review:fix:continuation', timestamp: '2025-01-01T00:02:30.000Z', planId: PLAN_ID, attempt: 1, maxContinuations: 2, round: 0 }),
      stored('r0-eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:03:00.000Z', planId: PLAN_ID, accepted: 0, rejected: 1, verdicts: [{ file: 'src/a.ts', hunk: 1, action: 'reject', issueOutcome: 'unresolved', reason: 'Still broken.', retryGuidance: 'Try again.' }], round: 0 }),
      stored('r1-code', { type: 'plan:build:review:parallel:perspective:complete', timestamp: '2025-01-01T00:04:00.000Z', planId: PLAN_ID, perspective: 'code', issues: [issue('src/b.ts', 'Second round issue')], round: 1 }),
      stored('r1-eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:05:00.000Z', planId: PLAN_ID, accepted: 2, rejected: 0, verdicts: [{ file: 'src/b.ts', action: 'accept', reason: 'Looks good.' }], round: 1 }),
    ];
    const threads = [
      thread({ agentId: 'fixer-0', agent: 'review-fixer', startedAt: '2025-01-01T00:02:00.000Z', endedAt: '2025-01-01T00:02:45.000Z', activity: { attribution: 'exact', files: [{ path: 'src/a.ts', additions: 1, deletions: 1 }], totals: { filesChanged: 1, additions: 1, deletions: 1 } } }),
      thread({ agentId: 'eval-1', agent: 'evaluator', startedAt: '2025-01-01T00:04:30.000Z', endedAt: '2025-01-01T00:05:30.000Z' }),
    ];
    const decisions: DecisionPoint[] = [
      { eventType: 'plan:build:decision', timestamp: '2025-01-01T00:00:10.000Z', decision: { kind: 'review-strategy', strategy: 'parallel', source: 'config', rationale: 'configured' } },
      { eventType: 'plan:build:decision', timestamp: '2025-01-01T00:05:10.000Z', decision: { kind: 'cycle-terminated', round: 1, reason: 'no-issues', issuesRemaining: 0, finalEvaluationAccepted: 2, finalEvaluationRejected: 0, rationale: 'All issues resolved.' } },
    ];

    const detail = buildReviewCycleDetail(events, threads, PLAN_ID, decisions);

    expect(detail.roundsInferred).toBe(false);
    expect(detail.rounds).toHaveLength(2);
    expect(detail.summary.terminated?.rationale).toBe('All issues resolved.');
    expect(detail.summary.reviewStrategy?.strategy).toBe('parallel');
    expect(detail.summary.finalAccepted).toBe(2);
    expect(detail.rounds[0].reviewers[0].issues[0].file).toBe('src/a.ts');
    expect(detail.rounds[0].reviewFix.continuations[0]).toEqual({ attempt: 1, maxContinuations: 2 });
    expect(detail.rounds[0].reviewFix.activity?.files?.[0].path).toBe('src/a.ts');
    expect(detail.rounds[0].evaluator.verdicts[0].action).toBe('reject');
    expect(detail.rounds[1].reviewers[0].issues[0].description).toBe('Second round issue');
    expect(detail.rounds[1].evaluator.accepted).toBe(2);
  });

  it('links reviewer issue, fixer reference, and evaluator verdict by issue id', () => {
    const detail = buildReviewCycleDetail([
      stored('review', { type: 'plan:build:review:parallel:perspective:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: PLAN_ID, perspective: 'code', issues: [issue('src/linked.ts', 'Linked issue', 'review-issue-1')], round: 0 }),
      stored('fix', { type: 'plan:build:review:fix:complete', timestamp: '2025-01-01T00:02:00.000Z', planId: PLAN_ID, issueReferences: [{ issueId: 'review-issue-1', status: 'addressed', note: 'Patched' }], round: 0 }),
      stored('eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:03:00.000Z', planId: PLAN_ID, accepted: 1, rejected: 0, verdicts: [{ file: 'src/linked.ts', action: 'accept', reason: 'Resolved', issueIds: ['review-issue-1'] }], round: 0 }),
    ], [], PLAN_ID, []);

    expect(detail.rounds[0].linkedTraces).toHaveLength(1);
    expect(detail.rounds[0].linkedTraces[0].issueId).toBe('review-issue-1');
    expect(detail.rounds[0].linkedTraces[0].reviewer?.issue.description).toBe('Linked issue');
    expect(detail.rounds[0].linkedTraces[0].fixerReferences[0].status).toBe('addressed');
    expect(detail.rounds[0].linkedTraces[0].evaluatorVerdicts[0].reason).toBe('Resolved');
    expect(detail.rounds[0].reviewers).toHaveLength(0);
    expect(detail.rounds[0].evaluator.verdicts).toHaveLength(0);
    expect(detail.rounds[0].unlinkedFixerReferences).toHaveLength(0);
  });

  it('links one evaluator verdict to every referenced reviewer issue id', () => {
    const detail = buildReviewCycleDetail([
      stored('review', { type: 'plan:build:review:parallel:perspective:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: PLAN_ID, perspective: 'code', issues: [issue('src/one.ts', 'First issue', 'review-issue-1'), issue('src/two.ts', 'Second issue', 'review-issue-2')], round: 0 }),
      stored('eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:03:00.000Z', planId: PLAN_ID, accepted: 0, rejected: 2, verdicts: [{ file: 'src/shared.ts', action: 'reject', reason: 'Both remain', issueIds: ['review-issue-1', 'review-issue-2'] }], round: 0 }),
    ], [], PLAN_ID, []);

    expect(detail.rounds[0].linkedTraces).toHaveLength(2);
    expect(detail.rounds[0].linkedTraces.map((trace) => trace.issueId)).toEqual(['review-issue-1', 'review-issue-2']);
    expect(detail.rounds[0].linkedTraces[0].evaluatorVerdicts[0].reason).toBe('Both remain');
    expect(detail.rounds[0].linkedTraces[1].evaluatorVerdicts[0]).toBe(detail.rounds[0].linkedTraces[0].evaluatorVerdicts[0]);
    expect(detail.rounds[0].evaluator.verdicts).toHaveLength(0);
  });

  it('creates a dangling trace for an evaluator verdict that references an unknown issue id', () => {
    const detail = buildReviewCycleDetail([
      stored('eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:03:00.000Z', planId: PLAN_ID, accepted: 0, rejected: 1, verdicts: [{ file: 'src/missing.ts', action: 'reject', reason: 'Still missing', issueIds: ['unknown-review-issue'] }], round: 0 }),
    ], [], PLAN_ID, []);

    expect(detail.rounds[0].linkedTraces).toHaveLength(1);
    expect(detail.rounds[0].linkedTraces[0].issueId).toBe('unknown-review-issue');
    expect(detail.rounds[0].linkedTraces[0].reviewer).toBeUndefined();
    expect(detail.rounds[0].linkedTraces[0].danglingReferenceSources).toEqual(['evaluator']);
    expect(detail.rounds[0].linkedTraces[0].evaluatorVerdicts[0].reason).toBe('Still missing');
    expect(detail.rounds[0].evaluator.verdicts).toHaveLength(0);
  });

  it('creates a dangling trace for a fixer reference that references an unknown issue id', () => {
    const detail = buildReviewCycleDetail([
      stored('fix', { type: 'plan:build:review:fix:complete', timestamp: '2025-01-01T00:02:00.000Z', planId: PLAN_ID, issueReferences: [{ issueId: 'unknown-review-issue', status: 'deferred', note: 'Could not find it' }], round: 0 }),
    ], [], PLAN_ID, []);

    expect(detail.rounds[0].linkedTraces).toHaveLength(1);
    expect(detail.rounds[0].linkedTraces[0].issueId).toBe('unknown-review-issue');
    expect(detail.rounds[0].linkedTraces[0].reviewer).toBeUndefined();
    expect(detail.rounds[0].linkedTraces[0].danglingReferenceSources).toEqual(['fixer']);
    expect(detail.rounds[0].linkedTraces[0].fixerReferences[0].note).toBe('Could not find it');
    expect(detail.rounds[0].unlinkedFixerReferences).toHaveLength(0);
  });

  it('keeps legacy no-id reviewer issues, fixer references, and evaluator verdicts in unlinked lanes', () => {
    const detail = buildReviewCycleDetail([
      stored('review', { type: 'plan:build:review:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: PLAN_ID, issues: [issue('src/legacy.ts')], round: 0 }),
      stored('fix', { type: 'plan:build:review:fix:complete', timestamp: '2025-01-01T00:01:30.000Z', planId: PLAN_ID, issueReferences: [{ issueId: '', status: 'deferred', note: 'No issue id supplied' }], round: 0 }),
      stored('eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:02:00.000Z', planId: PLAN_ID, accepted: 0, rejected: 1, verdicts: [{ file: 'src/legacy.ts', action: 'review', reason: 'Legacy verdict' }], round: 0 }),
    ], [], PLAN_ID, []);

    expect(detail.rounds[0].linkedTraces).toHaveLength(0);
    expect(detail.rounds[0].reviewers[0].issues[0].file).toBe('src/legacy.ts');
    expect(detail.rounds[0].unlinkedFixerReferences[0].note).toBe('No issue id supplied');
    expect(detail.rounds[0].evaluator.verdicts[0].reason).toBe('Legacy verdict');
  });

  it('falls back to inferred grouping for legacy events without round metadata', () => {
    const detail = buildReviewCycleDetail([
      stored('legacy', { type: 'plan:build:review:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: PLAN_ID, issues: [issue('src/legacy.ts')] }),
    ], [], PLAN_ID, []);

    expect(detail.roundsInferred).toBe(true);
    expect(detail.rounds).toHaveLength(1);
    expect(detail.rounds[0].round).toBe(0);
    expect(detail.rounds[0].reviewers[0].issues[0].file).toBe('src/legacy.ts');
  });
});
