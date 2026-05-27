import { describe, it, expect, vi } from 'vitest';
import { handleConfigWarning, handlePlanningWarning } from '../handlers/handle-misc';
import { initialRunState } from '../reducer';
import type { EforgeEvent } from '../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

describe('handle-misc', () => {
  describe('handleConfigWarning', () => {
    it('returns undefined (no state change)', () => {
      const event = makeEvent('config:warning', { message: 'Unknown config key "foo"' });
      const delta = handleConfigWarning(event, initialRunState);
      expect(delta).toBeUndefined();
    });

    it('logs the warning message to console', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const event = makeEvent('config:warning', { message: 'Unknown config key "foo"' });
      handleConfigWarning(event, initialRunState);
      expect(logSpy).toHaveBeenCalledWith('[eforge] warning:', 'Unknown config key "foo"');
      logSpy.mockRestore();
    });
  });

  describe('handlePlanningWarning', () => {
    it('returns undefined (no state change)', () => {
      const event = makeEvent('planning:warning', { message: 'Plan has no dependsOn' });
      const delta = handlePlanningWarning(event, initialRunState);
      expect(delta).toBeUndefined();
    });

    it('logs the warning message to console', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const event = makeEvent('planning:warning', { message: 'Plan has no dependsOn' });
      handlePlanningWarning(event, initialRunState);
      expect(logSpy).toHaveBeenCalledWith('[eforge] warning:', 'Plan has no dependsOn');
      logSpy.mockRestore();
    });

    it('does not mutate state', () => {
      const event = makeEvent('planning:warning', { message: 'some warning' });
      const delta = handlePlanningWarning(event, initialRunState);
      // Undefined delta means the reducer performs no shallow merge
      expect(delta).toBeUndefined();
    });
  });
});
