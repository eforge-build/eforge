import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startContentRouteHarness } from './route-test-harness.js';

async function seedProject(cwd: string): Promise<void> {
  await mkdir(join(cwd, 'eforge', 'extensions', 'demo'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), 'extensions:\n  enabled: true\n');
  await writeFile(join(cwd, 'eforge', 'extensions', 'demo', 'extension.yaml'), 'name: demo\nentrypoint: index.js\n');
  await writeFile(join(cwd, 'eforge', 'extensions', 'demo', 'index.js'), 'export default {};\n');
}

describe('extension content routes', () => {
  it('rejects invalid names and path escapes before discovery', async () => {
    const h = await startContentRouteHarness();
    try {
      expect((await h.get(`${API_ROUTES.extensionShow}?name=bad/name`)).status).toBe(400);
      expect((await h.postJson(API_ROUTES.extensionTest, { path: '../escape' })).status).toBe(400);
    } finally { await h.close(); }
  });

  it('applies local mutation security to replay', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.rawPostJson(API_ROUTES.extensionTest, {}, { Host: 'evil.example' })).status).toBe(403); }
    finally { await h.close(); }
  });

  it('lists, shows, and validates real extension files', async () => {
    const h = await startContentRouteHarness();
    try {
      await seedProject(h.cwd);
      expect((await h.get(API_ROUTES.extensionList)).status).toBe(200);
      expect((await h.get(`${API_ROUTES.extensionShow}?name=demo`)).status).not.toBe(400);
      expect((await h.get(`${API_ROUTES.extensionValidate}?name=demo`)).status).not.toBe(400);
    } finally { await h.close(); }
  });

  it('maps package validation errors', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.postJson(API_ROUTES.extensionUpdate, {})).status).toBe(400); }
    finally { await h.close(); }
  });
});
