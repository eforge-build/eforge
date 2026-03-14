import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ForgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { mapSDKMessages } from './common.js';
import { parseReviewIssues } from './reviewer.js';

/**
 * Options for the plan reviewer agent.
 */
export interface PlanReviewerOptions {
  /** The original source/PRD content to review plans against */
  sourceContent: string;
  /** The plan set name (directory under plans/) */
  planSetName: string;
  /** Working directory */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
}

/**
 * Run the plan reviewer agent as a one-shot SDK query.
 *
 * Reviews all plan files in the plan set for cohesion, completeness,
 * correctness, feasibility, dependency ordering, and scope. Leaves
 * any fixes unstaged for the plan evaluator to accept/reject.
 *
 * Yields:
 * - `plan:review:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `plan:review:complete` with parsed ReviewIssue[] at the end
 */
export async function* runPlanReview(
  options: PlanReviewerOptions,
): AsyncGenerator<ForgeEvent> {
  const { sourceContent, planSetName, cwd, verbose, abortController } = options;

  yield { type: 'plan:review:start' };

  const prompt = await loadPrompt('plan-reviewer', {
    source_content: sourceContent,
    plan_set_name: planSetName,
  });

  let fullText = '';

  const q = query({
    prompt,
    options: {
      cwd,
      maxTurns: 30,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController,
    },
  });

  for await (const event of mapSDKMessages(q, 'plan-reviewer')) {
    if (event.type === 'agent:result' || event.type === 'agent:tool_use' || event.type === 'agent:tool_result' || verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
  }

  const issues = parseReviewIssues(fullText);

  yield { type: 'plan:review:complete', issues };
}
