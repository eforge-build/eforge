import { describe, expect, it } from 'vitest';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { extensionActionVariants, expectJsonRoundTrip } from './events-schema-test-helpers.js';

// --- eforge:region plan-03-daemon-action-routes ---
const actionTypes = [
  'extension:action:start',
  'extension:action:complete',
  'extension:action:failed',
  'extension:action:timeout',
] as const;

describe('extension action lifecycle event schemas', () => {
  it('accepts valid action lifecycle event variants', () => {
    for (const event of extensionActionVariants) {
      const parsed = safeParseEforgeEvent(event);
      expect(parsed.success, event.type).toBe(true);
      expectJsonRoundTrip(event);
    }
  });

  it('registers action lifecycle events as persisted daemon events with summaries', () => {
    for (const type of actionTypes) {
      const meta = eventRegistry[type];
      expect(meta.scope).toBe('daemon');
      expect(meta.persist).toBe(true);
      expect('project' in meta ? meta.project : undefined).toBeUndefined();
      expect(DAEMON_EVENT_TYPES).toContain(type);
      expect(isPersistedDaemonEventType(type)).toBe(true);
      const event = extensionActionVariants.find((candidate) => candidate.type === type)! as Extract<(typeof extensionActionVariants)[number], { type: typeof type }>;
      const summary = getEventSummary(event);
      expect(summary).toContain(event.actionId);
      expect(summary).toContain(event.extensionName);
    }
  });

  it('rejects missing provenance and invalid requested-by hosts', () => {
    const base = extensionActionVariants[0];
    for (const field of ['invocationId', 'actionId', 'extensionName', 'extensionPath'] as const) {
      const invalid = { ...base } as Record<string, unknown>;
      delete invalid[field];
      expect(safeParseEforgeEvent(invalid).success, `missing ${field}`).toBe(false);
    }
    expect(safeParseEforgeEvent({ ...base, requestedBy: { host: 'browser' } }).success).toBe(false);
  });

  it('rejects raw input, output, and payload fields on action events', () => {
    for (const event of extensionActionVariants) {
      for (const field of ['input', 'output', 'rawInput', 'rawOutput', 'payload'] as const) {
        expect(event).not.toHaveProperty(field);
        expect(safeParseEforgeEvent({ ...event, [field]: {} }).success, `${event.type} with ${field}`).toBe(false);
      }
    }
  });
});
// --- eforge:endregion plan-03-daemon-action-routes ---
