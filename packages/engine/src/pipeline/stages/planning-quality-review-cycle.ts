/**
 * The bounded planner compiler's unconditional planning quality gate.
 *
 * Runs after the compiler has written and validated its artifacts: a blind
 * reviewer audits coverage/coherence/buildability/traceability/pipeline
 * sanity, an evaluator adjudicates its fixes, artifact consistency validation
 * re-runs (fail-closed), and the final `planning:complete` for the compiler
 * path is emitted from here so accepted orchestration fixes are reflected in
 * the plan configs handed to the build phase.
 *
 * Lives in its own module because compile-stages.ts is at its maintainability
 * ceiling.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EforgeEvent } from '../../events.js';
import { runPlanningQualityReview } from '../../agents/planning-quality-reviewer.js';
import { runPlanningQualityEvaluate } from '../../agents/plan-evaluator.js';
import { prepareEvaluationSnapshot } from '../../evaluation/index.js';
import { validateCompileArtifacts } from '../../compile-resilience/artifact-validation.js';
import {
  COMPILER_DIAGNOSTICS_ARTIFACT,
  validateCompilerDiagnostics,
  type CompilerDiagnostics,
} from '../../planner-compiler/compiler-diagnostics-contracts.js';
import { deriveSourceInventory } from '../../planner-compiler/source-inventory.js';
import {
  summarizeCompilerDiagnosticsForReview,
  summarizeSourceInventoryForReview,
} from '../../planning-quality/summaries.js';
import { parseOrchestrationConfig } from '../../plan.js';
import { runReviewCycle } from '../runners.js';
import { registerCompileStage } from '../registry.js';
import type { PipelineContext } from '../types.js';
import { resolveAgentRuntimeForInvocationWithExtensions } from '../agent-runtime.js';

function runtimeChoiceRouterOptions(ctx: PipelineContext) { const routers = ctx.extensionRuntimeChoiceRouters ?? []; return routers.length === 0 ? undefined : { routers, profileName: ctx.configProfileName ?? 'default', cwd: ctx.cwd, configDir: ctx.extensionConfigDir, timeoutMs: ctx.config.extensions.eventHookTimeoutMs }; }

function now(): string {
  return new Date().toISOString();
}

async function readCompilerDiagnostics(planDir: string): Promise<{ present: boolean; diagnostics?: CompilerDiagnostics; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(resolve(planDir, COMPILER_DIAGNOSTICS_ARTIFACT), 'utf-8');
  } catch {
    return { present: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = validateCompilerDiagnostics(parsed);
    if (!result.ok) return { present: true, error: `invalid compiler diagnostics: ${result.errors.join('; ')}` };
    return { present: true, diagnostics: parsed as CompilerDiagnostics };
  } catch (err) {
    return { present: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build the bounded reviewer summaries. Failures never block the gate: a
 * summary that cannot be built degrades to a placeholder plus a warning.
 */
function buildReviewerSummaries(ctx: PipelineContext, diagnostics: CompilerDiagnostics | undefined): { inventorySummary: string; diagnosticsSummary: string; warnings: string[] } {
  const warnings: string[] = [];
  let inventorySummary = '(inventory summary unavailable)';
  let diagnosticsSummary = '(diagnostics summary unavailable)';
  try {
    const sourceContent = ctx.promptSourceContent ?? ctx.compilePromptSourceBundle?.promptSource ?? ctx.sourceContent;
    inventorySummary = summarizeSourceInventoryForReview(deriveSourceInventory({ content: sourceContent, hash: ctx.compilePromptSourceBundle?.sourceHash }));
  } catch (err) {
    warnings.push(`Failed to summarize source inventory for planning quality review: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (diagnostics) {
    try {
      diagnosticsSummary = summarizeCompilerDiagnosticsForReview(diagnostics);
    } catch (err) {
      warnings.push(`Failed to summarize compiler diagnostics for planning quality review: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { inventorySummary, diagnosticsSummary, warnings };
}

registerCompileStage({
  name: 'planning-quality-review-cycle',
  phase: 'compile',
  description: 'Unconditional planning quality gate for the bounded planner compiler: blind review across coverage, coherence, buildability, traceability, and pipeline sanity, followed by deterministic artifact revalidation.',
  whenToUse: 'Scheduled automatically by the bounded planner compiler path; skips when compiler diagnostics are absent. Do not select manually.',
  costHint: 'medium',
  predecessors: ['planner'],
  parallelizable: false,
}, async function* planningQualityReviewCycleStage(ctx: PipelineContext): AsyncGenerator<EforgeEvent> {
  const planDir = resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);

  // Skip guard: the gate is only meaningful for compiler-produced plan sets.
  const diagnosticsRead = await readCompilerDiagnostics(planDir);
  if (!diagnosticsRead.present) {
    yield { timestamp: now(), type: 'planning:progress', message: 'Planning quality review skipped: no compiler diagnostics artifact.' };
    return;
  }
  if (diagnosticsRead.error) {
    yield { timestamp: now(), type: 'planning:warning', message: `Planning quality review proceeding without diagnostics summary: ${diagnosticsRead.error}`, source: 'artifact-validation' };
  }

  const { inventorySummary, diagnosticsSummary, warnings } = buildReviewerSummaries(ctx, diagnosticsRead.diagnostics);
  for (const warning of warnings) {
    yield { timestamp: now(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  }

  const { agentConfig: reviewerConfig, harness: reviewerHarness } = await resolveAgentRuntimeForInvocationWithExtensions('plan-reviewer', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'planning-quality-review' }, runtimeChoiceRouterOptions(ctx));
  const { agentConfig: evaluatorConfig, harness: evaluatorHarness } = await resolveAgentRuntimeForInvocationWithExtensions('plan-evaluator', ctx.config, ctx.agentRuntimes, undefined, { phase: 'compile', stage: 'planning-quality-evaluate' }, runtimeChoiceRouterOptions(ctx));
  const planSetPath = `${ctx.config.plan.outputDir}/${ctx.planSetName}`;
  const evaluationCommitMessage = `plan(${ctx.planSetName}): planning artifacts`;

  // Review + evaluate: infrastructure failures are non-fatal (fail-open).
  try {
    yield* runReviewCycle({
      tracing: ctx.tracing,
      cwd: ctx.cwd,
      reviewer: {
        role: 'plan-reviewer',
        metadata: { planSet: ctx.planSetName, stage: 'planning-quality-review' },
        run: () => runPlanningQualityReview({
          ...reviewerConfig,
          sourceContent: ctx.sourceContent,
          planSetName: ctx.planSetName,
          cwd: ctx.cwd,
          diagnosticsSummary,
          inventorySummary,
          verbose: ctx.verbose,
          abortController: ctx.abortController,
          outputDir: ctx.config.plan.outputDir,
          phase: 'compile',
          stage: 'planning-quality-review',
          harness: reviewerHarness,
          lane: 'planning',
        }),
      },
      evaluator: {
        role: 'plan-evaluator',
        metadata: { planSet: ctx.planSetName, stage: 'planning-quality-evaluate' },
        prepareInput: async () => ({
          evaluationSnapshot: await prepareEvaluationSnapshot(ctx.cwd, 'HEAD~1'),
          evaluatorOptions: { allowedPathPrefix: planSetPath, commitMessage: evaluationCommitMessage },
        }),
        run: (input) => runPlanningQualityEvaluate({
          ...evaluatorConfig,
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
          stage: 'planning-quality-evaluate',
          harness: evaluatorHarness,
          lane: 'planning',
        }),
      },
    });
  } catch (err) {
    yield { timestamp: now(), type: 'planning:progress', message: `Planning quality review skipped: ${(err as Error).message}` };
  }

  // Re-run deterministic artifact validation after any accepted fixes.
  // This is the fail-closed half of the gate: validated blocking findings
  // (uncovered criterion without a blocking diagnostic, unresolved ownership
  // conflict, fix-introduced artifact breakage) fail the compile.
  const validation = await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' });
  for (const warning of validation.warnings) {
    yield { timestamp: now(), type: 'planning:warning', message: warning, source: 'artifact-validation' };
  }
  if (!validation.ok) {
    yield { timestamp: now(), type: 'planning:error', reason: validation.message };
    throw new Error(validation.message);
  }

  // Emit the compiler path's planning:complete. This stage's events do not
  // pass through the planner stage's enrichment wrapper, so replicate the
  // dependsOn enrichment from orchestration here.
  const orchConfig = await parseOrchestrationConfig(resolve(planDir, 'orchestration.yaml'));
  for (const warning of orchConfig.warnings ?? []) {
    yield { timestamp: now(), type: 'planning:warning', message: warning, source: 'parseOrchestrationConfig' };
  }
  const depsById = new Map(orchConfig.plans.map(plan => [plan.id, plan.dependsOn]));
  const enrichedPlans = validation.plans.map(plan => ({ ...plan, dependsOn: depsById.get(plan.id) ?? [] }));
  const planConfigs = orchConfig.plans.map(plan => ({ id: plan.id, build: plan.build, review: plan.review }));
  ctx.plans = enrichedPlans;
  yield { timestamp: now(), type: 'planning:complete', plans: enrichedPlans, planConfigs };
});
