import { describe, expect, it } from 'vitest';

import { reactToDaemonEvent } from '../daemon-event-reactions.js';
import type { EforgeEvent } from '@eforge-build/engine/events';

describe('reactToDaemonEvent', () => {
  it('notifies external queue mutation for queue completions only once', () => {
    const reasons: string[] = [];
    const sink = { notifyQueueMutation: (reason: string) => reasons.push(reason) };

    reactToDaemonEvent({ type: 'queue:prd:complete', prdId: 'a', status: 'completed', timestamp: new Date().toISOString() } as EforgeEvent, sink);

    expect(reasons).toEqual(['external']);
  });

  it('ignores unrelated daemon events', () => {
    const reasons: string[] = [];
    const sink = { notifyQueueMutation: (reason: string) => reasons.push(reason) };

    reactToDaemonEvent({ type: 'daemon:lifecycle:ready', pid: process.pid, port: 0, version: 'test', mode: 'persistent', timestamp: new Date().toISOString() } as EforgeEvent, sink);

    expect(reasons).toEqual([]);
  });
});
