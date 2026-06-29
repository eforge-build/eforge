import { Type } from '@sinclair/typebox';
import { safeParseWithSchema } from '@eforge-build/client';
import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type ClarificationQuestion } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { REVIEW_PERSPECTIVES } from '@eforge-build/client';
import { createCompileContextGuard, type CompileContextGuardOptions } from '../compile-resilience/context-guard.js';
import type { BoundedPlanningPromptContext } from '../compile-resilience/bounded-planning-context.js';
import { formatBoundedPlanningPromptContext } from '../compile-resilience/bounded-planning-context.js';
import { createPlannerInspectionObserver, derivePlannerInspectionBudget, formatPlannerInspectionHandoffMarkdown, writePlannerInspectionHandoffArtifact, type PlannerInspectionHandoff } from '../compile-resilience/planner-inspection.js';
import { createLinkedAbortController } from './linked-abort-controller.js';

export interface ModulePlannerBoundedCaptureOptions {
  mode: 'capture-only';
  unitId: string;
  artifactDir: string;
  submitToolName?: 'submit_module_plan';
  onModulePlanSubmission: (payload: { markdown: string; buildConfigBlock?: string }) => void;
}

export interface ModulePlannerOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  planSetName: string;
  moduleId: string;
  moduleDescription: string;
  moduleDependsOn: string[];
  architectureContent: string;
  sourceContent: string;
  /** Prompt-safe compacted source content. Defaults to sourceContent. */
  promptSourceContent?: string;
  /** Prompt/live context guardrails for planner-family runs. */
  contextGuard?: CompileContextGuardOptions;
  /** Concatenated plan content from completed dependency modules */
  dependencyPlanContent?: string;
  boundedUnit?: BoundedPlanningPromptContext;
  boundedCapture?: ModulePlannerBoundedCaptureOptions;
  verbose?: boolean;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  abortController?: AbortController;
  /** Override max conversation turns (default: planning tier default) */
  maxTurns?: number;
  /** Called with each fully rendered module-planner prompt before harness execution. */
  onPromptBuilt?: (prompt: string) => void;
  /** Plan output directory (defaults to 'eforge/plans'). */
  outputDir?: string;
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
}

/**
 * Run the module planner agent for a single expedition module.
 * Direct mode reads the architecture and writes a detailed module plan to
 * plans/{planSetName}/modules/{moduleId}.md. Bounded capture-only mode uses
 * the submit_module_plan tool and does not require filesystem writes.
 */
function createModulePlanSubmissionTool(options: ModulePlannerBoundedCaptureOptions, onSubmitted?: () => void): CustomTool {
  const schema = Type.Object({ markdown: Type.String({ minLength: 1 }), buildConfigBlock: Type.Optional(Type.String()) }, { additionalProperties: false });
  let submitted = false;
  return {
    name: options.submitToolName ?? 'submit_module_plan',
    description: 'Submit the bounded module plan markdown. This is the only way to complete a bounded module-planner run.',
    inputSchema: schema,
    handler: async (input: unknown) => {
      const result = safeParseWithSchema(schema, input);
      if (!result.success) return `Submission rejected: ${result.error.message}`;
      if (submitted) return 'Error: a submission tool was already called. Only one submission per module-planning turn is allowed.';
      submitted = true;
      onSubmitted?.();
      options.onModulePlanSubmission(result.data);
      return 'Module plan submitted successfully.';
    },
  };
}

function formatModulePlannerContinuation(handoff: PlannerInspectionHandoff, submitTool: string): string {
  return `## Compact Inspection Continuation\n\nAutomatic bounded module-planner compact continuation is active. Use the unit source and compact handoff below; the root transcript is unavailable by design. Call ${submitTool} when done.\n\n${formatPlannerInspectionHandoffMarkdown(handoff)}`;
}

function formatBoundedDependencySummary(options: ModulePlannerOptions): string {
  if (!options.boundedUnit?.upstreamOutputs.length) return 'No upstream bounded unit dependencies for this module.';
  return options.boundedUnit.upstreamOutputs.map((output) => [
    `- Unit ${output.unitId}`,
    output.status ? `  - Status: ${output.status}` : undefined,
    output.coveredCriteria?.length ? `  - Covered criteria: ${output.coveredCriteria.join(', ')}` : undefined,
    output.compactHandoffRef ? `  - Compact handoff: ${output.compactHandoffRef}` : undefined,
  ].filter(Boolean).join('\n')).join('\n');
}

export async function* runModulePlanner(
  options: ModulePlannerOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'expedition:module:start', moduleId: options.moduleId };

  const promptSourceContent = options.promptSourceContent ?? options.boundedUnit?.unitSourceContent ?? options.sourceContent;
  const boundedContext = options.boundedUnit ? formatBoundedPlanningPromptContext({ ...options.boundedUnit, submitToolName: options.boundedCapture?.submitToolName ?? 'submit_module_plan' }) : '';
  let contextGuard = createCompileContextGuard(options.contextGuard ?? { stage: 'module-planner' });
  let boundedSubmissionCaptured = false;
  const customTools = options.boundedCapture ? [createModulePlanSubmissionTool(options.boundedCapture, () => { boundedSubmissionCaptured = true; })] : undefined;
  const effectiveSubmitTool = options.boundedCapture ? options.harness.effectiveCustomToolName(options.boundedCapture.submitToolName ?? 'submit_module_plan') : '';
  const inspectionBudget = derivePlannerInspectionBudget({ hardLimits: options.contextGuard?.limits, guardDiagnostics: options.contextGuard?.guardDiagnostics, plannerMaxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning, toolUseCaps: { maxToolUses: options.boundedUnit?.budgets.maxLocalExplorationToolUses } });
  const observer = options.boundedCapture ? createPlannerInspectionObserver({ budget: inspectionBudget, stage: 'module-planner' }) : undefined;
  let compactHandoff: PlannerInspectionHandoff | undefined;
  let compactUsed = false;
  let restartedForCompact = false;
  let phase: 'inspection' | 'synthesis' = 'inspection';

  async function buildPrompt(): Promise<string> { return loadPrompt('module-planner', {
    source: promptSourceContent,
    planSetName: options.planSetName,
    moduleId: options.moduleId,
    moduleDescription: options.moduleDescription,
    moduleDependsOn: options.moduleDependsOn.join(', ') || 'none',
    architectureContent: options.architectureContent,
    dependencyPlans: options.boundedUnit ? formatBoundedDependencySummary(options) : (options.dependencyPlanContent || 'No dependencies - this module is planned independently.'),
    cwd: options.cwd,
    outputDir: options.outputDir ?? 'eforge/plans',
    validPerspectives: `${REVIEW_PERSPECTIVES.join(', ')} (built-in defaults; custom extension keys are also accepted as lowercase slugs such as "accessibility" or "performance-review", but generated plans should use built-ins unless a project explicitly configures extension keys)`,
    bounded_unit_context: [boundedContext, compactHandoff ? formatModulePlannerContinuation(compactHandoff, effectiveSubmitTool) : ''].filter(Boolean).join('\n\n'),
  }, options.promptAppend); }

  let prompt = await buildPrompt();
  options.onPromptBuilt?.(prompt);
  observer?.setPrompt(prompt);
  contextGuard.assertPrompt(prompt);

  while (true) {
    const attemptAbort = createLinkedAbortController(options.abortController?.signal);
    try {
      for await (const event of options.harness.run(
        { prompt, cwd: options.cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning, tools: options.boundedCapture ? 'read-only' : 'coding', abortSignal: attemptAbort.signal, customTools, ...pickSdkOptions(options) },
        'module-planner',
        options.lane,
      )) {
        try {
          contextGuard.observe(event);
        } catch (err) {
          attemptAbort.abort();
          throw err;
        }
        const isSubmissionTool = options.boundedCapture ? isModuleSubmissionToolUse(event, options.boundedCapture.submitToolName ?? 'submit_module_plan', effectiveSubmitTool) : false;
        const status = phase === 'inspection' && observer && !boundedSubmissionCaptured && !isSubmissionTool ? observer.observe(event) : undefined;
        // Always yield agent:result + tool events for tracing; gate streaming text on verbose
        if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
          yield event;
        }
        if (status?.shouldHandoff && options.boundedCapture && !compactUsed) {
          compactHandoff = observer!.buildHandoff({ source: { sourceId: options.boundedCapture.unitId, sourceName: options.moduleId, planSetName: options.planSetName }, sourceBuildContext: { sourceSummary: options.moduleDescription, buildGoal: options.moduleDescription, promptSourceSnippet: promptSourceContent }, stage: 'module-planner', incompleteReason: status.reason, prompt });
          const artifactPath = await writePlannerInspectionHandoffArtifact({ cwd: options.cwd, outputDir: options.outputDir ?? 'eforge/plans', planSetName: options.planSetName, artifactDir: options.boundedCapture.artifactDir, handoff: compactHandoff });
          yield { timestamp: new Date().toISOString(), type: 'planning:inspection-summary', summary: compactHandoff, artifactPath };
          compactUsed = true;
          restartedForCompact = true;
          phase = 'synthesis';
          prompt = await buildPrompt();
          options.onPromptBuilt?.(prompt);
          observer?.setPrompt(prompt);
          contextGuard = createCompileContextGuard(options.contextGuard ?? { stage: 'module-planner' });
          try {
            contextGuard.assertPrompt(prompt);
          } catch (err) {
            attemptAbort.abort();
            throw err;
          }
          attemptAbort.abort();
          break;
        }
      }
    } finally {
      attemptAbort.abort();
      attemptAbort.dispose();
    }
    if (restartedForCompact) { restartedForCompact = false; continue; }
    break;
  }

  if (options.boundedCapture && !boundedSubmissionCaptured) throw new Error(`Bounded module planner did not call ${effectiveSubmitTool || (options.boundedCapture.submitToolName ?? 'submit_module_plan')}`);

  yield { timestamp: new Date().toISOString(), type: 'expedition:module:complete', moduleId: options.moduleId };
}

function isModuleSubmissionToolUse(event: EforgeEvent, rawSubmitTool: string, effectiveSubmitTool: string): boolean {
  return event.type === 'agent:tool_use' && (event.tool === rawSubmitTool || event.tool === effectiveSubmitTool);
}
