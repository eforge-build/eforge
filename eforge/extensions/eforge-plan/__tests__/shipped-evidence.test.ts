import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BacklogItem, TraceSummary } from '../backlog-domain.js';
import { collectShippedEvidence } from '../shipped-evidence.js';
import { extractBranchHints, extractPullRequestNumbers } from '../shipped-evidence-git.js';
import { analyzeEvidenceMatch, classifyConfidence, normalizeSlug, shouldOmitWeakCandidate, tokenizeTitle } from '../shipped-evidence-matching.js';
import { enrichPullRequests, parseGitHubRemote } from '../shipped-evidence-pr.js';
import type { GitHistoryRecord, ShippedEvidenceCandidate } from '../shipped-evidence-types.js';

const execFile = promisify(execFileCallback);

async function withTempDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-shipped-evidence-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('shipped evidence matching', () => {
  it('normalizes slug and title tokens for exact item and near-title matching', () => {
    expect(normalizeSlug('Shipped Evidence Provider!')).toBe('shipped-evidence-provider');
    expect(tokenizeTitle('The Shipped Evidence Provider')).toEqual(['evidence', 'provider', 'shipped']);

    const item = backlogItem('ship-evidence-provider', 'Shipped Evidence Provider');
    const exact = analyzeEvidenceMatch({ item, record: historyRecord({ subject: 'feat(ship-evidence-provider): shipped evidence provider' }) });
    const near = analyzeEvidenceMatch({ item, record: historyRecord({ subject: 'Land shipped evidence provider workflow' }) });

    expect(exact.itemId).toBe(true);
    expect(exact.slug).toBe(true);
    expect(near.nearTitle).toBe(true);
    expect(classifyConfidence({ source: 'git-history', reachableLanding: true, signals: exact })).toBe('ambiguous');
  });

  it('detects branch-name matches, broad false positives, and weak commit-only similarities', () => {
    const item = backlogItem('branch-item', 'Detect Shipped Backlog Items');
    const branch = analyzeEvidenceMatch({ item, record: historyRecord({ subject: 'Merge pull request #191 from owner/detect-shipped-backlog-items' }) });
    expect(branch.branchName).toBe(true);

    const broad = analyzeEvidenceMatch({ item: backlogItem('api-ui', 'API UI'), record: historyRecord({ subject: 'update api ui tests' }) });
    expect(broad.broadOnly).toBe(true);
    expect(classifyConfidence({ source: 'git-history', reachableLanding: true, signals: broad })).toBe('weak');

    const weak = analyzeEvidenceMatch({ item, record: historyRecord({ subject: 'mention shipped backlog wording in docs' }) });
    expect(classifyConfidence({ source: 'git-history', reachableLanding: false, signals: weak })).toBe('weak');
  });

  it('keeps stale or unreachable PR evidence weak', () => {
    const item = backlogItem('stale-pr', 'Stale PR Record');
    const signals = analyzeEvidenceMatch({ item, lifecycleText: 'PR https://github.com/acme/repo/pull/44 stale-pr pr-open' });
    expect(classifyConfidence({ source: 'lifecycle-trace', reachableLanding: false, staleOrUnreachablePr: true, signals })).toBe('weak');
  });
});

describe('shipped evidence git collection', () => {
  it('returns a strong git-history candidate from a reachable no-ff merge commit', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await git(cwd, ['checkout', '-b', 'feature/ship-evidence-provider']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src', 'shipped-evidence-provider.ts'), 'export const note = "Shipped Evidence Provider item ship-evidence-provider";\n');
      await git(cwd, ['add', 'src/shipped-evidence-provider.ts']);
      await git(cwd, ['commit', '-m', 'feat(ship-evidence-provider): shipped evidence provider']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/ship-evidence-provider', '-m', 'Merge pull request #191 from owner/feature/ship-evidence-provider']);

      const result = await collectShippedEvidence({
        cwd,
        items: [backlogItem('ship-evidence-provider', 'Shipped Evidence Provider')],
        caps: { candidateCount: 5, changedPathCount: 2, excerptCount: 1, excerptBytes: 80 },
        enrichPullRequests: false,
      });

      const strongCandidate = result.candidates.find((candidate) => candidate.confidence === 'strong');
      expect(strongCandidate).toMatchObject({ itemId: 'ship-evidence-provider', confidence: 'strong', source: 'git-history' });
      expect(strongCandidate?.commit?.shortHash).toMatch(/^[a-f0-9]{7,12}$/);
      expect(strongCandidate?.commit?.subject).toContain('Merge pull request #191');
      expect(strongCandidate?.changedPaths).toContain('src/shipped-evidence-provider.ts');
      expect(strongCandidate?.citation).toContain('git ');
      expect(strongCandidate?.excerpts[0]?.text.length).toBeLessThanOrEqual(80);
      expect(strongCandidate?.excerpts[0]?.text).not.toContain('@@');
    });
  });

  it('caps candidates, paths, excerpts, excerpt bytes, and PR enrichments', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await git(cwd, ['checkout', '-b', 'feature/capped-item']);
      for (const path of ['src/capped-item-a.ts', 'src/capped-item-b.ts', 'src/capped-item-c.ts']) {
        await mkdir(join(cwd, 'src'), { recursive: true });
        await writeFile(join(cwd, path), `Capped Item ${path} ${'x'.repeat(200)}\n`);
      }
      await git(cwd, ['add', 'src']);
      await git(cwd, ['commit', '-m', 'feat(capped-item): capped item']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/capped-item', '-m', 'Merge pull request #222 from owner/feature/capped-item']);

      const result = await collectShippedEvidence({
        cwd,
        items: [backlogItem('capped-item', 'Capped Item'), backlogItem('other-capped-item', 'Other Capped Item')],
        caps: { candidateCount: 1, changedPathCount: 1, excerptCount: 1, excerptBytes: 40, prEnrichmentCount: 0 },
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.changedPaths.length).toBeLessThanOrEqual(1);
      expect(result.candidates[0]?.excerpts.length).toBeLessThanOrEqual(1);
      expect(result.candidates[0]?.excerpts.every((excerpt) => excerpt.text.length <= 40)).toBe(true);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'capExceeded')).toBe(true);

      const enrichment = await enrichPullRequests({ cwd, numbers: [1, 2], caps: { prEnrichmentCount: 0 } });
      expect(enrichment.pullRequests).toEqual([]);
      expect(enrichment.diagnostics.some((diagnostic) => diagnostic.code === 'capExceeded')).toBe(true);
    });
  });
});

describe('shipped evidence lifecycle and git diagnostics', () => {
  it('converts supplied lifecycle trace landing rows into bounded candidates', async () => {
    await withTempDir(async (cwd) => {
      const result = await collectShippedEvidence({
        cwd,
        items: [backlogItem('trace-item', 'Trace Item')],
        traceSummaries: [traceSummary('trace-item', {
          kind: 'landing',
          stage: 'landing',
          status: 'merged',
          label: 'trace-item merged from feature/trace-item',
          commitSha: '1234567890abcdef',
          path: 'src/trace-item.ts',
        })],
        caps: { excerptBytes: 32 },
        enrichPullRequests: false,
      });

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'gitUnavailable')).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ itemId: 'trace-item', source: 'lifecycle-trace', confidence: 'strong', changedPaths: ['src/trace-item.ts'] });
      expect(result.candidates[0]?.commit?.shortHash).toBe('1234567890ab');
      expect(result.candidates[0]?.excerpts[0]?.text.length).toBeLessThanOrEqual(32);
    });
  });

  it('returns gitUnavailable diagnostics instead of throwing outside a git worktree', async () => {
    await withTempDir(async (cwd) => {
      const result = await collectShippedEvidence({ cwd, items: [backlogItem('no-git', 'No Git')], enrichPullRequests: false });
      expect(result.candidates).toEqual([]);
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'gitUnavailable' })]));
    });
  });
});

describe('shipped evidence PR fallback', () => {
  it('returns git-only candidates when PR enrichment fails closed', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeFile(join(cwd, 'fallback-pr.ts'), 'Fallback PR Item fallback-pr\n');
      await git(cwd, ['add', 'fallback-pr.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #999999 from owner/fallback-pr']);

      const result = await collectShippedEvidence({
        cwd,
        items: [backlogItem('fallback-pr', 'Fallback PR Item')],
        caps: { subprocessTimeoutMs: 1000, prEnrichmentCount: 1, diagnosticCount: 4 },
      });
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.candidates[0]?.source).toBe('git-history');
      expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith('pr'))).toBe(true);
    });
  });

  it('parses GitHub remotes and pull request hints', () => {
    expect(parseGitHubRemote('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(parseGitHubRemote('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
    expect(extractPullRequestNumbers('Merge pull request #191 from owner/branch')).toEqual([191]);
    expect(extractBranchHints('Merge pull request #191 from owner/feature/item')).toEqual(['owner/feature/item']);
  });
});

describe('weak candidate context filtering helper', () => {
  it('identifies weak candidates for caller-side omission', () => {
    expect(shouldOmitWeakCandidate({ confidence: 'weak' } as ShippedEvidenceCandidate)).toBe(true);
    expect(shouldOmitWeakCandidate({ confidence: 'ambiguous' } as ShippedEvidenceCandidate)).toBe(false);
  });
});

function backlogItem(id: string, title: string): BacklogItem {
  return { id, title, status: 'candidate', tags: [], depends_on: [], body: `# ${title}\n` };
}

function traceSummary(itemId: string, landingRow: Partial<TraceSummary['landingRefs'][number]>): TraceSummary {
  const row = {
    kind: 'landing',
    stage: 'landing',
    status: 'merged',
    label: `${itemId} merged`,
    affectedItemIds: [itemId],
    ...landingRow,
  };
  return {
    itemId,
    hasActiveSessionPlan: false,
    hasActiveQueuePrd: false,
    hasActiveBuildRun: false,
    hasActiveBuildSession: false,
    hasActiveTrace: false,
    activeReasons: [],
    lifecycleState: 'shipped',
    linkRows: [],
    prRefs: [],
    landingRefs: [row],
    failureEvidence: [],
  };
}

function historyRecord(overrides: Partial<GitHistoryRecord>): GitHistoryRecord {
  const text = `${overrides.subject ?? ''}\n${overrides.body ?? ''}`;
  return {
    source: 'git-history',
    hash: 'abcdef123456',
    shortHash: 'abcdef1',
    subject: 'subject',
    parents: ['parent'],
    isMerge: false,
    changedPaths: [],
    ...overrides,
    prNumbers: overrides.prNumbers ?? extractPullRequestNumbers(text),
    branchHints: overrides.branchHints ?? extractBranchHints(text),
  };
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}
