/**
 * Review fixer agent - applies fixes for aggregated review issues.
 * Runs after parallel specialist reviewers to apply their findings.
 * Uses tools: 'coding' to write fixes, but does NOT stage or commit.
 */

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions, isMaxTurnsError } from '../harness.js';
import { SEVERITY_ORDER, isAlwaysYieldedAgentEvent, type EforgeEvent, type ReviewIssue } from '../events.js';
import { loadPrompt } from '../prompts.js';
import type { ReviewFixerContinuationContext } from '../retry.js';

export interface ReviewFixerOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** Plan identifier for event correlation */
  planId: string;
  /** Working directory */
  cwd: string;
  /** Aggregated issues from parallel reviewers */
  issues: ReviewIssue[];
  /** Turn budget (defaults to 80; inherits from tier recipe when called from pipeline) */
  maxTurns?: number;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Continuation context when this is not the first attempt */
  continuationContext?: ReviewFixerContinuationContext;
}

/**
 * Format issues into a human-readable list for the prompt, sorted by severity.
 */
function formatIssuesForPrompt(issues: ReviewIssue[]): string {
  const sorted = [...issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return sorted
    .map((issue, i) => {
      const line = issue.line ? `:${issue.line}` : '';
      const fix = issue.fix ? `\n   Fix: ${issue.fix}` : '';
      return `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.file}${line} — ${issue.category}\n   ${issue.description}${fix}`;
    })
    .join('\n\n');
}

/**
 * Render the continuation context section for the prompt.
 * Returns an empty string when there is no continuation context so
 * loadPrompt's variable substitution finds a defined value.
 */
function renderContinuationContext(ctx: ReviewFixerContinuationContext | undefined): string {
  if (!ctx) return '';
  const lines: string[] = [
    `# Continuation (attempt ${ctx.attempt} of ${ctx.maxContinuations})`,
    '',
    'This is a continuation run. The previous attempt ran out of turns before completing all fixes.',
    'The partial fixes below are already present in the working tree — do not redo them.',
    '',
    '## Fixes already applied',
    '',
    ctx.partialDiff
      ? `\`\`\`diff\n${ctx.partialDiff}\n\`\`\``
      : '(no changes were made in the previous attempt)',
  ];
  return lines.join('\n');
}

/**
 * Run the review fixer agent as a one-shot coding agent.
 *
 * Yields:
 * - `plan:build:review:fix:start` at the beginning
 * - agent lifecycle events
 * - `plan:build:review:fix:complete` at the end
 *
 * Throws:
 * - `AbortError` — propagated immediately for cancellation
 * - `AgentTerminalError` with subtype `error_max_turns` — rethrown so the
 *   caller's retry wrapper can drive a continuation attempt
 */
export async function* runReviewFixer(
  options: ReviewFixerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, planId, cwd, issues, verbose, abortController, continuationContext } = options;
  const maxTurns = options.maxTurns ?? 80;

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:fix:start', planId, issueCount: issues.length };

  const issuesText = formatIssuesForPrompt(issues);
  const continuationText = renderContinuationContext(continuationContext);
  const prompt = await loadPrompt('review-fixer', {
    issues: issuesText,
    continuation_context: continuationText,
  }, options.promptAppend);

  try {
    for await (const event of harness.run(
      {
        prompt,
        cwd,
        maxTurns,
        tools: 'coding',
        abortSignal: abortController?.signal,
        ...pickSdkOptions(options),
      },
      'review-fixer',
      planId,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || verbose) {
        yield event;
      }
    }
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Re-throw max-turns errors so the retry wrapper can drive a continuation
    if (isMaxTurnsError(err)) throw err;
    // Other fixer failures are non-fatal
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:fix:complete', planId };
}
