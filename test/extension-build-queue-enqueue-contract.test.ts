import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, safeParseExtensionActionInvokeResponse } from '@eforge-build/client';
import { startContentRouteHarness } from '../packages/monitor/src/__tests__/route-test-harness.js';

async function seedExtension(cwd: string): Promise<void> {
  const dir = join(cwd, '.eforge', 'extensions');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'queue.mjs'), `
import { Type } from '@eforge-build/extension-sdk';
export default function extension(eforge) {
  eforge.registerAction({
    id: 'enqueue',
    title: 'Enqueue',
    inputSchema: Type.Object({}, { additionalProperties: false }),
    async handler(_input, ctx) {
      return await ctx.buildQueue.enqueue({ source: 'prd.md', postMerge: ['pnpm build'], landingAction: 'leave' });
    }
  });
}
`);
  await mkdir(join(cwd, 'eforge'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), 'extensions:\n  enabled: true\n');
}

describe('extension buildQueue.enqueue contract', () => {
  it('forwards producer-agnostic queue fields to daemon enqueue worker args', async () => {
    const spawned: Array<{ command: string; args: string[] }> = [];
    const harness = await startContentRouteHarness({
      serverOptions: {
        workerTracker: {
          spawnWorker: (command, args) => { spawned.push({ command, args }); return { sessionId: 'session-1', pid: 42 }; },
          cancelWorker: () => false,
        },
      },
    });
    try {
      await seedExtension(harness.cwd);
      const manifest = await (await harness.get(API_ROUTES.extensionContributionManifest)).json();
      const action = manifest.actions.find((candidate: { localId: string }) => candidate.localId === 'enqueue');
      expect(action).toBeDefined();

      const res = await harness.postJson(API_ROUTES.extensionActionInvoke, { actionId: action.id, input: {}, requestedBy: { host: 'console' } });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(safeParseExtensionActionInvokeResponse(body).success).toBe(true);
      expect(body).toMatchObject({ ok: true, output: { sessionId: 'session-1', pid: 42, autoBuild: false } });
      expect(spawned).toEqual([{ command: 'enqueue', args: ['prd.md', '--post-merge', 'pnpm build', '--landing-action', 'leave'] }]);
    } finally {
      await harness.close();
    }
  });
});
