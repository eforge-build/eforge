import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { extensionAgentTaskVariants, expectJsonRoundTrip } from './events-schema-test-helpers.js';

const taskTypes = [
  'extension:agent-task:start',
  'extension:agent-task:progress',
  'extension:agent-task:complete',
  'extension:agent-task:failed',
  'extension:agent-task:cancelled',
] as const;

describe('extension agent task lifecycle event schemas', () => {
  it('accepts all five task lifecycle variants', () => {
    for (const event of extensionAgentTaskVariants) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
      expectJsonRoundTrip(event);
    }
  });

  it('registers task lifecycle events as persisted daemon events with summaries', () => {
    for (const type of taskTypes) {
      expect(eventRegistry[type]).toMatchObject({ scope: 'daemon', persist: true });
      expect(DAEMON_EVENT_TYPES).toContain(type);
      expect(isPersistedDaemonEventType(type)).toBe(true);
      const event = extensionAgentTaskVariants.find((candidate) => candidate.type === type)! as Extract<(typeof extensionAgentTaskVariants)[number], { type: typeof type }>;
      expect(getEventSummary(event)).toContain(event.taskId);
    }
  });

  it('rejects raw result, context, prompt, and transcript fields on task events', () => {
    for (const event of extensionAgentTaskVariants) {
      for (const field of ['result', 'context', 'prompt', 'transcript', 'rawTranscript'] as const) {
        expect(safeParseEforgeEvent({ ...event, [field]: 'raw' }).success, `${event.type} with ${field}`).toBe(false);
      }
      expect(safeParseEforgeEvent({ ...event, metadata: { prompt: 'raw prompt' } }).success, `${event.type} nested prompt`).toBe(false);
    }
  });
});
