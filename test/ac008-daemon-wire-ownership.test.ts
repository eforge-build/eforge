import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { eventRegistry, safeParseEforgeEvent } from '@eforge-build/client';

describe('AC-008 daemon wire-shape ownership', () => {
  it('keeps the adopted-lock recovery event in the client-owned event registry and schema', () => {
    const event = {
      type: 'daemon:recovery:lock-adopted',
      timestamp: '2026-01-01T00:00:00.000Z',
      path: '/tmp/.eforge/queue-locks/root.lock',
      pid: 1234,
      prdId: 'root',
    };

    expect(safeParseEforgeEvent(event).success).toBe(true);
    expect(eventRegistry['daemon:recovery:lock-adopted'].persist).toBe(true);
    expect(eventRegistry['daemon:recovery:lock-adopted'].summary(event)).toContain('Live queue lock adopted');
  });

  it('builds stream:hello snapshots from shared monitor projection helpers instead of local queue/run/session shapes', () => {
    const source = readFileSync(resolve('packages/monitor/src/streams/daemon-stream.ts'), 'utf-8');
    const snapshotBlock = source.slice(source.indexOf('const snapshot: DaemonStreamSnapshot = {'), source.indexOf('return { cursor, snapshot };'));

    expect(snapshotBlock).toContain('runs: projectRunsForContext(context)');
    expect(snapshotBlock).toContain('queue: await projectQueueForContext(context)');
    expect(snapshotBlock).toContain('sessionMetadata: projectSessionMetadataForContext(context)');
    expect(snapshotBlock).toContain('autoBuild: projectAutoBuildForContext(context)');
    expect(snapshotBlock).not.toMatch(/runs:\s*context\.db\.(?:getRuns|getRunningRuns)\(/);
    expect(snapshotBlock).not.toMatch(/queue:\s*loadQueueItems/);
    expect(snapshotBlock).not.toMatch(/sessionMetadata:\s*\{/);
  });
});
