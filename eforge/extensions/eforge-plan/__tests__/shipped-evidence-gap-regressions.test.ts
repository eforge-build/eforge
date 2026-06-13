import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { BacklogItem, TraceSummary } from '../backlog-domain.js';
import { collectShippedEvidence } from '../shipped-evidence.js';
import type { GitHistoryRecord } from '../shipped-evidence-types.js';
import { extractBranchHints, extractPullRequestNumbers } from '../shipped-evidence-git.js';
import { analyzeEvidenceMatch, classifyConfidence } from '../shipped-evidence-matching.js';

const execFile = promisify(execFileCallback);

async function withTempDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-shipped-gap-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('shipped evidence PRD gap regressions', () => {
  it('exposes structured PR number and branch on git-only merge candidates', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await git(cwd, ['checkout', '-b', 'feature/structured-pr-item']);
      await writeFile(join(cwd, 'structured-pr-item.ts'), 'Structured PR Item structured-pr-item\n');
      await git(cwd, ['add', 'structured-pr-item.ts']);
      await git(cwd, ['commit', '-m', 'feat: structured pr item']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/structured-pr-item', '-m', 'Merge pull request #191 from owner/feature/structured-pr-item']);

      const result = await collectShippedEvidence({
        cwd,
        items: [backlogItem('structured-pr-item', 'Structured PR Item')],
        enrichPullRequests: false,
      });
      const candidate = result.candidates.find((entry) => entry.itemId === 'structured-pr-item');

      expect(candidate).toMatchObject({ evidenceSource: 'git-history', pr: { number: 191, headRefName: 'owner/feature/structured-pr-item', changedPaths: [] } });
    });
  });

  it('lets reachable explicit PR metadata create a strong candidate when local git text does not match the item', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await git(cwd, ['checkout', '-b', 'feature/unrelated-local']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src/unrelated.ts'), 'unrelated local change\n');
      await git(cwd, ['add', 'src/unrelated.ts']);
      await git(cwd, ['commit', '-m', 'feat: unrelated local change']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/unrelated-local', '-m', 'Merge pull request #424 from owner/feature/unrelated-local']);
      const bin = await writeFakeGh(cwd, { number: 424, title: 'Ship pr-metadata-item', body: 'Completes pr-metadata-item for users.', state: 'MERGED', headRefName: 'feature/unrelated-local', files: [{ path: 'src/unrelated.ts' }] });

      const oldPath = process.env.PATH;
      process.env.PATH = `${bin}:${oldPath ?? ''}`;
      try {
        const result = await collectShippedEvidence({
          cwd,
          items: [backlogItem('pr-metadata-item', 'PR Metadata Item')],
          caps: { prEnrichmentCount: 1 },
        });
        const candidate = result.candidates.find((entry) => entry.itemId === 'pr-metadata-item');

        expect(candidate).toMatchObject({ confidence: 'strong', evidenceSource: 'combined', pr: { number: 424, title: 'Ship pr-metadata-item' } });
        expect(candidate?.commit?.subject).toContain('Merge pull request #424');
        expect(candidate?.reasons).toContain('PR metadata explicitly references item');
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });

  it('keeps merged PR metadata weak when the local record is not a landing commit or PR merge commit', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeFile(join(cwd, 'notes.md'), 'Mention PR metadata only.\n');
      await git(cwd, ['add', 'notes.md']);
      await git(cwd, ['commit', '-m', 'docs: mention PR #525']);
      const bin = await writeFakeGh(cwd, { number: 525, title: 'Ship remote-only-item', body: 'Completes remote-only-item.', state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', headRefName: 'feature/remote-only-item', files: [{ path: 'src/remote-only-item.ts' }] });

      const oldPath = process.env.PATH;
      process.env.PATH = `${bin}:${oldPath ?? ''}`;
      try {
        const result = await collectShippedEvidence({
          cwd,
          items: [backlogItem('remote-only-item', 'Remote Only Item')],
          caps: { prEnrichmentCount: 1 },
        });
        const candidate = result.candidates.find((entry) => entry.itemId === 'remote-only-item');

        expect(candidate).toMatchObject({ confidence: 'weak', pr: { number: 525, state: 'MERGED' } });
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });

  it('preserves strong lifecycle candidates when attaching stale PR metadata', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeFile(join(cwd, 'trace-pr-item.ts'), 'Trace PR Item trace-pr-item\n');
      await git(cwd, ['add', 'trace-pr-item.ts']);
      await git(cwd, ['commit', '-m', 'docs: trace-pr-item PR #526']);
      const { stdout: hash } = await execFile('git', ['rev-parse', 'HEAD'], { cwd });
      const bin = await writeFakeGh(cwd, { number: 526, title: 'Stale trace-pr-item', state: 'OPEN', headRefName: 'feature/trace-pr-item', files: [] });

      const oldPath = process.env.PATH;
      process.env.PATH = `${bin}:${oldPath ?? ''}`;
      try {
        const result = await collectShippedEvidence({
          cwd,
          items: [backlogItem('trace-pr-item', 'Trace PR Item')],
          traceSummaries: [traceSummary('trace-pr-item', hash.trim(), 'https://github.com/acme/repo/pull/526')],
          caps: { prEnrichmentCount: 1 },
        });
        const candidate = result.candidates.find((entry) => entry.itemId === 'trace-pr-item' && entry.evidenceSource === 'lifecycle');

        expect(candidate).toMatchObject({ confidence: 'strong', evidenceSource: 'lifecycle', pr: { number: 526, state: 'OPEN' } });
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });

  it('does not classify direct id plus branch-name git evidence without aligned paths or excerpts as strong', () => {
    const item = backlogItem('partial-branch-item', 'Partial Branch Item');
    const signals = analyzeEvidenceMatch({ item, record: historyRecord({ subject: 'Merge pull request #9 from owner/feature/partial-branch-item', changedPaths: [] }) });

    expect(signals.itemId || signals.slug).toBe(true);
    expect(signals.branchName).toBe(true);
    expect(signals.pathOrExcerpt).toBe(false);
    expect(classifyConfidence({ source: 'git-history', reachableLanding: true, signals })).not.toBe('strong');
  });
});

function backlogItem(id: string, title: string): BacklogItem {
  return { id, title, status: 'candidate', tags: [], depends_on: [], body: `# ${title}\n` };
}

function traceSummary(itemId: string, commitSha: string, prUrl: string): TraceSummary {
  const row: TraceSummary['landingRefs'][number] = {
    kind: 'landing',
    stage: 'landing',
    status: 'merged',
    label: `${itemId} merged`,
    affectedItemIds: [itemId],
    commitSha,
    prUrl,
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
    parents: ['a', 'b'],
    isMerge: true,
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

async function writeFakeGh(cwd: string, pr: Record<string, unknown>): Promise<string> {
  const bin = join(cwd, 'bin');
  await mkdir(bin, { recursive: true });
  const script = join(bin, 'gh');
  await writeFile(script, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(pr))});\n`);
  await chmod(script, 0o755);
  return bin;
}
