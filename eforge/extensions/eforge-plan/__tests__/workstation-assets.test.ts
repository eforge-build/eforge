import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ASSET = 'eforge/extensions/eforge-plan/workstation-assets/plans/index.js';
const SRC = 'eforge/extensions/eforge-plan/workstation-src/plans/src';
const BACKLOG_VIEW = `${SRC}/views/backlog-view.tsx`;
const RECOMMENDATIONS_PANEL = `${SRC}/views/backlog/recommendations-panel.tsx`;
const PLANS_VIEW = `${SRC}/views/plans-view.tsx`;

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

  it('promotes a multi-item selection through the promote-selection action', async () => {
    const source = await readFile(BACKLOG_VIEW, 'utf-8');

    expect(source).toContain("'promote-selection'");
    expect(source).toContain('itemIds: selectedIds');
    expect(source).toContain('Array.from(selected)');
  });

  it('wires recommendation promotion paths through promote-selection refs', async () => {
    const source = await readFile(RECOMMENDATIONS_PANEL, 'utf-8');

    expect(source).toContain('itemIds: [entry.itemId]');
    expect(source).toContain('recommendationRef: entry.ref');
    expect(source).toContain('recommendationRef: group.ref');
  });

  it('requires explicit in-app confirmation before handoff', async () => {
    const source = await readFile(PLANS_VIEW, 'utf-8');

    expect(source).toContain("'handoff-session-plan'");
    // window.confirm is unusable in the sandboxed (allow-modals-less) iframe, so
    // handoff gates on an in-app confirmation step instead.
    expect(source).not.toMatch(/window\.confirm\s*\(/);
    expect(source).toContain('confirmingHandoff');
  });
});
