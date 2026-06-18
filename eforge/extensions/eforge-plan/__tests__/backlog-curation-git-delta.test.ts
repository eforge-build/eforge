import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { acceptedAnalysisBaselinePath, collectBacklogCurationGitDelta, collectBacklogCurationGitDeltaWithHistory, readAcceptedAnalysisBaseline, writeAcceptedAnalysisBaseline } from '../backlog-curation-git-delta.js';
import { collectGitHistoryRecordsForRange } from '../shipped-evidence-git.js';

const execFile = promisify(execFileCallback);

async function withTempDir<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-git-delta-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('backlog curation git delta', () => {
  it('resolves, writes, and reads the accepted-analysis baseline sidecar', async () => {
    await withTempDir(async (cwd) => {
      expect(acceptedAnalysisBaselinePath(cwd)).toBe(join(cwd, '.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json'));
      expect(await readAcceptedAnalysisBaseline(cwd)).toBeNull();
      await writeAcceptedAnalysisBaseline(cwd, baseline({ headCommit: null }));
      const read = await readAcceptedAnalysisBaseline(cwd);
      expect(read).toMatchObject({ schemaVersion: 1, taskId: 'task-1', passKind: 'analyze-all', sourceFingerprint: 'fingerprint', git: { headCommit: null } });
    });
  });

  it('reports no-git directories as unavailable', async () => {
    await withTempDir(async (cwd) => {
      const delta = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
      expect(delta).toMatchObject({ currentHead: null, coverage: { kind: 'unavailable' }, scannedCommitCount: 0 });
      expect(delta.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'git-unavailable' })]));
    });
  });

  it('falls back for missing, invalid, and unreachable baselines', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await commitFile(cwd, 'README.md', 'base\n', 'initial');
      const missing = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
      expect(missing.baseline.source).toBe('missing');
      expect(missing.coverage.kind).toBe('fallback');
      expect(missing.diagnostics.some((diagnostic) => diagnostic.code === 'baseline-missing')).toBe(true);

      await writeAcceptedAnalysisBaseline(cwd, baseline({ headCommit: null }));
      await writeFile(acceptedAnalysisBaselinePath(cwd), '{ bad json');
      const invalid = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
      expect(invalid.baseline.source).toBe('invalid-sidecar');
      expect(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'baseline-invalid-sidecar')).toBe(true);

      await writeAcceptedAnalysisBaseline(cwd, baseline({ headCommit: 'f'.repeat(40) }));
      const unreachable = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
      expect(unreachable.coverage.kind).toBe('fallback');
      expect(unreachable.diagnostics.some((diagnostic) => diagnostic.code === 'baseline-unreachable')).toBe(true);
    });
  });

  it('scans the complete baseline range and detects truncation', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await commitFile(cwd, 'README.md', 'base\n', 'initial');
      const base = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeAcceptedAnalysisBaseline(cwd, baseline({ headCommit: base }));
      await commitFile(cwd, 'b.ts', 'b\n', 'feat: B');
      const b = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await commitFile(cwd, 'c.ts', 'c\n', 'feat: C');
      const c = await gitOutput(cwd, ['rev-parse', 'HEAD']);

      const complete = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
      expect(complete.baseline.source).toBe('accepted-analysis-sidecar');
      expect(complete.coverage.kind).toBe('complete');
      expect(complete.scannedCommits.map((commit) => commit.hash)).toEqual([c, b]);
      expect(complete.scannedCommits.map((commit) => commit.hash)).not.toContain(base);
      expect(complete.affectedItemCandidates).toEqual([]);

      const capped = await collectBacklogCurationGitDelta({ cwd, caps: { commitScanCount: 1 }, enrichPullRequests: false });
      expect(capped.scannedCommitCount).toBe(1);
      expect(capped.diagnostics.some((diagnostic) => diagnostic.code === 'scan-cap-truncated')).toBe(true);
    });
  });

  it('falls back with a baseline-shallow diagnostic in shallow repositories', async () => {
    await withTempDir(async (cwd) => {
      const seed = join(cwd, 'seed');
      const shallow = join(cwd, 'shallow');
      await mkdir(seed, { recursive: true });
      await initRepo(seed);
      await commitFile(seed, 'README.md', 'base\n', 'initial');
      const base = await gitOutput(seed, ['rev-parse', 'HEAD']);
      await commitFile(seed, 'later.ts', 'later\n', 'later');

      await execFile('git', ['clone', '--depth', '1', `file://${seed}`, shallow]);
      await writeAcceptedAnalysisBaseline(shallow, baseline({ headCommit: base }));
      const delta = await collectBacklogCurationGitDelta({ cwd: shallow, enrichPullRequests: false });

      expect(delta.coverage.kind).toBe('fallback');
      expect(delta.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'baseline-shallow', commit: base })]));
    });
  });

  it('applies source-visible caps to commit projection and optional PR enrichment', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await commitFile(cwd, 'README.md', 'base\n', 'initial');
      const base = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await writeAcceptedAnalysisBaseline(cwd, baseline({ headCommit: base }));
      for (const path of ['one.ts', 'two.ts', 'three.ts']) await writeFile(join(cwd, path), `${path}\n`);
      await git(cwd, ['add', 'one.ts', 'two.ts', 'three.ts']);
      await git(cwd, ['commit', '-m', 'Merge pull request #123 from owner/feature/capped-delta with an intentionally long subject #456', '-m', 'Body excerpt that should be truncated by the git delta excerpt cap.']);
      const fakeBin = join(cwd, 'fake-bin');
      await mkdir(fakeBin, { recursive: true });
      await writeFile(join(fakeBin, 'gh'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({ number: 123, title: "Capped PR metadata", url: "https://github.com/acme/repo/pull/123", state: "MERGED", headRefName: "feature/capped-delta", baseRefName: "main", mergeCommit: { oid: "abc123" }, files: [{ path: "one.ts" }, { path: "two.ts" }] }));\n');
      await chmod(join(fakeBin, 'gh'), 0o755);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
      try {
        const delta = await collectBacklogCurationGitDelta({ cwd, caps: { changedPathCount: 1, excerptBytes: 24, prEnrichmentCount: 1 }, enrichPullRequests: true });
        const [commit] = delta.scannedCommits as Array<{ subject: string; bodyExcerpt?: string; changedPaths: string[]; prNumbers: number[]; pr?: { number: number; title: string; changedPaths: string[] } }>;

        expect(delta.caps).toMatchObject({ changedPathCount: 1, excerptBytes: 24, prEnrichmentCount: 1 });
        expect(commit.subject.length).toBeLessThanOrEqual(24);
        expect(commit.bodyExcerpt?.length).toBeLessThanOrEqual(24);
        expect(commit.changedPaths).toHaveLength(1);
        expect(commit.prNumbers).toEqual([123]);
        expect(commit.pr).toMatchObject({ number: 123, title: 'Capped PR metadata', changedPaths: ['one.ts'] });
      } finally {
        process.env.PATH = previousPath;
      }
    });
  });

  it('projects PR hints and exposes reusable git history', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await commitFile(cwd, 'README.md', 'base\n', 'initial');
      await commitFile(cwd, 'pr.ts', 'pr\n', 'Merge pull request #123 from owner/feature/pr-item');
      const result = await collectBacklogCurationGitDeltaWithHistory({ cwd, enrichPullRequests: false });
      expect(result.gitHistory.records.length).toBeGreaterThan(0);
      expect(result.gitDelta.scannedCommits[0]).toMatchObject({ prNumbers: [123] });
    });
  });

  it('supports range-aware git history collection', async () => {
    await withTempDir(async (cwd) => {
      await initRepo(cwd);
      await commitFile(cwd, 'a.ts', 'a\n', 'A');
      const base = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      await commitFile(cwd, 'b.ts', 'b\n', 'B');
      const b = await gitOutput(cwd, ['rev-parse', 'HEAD']);
      const ranged = await collectGitHistoryRecordsForRange(cwd, { revisionRange: `${base}..HEAD`, maxCount: 5 }, {}, undefined);
      expect(ranged.records.map((record) => record.hash)).toEqual([b]);
    });
  });
});

function baseline(overrides: { headCommit: string | null }) {
  return { taskId: 'task-1', passKind: 'analyze-all', sourceFingerprint: 'fingerprint', acceptedAt: '2026-01-01T00:00:00.000Z', git: { headCommit: overrides.headCommit, headCommittedAt: '2026-01-01T00:00:00.000Z' }, coverage: {}, diagnostics: [] };
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
}

async function commitFile(cwd: string, path: string, content: string, message: string): Promise<void> {
  await writeFile(join(cwd, path), content);
  await git(cwd, ['add', path]);
  await git(cwd, ['commit', '-m', message]);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout).trim();
}
