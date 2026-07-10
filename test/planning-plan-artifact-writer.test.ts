import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import { writePlanningCompilerArtifacts, type PlanningArchitectureManifest, type PlanningArtifactSynthesisResult } from '@eforge-build/engine/planner-compiler';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import type { ReviewProfileConfig } from '@eforge-build/client';

const pipeline: PipelineComposition = { scope: 'excursion', compile: ['planner', 'plan-review-cycle'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'writer test' };

describe('planning compiler artifact writer', () => {
  it('writes final plan artifacts consumable by downstream build execution', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-plan-writer-'));
    const artifacts: PlanningArtifactSynthesisResult = {
      architectureMarkdown: '# Architecture\n\nBounded compiler architecture.',
      architectureManifest: emptyManifest(),
      planMarkdown: '# Plan\n\nBounded compiler plan.',
      acceptanceCoverageMarkdown: '## Acceptance Coverage\n\nComplete criteria: ac-001',
      modulePlans: [
        { moduleId: 'module-core', title: 'Core module', criterionIds: ['ac-001'], aspectIds: ['ac-001:general:general'], markdown: '# Core\n\nImplement core.', dependsOnModuleIds: [], validationExpectation: 'Core checks pass.', residue: false, testOwnership: 'builder', build: ['implement'], review: heavyReview(), pipelineRationale: 'risk score 3 (residue-derived, repair-only-residue)' },
        { moduleId: 'module-docs', title: 'Docs module', criterionIds: ['ac-002'], aspectIds: ['ac-002:general:general'], markdown: '# Docs\n\nUpdate docs.', dependsOnModuleIds: ['module-core'], validationExpectation: 'Docs checks pass.', residue: false, testOwnership: 'existing-only', build: ['implement'], review: lightReview(), pipelineRationale: 'no risk factors' },
      ],
      orchestration: { modules: [] },
      pipelineDefaults: { defaultBuild: ['implement'], defaultReview: heavyReview(), rationale: 'derived defaults follow highest plan risk' },
      validationErrors: [],
    };

    const result = await writePlanningCompilerArtifacts({ cwd, outputDir: 'plans', planSetName: 'bounded', baseBranch: 'main', pipeline, artifacts });

    expect(result.plans.map((plan) => plan.id)).toEqual(['module-core', 'module-docs']);
    expect(result.plans.find((plan) => plan.id === 'module-docs')?.dependsOn).toEqual(['module-core']);
    expect(result.planConfigs?.map((config) => config.id)).toEqual(['module-core', 'module-docs']);
    await expect(readFile(path.join(cwd, 'plans/bounded/architecture.md'), 'utf8')).resolves.toContain('Bounded compiler architecture.');
    await expect(readFile(path.join(cwd, 'plans/bounded/acceptance-coverage.md'), 'utf8')).resolves.toContain('Complete criteria: ac-001');
    const orchestration = await parseOrchestrationConfig(path.join(cwd, 'plans/bounded/orchestration.yaml'));
    expect(orchestration.pipeline).toMatchObject({ scope: 'excursion', compile: ['planner', 'plan-review-cycle'] });
    expect(orchestration.plans[1]).toMatchObject({ id: 'module-docs', dependsOn: ['module-core'], build: ['implement'], testOwnership: 'existing-only' });
    // Per-plan stamped settings survive the write; the composer default is fallback-only.
    expect(orchestration.plans[0].review).toEqual(heavyReview());
    expect(orchestration.plans[1].review).toEqual(lightReview());
  });

  it('marks residue modules with the no-op merge waiver and round-trips it through orchestration.yaml', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-plan-writer-'));
    const artifacts: PlanningArtifactSynthesisResult = {
      architectureMarkdown: '# Architecture',
      architectureManifest: emptyManifest(),
      planMarkdown: '# Plan',
      acceptanceCoverageMarkdown: '## Coverage',
      modulePlans: [
        { moduleId: 'module-core', title: 'Core', criterionIds: ['ac-001'], aspectIds: ['a'], markdown: '# Core', dependsOnModuleIds: [], validationExpectation: 'Core passes.', residue: false, build: ['implement'], review: lightReview(), pipelineRationale: 'no risk factors' },
        { moduleId: 'candidate-residue', title: 'Residue follow-up', criterionIds: ['ac-002'], aspectIds: ['b'], markdown: '# Residue', dependsOnModuleIds: ['module-core'], validationExpectation: 'Residue passes.', residue: true, build: ['implement'], review: heavyReview(), pipelineRationale: 'risk score 2 (residue-derived)' },
      ],
      orchestration: { modules: [] },
      pipelineDefaults: { defaultBuild: ['implement'], defaultReview: heavyReview(), rationale: 'derived defaults' },
      validationErrors: [],
    };

    await writePlanningCompilerArtifacts({ cwd, outputDir: 'plans', planSetName: 'bounded', baseBranch: 'main', pipeline, artifacts });
    const raw = await readFile(path.join(cwd, 'plans/bounded/orchestration.yaml'), 'utf8');
    const parsed = parseYaml(raw) as { plans: Array<{ id: string; allow_no_op_merge?: boolean }> };
    const orchestration = await parseOrchestrationConfig(path.join(cwd, 'plans/bounded/orchestration.yaml'));

    expect(parsed.plans.find((plan) => plan.id === 'module-core')?.allow_no_op_merge).toBeUndefined();
    expect(parsed.plans.find((plan) => plan.id === 'candidate-residue')?.allow_no_op_merge).toBe(true);
    expect(orchestration.plans.find((plan) => plan.id === 'module-core')?.allowNoOpMerge).toBeUndefined();
    expect(orchestration.plans.find((plan) => plan.id === 'candidate-residue')?.allowNoOpMerge).toBe(true);
  });

  it('sanitizes unsafe module IDs while preserving dependencies', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-plan-writer-'));
    const artifacts: PlanningArtifactSynthesisResult = {
      architectureMarkdown: '# Architecture',
      architectureManifest: emptyManifest(),
      planMarkdown: '# Plan',
      acceptanceCoverageMarkdown: '## Coverage',
      modulePlans: [
        { moduleId: 'module:core', title: 'Core', criterionIds: ['ac-001'], aspectIds: ['a'], markdown: '# Core', dependsOnModuleIds: [], validationExpectation: 'Core passes.', residue: false, build: ['implement'], review: lightReview(), pipelineRationale: 'no risk factors' },
        { moduleId: 'module:docs', title: 'Docs', criterionIds: ['ac-002'], aspectIds: ['b'], markdown: '# Docs', dependsOnModuleIds: ['module:core'], validationExpectation: 'Docs passes.', residue: false, build: ['implement'], review: lightReview(), pipelineRationale: 'no risk factors' },
      ],
      orchestration: { modules: [] },
      pipelineDefaults: { defaultBuild: ['implement'], defaultReview: lightReview(), rationale: 'derived defaults' },
      validationErrors: [],
    };

    await writePlanningCompilerArtifacts({ cwd, outputDir: 'plans', planSetName: 'bounded', baseBranch: 'main', pipeline, artifacts });
    const raw = await readFile(path.join(cwd, 'plans/bounded/orchestration.yaml'), 'utf8');
    const parsed = parseYaml(raw) as { plans: Array<{ id: string; depends_on: string[] }> };

    expect(parsed.plans.map((plan) => plan.id)).toEqual(['plan-01-module-core', 'plan-02-module-docs']);
    expect(parsed.plans[1].depends_on).toEqual(['plan-01-module-core']);
  });
});

function emptyManifest(): PlanningArchitectureManifest {
  return { version: 1, plans: [], fileOwnership: [], contracts: [], conflicts: [] };
}

function lightReview(): ReviewProfileConfig {
  return { strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' };
}

function heavyReview(): ReviewProfileConfig {
  return { strategy: 'parallel', perspectives: ['code', 'security', 'test', 'verify'], maxRounds: 2, evaluatorStrictness: 'strict' };
}
