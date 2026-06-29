import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { validateCompileArtifacts } from '@eforge-build/engine/compile-resilience/artifact-validation';
import { derivePlanningDecompositionGraph, type PlanningDecompositionGraph, type PlanningUnitOutput } from '@eforge-build/engine/compile-resilience/planning-decomposition';
import { synthesizeContextManagedPlanning } from '@eforge-build/engine/compile-resilience/context-managed-planning/synthesis';
import { parseExpeditionIndex, parseOrchestrationConfig, parsePlanFile } from '@eforge-build/engine/plan';
import { makePipelineCtx, TEST_PIPELINE } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-context-managed-synthesis-');
const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 2, maxPromptSourceBytes: 1000, maxPromptBytes: 2000, maxObservedInputTokens: 2000, maxObservedTurns: 4, maxCompactHandoffBytes: 200, maxLocalExplorationToolUses: 4, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 1, maxSplitAttemptsPerUnit: 1 };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

function graph(): PlanningDecompositionGraph {
  const content = '# PRD\n\n## Acceptance Criteria\n- engine implements scheduler\n- client implements events\n- console renders status';
  return derivePlanningDecompositionGraph({ source: { content, hash: hash(content), path: 'prd.md' }, limits });
}

function output(unitId: string, overrides: Partial<PlanningUnitOutput> = {}): PlanningUnitOutput {
  return {
    unitId,
    status: 'completed',
    coveredCriteria: [unitId],
    discoveredFiles: [],
    sharedContractNotes: [`contract note for ${unitId}`],
    moduleSuggestions: [],
    planSuggestions: [],
    unresolvedRequirements: [],
    synthesisNotes: [`synthesis note for ${unitId}`],
    observedBudget: { promptSourceBytes: 100, promptBytes: 400, triggeredLimitKeys: [] },
    ...overrides,
  };
}

describe('context-managed planning synthesis', () => {
  it('writes expedition architecture, index, module plans, and parseable orchestration from unit module suggestions', async () => {
    const cwd = makeTempDir();
    const g = graph();
    const ctx = makePipelineCtx({
      cwd,
      config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } },
      pipeline: { ...TEST_PIPELINE, scope: 'expedition', compile: ['planner', 'compile-expedition'] },
      planSetName: 'expedition-synth',
    });
    const outputs = [
      output(g.units[0].unitId, { moduleSuggestions: [{ id: 'foundation', description: 'Foundation contracts', dependsOn: [], architecture: 'Foundation architecture.' }], planSuggestions: [{ id: 'foundation', markdown: '# Foundation\n\nImplement contracts.', dependsOn: [] }] }),
      output(g.units[1].unitId, { moduleSuggestions: [{ id: 'feature', description: 'Feature implementation', dependsOn: ['foundation'], architecture: 'Feature architecture.' }], planSuggestions: [{ id: 'feature', markdown: '# Feature\n\nImplement feature.', dependsOn: ['foundation'] }] }),
    ];

    const result = await synthesizeContextManagedPlanning({ ctx, graph: g, outputs });
    const planDir = join(cwd, 'plans', 'expedition-synth');

    expect(result.artifactPaths).toEqual(expect.arrayContaining(['architecture.md', 'index.yaml', 'orchestration.yaml']));
    expect(result.expeditionModules.map((module) => module.id)).toEqual(['foundation', 'feature']);
    await expect(parseExpeditionIndex(join(planDir, 'index.yaml'))).resolves.toMatchObject({ mode: 'expedition' });
    await expect(parseOrchestrationConfig(join(planDir, 'orchestration.yaml'))).resolves.toMatchObject({ mode: 'expedition' });
    await expect(readFile(join(planDir, 'architecture.md'), 'utf8')).resolves.toContain('Foundation architecture.');
    expect(ctx.expeditionModules).toHaveLength(2);
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['plan-01-foundation', 'plan-02-feature']);
  });

  it('writes excursion plan files and parseable orchestration with injected pipeline defaults', async () => {
    const cwd = makeTempDir();
    const g = graph();
    const ctx = makePipelineCtx({ cwd, config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } }, planSetName: 'excursion-synth' });
    const outputs = [
      output(g.units[0].unitId, { planSuggestions: [{ id: 'plan-engine', name: 'Engine Plan', markdown: '# Engine Plan\n\n## Acceptance Criteria\n- [ ] engine implements scheduler', dependsOn: [] }] }),
      output(g.units[1].unitId, { planSuggestions: [{ id: 'plan-client', name: 'Client Plan', markdown: '# Client Plan\n\n## Acceptance Criteria\n- [ ] client implements events', dependsOn: ['plan-engine'] }] }),
    ];

    const result = await synthesizeContextManagedPlanning({ ctx, graph: g, outputs });
    const planDir = join(cwd, 'plans', 'excursion-synth');
    const files = await readdir(planDir);
    const orchestration = await parseOrchestrationConfig(join(planDir, 'orchestration.yaml'));
    const parsedPlan = await parsePlanFile(join(planDir, 'plan-engine.md'), ctx.config.agents.tiers);
    const validation = await validateCompileArtifacts(ctx);

    expect(result.artifactPaths).toEqual(expect.arrayContaining(['orchestration.yaml', 'plan-engine.md', 'plan-client.md']));
    expect(files).toEqual(expect.arrayContaining(['orchestration.yaml', 'plan-engine.md', 'plan-client.md']));
    expect(orchestration.plans.find((plan) => plan.id === 'plan-client')?.dependsOn).toEqual(['plan-engine']);
    expect(orchestration.plans.every((plan) => plan.build.length > 0 && plan.review.strategy)).toBe(true);
    expect(parsedPlan.id).toBe('plan-engine');
    expect(validation.ok).toBe(true);
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['plan-engine', 'plan-client']);
  });

  it('excludes failed skipped parent outputs from synthesized suggestions', async () => {
    const cwd = makeTempDir();
    const base = graph();
    const parent = { ...base.units[0], status: 'skipped' as const };
    const child = { ...base.units[1], parentId: parent.unitId, dependsOn: [], status: 'completed' as const };
    const g: PlanningDecompositionGraph = { ...base, units: [parent, child], edges: [] };
    const ctx = makePipelineCtx({ cwd, config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } }, planSetName: 'filtered-synth' });

    const result = await synthesizeContextManagedPlanning({ ctx, graph: g, outputs: [
      output(parent.unitId, { status: 'failed', planSuggestions: [{ id: 'plan-obsolete-parent', markdown: '# Obsolete', dependsOn: [] }] }),
      output(child.unitId, { planSuggestions: [{ id: 'plan-active-child', markdown: '# Active Child', dependsOn: [] }] }),
    ] });

    expect(result.plans.map((plan) => plan.id)).toEqual(['plan-active-child']);
  });

  it('falls back to deterministic plan ids from active graph units and preserves dependency order', async () => {
    const cwd = makeTempDir();
    const base = graph();
    const units = base.units.slice(0, 2).map((unit, index, all) => ({ ...unit, dependsOn: index === 1 ? [all[0].unitId] : [] }));
    const g: PlanningDecompositionGraph = { ...base, units, edges: [{ fromUnitId: units[0].unitId, toUnitId: units[1].unitId, reason: 'test dependency' }] };
    const ctx = makePipelineCtx({ cwd, config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } }, planSetName: 'fallback-synth' });

    const result = await synthesizeContextManagedPlanning({ ctx, graph: g, outputs: units.map((unit) => output(unit.unitId)) });
    const orchestration = await parseOrchestrationConfig(join(cwd, 'plans', 'fallback-synth', 'orchestration.yaml'));

    expect(result.plans.map((plan) => plan.id)).toEqual(units.map((unit) => `plan-${unit.unitId}`));
    expect(orchestration.plans.find((plan) => plan.id === `plan-${units[1].unitId}`)?.dependsOn).toEqual([`plan-${units[0].unitId}`]);
  });
});
