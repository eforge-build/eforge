import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { MAX_COMPILE_RISK_LIST_ITEMS } from '@eforge-build/engine/events';
import {
  MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES,
  validateCompileArtifacts,
} from '@eforge-build/engine/compile-resilience/artifact-validation';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import type { PipelineContext } from '@eforge-build/engine/pipeline';
import { useTempDir } from './test-tmpdir.js';
import { makePipelineCtx } from './pipeline-helpers.js';

const BUILD = ['implement', 'review-cycle'];
const ctxName = 'artifact-validation';
const PIPELINE: PipelineComposition = {
  scope: 'excursion',
  compile: ['planner'],
  defaultBuild: BUILD,
  defaultReview: DEFAULT_REVIEW,
  rationale: 'artifact validation test',
};


describe('compile artifact validation', () => {
  const tempDir = useTempDir('eforge-artifact-validation-');

  it('accepts valid artifacts and returns parsed persisted plan bodies', async () => {
    const ctx = await writePlanSet(tempDir(), {});
    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(true);
    expect(result.summary.orchestrationExists).toBe(true);
    expect(result.summary.validPlanCount).toBe(1);
    expect(result.summary.missingPlanFileCount).toBe(0);
    expect(result.summary.invalidPlanCount).toBe(0);
    expect(result.ok && result.plans[0].body).toContain('Persisted body');
  });

  it('fails closed when orchestration.yaml is missing with a bounded message', async () => {
    const ctx = makeCtx(tempDir());
    await mkdir(planDir(ctx), { recursive: true });

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.summary.orchestrationExists).toBe(false);
    expect(result.summary.validPlanCount).toBe(0);
    expect(result.summary.missingPlanFileCount).toBe(0);
    expect(result.ok ? '' : result.message).toContain('orchestration.yaml');
    expect(Buffer.byteLength(result.ok ? '' : result.message, 'utf8')).toBeLessThanOrEqual(MAX_COMPILE_ARTIFACT_FAILURE_MESSAGE_BYTES);
  });

  it('fails when orchestration is missing the injected pipeline', async () => {
    const ctx = makeCtx(tempDir());
    await mkdir(planDir(ctx), { recursive: true });
    await writeFile(resolve(planDir(ctx), 'orchestration.yaml'), stringifyYaml({ name: ctx.planSetName, plans: [] }));

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.details.some((detail) => detail.includes('pipeline'))).toBe(true);
  });

  it('fails when orchestration.pipeline differs from ctx.pipeline', async () => {
    const ctx = await writePlanSet(tempDir(), { pipeline: { ...PIPELINE, compile: ['planner', 'plan-review-cycle'] } });

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.details.some((detail) => detail.includes('orchestration.pipeline'))).toBe(true);
  });

  it('reports missing plan files with exact counts and bounded samples', async () => {
    const ctx = await writePlanSet(tempDir(), { planCount: MAX_COMPILE_RISK_LIST_ITEMS + 3, writePlans: false });

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.summary.missingPlanFileCount).toBe(MAX_COMPILE_RISK_LIST_ITEMS + 3);
    expect(result.summary.missingPlanFiles).toHaveLength(MAX_COMPILE_RISK_LIST_ITEMS);
    expect(result.summary.missingPlanFiles[0]).toContain('plan-01.md');
  });

  it('reports invalid plan files with exact counts and bounded samples', async () => {
    const invalidCount = MAX_COMPILE_RISK_LIST_ITEMS + 2;
    const ctx = await writePlanSet(tempDir(), {
      planCount: invalidCount,
      writeAllPlans: true,
      planBodyFor: (id) => planMarkdown({ id: `${id}-mismatch`, branch: `${ctxName}/${id}`, body: 'Body' }),
    });

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.summary.invalidPlanCount).toBe(invalidCount);
    expect(result.summary.invalidPlanFiles).toHaveLength(MAX_COMPILE_RISK_LIST_ITEMS);
    expect(result.summary.invalidPlanFiles[0]).toContain('plan-01.md');
    expect(result.summary.missingPlanFileCount).toBe(0);
  });

  it('marks invalid frontmatter, id mismatch, branch mismatch, and empty bodies invalid', async () => {
    const cases = [
      { name: 'missing frontmatter', body: '# no frontmatter' },
      { name: 'id mismatch', body: planMarkdown({ id: 'other', branch: 'artifact-validation/plan-01', body: 'Body' }) },
      { name: 'branch mismatch', body: planMarkdown({ id: 'plan-01', branch: 'other', body: 'Body' }) },
      { name: 'empty plan body', body: planMarkdown({ id: 'plan-01', branch: 'artifact-validation/plan-01', body: '   ' }) },
    ];

    for (const testCase of cases) {
      const ctx = await writePlanSet(tempDir(), { planBody: testCase.body });
      const result = await validateCompileArtifacts(ctx);
      expect(result.ok, testCase.name).toBe(false);
      expect(result.summary.invalidPlanCount, testCase.name).toBe(1);
      expect(result.summary.invalidPlanFiles[0], testCase.name).toContain('plan-01.md');
      if (testCase.name === 'empty plan body') expect(result.ok ? '' : result.message).toContain('empty plan body');
    }
  });

  it('allows skipped compiles without artifacts', async () => {
    const ctx = makeCtx(tempDir(), { skipped: true });

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.plans).toHaveLength(0);
  });

  it('keeps skipped compiles successful while reflecting cheap disk artifact counts', async () => {
    const ctx = await writePlanSet(tempDir(), { planCount: 2, writePlans: false });
    ctx.skipped = true;

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.summary.orchestrationExists).toBe(true);
    expect(result.summary.missingPlanFileCount).toBe(2);
  });


});

function makeCtx(cwd: string, overrides: Partial<PipelineContext> = {}): PipelineContext {
  return makePipelineCtx({ cwd, planSetName: ctxName, pipeline: PIPELINE, ...overrides });
}

async function writePlanSet(cwd: string, options: { planCount?: number; writePlans?: boolean; writeAllPlans?: boolean; planBody?: string; planBodyFor?: (id: string) => string; pipeline?: PipelineComposition }): Promise<PipelineContext> {
  const ctx = makeCtx(cwd);
  const dir = planDir(ctx);
  await mkdir(dir, { recursive: true });
  const count = options.planCount ?? 1;
  const plans = Array.from({ length: count }, (_, index) => {
    const id = `plan-${String(index + 1).padStart(2, '0')}`;
    return { id, name: `Plan ${index + 1}`, depends_on: [], branch: `${ctx.planSetName}/${id}`, build: BUILD, review: DEFAULT_REVIEW };
  });
  await writeFile(resolve(dir, 'orchestration.yaml'), stringifyYaml({
    name: ctx.planSetName,
    description: 'Artifact validation',
    created: '2026-01-01',
    mode: 'errand',
    base_branch: 'main',
    pipeline: options.pipeline ?? ctx.pipeline,
    plans,
  }));
  if (options.writePlans ?? true) {
    const idsToWrite = options.writeAllPlans ? plans.map((plan) => plan.id) : ['plan-01'];
    for (const id of idsToWrite) {
      const body = options.planBodyFor?.(id) ?? options.planBody ?? planMarkdown({ id, branch: `${ctx.planSetName}/${id}`, body: '# Persisted body' });
      await writeFile(resolve(dir, `${id}.md`), body);
    }
  }
  return ctx;
}


function planMarkdown(input: { id: string; branch: string; body: string }): string {
  return `---\nid: ${input.id}\nname: Plan 1\nbranch: ${input.branch}\n---\n\n${input.body}`;
}

function planDir(ctx: PipelineContext): string {
  return resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
}
