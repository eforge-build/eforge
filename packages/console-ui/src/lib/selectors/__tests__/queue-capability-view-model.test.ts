// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { QueueItem, QueueItemCapabilities } from '@eforge-build/client/browser';
import { selectNowQueueSummary } from '../queue-summary';
import { selectNowQueueStacks } from '../queue-stacks';
import { selectNowActiveBuildCards } from '../now';
import { createInitialRunState } from '@/lib/run-state';
import { capabilityOrUnavailable, CAPABILITY_UNAVAILABLE_REASON, isHeld } from '@/components/now/queue-capability';

function caps(overrides: Partial<QueueItemCapabilities> = {}): QueueItemCapabilities {
  const allowed = { allowed: true };
  return {
    priority: allowed,
    remove: allowed,
    dependencyOverride: allowed,
    hold: allowed,
    unhold: allowed,
    cascadeRemove: allowed,
    cancel: allowed,
    cascadeCancel: allowed,
    ...overrides,
  };
}

function queue(overrides: Partial<QueueItem> = {}): QueueItem {
  return { id: 'prd-1', title: 'PRD 1', status: 'pending', capabilities: caps(), ...overrides };
}

describe('queue capability view models', () => {
  it('passes hold and capabilities through queue summary rows without changing held row order', () => {
    const held = queue({ id: 'held', title: 'Held', priority: 1, hold: { held: true, reason: 'operator' }, capabilities: caps({ hold: { allowed: false, reason: 'already held' }, unhold: { allowed: true } }) });
    const open = queue({ id: 'open', title: 'Open', priority: 2 });

    const summary = selectNowQueueSummary([open, held]);

    expect(summary.allItems.map((item) => item.id)).toEqual(['held', 'open']);
    expect(summary.allItems[0]).toMatchObject({
      id: 'held',
      hold: { held: true, reason: 'operator' },
      capabilities: { hold: { allowed: false, reason: 'already held' }, unhold: { allowed: true } },
    });
  });

  it('passes hold and capabilities through dependency stack rows for pending, waiting, and running items', () => {
    const stackItems = [
      queue({ id: 'run', status: 'running', capabilities: caps({ cancel: { allowed: true } }) }),
      queue({ id: 'wait', status: 'waiting', dependsOn: ['run'], hold: { held: true, heldAt: '2026-06-19T10:00:00.000Z' } }),
      queue({ id: 'pending', status: 'pending', dependsOn: ['wait'] }),
    ];

    const stacks = selectNowQueueStacks(stackItems);

    expect(stacks).toHaveLength(1);
    expect(stacks[0].items.map((item) => [item.id, item.hold?.held, item.capabilities?.cancel.allowed])).toEqual([
      ['run', undefined, true],
      ['wait', true, true],
      ['pending', undefined, true],
    ]);
  });

  it('attaches queueControl metadata to active build cards when planSet matches a queue item', () => {
    const run = { id: 'run-1', sessionId: 'session-1', planSet: 'prd-1', command: 'build', status: 'running', startedAt: '2026-06-19T10:00:00.000Z', cwd: '/repo' };
    const queueItem = queue({ id: 'prd-1', title: 'Human PRD Title', status: 'running', capabilities: caps({ cancel: { allowed: true }, cascadeCancel: { allowed: true } }) });

    const cards = selectNowActiveBuildCards(
      [run],
      { 'session-1': { planCount: 1, baseProfile: 'default' } },
      { 'session-1': { sessionId: 'session-1', connectionStatus: 'connected', status: 'running', runState: createInitialRunState(), lastEventAt: Date.now(), error: null } },
      Date.now(),
      new Map([[queueItem.id, queueItem]]),
    );

    expect(cards[0]).toMatchObject({
      planSet: 'Human PRD Title',
      queueControl: { prdId: 'prd-1', title: 'Human PRD Title', capabilities: { cancel: { allowed: true } } },
    });
  });

  it('fails closed when capability metadata is unavailable', () => {
    expect(capabilityOrUnavailable(undefined)).toEqual({ allowed: false, reason: CAPABILITY_UNAVAILABLE_REASON });
    expect(isHeld({ held: true })).toBe(true);
    expect(isHeld(undefined)).toBe(false);
  });
});
