import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EforgeEvent } from '../../events.js';
import { runArchitectureReview } from '../../agents/architecture-reviewer.js';
import { runCohesionReview } from '../../agents/cohesion-reviewer.js';
import { runArchitectureEvaluate, runCohesionEvaluate } from '../../agents/plan-evaluator.js';
import { prepareEvaluationSnapshot } from '../../evaluation/index.js';
import { runReviewCycle } from '../runners.js';
import type { PipelineContext } from '../types.js';
import { resolveAgentRuntimeForInvocationWithExtensions } from '../agent-runtime.js';

function runtimeChoiceRouterOptions(ctx: PipelineContext) { const routers = ctx.extensionRuntimeChoiceRouters ?? []; return routers.length === 0 ? undefined : { routers, profileName: ctx.configProfileName ?? 'default', cwd: ctx.cwd, configDir: ctx.extensionConfigDir, timeoutMs: ctx.config.extensions.eventHookTimeoutMs }; }

async function readArchitectureContent(ctx: PipelineContext, allowMissing: boolean): Promise<string | undefined> {
  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
  try {
    return await readFile(resolve(planDir, 'architecture.md'), 'utf-8');
  } catch {
    return allowMissing ? '' : undefined;
  }
}

export async function* runArchitectureReviewCycleStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  if (ctx.expeditionModules.length === 0) return;

  const architectureContent = await readArchitectureContent(ctx, false);
  if (architectureContent === undefined) return;

  const { agentConfig: archReviewerConfig, harness: archReviewerHarness } = await resolveAgentRuntimeForInvocationWithExtensions('architecture-reviewer', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'architecture-review' }, runtimeChoiceRouterOptions(ctx));
  const { agentConfig: archEvaluatorConfig, harness: archEvaluatorHarness } = await resolveAgentRuntimeForInvocationWithExtensions('architecture-evaluator', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'architecture-evaluate' }, runtimeChoiceRouterOptions(ctx));
  const planSetPath = `${ctx.config.plan.outputDir}/${ctx.planSetName}`;
  const evaluationCommitMessage = `plan(${ctx.planSetName}): planning artifacts`;

  try {
    yield* runReviewCycle({
      tracing: ctx.tracing,
      cwd: ctx.cwd,
      reviewer: {
        role: 'architecture-reviewer',
        metadata: { planSet: ctx.planSetName },
        run: () => runArchitectureReview({
          ...archReviewerConfig,
          sourceContent: ctx.sourceContent,
          planSetName: ctx.planSetName,
          architectureContent,
          cwd: ctx.cwd,
          verbose: ctx.verbose,
          abortController: ctx.abortController,
          outputDir: ctx.config.plan.outputDir,
          phase: 'compile',
          stage: 'architecture-review',
          harness: archReviewerHarness,
          lane: 'planning',
        }),
      },
      evaluator: {
        role: 'architecture-evaluator',
        metadata: { planSet: ctx.planSetName },
        prepareInput: async () => ({
          evaluationSnapshot: await prepareEvaluationSnapshot(ctx.cwd, 'HEAD~1'),
          evaluatorOptions: { allowedPathPrefix: planSetPath, commitMessage: evaluationCommitMessage },
        }),
        run: (input) => runArchitectureEvaluate({
          ...archEvaluatorConfig,
          planSetName: ctx.planSetName,
          sourceContent: ctx.sourceContent,
          cwd: ctx.cwd,
          verbose: ctx.verbose,
          abortController: ctx.abortController,
          outputDir: ctx.config.plan.outputDir,
          evaluationSnapshot: input.evaluationSnapshot,
          allowedPathPrefix: planSetPath,
          commitMessage: evaluationCommitMessage,
          modelTracker: ctx.modelTracker,
          continuationContext: input.evaluatorOptions.evaluatorContinuationContext,
          phase: 'compile',
          stage: 'architecture-evaluate',
          harness: archEvaluatorHarness,
          lane: 'planning',
        }),
      },
    });
  } catch (err) {
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Architecture review skipped: ${(err as Error).message}` };
  }
}

export async function* runCohesionReviewCycleStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  if (ctx.expeditionModules.length === 0) return;

  const architectureContent = await readArchitectureContent(ctx, true) ?? '';
  const { agentConfig: cohesionReviewerConfig, harness: cohesionReviewerHarness } = await resolveAgentRuntimeForInvocationWithExtensions('cohesion-reviewer', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'cohesion-review' }, runtimeChoiceRouterOptions(ctx));
  const { agentConfig: cohesionEvaluatorConfig, harness: cohesionEvaluatorHarness } = await resolveAgentRuntimeForInvocationWithExtensions('cohesion-evaluator', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'cohesion-evaluate' }, runtimeChoiceRouterOptions(ctx));
  const modulesPath = `${ctx.config.plan.outputDir}/${ctx.planSetName}/modules`;
  const evaluationCommitMessage = `plan(${ctx.planSetName}): planning artifacts`;

  try {
    yield* runReviewCycle({
      tracing: ctx.tracing,
      cwd: ctx.cwd,
      reviewer: {
        role: 'cohesion-reviewer',
        metadata: { planSet: ctx.planSetName },
        run: () => runCohesionReview({
          ...cohesionReviewerConfig,
          sourceContent: ctx.sourceContent,
          planSetName: ctx.planSetName,
          architectureContent,
          cwd: ctx.cwd,
          verbose: ctx.verbose,
          abortController: ctx.abortController,
          outputDir: ctx.config.plan.outputDir,
          phase: 'compile',
          stage: 'cohesion-review',
          harness: cohesionReviewerHarness,
          lane: 'planning',
        }),
      },
      evaluator: {
        role: 'cohesion-evaluator',
        metadata: { planSet: ctx.planSetName },
        prepareInput: async () => ({
          evaluationSnapshot: await prepareEvaluationSnapshot(ctx.cwd, 'HEAD~1'),
          evaluatorOptions: { allowedPathPrefix: modulesPath, commitMessage: evaluationCommitMessage },
        }),
        run: (input) => runCohesionEvaluate({
          ...cohesionEvaluatorConfig,
          planSetName: ctx.planSetName,
          sourceContent: ctx.sourceContent,
          cwd: ctx.cwd,
          verbose: ctx.verbose,
          abortController: ctx.abortController,
          outputDir: ctx.config.plan.outputDir,
          evaluationSnapshot: input.evaluationSnapshot,
          allowedPathPrefix: modulesPath,
          commitMessage: evaluationCommitMessage,
          modelTracker: ctx.modelTracker,
          continuationContext: input.evaluatorOptions.evaluatorContinuationContext,
          phase: 'compile',
          stage: 'cohesion-evaluate',
          harness: cohesionEvaluatorHarness,
          lane: 'planning',
        }),
      },
    });
  } catch (err) {
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Cohesion review skipped: ${(err as Error).message}` };
  }
}
