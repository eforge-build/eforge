import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';

describe('eforge-plan README planner contract', () => {
  it('documents private recommendations, promotion sources, planner boundaries, and non-goals', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/current.json');
    expect(readme).toContain('promote-selection');
    expect(readme).toContain('prepare-planner-context');
    expect(readme).toContain('apply-planner-result');
    expect(readme).toMatch(/recommended item|recommended group|epic|selected item set/s);
    expect(readme).toMatch(/general extension-owned AI chat runtime support is not implemented/i);
  });
});
