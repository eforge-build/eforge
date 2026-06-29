import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';
import type { ExpeditionModule, PlanFile } from '../../events.js';
import type { PipelineContext } from '../../pipeline/types.js';
import { parseBuildConfigBlock } from '../../agents/common.js';
import { compileExpedition } from '../../compiler.js';
import { injectPipelineIntoOrchestrationYaml, parseOrchestrationConfig, parsePlanFile, writeArchitecture, writePlanSet } from '../../plan.js';
import type { ArchitectureSubmission, PlanSetSubmission } from '../../schemas.js';
import type { PlanningDecompositionGraph, PlanningUnitOutput } from '../planning-decomposition.js';

export interface ContextManagedSynthesisResult {
  plans: PlanFile[];
  expeditionModules: ExpeditionModule[];
  artifactPaths: string[];
  unitToModuleMap: Record<string, string>;
  planConfigs?: Array<{ id: string; build?: BuildStageSpec[]; review?: ReviewProfileConfig }>;
}

export async function synthesizeContextManagedPlanning(input: { ctx: PipelineContext; graph: PlanningDecompositionGraph; outputs: PlanningUnitOutput[] }): Promise<ContextManagedSynthesisResult> {
  return input.ctx.pipeline.scope === 'expedition' ? synthesizeExpedition(input) : synthesizeExcursion(input);
}

async function synthesizeExpedition(input: { ctx: PipelineContext; graph: PlanningDecompositionGraph; outputs: PlanningUnitOutput[] }): Promise<ContextManagedSynthesisResult> {
  const { ctx, graph } = input;
  const outputs = activeCompletedOutputs(input);
  const suggestions = outputs.flatMap(output => output.moduleSuggestions?.map(module => ({ ...module, unitId: output.unitId })) ?? []);
  const modules = suggestions.length > 0
    ? suggestions.map(({ id, description, dependsOn }) => ({ id: slug(id), description, dependsOn: dependsOn.map(slug) }))
    : graph.units.filter(unit => unit.status !== 'skipped').map(unit => ({ id: slug(unit.unitId), description: unit.title, dependsOn: unit.dependsOn.map(slug) }));
  const architecture = [
    `# ${ctx.planSetName} Architecture`,
    '',
    ...outputs.flatMap(output => output.moduleSuggestions?.flatMap(module => module.architecture ? [module.architecture] : []) ?? []),
    ...outputs.flatMap(output => output.sharedContractNotes?.map(note => `- ${note}`) ?? []),
  ].filter(Boolean).join('\n');
  const payload: ArchitectureSubmission = { architecture, index: { name: ctx.planSetName, description: `Context-managed synthesis for ${ctx.planSetName}`, mode: 'expedition', validate: [], modules: Object.fromEntries(modules.map(module => [module.id, { description: module.description, depends_on: module.dependsOn }])) }, modules };
  await writeArchitecture({ cwd: ctx.cwd, outputDir: ctx.config.plan.outputDir, planSetName: ctx.planSetName, payload });
  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  const modulesDir = resolve(planDir, 'modules');
  await mkdir(modulesDir, { recursive: true });
  const moduleToOutput = new Map(outputs.map(output => [slug(output.moduleSuggestions?.[0]?.id ?? output.unitId), output]));
  for (const module of modules) {
    const source = moduleToOutput.get(module.id);
    const suggestion = source?.planSuggestions?.[0];
    if (suggestion?.buildConfigBlock) applyModuleBuildConfig(ctx, module.id, suggestion.buildConfigBlock);
    const body = suggestion?.markdown ?? fallbackModulePlan(module, graph, outputs);
    await writeFile(resolve(modulesDir, `${module.id}.md`), body, 'utf8');
  }
  const plans = await compileExpedition(ctx.cwd, ctx.planSetName, ctx.moduleBuildConfigs, ctx.config.plan.outputDir);
  const orchPath = resolve(planDir, 'orchestration.yaml');
  await injectPipelineIntoOrchestrationYaml(orchPath, ctx.pipeline, ctx.baseBranch, ctx.diffBaseRef);
  ctx.expeditionModules = modules;
  ctx.plans = plans;
  const unitToModuleMap = Object.fromEntries(outputs.map(output => [output.unitId, slug(output.moduleSuggestions?.[0]?.id ?? output.unitId)]));
  return { plans, expeditionModules: modules, artifactPaths: ['architecture.md', 'index.yaml', 'orchestration.yaml'], unitToModuleMap };
}

async function synthesizeExcursion(input: { ctx: PipelineContext; graph: PlanningDecompositionGraph; outputs: PlanningUnitOutput[] }): Promise<ContextManagedSynthesisResult> {
  const { ctx, graph } = input;
  const outputs = activeCompletedOutputs(input);
  const suggestions = outputs.flatMap(output => output.planSuggestions?.map(plan => ({ ...plan, unitId: output.unitId })) ?? []);
  const planDefs = suggestions.length > 0 ? suggestions : graph.units.filter(unit => unit.status !== 'skipped').map(unit => ({ id: `plan-${slug(unit.unitId)}`, name: unit.title, markdown: fallbackPlanBody(unit.unitId, unit.title, outputs), dependsOn: unit.dependsOn.map(dep => `plan-${slug(dep)}`), unitId: unit.unitId }));
  const payload: PlanSetSubmission = {
    description: `Context-managed synthesis for ${ctx.planSetName}`,
    plans: planDefs.map(plan => ({ frontmatter: { id: slugPlanId(plan.id), name: plan.name ?? plan.id }, body: plan.markdown })),
    orchestration: { validate: [], plans: planDefs.map(plan => ({ id: slugPlanId(plan.id), dependsOn: (plan.dependsOn ?? []).map(slugPlanId) })) },
  };
  await writePlanSet({ cwd: ctx.cwd, outputDir: ctx.config.plan.outputDir, planSetName: ctx.planSetName, payload, baseBranch: ctx.baseBranch ?? 'main', mode: ctx.pipeline.scope === 'errand' ? 'errand' : 'excursion' });
  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  const orchPath = resolve(planDir, 'orchestration.yaml');
  await injectPipelineIntoOrchestrationYaml(orchPath, ctx.pipeline, ctx.baseBranch, ctx.diffBaseRef);
  const orch = await parseOrchestrationConfig(orchPath);
  const plans = await Promise.all(orch.plans.map(plan => parsePlanFile(resolve(planDir, `${plan.id}.md`), ctx.config.agents.tiers)));
  ctx.plans = plans;
  const artifactPaths = ['orchestration.yaml', ...plans.map(plan => `${plan.id}.md`)];
  const unitToModuleMap = Object.fromEntries(planDefs.map(plan => [plan.unitId, slugPlanId(plan.id)]));
  const planConfigs = orch.plans.map(plan => ({ id: plan.id, build: plan.build, review: plan.review }));
  return { plans, expeditionModules: [], artifactPaths, unitToModuleMap, planConfigs };
}

function activeCompletedOutputs(input: { graph: PlanningDecompositionGraph; outputs: PlanningUnitOutput[] }): PlanningUnitOutput[] {
  const unitOrder = new Map(input.graph.units.map((unit, index) => [unit.unitId, index]));
  const activeCompletedUnitIds = new Set(input.graph.units.filter(unit => unit.status !== 'skipped').map(unit => unit.unitId));
  return input.outputs
    .filter(output => output.status === 'completed' && activeCompletedUnitIds.has(output.unitId))
    .sort((a, b) => (unitOrder.get(a.unitId) ?? Number.MAX_SAFE_INTEGER) - (unitOrder.get(b.unitId) ?? Number.MAX_SAFE_INTEGER));
}

function applyModuleBuildConfig(ctx: PipelineContext, moduleId: string, buildConfigBlock: string): void {
  const result = parseBuildConfigBlock(buildConfigBlock.includes('<build-config>') ? buildConfigBlock : `<build-config>${buildConfigBlock}</build-config>`);
  if (result.ok) {
    ctx.moduleBuildConfigs.set(moduleId, result.config);
  } else if (result.reason !== 'no-block') {
    const detail = result.reason === 'invalid-schema' ? result.errors.join('; ') : `raw: ${result.raw.slice(0, 200)}`;
    throw new Error(`Invalid module build config for ${moduleId}: ${result.reason}: ${detail}`);
  }
}

function fallbackModulePlan(module: ExpeditionModule, graph: PlanningDecompositionGraph, outputs: PlanningUnitOutput[]): string {
  const related = outputs.find(output => slug(output.unitId) === module.id);
  return [`# ${module.description}`, '', `Module ID: ${module.id}`, '', '## Coverage', ...(related?.coveredCriteria ?? graph.coverage.coverageByUnit[module.id] ?? []).map(id => `- ${id}`), '', '## Notes', ...(related?.synthesisNotes ?? ['Implement the bounded planning unit output.']).map(note => `- ${note}`)].join('\n');
}

function fallbackPlanBody(unitId: string, title: string, outputs: PlanningUnitOutput[]): string {
  const output = outputs.find(item => item.unitId === unitId);
  return [`# ${title}`, '', '## Scope', `Implement bounded planning unit ${unitId}.`, '', '## Acceptance Criteria', ...(output?.coveredCriteria ?? [unitId]).map(id => `- [ ] ${id}`), '', '## Notes', ...(output?.synthesisNotes ?? ['Synthesized deterministically from decomposition evidence.']).map(note => `- ${note}`)].join('\n');
}

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unit'; }
function slugPlanId(value: string): string { const id = slug(value); return id.startsWith('plan-') ? id : `plan-${id}`; }
