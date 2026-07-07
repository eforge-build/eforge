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
import { stringify as stringifyYaml } from 'yaml';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { prepareEvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { runPlanningQualityEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import {
  parseArchitectureManifest,
  renderArchitectureManifestFence,
  type PlanningArchitectureManifest,
} from '@eforge-build/engine/planner-compiler';
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

const COMPILER_MANIFEST: PlanningArchitectureManifest = {
  version: 1,
  plans: [
    { planId: 'module-a', title: 'Module A', residue: false, criterionIds: [], aspectIds: [], dependsOnPlanIds: [] },
    { planId: 'module-b', title: 'Module B', residue: false, criterionIds: [], aspectIds: [], dependsOnPlanIds: [] },
  ],
  fileOwnership: [],
  contracts: [],
  conflicts: [],
};

function demoOrchestration(moduleBDependsOn: string[]): string {
  return stringifyYaml({
    name: 'demo',
    base_branch: 'main',
    pipeline: { scope: 'excursion', compile: ['planner'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'evaluator enforcement test' },
    plans: [
      { id: 'module-a', name: 'Module A', depends_on: [], branch: 'demo/module-a', build: ['implement'], review: DEFAULT_REVIEW },
      { id: 'module-b', name: 'Module B', depends_on: moduleBDependsOn, branch: 'demo/module-b', build: ['implement'], review: DEFAULT_REVIEW },
    ],
  });
}

/** Commit a compiler artifact set for plan set `demo` with a real manifest fence and orchestration. */
async function commitCompilerPlanningArtifacts(repo: string): Promise<void> {
  await writeRepoFile(repo, 'eforge/plans/demo/module-a.md', '---\nid: module-a\n---\n\nmodule a body\n');
  await writeRepoFile(repo, 'eforge/plans/demo/module-b.md', '---\nid: module-b\n---\n\nmodule b body\n');
  await writeRepoFile(
    repo,
    'eforge/plans/demo/architecture.md',
    `# Architecture\n\nProse.\n\n## Machine-readable manifest\n\n${renderArchitectureManifestFence(COMPILER_MANIFEST)}\n`,
  );
  await writeRepoFile(repo, 'eforge/plans/demo/orchestration.yaml', demoOrchestration([]));
  await commitAll(repo, 'plan(demo): initial planning artifacts');
}

async function committedManifestDeps(repo: string): Promise<Record<string, string[]>> {
  const parsed = parseArchitectureManifest(await committedFile(repo, 'eforge/plans/demo/architecture.md'));
  if (!parsed.manifest) throw new Error(`committed manifest missing: ${parsed.errors.join('; ')}`);
  return Object.fromEntries(parsed.manifest.plans.map((plan) => [plan.planId, plan.dependsOnPlanIds]));
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

  it('re-derives the manifest fence in the same commit when an orchestration dependency fix is accepted', async () => {
    const repo = await initRepo(makeTempDir());
    await commitCompilerPlanningArtifacts(repo);
    const commitCountBefore = (await git(repo, ['rev-list', '--count', 'HEAD'])).trim();

    // Reviewer fix: add the missing depends_on edge to orchestration.yaml.
    await writeRepoFile(repo, 'eforge/plans/demo/orchestration.yaml', demoOrchestration(['module-a']));

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/orchestration.yaml', action: 'accept', reason: 'Adds required dependency edge' },
    ]));

    expect(events.find(e => e.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 1, rejected: 0 });
    expect(await committedFile(repo, 'eforge/plans/demo/orchestration.yaml')).toContain('module-a');
    expect(await committedManifestDeps(repo)).toEqual({ 'module-a': [], 'module-b': ['module-a'] });
    // The derived manifest lands in the single evaluator commit; nothing dangles.
    expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe(commitCountBefore);
    expect((await git(repo, ['status', '--porcelain'])).trim()).toBe('');
  });

  it('leaves the manifest fence untouched when an orchestration dependency fix is rejected', async () => {
    const repo = await initRepo(makeTempDir());
    await commitCompilerPlanningArtifacts(repo);

    await writeRepoFile(repo, 'eforge/plans/demo/orchestration.yaml', demoOrchestration(['module-a']));

    const events = await runEvaluatorWithSnapshot(repo, verdictHarness([
      { file: 'eforge/plans/demo/orchestration.yaml', action: 'reject', reason: 'Edge not justified' },
    ]));

    expect(events.find(e => e.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await committedFile(repo, 'eforge/plans/demo/orchestration.yaml')).toBe(demoOrchestration([]));
    expect(await committedManifestDeps(repo)).toEqual({ 'module-a': [], 'module-b': [] });
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
