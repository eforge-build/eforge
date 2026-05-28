import { describe, it, expect } from 'vitest';
import {
  handleEnqueueStart,
  handleEnqueueComplete,
  handleEnqueueFailed,
  handleEnqueueCommitFailed,
} from '../handle-enqueue';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

describe('handle-enqueue smoke', () => {
  it('enqueue:start sets enqueueStatus to running and captures enqueueSource', () => {
    const event = makeEvent('enqueue:start', { source: 'my-prd.md' });
    const delta = handleEnqueueStart(event, initialRunState);
    expect(delta?.enqueueStatus).toBe('running');
    expect(delta?.enqueueSource).toBe('my-prd.md');
  });

  it('enqueue:complete sets enqueueStatus to complete and captures enqueueTitle', () => {
    const event = makeEvent('enqueue:complete', {
      id: 'prd-001',
      filePath: '.eforge/queue/prd-001.md',
      title: 'My Feature',
      planSet: 'My Feature',
    });
    const delta = handleEnqueueComplete(event, initialRunState);
    expect(delta?.enqueueStatus).toBe('complete');
    expect(delta?.enqueueTitle).toBe('My Feature');
  });

  it('enqueue:failed sets enqueueStatus to failed', () => {
    const event = makeEvent('enqueue:failed', { error: 'Validation failed' });
    const delta = handleEnqueueFailed(event, initialRunState);
    expect(delta?.enqueueStatus).toBe('failed');
  });

  it('enqueue:commit-failed is a no-op (returns undefined)', () => {
    const event = makeEvent('enqueue:commit-failed', { error: 'git commit failed' });
    expect(handleEnqueueCommitFailed(event, initialRunState)).toBeUndefined();
  });
});
