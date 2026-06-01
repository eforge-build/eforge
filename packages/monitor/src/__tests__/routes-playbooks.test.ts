import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startContentRouteHarness } from './route-test-harness.js';

async function seedPlaybook(cwd: string): Promise<void> {
  await mkdir(join(cwd, 'eforge', 'playbooks'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), '{}\n');
  await writeFile(join(cwd, 'eforge', 'playbooks', 'demo.md'), '---\nname: demo\ndescription: Demo planning playbook\nscope: project-team\nmode: planning\n---\n\n## Goal\n\nPlan it\n');
}

describe('playbook routes', () => {
  it('lists and shows playbooks', async () => {
    const h = await startContentRouteHarness();
    try { await seedPlaybook(h.cwd); expect((await h.get(API_ROUTES.playbookList)).status).toBe(200); expect((await h.get(`${API_ROUTES.playbookShow}?name=demo`)).status).toBe(200); }
    finally { await h.close(); }
  });
  it('preserves playbook validation error bodies and save success', async () => {
    const h = await startContentRouteHarness();
    try { await mkdir(join(h.cwd, 'eforge'), { recursive: true }); await writeFile(join(h.cwd, 'eforge', 'config.yaml'), '{}\n'); const bad = await h.postJson(API_ROUTES.playbookSave, { scope: 'project-local', playbook: { frontmatter: {}, body: {} } }); expect(bad.status).toBe(400); expect(await bad.json()).toHaveProperty('errors'); const ok = await h.postJson(API_ROUTES.playbookValidate, { raw: '---\nname: demo\ndescription: Demo planning playbook\nscope: project-team\nmode: planning\n---\n\n## Goal\n\nX\n' }); expect(ok.status).toBe(200); }
    finally { await h.close(); }
  });
  it('returns requires-agent for planning run and validates bad landing options', async () => {
    const h = await startContentRouteHarness();
    try { await seedPlaybook(h.cwd); expect((await h.postJson(API_ROUTES.playbookRun, { name: 'demo' })).status).toBe(200); expect((await h.postJson(API_ROUTES.playbookRun, { name: 'demo', landingAction: 'bad' })).status).toBe(400); }
    finally { await h.close(); }
  });
  it('maps create-from-playbook not found', async () => {
    const h = await startContentRouteHarness();
    try { await seedPlaybook(h.cwd); expect((await h.postJson(API_ROUTES.sessionPlanCreateFromPlaybook, { playbook_name: 'missing' })).status).toBe(404); }
    finally { await h.close(); }
  });
});
