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
  safeParseBacklogCurationMapReduceSourceBundle,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceGlobalContext,
  type BacklogCurationMapReduceItemOutcome,
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

  it('keeps packet metadata within the source bundle schema caps', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, {
        id: 'long-metadata-item',
        status: 'candidate',
        evidence_notes: 'Evidence note. '.repeat(80),
        recheck_notes: 'Recheck note. '.repeat(80),
        body: '# Long Metadata Item\n\n## Claim\n\nMetadata must fit schema caps.\n',
      });

      const source = await buildBacklogCurationSource(cwd, undefined, { enrichPullRequests: false });
      const parsed = safeParseBacklogCurationMapReduceSourceBundle(source.backlogCurationMapReduce);

      expect(parsed.success).toBe(true);
      const packet = source.backlogCurationMapReduce.packets.find((entry) => entry.itemId === 'long-metadata-item');
      expect(String(packet?.metadata.evidence_notes).length).toBeLessThanOrEqual(500);
      expect(String(packet?.metadata.recheck_notes).length).toBeLessThanOrEqual(500);
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

  it('retains a late shipped terminal finding when lower-priority outcomes exceed the reducer cap', () => {
    const outcomes = [...Array.from({ length: 180 }, (_, index) => findingOutcome(`low-${index}`, { verdict: 'still-needed', disposition: 'recheck' })), findingOutcome('late-shipped', { verdict: 'shipped', disposition: 'change' })];

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes(outcomes), outcomes);

    expect(byteLength(reducer)).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(reducer.outcomes.find((outcome) => outcome.itemId === 'late-shipped')).toMatchObject({ outcome: 'audited-finding', finding: { disposition: 'change', verdict: 'shipped' } });
  });

  it('retains a late superseded terminal finding when lower-priority outcomes exceed the reducer cap', () => {
    const outcomes = [...Array.from({ length: 180 }, (_, index) => findingOutcome(`recheck-${index}`, { verdict: 'still-needed', disposition: 'recheck' })), findingOutcome('late-superseded', { verdict: 'superseded', disposition: 'change' })];

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes(outcomes), outcomes);

    expect(byteLength(reducer)).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(reducer.outcomes.find((outcome) => outcome.itemId === 'late-superseded')).toMatchObject({ outcome: 'audited-finding', finding: { disposition: 'change', verdict: 'superseded' } });
  });

  it('protects a late cache-hit terminal finding under reducer byte pressure', () => {
    const terminal = { ...findingOutcome('late-cache-shipped', { verdict: 'shipped', disposition: 'change' }), outcome: 'cache-hit' as const };
    const outcomes = [...Array.from({ length: 180 }, (_, index) => findingOutcome(`cache-low-${index}`, { verdict: 'still-needed', disposition: 'recheck' })), terminal];

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes(outcomes), outcomes);
    const retainedIds = new Set(reducer.outcomes.map((outcome) => outcome.itemId));
    const terminalDiagnostics = reducer.diagnostics.filter((diagnostic) => diagnostic.code === 'reducer-input-protected-terminal-omitted');

    expect(byteLength(reducer)).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(retainedIds.has('late-cache-shipped') || terminalDiagnostics.some((diagnostic) => diagnostic.path === 'outcomes/late-cache-shipped/shipped')).toBe(true);
  });

  it('prioritizes protected terminal outcomes over lower-value outcomes under byte pressure', () => {
    const lowerValue: BacklogCurationMapReduceItemOutcome[] = [
      ...Array.from({ length: 120 }, (_, index) => findingOutcome(`partial-${index}`, { verdict: 'partial', disposition: 'recheck' })),
      invalidOutcome('invalid-lower'),
      failureOutcome('failure-lower'),
      oversizedOutcome('oversized-lower'),
    ];
    const terminal = findingOutcome('terminal-priority', { verdict: 'shipped', disposition: 'change' });

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes([...lowerValue, terminal]), [...lowerValue, terminal]);

    const retainedIds = new Set(reducer.outcomes.map((outcome) => outcome.itemId));

    expect(byteLength(reducer)).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(reducer.outcomes.length).toBeLessThan(lowerValue.length + 1);
    expect(reducer.outcomes[0]).toMatchObject({ itemId: 'terminal-priority', finding: { verdict: 'shipped' } });
    expect(retainedIds.has('terminal-priority')).toBe(true);
    expect(lowerValue.some((outcome) => !retainedIds.has(outcome.itemId))).toBe(true);
  });

  it('keeps closure-critical fields on retained terminal findings after reducer compaction', () => {
    const terminal = findingOutcome('compact-terminal', { verdict: 'superseded', disposition: 'change' });
    const outcomes = [...Array.from({ length: 180 }, (_, index) => findingOutcome(`noise-${index}`, { verdict: 'still-needed', disposition: 'recheck' })), terminal];

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes(outcomes), outcomes);
    const retained = reducer.outcomes.find((outcome) => outcome.itemId === 'compact-terminal') as Extract<BacklogCurationMapReduceItemOutcome, { finding: BacklogCurationMapReduceFinding }> | undefined;

    expect(retained?.packetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(retained?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(retained?.finding).toMatchObject({ itemId: 'compact-terminal', disposition: 'change', verdict: 'superseded', closureEvidenceRoles: expect.arrayContaining(['replacement', 'product-surface']) });
    expect(retained?.finding.summary.length).toBeGreaterThan(0);
    expect(retained?.finding.rationale.length).toBeGreaterThan(0);
    expect(retained?.finding.checkedPaths?.length).toBeGreaterThan(0);
    expect(retained?.finding.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product-surface' }),
      expect.objectContaining({ kind: 'current-source', matchedBy: expect.arrayContaining(['replacement']) }),
    ]));
  });

  it('emits named diagnostics when protected terminal findings cannot all fit', () => {
    const outcomes = Array.from({ length: 60 }, (_, index) => findingOutcome(`terminal-${index}`, { verdict: index % 2 === 0 ? 'shipped' : 'superseded', disposition: 'change' }));

    const reducer = buildBacklogCurationReducerInput(globalContextForOutcomes(outcomes), outcomes);
    const terminalDiagnostics = reducer.diagnostics.filter((diagnostic) => diagnostic.code === 'reducer-input-protected-terminal-omitted');
    const retainedIds = new Set(reducer.outcomes.map((outcome) => outcome.itemId));
    const omitted = outcomes.filter((outcome) => !retainedIds.has(outcome.itemId));

    expect(omitted.length).toBeGreaterThan(0);
    expect(terminalDiagnostics.length).toBe(omitted.length);
    for (const outcome of omitted) {
      const verdict = outcome.outcome === 'audited-finding' ? outcome.finding.verdict : undefined;
      expect(terminalDiagnostics).toContainEqual(expect.objectContaining({
        message: expect.stringContaining(`Protected terminal ${verdict} finding for ${outcome.itemId}`),
        path: `outcomes/${outcome.itemId}/${verdict}`,
      }));
    }
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

const TEST_SHA = 'a'.repeat(64);
const TEST_BODY_SHA = 'b'.repeat(64);

function globalContextForOutcomes(outcomes: readonly BacklogCurationMapReduceItemOutcome[]): BacklogCurationMapReduceGlobalContext {
  return {
    schemaVersion: 1,
    purpose: 'backlog-curation-map-reduce',
    sourceFingerprint: TEST_SHA,
    curationGuidance: ['Curate under byte caps.'],
    caps: {},
    itemCount: outcomes.length,
    openItemIds: outcomes.map((outcome) => outcome.itemId),
    roadmapSummaries: [],
    dependencySummaries: [],
    recommendationSummaries: [],
    diagnostics: [],
  };
}

function findingOutcome(itemId: string, options: { verdict: BacklogCurationMapReduceFinding['verdict']; disposition: BacklogCurationMapReduceFinding['disposition'] }): BacklogCurationMapReduceItemOutcome {
  const finding: BacklogCurationMapReduceFinding = {
    schemaVersion: 1,
    itemId,
    sourceFingerprint: TEST_SHA,
    packetSha256: shaFor(`${itemId}:packet`),
    bodySha256: TEST_BODY_SHA,
    promptVersion: 'test-prompt',
    runtimeIdentity: { provider: 'test', modelId: 'test-model' },
    disposition: options.disposition,
    verdict: options.verdict,
    closureEvidenceRoles: options.verdict === 'superseded' ? ['replacement', 'product-surface', 'supporting'] : ['implementation', 'product-surface', 'supporting'],
    checkedPaths: [{ path: `src/${itemId}.ts`, reason: 'current source checked ' + 'x'.repeat(220) }],
    summary: `${itemId} summary. ${'s'.repeat(1_800)}`,
    rationale: `${itemId} rationale. ${'r'.repeat(2_800)}`,
    citations: options.verdict === 'superseded' ? [
      ...Array.from({ length: 8 }, (_, index) => ({ kind: 'supporting' as const, source: 'current-source', confidence: 'medium', path: `test/${itemId}-${index}.test.ts`, excerpt: 'supporting '.repeat(80), matchedBy: ['supporting'] })),
      { kind: 'product-surface', source: 'current-source', confidence: 'high', path: `docs/${itemId}.md`, excerpt: 'product surface '.repeat(80), matchedBy: ['product-surface'] },
      { kind: 'current-source', source: 'current-source', confidence: 'high', path: `src/${itemId}-replacement.ts`, excerpt: 'replacement '.repeat(80), matchedBy: ['replacement'] },
    ] : [
      { kind: 'implementation', source: 'current-source', confidence: 'high', path: `src/${itemId}.ts`, excerpt: 'implementation '.repeat(80), matchedBy: ['implementation'] },
      { kind: 'product-surface', source: 'current-source', confidence: 'high', path: `docs/${itemId}.md`, excerpt: 'product surface '.repeat(80), matchedBy: ['product-surface'] },
      { kind: 'supporting', source: 'current-source', confidence: 'medium', path: `test/${itemId}.test.ts`, excerpt: 'supporting '.repeat(80), matchedBy: ['supporting'] },
    ],
    recommendationSignals: [{ source: 'recommendation', signal: 'Lower-value recommendation signal. '.repeat(20) }],
    diagnostics: [{ code: 'finding-note', severity: 'info', message: 'diagnostic '.repeat(60) }],
  };
  return { schemaVersion: 1, outcome: 'audited-finding', itemId, sourceFingerprint: TEST_SHA, packetSha256: finding.packetSha256, bodySha256: finding.bodySha256, diagnostics: [], finding };
}

function invalidOutcome(itemId: string): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: 1, outcome: 'invalid-finding', itemId, sourceFingerprint: TEST_SHA, packetSha256: shaFor(`${itemId}:packet`), bodySha256: TEST_BODY_SHA, diagnostics: [], validationErrors: ['invalid '.repeat(100)] };
}

function failureOutcome(itemId: string): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: 1, outcome: 'item-agent-failure', itemId, sourceFingerprint: TEST_SHA, packetSha256: shaFor(`${itemId}:packet`), bodySha256: TEST_BODY_SHA, diagnostics: [], error: 'failure '.repeat(300) };
}

function oversizedOutcome(itemId: string): BacklogCurationMapReduceItemOutcome {
  return { schemaVersion: 1, outcome: 'oversized-packet', itemId, sourceFingerprint: TEST_SHA, packetSha256: shaFor(`${itemId}:packet`), bodySha256: TEST_BODY_SHA, diagnostics: [], byteLength: BACKLOG_CURATION_PACKET_MAX_BYTES + 1, byteCap: BACKLOG_CURATION_PACKET_MAX_BYTES };
}

function shaFor(value: string): string {
  return Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64);
}
