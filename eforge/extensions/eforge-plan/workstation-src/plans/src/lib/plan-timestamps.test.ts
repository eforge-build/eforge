import { describe, expect, it } from 'vitest';
import { normalizeTimestamp, planLifecycleTimestamps, selectBuildActivityTimestamp, selectPlanRecencyTimestamp } from './plan-timestamps';

describe('plan timestamp helpers', () => {
  it('selects the newest projected recency timestamp', () => {
    expect(selectPlanRecencyTimestamp({ createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:05:00.000Z', lastBuildActivityAt: '2026-06-07T00:03:00.000Z' })).toBe('2026-06-07T00:05:00.000Z');
  });

  it('falls back to lifecycle rows for build activity', () => {
    expect(selectBuildActivityTimestamp({ lifecycleLinks: [{ kind: 'build-run', startedAt: '2026-06-07T00:02:00.000Z', completedAt: '2026-06-07T00:04:00.000Z' }] })).toBe('2026-06-07T00:04:00.000Z');
  });

  it('returns null for missing and invalid timestamp values', () => {
    expect(normalizeTimestamp(undefined)).toBeNull();
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp('not-a-date')).toBeNull();
    expect(selectPlanRecencyTimestamp({ createdAt: 'bad' })).toBeNull();
  });

  it('prefers detail projection fields over artifact fields for lifecycle rows', () => {
    const timestamps = planLifecycleTimestamps(
      { plan: { session: 's', topic: 'T', status: 'ready', createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:01:00.000Z', readyAt: '2026-06-07T00:02:00.000Z' } as never },
      { key: 'plan:s', kind: 'plan', session: 's', createdAt: '2026-06-06T00:00:00.000Z', submittedAt: '2026-06-07T00:03:00.000Z' } as never,
    );
    expect(timestamps).toMatchObject({ createdAt: '2026-06-07T00:00:00.000Z', updatedAt: '2026-06-07T00:01:00.000Z', readyAt: '2026-06-07T00:02:00.000Z', submittedAt: '2026-06-07T00:03:00.000Z' });
  });
});
