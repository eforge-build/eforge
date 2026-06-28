// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RecoveryAppliedMetadata } from '@eforge-build/client/browser';
import { selectNowAttentionItems } from '@/lib/selectors/now';
import { connectedState, makeQueue, makeQueueCapabilities } from '@/test-support/factories';

function acceptedSuccessComplete(): RecoveryAppliedMetadata {
  return {
    action: 'accepted-success',
    acceptedAt: '2026-06-01T00:00:00.000Z',
    reasonCategory: 'manual_verification_passed',
    reason: 'Verified manually.',
    cleanup: { status: 'noop' },
    landing: { action: 'merge', status: 'complete', mergeCommitSha: 'abc123' },
    dependents: { unblocked: [], remainedBlocked: [], notFound: [] },
  };
}

describe('selectNowAttentionItems — failed queue cleanup payloads', () => {
  it('adds queueCleanup to failed queue rows with recovery verdicts and preserves capabilities', () => {
    const capabilities = makeQueueCapabilities({
      remove: { allowed: false, reason: 'target has dependents' },
      cascadeRemove: { allowed: true },
    });
    const state = connectedState({
      queue: [
        makeQueue({
          id: 'failed-with-verdict',
          title: 'Failed With Verdict',
          status: 'failed',
          capabilities,
          recoveryVerdict: { verdict: 'retry', confidence: 'high' },
        }),
      ],
    });

    const item = selectNowAttentionItems(state, {}, Date.now()).items[0];

    expect(item).toMatchObject({
      id: 'queue-failed-verdict-failed-with-verdict',
      queueCleanup: { prdId: 'failed-with-verdict', prdTitle: 'Failed With Verdict' },
      recovery: { prdId: 'failed-with-verdict', prdTitle: 'Failed With Verdict', verdict: 'retry', confidence: 'high' },
    });
    expect(item.queueCleanup?.capabilities).toBe(capabilities);
  });

  it('adds queueCleanup to failed queue rows without recovery verdicts', () => {
    const capabilities = makeQueueCapabilities({ remove: { allowed: true } });
    const state = connectedState({
      queue: [makeQueue({ id: 'failed-no-verdict', title: 'Failed No Verdict', status: 'failed', capabilities })],
    });

    const item = selectNowAttentionItems(state, {}, Date.now()).items[0];

    expect(item).toMatchObject({
      id: 'queue-failed-failed-no-verdict',
      detail: 'recovery pending',
      queueCleanup: { prdId: 'failed-no-verdict', prdTitle: 'Failed No Verdict', capabilities },
      recovery: { prdId: 'failed-no-verdict', prdTitle: 'Failed No Verdict' },
    });
  });

  it('does not add queueCleanup to accepted-success completed failed rows', () => {
    const state = connectedState({
      queue: [
        makeQueue({
          id: 'accepted-success',
          title: 'Accepted Success',
          status: 'failed',
          recoveryVerdict: { verdict: 'manual', confidence: 'high' },
          recoveryApplied: acceptedSuccessComplete(),
        }),
      ],
    });

    const { items } = selectNowAttentionItems(state, {}, Date.now());

    expect(items.find((item) => item.id.includes('accepted-success'))).toBeUndefined();
    expect(items.some((item) => item.queueCleanup?.prdId === 'accepted-success')).toBe(false);
  });
});
