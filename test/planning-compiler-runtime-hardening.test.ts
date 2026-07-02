import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompilePreflightRisk, PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { collect, makePipelineCtx, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness } from './stub-harness.js';

const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Compiler Runtime Hardening', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('bounded planner compiler runtime hardening', () => {
  it('fails closed when missing repository evidence has no product-scoped residue', async () => {
    const cwd = await workspace({});
    const sourceContent = prd(['engine updates `packages/engine/src/missing.ts` with bounded source evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission({ atomId: task.atomId, status: 'failed', aspectUpdates: [], error: 'missing source evidence' }),
    ]);
    const ctx = compilerContext(cwd, sourceContent, harness, 'missing-evidence');

    await expect(collect(getCompileStage('planner')(ctx))).rejects.toThrow('Bounded planner compiler failed');
    expect(ctx.plans.map((plan) => plan.id).some((id) => id.includes('source-evidence-missing'))).toBe(false);
  });

  it('turns oversized repository evidence into bounded residue artifacts', async () => {
    const huge = 'export const oversized = true;\n'.repeat(8_000);
    const cwd = await workspace({ 'packages/engine/src/huge.ts': huge });
    const sourceContent = prd(['engine updates `packages/engine/src/huge.ts` with bounded source evidence.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission({ atomId: task.atomId, status: 'failed', aspectUpdates: [], error: 'oversized source evidence' }),
    ]);
    const ctx = compilerContext(cwd, sourceContent, harness, 'oversized-evidence');

    await collect(getCompileStage('planner')(ctx));

    expect(ctx.plans.map((plan) => plan.id).some((id) => id.includes('source-evidence-too-large'))).toBe(true);
    const residuePlan = await readFirstPlanContaining(cwd, 'oversized-evidence', 'file-byte-size-exceeds-limit');
    expect(residuePlan).toContain('packages/engine/src/huge.ts');
  });

  it('keeps generated planning artifacts and broad directories out of source evidence materialization', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n', 'eforge/plans/old/orchestration.yaml': 'generated: true\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` and ignores broad package roots plus eforge/plans/old/orchestration.yaml.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission(mapOutput),
      reduceSubmission(completedReduceOutput(mapOutput)),
    ]);
    const ctx = compilerContext(cwd, sourceContent, harness, 'evidence-hygiene');

    await collect(getCompileStage('planner')(ctx));

    const sourceEvidenceSection = promptSection(harness.prompts[1], '## Source evidence', '## Structured submission rules');
    expect(sourceEvidenceSection).toContain('packages/engine/src/a.ts');
    expect(sourceEvidenceSection).not.toContain('eforge/plans/old/orchestration.yaml');
    expect(sourceEvidenceSection).not.toContain('generated: true');
    expect(sourceEvidenceSection).not.toContain('"path": "packages"');
  });

  it('preserves reduce gaps and conflicts as explicit follow-up artifacts', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const grounded = true;\n' });
    const sourceContent = prd(['engine updates `packages/engine/src/a.ts` with reduce verification.']);
    const [task] = expectedTasks(sourceContent, resolvePlanningDecompositionLimits(DEFAULT_CONFIG));
    const mapOutput = completedOutput(task);
    const reduceOutput = reduceOutputWithGapAndConflict(mapOutput);
    const harness = new StubHarness([
      unsatisfiedGateSubmission(),
      atomSubmission(mapOutput),
      reduceSubmission(reduceOutput),
    ]);
    const ctx = compilerContext(cwd, sourceContent, harness, 'reduce-residue');

    await collect(getCompileStage('planner')(ctx));

    const planIds = ctx.plans.map((plan) => plan.id).sort();
    expect(planIds).toContain('module-reduce-000-001');
    expect(planIds.some((id) => id.includes('reduce-gap'))).toBe(true);
    expect(planIds.some((id) => id.includes('reduce-conflict'))).toBe(true);
    const planMarkdown = await readFile(path.join(cwd, 'eforge/plans/reduce-residue/acceptance-coverage.md'), 'utf8');
    expect(planMarkdown).toContain('reduce-gap');
    expect(planMarkdown).toContain('reduce-conflict');
  });
});

function compilerContext(cwd: string, sourceContent: string, harness: StubHarness, planSetName: string) {
  return makePipelineCtx({
    cwd,
    sourceContent,
    planSetName,
    agentRuntimes: singletonRegistry(harness),
    compilePreflight: overflowRisk(sourceContent),
    pipeline: { ...TEST_PIPELINE, compile: ['planner', 'plan-review-cycle'] },
    baseBranch: 'main',
  });
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
  const criterionIds = output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [];
  const aspectIds = output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [];
  return {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced runtime hardening synthesis.',
    reduceDigest: { sourceId: 'reduce-000-001', sourceKind: 'reduce', status: 'completed', summary: 'Reduced runtime hardening synthesis.', criterionIds, aspectIds },
    planFragments: output.planFragments,
    moduleCandidates: [{ moduleId: 'module-reduce-000-001', title: 'Reduced module', criterionIds, aspectIds, description: 'Implement reduced runtime hardening work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

function reduceOutputWithGapAndConflict(output: PlanningAtomOutput) {
  const criterionIds = output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [];
  const aspectIds = output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [];
  return {
    ...completedReduceOutput(output),
    status: 'incomplete',
    compactSummary: 'Reduced synthesis with bounded follow-up work.',
    gaps: [{ gapId: 'gap-runtime-verification', title: 'Runtime verification gap', criterionIds, aspectIds, description: 'The reducer needs a bounded runtime verification module.', representationRequired: true, sourceIds: [output.atomId] }],
    conflicts: [{ conflictId: 'conflict-runtime-choice', title: 'Runtime conflict', criterionIds, aspectIds, description: 'The reducer identified a bounded conflict requiring reconciliation.', sourceIds: [output.atomId] }],
  };
}

function atomSubmission(output: PlanningAtomOutput | { atomId: string; status: 'failed'; aspectUpdates: []; error: string }) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

/** The satisfaction gate runs first on every compile; report "not satisfied" so the compile proceeds. */
function unsatisfiedGateSubmission() {
  return { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-gate', input: { alreadySatisfied: false, reason: 'Requested work is not implemented yet.', verdicts: [] }, output: 'ok' }] };
}

function reduceSubmission(output: ReturnType<typeof completedReduceOutput> | ReturnType<typeof reduceOutputWithGapAndConflict>) {
  return { toolCalls: [{ tool: 'submit_reduce_output', toolUseId: `submit-${output.nodeId}`, input: output, output: 'ok' }] };
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
    reasons: ['runtime-hardening-overflow'],
    recommendation: { action: 'bounded-decomposition', reason: 'runtime hardening bounded compiler route' },
  };
}

function promptSection(prompt: string, startMarker: string, endMarker: string): string {
  const start = prompt.indexOf(startMarker);
  const end = prompt.indexOf(endMarker, start);
  return prompt.slice(start, end === -1 ? undefined : end);
}

async function readFirstPlanContaining(cwd: string, planSetName: string, needle: string): Promise<string> {
  const dir = path.join(cwd, 'eforge/plans', planSetName);
  for (const plan of await readdir(dir)) {
    if (!plan.endsWith('.md') || plan === 'architecture.md' || plan === 'acceptance-coverage.md') continue;
    const content = await readFile(path.join(dir, plan), 'utf8');
    if (content.includes(needle)) return content;
  }
  throw new Error(`No plan contained ${needle}`);
}

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eforge-compiler-hardening-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  return root;
}
