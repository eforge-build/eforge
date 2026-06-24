import { safeParseExtensionAgentTaskRecord } from '@eforge-build/client';
import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from '../routes/extensions/agent-task-events.js';

describe('agent task event metadata sanitizer', () => {
  it('keeps backlog curation progress within the shared client schema bounds', () => {
    const metadata = sanitizeMetadata({
      backlogCurationProgress: {
        total: 1,
        cacheHits: 0,
        misses: 1,
        running: 1,
        completed: 0,
        remaining: 0,
        items: [{
          itemId: 'i'.repeat(500),
          title: 't'.repeat(500),
          status: 'running',
          outcome: 'o'.repeat(200),
          verdict: 'v'.repeat(200),
          summary: 's'.repeat(700),
          startedAt: '2026-06-23T00:00:00.000Z'.repeat(10),
        }],
      },
    });

    const item = metadata?.backlogCurationProgress?.items[0];
    expect(item?.itemId).toHaveLength(240);
    expect(item?.title).toHaveLength(300);
    expect(item?.outcome).toHaveLength(80);
    expect(item?.verdict).toHaveLength(80);
    expect(item?.summary).toHaveLength(500);
    expect(item?.startedAt).toHaveLength(120);
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-1',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:01.000Z',
      startedAt: '2026-06-23T00:00:01.000Z',
      metadata,
    }).success).toBe(true);
  });
});
