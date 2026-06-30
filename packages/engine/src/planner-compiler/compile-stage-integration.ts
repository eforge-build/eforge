import { resolve } from 'node:path';

import type { EforgeEvent } from '../events.js';
import { validateCompileArtifacts } from '../compile-resilience/artifact-validation.js';
import { resolvePlanningDecompositionLimits } from '../config.js';
import { parseOrchestrationConfig } from '../plan.js';
import { resolveAgentConfig } from '../pipeline/agent-config.js';
import type { PipelineContext } from '../pipeline/types.js';
import { runBoundedPlannerCompiler } from './compiler-runner.js';
import { synthesizePlanningArtifacts } from './plan-artifact-synthesis.js';
import { writePlanningCompilerArtifacts } from './plan-artifact-writer.js';

export async function* runBoundedPlannerCompilerCompileStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Starting bounded planner compiler...' };
  const { harness, toolbeltSummary } = ctx.agentRuntimes.forRoleResolved('planner');
  const agentConfig = resolveAgentConfig('planner', ctx.config, undefined, toolbeltSummary);
  const compilerResult = await runBoundedPlannerCompiler({
    sourceContent: ctx.promptSourceContent ?? ctx.compilePromptSourceBundle?.promptSource ?? ctx.sourceContent,
    sourceHash: ctx.compilePromptSourceBundle?.sourceHash,
    cwd: ctx.cwd,
    harness,
    limits: resolvePlanningDecompositionLimits(ctx.config),
    agentOptions: agentConfig,
    parallelism: ctx.config.compile.planningUnitParallelism,
    abortSignal: ctx.abortController?.signal,
  });
  for (const event of compilerResult.events) yield event;

  const artifacts = synthesizePlanningArtifacts({ compilerResult });
  if (artifacts.validationErrors.length > 0) {
    const reason = `Bounded planner compiler produced invalid artifacts: ${artifacts.validationErrors.join('; ')}`;
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw new Error(reason);
  }

  const written = await writePlanningCompilerArtifacts({
    cwd: ctx.cwd,
    outputDir: ctx.config.plan.outputDir,
    planSetName: ctx.planSetName,
    baseBranch: ctx.baseBranch,
    diffBaseRef: ctx.diffBaseRef,
    pipeline: boundedCompilerPipeline(ctx),
    artifacts,
    tiers: ctx.config.agents.tiers,
  });

  ctx.pipeline = boundedCompilerPipeline(ctx);
  ctx.expeditionModules = [];
  ctx.plans = written.plans;
  const validation = await validateCompileArtifacts(ctx);
  for (const warning of validation.warnings) yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  if (!validation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: validation.message };
    throw new Error(validation.message);
  }

  const orchPath = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, 'orchestration.yaml');
  const orch = await parseOrchestrationConfig(orchPath);
  const planConfigs = orch.plans.map(plan => ({ id: plan.id, build: plan.build, review: plan.review }));
  yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans: validation.plans, planConfigs };
}

function boundedCompilerPipeline(ctx: PipelineContext): PipelineContext['pipeline'] {
  return {
    ...ctx.pipeline,
    compile: ctx.pipeline.compile.includes('plan-review-cycle') ? ['planner', 'plan-review-cycle'] : ['planner'],
    rationale: `${ctx.pipeline.rationale}\nBounded planner compiler produced final plan artifacts directly.`,
  };
}
