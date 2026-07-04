import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { validateCompilerDiagnostics, type CompilerDiagnostics, type PlanningAtomOutput } from '@eforge-build/engine/planner-compiler';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { makePipelineCtx, collect, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness } from './stub-harness.js';
import {
  atomSubmission,
  completedOutput,
  completedReduceOutput,
  expectedTasks,
  explorationSubmission,
  overflowRisk,
  prd,
  readFileText,
  reduceSubmission,
  satisfiedGateSubmission,
  sourceGapOutput,
  unsatisfiedGateSubmission,
  workspace,
} from './planning-compiler-fixtures.js';

const GATE_HANDOFF_MESSAGE = 'running planning quality review';

describe('bounded planner compiler stage integration', () => {
  it('uses the canonical compiler for bounded-decomposition risk and writes downstream plan artifacts', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission(mapOutput),
      reduceSubmission(completedReduceOutput(mapOutput)),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner', 'plan-review-cycle'] },
      baseBranch: 'main',
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-reduce-000-001']);
    // The planning quality gate is unconditional on the compiler path.
    expect(ctx.pipeline.compile).toEqual(['planner', 'planning-quality-review-cycle']);
    // planning:complete is emitted by the gate stage, not the planner stage.
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes(GATE_HANDOFF_MESSAGE))).toBe(true);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Starting bounded planner compiler'))).toBe(true);
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage/orchestration.yaml'))).resolves.toContain('module-reduce-000-001');
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage/architecture.md'))).resolves.toContain('Reduced stage synthesis.');
    // Tool-less planners; only the repo-access gate/exploration agents get read-only tools.
    expect(harness.calls.filter((call) => call.stage === 'planner' && !call.prompt.includes('submit_satisfaction_assessment')).every((call) => call.tools === 'none')).toBe(true);
    // Detailed PRD: high-confidence literal localization skips the exploration agent entirely.
    expect(events.some((event) => event.type === 'agent:start' && event.planId === 'repository-exploration')).toBe(false);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Repository exploration skipped'))).toBe(true);
    const diagnostics = JSON.parse(await readFileText(path.join(cwd, 'eforge/plans/bounded-stage/compiler-diagnostics.json'))) as CompilerDiagnostics;
    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.compilerStatus).toBe('complete');
    expect(diagnostics.planSetName).toBe('bounded-stage');
    expect(diagnostics.repair.status).toBe('not-needed');
  });

  it('compiles a small detailed PRD with one atom-planner invocation: no exploration, no reducer', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput: PlanningAtomOutput = {
      ...completedOutput(task),
      reduceDigest: { sourceId: task.atomId, sourceKind: 'atom', status: 'completed', summary: `Atom ${task.atomId} planned all assigned aspects.`, criterionIds: task.criterionIds, aspectIds: task.aspectIds },
    };
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission(mapOutput),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-fast-path',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    const events = await collect(getCompileStage('planner')(ctx));

    // The satisfaction gate plus exactly one atom planner. Zero exploration, zero reducers.
    const plannerCalls = harness.calls.filter((call) => call.stage === 'planner');
    expect(plannerCalls).toHaveLength(2);
    expect(plannerCalls[0].prompt).toContain('submit_satisfaction_assessment');
    expect(harness.prompts.at(-1)).toContain('submit_atom_output');
    expect(events.some((event) => event.type === 'agent:start' && event.planId === 'repository-exploration')).toBe(false);
    expect(events.some((event) => event.type === 'agent:start' && event.planId?.startsWith('reduce-'))).toBe(false);
    // Even a composer-selected ['planner'] pipeline gains the unconditional gate.
    expect(ctx.pipeline.compile).toEqual(['planner', 'planning-quality-review-cycle']);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes(GATE_HANDOFF_MESSAGE))).toBe(true);
    expect(ctx.plans.map((plan) => plan.id)).toEqual([`module-${task.atomId}`]);
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage-fast-path/orchestration.yaml'))).resolves.toContain(`module-${task.atomId}`);
  });

  it('runs the exploration agent for a vague PRD and grounds localization with its hints', async () => {
    const cwd = await workspace({ 'packages/engine/src/vague-owner.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['Improve the grounded behavior of the engine flag handling.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      explorationSubmission(['packages/engine/src/vague-owner.ts'], task.criterionIds),
      atomSubmission(mapOutput),
      reduceSubmission(completedReduceOutput(mapOutput)),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-vague',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    const events = await collect(getCompileStage('planner')(ctx));

    const explorationStarts = events.filter((event) => event.type === 'agent:start' && event.planId === 'repository-exploration');
    expect(explorationStarts).toHaveLength(1);
    const explorationCall = harness.calls[1];
    expect(explorationCall.prompt).toContain('submit_exploration_outcome');
    expect(explorationCall.tools).toBe('read-only');
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Repository exploration produced 1 localization hints'))).toBe(true);
    // The hinted owner path flows through localization into the atom planner's grounded evidence.
    const atomPrompt = harness.prompts.find((prompt) => prompt.includes('submit_atom_output'));
    expect(atomPrompt).toContain('packages/engine/src/vague-owner.ts');
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes(GATE_HANDOFF_MESSAGE))).toBe(true);
  });

  it('degrades to a hint-less compile when the exploration submission is malformed', async () => {
    const cwd = await workspace({ 'packages/engine/src/vague-owner.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['Improve the grounded behavior of the engine flag handling.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-bad', input: { status: 'completed', projectHints: [{ kind: 'not-a-kind', query: 'bad' }] }, output: 'ok' }] },
      atomSubmission(mapOutput),
      reduceSubmission(completedReduceOutput(mapOutput)),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-degraded',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    const events = await collect(getCompileStage('planner')(ctx));

    // A malformed submission synthesizes a budget-exhausted outcome; a single-criterion
    // source has no split signal, so the stage proceeds hint-less with a warning.
    expect(events.some((event) => event.type === 'planning:warning' && event.message.includes('no split signal'))).toBe(true);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes(GATE_HANDOFF_MESSAGE))).toBe(true);
  });

  it('fails the compile closed when adaptive rescoping exhausts with critical needs unresolved', async () => {
    const cwd = await workspace({});
    const sourceContent = prd([
      'engine updates the `packages/engine/src/rescope-api.ts` route schema contract.',
      'client updates the `packages/client/src/rescope-api-consumer.ts` route schema contract.',
    ]);
    const exhausted = { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-exhausted', input: { status: 'budget-exhausted', reasons: ['tool-budget'] }, output: 'ok' }] };
    const harness = new StubHarness([unsatisfiedGateSubmission(), exhausted, exhausted, exhausted]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-fail-closed',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const stage = getCompileStage('planner')(ctx);
    await expect((async () => { for await (const event of stage) events.push(event as never); })()).rejects.toThrow(/critical source need/);
    expect(events.some((event) => event.type === 'planning:error' && String(event.reason).includes('Adaptive rescoping exhausted'))).toBe(true);
    // Fail-closed means no plan artifacts were produced.
    expect(events.some((event) => event.type === 'planning:pipeline')).toBe(false);
  });

  it('skips the compile with planning:skip when the satisfaction gate verifies every criterion', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const harness = new StubHarness([
      satisfiedGateSubmission(task.criterionIds, ['packages/engine/src/a.ts']),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-satisfied',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    const events = await collect(getCompileStage('planner')(ctx));

    const skips = events.filter((event) => event.type === 'planning:skip');
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({ reason: 'All acceptance criteria are already implemented.' });
    // Authoritative skip: stage halts, downstream stages are suppressed, and
    // no plan artifacts exist on disk.
    expect(ctx.skipped).toBe(true);
    expect(ctx.plans).toEqual([]);
    expect(harness.calls).toHaveLength(1);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes(GATE_HANDOFF_MESSAGE))).toBe(false);
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage-satisfied/orchestration.yaml'))).rejects.toThrow();
  });

  it('writes compiler diagnostics to disk even when an unresolvable localization gap fails the compile', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission(completedOutput(task)),
      reduceSubmission(sourceGapOutput(task, 'gap-owner')),
      atomSubmission(completedOutput(task)),
      reduceSubmission(sourceGapOutput(task, 'gap-owner-after-repair')),
    ]);
    const ctx = makePipelineCtx({
      cwd,
      sourceContent,
      planSetName: 'bounded-stage-blocked',
      agentRuntimes: singletonRegistry(harness),
      compilePreflight: overflowRisk(sourceContent),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      baseBranch: 'main',
    });

    await expect(collect(getCompileStage('planner')(ctx))).rejects.toThrow(/source localization repair exhausted/);

    const diagnostics = JSON.parse(await readFileText(path.join(cwd, 'eforge/plans/bounded-stage-blocked/compiler-diagnostics.json'))) as CompilerDiagnostics;
    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.compilerStatus).toBe('incomplete');
    expect(diagnostics.repair.status).toBe('exhausted');
    expect(diagnostics.repair.attempts.at(-1)).toEqual(expect.objectContaining({ status: 'exhausted', residueSynthesisBlocked: true }));
    expect(diagnostics.residue.synthesisBlocked).toBe(true);
    expect(diagnostics.validationErrors.some((error) => error.includes('source localization repair exhausted:gap-owner-after-repair'))).toBe(true);
  });
});
