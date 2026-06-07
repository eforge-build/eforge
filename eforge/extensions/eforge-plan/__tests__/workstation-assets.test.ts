import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ASSET = 'eforge/extensions/eforge-plan/workstation-assets/plans/index.js';

describe('eforge-plan planning workstation assets', () => {
  it('stays inside extension-owned browser assets without private Console imports', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).not.toContain('packages/console-ui/src');
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/import\s+.*['"](?:\.\.\/)+\.\.\//);
  });

  it('invokes actions only through the workstation bridge', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).toContain('window.eforge.invokeAction');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it('requires explicit confirmation before handoff', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).toContain("invoke('handoff-session-plan'");
    expect(source).toMatch(/window\.confirm\s*\(/);
  });
});
