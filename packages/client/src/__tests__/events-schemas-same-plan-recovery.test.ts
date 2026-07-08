import { describe, expect, it } from 'vitest';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import { safeParseEforgeEvent } from '../events.schemas.js';

const timestamp = '2025-01-01T00:00:00.000Z';

const events = [
  { type: 'plan:build:recovery:start', timestamp, planId: 'plan-01', blockerKind: 'review', issueCount: 2, maxAttempts: 1, attemptsRemaining: 1 },
  { type: 'plan:build:recovery:attempt:start', timestamp, planId: 'plan-01', blockerKind: 'review', attempt: 1, maxAttempts: 1, attemptsRemaining: 1 },
  { type: 'plan:build:recovery:attempt:result', timestamp, planId: 'plan-01', blockerKind: 'review', attempt: 1, maxAttempts: 1, blockersCleared: false, attemptsRemaining: 0 },
  { type: 'plan:build:recovery:skip', timestamp, planId: 'plan-01', blockerKind: 'test', reason: 'manual-gate', details: 'Manual fix required.', attemptsRemaining: 0 },
  { type: 'plan:build:recovery:exhausted', timestamp, planId: 'plan-01', blockerKind: 'test', attemptsUsed: 1, maxAttempts: 1, details: 'Budget exhausted.' },
] as const;

describe('same-plan recovery event schemas', () => {
  it('accepts every recovery lifecycle variant', () => {
    for (const event of events) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
    }
  });

  it('rejects invalid blocker kinds and skip reasons', () => {
    expect(safeParseEforgeEvent({ ...events[0], blockerKind: 'merge' }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...events[3], reason: 'retry-later' }).success).toBe(false);
  });

  it('registers recovery events as persisted session events with summaries', () => {
    for (const event of events) {
      expect(eventRegistry[event.type]).toMatchObject({ scope: 'session', persist: true });
      expect(getEventSummary(event)).toContain('same-plan');
    }
  });
});
