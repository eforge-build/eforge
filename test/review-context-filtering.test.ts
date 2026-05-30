import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { computeReviewThresholdSnapshot } from '@eforge-build/engine/agents/parallel-reviewer';
import { computeReviewContext } from '@eforge-build/engine/agents/reviewer';
import { afterEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);

const tempDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<void> {
  await exec('git', args, { cwd });
}

async function writeRepoFile(cwd: string, path: string, content: string): Promise<void> {
  const fullPath = join(cwd, path);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content);
}

async function createReviewDiffRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-review-context-'));
  tempDirs.push(cwd);

  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
  await writeRepoFile(cwd, 'README.md', '# test repo\n');
  await git(cwd, ['add', '.']);
  await git(cwd, ['commit', '-m', 'initial']);

  await git(cwd, ['switch', '-c', 'feature']);
  await writeRepoFile(cwd, 'src/app.ts', 'export const answer = 42;\nexport const ok = true;\n');
  await writeRepoFile(cwd, 'eforge/plans/demo/orchestration.yaml', 'plans:\n  - plan-01\n');
  await writeRepoFile(cwd, 'eforge/plans/demo/plan-01.md', '# Generated plan\n');
  await writeRepoFile(cwd, 'eforge/prds/demo.md', '# Generated PRD provenance\n');
  await writeRepoFile(cwd, 'eforge/playbooks/dependency-update.md', '# Real playbook change\n');
  await git(cwd, ['add', '.']);
  await git(cwd, ['commit', '-m', 'feature change']);

  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('review context generated-artifact filtering', () => {
  it('omits generated plan and PRD artifacts from reviewer changed files and diff context', async () => {
    const cwd = await createReviewDiffRepo();

    const context = await computeReviewContext(cwd, 'main');

    expect(context.changedFiles.split('\n')).toEqual([
      'eforge/playbooks/dependency-update.md',
      'src/app.ts',
    ]);
    expect(context.diffContext).toContain('eforge/playbooks/dependency-update.md');
    expect(context.diffContext).toContain('src/app.ts');
    expect(context.diffContext).not.toContain('eforge/plans/demo/orchestration.yaml');
    expect(context.diffContext).not.toContain('eforge/plans/demo/plan-01.md');
    expect(context.diffContext).not.toContain('eforge/prds/demo.md');
  });

  it('omits generated artifacts from parallel review thresholds without hiding real files', async () => {
    const cwd = await createReviewDiffRepo();

    const snapshot = await computeReviewThresholdSnapshot(cwd, 'main');

    expect(snapshot.changedFiles).toEqual([
      'eforge/playbooks/dependency-update.md',
      'src/app.ts',
    ]);
    expect(snapshot.changedLines).toBe(3);
    expect(snapshot.willParallelize).toBe(false);
  });
});
