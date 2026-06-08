import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { extensionAgentTaskVariants, expectEventRejected, expectJsonRoundTrip } from './events-schema-test-helpers.js';

const taskTypes = [
  'extension:agent-task:start',
  'extension:agent-task:progress',
  'extension:agent-task:complete',
  'extension:agent-task:failed',
  'extension:agent-task:cancelled',
] as const;

const expectedStatuses = {
  'extension:agent-task:start': 'running',
  'extension:agent-task:progress': 'running',
  'extension:agent-task:complete': 'completed',
  'extension:agent-task:failed': 'failed',
  'extension:agent-task:cancelled': 'cancelled',
} as const;

describe('extension agent task lifecycle event schemas', () => {
  it('accepts all five task lifecycle variants with extensionName and status', () => {
    for (const event of extensionAgentTaskVariants) {
      const taskEvent = event as { type: keyof typeof expectedStatuses; extensionName: string; status: string };
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
      expect(taskEvent.extensionName).toBe('planning-extension');
      expect(taskEvent.status).toBe(expectedStatuses[taskEvent.type]);
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

  it('rejects task lifecycle events missing extensionName or status', () => {
    for (const event of extensionAgentTaskVariants) {
      const taskEvent = event as Record<string, unknown>;
      const { extensionName: _extensionName, ...missingExtensionName } = taskEvent;
      const { status: _status, ...missingStatus } = taskEvent;
      expectEventRejected(safeParseEforgeEvent(missingExtensionName), `${event.type} missing extensionName`);
      expectEventRejected(safeParseEforgeEvent(missingStatus), `${event.type} missing status`);
    }
  });

  it('accepts sanitized section-progress metadata on progress events and round trips it', () => {
    const progressEvent = extensionAgentTaskVariants.find((candidate) => candidate.type === 'extension:agent-task:progress')!;
    const metadata = (progressEvent as { metadata?: { sectionProgress?: { currentSection?: string; coveredSections?: string[]; remainingSections?: string[] } } }).metadata;
    expect(metadata?.sectionProgress?.currentSection).toBe('scope');
    expect(metadata?.sectionProgress?.coveredSections).toEqual(['summary']);
    expect(metadata?.sectionProgress?.remainingSections).toEqual(['risks', 'verification']);
    expect(safeParseEforgeEvent(progressEvent).success).toBe(true);
    expectJsonRoundTrip(progressEvent);
    expect(safeParseEforgeEvent({ ...progressEvent, metadata: { sectionProgress: { currentSection: 'scope', unexpected: true } } }).success).toBe(false);
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
