import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';

describe('eforge-plan README planner contract', () => {
  it('documents private recommendations, promotion sources, planner boundaries, and non-goals', async () => {
    const readme = await readFile(README, 'utf-8');

    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/current.json');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/recommendations/status.json');
    expect(readme).toMatch(/missing[\s\S]*No private recommendation model exists/);
    expect(readme).toMatch(/fresh[\s\S]*status\.json[\s\S]*matches/);
    expect(readme).toMatch(/stale[\s\S]*sidecar is missing\/invalid|stale[\s\S]*fingerprint differs/);
    expect(readme).toContain('refresh-recommendations');
    expect(readme).toMatch(/refresh-recommendations[\s\S]*does not apply generated output automatically/);
    expect(readme).toContain('promote-selection');
    expect(readme).toContain('prepare-planner-context');
    expect(readme).toContain('apply-planner-result');
    expect(readme).toContain('daemon-owned');
    expect(readme).toContain('start-planning-agent-task');
    expect(readme).toContain('get-planning-agent-task');
    expect(readme).toContain('cancel-planning-agent-task');
    expect(readme).toContain('apply-planning-agent-task-result');
    expect(readme).toContain('read-only');
    expect(readme).toContain('multi-turn chat');
    expect(readme).toContain('explicitly chooses');
    expect(readme).toContain('unattended enqueueing');
    expect(readme).toContain('queue orchestration');
    expect(readme).toContain('legacy `.backlog/recommendations.json` import/export');
    expect(readme).toMatch(/recommended item|recommended group|epic|selected item set/s);
    expect(readme).toMatch(/general extension-owned AI chat runtime support is not implemented/i);
  });
});
