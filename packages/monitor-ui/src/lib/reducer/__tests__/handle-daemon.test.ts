import { describe, it, expect } from 'vitest';
import { eforgeReducer, initialRunState, selectAutoBuild } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

describe('handle-daemon smoke', () => {
  it('daemon:auto-build:paused through monitor-ui reducer: selectAutoBuild reports { paused: true, reason } with timestamp', () => {
    const event = makeEvent('daemon:auto-build:paused', { reason: 'Build failed: foo' });
    const nextState = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'evt-1',
    });
    const result = selectAutoBuild(nextState);
    expect(result).toEqual({ paused: true, reason: 'Build failed: foo' });
    expect(nextState.autoBuildPausedAt).toBe('2024-01-15T10:00:00.000Z');
  });
});
