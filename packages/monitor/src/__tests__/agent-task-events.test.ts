import {
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH,
  safeParseExtensionAgentTaskRecord,
} from '@eforge-build/client';
import { describe, expect, it } from 'vitest';
import { sanitizeMetadata } from '../routes/extensions/agent-task-events.js';

describe('agent task event metadata sanitizer', () => {
  it('sanitizes activity logs to the shared task metadata schema', () => {
    const metadata = sanitizeMetadata({
      activityLog: [
        { timestamp: 'not-a-date', message: 'drop invalid timestamp' },
        { timestamp: '2026-06-25T00:00:00.000Z', message: ' \u0000\n ' },
        ...Array.from({ length: EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES }, (_, index) => ({
          timestamp: `2026-06-25T00:${String(index).padStart(2, '0')}:00.000Z`,
          message: index === 0 ? ' '.repeat(10) : `Activity ${index} ${'x'.repeat(EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH + 20)}`,
        })),
      ],
    });

    expect(metadata?.activityLog).toHaveLength(EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES - 1);
    expect(metadata?.activityLog?.[0]?.message).toContain('Activity 1');
    expect(metadata?.activityLog?.every((entry) => entry.message.length > 0)).toBe(true);
    expect(metadata?.activityLog?.every((entry) => entry.message.length <= EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH)).toBe(true);
    expect(metadata?.activityLog?.every((entry) => entry.timestamp.endsWith('.000Z'))).toBe(true);
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

  it('drops Date.parse-compatible activity timestamps outside the contract shape', () => {
    const metadata = sanitizeMetadata({
      activityLog: [
        { timestamp: '2026-06-25', message: 'drop date-only timestamp' },
        { timestamp: '1766620800000', message: 'drop numeric timestamp' },
        { timestamp: '2026-06-25T00:00:00.000Z', message: 'Keep canonical timestamp' },
      ],
    });

    expect(metadata?.activityLog).toEqual([{ timestamp: '2026-06-25T00:00:00.000Z', message: 'Keep canonical timestamp' }]);
  });

  it('keeps only the newest bounded activity entries', () => {
    const metadata = sanitizeMetadata({
      activityLog: Array.from({ length: EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES + 5 }, (_, index) => ({
        timestamp: `2026-06-25T00:${String(index).padStart(2, '0')}:00.000Z`,
        message: `Activity ${index}`,
      })),
    });

    expect(metadata?.activityLog).toHaveLength(EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES);
    expect(metadata?.activityLog?.[0]?.message).toBe('Activity 5');
    expect(metadata?.activityLog?.at(-1)?.message).toBe(`Activity ${EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES + 4}`);
  });

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
