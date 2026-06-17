import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

describe('eforge-plan lockstep release wiring', () => {
  it('keeps eforge-plan as a non-private publishable workspace package', async () => {
    const workspace = await readFile('pnpm-workspace.yaml', 'utf-8');
    expect(workspace).toContain('eforge/extensions/eforge-plan');

    const pkg = await readJson('eforge/extensions/eforge-plan/package.json');
    expect(pkg.name).toBe('@eforge-build/eforge-plan');
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
  });

  it('includes eforge-plan in lockstep version propagation', async () => {
    const lockstep = await readFile('scripts/lib/lockstep-version.mjs', 'utf-8');
    expect(lockstep).toContain('export const LOCKSTEP_PACKAGE_PATHS');
    expect(lockstep).toContain('eforge/extensions/eforge-plan/package.json');
  });

  it('publishes through workspace recursion rather than an ad hoc package list', async () => {
    const publishAll = await readFile('scripts/publish-all.mjs', 'utf-8');
    expect(publishAll).toContain('pnpm -r publish');
    expect(publishAll).toContain('--access public');
    expect(publishAll).not.toMatch(/eforge\/extensions\/eforge-plan[^\n]*publish/);
    expect(publishAll).not.toContain('--filter !@eforge-build/eforge-plan');
  });
});
