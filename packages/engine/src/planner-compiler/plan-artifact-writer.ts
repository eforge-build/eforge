import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { PlanFile } from '../events.js';
import { injectPipelineIntoOrchestrationYaml, parseOrchestrationConfig, parsePlanFile, writePlanSet } from '../plan.js';
import type { PipelineComposition, PlanSetSubmission } from '../schemas.js';
import { validatePlanSetSubmission } from '../schemas.js';
import type { PlanningArtifactSynthesisResult, PlanningSynthesizedModulePlan } from './plan-artifact-synthesis.js';

export interface WritePlanningCompilerArtifactsInput {
  cwd: string;
  outputDir: string;
  planSetName: string;
  baseBranch?: string;
  diffBaseRef?: string;
  pipeline: PipelineComposition;
  artifacts: PlanningArtifactSynthesisResult;
  tiers?: Record<string, unknown>;
}

export interface WritePlanningCompilerArtifactsResult {
  plans: PlanFile[];
  planConfigs?: Array<{ id: string; build?: unknown; review?: unknown }>;
  artifactPaths: string[];
}

export async function writePlanningCompilerArtifacts(input: WritePlanningCompilerArtifactsInput): Promise<WritePlanningCompilerArtifactsResult> {
  if (input.artifacts.validationErrors.length > 0) throw new Error(`Invalid planner compiler artifacts: ${input.artifacts.validationErrors.join('; ')}`);
  const planIds = derivePlanIds(input.artifacts.modulePlans);
  const payload = planSetPayload(input, planIds);
  const validation = validatePlanSetSubmission(payload);
  if (!validation.success) throw new Error(`Invalid planner compiler plan set: ${validation.error.message}`);

  await writePlanSet({ cwd: input.cwd, outputDir: input.outputDir, planSetName: input.planSetName, payload, baseBranch: input.baseBranch ?? 'main', mode: input.pipeline.scope });
  const planDir = resolve(input.cwd, input.outputDir, input.planSetName);
  await mkdir(planDir, { recursive: true });
  await writeFile(resolve(planDir, 'architecture.md'), input.artifacts.architectureMarkdown, 'utf8');
  await writeFile(resolve(planDir, 'acceptance-coverage.md'), input.artifacts.acceptanceCoverageMarkdown, 'utf8');

  const orchPath = resolve(planDir, 'orchestration.yaml');
  await injectPipelineIntoOrchestrationYaml(orchPath, input.pipeline, input.baseBranch, input.diffBaseRef);
  const orchestration = await parseOrchestrationConfig(orchPath);
  const plans = await Promise.all(orchestration.plans.map(plan => parsePlanFile(resolve(planDir, `${plan.id}.md`), input.tiers)));
  return {
    plans: plans.map(plan => ({ ...plan, dependsOn: orchestration.plans.find(candidate => candidate.id === plan.id)?.dependsOn ?? [] })),
    planConfigs: orchestration.plans.map(plan => ({ id: plan.id, build: plan.build, review: plan.review })),
    artifactPaths: ['architecture.md', 'acceptance-coverage.md', 'orchestration.yaml', ...plans.map(plan => `${plan.id}.md`)],
  };
}

function planSetPayload(input: WritePlanningCompilerArtifactsInput, planIds: Map<string, string>): PlanSetSubmission {
  return {
    description: `Bounded planner compiler artifacts for ${input.planSetName}`,
    plans: input.artifacts.modulePlans.map(module => ({ frontmatter: { id: requirePlanId(planIds, module.moduleId), name: module.title }, body: module.markdown })),
    orchestration: {
      validate: [],
      plans: input.artifacts.modulePlans.map(module => ({ id: requirePlanId(planIds, module.moduleId), dependsOn: module.dependsOnModuleIds.map(id => requirePlanId(planIds, id)) })),
    },
  };
}

function derivePlanIds(modules: PlanningSynthesizedModulePlan[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [index, module] of modules.entries()) ids.set(module.moduleId, safePlanId(module.moduleId, index));
  return ids;
}

function safePlanId(moduleId: string, index: number): string {
  if (/^[A-Za-z0-9_-]+$/.test(moduleId) && !moduleId.includes('..')) return moduleId;
  const slug = moduleId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'module';
  return `plan-${String(index + 1).padStart(2, '0')}-${slug}`;
}

function requirePlanId(planIds: Map<string, string>, moduleId: string): string {
  const planId = planIds.get(moduleId);
  if (!planId) throw new Error(`Missing plan id for module dependency:${moduleId}`);
  return planId;
}
