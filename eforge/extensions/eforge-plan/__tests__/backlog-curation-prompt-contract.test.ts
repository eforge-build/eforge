import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES, type BacklogCurationMapReduceFinding, type BacklogCurationMapReduceReducerInput } from '@eforge-build/client';
import { AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX, AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX, SHIPPED_GIT_PR_EVIDENCE_PREFIX, SHIPPED_LIFECYCLE_EVIDENCE_PREFIX, SUPERSEDED_GIT_PR_EVIDENCE_PREFIX, SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX } from '../backlog-curation-evidence-prefixes.js';
import { resolveBacklogReducerAgentTask } from '../backlog-curation-agent-tasks.js';

const PROMPT_PATH = join(process.cwd(), 'eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md');
const REDUCER_PROMPT_PATH = join(process.cwd(), 'eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-reducer.md');

describe('backlog curation prompt evidence contract', () => {
  it('names git-delta candidates, exact closure prefixes, ambiguous prefixes, and no-inventing evidence guidance', async () => {
    const prompt = await readFile(PROMPT_PATH, 'utf-8');

    expect(prompt).toContain('source.gitDelta.affectedItemCandidates');
    expect(prompt).toMatch(/do not invent evidence/i);
    expect(prompt).toContain(SHIPPED_LIFECYCLE_EVIDENCE_PREFIX);
    expect(prompt).toContain(SHIPPED_GIT_PR_EVIDENCE_PREFIX);
    expect(prompt).toContain(SUPERSEDED_LIFECYCLE_EVIDENCE_PREFIX);
    expect(prompt).toContain(SUPERSEDED_GIT_PR_EVIDENCE_PREFIX);
    expect(prompt).toContain(AMBIGUOUS_SHIPPED_EVIDENCE_PREFIX);
    expect(prompt).toContain(AMBIGUOUS_SUPERSEDED_EVIDENCE_PREFIX);
    expect(prompt).toMatch(/Never convert ambiguous shipped or ambiguous superseded evidence into a closed-status patch/i);
    expect(prompt).toMatch(/never substitute a shipped prefix for superseded evidence or a superseded prefix for shipped evidence/i);
  });

  it('documents reducer omitted-terminal fail-closed guidance', async () => {
    const prompt = await readFile(REDUCER_PROMPT_PATH, 'utf-8');

    expect(prompt).toContain('reducer-input-protected-terminal-omitted');
    expect(prompt).not.toContain('reducer-input-protected-terminal-omitted-too-many');
    expect(prompt).toMatch(/decision: "needs-input".*names every omitted item id and verdict|names every omitted item id and verdict.*decision: "needs-input"/s);
    expect(prompt).toMatch(/needsInput.*name every omitted item id and verdict/s);
    expect(prompt).toMatch(/fully named/i);
  });

  it('compacts reducer prompt input while preserving protected terminal closure context and omission diagnostics', () => {
    const finding = terminalFindingForPromptTest();
    const reducerInput: BacklogCurationMapReduceReducerInput = {
      schemaVersion: 1,
      sourceFingerprint: SHA,
      globalContext: { schemaVersion: 1, purpose: 'backlog-curation-map-reduce', sourceFingerprint: SHA, curationGuidance: ['curate'], caps: {}, itemCount: 1, openItemIds: ['terminal-item'], roadmapSummaries: [], dependencySummaries: [], recommendationSummaries: [], diagnostics: [] },
      outcomes: [{ schemaVersion: 1, outcome: 'audited-finding', itemId: 'terminal-item', sourceFingerprint: SHA, packetSha256: finding.packetSha256, bodySha256: finding.bodySha256, diagnostics: [], finding }],
      diagnostics: [
        { code: 'generic-diagnostic', severity: 'warning', message: 'generic '.repeat(100), path: 'generic' },
        { code: 'reducer-input-protected-terminal-omitted', severity: 'warning', message: 'Protected terminal shipped finding for terminal-item was omitted by reducer byte caps.', path: 'outcomes/terminal-item/shipped' },
        { code: 'reducer-input-protected-terminal-omitted', severity: 'warning', message: 'Protected terminal superseded finding for terminal-item-2 was omitted by reducer byte caps.', path: 'outcomes/terminal-item-2/superseded' },
      ],
    };

    const resolved = resolveBacklogReducerAgentTask({ input: { reducerInput }, onProgress: async () => {} });
    const compact = JSON.parse(resolved.variables.reducerInputJson) as BacklogCurationMapReduceReducerInput;
    const retained = compact.outcomes[0] as Extract<BacklogCurationMapReduceReducerInput['outcomes'][number], { finding: BacklogCurationMapReduceFinding }>;

    expect(Buffer.byteLength(resolved.variables.reducerInputJson, 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(compact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'reducer-input-protected-terminal-omitted', message: 'Protected terminal shipped finding for terminal-item was omitted by reducer byte caps.', path: 'outcomes/terminal-item/shipped' }),
      expect.objectContaining({ code: 'reducer-input-protected-terminal-omitted', message: 'Protected terminal superseded finding for terminal-item-2 was omitted by reducer byte caps.', path: 'outcomes/terminal-item-2/superseded' }),
    ]));
    expect(retained.finding).toMatchObject({ verdict: 'shipped', closureEvidenceRoles: expect.arrayContaining(['implementation', 'product-surface']) });
    expect(retained.finding.checkedPaths?.[0]?.path).toBe('src/terminal-item.ts');
    expect(retained.finding.citations.map((citation) => citation.kind)).toEqual(expect.arrayContaining(['implementation', 'product-surface']));
    expect(retained.finding.recommendationSignals).toEqual([]);
    expect(resolved.variables.reducerInputJson).not.toContain('RAW_GIT_DELTA_SENTINEL');
  });

  it('keeps superseded replacement citations during reducer prompt compaction', () => {
    const finding = supersededFindingForPromptTest();
    const reducerInput: BacklogCurationMapReduceReducerInput = {
      schemaVersion: 1,
      sourceFingerprint: SHA,
      globalContext: { schemaVersion: 1, purpose: 'backlog-curation-map-reduce', sourceFingerprint: SHA, curationGuidance: ['curate'], caps: {}, itemCount: 1, openItemIds: ['superseded-item'], roadmapSummaries: [], dependencySummaries: [], recommendationSummaries: [], diagnostics: [] },
      outcomes: [{ schemaVersion: 1, outcome: 'audited-finding', itemId: 'superseded-item', sourceFingerprint: SHA, packetSha256: finding.packetSha256, bodySha256: finding.bodySha256, diagnostics: [], finding }],
      diagnostics: [],
    };

    const resolved = resolveBacklogReducerAgentTask({ input: { reducerInput }, onProgress: async () => {} });
    const compact = JSON.parse(resolved.variables.reducerInputJson) as BacklogCurationMapReduceReducerInput;
    const retained = compact.outcomes[0] as Extract<BacklogCurationMapReduceReducerInput['outcomes'][number], { finding: BacklogCurationMapReduceFinding }>;

    expect(retained.finding.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product-surface' }),
      expect.objectContaining({ kind: 'current-source', matchedBy: expect.arrayContaining(['replacement']) }),
    ]));
  });
});

const SHA = 'a'.repeat(64);
const BODY_SHA = 'b'.repeat(64);

function supersededFindingForPromptTest(): BacklogCurationMapReduceFinding {
  return {
    ...terminalFindingForPromptTest(),
    itemId: 'superseded-item',
    disposition: 'change',
    verdict: 'superseded',
    closureEvidenceRoles: ['replacement', 'product-surface', 'supporting'],
    citations: [
      ...Array.from({ length: 6 }, (_, index) => ({ kind: 'supporting' as const, source: 'current-source', confidence: 'medium', path: `test/superseded-item-${index}.test.ts`, excerpt: 'supporting evidence', matchedBy: ['supporting'] })),
      { kind: 'product-surface', source: 'current-source', confidence: 'high', path: 'docs/superseded-item.md', excerpt: 'product evidence', matchedBy: ['product-surface'] },
      { kind: 'current-source', source: 'current-source', confidence: 'high', path: 'src/replacement-item.ts', excerpt: 'replacement evidence', matchedBy: ['replacement'] },
    ],
  };
}

function terminalFindingForPromptTest(): BacklogCurationMapReduceFinding {
  return {
    schemaVersion: 1,
    itemId: 'terminal-item',
    sourceFingerprint: SHA,
    packetSha256: 'c'.repeat(64),
    bodySha256: BODY_SHA,
    promptVersion: 'test-prompt',
    runtimeIdentity: { provider: 'test', modelId: 'test-model' },
    disposition: 'change',
    verdict: 'shipped',
    closureEvidenceRoles: ['implementation', 'product-surface', 'supporting'],
    checkedPaths: [{ path: 'src/terminal-item.ts', reason: 'checked implementation '.repeat(15) }],
    summary: 'terminal summary '.repeat(100),
    rationale: 'terminal rationale '.repeat(120),
    citations: [
      { kind: 'implementation', source: 'current-source', confidence: 'high', path: 'src/terminal-item.ts', excerpt: 'implementation evidence '.repeat(40), matchedBy: ['implementation'] },
      { kind: 'product-surface', source: 'current-source', confidence: 'high', path: 'docs/terminal-item.md', excerpt: 'product evidence '.repeat(40), matchedBy: ['product-surface'] },
    ],
    recommendationSignals: [{ source: 'recommendation', signal: 'RAW_GIT_DELTA_SENTINEL recommendation should be stripped for protected terminals' }],
    diagnostics: [{ code: 'finding-note', severity: 'info', message: 'diagnostic '.repeat(60) }],
  };
}
