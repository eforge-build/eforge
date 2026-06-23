import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX,
  BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX,
  BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX,
  BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX,
  BACKLOG_CURATION_PACKET_MAX_BYTES,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceGlobalContext,
} from '@eforge-build/client';
import { buildBacklogCurationSource } from '../backlog-curation-source.js';
import { buildBacklogCurationReducerInput, byteLength, computeBacklogCurationPacketSha256 } from '../backlog-curation-packets.js';
import { writeBacklogItem } from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-packets-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('backlog curation map/reduce packets', () => {
  it('builds exactly one packet or degraded outcome for every open item within caps', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'dep-open', status: 'candidate', body: '# Open Dep\n' });
      await writeBacklogItem(cwd, { id: 'dep-closed', status: 'shipped', body: '# Closed Dep\n' });
      await writeBacklogItem(cwd, { id: 'item-a', status: 'candidate', depends_on: ['dep-open', 'dep-closed', 'missing-dep'], body: '# Item A\n\n## Claim\n\nAlpha body.\n' });
      await writeBacklogItem(cwd, { id: 'item-b', status: 'planned', body: '# Item B\n\n## Claim\n\nBeta body.\n' });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const bundle = source.backlogCurationMapReduce;

      expect(bundle.packets.length + bundle.degradedOutcomes.length).toBe(3);
      for (const packet of bundle.packets) {
        expect(byteLength(packet)).toBeLessThanOrEqual(BACKLOG_CURATION_PACKET_MAX_BYTES);
        expect(packet.dependencyFacts.length).toBeLessThanOrEqual(BACKLOG_CURATION_DEPENDENCY_FACTS_PER_ITEM_MAX);
        expect(packet.currentSourceCitations.length).toBeLessThanOrEqual(BACKLOG_CURATION_CITATIONS_PER_ITEM_MAX);
        expect(packet.historicalHints.length).toBeLessThanOrEqual(BACKLOG_CURATION_HISTORICAL_HINTS_PER_ITEM_MAX);
        expect(packet.diagnostics.length).toBeLessThanOrEqual(BACKLOG_CURATION_DIAGNOSTICS_PER_PACKET_MAX);
      }
    });
  });

  it('keeps packet hashes stable for unchanged backlog and source inputs', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'stable-item', status: 'candidate', body: '# Stable Item\n\n## Claim\n\nStable.\n' });

      const first = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const second = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const firstHashes = first.backlogCurationMapReduce.packets.map(computeBacklogCurationPacketSha256);
      const secondHashes = second.backlogCurationMapReduce.packets.map(computeBacklogCurationPacketSha256);

      expect(firstHashes).toEqual(secondHashes);
    });
  });

  it('shrinks oversized reducer global context to fit the byte cap', () => {
    const sourceFingerprint = 'a'.repeat(64);
    const globalContext: BacklogCurationMapReduceGlobalContext = {
      schemaVersion: 1,
      purpose: 'backlog-curation-map-reduce',
      sourceFingerprint,
      curationGuidance: Array.from({ length: 8 }, () => 'g'.repeat(1_200)),
      caps: {},
      itemCount: 1_000,
      openItemIds: Array.from({ length: 1_000 }, (_, index) => `item-${index}-${'x'.repeat(300)}`),
      roadmapSummaries: Array.from({ length: 20 }, (_, index) => ({ id: `roadmap-${index}`, summary: 'r'.repeat(500) })),
      dependencySummaries: Array.from({ length: 50 }, (_, index) => ({ id: `dep-${index}`, summary: 'd'.repeat(500) })),
      recommendationSummaries: Array.from({ length: 50 }, (_, index) => ({ id: `rec-${index}`, summary: 's'.repeat(500) })),
      diagnostics: [],
    };

    const reducer = buildBacklogCurationReducerInput(globalContext, []);

    expect(byteLength(reducer)).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(reducer.diagnostics.some((diagnostic) => diagnostic.code === 'reducer-input-global-context-truncated')).toBe(true);
  });

  it('includes item preconditions with body and record hashes plus source fingerprint', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'precondition-item', status: 'candidate', body: '# Preconditions\n' });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packet = source.backlogCurationMapReduce.packets.find((entry) => entry.itemId === 'precondition-item');

      expect(packet).toMatchObject({ kind: 'item', bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(packet?.precondition).toMatchObject({ kind: 'item', sourceFingerprint: source.sourceFingerprint, bodySha256: packet?.bodySha256, recordSha256: packet?.recordSha256 });
    });
  });

  it('does not leak unrelated item bodies into another item packet', async () => {
    await withTempProject(async (cwd) => {
      const uniqueBody = 'UNIQUE-BODY-STRING-FROM-ITEM-B-ONLY';
      await writeBacklogItem(cwd, { id: 'item-a', status: 'candidate', body: '# Item A\n\n## Claim\n\nAlpha only.\n' });
      await writeBacklogItem(cwd, { id: 'item-b', status: 'candidate', body: `# Item B\n\n## Claim\n\n${uniqueBody}\n` });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const packetA = source.backlogCurationMapReduce.packets.find((entry) => entry.itemId === 'item-a');

      expect(JSON.stringify(packetA)).not.toContain(uniqueBody);
    });
  });
});
