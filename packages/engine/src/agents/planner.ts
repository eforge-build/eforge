import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions, PlannerSubmissionError } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type CompileOptions, type ClarificationQuestion, type PlanFile } from '../events.js';
import { parseClarificationBlocks, parseSkipBlock } from './common.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { deriveNameFromSource, extractPlanTitle, parsePlanFile, writePlanSet, writeArchitecture } from '../plan.js';
import {
  getClarificationSchemaYaml, getModuleSchemaYaml, getPlanFrontmatterSchemaYaml,
  planSetSubmissionSchema, architectureSubmissionSchema,
  validatePlanSetSubmission, validateArchitectureSubmission,
  type PlanSetSubmission, type ArchitectureSubmission,
} from '../schemas.js';
import { safeParseWithSchema, type ValueError } from '@eforge-build/client';
import { REVIEW_PERSPECTIVES, type BuildStageSpec, type ReviewProfileConfig } from '@eforge-build/client';
import { emitPlanningDecision } from '../decisions.js';
import {
  formatPlannerToolSchemaValidationError,
  formatPlannerToolSemanticValidationError,
} from '../compile-resilience/diagnostics.js';
import { createCompileContextGuard, type CompileContextGuardOptions } from '../compile-resilience/context-guard.js';
// --- eforge:region plan-02-planner-continuation-surfaces ---
import { createPlannerInspectionObserver, derivePlannerInspectionBudget, formatPlannerInspectionHandoffMarkdown, writePlannerInspectionHandoffArtifact, type PlannerInspectionBudget, type PlannerInspectionHandoff, type PlannerInspectionSourceContext } from '../compile-resilience/planner-inspection.js';
// --- eforge:endregion plan-02-planner-continuation-surfaces ---

export interface PlannerOptions extends CompileOptions, SdkPassthroughConfig {
  harness: AgentHarness;
  /** Prompt-safe compacted source content. Defaults to resolved source content. */
  promptSourceContent?: string;
  /** Prompt/live context guardrails for planner-family runs. */
  contextGuard?: CompileContextGuardOptions;
  // --- eforge:region plan-02-planner-continuation-surfaces ---
  /** Soft-budget observer configuration for compact planner inspection continuation. */ plannerInspectionBudget?: PlannerInspectionBudget;
  /** Run identifier used in compact planner inspection diagnostics. */ runId?: string;
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  /** Pre-determined scope from the pipeline composer (errand/excursion/expedition) */
  scope?: string;
  /** Override max conversation turns (default: planning tier default) */
  maxTurns?: number;
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
  /** Continuation context when restarting after hitting max turns or a dropped submission. */
  continuationContext?: { attempt: number; maxContinuations: number; existingPlans: string; reason: 'max_turns' | 'dropped_submission' };
  /** Plan output directory (defaults to 'eforge/plans'). */
  outputDir?: string;
  /** The actual base branch from the repo (engine-supplied). Used to write orchestration.yaml. */
  baseBranch?: string;
  /** Default build pipeline from the pipeline composer, used as context for decision emission. */
  defaultBuild?: BuildStageSpec[];
  /** Default review profile from the pipeline composer, used as context for decision emission. */
  defaultReview?: ReviewProfileConfig;
}

function createLinkedAbortController(parentSignal?: AbortSignal): AbortController & { dispose: () => void } {
  const controller = new AbortController() as AbortController & { dispose: () => void };
  const abortChild = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
    controller.dispose = () => {};
  } else {
    parentSignal?.addEventListener('abort', abortChild, { once: true });
    controller.dispose = () => parentSignal?.removeEventListener('abort', abortChild);
  }
  return controller;
}

// --- eforge:region plan-02-planner-continuation-surfaces ---
type PlannerExecutionPhase = 'inspection' | 'synthesis';

function synthesisMaxTurns(initialMaxTurns: number): number { return initialMaxTurns <= 1 ? 1 : Math.max(1, Math.min(initialMaxTurns - 1, Math.floor(initialMaxTurns * 0.4))); }
function compactInspectionEnabled(options: PlannerOptions): boolean { return options.continuationContext === undefined; }
function isSubmissionToolUse(event: EforgeEvent, submissionToolNames: ReadonlySet<string>): boolean { return event.type === 'agent:tool_use' && submissionToolNames.has(event.tool); }

function buildInspectionSourceContext(sourceContent: string, promptSourceContent: string, sourceLabel?: string): PlannerInspectionSourceContext {
  return { sourceSummary: sourceLabel ?? firstNonEmptyLine(sourceContent), buildGoal: firstMarkdownHeading(sourceContent) ?? firstNonEmptyLine(sourceContent), promptSourceSnippet: promptSourceContent };
}

function formatCompactInspectionContinuation(handoff: PlannerInspectionHandoff, submitTool: string): string {
  return `## Compact Inspection Continuation

Automatic compact-inspection continuation 1 of 1 is active. The prior inspection attempt was stopped before the hard context guard so synthesis can proceed from bounded evidence.

### Required synthesis objective

Use the original Source section in this prompt plus the compact inspection summary below. Do NOT replay or depend on the full inspection tool transcript; it is intentionally unavailable. Perform only targeted read-only checks if absolutely necessary, then call ${submitTool}. Reasoning text alone does not submit plans.

${formatPlannerInspectionHandoffMarkdown(handoff)}`;
}

function firstMarkdownHeading(text: string): string | undefined {
  return text.split('\n').map((line) => line.trim()).find((line) => /^#{1,3}\s+\S/.test(line))?.replace(/^#{1,3}\s+/, '');
}

function firstNonEmptyLine(text: string): string | undefined { return text.split('\n').map((line) => line.trim()).find((line) => line.length > 0)?.slice(0, 300); }
// --- eforge:endregion plan-02-planner-continuation-surfaces ---

/**
 * Format accumulated clarification Q&A into a prompt section for retry.
 * Returns empty string when there are no prior clarifications.
 */
export function formatPriorClarifications(
  allClarifications: Array<{ questions: ClarificationQuestion[]; answers: Record<string, string> }>,
): string {
  const rows: string[] = [];
  for (const { questions, answers } of allClarifications) {
    for (const q of questions) {
      if (answers[q.id] !== undefined) {
        const escapedQ = q.question.replaceAll('|', '\\|');
        const escapedA = answers[q.id].replaceAll('|', '\\|');
        rows.push(`| ${q.id}: ${escapedQ} | ${escapedA} |`);
      }
    }
  }

  if (rows.length === 0) return '';

  return `## Prior Clarifications

You previously asked the following clarifying questions and received answers. Use these answers directly. Do NOT re-ask these questions or ask for further clarification on topics already covered below.

| Question | Answer |
|----------|--------|
${rows.join('\n')}`;
}

/**
 * Format TypeBox validation errors into a retry-oriented error message.
 *
 * The previous `Validation error: ${result.error.message}` served up a raw
 * JSON-stringified issues array, which models read as "the tool is broken"
 * and abandon in favor of Write. An explicit per-path breakdown plus an
 * explicit "call the tool again" instruction flips that behavior to a retry.
 *
 * TypeBox paths are JSON-pointer strings (e.g. `/plans/0/id`); they are
 * converted to dot-notation (e.g. `plans.0.id`) for readability.
 */
export function formatSubmissionValidationError(errors: readonly ValueError[]): string {
  const lines = errors.map((error) => {
    const path = error.path
      ? (error.path.replace(/^\//, '').replace(/\//g, '.') || '(root)')
      : '(root)';
    return `  - ${path}: ${error.message}`;
  });
  return [
    'Submission rejected: the payload did not validate against the schema.',
    'Fix each issue below and call the submission tool again with the corrected payload.',
    'Do NOT fall back to Write - this tool is the only way to complete the turn.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Create a custom tool for submitting a plan set (errand/excursion mode).
 * The handler validates the payload against the schema and captures it via the callback.
 */
function createPlanSetSubmissionTool(
  onSubmit: (payload: PlanSetSubmission) => boolean,
): CustomTool {
  return {
    name: 'submit_plan_set',
    description: 'Submit a complete plan set with all plan files and orchestration configuration. This is the only way to complete the planning turn for errand/excursion mode.',
    inputSchema: planSetSubmissionSchema,
    handler: async (input: unknown) => {
      const parseResult = safeParseWithSchema(planSetSubmissionSchema, input);
      if (!parseResult.success) {
        return formatPlannerToolSchemaValidationError({
          toolName: 'submit_plan_set',
          schema: planSetSubmissionSchema,
          errors: parseResult.error.errors,
          fullPayload: input,
        });
      }
      const validationResult = validatePlanSetSubmission(parseResult.data);
      if (!validationResult.success) {
        return formatPlannerToolSemanticValidationError({
          toolName: 'submit_plan_set',
          errors: validationResult.error.errors,
          fullPayload: input,
          expectedType: 'valid plan-set submission',
        });
      }
      if (!onSubmit(validationResult.data)) {
        return 'Error: a submission tool was already called. Only one submission per planning turn is allowed.';
      }
      return 'Plan set submitted successfully.';
    },
  };
}

/**
 * Create a custom tool for submitting an architecture (expedition mode).
 * The handler validates the payload against the schema and captures it via the callback.
 */
function createArchitectureSubmissionTool(
  onSubmit: (payload: ArchitectureSubmission) => boolean,
): CustomTool {
  return {
    name: 'submit_architecture',
    description: 'Submit architecture documentation and module definitions for an expedition. This is the only way to complete the planning turn for expedition mode.',
    inputSchema: architectureSubmissionSchema,
    handler: async (input: unknown) => {
      const parseResult = safeParseWithSchema(architectureSubmissionSchema, input);
      if (!parseResult.success) {
        return formatPlannerToolSchemaValidationError({
          toolName: 'submit_architecture',
          schema: architectureSubmissionSchema,
          errors: parseResult.error.errors,
          fullPayload: input,
        });
      }
      const validationResult = validateArchitectureSubmission(parseResult.data);
      if (!validationResult.success) {
        return formatPlannerToolSemanticValidationError({
          toolName: 'submit_architecture',
          errors: validationResult.error.errors,
          fullPayload: input,
          expectedType: 'valid architecture submission',
        });
      }
      if (!onSubmit(validationResult.data)) {
        return 'Error: a submission tool was already called. Only one submission per planning turn is allowed.';
      }
      return 'Architecture submitted successfully.';
    },
  };
}

/**
 * Run the planner agent. Explores the codebase, asks clarifying questions
 * via <clarification> XML blocks, and writes plan files to disk.
 *
 * Clarification flow: when the agent emits <clarification> blocks,
 * the planner pauses, collects answers via onClarification callback,
 * bakes answers into the prompt, and restarts the agent.
 *
 * @param source - PRD file path or inline prompt string
 * @param options - Planner configuration
 * @yields EforgeEvent stream
 */
export async function* runPlanner(
  source: string,
  options: PlannerOptions,
): AsyncGenerator<EforgeEvent> {
  const cwd = options.cwd ?? process.cwd();
  const { harness } = options;
  let contextGuard = createCompileContextGuard(options.contextGuard ?? { stage: 'planner' });

  // Resolve source: file path → read contents, otherwise use as inline string
  let sourceContent: string;
  let sourceResolvedFromFile = false;
  try {
    const sourcePath = resolve(cwd, source);
    const stats = await stat(sourcePath);
    if (stats.isFile()) {
      sourceContent = await readFile(sourcePath, 'utf-8');
      sourceResolvedFromFile = true;
    } else {
      sourceContent = source;
    }
  } catch {
    sourceContent = source;
  }

  // Derive plan set name from options or source
  const planSetName = options.name ?? deriveNameFromSource(source);
  const promptSourceContent = options.promptSourceContent ?? sourceContent;
  // --- eforge:region plan-02-planner-continuation-surfaces ---
  const initialMaxTurns = options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning;
  const inspectionBudget = options.plannerInspectionBudget ?? derivePlannerInspectionBudget({
    hardLimits: options.contextGuard?.limits,
    guardDiagnostics: options.contextGuard?.guardDiagnostics,
    plannerMaxTurns: initialMaxTurns,
  });
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---

  const sourceLabel = extractPlanTitle(source)
    ?? (source.includes('\n') ? source.split('\n')[0].slice(0, 80) : undefined);
  yield { timestamp: new Date().toISOString(), type: 'planning:start', source, ...(sourceLabel && { label: sourceLabel }) };
  yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Loading planner prompt...' };

  // Track clarification Q&A across iterations
  const allClarifications: Array<{ questions: ClarificationQuestion[]; answers: Record<string, string> }> = [];

  // --- eforge:region plan-02-planner-continuation-surfaces ---
  let compactInspectionHandoff: PlannerInspectionHandoff | undefined;
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---

  function buildPrompt(): Promise<string> {
    // Resolve the backend-visible name for the submission tool(s) currently
    // injected into this planner run. The planner prompt uses `{{submitTool}}`
    // placeholders; each backend maps the bare `CustomTool.name` to the name
    // the model will actually see (e.g. the Claude SDK prepends its
    // in-process MCP-server prefix, Pi uses the bare name). When both tools
    // are injected (unknown scope), list both names joined by " or " so the
    // prompt still names the exact per-backend identifiers.
    const effectiveNames = customTools.map(t => harness.effectiveCustomToolName(t.name));
    const submitTool = effectiveNames.join(' or ');

    const continuationSections: string[] = [];
    if (compactInspectionHandoff) {
      continuationSections.push(formatCompactInspectionContinuation(compactInspectionHandoff, submitTool));
    }
    if (options.continuationContext) {
      const { attempt, maxContinuations, existingPlans, reason } = options.continuationContext;
      if (reason === 'dropped_submission') {
        continuationSections.push(`## Continuation Context

This is continuation attempt ${attempt} of ${maxContinuations}. The previous attempt completed reasoning but did not call ${submitTool}. You MUST call ${submitTool} with your final plan set to complete this run — reasoning alone does not submit plans.`);
      } else {
        continuationSections.push(`## Continuation Context

This is continuation attempt ${attempt} of ${maxContinuations}. The planner hit the max turns limit on the previous attempt. The following plan files have already been written. Do NOT redo any of the completed work below.

### Existing Plans

${existingPlans}`);
      }
    }
    const continuationContextText = continuationSections.join('\n\n');

    return loadPrompt('planner', {
      source: promptSourceContent,
      planSetName,
      cwd,
      outputDir: options.outputDir ?? 'eforge/plans',
      priorClarifications: formatPriorClarifications(allClarifications),
      continuation_context: continuationContextText,
      scope: options.scope ?? '',
      parallelLanes: '',
      profiles: '',
      profileGeneration: '',
      clarification_schema: getClarificationSchemaYaml(),
      module_schema: getModuleSchemaYaml(),
      plan_frontmatter_schema: getPlanFrontmatterSchemaYaml(),
      submitTool,
      validPerspectives: `${REVIEW_PERSPECTIVES.join(', ')} (built-in defaults; custom extension keys are also accepted as lowercase slugs such as "accessibility" or "performance-review", but generated plans should use built-ins unless a project explicitly configures extension keys)`,
    }, options.promptAppend);
  }

  let skipEmitted = false;

  // Mutable container for submission payloads — set by custom tool handlers via closure
  const captured: { planSet: PlanSetSubmission | null; architecture: ArchitectureSubmission | null } = {
    planSet: null,
    architecture: null,
  };

  // Create submission tools based on scope
  const customTools: CustomTool[] = [];
  const scope = options.scope;

  const alreadySubmitted = () => captured.planSet !== null || captured.architecture !== null;

  if (scope === 'expedition') {
    customTools.push(createArchitectureSubmissionTool((payload) => { if (alreadySubmitted()) return false; captured.architecture = payload; return true; }));
  } else if (scope === 'errand' || scope === 'excursion') {
    customTools.push(createPlanSetSubmissionTool((payload) => { if (alreadySubmitted()) return false; captured.planSet = payload; return true; }));
  } else {
    // Unknown scope (no pipeline composer) — inject both tools, let the agent choose
    customTools.push(createPlanSetSubmissionTool((payload) => { if (alreadySubmitted()) return false; captured.planSet = payload; return true; }));
    customTools.push(createArchitectureSubmissionTool((payload) => { if (alreadySubmitted()) return false; captured.architecture = payload; return true; }));
  }

  const outputDir = options.outputDir ?? 'eforge/plans';
  const submissionToolNames = new Set(customTools.flatMap((tool) => [tool.name, harness.effectiveCustomToolName(tool.name)]));

  // Main loop: run agent, collect clarifications, restart with answers baked in
  let iteration = 0;
  const maxIterations = 5; // prevent infinite loops
  // --- eforge:region plan-02-planner-continuation-surfaces ---
  const inspectionObserver = compactInspectionEnabled(options)
    ? createPlannerInspectionObserver({ budget: inspectionBudget, stage: 'planner' })
    : undefined;
  let executionPhase: PlannerExecutionPhase = 'inspection';
  let compactInspectionUsed = false;
  let sawSubmissionToolUse = false;
  const plannerBoundaryReached = () => skipEmitted || sawSubmissionToolUse || alreadySubmitted();
  // --- eforge:endregion plan-02-planner-continuation-surfaces ---

  while (iteration < maxIterations) {
    iteration++;

    const prompt = await buildPrompt();
    contextGuard.assertPrompt(prompt);
    inspectionObserver?.setPrompt(prompt);
    const attemptAbort = createLinkedAbortController(options.abortController?.signal);

    if (iteration === 1) {
      yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Starting planner agent...' };
    } else if (executionPhase === 'synthesis') {
      yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Planner resumed from compact inspection summary' };
    } else {
      yield { timestamp: new Date().toISOString(), type: 'planning:progress', message: 'Planner restarted with prior clarifications' };
    }

    let needsRestart = false;

    try {
      for await (const event of harness.run(
        { ...pickSdkOptions(options), prompt, cwd, maxTurns: executionPhase === 'synthesis' ? synthesisMaxTurns(initialMaxTurns) : initialMaxTurns, tools: executionPhase === 'synthesis' ? 'read-only' : 'coding', abortSignal: attemptAbort.signal, customTools },
        'planner',
        options.lane,
      )) {
        try {
          contextGuard.observe(event);
        } catch (err) {
          attemptAbort.abort();
          throw err;
        }
        if (isSubmissionToolUse(event, submissionToolNames)) sawSubmissionToolUse = true;
        const inspectionStatus = executionPhase === 'inspection' && inspectionObserver && !plannerBoundaryReached()
          ? inspectionObserver.observe(event)
          : undefined;
        if (event.type === 'agent:message') {
          if (!skipEmitted) {
            const skipReason = parseSkipBlock(event.content);
            if (skipReason) {
              skipEmitted = true;
              yield { timestamp: new Date().toISOString(), type: 'planning:skip', reason: skipReason };
            }
          }

          const questions = parseClarificationBlocks(event.content);
          if (questions.length > 0 && !options.auto) {
            yield { timestamp: new Date().toISOString(), type: 'planning:clarification', questions };

            if (options.onClarification) {
              const answers = await options.onClarification(questions);
              yield { timestamp: new Date().toISOString(), type: 'planning:clarification:answer', answers };
              allClarifications.push({ questions, answers });
              // Restart agent with answers baked into prompt
              needsRestart = true;
              break;
            }
          }
        }

        // Always yield agent:result + tool events (for tracing); gate streaming text on verbose
        if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
          yield event;
        }

        if (inspectionStatus?.shouldHandoff && !plannerBoundaryReached() && !compactInspectionUsed) {
          compactInspectionHandoff = inspectionObserver!.buildHandoff({
            source: {
              sourceName: sourceLabel ?? planSetName,
              ...(sourceResolvedFromFile ? { sourcePath: source } : {}),
              ...(options.runId ? { buildId: options.runId, runId: options.runId } : {}),
              planSetName,
            },
            sourceBuildContext: buildInspectionSourceContext(sourceContent, promptSourceContent, sourceLabel),
            stage: 'planner',
            incompleteReason: inspectionStatus.reason,
            prompt,
          });
          const artifactPath = await writePlannerInspectionHandoffArtifact({ cwd, outputDir, planSetName, handoff: compactInspectionHandoff });
          yield { timestamp: new Date().toISOString(), type: 'planning:inspection-summary', summary: compactInspectionHandoff, artifactPath };
          yield { timestamp: new Date().toISOString(), type: 'planning:continuation', attempt: 1, maxContinuations: 1, reason: 'compact_inspection' };
          compactInspectionUsed = true;
          executionPhase = 'synthesis';
          contextGuard = createCompileContextGuard(options.contextGuard ?? { stage: 'planner' });
          attemptAbort.abort();
          needsRestart = true;
          break;
        }
      }
    } finally {
      attemptAbort.dispose();
    }

    if (!needsRestart) break;
  }

  // Skip was emitted — no plans to write
  if (skipEmitted) return;

  // Handle plan set submission
  if (captured.planSet) {
    const planSetPayload = captured.planSet;
    yield {
      timestamp: new Date().toISOString(),
      type: 'planning:submission',
      planCount: planSetPayload.plans.length,
      totalBodySize: planSetPayload.plans.reduce((sum: number, p) => sum + p.body.length, 0),
      hasMigrations: planSetPayload.plans.some(p => p.frontmatter.migrations && p.frontmatter.migrations.length > 0),
    };

    await writePlanSet({
      cwd,
      outputDir,
      planSetName,
      payload: planSetPayload,
      baseBranch: options.baseBranch ?? '',
      mode: (options.scope as 'errand' | 'excursion' | 'expedition') ?? 'excursion',
    });

    // Read back written plan files to build PlanFile array
    const planDir = resolve(cwd, outputDir, planSetName);
    const plans: PlanFile[] = [];
    for (const plan of planSetPayload.plans) {
      const filePath = resolve(planDir, `${plan.frontmatter.id}.md`);
      plans.push(await parsePlanFile(filePath));
    }

    const planConfigs = planSetPayload.orchestration.plans
      .filter(p => p.build || p.review)
      .map(p => ({
        id: p.id,
        ...(p.build !== undefined && { build: p.build }),
        ...(p.review !== undefined && { review: p.review }),
      }));

    // Emit planning-phase decision events before planning:complete
    // 1. Plan-set shape decision (multi-plan submissions only)
    if (planSetPayload.plans.length > 1 && planSetPayload.planSetShapeRationale) {
      yield emitPlanningDecision({
        kind: 'plan-set-shape',
        rationale: planSetPayload.planSetShapeRationale,
        planCount: planSetPayload.plans.length,
        planIds: planSetPayload.plans.map(p => p.frontmatter.id),
      });
    }
    // 2. Build-pipeline decision (using defaultBuild from pipeline composer context)
    if (options.defaultBuild && options.defaultBuild.length > 0) {
      const buildRationales = planSetPayload.orchestration.plans
        .filter(p => p.buildRationale)
        .map(p => `${p.id}: ${p.buildRationale}`)
        .join('; ');
      const rationale = buildRationales || 'Using pipeline-composer default build stages';
      yield emitPlanningDecision({
        kind: 'build-pipeline-chosen',
        rationale,
        defaultBuild: options.defaultBuild,
      });
    }
    // 3. Review-profile decision (using defaultReview from pipeline composer context)
    if (options.defaultReview) {
      const reviewRationales = planSetPayload.orchestration.plans
        .filter(p => p.reviewRationale)
        .map(p => `${p.id}: ${p.reviewRationale}`)
        .join('; ');
      const rationale = reviewRationales || 'Using pipeline-composer default review profile';
      yield emitPlanningDecision({
        kind: 'review-profile-chosen',
        rationale,
        strategy: options.defaultReview.strategy,
        perspectives: options.defaultReview.perspectives,
        maxRounds: options.defaultReview.maxRounds,
        evaluatorStrictness: options.defaultReview.evaluatorStrictness,
      });
    }

    yield {
      timestamp: new Date().toISOString(),
      type: 'planning:complete',
      plans,
      ...(planConfigs.length > 0 && { planConfigs }),
    };
    return;
  }

  // Handle architecture submission (expedition)
  if (captured.architecture) {
    const architecturePayload = captured.architecture;
    yield {
      timestamp: new Date().toISOString(),
      type: 'planning:submission',
      planCount: architecturePayload.modules.length,
      totalBodySize: architecturePayload.architecture.length,
      hasMigrations: false,
    };

    await writeArchitecture({ cwd, outputDir, planSetName, payload: architecturePayload });

    yield {
      timestamp: new Date().toISOString(),
      type: 'expedition:architecture:complete',
      modules: architecturePayload.modules.map(m => ({
        id: m.id,
        description: m.description,
        dependsOn: m.dependsOn,
      })),
    };
    return;
  }

  // Neither submission tool was called and no <skip> was emitted — this is a
  // retryable terminal error. Tailor the error to the tools that were actually
  // injected for this scope so the message matches what the agent had available.
  // Report the backend-visible names (each backend translates the bare name via
  // effectiveCustomToolName) so the message reflects what the agent was actually
  // told to call. The pipeline's continuation loop catches this and retries
  // within the shared planner-continuation budget.
  const injectedNames = customTools.map(t => harness.effectiveCustomToolName(t.name)).join(' / ');
  throw new PlannerSubmissionError(`Planner agent completed without calling a submission tool (${injectedNames}) or emitting <skip>`);
}
