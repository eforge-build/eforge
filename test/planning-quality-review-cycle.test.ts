/**
 * planning-quality-review-cycle stage — the bounded planner compiler's
 * unconditional quality gate: reviewer lifecycle, evaluator adjudication,
 * post-fix revalidation (fail-closed), infrastructure fail-open, and the
 * skip guard for non-compiler plan sets.
 */
import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { getCompileStage, runCompilePipeline, type PipelineContext } from '@eforge-build/engine/pipeline';
import type { PlanningAtomOutput, PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { makePipelineCtx, collect, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness, type StubResponse } from './stub-harness.js';
import {
  atomSubmission,
  completedOutput,
  expectedTasks,
  noFixReviewerResponse,
  overflowRisk,
  prd,
  readFileText,
  unsatisfiedGateSubmission,
  workspace,
} from './planning-compiler-fixtures.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

/** Compiler workspaces need git history: artifacts are committed before the gate. */
async function gitWorkspace(files: Record<string, string>): Promise<string> {
  const cwd = await workspace(files);
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@eforge.build']);
  await git(cwd, ['config', 'user.name', 'eforge-test']);
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-m', 'chore: base']);
  return cwd;
}

const SOURCE_FILES = { 'packages/engine/src/a.ts': 'export const grounded = true;\n' };
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

function makeCompilerCtx(cwd: string, planSetName: string, harness: StubHarness): PipelineContext {
  return makePipelineCtx({
    cwd,
    sourceContent: SOURCE_CONTENT,
    planSetName,
    agentRuntimes: singletonRegistry(harness),
    compilePreflight: overflowRisk(SOURCE_CONTENT),
    pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
    baseBranch: 'main',
  });
}

/** Full compile pipeline script: single atom, then the gate responses. */
function pipelineScript(task: PlanningAtomTask, gateResponses: StubResponse[]): StubResponse[] {
  return [unsatisfiedGateSubmission(), atomSubmission(fastPathAtomOutput(task)), ...gateResponses];
}

async function collectRejecting(gen: AsyncGenerator<EforgeEvent>): Promise<{ events: EforgeEvent[]; error: Error }> {
  const events: EforgeEvent[] = [];
  try {
    for await (const event of gen) events.push(event);
  } catch (err) {
    return { events, error: err as Error };
  }
  throw new Error('expected generator to reject');
}

function fixSubmission(fixes: unknown[]): StubResponse {
  return {
    text: '<review-issues></review-issues>',
    toolCalls: [{ tool: 'submit_planning_quality_fixes', toolUseId: 'fix-1', input: { fixes }, output: 'ok' }],
  };
}

function evaluatorVerdicts(verdicts: Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }>): StubResponse {
  return { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts }, output: '' }] };
}

describe('planning-quality-review-cycle stage', () => {
  it('runs unconditionally after the compiler even when the composer selected only [planner]', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const harness = new StubHarness(pipelineScript(task, [noFixReviewerResponse()]));
    const ctx = makeCompilerCtx(cwd, 'gate-unconditional', harness);

    const events = await collect(runCompilePipeline(ctx));

    expect(ctx.pipeline.compile).toEqual(['planner', 'planning-quality-review-cycle']);
    expect(events.some((event) => event.type === 'planning:review:start')).toBe(true);
    expect(events.some((event) => event.type === 'planning:review:complete')).toBe(true);
    // Exactly one planning:complete, emitted by the gate with enriched plans + planConfigs.
    const completes = events.filter((event) => event.type === 'planning:complete');
    expect(completes).toHaveLength(1);
    expect(completes[0].plans.map((plan) => plan.id)).toEqual([`module-${task.atomId}`]);
    expect(completes[0].plans[0].dependsOn).toEqual([]);
    expect(completes[0].planConfigs?.map((config) => config.id)).toEqual([`module-${task.atomId}`]);
    // No fixes -> no candidate changes -> evaluator is skipped.
    expect(events.some((event) => event.type === 'planning:evaluate:start')).toBe(false);
  });

  it('feeds the reviewer the five-dimension prompt with inventory and diagnostics summaries', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const harness = new StubHarness(pipelineScript(task, [noFixReviewerResponse()]));
    const ctx = makeCompilerCtx(cwd, 'gate-prompt', harness);

    await collect(runCompilePipeline(ctx));

    const reviewerPrompt = harness.prompts.at(-1) ?? '';
    for (const heading of ['## Coverage', '## Coherence', '## Buildability', '## Traceability', '## Pipeline Sanity']) {
      expect(reviewerPrompt).toContain(heading);
    }
    expect(reviewerPrompt).toContain('Compiler status: complete');
    expect(reviewerPrompt).toContain('Source inventory: 1 acceptance criteria');
    expect(reviewerPrompt).toContain('submit_planning_quality_fixes');
    expect(reviewerPrompt).toContain('no fix variant for `compiler-diagnostics.json`');
  });

  it('applies an accepted reviewer fix, revalidates, and completes planning', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const planId = `module-${task.atomId}`;
    const planPath = `eforge/plans/gate-fix/${planId}.md`;
    // The fix must preserve the plan's criterion traceability or revalidation rejects it.
    const improvedBody = `Improved plan body with concrete verification steps.\n\n## Traceability\n\nCriteria: ${task.criterionIds.join(', ')}\nAspects: ${task.aspectIds.join(', ')}\n`;
    const harness = new StubHarness(pipelineScript(task, [
      fixSubmission([{ kind: 'replace_plan_body', planId, body: improvedBody }]),
      evaluatorVerdicts([{ file: planPath, action: 'accept', reason: 'Concrete improvement' }]),
    ]));
    const ctx = makeCompilerCtx(cwd, 'gate-fix', harness);

    const events = await collect(runCompilePipeline(ctx));

    expect(events.find((event) => event.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 1, rejected: 0 });
    expect(events.filter((event) => event.type === 'planning:complete')).toHaveLength(1);
    expect(await git(cwd, ['show', `HEAD:${planPath}`])).toContain('Improved plan body');
    await expect(readFileText(path.join(cwd, planPath))).resolves.toContain('Improved plan body');
  });

  it('fails the compile when an accepted fix breaks artifact consistency', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const planId = `module-${task.atomId}`;
    const planPath = `eforge/plans/gate-breaking-fix/${planId}.md`;
    const harness = new StubHarness(pipelineScript(task, [
      // An empty body passes the fix schema but breaks plan-set validity.
      fixSubmission([{ kind: 'replace_plan_body', planId, body: '' }]),
      evaluatorVerdicts([{ file: planPath, action: 'accept', reason: 'Accepting a breaking fix' }]),
    ]));
    const ctx = makeCompilerCtx(cwd, 'gate-breaking-fix', harness);

    const { events, error } = await collectRejecting(runCompilePipeline(ctx));

    expect(events.find((event) => event.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 1 });
    expect(events.some((event) => event.type === 'planning:error')).toBe(true);
    expect(error.message.toLowerCase()).toContain('plan');
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
  });

  it('treats reviewer infrastructure failure as non-fatal and still completes planning', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const infraError = () => new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized.');
    const harness = new StubHarness(pipelineScript(task, [
      { error: infraError() },
      { error: infraError() },
    ]));
    const ctx = makeCompilerCtx(cwd, 'gate-infra', harness);

    const events = await collect(runCompilePipeline(ctx));

    const retries = events.filter((event) => event.type === 'agent:retry');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ agent: 'plan-reviewer', maxAttempts: 2 });
    expect(events.some((event) => event.type === 'planning:review:complete')).toBe(false);
    // The gate fails open on infrastructure errors but still revalidates and completes.
    expect(events.filter((event) => event.type === 'planning:complete')).toHaveLength(1);
  });

  it('fails the compile when deterministic validation finds blocking issues before review', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const planId = `module-${task.atomId}`;
    // Script a second no-fix reviewer response for the direct gate re-run.
    const harness = new StubHarness(pipelineScript(task, [noFixReviewerResponse(), noFixReviewerResponse()]));
    const ctx = makeCompilerCtx(cwd, 'gate-blocking', harness);
    await collect(runCompilePipeline(ctx));

    // Corrupt the committed artifact state: a plan file disappears.
    await unlink(path.join(cwd, `eforge/plans/gate-blocking/${planId}.md`));
    await git(cwd, ['add', '-A']);
    await git(cwd, ['commit', '-m', 'corrupt: drop plan file']);

    const { events, error } = await collectRejecting(getCompileStage('planning-quality-review-cycle')(ctx));

    expect(events.some((event) => event.type === 'planning:error')).toBe(true);
    expect(error.message).toContain(planId);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
  });

  it('ignores an invalid fix submission payload and completes without applying anything', async () => {
    const cwd = await gitWorkspace(SOURCE_FILES);
    const task = fastPathTask();
    const harness = new StubHarness(pipelineScript(task, [{
      text: '<review-issues></review-issues>',
      toolCalls: [{ tool: 'submit_planning_quality_fixes', toolUseId: 'fix-bad', input: { fixes: [{ kind: 'not-a-kind' }] }, output: 'ok' }],
    }]));
    const ctx = makeCompilerCtx(cwd, 'gate-invalid-fix', harness);

    const events = await collect(runCompilePipeline(ctx));

    expect(events.some((event) => event.type === 'planning:evaluate:start')).toBe(false);
    expect(events.filter((event) => event.type === 'planning:complete')).toHaveLength(1);
  });

  it('skips the gate when the plan set has no compiler diagnostics artifact', async () => {
    const cwd = await workspace({});
    const harness = new StubHarness([]);
    const ctx = makePipelineCtx({
      cwd,
      planSetName: 'legacy-set',
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planning-quality-review-cycle')(ctx));

    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('no compiler diagnostics artifact'))).toBe(true);
    expect(harness.calls).toHaveLength(0);
    expect(events.some((event) => event.type === 'planning:review:start')).toBe(false);
  });
});
