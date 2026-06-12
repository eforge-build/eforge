import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBacklogCurationSource } from '../backlog-curation-source.js';
import { listBacklogEpicSnapshots, listBacklogItemSnapshots, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-source-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('backlog curation source', () => {
  it('retains every visible open item and precondition when the backlog exceeds planner bounds', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 30; index += 1) await writeBacklogItem(cwd, { id: `item-${index}`, status: 'candidate', body: `# Item ${index}\n\n## Claim\n\nClaim ${index}\n` });
      const snapshots = await listBacklogItemSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };
      expect(packet.openItems.map((item) => item.id)).toHaveLength(30);
      for (const snapshot of snapshots) {
        const projected = packet.openItems.find((item) => item.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });

  it('returns valid compact JSON with every open item id and precondition when planner text needs a minimal fallback', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 500; index += 1) await writeBacklogItem(cwd, { id: `item-${index}`, status: 'candidate', body: `# Item ${index}\n\n## Claim\n\n${'Large claim. '.repeat(80)}\n` });
      const snapshots = await listBacklogItemSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = JSON.parse(source.sourceText) as { openItems: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };

      expect(packet.openItems).toHaveLength(500);
      for (const snapshot of snapshots) {
        const projected = packet.openItems.find((item) => item.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });

  it('records origin, relative path, body hash, record hash, and updated preconditions', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', updated: '2026-01-01T00:00:00.000Z', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      await writeBacklogEpic(cwd, { id: 'epic-1', status: 'candidate', updated: '2026-01-02T00:00:00.000Z', body: '# Epic 1\n\n## Goal\n\nGoal\n' });
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<{ id: string; precondition: Record<string, string> }>; openEpics: Array<{ id: string; precondition: Record<string, string> }> };

      expect(packet.openItems[0]?.precondition).toMatchObject({ origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/items/item-1.md', updated: '2026-01-01T00:00:00.000Z', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(packet.openEpics[0]?.precondition).toMatchObject({ origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/epics/epic-1.md', updated: '2026-01-02T00:00:00.000Z', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    });
  });

  it('includes freshness metadata and dependency status details for planner noise control', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'open-dep', status: 'planned', body: '# Open dependency\n' });
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', last_checked: '2026-01-01', stale_after: '2026-02-01', depends_on: ['open-dep', 'closed-dep', 'missing-dep'], recheck_notes: 'Recheck only after product direction changes.', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openItems: Array<Record<string, unknown>>; dependencyDetails: Array<{ itemId: string; openDependsOn: Array<Record<string, unknown>>; closedDependsOn: Array<Record<string, unknown>>; missingDependsOn: Array<Record<string, unknown>> }> };
      const details = packet.dependencyDetails.find((entry) => entry.itemId === 'item-1');

      expect(packet.openItems.find((item) => item.id === 'item-1')).toMatchObject({ id: 'item-1', last_checked: '2026-01-01', stale_after: '2026-02-01', recheck_notes: 'Recheck only after product direction changes.' });
      expect(details).toMatchObject({
        itemId: 'item-1',
        openDependsOn: [{ id: 'open-dep', title: 'Open dependency', status: 'planned' }],
        closedDependsOn: [{ id: 'closed-dep', title: 'Closed dependency', status: 'shipped' }],
        missingDependsOn: [{ id: 'missing-dep' }],
      });
      expect(packet).not.toHaveProperty('dependencies');
    });
  });

  it('changes the source fingerprint when item bodies or roadmap evidence changes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const first = await buildBacklogCurationSource(cwd);
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nChanged claim\n' });
      const afterBodyChange = await buildBacklogCurationSource(cwd);
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs', 'roadmap.md'), '# Roadmap\n\n## Next\n\nCurate all backlog items.\n');
      const afterRoadmapChange = await buildBacklogCurationSource(cwd);

      expect(afterBodyChange.sourceFingerprint).not.toBe(first.sourceFingerprint);
      expect(afterRoadmapChange.sourceFingerprint).not.toBe(afterBodyChange.sourceFingerprint);
    });
  });

  it('retains every visible open epic and precondition when the backlog exceeds planner bounds', async () => {
    await withTempProject(async (cwd) => {
      for (let index = 0; index < 12; index += 1) await writeBacklogEpic(cwd, { id: `epic-${index}`, status: 'candidate', body: `# Epic ${index}\n\n## Goal\n\nGoal ${index}\n` });
      const snapshots = await listBacklogEpicSnapshots(cwd);
      const source = await buildBacklogCurationSource(cwd);
      const packet = source.source as { openEpics: Array<{ id: string; precondition: { bodySha256: string; recordSha256: string } }> };
      expect(packet.openEpics.map((epic) => epic.id)).toHaveLength(12);
      for (const snapshot of snapshots) {
        const projected = packet.openEpics.find((epic) => epic.id === snapshot.id);
        expect(projected?.precondition.bodySha256).toBe(snapshot.bodySha256);
        expect(projected?.precondition.recordSha256).toBe(snapshot.recordSha256);
      }
    });
  });
});
