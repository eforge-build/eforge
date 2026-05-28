import { describe, it, expect } from 'vitest';
import { handleSessionStart, handleSessionEnd, handlePhaseStart } from '../handle-session';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

describe('handle-session smoke', () => {
  it('session:start sets startTime from event timestamp', () => {
    const event = makeEvent('session:start', { sessionId: 's1' });
    const delta = handleSessionStart(event, initialRunState);
    expect(delta?.startTime).toBe(new Date('2024-01-15T10:00:00.000Z').getTime());
  });

  it('session:end marks isComplete, captures resultStatus and endTime', () => {
    const event = makeEvent('session:end', {
      sessionId: 's1',
      result: { status: 'completed', summary: 'done' },
    });
    const delta = handleSessionEnd(event, initialRunState);
    expect(delta?.isComplete).toBe(true);
    expect(delta?.resultStatus).toBe('completed');
    expect(delta?.endTime).toBe(new Date('2024-01-15T10:00:00.000Z').getTime());
  });

  it('handlePhaseStart sets startTime as fallback when session:start was missed', () => {
    const event = makeEvent('phase:start', { runId: 'r1', planSet: 'my-set', command: 'build' });
    const delta = handlePhaseStart(event, initialRunState);
    expect(delta?.startTime).toBe(new Date('2024-01-15T10:00:00.000Z').getTime());
  });
});
