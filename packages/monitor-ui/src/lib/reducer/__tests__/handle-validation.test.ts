import { describe, it, expect } from 'vitest';
import {
  handleValidationCommandStart,
  handleValidationCommandComplete,
  handleValidationCommandTimeout,
} from '../handle-validation';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

describe('handle-validation smoke', () => {
  it('validation:command:start creates a running span with null endedAt and exitCode', () => {
    const event = makeEvent('validation:command:start', { command: 'pnpm test' });
    const delta = handleValidationCommandStart(event, initialRunState);
    const span = delta?.validationCommands?.[0];
    expect(span?.command).toBe('pnpm test');
    expect(span?.status).toBe('running');
    expect(span?.endedAt).toBeNull();
    expect(span?.exitCode).toBeNull();
  });

  it('validation:command:complete marks open span passed (exit 0)', () => {
    const state = {
      ...initialRunState,
      validationCommands: [
        { command: 'pnpm test', startedAt: '2024-01-15T10:00:00.000Z', endedAt: null, status: 'running' as const, exitCode: null },
      ],
    };
    const event = makeEvent('validation:command:complete', {
      command: 'pnpm test',
      exitCode: 0,
      output: 'All tests passed',
      timestamp: '2024-01-15T10:00:05.000Z',
    });
    const delta = handleValidationCommandComplete(event, state);
    expect(delta?.validationCommands?.[0]?.status).toBe('passed');
    expect(delta?.validationCommands?.[0]?.exitCode).toBe(0);
  });

  it('validation:command:timeout marks open span as timed out', () => {
    const state = {
      ...initialRunState,
      validationCommands: [
        { command: 'pnpm test', startedAt: '2024-01-15T10:00:00.000Z', endedAt: null, status: 'running' as const, exitCode: null },
      ],
    };
    const event = makeEvent('validation:command:timeout', {
      command: 'pnpm test',
      timeoutMs: 10000,
      pid: 1234,
      timestamp: '2024-01-15T10:00:10.000Z',
    });
    const delta = handleValidationCommandTimeout(event, state);
    expect(delta?.validationCommands?.[0]?.status).toBe('timeout');
    expect(delta?.validationCommands?.[0]?.endedAt).toBe('2024-01-15T10:00:10.000Z');
  });
});
