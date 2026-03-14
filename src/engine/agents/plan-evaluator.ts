import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ForgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { mapSDKMessages } from './common.js';
import { parseEvaluationBlock } from './builder.js';

/**
 * Options for the plan evaluator agent.
 */
export interface PlanEvaluatorOptions {
  /** The plan set name */
  planSetName: string;
  /** The original source/PRD content for context */
  sourceContent: string;
  /** Working directory */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
}

/**
 * Evaluate the plan reviewer's unstaged fixes. Runs `git reset --soft HEAD~1`
 * to expose staged (planner's plans) vs unstaged (reviewer's fixes), applies
 * verdicts, and commits the final result.
 *
 * Yields:
 * - `plan:evaluate:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `plan:evaluate:complete` with accepted/rejected counts at the end
 */
export async function* runPlanEvaluate(
  options: PlanEvaluatorOptions,
): AsyncGenerator<ForgeEvent> {
  const { planSetName, sourceContent, cwd, verbose, abortController } = options;

  yield { type: 'plan:evaluate:start' };

  const prompt = await loadPrompt('plan-evaluator', {
    plan_set_name: planSetName,
    source_content: sourceContent,
  });

  const q = query({
    prompt,
    options: {
      cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 30,
      abortController,
    },
  });

  let fullText = '';
  try {
    for await (const event of mapSDKMessages(q, 'plan-evaluator')) {
      if (event.type === 'agent:result' || event.type === 'agent:tool_use' || event.type === 'agent:tool_result' || verbose) {
        yield event;
      }
      if (event.type === 'agent:message' && event.content) {
        fullText += event.content;
      }
    }
  } catch (err) {
    yield { type: 'plan:evaluate:complete', accepted: 0, rejected: 0 };
    throw err;
  }

  const verdicts = parseEvaluationBlock(fullText);
  const accepted = verdicts.filter((v) => v.action === 'accept').length;
  const rejected = verdicts.filter((v) => v.action === 'reject' || v.action === 'review').length;

  yield { type: 'plan:evaluate:complete', accepted, rejected };
}
