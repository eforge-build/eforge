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
import { getReviewFixerIssueReferenceSubmissionSchemaYaml, type ReviewFixerIssueReferenceSubmission } from '../schemas.js';
import {
  createReviewFixerIssueReferencesTool,
  parseReviewFixerIssueReferencesBlock,
  REVIEW_FIXER_ISSUE_REFERENCES_TOOL_NAME,
} from './review-fixer-issue-references.js';

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
  /** Prior evaluator feedback from earlier review-cycle rounds. */
  evaluatorFeedbackContext?: string;
  /** Validation-provider recovery context when validate-stage routing invokes the narrow review-fixer path. */
  validationRepairContext?: string;
  /** Zero-based review-cycle round for lifecycle event metadata. */
  round?: number;
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
      const guidance = formatValidationGuidance(issue);
      const issueId = issue.issueId ?? '(none)';
      return `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.file}${line} — ${issue.category}\n   Issue ID: ${issueId}\n   ${issue.description}${guidance}`;
    })
    .join('\n\n');
}

function formatValidationGuidance(issue: ReviewIssue): string {
  const lines: string[] = [];
  if (issue.fix) lines.push(`Fix: ${issue.fix}`);
  if (issue.retryGuidance) lines.push(`Retry guidance: ${issue.retryGuidance}`);
  if (issue.validationProviderName) lines.push(`Validation provider: ${issue.validationProviderName}`);
  if (issue.failureKind) lines.push(`Provider failure kind: ${issue.failureKind}`);
  if (issue.runtimeFailureKind) lines.push(`Runtime failure kind: ${issue.runtimeFailureKind}`);
  if (issue.repairClass) lines.push(`Repair class: ${issue.repairClass}`);
  if (issue.metadata !== undefined) lines.push(`Metadata: ${JSON.stringify(issue.metadata)}`);
  return lines.length > 0 ? `\n   ${lines.join('\n   ')}` : '';
}

/** Maximum number of recent agent:message events to buffer per attempt. */
const MAX_MESSAGE_BUFFER = 5;

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
    'Use the discovery context below along with the remaining review issues to continue where the previous attempt left off — do not restart cold.',
  ];

  // Untracked files
  if (ctx.untrackedFiles && ctx.untrackedFiles.length > 0) {
    lines.push('', '## Untracked files in working tree (new files created but not yet tracked)', '');
    for (const f of ctx.untrackedFiles) {
      lines.push(`- ${f}`);
    }
  }

  // Files inspected
  if (ctx.filesInspected && ctx.filesInspected.length > 0) {
    lines.push('', '## Files inspected / read', '');
    for (const f of ctx.filesInspected) {
      lines.push(`- ${f}`);
    }
  }

  // Searches and globs
  if (ctx.searches && ctx.searches.length > 0) {
    lines.push('', '## Searches and globs run', '');
    for (const s of ctx.searches) {
      lines.push(`- ${s}`);
    }
  }

  // Shell commands
  if (ctx.commands && ctx.commands.length > 0) {
    lines.push('', '## Shell commands run', '');
    for (const c of ctx.commands) {
      lines.push(`- \`${c}\``);
    }
  }

  // Recent agent messages
  if (ctx.recentMessages && ctx.recentMessages.length > 0) {
    lines.push('', '## Recent agent messages', '');
    for (const m of ctx.recentMessages) {
      lines.push(m, '');
    }
  }

  // Useful tool-result snippets
  if (ctx.toolResultSnippets && ctx.toolResultSnippets.length > 0) {
    lines.push('', '## Useful findings from tool results', '');
    for (const s of ctx.toolResultSnippets) {
      lines.push('```', s, '```', '');
    }
  }

  // Partial diff section
  lines.push('', '## Fixes already applied', '');
  if (ctx.partialDiff) {
    lines.push(`\`\`\`diff\n${ctx.partialDiff}\n\`\`\``);
  } else {
    lines.push(
      '(no changes were made in the previous attempt)',
      '',
      'The previous attempt ran out of turns without making changes.',
      'Use the discovery context above and the remaining review issues to make progress.',
    );
  }

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
  const { harness, planId, cwd, issues, verbose, abortController, continuationContext, evaluatorFeedbackContext, validationRepairContext, round } = options;
  const maxTurns = options.maxTurns ?? 80;
  const roundMetadata = round !== undefined ? { round } : {};

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:fix:start', planId, issueCount: issues.length, ...roundMetadata };

  const issuesText = formatIssuesForPrompt(issues);
  const continuationText = renderContinuationContext(continuationContext);
  let structuredIssueReferenceSubmission: ReviewFixerIssueReferenceSubmission | undefined;
  const customTools = [createReviewFixerIssueReferencesTool((submission) => {
    if (structuredIssueReferenceSubmission) return false;
    structuredIssueReferenceSubmission = submission;
  })];
  const submitIssueReferencesTool = harness.effectiveCustomToolName(REVIEW_FIXER_ISSUE_REFERENCES_TOOL_NAME);
  const prompt = await loadPrompt('review-fixer', {
    issues: issuesText,
    evaluator_feedback_context: evaluatorFeedbackContext ?? '',
    validation_repair_context: validationRepairContext ?? '',
    continuation_context: continuationText,
    submit_issue_references_tool: submitIssueReferencesTool,
    issue_reference_submission_schema: getReviewFixerIssueReferenceSubmissionSchemaYaml(),
  }, options.promptAppend);

  // Bounded buffer of recent agent:message events. Yielded before rethrowing
  // a max-turns error so withRetry can include them in the discovery context.
  const messageBuffer: EforgeEvent[] = [];

  let fullText = '';

  try {
    for await (const event of harness.run(
      {
        prompt,
        cwd,
        maxTurns,
        tools: 'coding',
        customTools,
        abortSignal: abortController?.signal,
        ...pickSdkOptions(options),
      },
      'review-fixer',
      planId,
    )) {
      // Buffer recent messages regardless of verbose setting so that the
      // continuation builder can extract them as discovery context.
      if (event.type === 'agent:message') {
        messageBuffer.push(event);
        if (messageBuffer.length > MAX_MESSAGE_BUFFER) {
          messageBuffer.shift();
        }
        if (event.content) {
          fullText += event.content;
        }
      }
      if (event.type === 'agent:result' && event.result.resultText && !fullText.includes(event.result.resultText)) {
        fullText += event.result.resultText;
      }
      if (isAlwaysYieldedAgentEvent(event) || verbose) {
        yield event;
      }
    }
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Re-throw max-turns errors so the retry wrapper can drive a continuation.
    // Yield buffered messages first so withRetry includes them in discovery context.
    // Skip flushing if verbose is true — those messages were already yielded during streaming.
    if (isMaxTurnsError(err)) {
      if (!verbose) {
        for (const msg of messageBuffer) {
          yield msg;
        }
      }
      throw err;
    }
    // Other fixer failures are non-fatal
  }

  const issueReferences = structuredIssueReferenceSubmission?.issueReferences ?? parseReviewFixerIssueReferencesBlock(fullText);
  const issueReferenceMetadata = issueReferences.length > 0 ? { issueReferences } : {};

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:fix:complete', planId, ...roundMetadata, ...issueReferenceMetadata };
}
