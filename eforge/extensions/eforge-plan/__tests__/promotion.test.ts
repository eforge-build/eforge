import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { fetchEforgePlanInputSource, promoteBacklogItem, synthesizeBuildSourceMarkdown } from '../promote.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-promotion-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function seedBacklog(cwd: string) {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: [], body: '# Epic One\n\nEpic evidence.' });
  return writeBacklogItem(cwd, {
    id: 'item-one', status: 'planned', tags: ['dogfood'], depends_on: ['dep-one'], epic: 'epic-one',
    body: ['# Promote Item', '', '## Claim', '', 'Build the handoff.', '', '## Evidence', '', 'User evidence.', '', '## Assumptions', '', 'Assume local files are trusted.', '', '## Acceptance Criteria', '', '- Session plan is written.', ''].join('\n'),
  });
}

describe('eforge-plan promotion', () => {
  it('writes a session plan and never marks promoted items shipped', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const result = await promoteBacklogItem({ cwd, itemId: 'item-one', session: 'session-one', status: 'active' });
      const raw = await readFile(result.sessionPlanPath, 'utf-8');
      const item = await readBacklogItem(cwd, 'item-one');

      expect(result.sessionPlanPath).toContain(`${join('.eforge', 'session-plans', 'session-one.md')}`);
      expect(item?.status).toBe('active');
      expect(item?.status).not.toBe('shipped');
      for (const section of ['## Context', '## Scope', '## Assumptions', '## Design Decisions', '## Acceptance Criteria', '## Source Backlog Evidence', '## Source Epic Evidence', '## Dependency Context']) {
        expect(raw).toContain(section);
      }
      expect(raw).toContain('Backlog item id: item-one');
    });
  });

  it('uses the same synthesis helper for direct input-source output', async () => {
    await withTempProject(async (cwd) => {
      const item = await seedBacklog(cwd);
      const direct = await fetchEforgePlanInputSource('item-one', { cwd } as never);
      const expected = synthesizeBuildSourceMarkdown({ cwd, item, epic: await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: [], body: '# Epic One\n\nEpic evidence.' }), session: 'direct-item-one' });

      expect(direct).toBe(expected);
      expect(direct).toContain('Build the handoff.');
      expect(direct).toContain('User evidence.');
      expect(direct).toContain('Assume local files are trusted.');
      expect(direct).toContain('- Session plan is written.');
    });
  });

  it('returns instructional Markdown without input-source context', async () => {
    const markdown = await fetchEforgePlanInputSource('item-one');
    expect(markdown).toContain('requires runtime context');
    expect(markdown).toContain('process.cwd()');
  });
});
