// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import type { AgentThread, DecisionPoint, StoredEvent } from '@/lib/run-state';
import { ThreadPipeline } from '../thread-pipeline';
import { ReviewCycleDetailSheet } from '../review-cycle-detail-sheet';
import type { ReviewCycleDetail } from '../review-cycle-detail-model';

afterEach(cleanup);

const review = { strategy: 'parallel' as const, perspectives: ['code'], maxRounds: 2, evaluatorStrictness: 'strict' as const };
const orchestration = {
  name: 'feature-x',
  description: 'Feature X',
  created: '2025-01-01T00:00:00.000Z',
  mode: 'excursion' as const,
  baseBranch: 'main',
  pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: ['implement', 'review-cycle'], defaultReview: review, rationale: 'test' },
  plans: [{ id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement', 'review-cycle'], review }],
};

function stored(eventId: string, event: Record<string, unknown>): StoredEvent {
  return { eventId, event: event as unknown as StoredEvent['event'] };
}

function makeThread(overrides: Partial<AgentThread>): AgentThread {
  return {
    agentId: 'fixer-1',
    agent: 'review-fixer',
    planId: 'plan-01',
    startedAt: '2025-01-01T00:02:00.000Z',
    endedAt: '2025-01-01T00:03:00.000Z',
    durationMs: 60_000,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'claude',
    ...overrides,
  };
}

const events: StoredEvent[] = [
  stored('review', { type: 'plan:build:review:parallel:perspective:complete', timestamp: '2025-01-01T00:01:00.000Z', planId: 'plan-01', perspective: 'code', issues: [{ severity: 'warning', category: 'code', file: 'src/app.ts', line: 7, description: 'Problem.', fix: 'Fix it.' }], round: 0 }),
  stored('fix', { type: 'plan:build:review:fix:start', timestamp: '2025-01-01T00:02:00.000Z', planId: 'plan-01', issueCount: 1, round: 0 }),
  stored('eval', { type: 'plan:build:evaluate:complete', timestamp: '2025-01-01T00:04:00.000Z', planId: 'plan-01', accepted: 1, rejected: 0, verdicts: [{ file: 'src/app.ts', hunk: 1, action: 'accept', issueOutcome: 'resolved', reason: 'Resolved.' }], round: 0 }),
];

const decisions: Record<string, DecisionPoint[]> = {
  'plan-01': [
    { eventType: 'plan:build:decision', timestamp: '2025-01-01T00:00:10.000Z', decision: { kind: 'review-strategy', strategy: 'parallel', source: 'config', rationale: 'Use configured perspectives.' } },
    { eventType: 'plan:build:decision', timestamp: '2025-01-01T00:00:20.000Z', decision: { kind: 'evaluator-strictness', strictness: 'strict', source: 'config', rationale: 'Configured strictness.' } },
    { eventType: 'plan:build:decision', timestamp: '2025-01-01T00:04:10.000Z', decision: { kind: 'cycle-terminated', round: 0, reason: 'no-issues', issuesRemaining: 0, finalEvaluationAccepted: 1, finalEvaluationRejected: 0, rationale: 'No issues remain.' } },
  ],
};

function renderPipeline(props: Partial<ComponentProps<typeof ThreadPipeline>> = {}) {
  return render(
    <PlanPreviewProvider>
      <ThreadPipeline
        agentThreads={[]}
        startTime={Date.parse('2025-01-01T00:00:00.000Z')}
        endTime={Date.parse('2025-01-01T00:05:00.000Z')}
        planStatuses={{ 'plan-01': 'review' }}
        reviewIssues={{}}
        events={events}
        orchestration={orchestration}
        prdSource={null}
        planArtifacts={[{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }]}
        decisions={decisions}
        {...props}
      />
    </PlanPreviewProvider>,
  );
}

describe('ReviewCycleDetailSheet integration', () => {
  it('opens by clicking the selectable review-cycle pill and ignores a non-review-cycle pill', () => {
    renderPipeline();

    fireEvent.click(screen.getByText('implement'));
    expect(screen.queryByText('plan-01 · review-cycle')).toBeNull();

    const button = screen.getByRole('button', { name: /plan plan-01/i });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toContain('review-cycle');

    fireEvent.mouseEnter(button);
    expect(screen.getByText('implement').className).toContain('opacity-40');
    fireEvent.mouseLeave(button);
    expect(screen.getByText('implement').className).not.toContain('opacity-40');

    fireEvent.click(button);

    expect(screen.getByText('plan-01 · review-cycle')).toBeTruthy();
    expect(screen.getByText(/No issues remain/)).toBeTruthy();
    expect(screen.getByText(/parallel \(config\)/)).toBeTruthy();
    expect(screen.getByText(/strict \(config\)/)).toBeTruthy();
    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getAllByText(/1 accepted \/ 0 rejected/).length).toBeGreaterThan(0);
  });

  it('opens agent detail from inside the review-cycle sheet', async () => {
    renderPipeline({
      agentThreads: [makeThread({ activity: { attribution: 'exact', files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }], totals: { filesChanged: 1, additions: 1, deletions: 0 } } })],
    });

    fireEvent.click(screen.getByRole('button', { name: /plan plan-01/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open agent detail/ }));

    await waitFor(() => expect(screen.getByText('review-fixer · plan-01')).toBeTruthy());
    expect(screen.queryByText('plan-01 · review-cycle')).toBeNull();
  });

  it('renders reviewer, fixer, evaluator, perspective error, and empty-state details', () => {
    const detail: ReviewCycleDetail = {
      planId: 'plan-01',
      roundsInferred: true,
      summary: { finalAccepted: 1, finalRejected: 1 },
      rounds: [
        {
          round: 0,
          roundLabel: 'Round 1',
          linkedTraces: [],
          unlinkedFixerReferences: [{ issueId: '', status: 'deferred', note: 'No issue id supplied' }],
          reviewers: [
            {
              perspective: 'code',
              issues: [{ severity: 'warning', category: 'code', file: 'src/app.ts', line: 7, description: 'Problem.', fix: 'Fix it.' }],
            },
            { perspective: 'security', issues: [] },
          ],
          perspectiveErrors: [{ perspective: 'docs', error: 'Reviewer failed.' }],
          reviewFix: {
            ran: true,
            issueCount: 1,
            continuations: [{ attempt: 1, maxContinuations: 2 }],
            activity: { attribution: 'exact', files: [{ path: 'src/app.ts', additions: 2, deletions: 1 }], totals: { filesChanged: 1, additions: 2, deletions: 1 } },
          },
          evaluator: {
            ran: true,
            accepted: 1,
            rejected: 1,
            verdicts: [{ file: 'src/app.ts', hunk: 3, action: 'reject', issueOutcome: 'unresolved', reason: 'Still broken.', retryGuidance: 'Try again.' }],
          },
        },
        {
          round: 1,
          roundLabel: 'Round 2',
          linkedTraces: [],
          unlinkedFixerReferences: [],
          reviewers: [],
          perspectiveErrors: [],
          reviewFix: { ran: false, continuations: [] },
          evaluator: { ran: false, verdicts: [] },
        },
      ],
    };

    render(<ReviewCycleDetailSheet detail={detail} open onClose={() => {}} onOpenAgent={() => {}} />);

    expect(screen.getByText('Round grouping inferred from legacy event timing.')).toBeTruthy();
    expect(screen.getAllByText('code').length).toBeGreaterThan(0);
    expect(screen.getByText('1 issue(s)')).toBeTruthy();
    expect(screen.getByText('security')).toBeTruthy();
    expect(screen.getByText('This reviewer reported no issues.')).toBeTruthy();
    expect(screen.getByText('warning')).toBeTruthy();
    expect(screen.getByText('src/app.ts:7')).toBeTruthy();
    expect(screen.getByText('Problem.')).toBeTruthy();
    expect(screen.getByText('Fix: Fix it.')).toBeTruthy();
    expect(screen.getByText('Perspective error: docs')).toBeTruthy();
    expect(screen.getByText('Reviewer failed.')).toBeTruthy();
    expect(screen.getByText('Continuation 1/2')).toBeTruthy();
    const firstRoundCard = screen.getByText('Round 1').parentElement as HTMLElement;
    const fixerLane = within(firstRoundCard).getByText('Review-fixer').parentElement as HTMLElement;
    expect(within(fixerLane).getByText('deferred')).toBeTruthy();
    expect(within(fixerLane).getByText(/No issue id supplied/)).toBeTruthy();
    expect(screen.getByText('exact · 1 files · +2 -1')).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getAllByText(/1 accepted \/ 1 rejected/).length).toBeGreaterThan(0);
    expect(screen.getByText('src/app.ts hunk 3')).toBeTruthy();
    expect(screen.getByText(/Action:/)).toBeTruthy();
    expect(screen.getByText('Still broken.')).toBeTruthy();
    expect(screen.getByText('Retry guidance: Try again.')).toBeTruthy();
    expect(screen.getByText('No unlinked reviewer issues were recorded for this round.')).toBeTruthy();
    expect(screen.getByText('No review-fixer activity was recorded for this round.')).toBeTruthy();
    expect(screen.getByText('No unlinked evaluator verdicts were recorded for this round.')).toBeTruthy();
  });

  it('renders linked trace labels and fixer statuses before legacy lane headings', () => {
    const detail: ReviewCycleDetail = {
      planId: 'plan-01',
      roundsInferred: false,
      summary: {},
      rounds: [
        {
          round: 0,
          roundLabel: 'Round 1',
          linkedTraces: [
            {
              issueId: 'review-issue-1',
              reviewer: { perspective: 'code', issue: { issueId: 'review-issue-1', severity: 'warning', category: 'code', file: 'src/linked.ts', description: 'Linked problem.' } },
              fixerReferences: [
                { issueId: 'review-issue-1', status: 'addressed', note: 'Patched' },
                { issueId: 'review-issue-1', status: 'deferred' },
                { issueId: 'review-issue-1', status: 'obsolete' },
              ],
              evaluatorVerdicts: [{ file: 'src/linked.ts', action: 'accept', reason: 'Resolved', issueIds: ['review-issue-1'] }],
              danglingReferenceSources: [],
            },
          ],
          unlinkedFixerReferences: [],
          reviewers: [],
          perspectiveErrors: [],
          reviewFix: { ran: true, continuations: [] },
          evaluator: { ran: true, verdicts: [] },
        },
      ],
    };

    render(<ReviewCycleDetailSheet detail={detail} open onClose={() => {}} onOpenAgent={() => {}} />);

    const traceCard = screen.getByText('Issue review-issue-1').parentElement?.parentElement as HTMLElement;
    expect(traceCard).toBeTruthy();
    expect(within(traceCard).getByText('addressed')).toBeTruthy();
    expect(within(traceCard).getByText('deferred')).toBeTruthy();
    expect(within(traceCard).getByText('obsolete')).toBeTruthy();
    expect(within(traceCard).getByText('Resolved')).toBeTruthy();
    const roundCard = screen.getByText('Round 1').parentElement as HTMLElement;
    const linkedHeading = within(roundCard).getByText('Linked issue traces');
    for (const laneHeading of ['Reviewers', 'Review-fixer', 'Evaluator']) {
      expect(linkedHeading.compareDocumentPosition(within(roundCard).getByText(laneHeading)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('renders legacy no-id reviewer and evaluator data after trace rendering', () => {
    const detail: ReviewCycleDetail = {
      planId: 'plan-01',
      roundsInferred: false,
      summary: {},
      rounds: [
        {
          round: 0,
          roundLabel: 'Round 1',
          linkedTraces: [
            {
              issueId: 'unknown-review-issue',
              fixerReferences: [],
              evaluatorVerdicts: [{ file: 'src/unknown.ts', action: 'reject', reason: 'Unknown issue', issueIds: ['unknown-review-issue'] }],
              danglingReferenceSources: ['evaluator'],
            },
          ],
          unlinkedFixerReferences: [],
          reviewers: [{ perspective: null, issues: [{ severity: 'warning', category: 'code', file: 'src/legacy.ts', description: 'Legacy problem.' }] }],
          perspectiveErrors: [],
          reviewFix: { ran: false, continuations: [] },
          evaluator: { ran: true, verdicts: [{ file: 'src/legacy.ts', action: 'review', reason: 'Legacy verdict' }] },
        },
      ],
    };

    render(<ReviewCycleDetailSheet detail={detail} open onClose={() => {}} onOpenAgent={() => {}} />);

    expect(screen.getByText('Unmatched issue reference unknown-review-issue')).toBeTruthy();
    expect(screen.getByText(/Referenced by evaluator/)).toBeTruthy();
    expect(screen.getByText('Legacy problem.')).toBeTruthy();
    expect(screen.getByText('Legacy verdict')).toBeTruthy();
  });
});
