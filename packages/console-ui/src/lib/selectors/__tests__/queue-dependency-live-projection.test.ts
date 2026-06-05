// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { EforgeEvent } from '@eforge-build/client/browser';
import { consoleProjectReducer, initialConsoleProjectState } from '@/lib/project-state';
import { selectNowQueueStacks } from '@/lib/selectors/now';

function replay(events: EforgeEvent[]) {
  return events.reduce(
    (state, event, index) => consoleProjectReducer(state, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: `event-${index}`,
      receivedAt: 1_000 + index,
    }),
    initialConsoleProjectState,
  );
}

describe('live queue dependency projection', () => {
  it('groups live parent and child discovery events into a queue stack', () => {
    const state = replay([
      { type: 'queue:prd:discovered', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'parent-prd', title: 'Parent PRD', dependsOn: [] },
      { type: 'queue:prd:discovered', timestamp: '2025-01-01T00:00:01.000Z', prdId: 'child-prd', title: 'Child PRD', dependsOn: ['parent-prd'] },
    ] as EforgeEvent[]);

    expect(state.queue.find((item) => item.id === 'child-prd')?.dependsOn).toEqual(['parent-prd']);
    const stacks = selectNowQueueStacks(state.queue);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].items.map((item) => item.id)).toEqual(['parent-prd', 'child-prd']);
  });

  it('uses dependency-blocked events to patch missed discovery metadata', () => {
    const state = replay([
      { type: 'queue:prd:discovered', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'parent-prd', title: 'Parent PRD' },
      { type: 'queue:prd:discovered', timestamp: '2025-01-01T00:00:01.000Z', prdId: 'child-prd', title: 'Child PRD', dependsOn: ['existing-prd'] },
      { type: 'daemon:scheduler:dependency-blocked', timestamp: '2025-01-01T00:00:02.000Z', prdId: 'child-prd', blockedBy: ['parent-prd'] },
    ] as EforgeEvent[]);

    expect(state.queue.find((item) => item.id === 'child-prd')?.dependsOn).toEqual(['existing-prd', 'parent-prd']);
    expect(selectNowQueueStacks(state.queue)[0].items.map((item) => item.id)).toEqual(['parent-prd', 'child-prd']);
  });
});
