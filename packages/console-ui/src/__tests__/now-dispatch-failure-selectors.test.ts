import { describe, expect, it } from 'vitest';
import { initialConsoleProjectState } from '@/lib/project-state';
import { selectNowAttentionItems } from '@/lib/selectors/now';

describe('now dispatch failure selectors', () => {
  it('includes dispatch failure metadata on failed PRD recovery payloads', () => {
    const dispatchFailure = { reason: 'stack parent is ambiguous', stage: 'stacking-validation' as const, timestamp: '2026-01-01T00:00:00.000Z' };
    const result = selectNowAttentionItems(
      { ...initialConsoleProjectState, connectionStatus: 'connected', queue: [{ id: 'prd-1', title: 'PRD 1', status: 'failed', dispatchFailure }] },
      {},
      Date.now(),
    );
    expect(result.items[0]?.detail).toContain('Dispatch blocked before session:start');
    expect(result.items[0]?.recovery?.dispatchFailure).toEqual(dispatchFailure);
  });
});
