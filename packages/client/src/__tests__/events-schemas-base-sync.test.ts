import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import type { BaseSyncEvent } from '../events.schemas.js';

const timestamp = '2025-01-01T00:00:00.000Z';

const events: BaseSyncEvent[] = [
  { type: 'base-sync:start', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', maxAttempts: 3 },
  { type: 'base-sync:conflict:attempt', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', attempt: 1, maxAttempts: 3, conflictedFiles: ['src/a.ts'] },
  { type: 'base-sync:resolver:start', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', attempt: 1, maxAttempts: 3 },
  { type: 'base-sync:resolver:complete', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', attempt: 1, maxAttempts: 3, resolved: true, remainingConflicts: 0 },
  { type: 'base-sync:rebase:continue', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', attempt: 1, maxAttempts: 3 },
  { type: 'base-sync:success', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', baseSha: 'abc123', featureSha: 'def456', rebased: true },
  { type: 'base-sync:budget:exhausted', timestamp, remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/feature', attempts: 3, maxAttempts: 3, conflictedFiles: ['src/a.ts'] },
];

describe('safeParseEforgeEvent — direct PR base-sync variants', () => {
  it('accepts all base-sync lifecycle events from the client-owned schema', () => {
    for (const event of events) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
    }
  });

  it('rejects malformed base-sync payloads', () => {
    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ['start missing featureBranch', { ...events[0], featureBranch: undefined }],
      ['start invalid maxAttempts', { ...events[0], maxAttempts: 0 }],
      ['conflict attempt invalid attempt', { ...events[1], attempt: 0 }],
      ['conflict attempt non-array conflictedFiles', { ...events[1], conflictedFiles: 'src/a.ts' }],
      ['resolver start missing remote', { ...events[2], remote: undefined }],
      ['resolver start invalid maxAttempts', { ...events[2], maxAttempts: 0 }],
      ['resolver complete non-boolean resolved', { ...events[3], resolved: 'yes' }],
      ['resolver complete invalid remainingConflicts', { ...events[3], remainingConflicts: -1 }],
      ['rebase continue missing baseBranch', { ...events[4], baseBranch: undefined }],
      ['rebase continue invalid attempt', { ...events[4], attempt: 0 }],
      ['success missing featureSha', { ...events[5], featureSha: undefined }],
      ['success non-boolean rebased', { ...events[5], rebased: 'true' }],
      ['budget exhausted invalid attempts', { ...events[6], attempts: -1 }],
      ['budget exhausted invalid maxAttempts', { ...events[6], maxAttempts: 0 }],
      ['budget exhausted non-array conflictedFiles', { ...events[6], conflictedFiles: 'src/a.ts' }],
    ];

    for (const [name, event] of invalidCases) {
      expect(safeParseEforgeEvent(event).success, name).toBe(false);
    }
  });

  it('registers base-sync lifecycle events as session-scoped live progress', () => {
    for (const event of events) {
      expect(eventRegistry[event.type], event.type).toMatchObject({
        scope: 'session',
        persist: false,
      });
      expect(getEventSummary(event), event.type).toContain('Direct PR base sync');
    }
  });

  it('keeps the exhausted-budget summary actionable with attempt counts', () => {
    expect(getEventSummary(events[6])).toBe('Direct PR base sync exhausted 3/3 conflict attempts');
  });
});
