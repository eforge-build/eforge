import type { EforgeEvent } from '../../events.js';
import type { ResolvedAgentConfig } from '../../config.js';
import type { PipelineContext } from '../../pipeline/types.js';
import { AsyncEventQueue } from '../../concurrency.js';
import { runBoundedPlanningUnit } from '../../agents/bounded-planning-unit.js';
import type { PlanningDecompositionUnit, PlanningUnitOutput } from '../planning-decomposition.js';
import { artifactRef, readUnitSourceSlice, unitArtifactDir } from './artifacts.js';

export interface BoundedBatchResult {
  outputs: PlanningUnitOutput[];
  errors: Array<{ unit: PlanningDecompositionUnit; output?: PlanningUnitOutput; error?: unknown }>;
}

export async function* runBoundedPlanningBatch(input: {
  ctx: PipelineContext;
  units: PlanningDecompositionUnit[];
  completedOutputs: PlanningUnitOutput[];
  agentConfig: ResolvedAgentConfig;
}): AsyncGenerator<EforgeEvent, BoundedBatchResult> {
  const queue = new AsyncEventQueue<EforgeEvent>();
  const outputs: PlanningUnitOutput[] = [];
  const errors: Array<{ unit: PlanningDecompositionUnit; output?: PlanningUnitOutput; error?: unknown }> = [];
  const { harness, toolbeltSummary } = input.ctx.agentRuntimes.forRoleResolved(input.ctx.pipeline.scope === 'expedition' ? 'module-planner' : 'planner');

  for (const unit of input.units) {
    queue.addProducer();
    void (async () => {
      try {
        const upstreamOutputs = input.completedOutputs.filter(output => unit.dependsOn.includes(output.unitId));
        const output = await runBoundedPlanningUnit({
          unit,
          unitSourceContent: await readUnitSourceSlice(input.ctx, unit),
          sourceHash: input.ctx.compilePromptSourceBundle?.sourceHash ?? unit.sourceSlices[0]?.sourceHash ?? '',
          upstreamOutputs,
          upstreamCompactHandoffRefs: upstreamOutputs.flatMap(output => output.compactHandoffRef ? [output.compactHandoffRef] : []),
          budgets: unit.budgets,
          artifactDir: unitArtifactDir(input.ctx, unit.unitId),
          artifactRef: absPath => artifactRef(input.ctx, absPath),
          cwd: input.ctx.cwd,
          planSetName: input.ctx.planSetName,
          pipelineScope: input.ctx.pipeline.scope,
          outputDir: input.ctx.config.plan.outputDir,
          baseBranch: input.ctx.baseBranch,
          defaultBuild: input.ctx.pipeline.defaultBuild,
          defaultReview: input.ctx.pipeline.defaultReview,
          harness,
          agentMode: input.ctx.pipeline.scope === 'expedition' ? 'module-planner' : 'planner',
          agentOptions: { ...input.agentConfig, ...toolbeltSummary },
          auto: input.ctx.auto,
          verbose: input.ctx.verbose,
          abortController: input.ctx.abortController,
          onClarification: input.ctx.onClarification,
          emit: event => queue.push(event),
          onAgentStart: event => input.ctx.modelTracker.record(event.model),
        });
        outputs.push(output);
        if (output.status === 'failed') errors.push({ unit, output });
      } catch (error) {
        errors.push({ unit, error });
      } finally {
        queue.removeProducer();
      }
    })();
  }

  for await (const event of queue) yield event;
  return { outputs, errors };
}
