import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
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
  });
});

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
    planFragments: output.planFragments,
    moduleCandidates: [{ moduleId: 'module-reduce-000-001', title: 'Reduced module', criterionIds: output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [], aspectIds: output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [], description: 'Implement reduced stage work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
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
