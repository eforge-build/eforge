// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  selectActivityRows,
  filterActivityRows,
  groupActivityRows,
  classifyFamily,
  classifyAttention,
  getActivityEventSummary,
  defaultActivityFilters,
} from '@/lib/selectors/activity';
import type { ConsoleActivityEntry } from '@/lib/types';
import type { EforgeEvent } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
  receivedAt = 1_000_000,
): ConsoleActivityEntry {
  return {
    id,
    event: { type, ...extra } as unknown as EforgeEvent,
    receivedAt,
  };
}

const FIXED_NOW = 1_001_000; // 1 second after default receivedAt

// ---------------------------------------------------------------------------
// Heartbeat exclusion
// ---------------------------------------------------------------------------

describe('selectActivityRows – heartbeat exclusion', () => {
  it('excludes daemon:heartbeat entries', () => {
    const activity = [
      makeEntry('hb', 'daemon:heartbeat'),
      makeEntry('e1', 'session:start', { sessionId: 's1' }),
    ];
    const rows = selectActivityRows(activity, FIXED_NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('session:start');
  });

  it('returns an empty array when only heartbeats are present', () => {
    const activity = [makeEntry('hb1', 'daemon:heartbeat'), makeEntry('hb2', 'daemon:heartbeat')];
    const rows = selectActivityRows(activity, FIXED_NOW);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('selectActivityRows – newest-first ordering', () => {
  it('sorts newest receivedAt first', () => {
    const activity = [
      makeEntry('older', 'session:start', {}, 1000),
      makeEntry('newer', 'session:end', {}, 2000),
    ];
    const rows = selectActivityRows(activity, 3000);
    expect(rows[0].id).toBe('newer');
    expect(rows[1].id).toBe('older');
  });

  it('uses id descending as tiebreaker when receivedAt values match', () => {
    const activity = [
      makeEntry('a', 'session:start', {}, 1000),
      makeEntry('b', 'session:end', {}, 1000),
    ];
    const rows = selectActivityRows(activity, 2000);
    // 'b' > 'a' lexicographically so 'b' should come first
    expect(rows[0].id).toBe('b');
    expect(rows[1].id).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('getActivityEventSummary', () => {
  it('returns registry summary when available', () => {
    // session:start has summary 'Session started' in the registry
    const event = { type: 'session:start' } as unknown as EforgeEvent;
    expect(getActivityEventSummary(event)).toBe('Session started');
  });

  it('falls back to "Event <type>" for unknown types with no registry summary', () => {
    // Use a type that has no summary in the registry (agent:usage has no summary)
    const event = { type: 'agent:usage' } as unknown as EforgeEvent;
    const summary = getActivityEventSummary(event);
    // agent:usage has no summary defined, so fallback applies
    expect(summary).toBe('Event agent:usage');
  });

  it('falls back to "Event <type>" for a made-up type', () => {
    const event = { type: 'unknown:event:type' } as unknown as EforgeEvent;
    expect(getActivityEventSummary(event)).toBe('Event unknown:event:type');
  });
});

describe('selectActivityRows – summary', () => {
  it('uses registry summary for events with one defined', () => {
    const activity = [makeEntry('e1', 'session:start', {}, 1000)];
    const rows = selectActivityRows(activity, 2000);
    expect(rows[0].summary).toBe('Session started');
  });

  it('uses fallback summary for events with no registry summary', () => {
    const activity = [makeEntry('e1', 'agent:usage', {}, 1000)];
    const rows = selectActivityRows(activity, 2000);
    expect(rows[0].summary).toBe('Event agent:usage');
  });
});

// ---------------------------------------------------------------------------
// rawJson
// ---------------------------------------------------------------------------

describe('selectActivityRows – rawJson', () => {
  it('equals JSON.stringify(event, null, 2)', () => {
    const event = { type: 'session:start', sessionId: 's1' } as unknown as EforgeEvent;
    const activity = [{ id: 'e1', event, receivedAt: 1000 }];
    const rows = selectActivityRows(activity, 2000);
    expect(rows[0].rawJson).toBe(JSON.stringify(event, null, 2));
  });
});

// ---------------------------------------------------------------------------
// Family classification
// ---------------------------------------------------------------------------

describe('classifyFamily', () => {
  it('classifies agent:* events as agent', () => {
    expect(classifyFamily({ type: 'agent:start' } as unknown as EforgeEvent)).toBe('agent');
    expect(classifyFamily({ type: 'agent:stop' } as unknown as EforgeEvent)).toBe('agent');
    expect(classifyFamily({ type: 'agent:message' } as unknown as EforgeEvent)).toBe('agent');
  });

  it('classifies extension:* events as extension', () => {
    expect(
      classifyFamily({ type: 'extension:event-handler:failed' } as unknown as EforgeEvent),
    ).toBe('extension');
    expect(
      classifyFamily({ type: 'extension:policy:decision' } as unknown as EforgeEvent),
    ).toBe('extension');
  });

  it('classifies stack:* events as stack', () => {
    expect(classifyFamily({ type: 'stack:layer:recorded' } as unknown as EforgeEvent)).toBe('stack');
    expect(classifyFamily({ type: 'stack:landing:update' } as unknown as EforgeEvent)).toBe('stack');
  });

  it('classifies daemon:auto-build:* events as scheduler', () => {
    expect(
      classifyFamily({ type: 'daemon:auto-build:enabled' } as unknown as EforgeEvent),
    ).toBe('scheduler');
    expect(
      classifyFamily({ type: 'daemon:auto-build:triggered' } as unknown as EforgeEvent),
    ).toBe('scheduler');
  });

  it('classifies daemon:scheduler:* events as scheduler', () => {
    expect(
      classifyFamily({ type: 'daemon:scheduler:dequeued' } as unknown as EforgeEvent),
    ).toBe('scheduler');
    expect(
      classifyFamily({ type: 'daemon:scheduler:paused' } as unknown as EforgeEvent),
    ).toBe('scheduler');
  });

  it('classifies queue:* events as scheduler', () => {
    expect(classifyFamily({ type: 'queue:start' } as unknown as EforgeEvent)).toBe('scheduler');
    expect(classifyFamily({ type: 'queue:prd:start' } as unknown as EforgeEvent)).toBe('scheduler');
    expect(classifyFamily({ type: 'queue:complete' } as unknown as EforgeEvent)).toBe('scheduler');
    expect(classifyFamily({ type: 'queue:prd:skip' } as unknown as EforgeEvent)).toBe('scheduler');
  });

  it('classifies daemon:error with source=scheduler as scheduler', () => {
    expect(
      classifyFamily({ type: 'daemon:error', source: 'scheduler' } as unknown as EforgeEvent),
    ).toBe('scheduler');
  });

  it('classifies daemon:error with source=auto-build as scheduler', () => {
    expect(
      classifyFamily({ type: 'daemon:error', source: 'auto-build' } as unknown as EforgeEvent),
    ).toBe('scheduler');
  });

  it('classifies enqueue:* events as queue', () => {
    expect(classifyFamily({ type: 'enqueue:start' } as unknown as EforgeEvent)).toBe('queue');
    expect(classifyFamily({ type: 'enqueue:complete' } as unknown as EforgeEvent)).toBe('queue');
    expect(classifyFamily({ type: 'enqueue:failed' } as unknown as EforgeEvent)).toBe('queue');
  });

  it('classifies remaining daemon:* events as daemon', () => {
    expect(
      classifyFamily({ type: 'daemon:lifecycle:ready' } as unknown as EforgeEvent),
    ).toBe('daemon');
    expect(classifyFamily({ type: 'daemon:run:upsert' } as unknown as EforgeEvent)).toBe('daemon');
    expect(classifyFamily({ type: 'daemon:warning' } as unknown as EforgeEvent)).toBe('daemon');
    // daemon:error without scheduler source goes to daemon
    expect(
      classifyFamily({ type: 'daemon:error', source: 'unknown' } as unknown as EforgeEvent),
    ).toBe('daemon');
  });

  it('classifies session-scoped events as session', () => {
    expect(classifyFamily({ type: 'session:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'phase:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'planning:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'plan:build:start' } as unknown as EforgeEvent)).toBe('session');
    expect(
      classifyFamily({ type: 'expedition:architecture:complete' } as unknown as EforgeEvent),
    ).toBe('session');
    expect(classifyFamily({ type: 'landing:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'merge:finalize:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'validation:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'cleanup:start' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'approval:needed' } as unknown as EforgeEvent)).toBe('session');
    expect(classifyFamily({ type: 'recovery:start' } as unknown as EforgeEvent)).toBe('session');
  });
});

// ---------------------------------------------------------------------------
// groupActivityRows
// ---------------------------------------------------------------------------

describe('groupActivityRows', () => {
  it('returns counts for all family keys', () => {
    const activity = [
      makeEntry('e1', 'agent:start', {}, 1001),
      makeEntry('e2', 'daemon:lifecycle:ready', {}, 1002),
      makeEntry('e3', 'queue:prd:start', {}, 1003),
      makeEntry('e4', 'enqueue:complete', {}, 1004),
      makeEntry('e5', 'session:start', {}, 1005),
      makeEntry('e6', 'extension:policy:decision', {}, 1006),
      makeEntry('e7', 'stack:layer:recorded', {}, 1007),
    ];
    const rows = selectActivityRows(activity, FIXED_NOW);
    const counts = groupActivityRows(rows);

    expect(counts.all).toBe(7);
    expect(counts.agent).toBe(1);
    expect(counts.daemon).toBe(1);
    expect(counts.scheduler).toBe(1);
    expect(counts.queue).toBe(1);
    expect(counts.session).toBe(1);
    expect(counts.extension).toBe(1);
    expect(counts.stack).toBe(1);
    expect(counts.other).toBe(0);
  });

  it('sums correctly when a family has multiple events', () => {
    const activity = [
      makeEntry('e1', 'agent:start', {}, 1001),
      makeEntry('e2', 'agent:stop', {}, 1002),
      makeEntry('e3', 'session:start', {}, 1003),
    ];
    const rows = selectActivityRows(activity, FIXED_NOW);
    const counts = groupActivityRows(rows);
    expect(counts.all).toBe(3);
    expect(counts.agent).toBe(2);
    expect(counts.session).toBe(1);
  });

  it('returns all-zero counts (except all:0) for empty rows', () => {
    const counts = groupActivityRows([]);
    expect(counts.all).toBe(0);
    expect(counts.daemon).toBe(0);
    expect(counts.scheduler).toBe(0);
    expect(counts.queue).toBe(0);
    expect(counts.session).toBe(0);
    expect(counts.agent).toBe(0);
    expect(counts.extension).toBe(0);
    expect(counts.stack).toBe(0);
    expect(counts.other).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Attention classification
// ---------------------------------------------------------------------------

describe('classifyAttention', () => {
  it('marks events whose type contains "error"', () => {
    expect(classifyAttention({ type: 'daemon:error' } as unknown as EforgeEvent)).toBe(true);
    expect(
      classifyAttention({ type: 'extension:event-handler:failed' } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('marks events whose type contains "failed"', () => {
    expect(classifyAttention({ type: 'plan:build:failed' } as unknown as EforgeEvent)).toBe(true);
    expect(classifyAttention({ type: 'enqueue:failed' } as unknown as EforgeEvent)).toBe(true);
  });

  it('marks events whose type contains "failure"', () => {
    expect(
      classifyAttention({ type: 'validation:failure:test' } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('marks events whose type contains "warning"', () => {
    expect(classifyAttention({ type: 'daemon:warning' } as unknown as EforgeEvent)).toBe(true);
    expect(classifyAttention({ type: 'agent:warning' } as unknown as EforgeEvent)).toBe(true);
    expect(classifyAttention({ type: 'config:warning' } as unknown as EforgeEvent)).toBe(true);
  });

  it('marks events whose type contains "blocked"', () => {
    expect(
      classifyAttention({ type: 'daemon:scheduler:dependency-blocked' } as unknown as EforgeEvent),
    ).toBe(true);
    expect(
      classifyAttention({ type: 'daemon:scheduler:capacity-blocked' } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('marks events whose type contains "timeout"', () => {
    expect(
      classifyAttention({ type: 'extension:event-handler:timeout' } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('marks events whose type contains "cancel"', () => {
    expect(classifyAttention({ type: 'build:cancelled' } as unknown as EforgeEvent)).toBe(true);
  });

  it('marks events with status=failed', () => {
    expect(
      classifyAttention({ type: 'session:end', status: 'failed' } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('marks events with result.status=error', () => {
    expect(
      classifyAttention({
        type: 'phase:end',
        result: { status: 'error' },
      } as unknown as EforgeEvent),
    ).toBe(true);
  });

  it('does NOT mark ordinary lifecycle events as attention', () => {
    expect(classifyAttention({ type: 'session:start' } as unknown as EforgeEvent)).toBe(false);
    expect(classifyAttention({ type: 'plan:build:start' } as unknown as EforgeEvent)).toBe(false);
    expect(classifyAttention({ type: 'planning:complete' } as unknown as EforgeEvent)).toBe(false);
    expect(classifyAttention({ type: 'agent:start' } as unknown as EforgeEvent)).toBe(false);
    expect(classifyAttention({ type: 'daemon:run:upsert' } as unknown as EforgeEvent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterActivityRows
// ---------------------------------------------------------------------------

describe('filterActivityRows', () => {
  const activity = [
    makeEntry('e1', 'session:start', { sessionId: 'sess-abc' }, 1001),
    makeEntry('e2', 'agent:start', { agent: 'implementor', planId: 'plan-01' }, 1002),
    makeEntry('e3', 'daemon:error', { source: 'scheduler', planId: 'plan-02' }, 1003),
    makeEntry('e4', 'daemon:lifecycle:ready', {}, 1004),
  ];

  it('returns all rows when filters are default', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, defaultActivityFilters);
    expect(filtered).toHaveLength(4);
  });

  it('filters by family', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, { ...defaultActivityFilters, family: 'agent' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e2');
  });

  it('filters attention-only: keeps attention events, excludes others', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, { ...defaultActivityFilters, attentionOnly: true });
    // daemon:error is attention; session:start, agent:start, daemon:lifecycle:ready are not
    expect(filtered.some((r) => r.id === 'e3')).toBe(true);
    expect(filtered.every((r) => r.attention)).toBe(true);
  });

  it('filters by type query case-insensitively', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    // 'SESSION' should match 'session:start'
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      typeQuery: 'SESSION',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].eventType).toBe('session:start');
  });

  it('filters by identifier query matching sessionId', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      identifierQuery: 'sess-abc',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e1');
  });

  it('filters by identifier query matching planId', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      identifierQuery: 'plan-01',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e2');
  });

  it('filters by identifier query matching agent', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      identifierQuery: 'implementor',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e2');
  });

  it('filters by identifier query matching source', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      identifierQuery: 'scheduler',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e3');
  });

  it('identifier query is case-insensitive', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      identifierQuery: 'SESS-ABC',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e1');
  });

  it('returns empty array when no rows match the filter', () => {
    const rows = selectActivityRows(activity, FIXED_NOW);
    const filtered = filterActivityRows(rows, {
      ...defaultActivityFilters,
      typeQuery: 'nonexistent:event:type',
    });
    expect(filtered).toHaveLength(0);
  });
});
