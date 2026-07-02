/**
 * Planning quality evaluator enforcement — the PRD work-item-4 reject matrix.
 *
 * The evaluator must accept valid planning-artifact fixes and deterministically
 * reject: source edits, edits outside the plan set directory, deletion of
 * acceptance coverage, and deletion of compiler diagnostics.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { prepareEvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { runPlanningQualityEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function initRepo(dir: string): Promise<string> {
  const repo = join(dir, 'repo');
  await git(dir, ['init', '-b', 'main', repo]);
  await git(repo, ['config', 'user.email', 'test@eforge.build']);
  await git(repo, ['config', 'user.name', 'eforge-test']);
  await git(repo, ['commit', '--allow-empty', '-m', 'chore: base']);
  return repo;
}

async function writeRepoFile(repo: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), content, 'utf8');
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', message]);
}

async function head(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', 'HEAD'])).trim();
}

async function committedFile(repo: string, path: string): Promise<string> {
  return git(repo, [`show`, `HEAD:${path}`]);
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function verdictHarness(verdicts: Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }>): StubHarness {
  return new StubHarness([{
    toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts }, output: '' }],
  }]);
}

/** Commit the compiler's baseline artifact set for plan set `demo`. */
async function commitPlanningArtifacts(repo: string): Promise<void> {
  await writeRepoFile(repo, 'eforge/plans/demo/module-a.md', '---\nid: module-a\n---\n\noriginal plan body\n');
  await writeRepoFile(repo, 'eforge/plans/demo/architecture.md', 'architecture original\n');
  await writeRepoFile(repo, 'eforge/plans/demo/acceptance-coverage.md', 'coverage original\n');
  await writeRepoFile(repo, 'eforge/plans/demo/compiler-diagnostics.json', '{"original":true}\n');
  await commitAll(repo, 'plan(demo): initial planning artifacts');
}

async function runEvaluatorWithSnapshot(repo: string, harness: StubHarness): Promise<EforgeEvent[]> {
  const snapshot = await prepareEvaluationSnapshot(repo, 'HEAD~1');
  return collect(runPlanningQualityEvaluate({
    harness,
    planSetName: 'demo',
    sourceContent: 'PRD',
    cwd: repo,
    outputDir: 'eforge/plans',
    evaluationSnapshot: snapshot,
    allowedPathPrefix: 'eforge/plans/demo',
    commitMessage: 'plan(demo): planning artifacts',
  }));
}

describe('planning quality evaluator enforcement', () => {
  const makeTempDir = useTempDir('eforge-planning-quality-evaluator-');

  it('accepts valid plan, architecture, and coverage fixes and commits them', async () => {
    const repo = await initRepo(makeTempDir());
    await commitPlanningArtifacts(repo);

    await writeRepoFile(repo, 'eforge/plans/demo/module-a.md', '---\nid: module-a\n---\n\noriginal plan body\ncoverage gap closed\n');
    await writeRepoFile(repo, 'eforge/plans/demo/architecture.md', 'architecture original\ncontract added\n');
    await writeRepoFile(repo, 'eforge/plans/demo/acceptance-coverage.md', 'coverage original\ncriterion c1 now covered by module-a\n');

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/module-a.md', action: 'accept', reason: 'Closes coverage gap' },
      { file: 'eforge/plans/demo/architecture.md', action: 'accept', reason: 'Completes contract' },
      { file: 'eforge/plans/demo/acceptance-coverage.md', action: 'accept', reason: 'Reflects new coverage' },
    ]));

    expect(events.find(e => e.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 3, rejected: 0 });
    expect(await committedFile(repo, 'eforge/plans/demo/module-a.md')).toContain('coverage gap closed');
    expect(await committedFile(repo, 'eforge/plans/demo/architecture.md')).toContain('contract added');
    expect(await committedFile(repo, 'eforge/plans/demo/acceptance-coverage.md')).toContain('criterion c1 now covered');
  });

  it('rejects source code edits via the path guard without committing', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const app = true;\n');
    await commitAll(repo, 'chore: source');
    await commitPlanningArtifacts(repo);
    const originalHead = await head(repo);

    await writeRepoFile(repo, 'src/app.ts', 'export const app = false;\n');

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'src/app.ts', action: 'accept', reason: 'Reviewer touched source' },
    ]));

    expect(events.find(e => e.type === 'planning:error')?.reason).toContain('outside the allowed planning artifact directory');
    expect(await head(repo)).toBe(originalHead);
  });

  it('rejects edits outside the plan set directory without committing', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'eforge/plans/other-set/plan.md', 'other original\n');
    await commitAll(repo, 'plan(other-set): artifacts');
    await commitPlanningArtifacts(repo);
    const originalHead = await head(repo);

    await writeRepoFile(repo, 'eforge/plans/other-set/plan.md', 'other original\nout-of-set fix\n');

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/other-set/plan.md', action: 'accept', reason: 'Outside plan set' },
    ]));

    expect(events.find(e => e.type === 'planning:error')?.reason).toContain('outside the allowed planning artifact directory');
    expect(await head(repo)).toBe(originalHead);
  });

  it('rejects deletion of acceptance-coverage.md via the protected-artifact guard', async () => {
    const repo = await initRepo(makeTempDir());
    await commitPlanningArtifacts(repo);
    const originalHead = await head(repo);

    await unlink(join(repo, 'eforge/plans/demo/acceptance-coverage.md'));

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/acceptance-coverage.md', action: 'accept', reason: 'Coverage no longer needed' },
    ]));

    expect(events.find(e => e.type === 'planning:error')?.reason).toContain('would delete a protected planning artifact');
    expect(await head(repo)).toBe(originalHead);
    // The artifact is restored in the working tree, not deleted.
    expect(await committedFile(repo, 'eforge/plans/demo/acceptance-coverage.md')).toContain('coverage original');
  });

  it('rejects deletion of compiler-diagnostics.json via the protected-artifact guard', async () => {
    const repo = await initRepo(makeTempDir());
    await commitPlanningArtifacts(repo);
    const originalHead = await head(repo);

    await unlink(join(repo, 'eforge/plans/demo/compiler-diagnostics.json'));

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/compiler-diagnostics.json', action: 'accept', reason: 'Diagnostics obsolete' },
    ]));

    expect(events.find(e => e.type === 'planning:error')?.reason).toContain('would delete a protected planning artifact');
    expect(await head(repo)).toBe(originalHead);
    expect(await committedFile(repo, 'eforge/plans/demo/compiler-diagnostics.json')).toContain('"original":true');
  });

  it('allows rejecting a protected-artifact deletion (reject verdicts restore the file)', async () => {
    const repo = await initRepo(makeTempDir());
    await commitPlanningArtifacts(repo);

    await unlink(join(repo, 'eforge/plans/demo/acceptance-coverage.md'));

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/acceptance-coverage.md', action: 'reject', reason: 'Coverage must never be deleted' },
    ]));

    expect(events.find(e => e.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await committedFile(repo, 'eforge/plans/demo/acceptance-coverage.md')).toContain('coverage original');
  });
});
