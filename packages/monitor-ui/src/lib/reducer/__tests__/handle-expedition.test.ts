import { describe, it, expect } from 'vitest';
import {
  handleExpeditionArchitectureComplete,
  handleExpeditionModuleStart,
} from '../handle-expedition';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

const MODULES = [
  { id: 'mod-01', description: 'Module One', dependsOn: [] },
  { id: 'mod-02', description: 'Module Two', dependsOn: ['mod-01'] },
];

describe('handle-expedition smoke', () => {
  it('expedition:architecture:complete seeds moduleStatuses to pending and synthesizes earlyOrchestration with expedition mode', () => {
    const event = makeEvent('expedition:architecture:complete', { modules: MODULES });
    const delta = handleExpeditionArchitectureComplete(event, initialRunState);
    expect(delta?.moduleStatuses).toEqual({ 'mod-01': 'pending', 'mod-02': 'pending' });
    const orch = delta?.earlyOrchestration;
    expect(orch?.mode).toBe('expedition');
    expect(orch?.plans).toHaveLength(2);
    expect(orch?.plans?.[1]?.dependsOn).toEqual(['mod-01']);
  });

  it('expedition:module:start transitions moduleStatus to planning', () => {
    const state = { ...initialRunState, moduleStatuses: { 'mod-01': 'pending' as const } };
    const event = makeEvent('expedition:module:start', { moduleId: 'mod-01' });
    const delta = handleExpeditionModuleStart(event, state);
    expect(delta?.moduleStatuses?.['mod-01']).toBe('planning');
  });
});
