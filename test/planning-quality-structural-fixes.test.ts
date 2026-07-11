import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { safeParseWithSchema, type PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { validateCompileArtifacts } from '@eforge-build/engine/compile-resilience/artifact-validation';
import type { PlanningAtomModuleCandidate, PlanningAtomOutput, PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { parseArchitectureManifest } from '@eforge-build/engine/planner-compiler/architecture-manifest-contracts';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import { getCompileStage, runCompilePipeline, type PipelineContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { applyPlanningQualityReviewFixes } from '@eforge-build/engine/planning-quality/apply-fixes';
import { applyStructuralPlanningQualityFixes } from '@eforge-build/engine/planning-quality/structural-transforms';
import { planningQualityReviewSubmissionSchema } from '@eforge-build/engine/planning-quality/schemas';
import { replaceArchitectureManifestFence } from '@eforge-build/engine/planner-compiler/architecture-manifest-contracts';
import { makePipelineCtx, collect, TEST_PIPELINE } from './pipeline-helpers.js';
import {
  atomSubmission,
  completedOutput,
  expectedTasks,
  noFixReviewerResponse,
  overflowRisk,
  prd,
  unsatisfiedGateSubmission,
  workspace,
} from './planning-compiler-fixtures.js';
import { StubHarness } from './stub-harness.js';

const exec = promisify(execFile);
const SOURCE_FILES = {
  'packages/engine/src/a.ts': 'export const a = true;\n',
  'packages/engine/src/b.ts': 'export const b = true;\n',
};
const SOURCE = prd([
  'engine updates `packages/engine/src/a.ts` for the shared behavior.',
  'engine updates `packages/engine/src/b.ts` for the same shared behavior.',
]);
const THREE_SOURCE_FILES = { ...SOURCE_FILES, 'packages/engine/src/c.ts': 'export const c = true;\n' };
const THREE_SOURCE = prd([
  'engine updates `packages/engine/src/a.ts` for the shared behavior.',
  'engine updates `packages/engine/src/b.ts` for the same shared behavior.',
  'engine updates `packages/engine/src/c.ts` for an unrelated concern.',
]);

async function gitWorkspace(files: Record<string, string>): Promise<string> {
  const cwd = await workspace(files);
  await exec('git', ['init', '-b', 'main'], { cwd });
  await exec('git', ['config', 'user.email', 'test@eforge.build'], { cwd });
  await exec('git', ['config', 'user.name', 'eforge-test'], { cwd });
  await exec('git', ['add', '-A'], { cwd });
  await exec('git', ['commit', '-m', 'chore: base'], { cwd });
  return cwd;
}

function splitCandidates(task: PlanningAtomTask, customize?: (candidate: PlanningAtomModuleCandidate, index: number) => PlanningAtomModuleCandidate): PlanningAtomModuleCandidate[] {
  return task.criterionIds.map((criterionId, index) => {
    const candidate: PlanningAtomModuleCandidate = {
      moduleId: `module-${index + 1}`,
      title: `Module ${index + 1}`,
      criterionIds: [criterionId],
      aspectIds: task.aspectIds.filter((aspectId) => aspectId.startsWith(`${criterionId}:`)),
      description: `Implement cohesive scope ${index + 1}.`,
      validationExpectation: `Module ${index + 1} checks pass.`,
    };
    return customize?.(candidate, index) ?? candidate;
  });
}

function fastPathOutput(task: PlanningAtomTask, candidates: PlanningAtomModuleCandidate[]): PlanningAtomOutput {
  return {
    ...completedOutput(task),
    moduleCandidates: candidates,
    reduceDigest: {
      sourceId: task.atomId,
      sourceKind: 'atom',
      status: 'completed',
      summary: `Atom ${task.atomId} planned all assigned aspects.`,
      criterionIds: task.criterionIds,
      aspectIds: task.aspectIds,
    },
  };
}

async function compiledSet(customize?: (candidate: PlanningAtomModuleCandidate, index: number) => PlanningAtomModuleCandidate, fixture: { source: string; files: Record<string, string> } = { source: SOURCE, files: SOURCE_FILES }): Promise<{ cwd: string; ctx: PipelineContext; limits: PlanningDecompositionLimits }> {
  const cwd = await gitWorkspace(fixture.files);
  const limits = resolvePlanningDecompositionLimits(DEFAULT_CONFIG);
  const [task] = expectedTasks(fixture.source, limits);
  const output = fastPathOutput(task, splitCandidates(task, customize));
  const harness = new StubHarness([unsatisfiedGateSubmission(), atomSubmission(output), noFixReviewerResponse()]);
  const ctx = makePipelineCtx({
    cwd,
    sourceContent: fixture.source,
    planSetName: 'structural-set',
    agentRuntimes: singletonRegistry(harness),
    compilePreflight: overflowRisk(SOURCE),
    pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
    baseBranch: 'main',
  });
  await collect(runCompilePipeline(ctx));
  return { cwd, ctx, limits };
}

function planDir(cwd: string): string { return resolve(cwd, 'eforge/plans/structural-set'); }

function structuralReviewerResponse() {
  return {
    text: '<review-issues></review-issues>',
    toolCalls: [{
      tool: 'submit_planning_quality_fixes',
      toolUseId: 'structural-fix',
      input: { fixes: [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Both plans form one cohesive bounded change.' }] },
      output: 'ok',
    }],
  };
}

function structuralEvaluatorResponse(action: 'accept' | 'reject') {
  const reason = action === 'accept' ? 'The regenerated artifacts preserve all requirements.' : 'The original boundaries should remain.';
  return {
    toolCalls: [{
      tool: 'submit_evaluation_verdicts',
      toolUseId: 'structural-evaluation',
      input: { verdicts: [
        { file: 'eforge/plans/structural-set/architecture.md', action, reason },
        { file: 'eforge/plans/structural-set/orchestration.yaml', action, reason },
        { file: 'eforge/plans/structural-set/module-1.md', action, reason },
        { file: 'eforge/plans/structural-set/module-2.md', action, reason },
      ] },
      output: 'ok',
    }],
  };
}

async function apply(cwd: string, limits: PlanningDecompositionLimits, fixes: Parameters<typeof applyStructuralPlanningQualityFixes>[0]['fixes']): Promise<string[]> {
  return applyStructuralPlanningQualityFixes({ cwd, outputDir: 'eforge/plans', planSetName: 'structural-set', fixes, limits });
}

describe('planning quality structural fixes', () => {
  it('accepts typed merge, stage-removal, and review-reduction submissions', () => {
    const result = safeParseWithSchema(planningQualityReviewSubmissionSchema, {
      fixes: [
        { kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'One cohesive change.' },
        { kind: 'remove_redundant_stage', planId: 'module-1', stage: 'test-cycle', rationale: 'No test work is declared.' },
        { kind: 'reduce_review_depth', planId: 'module-1', reviewDepth: 'light', rationale: 'No concrete risk remains.' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('merges cohesive plans and regenerates orchestration, architecture, and traceability', async () => {
    const { cwd, ctx, limits } = await compiledSet();

    await apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Both criteria form one bounded engine change.' }]);

    const orchestration = await parseOrchestrationConfig(resolve(planDir(cwd), 'orchestration.yaml'));
    expect(orchestration.plans.map((plan) => plan.id)).toEqual(['module-1']);
    await expect(readFile(resolve(planDir(cwd), 'module-2.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const mergedPlan = await readFile(resolve(planDir(cwd), 'module-1.md'), 'utf8');
    expect(mergedPlan).toContain('Criteria: ac-001, ac-002');
    expect(mergedPlan).toContain('### Module 1');
    expect(mergedPlan).toContain('### Module 2');
    const architecture = await readFile(resolve(planDir(cwd), 'architecture.md'), 'utf8');
    expect(architecture).toContain('### module-1 — Module 1');
    expect(architecture).not.toContain('### module-2 —');
    expect(parseArchitectureManifest(architecture).manifest?.plans.map((plan) => plan.planId)).toEqual(['module-1']);
    expect((await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' })).ok).toBe(true);
  });

  it('commits an evaluator-accepted structural merge as one cohesive artifact set', async () => {
    const { cwd, ctx } = await compiledSet();
    ctx.agentRuntimes = singletonRegistry(new StubHarness([structuralReviewerResponse(), structuralEvaluatorResponse('accept')]));

    const events = await collect(getCompileStage('planning-quality-review-cycle')(ctx));

    expect(events.find((event) => event.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 4, rejected: 0 });
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-1']);
    expect(await exec('git', ['show', 'HEAD:eforge/plans/structural-set/module-1.md'], { cwd }).then(({ stdout }) => stdout)).toContain('Criteria: ac-001, ac-002');
    await expect(exec('git', ['show', 'HEAD:eforge/plans/structural-set/module-2.md'], { cwd })).rejects.toThrow();
  });

  it('rolls back every structural artifact when the evaluator rejects the merge', async () => {
    const { cwd, ctx } = await compiledSet();
    const before = await readFile(resolve(planDir(cwd), 'orchestration.yaml'), 'utf8');
    ctx.agentRuntimes = singletonRegistry(new StubHarness([structuralReviewerResponse(), structuralEvaluatorResponse('reject')]));

    const events = await collect(getCompileStage('planning-quality-review-cycle')(ctx));

    expect(events.find((event) => event.type === 'planning:evaluate:complete')).toMatchObject({ accepted: 0, rejected: 4 });
    await expect(readFile(resolve(planDir(cwd), 'orchestration.yaml'), 'utf8')).resolves.toBe(before);
    await expect(readFile(resolve(planDir(cwd), 'module-2.md'), 'utf8')).resolves.toContain('Module 2');
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-1', 'module-2']);
  });

  it('collapses dependencies between merged plans without creating a self-cycle', async () => {
    const { cwd, ctx, limits } = await compiledSet((candidate, index) => index === 1 ? { ...candidate, dependsOnModuleIds: ['module-1'] } : candidate);

    await apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'The dependent scope belongs to its prerequisite.' }]);

    const orchestration = await parseOrchestrationConfig(resolve(planDir(cwd), 'orchestration.yaml'));
    expect(orchestration.plans[0]?.dependsOn).toEqual([]);
    expect(parseArchitectureManifest(await readFile(resolve(planDir(cwd), 'architecture.md'), 'utf8')).manifest?.plans[0]?.dependsOnPlanIds).toEqual([]);
    expect((await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' })).ok).toBe(true);
  });

  it('rejects mixed evaluator verdicts for one atomic structural candidate', async () => {
    const { cwd, ctx } = await compiledSet();
    const mixedEvaluator = structuralEvaluatorResponse('reject');
    const verdicts = mixedEvaluator.toolCalls[0].input.verdicts;
    verdicts[0] = { ...verdicts[0], action: 'accept', reason: 'Attempt partial acceptance.' };
    ctx.agentRuntimes = singletonRegistry(new StubHarness([structuralReviewerResponse(), mixedEvaluator]));

    const events = await collect(getCompileStage('planning-quality-review-cycle')(ctx));

    expect(events.some((event) => event.type === 'planning:error' && event.reason.includes('Atomic structural candidate'))).toBe(true);
    await expect(readFile(resolve(planDir(cwd), 'module-2.md'), 'utf8')).resolves.toContain('Module 2');
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-1', 'module-2']);
  });

  it('rejects an over-budget merge without modifying any artifact', async () => {
    const { cwd, limits } = await compiledSet();
    const orchestrationPath = resolve(planDir(cwd), 'orchestration.yaml');
    const before = await readFile(orchestrationPath, 'utf8');

    await expect(apply(cwd, { ...limits, maxCriteriaPerUnit: 1 }, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Attempt an oversized merge.' }]))
      .rejects.toThrow('criterion budget exceeded');

    await expect(readFile(orchestrationPath, 'utf8')).resolves.toBe(before);
    await expect(readFile(resolve(planDir(cwd), 'module-2.md'), 'utf8')).resolves.toContain('Module 2');
  });

  it('rejects a merge that would combine conflicting test authors', async () => {
    const { cwd, limits } = await compiledSet((candidate, index) => ({
      ...candidate,
      testWork: 'author-new',
      testOwnership: index === 0 ? 'builder' : 'test-writer',
    }));

    await expect(apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Attempt to combine separate test authors.' }]))
      .rejects.toThrow('conflicting test authors');
  });

  it('removes an unnecessary test cycle and lowers model-selected review to its safety floor', async () => {
    const { cwd, ctx, limits } = await compiledSet((candidate, index) => index === 0 ? { ...candidate, testWork: 'none', testOwnership: 'existing-only', reviewDepth: 'heavy', reviewRationale: 'Conservative model preference.' } : candidate);

    await apply(cwd, limits, [
      { kind: 'remove_redundant_stage', planId: 'module-1', stage: 'test-cycle', rationale: 'No test work or concrete risk requires a test cycle.' },
      { kind: 'reduce_review_depth', planId: 'module-1', reviewDepth: 'light', rationale: 'The deterministic risk floor is light.' },
    ]);

    const orchestration = await parseOrchestrationConfig(resolve(planDir(cwd), 'orchestration.yaml'));
    const plan = orchestration.plans.find((entry) => entry.id === 'module-1');
    expect(plan?.build).toEqual(['implement', 'review-cycle']);
    expect(plan?.review).toMatchObject({ strategy: 'single', maxRounds: 1 });
    expect(await readFile(resolve(planDir(cwd), 'module-1.md'), 'utf8')).toContain('Review depth: light');
    expect((await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' })).ok).toBe(true);
  });

  it('leaves untouched plans byte-identical and outside the atomic candidate group when merging a subset', async () => {
    const { cwd, limits } = await compiledSet(undefined, { source: THREE_SOURCE, files: THREE_SOURCE_FILES });
    const untouchedPath = resolve(planDir(cwd), 'module-3.md');
    const coveragePath = resolve(planDir(cwd), 'acceptance-coverage.md');
    const untouchedBefore = await readFile(untouchedPath, 'utf8');
    const coverageBefore = await readFile(coveragePath, 'utf8');

    const changed = await apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Two of three plans form one cohesive bounded change.' }]);

    expect([...changed].sort()).toEqual([
      'eforge/plans/structural-set/architecture.md',
      'eforge/plans/structural-set/module-1.md',
      'eforge/plans/structural-set/module-2.md',
      'eforge/plans/structural-set/orchestration.yaml',
    ]);
    await expect(readFile(untouchedPath, 'utf8')).resolves.toBe(untouchedBefore);
    await expect(readFile(coveragePath, 'utf8')).resolves.toBe(coverageBefore);
  });

  it('preserves validation expectations when regenerating architecture for a merge', async () => {
    const { cwd, limits } = await compiledSet(undefined, { source: THREE_SOURCE, files: THREE_SOURCE_FILES });

    await apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Two of three plans form one cohesive bounded change.' }]);

    const architecture = await readFile(resolve(planDir(cwd), 'architecture.md'), 'utf8');
    expect(architecture).toContain('Validation: Module 1 checks pass.; Module 2 checks pass.');
    expect(architecture).toContain('Validation: Module 3 checks pass.');
  });

  it('regenerates only orchestration and the touched plan for a review-depth reduction', async () => {
    const { cwd, limits } = await compiledSet((candidate, index) => index === 0 ? { ...candidate, reviewDepth: 'heavy', reviewRationale: 'Conservative model preference.' } : candidate);
    const architecturePath = resolve(planDir(cwd), 'architecture.md');
    const otherPlanPath = resolve(planDir(cwd), 'module-2.md');
    const architectureBefore = await readFile(architecturePath, 'utf8');
    const otherPlanBefore = await readFile(otherPlanPath, 'utf8');

    const changed = await apply(cwd, limits, [{ kind: 'reduce_review_depth', planId: 'module-1', reviewDepth: 'light', rationale: 'The deterministic risk floor is light.' }]);

    expect([...changed].sort()).toEqual([
      'eforge/plans/structural-set/module-1.md',
      'eforge/plans/structural-set/orchestration.yaml',
    ]);
    await expect(readFile(architecturePath, 'utf8')).resolves.toBe(architectureBefore);
    await expect(readFile(otherPlanPath, 'utf8')).resolves.toBe(otherPlanBefore);
  });

  it('rejects mixing structural fixes with whole-file replacement fixes', async () => {
    const { cwd, limits } = await compiledSet();
    const orchestrationPath = resolve(planDir(cwd), 'orchestration.yaml');
    const before = await readFile(orchestrationPath, 'utf8');

    await expect(applyPlanningQualityReviewFixes({
      cwd,
      outputDir: 'eforge/plans',
      planSetName: 'structural-set',
      limits,
      fixes: [
        { kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'One cohesive change.' },
        { kind: 'replace_acceptance_coverage', content: '# Coverage\n' },
      ],
    })).rejects.toThrow('cannot be mixed with whole-file replacement fixes');
    await expect(readFile(orchestrationPath, 'utf8')).resolves.toBe(before);
  });

  it('rejects a merge that absorbs a residue plan', async () => {
    const { cwd, limits } = await compiledSet();
    const architecturePath = resolve(planDir(cwd), 'architecture.md');
    const architecture = await readFile(architecturePath, 'utf8');
    const manifest = parseArchitectureManifest(architecture).manifest!;
    manifest.plans = manifest.plans.map((plan) => plan.planId === 'module-2' ? { ...plan, residue: true } : plan);
    await writeFile(architecturePath, replaceArchitectureManifestFence(architecture, manifest), 'utf8');

    await expect(apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Attempt to absorb a residue plan.' }]))
      .rejects.toThrow('Cannot merge residue plans');
  });

  it('refuses a second structural pass once diagnostics describe an absorbed module', async () => {
    const { cwd, limits } = await compiledSet(undefined, { source: THREE_SOURCE, files: THREE_SOURCE_FILES });
    await apply(cwd, limits, [{ kind: 'merge_plans', targetPlanId: 'module-1', absorbedPlanIds: ['module-2'], rationale: 'Two of three plans form one cohesive bounded change.' }]);

    await expect(apply(cwd, limits, [{ kind: 'reduce_review_depth', planId: 'module-3', reviewDepth: 'light', rationale: 'Attempt a second structural pass.' }]))
      .rejects.toThrow('structural fixes were already applied');
  });

  it('rolls back a structural candidate when the evaluator omits a verdict for one grouped file', async () => {
    const { cwd, ctx } = await compiledSet();
    const partialEvaluator = structuralEvaluatorResponse('accept');
    partialEvaluator.toolCalls[0].input.verdicts = partialEvaluator.toolCalls[0].input.verdicts.filter((verdict) => !verdict.file.endsWith('module-2.md'));
    ctx.agentRuntimes = singletonRegistry(new StubHarness([structuralReviewerResponse(), partialEvaluator]));

    const events = await collect(getCompileStage('planning-quality-review-cycle')(ctx));

    // Per-file verdict coverage rejects the submission before the atomic-group
    // check; either gate must fail closed and restore every structural artifact.
    expect(events.some((event) => event.type === 'planning:error' && event.reason.includes('Missing evaluation verdict coverage'))).toBe(true);
    await expect(readFile(resolve(planDir(cwd), 'module-2.md'), 'utf8')).resolves.toContain('Module 2');
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-1', 'module-2']);
  });

  it('rejects review reduction below the recorded deterministic floor', async () => {
    const { cwd, limits } = await compiledSet((candidate, index) => index === 0 ? { ...candidate, reviewDepth: 'standard', reviewRationale: 'Fixture review.' } : candidate);
    const diagnosticsPath = resolve(planDir(cwd), 'compiler-diagnostics.json');
    const diagnostics = JSON.parse(await readFile(diagnosticsPath, 'utf8')) as { normalization: { modules: Array<{ moduleId: string; normalized: { reviewFloor: string } }> } };
    diagnostics.normalization.modules.find((module) => module.moduleId === 'module-1')!.normalized.reviewFloor = 'standard';
    await writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');

    await expect(apply(cwd, limits, [{ kind: 'reduce_review_depth', planId: 'module-1', reviewDepth: 'light', rationale: 'Attempt to cross the floor.' }]))
      .rejects.toThrow('below deterministic floor standard');
  });
});
