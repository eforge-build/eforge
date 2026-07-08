// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EforgeEvent } from '@eforge-build/client/browser';
import type { ConsoleActivityEntry } from '@/lib/types';
import { filterActivityRows, groupActivityRows, selectActivityRows } from '@/lib/selectors/activity';

const NOW = 1_000_000;

function makeEntry(
  id: string,
  type: string,
  extra: Record<string, unknown>,
  receivedAt = NOW,
): ConsoleActivityEntry {
  return {
    id,
    event: { type, timestamp: '2025-01-01T00:00:00.000Z', ...extra } as unknown as EforgeEvent,
    receivedAt,
  };
}

describe('activity selectors — direct base-sync labels', () => {
  it('classifies base-sync lifecycle rows as session activity with branch identifiers and summaries', () => {
    const activity = [
      makeEntry('base-sync-exhausted', 'base-sync:budget:exhausted', {
        remote: 'origin',
        baseBranch: 'main',
        featureBranch: 'eforge/direct-pr-feature',
        attempts: 3,
        maxAttempts: 3,
        conflictedFiles: ['src/conflict.ts'],
      }),
    ];

    const rows = selectActivityRows(activity, NOW + 1000);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'base-sync:budget:exhausted',
      family: 'session',
      summary: 'Direct PR base sync exhausted 3/3 conflict attempts',
    });
    expect(rows[0].identifiers).toEqual(expect.arrayContaining([
      { label: 'Feature Branch', value: 'eforge/direct-pr-feature' },
      { label: 'Base Branch', value: 'main' },
      { label: 'Remote', value: 'origin' },
    ]));
    expect(rows[0].rawJson).toContain('eforge/direct-pr-feature');
  });

  it('keeps feature-branch merge resolver planIds searchable under the explicit Feature Branch label', () => {
    const activity = [
      makeEntry('resolver', 'agent:start', {
        agentId: 'resolver-1',
        agent: 'merge-conflict-resolver',
        planId: 'eforge/direct-pr-feature',
      }),
    ];

    const [row] = selectActivityRows(activity, NOW + 1000);
    expect(row.identifiers).toContainEqual({ label: 'Feature Branch', value: 'eforge/direct-pr-feature' });
    expect(row.identifiers).not.toContainEqual({ label: 'Plan', value: 'eforge/direct-pr-feature' });

    expect(filterActivityRows([row], { family: 'all', query: 'direct-pr-feature' })).toEqual([row]);
    expect(filterActivityRows([row], { family: 'agent', query: 'eforge/direct-pr-feature' })).toEqual([row]);
  });

  it('groups direct base-sync and associated merge-resolver rows into their selector families', () => {
    const rows = selectActivityRows([
      makeEntry('base-sync', 'base-sync:resolver:start', {
        remote: 'origin',
        baseBranch: 'main',
        featureBranch: 'eforge/direct-pr-feature',
        attempt: 1,
        maxAttempts: 3,
      }, NOW + 2),
      makeEntry('resolver', 'agent:start', {
        agentId: 'resolver-1',
        agent: 'merge-conflict-resolver',
        planId: 'eforge/direct-pr-feature',
      }, NOW + 1),
    ], NOW + 1000);

    expect(rows.map((row) => [row.id, row.family])).toEqual([
      ['base-sync', 'session'],
      ['resolver', 'agent'],
    ]);
    expect(groupActivityRows(rows)).toMatchObject({
      session: 1,
      agent: 1,
    });
  });
});
