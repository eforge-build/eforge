import { resolve } from 'node:path';

import type { EforgeEvent } from '../events.js';
import { validateCompileArtifacts } from '../compile-resilience/artifact-validation.js';
import { resolvePlanningDecompositionLimits } from '../config.js';
import { parseOrchestrationConfig } from '../plan.js';
import { resolveAgentConfig } from '../pipeline/agent-config.js';
import type { PipelineContext } from '../pipeline/types.js';
import { runBoundedPlannerCompiler, type BoundedPlannerCompilerResult, type RunBoundedPlannerCompilerInput } from './compiler-runner.js';
import { synthesizePlanningArtifacts } from './plan-artifact-synthesis.js';
import { writePlanningCompilerArtifacts } from './plan-artifact-writer.js';

export async function* runBoundedPlannerCompilerCompileStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Starting bounded planner compiler...' };
  const { harness, toolbeltSummary } = ctx.agentRuntimes.forRoleResolved('planner');
  const agentConfig = resolveAgentConfig('planner', ctx.config, undefined, toolbeltSummary);
  let compilerResult: BoundedPlannerCompilerResult;
  try {
    compilerResult = yield* runCompilerAndStreamEvents({
      sourceContent: ctx.promptSourceContent ?? ctx.compilePromptSourceBundle?.promptSource ?? ctx.sourceContent,
      sourceHash: ctx.compilePromptSourceBundle?.sourceHash,
      cwd: ctx.cwd,
      harness,
      limits: resolvePlanningDecompositionLimits(ctx.config),
      agentOptions: agentConfig,
      parallelism: ctx.config.compile.planningUnitParallelism,
      abortSignal: ctx.abortController?.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw err;
  }

  if (compilerResult.status === 'failed') {
    const reason = `Bounded planner compiler failed: ${compilerResult.validationErrors.join('; ') || compilerResult.map.failedAtomIds.join(',') || compilerResult.reduce.validationErrors.join('; ') || 'unknown failure'}`;
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason };
    throw new Error(reason);
  }

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

async function* runCompilerAndStreamEvents(input: RunBoundedPlannerCompilerInput): AsyncGenerator<EforgeEvent, BoundedPlannerCompilerResult> {
  const queue: EforgeEvent[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  let result: BoundedPlannerCompilerResult | undefined;
  let failure: unknown;
  const notify = (): void => { wake?.(); wake = undefined; };
  const compiler = runBoundedPlannerCompiler({ ...input, onEvent: (event) => { queue.push(event); notify(); } })
    .then((value) => { result = value; })
    .catch((err) => { failure = err; })
    .finally(() => { settled = true; notify(); });

  while (!settled || queue.length > 0) {
    const event = queue.shift();
    if (event) {
      yield event;
      continue;
    }
    await new Promise<void>((resolve) => { wake = resolve; });
  }
  await compiler;
  if (failure) throw failure;
  if (!result) throw new Error('Bounded planner compiler finished without a result');
  return result;
}

function boundedCompilerPipeline(ctx: PipelineContext): PipelineContext['pipeline'] {
  return {
    ...ctx.pipeline,
    compile: ctx.pipeline.compile.includes('plan-review-cycle') ? ['planner', 'plan-review-cycle'] : ['planner'],
    rationale: `${ctx.pipeline.rationale}\nBounded planner compiler produced final plan artifacts directly.`,
  };
}
