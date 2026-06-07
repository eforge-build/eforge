import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ASSET = 'eforge/extensions/eforge-plan/workstation-assets/plans/index.js';
const SOURCE = 'eforge/extensions/eforge-plan/workstation-src/plans/src/App.tsx';

describe('eforge-plan planning workstation assets', () => {
  it('stays inside extension-owned browser assets without private Console imports', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).not.toContain('packages/console-ui/src');
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/import\s+.*['"](?:\.\.\/)+\.\.\//);
  });

  it('production bundle invokes actions only through the workstation bridge', async () => {
    const source = await readFile(ASSET, 'utf-8');

    expect(source).toContain('window.eforge');
    expect(source).toContain('invokeAction');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest/);
  });

  it('source wires promotion controls through promote-selection action', async () => {
    const source = await readFile(SOURCE, 'utf-8');

    expect(source).toContain("'promote-selection'");
    expect(source).toContain('itemIds: [entry.itemId]');
    expect(source).toContain('recommendationRef: entry.ref');
    expect(source).toContain('recommendationRef: group.ref');
    expect(source).toContain('epicId: epic.id');
    expect(source).toContain('Array.from(selectedItems)');
  });

  it('requires explicit confirmation before handoff', async () => {
    const source = await readFile(SOURCE, 'utf-8');

    expect(source).toContain("'handoff-session-plan'");
    expect(source).toMatch(/window\.confirm\s*\(/);
  });
});
