import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyAcceptSuccess } from '@eforge-build/engine/recovery/accept-success';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'eforge-accept-pr-')); }
function git(cwd: string, args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf-8' }); }

function initRepo(dir: string): { repo: string; remote: string } {
  const repo = join(dir, 'repo');
  const remote = join(dir, 'remote.git');
  execFileSync('git', ['init', '--bare', remote]);
  execFileSync('git', ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  return { repo, remote };
}

function commandLogBin(dir: string, mode: 'ok' | 'merge-fail' = 'ok'): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();
  const ghScript = join(bin, 'gh');
  writeFileSync(ghScript, `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(dir)}, 'cmd.log'), JSON.stringify({ cmd: 'gh', args }) + '\\n');
fs.appendFileSync(path.join(${JSON.stringify(dir)}, 'gh.log'), JSON.stringify(args) + '\\n');
if (args[0] === '--version') process.exit(0);
if (args[0] === 'pr' && args[1] === 'create') { console.log('https://github.test/repo/pull/1'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge') { process.exit(${mode === 'merge-fail' ? 1 : 0}); }
process.exit(0);
`, { mode: 0o755 });
  chmodSync(ghScript, 0o755);
  const gitScript = join(bin, 'git');
  writeFileSync(gitScript, `#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(dir)}, 'cmd.log'), JSON.stringify({ cmd: 'git', args }) + '\\n');
const res = spawnSync(${JSON.stringify(realGit)}, args, { encoding: 'utf-8', env: process.env });
if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
if (res.error) { console.error(res.error.message); process.exit(1); }
process.exit(res.status ?? 0);
`, { mode: 0o755 });
  chmodSync(gitScript, 0o755);
  return bin;
}

function readCommandLog(dir: string): Array<{ cmd: string; args: string[] }> {
  return readFileSync(join(dir, 'cmd.log'), 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function installAdvanceMainOnFeaturePushHook(remote: string): void {
  const hook = join(remote, 'hooks', 'post-receive');
  writeFileSync(hook, `#!/bin/sh
while read old new ref; do
  if [ "$ref" = "refs/heads/eforge/accept-pr-set" ]; then
    tree=$(printf "100644 blob %s\\t%s\\n" "$(printf 'late remote base\\n' | git hash-object -w --stdin)" "late-base.txt" | git mktree)
    commit=$(printf 'late remote base\\n' | env GIT_AUTHOR_NAME='Test' GIT_AUTHOR_EMAIL='test@example.com' GIT_COMMITTER_NAME='Test' GIT_COMMITTER_EMAIL='test@example.com' git commit-tree "$tree" -p refs/heads/main)
    git update-ref refs/heads/main "$commit"
  fi
done
`, { mode: 0o755 });
  chmodSync(hook, 0o755);
}

async function seed(repo: string, prdId = 'accept-pr') {
  const setName = `${prdId}-set`;
  const feature = `eforge/${setName}`;
  git(repo, ['checkout', '-b', feature]);
  writeFileSync(join(repo, 'feature.txt'), 'feature\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'feature']);
  git(repo, ['checkout', 'main']);
  const failed = join(repo, '.eforge', 'queue', 'failed');
  mkdirSync(failed, { recursive: true });
  writeFileSync(join(failed, `${prdId}.md`), `---\ntitle: ${prdId}\nlanding: pr\nlanding_auto_merge: true\n---\n# ${prdId}\n`);
  writeFileSync(join(failed, `${prdId}.recovery.md`), 'recovery');
  writeFileSync(join(failed, `${prdId}.recovery.json`), JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    summary: {
      prdId, setName, featureBranch: feature, baseBranch: 'main', plans: [], failingPlan: { planId: 'plan-01' },
      landedCommits: [{ sha: 'abc', subject: 'feature', author: 'Test', date: new Date().toISOString() }],
      diffStat: '', modelsUsed: [], failedAt: new Date().toISOString(),
      acceptanceValidation: { passed: false, total: 1, pass: 0, fail: 1, unknown: 0, verdicts: [] },
      validationCommands: [{ command: 'true', exitCode: 0 }],
    },
    verdict: { verdict: 'manual', confidence: 'low', rationale: 'manual', completedWork: [], remainingWork: [], risks: [] },
  }, null, 2));
  return { queueDir: join(repo, '.eforge', 'queue'), feature };
}

async function accept(repo: string, queueDir: string, prdId = 'accept-pr', extra: Record<string, unknown> = {}) {
  return applyAcceptSuccess({ cwd: repo, prdId, queueDir, landingAction: 'pr', planOutputDir: 'eforge/plans', prAutoMergePolicy: 'ask', landingAutoMerge: true, ...extra }, {
    prdId, reasonCategory: 'other', reason: 'accepted', unblockDependentIds: [],
  });
}

describe('accepted-success direct PR landing', () => {
  it('syncs an advanced origin/main before gh pr create', async () => {
    const dir = tmp(); const { repo } = initRepo(dir); const { queueDir, feature } = await seed(repo);
    const bin = commandLogBin(dir); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      writeFileSync(join(repo, 'base.txt'), 'advanced\n'); git(repo, ['add', '-A']); git(repo, ['commit', '-m', 'advance base']); git(repo, ['push', 'origin', 'main']);
      const baseSha = git(repo, ['rev-parse', 'origin/main']).trim();
      const res = await accept(repo, queueDir);
      expect(res.applied.landing.status).toBe('complete');
      expect(git(repo, ['merge-base', feature, baseSha]).trim()).toBe(baseSha);
      const commands = readCommandLog(dir);
      const fetchIndex = commands.findIndex((entry) => entry.cmd === 'git' && entry.args[0] === 'fetch' && entry.args.includes('origin') && entry.args.includes('main'));
      const createIndex = commands.findIndex((entry) => entry.cmd === 'gh' && entry.args[0] === 'pr' && entry.args[1] === 'create');
      expect(fetchIndex).toBeGreaterThanOrEqual(0);
      expect(createIndex).toBeGreaterThan(fetchIndex);
    } finally { process.env.PATH = oldPath; }
  }, 15_000);

  it('does not invoke gh pr create when base sync fails', async () => {
    const dir = tmp(); const { repo } = initRepo(dir); const { queueDir } = await seed(repo);
    git(repo, ['remote', 'remove', 'origin']);
    const bin = commandLogBin(dir); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      const res = await accept(repo, queueDir);
      expect(res.applied.landing.status).toBe('failed');
      expect(() => readFileSync(join(dir, 'gh.log'), 'utf-8')).toThrow();
    } finally { process.env.PATH = oldPath; }
  }, 15_000);

  it('fails freshness and does not invoke gh pr create when origin/main advances after base sync', async () => {
    const dir = tmp(); const { repo, remote } = initRepo(dir); const { queueDir } = await seed(repo);
    installAdvanceMainOnFeaturePushHook(remote);
    const bin = commandLogBin(dir); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      const res = await accept(repo, queueDir);
      expect(res.applied.landing.status).toBe('failed');
      const commands = readCommandLog(dir);
      expect(commands.some((entry) => entry.cmd === 'gh' && entry.args[0] === 'pr' && entry.args[1] === 'create')).toBe(false);
    } finally { process.env.PATH = oldPath; }
  }, 15_000);

  it('records skipped and failed auto-merge audit results', async () => {
    const dir = tmp(); const { repo } = initRepo(dir); const first = await seed(repo, 'auto-skip');
    const bin = commandLogBin(dir, 'merge-fail'); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      const skipped = await accept(repo, first.queueDir, 'auto-skip', { landingAutoMerge: undefined, prAutoMergePolicy: 'ask' });
      expect(skipped.applied.landing.autoMerge).toMatchObject({ status: 'skipped' });
      const second = await seed(repo, 'auto-fail');
      const failed = await accept(repo, second.queueDir, 'auto-fail', { landingAutoMerge: true, prAutoMergePolicy: 'ask' });
      expect(failed.applied.landing.autoMerge).toMatchObject({ status: 'failed' });
    } finally { process.env.PATH = oldPath; }
  }, 15_000);
});
