import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { mergeMutationDisallowedTools } from '../harnesses/tool-safety.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { parseReviewIssues } from './reviewer.js';
import { getPlanReviewIssueSchemaYaml } from '../schemas.js';
import { safeParseWithSchema } from '@eforge-build/client';
import {
  getPlanningQualityReviewSubmissionSchemaYaml,
  planningQualityReviewSubmissionSchema,
  type PlanningQualityReviewSubmission,
} from '../planning-quality/schemas.js';
import { applyPlanningQualityReviewFixes } from '../planning-quality/apply-fixes.js';
import { formatSubmissionValidationError } from './common.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';

/**
 * Options for the planning quality reviewer agent.
 */
export interface PlanningQualityReviewerOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** The original source/PRD content to review plans against */
  sourceContent: string;
  /** The plan set name (directory under plans/) */
  planSetName: string;
  /** Working directory */
  cwd: string;
  /** Bounded summary of compiler-diagnostics.json for the prompt. */
  diagnosticsSummary: string;
  /** Bounded summary of the deterministic source inventory for the prompt. */
  inventorySummary: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Plan output directory (defaults to 'eforge/plans'). */
  outputDir?: string;
  /** Override max conversation turns (default: review tier default). */
  maxTurns?: number;
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
}

/**
 * Create a custom tool for submitting planning-quality fixes.
 * The handler validates the payload against the schema and captures it via the callback.
 */
function createPlanningQualitySubmissionTool(
  onSubmit: (payload: PlanningQualityReviewSubmission) => boolean,
): CustomTool {
  return {
    name: 'submit_planning_quality_fixes',
    description: 'Submit fixes for planning artifacts. Use this tool to apply all fixes you identified during review. Pass an empty fixes array if no fixes are needed.',
    inputSchema: planningQualityReviewSubmissionSchema,
    handler: async (input: unknown) => {
      const result = safeParseWithSchema(planningQualityReviewSubmissionSchema, input);
      if (!result.success) {
        return formatSubmissionValidationError(result.error.errors);
      }
      if (!onSubmit(result.data)) {
        return 'Error: a submission tool was already called. Only one submission per review turn is allowed.';
      }
      return 'Planning quality fixes submitted successfully.';
    },
  };
}

/**
 * Run the planning quality reviewer agent as a one-shot query.
 *
 * Reviews the bounded planner compiler's artifact set (plan files,
 * orchestration.yaml, architecture.md, acceptance-coverage.md,
 * compiler-diagnostics.json) against the source/PRD across five dimensions:
 * coverage, coherence, buildability, traceability, and pipeline sanity.
 * Submits fixes through the structured submission tool (mutation tools are
 * disallowed); compiler-diagnostics.json has no fix variant by design.
 *
 * Yields:
 * - `planning:review:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `planning:review:complete` with parsed ReviewIssue[] at the end
 */
export async function* runPlanningQualityReview(
  options: PlanningQualityReviewerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, sourceContent, planSetName, cwd, verbose, abortController } = options;

  yield { timestamp: new Date().toISOString(), type: 'planning:review:start' };

  const outputDir = options.outputDir ?? 'eforge/plans';

  // Mutable container for submission payload — set by custom tool handler via closure
  let captured: PlanningQualityReviewSubmission | null = null;

  const submissionTool = createPlanningQualitySubmissionTool((payload) => {
    if (captured !== null) return false;
    captured = payload;
    return true;
  });

  const customTools: CustomTool[] = [submissionTool];
  const submitTool = harness.effectiveCustomToolName(submissionTool.name);

  const prompt = await loadPrompt('planning-quality-reviewer', {
    source_content: sourceContent,
    plan_set_name: planSetName,
    outputDir,
    inventory_summary: options.inventorySummary,
    diagnostics_summary: options.diagnosticsSummary,
    review_issue_schema: getPlanReviewIssueSchemaYaml(),
    submitTool,
    submission_schema: getPlanningQualityReviewSubmissionSchemaYaml(),
  }, options.promptAppend);

  let fullText = '';

  for await (const event of harness.run(
    {
      prompt,
      cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review,
      tools: 'coding',
      abortSignal: abortController?.signal,
      customTools,
      ...pickSdkOptions(options),
      disallowedTools: mergeMutationDisallowedTools(options.disallowedTools),
    },
    'plan-reviewer',
    options.lane,
  )) {
    if (isAlwaysYieldedAgentEvent(event) || verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
  }

  // Apply any captured fixes before parsing issues
  if (captured !== null) {
    await applyPlanningQualityReviewFixes({ cwd, outputDir, planSetName, fixes: (captured as PlanningQualityReviewSubmission).fixes });
  }

  // Advisory-only: like plan-reviewer, this reviewer uses the fail-open parser.
  // Missing or malformed XML is treated as "no issues" — the review cycle
  // adjudicates fixes through the evaluator, and deterministic blocking
  // findings are enforced by the post-cycle artifact revalidation instead.
  const issues = parseReviewIssues(fullText);

  yield { timestamp: new Date().toISOString(), type: 'planning:review:complete', issues };
}
