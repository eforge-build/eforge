// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RecoveryAppliedMetadata } from '@eforge-build/client/browser';
import { selectNowAttentionItems } from '@/lib/selectors/now';
import { connectedState, makeQueue } from '@/test-support/factories';

function acceptedSuccessMarker(
  landing: RecoveryAppliedMetadata extends infer R
    ? R extends { action: 'accepted-success' }
      ? R['landing']
      : never
    : never,
): RecoveryAppliedMetadata {
  return {
    action: 'accepted-success',
    acceptedAt: '2026-06-01T00:00:00.000Z',
    reasonCategory: 'manual_verification_passed',
    reason: 'Verified manually.',
    cleanup: { status: 'noop' },
    landing,
    dependents: { unblocked: [], remainedBlocked: [], notFound: [] },
  };
}

describe('selectNowAttentionItems — accepted-success recovery markers', () => {
  it('suppresses failed queue rows when accepted-success landing completed', () => {
    const state = connectedState({
      queue: [
        makeQueue({
          id: 'accepted-prd',
          title: 'Accepted PRD',
          status: 'failed',
          recoveryVerdict: { verdict: 'manual', confidence: 'high' },
          recoveryApplied: acceptedSuccessMarker({ action: 'pr', status: 'complete', prUrl: 'https://example.test/pr/1' }),
        }),
        makeQueue({
          id: 'accepted-prd-no-verdict',
          title: 'Accepted PRD Without Verdict',
          status: 'failed',
          recoveryApplied: acceptedSuccessMarker({ action: 'merge', status: 'complete', mergeCommitSha: 'abc123' }),
        }),
      ],
    });

    const { items } = selectNowAttentionItems(state, {}, Date.now());

    expect(items.find((item) => item.id.includes('accepted-prd'))).toBeUndefined();
    expect(items.find((item) => item.id.includes('accepted-prd-no-verdict'))).toBeUndefined();
  });

  it('keeps failed accepted-success landing rows actionable with the landing reason', () => {
    const state = connectedState({
      queue: [
        makeQueue({
          id: 'accepted-prd',
          title: 'Accepted PRD',
          status: 'failed',
          recoveryVerdict: { verdict: 'manual', confidence: 'high' },
          recoveryApplied: acceptedSuccessMarker({ action: 'pr', status: 'failed', reason: 'PR creation failed' }),
        }),
      ],
    });

    const { items } = selectNowAttentionItems(state, {}, Date.now());
    const item = items.find((candidate) => candidate.id === 'queue-failed-verdict-accepted-prd');

    expect(item).toBeDefined();
    expect(item?.detail).toContain('landing failed');
    expect(item?.detail).toContain('PR creation failed');
    expect(item?.recovery).toBeUndefined();
  });
});
