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

function fakeGh(dir: string, mode: 'ok' | 'merge-fail' = 'ok'): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = join(bin, 'gh');
  writeFileSync(script, `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(${JSON.stringify(dir)}, 'gh.log'), JSON.stringify(args) + '\\n');
if (args[0] === '--version') process.exit(0);
if (args[0] === 'pr' && args[1] === 'create') { console.log('https://github.test/repo/pull/1'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge') { process.exit(${mode === 'merge-fail' ? 1 : 0}); }
process.exit(0);
`, { mode: 0o755 });
  chmodSync(script, 0o755);
  return bin;
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
    const bin = fakeGh(dir); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      writeFileSync(join(repo, 'base.txt'), 'advanced\n'); git(repo, ['add', '-A']); git(repo, ['commit', '-m', 'advance base']); git(repo, ['push', 'origin', 'main']);
      const baseSha = git(repo, ['rev-parse', 'origin/main']).trim();
      const res = await accept(repo, queueDir);
      expect(res.applied.landing.status).toBe('complete');
      expect(git(repo, ['merge-base', feature, baseSha]).trim()).toBe(baseSha);
      expect(readFileSync(join(dir, 'gh.log'), 'utf-8')).toContain('"create"');
    } finally { process.env.PATH = oldPath; }
  });

  it('does not invoke gh pr create when base sync fails', async () => {
    const dir = tmp(); const { repo } = initRepo(dir); const { queueDir } = await seed(repo);
    git(repo, ['remote', 'remove', 'origin']);
    const bin = fakeGh(dir); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      const res = await accept(repo, queueDir);
      expect(res.applied.landing.status).toBe('failed');
      expect(() => readFileSync(join(dir, 'gh.log'), 'utf-8')).toThrow();
    } finally { process.env.PATH = oldPath; }
  });

  it('records skipped and failed auto-merge audit results', async () => {
    const dir = tmp(); const { repo } = initRepo(dir); const first = await seed(repo, 'auto-skip');
    const bin = fakeGh(dir, 'merge-fail'); const oldPath = process.env.PATH; process.env.PATH = `${bin}:${oldPath}`;
    try {
      const skipped = await accept(repo, first.queueDir, 'auto-skip', { landingAutoMerge: undefined, prAutoMergePolicy: 'ask' });
      expect(skipped.applied.landing.autoMerge).toMatchObject({ status: 'skipped' });
      const second = await seed(repo, 'auto-fail');
      const failed = await accept(repo, second.queueDir, 'auto-fail', { landingAutoMerge: true, prAutoMergePolicy: 'ask' });
      expect(failed.applied.landing.autoMerge).toMatchObject({ status: 'failed' });
    } finally { process.env.PATH = oldPath; }
  });
});
