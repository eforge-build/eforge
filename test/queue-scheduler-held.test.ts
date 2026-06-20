import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestEnv, makeQueuedPrd, waitForSpawnCallCount, writeQueuedPrdFile } from './queue-scheduler-helpers.js';

describe('QueueScheduler held gating', () => {
  it('does not spawn held PRDs or emit scheduler dequeued for them while unheld siblings run', async () => {
    const env = await createTestEnv();
    try {
      const heldPath = await writeQueuedPrdFile(env.cwd, 'held');
      const openPath = await writeQueuedPrdFile(env.cwd, 'open');
      await writeFile(heldPath, `---\ntitle: held\nheld: true\n---\n\n# held\n`);
      const held = { ...makeQueuedPrd('held', [], heldPath), frontmatter: { title: 'held', held: true }, content: `---\ntitle: held\nheld: true\n---\n\n# held\n` };
      const open = makeQueuedPrd('open', [], openPath);
      const scheduler = env.makeScheduler([held, open], [], [], 2);
      scheduler.start();
      await waitForSpawnCallCount(env.spawnPrdChild, 1);
      expect(env.spawnPrdChild.mock.calls[0][0].id).toBe('open');
      const events = await vi.waitFor(async () => {
        const batch = await env.eventQueue.drainAvailable();
        expect(batch.some((event) => event.type === 'daemon:scheduler:dequeued' && 'prdId' in event && event.prdId === 'open')).toBe(true);
        return batch;
      });
      expect(events.some((event) => event.type === 'daemon:scheduler:dequeued' && 'prdId' in event && event.prdId === 'held')).toBe(false);
    } finally {
      await env.cleanup();
    }
  });
});
