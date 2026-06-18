import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BacklogItem } from '../backlog-domain.js';
import { classifyBacklogCurationEvidence } from '../backlog-curation-evidence-classification.js';
import { collectGitHistoryRecordsForRange } from '../shipped-evidence-git.js';
import type { GitHistoryRecord, ShippedEvidencePrMetadata } from '../shipped-evidence-types.js';

const execFile = promisify(execFileCallback);

const item = (id: string, title: string): BacklogItem => ({ id, title, status: 'candidate', tags: [], depends_on: [], body: `# ${title}\n` });

describe('backlog curation evidence classification', () => {
  it('projects deterministic matchedBy signals and shipped evidence prefix', async () => {
    const record = historyRecord({ subject: 'Merge pull request #12 from owner/feature/ship-widget', prNumbers: [12], branchHints: ['owner/feature/ship-widget'], changedPaths: ['src/ship-widget.ts'] });
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('ship-widget', 'Ship Widget')], gitHistory: { records: [record], diagnostics: [] }, caps: { excerptCount: 0 }, pullRequests: [pr({ number: 12, title: 'Ship Widget', body: 'Completes ship-widget.', changedPaths: ['src/ship-widget.ts'] })] });

    expect(result.affectedItemCandidates[0]).toMatchObject({ itemId: 'ship-widget', intent: 'shipped', confidence: 'strong' });
    expect(result.affectedItemCandidates[0]?.matchedBy).toEqual(expect.arrayContaining(['item-id', 'item-title', 'item-slug', 'changed-path', 'branch-hint', 'pr-number', 'pr-title', 'pr-body', 'pr-file', 'merge-subject']));
    expect(result.affectedItemCandidates[0]?.evidence).toMatch(/^Shipped evidence: inferred from git\/PR history — /);
  });

  it('classifies explicit obsolete wording as superseded and non-closing matches as affected', async () => {
    const superseded = historyRecord({ subject: 'obsolete old-flow because new-flow replaced it', changedPaths: ['src/old-flow.ts'] });
    const affected = historyRecord({ subject: 'refactor old-flow internals', changedPaths: ['src/old-flow.ts'] });
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('old-flow', 'Old Flow')], gitHistory: { records: [superseded, affected], diagnostics: [] }, caps: { excerptCount: 0 } });

    expect(result.affectedItemCandidates.some((candidate) => candidate.intent === 'superseded' && candidate.evidence.startsWith('Superseded evidence: inferred from git/PR history — '))).toBe(true);
    expect(result.affectedItemCandidates.some((candidate) => candidate.intent === 'affected' && candidate.confidence === 'medium')).toBe(true);
  });

  it('keeps lifecycle verbs embedded in item slugs as non-closing affected evidence', async () => {
    const records = [
      historyRecord({ subject: 'refactor ship-widget internals', changedPaths: ['src/ship-widget.ts'], isMerge: false, parents: ['a'] }),
      historyRecord({ subject: 'update release-notes examples', changedPaths: ['docs/release-notes.md'], isMerge: false, parents: ['a'] }),
      historyRecord({ subject: 'refactor merge-tool internals', changedPaths: ['src/merge-tool.ts'], isMerge: false, parents: ['a'] }),
    ];
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('ship-widget', 'Ship Widget'), item('release-notes', 'Release Notes'), item('merge-tool', 'Merge Tool')], gitHistory: { records, diagnostics: [] }, caps: { excerptCount: 0 } });

    expect(result.affectedItemCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'ship-widget', intent: 'affected' }),
      expect.objectContaining({ itemId: 'release-notes', intent: 'affected' }),
      expect.objectContaining({ itemId: 'merge-tool', intent: 'affected' }),
    ]));
    expect(result.affectedItemCandidates.some((candidate) => candidate.evidence.startsWith('Shipped evidence:'))).toBe(false);
  });

  it('does not use stale merged PR metadata as closure intent for unrelated scanned commits', async () => {
    const record = historyRecord({ subject: 'touch stale-pr-item internals', prNumbers: [44], changedPaths: ['src/stale-pr-item.ts'], isMerge: false, parents: ['a'] });
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('stale-pr-item', 'Stale PR Item')], gitHistory: { records: [record], diagnostics: [] }, caps: { excerptCount: 0 }, pullRequests: [pr({ number: 44, title: 'Stale PR Item', state: 'MERGED', mergedAt: '2026-01-01T00:00:00.000Z', mergeCommitOid: 'unreachable'.padEnd(40, '0') })] });

    expect(result.affectedItemCandidates[0]).toMatchObject({ itemId: 'stale-pr-item', intent: 'affected', confidence: 'medium' });
    expect(result.affectedItemCandidates[0]?.evidence).not.toMatch(/^Shipped evidence:/);
  });

  it('routes broad superseded closure wording to ambiguous candidates', async () => {
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('api-ui', 'API UI')], gitHistory: { records: [historyRecord({ subject: 'obsolete api ui experiment' })], diagnostics: [] }, caps: { excerptCount: 0 } });

    expect(result.affectedItemCandidates[0]).toMatchObject({ intent: 'ambiguous-superseded', confidence: 'ambiguous' });
    expect(result.affectedItemCandidates[0]?.evidence).toMatch(/^Ambiguous superseded candidate: needs input — /);
  });

  it('uses bounded file excerpts as a deterministic match signal before ranking candidates', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      const base = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeFile(join(cwd, 'src-unrelated.ts'), 'This file implements excerpt-widget and marks it complete.\n');
      await git(cwd, ['add', 'src-unrelated.ts']);
      await git(cwd, ['commit', '-m', 'complete excerpt widget implementation']);
      const gitHistory = await collectGitHistoryRecordsForRange(cwd, { revisionRange: `${base}..HEAD`, maxCount: 5 }, { excerptCount: 2, excerptBytes: 160 });

      const result = await classifyBacklogCurationEvidence({ cwd, items: [item('excerpt-widget', 'Excerpt Widget')], gitHistory, caps: { excerptCount: 2, excerptBytes: 160 } });

      expect(result.affectedItemCandidates[0]).toMatchObject({ itemId: 'excerpt-widget', intent: 'shipped', confidence: 'strong' });
      expect(result.affectedItemCandidates[0]?.matchedBy).toEqual(expect.arrayContaining(['item-title', 'bounded-excerpt']));
      expect(result.affectedItemCandidates[0]?.excerpts[0]?.text).toContain('excerpt-widget');
    });
  });

  it('turns equal-score closure ties into ambiguous candidates with deterministic ordering', async () => {
    const record = historyRecord({ subject: 'ship alpha-widget beta-widget', changedPaths: ['src/shared.ts'] });
    const result = await classifyBacklogCurationEvidence({ cwd: process.cwd(), items: [item('alpha-widget', 'Alpha Widget'), item('beta-widget', 'Beta Widget')], gitHistory: { records: [record], diagnostics: [] }, caps: { excerptCount: 0 } });

    expect(result.affectedItemCandidates.map((candidate) => candidate.itemId)).toEqual(['alpha-widget', 'beta-widget']);
    expect(result.affectedItemCandidates).toEqual([
      expect.objectContaining({ intent: 'ambiguous-shipped', confidence: 'ambiguous', evidence: expect.stringMatching(/^Ambiguous shipped candidate: needs input — /) }),
      expect.objectContaining({ intent: 'ambiguous-shipped', confidence: 'ambiguous', evidence: expect.stringMatching(/^Ambiguous shipped candidate: needs input — /) }),
    ]);
  });
});

function historyRecord(overrides: Partial<GitHistoryRecord>): GitHistoryRecord {
  return { source: 'git-history', hash: `${Math.random()}`.padEnd(40, 'a').slice(0, 40), shortHash: 'abcdef1', subject: 'subject', parents: ['a', 'b'], isMerge: true, prNumbers: [], branchHints: [], changedPaths: [], ...overrides };
}

function pr(overrides: Partial<ShippedEvidencePrMetadata> & { number: number }): ShippedEvidencePrMetadata {
  return { source: 'pr-history', number: overrides.number, changedPaths: [], ...overrides };
}

async function withTempDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-evidence-classification-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout).trim();
}
