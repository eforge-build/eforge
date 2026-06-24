import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { openDatabase } from '../db.js';
import { createMonitorContext } from '../context.js';
import { ExtensionAgentTaskService } from '../routes/extensions/agent-task-service.js';

describe('extension agent task contribution resolution', () => {
  it('rejects unknown owner-scoped task contributions before enqueueing work', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-contribution-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    try {
      const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry({ async *run() {}, effectiveCustomToolName: (name: string) => name }) });
      const service = new ExtensionAgentTaskService(context);
      await expect(service.start({ task: { id: 'missing-task' }, input: {} })).rejects.toThrow('Unknown task contribution');
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
