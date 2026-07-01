import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import { writePlanningCompilerArtifacts, type PlanningArchitectureManifest, type PlanningArtifactSynthesisResult } from '@eforge-build/engine/planner-compiler';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';

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
        { moduleId: 'module-core', title: 'Core module', criterionIds: ['ac-001'], aspectIds: ['ac-001:general:general'], markdown: '# Core\n\nImplement core.', dependsOnModuleIds: [], validationExpectation: 'Core checks pass.', residue: false },
        { moduleId: 'module-docs', title: 'Docs module', criterionIds: ['ac-002'], aspectIds: ['ac-002:general:general'], markdown: '# Docs\n\nUpdate docs.', dependsOnModuleIds: ['module-core'], validationExpectation: 'Docs checks pass.', residue: false },
      ],
      orchestration: { modules: [] },
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
    expect(orchestration.plans[1]).toMatchObject({ id: 'module-docs', dependsOn: ['module-core'], build: ['implement'] });
  });

  it('sanitizes unsafe module IDs while preserving dependencies', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-plan-writer-'));
    const artifacts: PlanningArtifactSynthesisResult = {
      architectureMarkdown: '# Architecture',
      architectureManifest: emptyManifest(),
      planMarkdown: '# Plan',
      acceptanceCoverageMarkdown: '## Coverage',
      modulePlans: [
        { moduleId: 'module:core', title: 'Core', criterionIds: ['ac-001'], aspectIds: ['a'], markdown: '# Core', dependsOnModuleIds: [], validationExpectation: 'Core passes.', residue: false },
        { moduleId: 'module:docs', title: 'Docs', criterionIds: ['ac-002'], aspectIds: ['b'], markdown: '# Docs', dependsOnModuleIds: ['module:core'], validationExpectation: 'Docs passes.', residue: false },
      ],
      orchestration: { modules: [] },
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
