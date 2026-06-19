import { describe, expect, it } from 'vitest';
import { makeQueuePrdDispatchFailedEvent, validateStackedDispatch } from '@eforge-build/engine/queue/dispatch-validation';

describe('stacked dispatch validation', () => {
  it('allows multiple dependencies when stacking is disabled', () => {
    expect(validateStackedDispatch({ prdId: 'p', title: 'P', dependsOn: ['a', 'b'], stackingEnabled: false }).canDispatch).toBe(true);
  });

  it('allows explicit stack_parent', () => {
    expect(validateStackedDispatch({ prdId: 'p', title: 'P', dependsOn: ['a', 'b'], stackParent: 'a', stackingEnabled: true }).canDispatch).toBe(true);
  });

  it('infers single dependency stack_parent', () => {
    const result = validateStackedDispatch({ prdId: 'p', title: 'P', dependsOn: ['a'], stackingEnabled: true });
    expect(result.canDispatch).toBe(true);
    expect(result.inferredStackParent).toBe('a');
  });

  it('blocks multiple dependencies without stack_parent', () => {
    const result = validateStackedDispatch({ prdId: 'p', title: 'P', dependsOn: ['a', 'b'], stackingEnabled: true });
    expect(result.canDispatch).toBe(false);
    expect(result.requiresStackParentChoice).toBe(true);
    expect(result.blockers[0]).toContain('multiple depends_on');
  });

  it('constructs dispatch failure events', () => {
    expect(makeQueuePrdDispatchFailedEvent({ prdId: 'p', title: 'P', reason: 'blocked', stage: 'dispatch', timestamp: '2026-01-01T00:00:00.000Z' })).toEqual({
      type: 'queue:prd:dispatch-failed',
      prdId: 'p',
      title: 'P',
      reason: 'blocked',
      stage: 'dispatch',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });
});
