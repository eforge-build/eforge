import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, validateCompilerDiagnostics, type CompilerDiagnostics, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { makePipelineCtx, collect, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness } from './stub-harness.js';

const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Compiler Stage', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('bounded planner compiler stage integration', () => {
  it('uses the canonical compiler for bounded-decomposition risk and writes downstream plan artifacts', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      composerResponse(),
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
    expect(ctx.pipeline.compile).toEqual(['planner', 'plan-review-cycle']);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Starting bounded planner compiler'))).toBe(true);
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage/orchestration.yaml'))).resolves.toContain('module-reduce-000-001');
    await expect(readFileText(path.join(cwd, 'eforge/plans/bounded-stage/architecture.md'))).resolves.toContain('Reduced stage synthesis.');
    expect(harness.calls.filter((call) => call.stage === 'planner').every((call) => call.tools === 'none')).toBe(true);
    // Detailed PRD: high-confidence literal localization skips the exploration agent entirely.
    expect(events.some((event) => event.type === 'agent:start' && event.planId === 'repository-exploration')).toBe(false);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Repository exploration skipped'))).toBe(true);
    const diagnostics = JSON.parse(await readFileText(path.join(cwd, 'eforge/plans/bounded-stage/compiler-diagnostics.json'))) as CompilerDiagnostics;
    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.compilerStatus).toBe('complete');
    expect(diagnostics.planSetName).toBe('bounded-stage');
    expect(diagnostics.repair.status).toBe('not-needed');
  });

  it('runs the exploration agent for a vague PRD and grounds localization with its hints', async () => {
    const cwd = await workspace({ 'packages/engine/src/vague-owner.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['Improve the grounded behavior of the engine flag handling.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      composerResponse(),
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
    expect(explorationCall.tools).toBe('read-only');
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Repository exploration produced 1 localization hints'))).toBe(true);
    // The hinted owner path flows through localization into the atom planner's grounded evidence.
    const atomPrompt = harness.prompts.find((prompt) => prompt.includes('submit_atom_output'));
    expect(atomPrompt).toContain('packages/engine/src/vague-owner.ts');
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
  });

  it('degrades to a hint-less compile when the exploration submission is malformed', async () => {
    const cwd = await workspace({ 'packages/engine/src/vague-owner.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['Improve the grounded behavior of the engine flag handling.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      composerResponse(),
      { toolCalls: [{ tool: 'submit_exploration_hints', toolUseId: 'submit-bad', input: { projectHints: [{ kind: 'not-a-kind', query: 'bad' }] }, output: 'ok' }] },
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

    expect(events.some((event) => event.type === 'planning:warning' && event.source === 'repository-exploration' && event.message.includes('degraded to no hints'))).toBe(true);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
  });

  it('writes compiler diagnostics to disk even when an unresolvable localization gap fails the compile', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` using bounded compiler evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const harness = new StubHarness([
      composerResponse(),
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

function sourceGapOutput(task: PlanningAtomTask, gapId: string): PlanningReduceOutput {
  return {
    nodeId: 'reduce-000-001',
    status: 'incomplete',
    compactSummary: `Missing localized owner path for ${task.atomId}.`,
    gaps: [{ gapId, title: 'Missing localized owner path', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Missing localized owner path prevents source-grounded product planning.', representationRequired: true, issueKind: 'missing-owner-path', sourceLocalizationSignal: true, affectedAtomIds: [task.atomId] }],
  };
}

function expectedTasks(content: string, limits: PlanningDecompositionLimits): PlanningAtomTask[] {
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: undefined });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  return buildPlanningAtomTasks({ graph, inventory, sharedBrief });
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
  };
}

function completedReduceOutput(output: PlanningAtomOutput) {
  return {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced stage synthesis.',
    reduceDigest: { sourceId: 'reduce-000-001', sourceKind: 'reduce', status: 'completed', summary: 'Reduced stage synthesis.', criterionIds: [...new Set([...(output.planFragments ?? []).flatMap((fragment) => fragment.criterionIds), ...(output.moduleCandidates ?? []).flatMap((module) => module.criterionIds)])].sort(), aspectIds: [...new Set([...(output.planFragments ?? []).flatMap((fragment) => fragment.aspectIds), ...(output.moduleCandidates ?? []).flatMap((module) => module.aspectIds)])].sort() },
    planFragments: output.planFragments,
    moduleCandidates: [{ moduleId: 'module-reduce-000-001', title: 'Reduced module', criterionIds: output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [], aspectIds: output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [], description: 'Implement reduced stage work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

function explorationSubmission(paths: string[], criterionIds: string[]) {
  return { toolCalls: [{ tool: 'submit_exploration_hints', toolUseId: 'submit-exploration', input: { projectHints: [{ kind: 'literal-path', query: 'grounded flag owner', paths, criterionIds }] }, output: 'ok' }] };
}

function reduceSubmission(output: ReturnType<typeof completedReduceOutput>) {
  return { toolCalls: [{ tool: 'submit_reduce_output', toolUseId: `submit-${output.nodeId}`, input: output, output: 'ok' }] };
}

function composerResponse() {
  return { resultText: JSON.stringify({ scope: 'excursion', compile: ['planner', 'plan-review-cycle'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'bounded test' }) };
}

function overflowRisk(content: string): CompilePreflightRisk {
  return {
    level: 'overflow-risk',
    sourceBytes: content.length,
    promptSourceBytes: content.length,
    acceptanceCriteriaCount: 1,
    score: 100,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 1, subsystems: ['engine'], evidence: [] },
    reasons: ['test-overflow'],
    recommendation: { action: 'bounded-decomposition', reason: 'test bounded compiler route' },
  };
}

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eforge-compiler-stage-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  return root;
}

async function readFileText(file: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(file, 'utf8');
}
