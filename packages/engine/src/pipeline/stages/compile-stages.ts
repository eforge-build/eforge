/**
 * Built-in compile stages — all six compile stage registrations.
 *
 * Long stage bodies delegate to module-level helper functions so each stage
 * generator stays within 80 lines.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EforgeEvent, ExpeditionModule, CompileScopeContextFailure } from '../../events.js';
import {
  withRetry,
  DEFAULT_RETRY_POLICIES,
  type RetryPolicy,
  type PlannerContinuationInput,
} from '../../retry.js';
import { runPlanner } from '../../agents/planner.js';
import { runModulePlanner } from '../../agents/module-planner.js';
import { runPlanReview } from '../../agents/plan-reviewer.js';
import { runPlanEvaluate } from '../../agents/plan-evaluator.js';
import { parseBuildConfigBlock } from '../../agents/common.js';
import { composePipeline, type PipelineComposerOptions } from '../../agents/pipeline-composer.js';
import { compileExpedition } from '../../compiler.js';
import { resolveDependencyGraph, injectPipelineIntoOrchestrationYaml, parseOrchestrationConfig } from '../../plan.js';
import { runParallel, type ParallelTask } from '../../concurrency.js';
import type { ResolvedAgentConfig } from '../../config.js';

import type { PipelineContext } from '../types.js';
import { registerCompileStage } from '../registry.js';
import { resolveAgentConfig } from '../agent-config.js';
import { createToolTracker, createStageSpanWiring } from '../span-wiring.js';
import { prepareEvaluationSnapshot } from '../../evaluation/index.js';
import { runReviewCycle } from '../runners.js';
import { runArchitectureReviewCycleStage, runCohesionReviewCycleStage } from './compile-review-cycles.js';
import { estimateCompilePreflightRisk, formatCompilePreflightPromptAppend } from '../../compile-resilience/preflight.js';
import { compileContextGuardOptions, CompileScopeContextError, type CompileContextGuardOptions } from '../../compile-resilience/context-guard.js';
import { derivePlannerInspectionBudget } from '../../compile-resilience/planner-inspection.js';
import { applyRetryAsExpeditionPipeline, buildPreflightEscalationDecision, markRetryAsExpeditionStarted, scopeContextFailureEvent, toCompileScopeContextError } from '../../compile-resilience/context-recovery.js';
import { validateCompileArtifacts, validateExpeditionModuleInputs } from '../../compile-resilience/artifact-validation.js';
import { derivePiCompileContextGuard } from '../../harnesses/pi-model-resolution.js';
import { selectCompilePlanningStrategy } from '../../compile-resilience/planning-strategy.js';
import { runBoundedPlannerCompilerCompileStage } from '../../planner-compiler/compile-stage-integration.js';

// ---------------------------------------------------------------------------
// Module-level helpers (extracted from long stage bodies)
// ---------------------------------------------------------------------------

function mergePromptAppend(configured: string | undefined, preflightAppend: string | undefined): string {
  return [configured, preflightAppend].filter((part): part is string => Boolean(part?.trim())).join('\n\n');
}

function shouldFallbackToBoundedPlannerCompiler(f: CompileScopeContextFailure): boolean { return f.stage === 'planner' && f.source === 'live-context-guard' && !f.artifacts.orchestrationExists && f.artifacts.validPlanCount === 0 && f.recovery.action === 'bounded-decomposition'; }

async function resolveModelAwareCompileContextGuardOptions(
  ctx: PipelineContext,
  stage: CompileContextGuardOptions['stage'],
  agentConfig: ResolvedAgentConfig,
): Promise<CompileContextGuardOptions> {
  if (agentConfig.harness !== 'pi') {
    // Claude Agent SDK model-aware guard integration is intentionally not implemented:
    // that harness is expected to be deprecated, and Anthropic policies constrain
    // third-party harness/model metadata integrations.
    return compileContextGuardOptions({ stage, risk: ctx.compilePreflight, limits: ctx.compileContextGuardLimits });
  }
  const derived = await derivePiCompileContextGuard({ model: agentConfig.model, limits: ctx.compileContextGuardLimits });
  return compileContextGuardOptions({
    stage,
    risk: ctx.compilePreflight,
    limits: derived.limits,
    guardDiagnostics: derived.guardDiagnostics,
  });
}

/**
 * Run a single planner attempt (per-retry span + event processing).
 * Extracted from plannerStage to keep the stage body within 80 lines.
 */
async function* runPlannerAttempt(
  input: PlannerContinuationInput,
  ctx: PipelineContext,
  agentConfig: ResolvedAgentConfig,
): AsyncGenerator<EforgeEvent> {
  const { tracker, end, error } = createStageSpanWiring('planner', ctx.tracing, { source: ctx.sourceContent, planSet: ctx.planSetName });
  const { harness: plannerHarness, toolbeltSummary: plannerTb } = ctx.agentRuntimes.forRoleResolved('planner');
  const contextGuard = await resolveModelAwareCompileContextGuardOptions(ctx, 'planner', agentConfig);
  const plannerInspectionBudget = derivePlannerInspectionBudget({
    hardLimits: contextGuard.limits,
    guardDiagnostics: contextGuard.guardDiagnostics,
    plannerMaxTurns: agentConfig.maxTurns,
  });
  try {
    for await (const event of runPlanner(ctx.sourceContent, {
      cwd: ctx.cwd,
      name: ctx.planSetName,
      auto: ctx.auto,
      verbose: ctx.verbose,
      abortController: ctx.abortController,
      onClarification: ctx.onClarification,
      scope: ctx.pipeline.scope,
      outputDir: ctx.config.plan.outputDir,
      baseBranch: ctx.baseBranch,
      defaultBuild: ctx.pipeline.defaultBuild,
      defaultReview: ctx.pipeline.defaultReview,
      promptSourceContent: ctx.promptSourceContent,
      contextGuard,
      plannerInspectionBudget,
      runId: ctx.runId,
      ...agentConfig,
      promptAppend: mergePromptAppend(agentConfig.promptAppend, formatCompilePreflightPromptAppend({ risk: ctx.compilePreflight, bundle: ctx.compilePromptSourceBundle })),
      ...plannerTb,
      phase: 'compile',
      stage: 'planner',
      ...(input.plannerOptions.continuationContext && { continuationContext: input.plannerOptions.continuationContext }),
      harness: plannerHarness,
      lane: 'planning',
    })) {
      // Capture expedition modules from the planner's architecture submission.
      // The planner emits this event directly after writing architecture.md +
      // index.yaml; downstream compile stages gate on ctx.expeditionModules.
      if (event.type === 'expedition:architecture:complete' && ctx.expeditionModules.length === 0) {
        ctx.expeditionModules = event.modules;
      }

      tracker.handleEvent(event);

      // Track skip — halts further compile stages.
      if (event.type === 'planning:skip') {
        ctx.skipped = true;
      }

      if (event.type === 'planning:inspection-summary') {
        ctx.plannerInspectionSummary = event.summary;
      }

      // Suppress planner's planning:complete in expedition mode (compilation emits the real one).
      if (event.type === 'planning:complete' && ctx.expeditionModules.length > 0) {
        continue;
      }

      // Track final plans for review phase and inject pipeline into orchestration.yaml.
      if (event.type === 'planning:complete') {
        const orchYamlPath = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, 'orchestration.yaml');

        // Both injectPipelineIntoOrchestrationYaml() and parseOrchestrationConfig() read
        // orchestration.yaml from disk. If the planner failed to write it, the file won't
        // exist and either call would throw ENOENT. Wrap both in the same try/catch so we
        // fall through to yield the original unenriched plans on any failure.
        try {
          // Inject the pipeline composition (and correct baseBranch) into the planner-written orchestration.yaml.
          await injectPipelineIntoOrchestrationYaml(orchYamlPath, ctx.pipeline, ctx.baseBranch, ctx.diffBaseRef);

          const orchConfig = await parseOrchestrationConfig(orchYamlPath);
          // Yield planning:warning events for any orchestration config warnings
          for (const warning of orchConfig.warnings ?? []) {
            yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'parseOrchestrationConfig' };
          }
          const depsById = new Map(orchConfig.plans.map(p => [p.id, p.dependsOn]));
          const enrichedPlans = event.plans.map(plan => ({
            ...plan,
            dependsOn: depsById.get(plan.id) ?? [],
          }));
          const planConfigs = orchConfig.plans.map(p => ({ id: p.id, build: p.build, review: p.review }));
          ctx.plans = enrichedPlans;
          yield { ...event, plans: enrichedPlans, planConfigs };
          continue;
        } catch {
          // Graceful fallback — yield the original event unchanged.
          ctx.plans = event.plans;
        }
      }

      yield event;
    }
    end();
  } catch (err) {
    error(err as Error);
    const contextError = await toCompileScopeContextError(ctx, err, 'planner', contextGuard.guardDiagnostics);
    if (contextError) throw contextError;
    throw err;
  }
}

/**
 * Run a single module planner attempt for one expedition module.
 * Extracted from modulePlanningStage to keep the stage body within 80 lines.
 * Uses direct span/tracker creation (createStageSpanWiring uses same metadata for
 * createSpan and setInput, but the original code uses different metadata for each).
 */
async function* runModulePlannerAttempt(
  mod: ExpeditionModule,
  ctx: PipelineContext,
  architectureContent: string,
  completedPlans: Map<string, string>,
  agentConfig: ResolvedAgentConfig,
  contextGuard: CompileContextGuardOptions,
): AsyncGenerator<EforgeEvent> {
  // Gather completed dependency plan content from earlier waves
  const depContent = mod.dependsOn
    .map((depId) => completedPlans.get(depId))
    .filter((c): c is string => c !== undefined);
  const dependencyPlanContent = depContent.length > 0
    ? depContent.join('\n\n---\n\n')
    : undefined;

  // Span metadata differs between createSpan and setInput — use direct creation.
  const modSpan = ctx.tracing.createSpan('module-planner', { moduleId: mod.id });
  modSpan.setInput({ moduleId: mod.id, description: mod.description });
  const modTracker = createToolTracker(modSpan);

  const { harness: modulePlannerHarness, toolbeltSummary: modulePlannerTb } = ctx.agentRuntimes.forRoleResolved('module-planner');
  try {
    for await (const event of runModulePlanner({
      cwd: ctx.cwd,
      planSetName: ctx.planSetName,
      moduleId: mod.id,
      moduleDescription: mod.description,
      moduleDependsOn: mod.dependsOn,
      architectureContent,
      sourceContent: ctx.sourceContent,
      promptSourceContent: ctx.promptSourceContent,
      contextGuard,
      dependencyPlanContent,
      verbose: ctx.verbose,
      onClarification: ctx.onClarification,
      abortController: ctx.abortController,
      outputDir: ctx.config.plan.outputDir,
      ...agentConfig,
      promptAppend: mergePromptAppend(agentConfig.promptAppend, formatCompilePreflightPromptAppend({ risk: ctx.compilePreflight, bundle: ctx.compilePromptSourceBundle })),
      ...modulePlannerTb,
      phase: 'compile',
      stage: 'module-planner',
      harness: modulePlannerHarness,
      lane: 'planning',
    })) {
      modTracker.handleEvent(event);

      // Intercept <build-config> blocks from module planner messages
      if (event.type === 'agent:message') {
        const result = parseBuildConfigBlock(event.content);
        if (result.ok) {
          ctx.moduleBuildConfigs.set(mod.id, result.config);
        } else if (result.reason === 'invalid-json' || result.reason === 'invalid-schema') {
          yield {
            timestamp: new Date().toISOString(),
            type: 'planning:module:build-config:invalid' as const,
            moduleId: mod.id,
            reason: result.reason,
            errors: result.reason === 'invalid-schema'
              ? result.errors
              : [`raw: ${result.raw.slice(0, 200)}`],
          };
        }
        // result.reason === 'no-block' → normal case, do nothing
      }

      yield event;
    }
    modTracker.cleanup();
    modSpan.end();
  } catch (err) {
    if (err instanceof CompileScopeContextError) {
      modTracker.cleanup();
      modSpan.error(err);
      throw err;
    }
    const contextError = await toCompileScopeContextError(ctx, err, 'module-planner', contextGuard.guardDiagnostics);
    if (contextError) {
      modTracker.cleanup();
      modSpan.error(contextError);
      throw contextError;
    }
    // Module planning failure is non-fatal - continue with other modules
    modTracker.cleanup();
    modSpan.error(err as Error);
  }
}

// ---------------------------------------------------------------------------
// Built-in Compile Stages
// ---------------------------------------------------------------------------

registerCompileStage({
  name: 'planner',
  phase: 'compile',
  description: 'Runs the LLM planner agent to decompose a PRD into implementation plans with dependency graphs.',
  whenToUse: 'For any task that needs LLM-driven planning and decomposition. The default compile entry point.',
  costHint: 'high',
  conflictsWith: [],
  parallelizable: false,
}, async function* plannerStage(ctx) {
  // Run pipeline composition first (fast LLM call to determine scope and stages)
  const { harness: composerHarness, toolbeltSummary: composerTb } = ctx.agentRuntimes.forRoleResolved('pipeline-composer');
  const composerConfig = resolveAgentConfig('pipeline-composer', ctx.config, undefined, composerTb);
  const composerContextGuard = await resolveModelAwareCompileContextGuardOptions(ctx, 'pipeline-composer', composerConfig);
  const composerOptions: PipelineComposerOptions = {
    source: ctx.sourceContent,
    promptSourceContent: ctx.promptSourceContent,
    contextGuard: composerContextGuard,
    cwd: ctx.cwd,
    verbose: ctx.verbose,
    abortController: ctx.abortController,
    ...composerConfig,
    promptAppend: mergePromptAppend(composerConfig.promptAppend, formatCompilePreflightPromptAppend({ risk: ctx.compilePreflight, bundle: ctx.compilePromptSourceBundle })),
    phase: 'compile',
    stage: 'pipeline-composer',
    harness: composerHarness,
    validationProviders: ctx.extensionValidationProviders,
    lane: 'planning',
  };
  const composerRetryPolicy = DEFAULT_RETRY_POLICIES['pipeline-composer'] as RetryPolicy<PipelineComposerOptions>;
  try {
    yield* withRetry(
      async function* (input: PipelineComposerOptions) {
        for await (const event of composePipeline(input)) {
          if (event.type === 'planning:pipeline') {
          // Update the context pipeline from the composer result
          ctx.pipeline = {
            scope: event.scope as 'errand' | 'excursion' | 'expedition',
            compile: event.compile,
            defaultBuild: event.defaultBuild,
            defaultReview: event.defaultReview,
            rationale: event.rationale,
          };
          if (ctx.compilePromptSourceBundle && ctx.compilePreflightOptions) {
            ctx.compilePreflightOptions = { ...ctx.compilePreflightOptions, requestedPipelineScope: ctx.pipeline.scope };
            ctx.compilePreflight = estimateCompilePreflightRisk(ctx.compilePromptSourceBundle, ctx.compilePreflightOptions);
          }
        }
          yield event;
        }
      },
      composerRetryPolicy,
      composerOptions,
    );
  } catch (err) {
    const contextError = await toCompileScopeContextError(ctx, err, 'pipeline-composer', composerContextGuard.guardDiagnostics);
    throw contextError ?? err;
  }

  const preflightEscalation = await buildPreflightEscalationDecision(ctx);
  if (preflightEscalation?.retryAsExpedition) {
    markRetryAsExpeditionStarted(ctx, preflightEscalation.failure);
    const attempted = ctx.compileScopeRecovery?.lastFailure ?? preflightEscalation.failure;
    yield scopeContextFailureEvent(attempted, ctx.runId);
    applyRetryAsExpeditionPipeline(ctx, attempted.recovery.reason);
    yield { timestamp: new Date().toISOString(), type: 'planning:pipeline', scope: ctx.pipeline.scope, compile: ctx.pipeline.compile, defaultBuild: ctx.pipeline.defaultBuild, defaultReview: ctx.pipeline.defaultReview, rationale: ctx.pipeline.rationale };
  }

  // Guard: if the composer replaced the compile pipeline without 'planner', delegate.
  if (!ctx.pipeline.compile.includes('planner')) {
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Pipeline composer selected [${ctx.pipeline.compile.join(', ')}] — delegating to new compile stages.` };
    return;
  }

  if (selectCompilePlanningStrategy({ risk: ctx.compilePreflight, selectedScope: ctx.pipeline.scope }) === 'context-managed-decomposition') {
    yield* runBoundedPlannerCompilerCompileStage(ctx);
    return;
  }

  const { toolbeltSummary: plannerTbStage } = ctx.agentRuntimes.forRoleResolved('planner');
  const agentConfig = resolveAgentConfig('planner', ctx.config, undefined, plannerTbStage);
  const initialInput: PlannerContinuationInput = {
    sideEffects: {
      cwd: ctx.cwd,
      planCommitCwd: ctx.planCommitCwd,
      planSetName: ctx.planSetName,
      outputDir: ctx.config.plan.outputDir,
    },
    plannerOptions: {},
  };
  const plannerPolicy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
  try {
    yield* withRetry((input) => runPlannerAttempt(input, ctx, agentConfig), plannerPolicy, initialInput);
  } catch (err) {
    const contextError = await toCompileScopeContextError(ctx, err, 'planner');
    if (!contextError) throw err;
    if (shouldFallbackToBoundedPlannerCompiler(contextError.failure)) {
      yield scopeContextFailureEvent(contextError.failure, ctx.runId);
      yield* runBoundedPlannerCompilerCompileStage(ctx);
      return;
    }
    if (contextError.failure.recovery.action !== 'retry-as-expedition' || !contextError.failure.recovery.eligible) throw contextError;
    markRetryAsExpeditionStarted(ctx, contextError.failure);
    const attempted = ctx.compileScopeRecovery?.lastFailure ?? contextError.failure;
    yield scopeContextFailureEvent(attempted, ctx.runId);
    applyRetryAsExpeditionPipeline(ctx, attempted.recovery.reason);
    yield { timestamp: new Date().toISOString(), type: 'planning:pipeline', scope: ctx.pipeline.scope, compile: ctx.pipeline.compile, defaultBuild: ctx.pipeline.defaultBuild, defaultReview: ctx.pipeline.defaultReview, rationale: ctx.pipeline.rationale };
    if (selectCompilePlanningStrategy({ risk: ctx.compilePreflight, selectedScope: ctx.pipeline.scope }) === 'context-managed-decomposition') {
      yield* runBoundedPlannerCompilerCompileStage(ctx);
      return; }
    yield* withRetry((input) => runPlannerAttempt(input, ctx, agentConfig), plannerPolicy, initialInput);
  }

  // Fail loudly if the planner produced expedition modules but compile-expedition
  // is not queued — that stage is the only source of orchestration.yaml, so a
  // silent "Compile complete" would leak into the build phase as a confusing
  // "orchestration.yaml not found" error.
  if (ctx.expeditionModules.length > 0 && !ctx.pipeline.compile.includes('compile-expedition')) {
    throw new Error(
      `Planner identified ${ctx.expeditionModules.length} expedition modules but the compile pipeline `
      + `does not include 'compile-expedition'. orchestration.yaml will not be generated. `
      + `Current compile stages: [${ctx.pipeline.compile.join(', ')}]`,
    );
  }
});

registerCompileStage({
  name: 'plan-review-cycle',
  phase: 'compile',
  description: 'Runs a review-evaluate cycle on generated plans to catch scope and quality issues before build.',
  whenToUse: 'For medium-to-large tasks where plan quality matters. Adds a quality gate between planning and building.',
  costHint: 'medium',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* planReviewCycleStage(ctx) {
  const verbose = ctx.verbose;
  const abortController = ctx.abortController;
  const { harness: planReviewerHarness, toolbeltSummary: planReviewerTb } = ctx.agentRuntimes.forRoleResolved('plan-reviewer');
  const { harness: planEvaluatorHarness, toolbeltSummary: planEvaluatorTb } = ctx.agentRuntimes.forRoleResolved('plan-evaluator');
  const reviewerConfig = resolveAgentConfig('plan-reviewer', ctx.config, undefined, planReviewerTb);
  const evaluatorConfig = resolveAgentConfig('plan-evaluator', ctx.config, undefined, planEvaluatorTb);
  const planSetPath = `${ctx.config.plan.outputDir}/${ctx.planSetName}`;
  const evaluationCommitMessage = `plan(${ctx.planSetName}): planning artifacts`;

  try {
    yield* runReviewCycle({
      tracing: ctx.tracing,
      cwd: ctx.cwd,
      reviewer: {
        role: 'plan-reviewer',
        metadata: { planSet: ctx.planSetName },
        run: () => runPlanReview({
          ...reviewerConfig,
          sourceContent: ctx.sourceContent,
          planSetName: ctx.planSetName,
          cwd: ctx.cwd,
          verbose,
          abortController,
          outputDir: ctx.config.plan.outputDir,
          phase: 'compile',
          stage: 'plan-review',
          harness: planReviewerHarness,
          lane: 'planning',
        }),
      },
      evaluator: {
        role: 'plan-evaluator',
        metadata: { planSet: ctx.planSetName },
        prepareInput: async () => ({
          evaluationSnapshot: await prepareEvaluationSnapshot(ctx.cwd, 'HEAD~1'),
          evaluatorOptions: { allowedPathPrefix: planSetPath, commitMessage: evaluationCommitMessage },
        }),
        run: (input) => runPlanEvaluate({
          ...evaluatorConfig,
          planSetName: ctx.planSetName,
          sourceContent: ctx.sourceContent,
          cwd: ctx.cwd,
          verbose,
          abortController,
          outputDir: ctx.config.plan.outputDir,
          evaluationSnapshot: input.evaluationSnapshot,
          allowedPathPrefix: planSetPath,
          commitMessage: evaluationCommitMessage,
          modelTracker: ctx.modelTracker,
          continuationContext: input.evaluatorOptions.evaluatorContinuationContext,
          phase: 'compile',
          stage: 'plan-evaluate',
          harness: planEvaluatorHarness,
          lane: 'planning',
        }),
      },
    });
  } catch (err) {
    // Plan review failure is non-fatal - plan artifacts are already committed
    yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: `Plan review skipped: ${(err as Error).message}` };
  }
});

registerCompileStage({
  name: 'architecture-review-cycle',
  phase: 'compile',
  description: 'Reviews the architecture document produced by the planner in expedition mode for completeness and correctness.',
  whenToUse: 'For expedition-scale work where an architecture document defines module boundaries and contracts.',
  costHint: 'medium',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* architectureReviewCycleStage(ctx) {
  yield* runArchitectureReviewCycleStage(ctx);
});

registerCompileStage({
  name: 'module-planning',
  phase: 'compile',
  description: 'Plans individual modules in dependency order, running module planners in parallel within each wave.',
  whenToUse: 'For expedition-scale work after architecture review, when the planner has identified modules.',
  costHint: 'high',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* modulePlanningStage(ctx) {
  // Only runs when expedition modules are detected
  if (ctx.expeditionModules.length === 0) return;

  const cwd = ctx.cwd;
  const planDir = resolve(cwd, ctx.config.plan.outputDir, ctx.planSetName);

  // Read architecture content for module planners
  let architectureContent = '';
  try {
    architectureContent = await readFile(resolve(planDir, 'architecture.md'), 'utf-8');
  } catch {
    // Architecture file may not exist if planner didn't create it
  }

  // 1. Compute dependency waves via topological sort
  const plansForGraph = ctx.expeditionModules.map((mod) => ({
    id: mod.id,
    name: mod.id,
    dependsOn: mod.dependsOn,
    branch: mod.id,
  }));
  const { waves } = resolveDependencyGraph(plansForGraph);
  const moduleMap = new Map(ctx.expeditionModules.map((m) => [m.id, m]));
  const completedPlans = new Map<string, string>(); // moduleId -> plan file content
  const { toolbeltSummary: modulePlannerTbStage } = ctx.agentRuntimes.forRoleResolved('module-planner');
  const agentConfig = resolveAgentConfig('module-planner', ctx.config, undefined, modulePlannerTbStage);
  const contextGuard = await resolveModelAwareCompileContextGuardOptions(ctx, 'module-planner', agentConfig);

  // 2. Plan each wave (parallel within wave, sequential across waves)
  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const waveModuleIds = waves[waveIdx];
    yield { timestamp: new Date().toISOString(), type: 'expedition:wave:start', wave: waveIdx + 1, moduleIds: waveModuleIds };

    const waveTasks: ParallelTask<EforgeEvent>[] = waveModuleIds.map((modId) => ({
      id: modId,
      run: () => runModulePlannerAttempt(moduleMap.get(modId)!, ctx, architectureContent, completedPlans, agentConfig, contextGuard),
    }));

    yield* runParallel(waveTasks, { rethrowIf: (err) => err instanceof CompileScopeContextError });

    // Read completed module plan files for this wave (context for later waves)
    for (const modId of waveModuleIds) {
      try {
        const content = await readFile(resolve(planDir, 'modules', `${modId}.md`), 'utf-8');
        completedPlans.set(modId, content);
      } catch {
        // Module planner may have failed - skip
      }
    }

    yield { timestamp: new Date().toISOString(), type: 'expedition:wave:complete', wave: waveIdx + 1 };
  }
});

registerCompileStage({
  name: 'cohesion-review-cycle',
  phase: 'compile',
  description: 'Reviews module plans for cohesion and consistency with the architecture document.',
  whenToUse: 'For expedition-scale work after module planning, to ensure modules work together coherently.',
  costHint: 'medium',
  predecessors: ['planner', 'module-planning'],
  parallelizable: false,
}, async function* cohesionReviewCycleStage(ctx) {
  yield* runCohesionReviewCycleStage(ctx);
});

registerCompileStage({
  name: 'compile-expedition',
  phase: 'compile',
  description: 'Compiles module plans into concrete plan files with orchestration config for the build phase.',
  whenToUse: 'Final compile stage for expedition-scale work. Produces the plan files that build stages consume.',
  costHint: 'low',
  predecessors: ['planner', 'module-planning'],
  parallelizable: false,
}, async function* compileExpeditionStage(ctx) {
  // Only runs when expedition modules are detected
  if (ctx.expeditionModules.length === 0) return;

  const moduleValidation = await validateExpeditionModuleInputs(ctx);
  if (!moduleValidation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: moduleValidation.message };
    throw new Error(moduleValidation.message);
  }

  yield { timestamp: new Date().toISOString(), type: 'expedition:compile:start' };
  await compileExpedition(ctx.cwd, ctx.planSetName, ctx.moduleBuildConfigs, ctx.config.plan.outputDir);

  // Write the full pipeline composition and backfill per-plan build/review from
  // defaults for any module whose planner didn't emit a <build-config> block.
  // Without this, parseOrchestrationConfig rejects the file.
  const orchYamlPath = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName, 'orchestration.yaml');
  await injectPipelineIntoOrchestrationYaml(orchYamlPath, ctx.pipeline, ctx.baseBranch, ctx.diffBaseRef);

  const artifactValidation = await validateCompileArtifacts(ctx);
  for (const warning of artifactValidation.warnings) {
    yield { timestamp: new Date().toISOString(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  }
  if (!artifactValidation.ok) {
    yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: artifactValidation.message };
    throw new Error(artifactValidation.message);
  }
  const plans = artifactValidation.plans;
  const expeditionPlanConfigs = artifactValidation.orchestration?.plans.map(p => ({ id: p.id, build: p.build, review: p.review }));

  yield { timestamp: new Date().toISOString(), type: 'expedition:compile:complete', plans };
  yield { timestamp: new Date().toISOString(), type: 'planning:complete', plans, ...(expeditionPlanConfigs && { planConfigs: expeditionPlanConfigs }) };

  // Update context plans for downstream stages
  ctx.plans = plans;
});
