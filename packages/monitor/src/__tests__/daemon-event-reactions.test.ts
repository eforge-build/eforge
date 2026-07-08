import { describe, expect, it } from 'vitest';

import { reactToDaemonEvent } from '../daemon-event-reactions.js';
import type { EforgeEvent } from '@eforge-build/engine/events';

describe('reactToDaemonEvent', () => {
  it('notifies external queue mutation for queue completions only once', async () => {
    const reasons: string[] = [];
    const sink = { notifyQueueMutation: (reason: string) => reasons.push(reason) };

    await reactToDaemonEvent({ type: 'queue:prd:complete', prdId: 'a', status: 'completed', timestamp: new Date().toISOString() } as EforgeEvent, sink);

    expect(reasons).toEqual(['external']);
  });

  it('ignores unrelated daemon events', async () => {
    const reasons: string[] = [];
    const sink = { notifyQueueMutation: (reason: string) => reasons.push(reason) };

    await reactToDaemonEvent({ type: 'daemon:lifecycle:ready', pid: process.pid, port: 0, version: 'test', mode: 'persistent', timestamp: new Date().toISOString() } as EforgeEvent, sink);

    expect(reasons).toEqual([]);
  });

  it('awaits queue completion finalization before notifying external mutation', async () => {
    const order: string[] = [];
    const sink = {
      async finalizeQueuePrdCompletion() {
        order.push('finalize:start');
        await Promise.resolve();
        order.push('finalize:end');
      },
      notifyQueueMutation(reason: string) {
        order.push(`notify:${reason}`);
      },
    };

    await reactToDaemonEvent({ type: 'queue:prd:complete', prdId: 'a', status: 'completed', timestamp: new Date().toISOString() } as EforgeEvent, sink);

    expect(order).toEqual(['finalize:start', 'finalize:end', 'notify:external']);
  });
});
