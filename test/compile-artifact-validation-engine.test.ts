import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import type { PlanningAtomOutput, PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { computeWorktreeBase } from '@eforge-build/engine/worktree-ops';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';
import {
  atomSubmission,
  completedOutput,
  expectedTasks,
  noFixReviewerResponse,
  prd,
} from './planning-compiler-fixtures.js';

const makeTempDir = useTempDir('eforge-artifact-engine-');

const SOURCE_CONTENT = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);

function fastPathTask(): PlanningAtomTask {
  const [task] = expectedTasks(SOURCE_CONTENT, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
  return task;
}

/** Single-atom fast path output: the reduce is a deterministic passthrough. */
function fastPathAtomOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    ...completedOutput(task),
    reduceDigest: { sourceId: task.atomId, sourceKind: 'atom', status: 'completed', summary: `Atom ${task.atomId} planned all assigned aspects.`, criterionIds: task.criterionIds, aspectIds: task.aspectIds },
  };
}

describe('engine compile artifact validation', () => {
  it('commits validated artifacts and completes the phase for a valid bounded compile', async () => {
    const cwd = await setupProject();
    const planSet = 'valid-artifacts';
    const task = fastPathTask();
    const harness = new StubHarness([atomSubmission(fastPathAtomOutput(task)), noFixReviewerResponse()]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    const events: EforgeEvent[] = [];
    for await (const event of engine.compile(SOURCE_CONTENT, { name: planSet })) events.push(event);

    expect(phaseEnd(events)?.result.status).toBe('completed');
    expect(events.find((event) => event.type === 'planning:complete')).toBeDefined();
    expect(gitLog(cwd, planSet)).toContain(`plan(${planSet}): initial planning artifacts`);
    const mergeCwd = resolve(computeWorktreeBase(cwd, planSet), '__merge__');
    expect(existsSync(resolve(mergeCwd, 'eforge/plans', planSet, 'orchestration.yaml'))).toBe(true);
    expect(existsSync(resolve(mergeCwd, 'eforge/plans', planSet, `module-${task.atomId}.md`))).toBe(true);
  });

  it('fails the phase without an artifact commit when the compiler produces no artifacts', async () => {
    const cwd = await setupProject();
    const planSet = 'missing-artifacts';
    // The atom planner never calls submit_atom_output, so the compiler fails closed.
    const harness = new StubHarness([{ text: 'no submission' }, { text: 'no submission either' }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness });
    const events: EforgeEvent[] = [];
    for await (const event of engine.compile(SOURCE_CONTENT, { name: planSet })) events.push(event);

    expect(phaseEnd(events)?.result.status).toBe('failed');
    expect(events.some((event) => event.type === 'planning:error')).toBe(true);
    expect(events.find((event) => event.type === 'planning:complete')).toBeUndefined();
    expect(gitLog(cwd, planSet)).not.toContain(`plan(${planSet}): initial planning artifacts`);
  });
});

async function setupProject(): Promise<string> {
  const cwd = makeTempDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  await mkdir(resolve(cwd, 'eforge'), { recursive: true });
  await writeFile(resolve(cwd, 'eforge/config.yaml'), 'plugins:\n  enabled: false\n', 'utf8');
  // The compiler grounds atom evidence in repository files; they must be
  // committed so the merge worktree (created from HEAD) contains them.
  const sourceFile = resolve(cwd, 'packages/engine/src/a.ts');
  await mkdir(dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, 'export const grounded = true;\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd });
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], { cwd });
  return cwd;
}

function phaseEnd(events: EforgeEvent[]): Extract<EforgeEvent, { type: 'phase:end' }> | undefined {
  return events.find((event): event is Extract<EforgeEvent, { type: 'phase:end' }> => event.type === 'phase:end');
}

function gitLog(cwd: string, planSet: string): string {
  const mergeCwd = resolve(computeWorktreeBase(cwd, planSet), '__merge__');
  if (!existsSync(mergeCwd)) return '';
  return execFileSync('git', ['log', '--oneline', '--decorate=short'], { cwd: mergeCwd, encoding: 'utf8' });
}
