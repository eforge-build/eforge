import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type ReviewIssue } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { getReviewIssueSchemaYaml } from '../schemas.js';

const exec = promisify(execFile);

/** Max byte length for diff context injected into reviewer prompts. */
const DIFF_CONTEXT_MAX_BYTES = 80_000;

/**
 * Compute the changed-files list and a bounded diff for injection into reviewer prompts.
 * Both values are injected as read-only context so agents with `tools: 'read-only'`
 * (which cannot run Bash/bash) still know which files changed and can use
 * Read/Grep/Glob to inspect them.
 *
 * Errors from git commands are silently swallowed — both values default to an
 * empty string so the prompt is still valid when the cwd is not a git repo
 * (e.g. in unit tests).
 */
export async function computeReviewContext(
  cwd: string,
  baseBranch: string,
): Promise<{ changedFiles: string; diffContext: string }> {
  let changedFiles = '';
  let diffContext = '';

  try {
    const { stdout } = await exec('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '--end-of-options', `${baseBranch}...HEAD`], { cwd });
    changedFiles = stdout.trim();
  } catch {
    // Not a git repo or git unavailable — leave empty
  }

  try {
    const { stdout } = await exec(
      'git',
      ['diff', '--no-ext-diff', '--no-textconv', '--unified=3', '--stat', '--end-of-options', `${baseBranch}...HEAD`],
      { cwd },
    );
    diffContext = stdout.length > DIFF_CONTEXT_MAX_BYTES
      ? stdout.slice(0, DIFF_CONTEXT_MAX_BYTES) + '\n... [diff truncated]'
      : stdout;
  } catch {
    // Not a git repo or git unavailable — leave empty
  }

  return { changedFiles, diffContext };
}

/**
 * Options for the reviewer agent.
 */
export interface ReviewerOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** The plan content (full markdown body) to review against */
  planContent: string;
  /** The base branch to diff against */
  baseBranch: string;
  /** Plan identifier for event correlation */
  planId: string;
  /** Working directory for the review */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
}

/**
 * Compose the reviewer prompt by loading the template and substituting variables.
 * Computes changed-files and diff context from the working directory so the
 * read-only reviewer agent can use Read/Grep/Glob without needing Bash.
 */
export async function composeReviewPrompt(
  planContent: string,
  baseBranch: string,
  cwd: string,
  append?: string,
): Promise<string> {
  const { changedFiles, diffContext } = await computeReviewContext(cwd, baseBranch);
  return loadPrompt('reviewer', {
    plan_content: planContent,
    base_branch: baseBranch,
    changed_files: changedFiles,
    diff_context: diffContext,
    review_issue_schema: getReviewIssueSchemaYaml(),
  }, append);
}

/**
 * Parse `<review-issues>` XML blocks from text into structured ReviewIssue[].
 *
 * Handles:
 * - Multiple `<review-issues>` blocks (merges all issues)
 * - Missing optional attributes (line, fix)
 * - Malformed XML (returns empty array, never throws)
 * - No XML present (returns empty array)
 */
export function parseReviewIssues(text: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  try {
    const blockRegex = /<review-issues>([\s\S]*?)<\/review-issues>/g;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = blockRegex.exec(text)) !== null) {
      const blockContent = blockMatch[1];
      const issueRegex = /<issue\s+([^>]*)>([\s\S]*?)<\/issue>/g;
      let issueMatch: RegExpExecArray | null;

      while ((issueMatch = issueRegex.exec(blockContent)) !== null) {
        const attrs = issueMatch[1];
        const inner = issueMatch[2];

        const severityMatch = attrs.match(/severity="([^"]+)"/);
        const categoryMatch = attrs.match(/category="([^"]+)"/);
        const fileMatch = attrs.match(/file="([^"]+)"/);
        const lineMatch = attrs.match(/line="([^"]+)"/);

        if (!severityMatch || !categoryMatch || !fileMatch) continue;

        const rawSeverity = severityMatch[1];
        const severity = mapSeverity(rawSeverity);
        if (!severity) continue;

        // Extract optional <fix> element
        const fixMatch = inner.match(/<fix>([\s\S]*?)<\/fix>/);
        const fix = fixMatch ? fixMatch[1].trim() : undefined;

        // Description is inner content with <fix> tags removed
        const description = inner
          .replace(/<fix>[\s\S]*?<\/fix>/g, '')
          .trim();

        if (!description) continue;

        const issue: ReviewIssue = {
          severity,
          category: categoryMatch[1],
          file: fileMatch[1],
          description,
        };

        if (lineMatch) {
          const lineNum = parseInt(lineMatch[1], 10);
          if (!isNaN(lineNum)) {
            issue.line = lineNum;
          }
        }

        if (fix) {
          issue.fix = fix;
        }

        issues.push(issue);
      }
    }
  } catch {
    // Malformed XML — return whatever we've parsed so far
    return issues;
  }

  return issues;
}

/**
 * Map raw severity string to the typed severity union.
 * Returns undefined for unrecognized values.
 */
function mapSeverity(raw: string): ReviewIssue['severity'] | undefined {
  switch (raw) {
    case 'critical':
    case 'warning':
    case 'suggestion':
      return raw;
    default:
      return undefined;
  }
}

/**
 * Build a synthetic critical ReviewIssue representing a reviewer contract violation.
 * Used when the reviewer output is missing or malformed, so the review cycle
 * cannot silently treat an invalid review as "no issues found".
 */
function syntheticContractIssue(description: string): ReviewIssue {
  return {
    severity: 'critical',
    category: 'review-contract',
    file: 'reviewer-output',
    description,
  };
}

/**
 * Result type returned by the strict reviewer output parser.
 */
export interface ParseReviewIssuesResult {
  /** Whether the reviewer output satisfied the terminal-block contract. */
  valid: boolean;
  /**
   * Parsed issues on success, or synthetic critical issues describing the
   * contract violation on failure.
   */
  issues: ReviewIssue[];
  /** Human-readable error messages when valid is false. */
  errors: string[];
}

/**
 * Strict parser for `<review-issues>` XML output.
 *
 * Distinguishes valid empty output from invalid/missing contract output:
 * - `<review-issues></review-issues>` → valid: true, issues: []
 * - No block present → valid: false, synthetic critical issue
 * - Multiple blocks → valid: false, synthetic critical issue
 * - Any issue with invalid severity, missing required attributes, or empty
 *   description → valid: false, synthetic critical issue(s)
 *
 * Never throws. Returns valid: false with at least one synthetic critical issue
 * on any contract violation.
 */
export function parseReviewIssuesStrict(text: string): ParseReviewIssuesResult {
  const blockRegex = /<review-issues>([\s\S]*?)<\/review-issues>/g;
  const blocks: string[] = [];
  let blockMatch: RegExpExecArray | null;

  try {
    while ((blockMatch = blockRegex.exec(text)) !== null) {
      blocks.push(blockMatch[1]);
    }
  } catch {
    return {
      valid: false,
      issues: [syntheticContractIssue('Reviewer output contains malformed XML that could not be parsed.')],
      errors: ['Malformed XML in reviewer output'],
    };
  }

  if (blocks.length === 0) {
    return {
      valid: false,
      issues: [syntheticContractIssue('Reviewer output is missing the required <review-issues> terminal block.')],
      errors: ['Missing <review-issues> block'],
    };
  }

  if (blocks.length > 1) {
    return {
      valid: false,
      issues: [syntheticContractIssue(
        `Reviewer output contains ${blocks.length} <review-issues> blocks; exactly one is required.`,
      )],
      errors: [`Multiple <review-issues> blocks: expected 1, found ${blocks.length}`],
    };
  }

  // Exactly one block — validate each issue inside it
  const blockContent = blocks[0];
  const issues: ReviewIssue[] = [];
  const errors: string[] = [];

  try {
    const issueRegex = /<issue\s+([^>]*)>([\s\S]*?)<\/issue>/g;
    const consumedRanges: Array<[number, number]> = [];
    let issueMatch: RegExpExecArray | null;

    while ((issueMatch = issueRegex.exec(blockContent)) !== null) {
      consumedRanges.push([issueMatch.index, issueRegex.lastIndex]);
      const attrs = issueMatch[1];
      const inner = issueMatch[2];

      const severityMatch = attrs.match(/severity="([^"]+)"/);
      const categoryMatch = attrs.match(/category="([^"]+)"/);
      const fileMatch = attrs.match(/file="([^"]+)"/);
      const lineMatch = attrs.match(/line="([^"]+)"/);

      if (!severityMatch) {
        errors.push('Issue is missing required severity attribute');
        continue;
      }
      if (!categoryMatch) {
        errors.push('Issue is missing required category attribute');
        continue;
      }
      if (!fileMatch) {
        errors.push('Issue is missing required file attribute');
        continue;
      }

      const rawSeverity = severityMatch[1];
      const severity = mapSeverity(rawSeverity);
      if (!severity) {
        errors.push(`Issue has invalid severity value: "${rawSeverity}" (must be critical, warning, or suggestion)`);
        continue;
      }

      const fixMatch = inner.match(/<fix>([\s\S]*?)<\/fix>/);
      const fix = fixMatch ? fixMatch[1].trim() : undefined;
      const description = inner.replace(/<fix>[\s\S]*?<\/fix>/g, '').trim();

      if (!description) {
        errors.push(`Issue with category "${categoryMatch[1]}" in file "${fileMatch[1]}" has an empty description`);
        continue;
      }

      const issue: ReviewIssue = {
        severity,
        category: categoryMatch[1],
        file: fileMatch[1],
        description,
      };

      if (lineMatch) {
        const lineNum = parseInt(lineMatch[1], 10);
        if (!isNaN(lineNum)) {
          issue.line = lineNum;
        }
      }

      if (fix) {
        issue.fix = fix;
      }

      issues.push(issue);
    }

    let unmatchedContent = '';
    let cursor = 0;
    for (const [start, end] of consumedRanges) {
      unmatchedContent += blockContent.slice(cursor, start);
      cursor = end;
    }
    unmatchedContent += blockContent.slice(cursor);
    if (unmatchedContent.trim().length > 0) {
      errors.push('The <review-issues> block contains malformed <issue> XML or unexpected text outside <issue> elements');
    }
  } catch {
    return {
      valid: false,
      issues: [syntheticContractIssue('Reviewer output contains malformed XML inside the <review-issues> block.')],
      errors: ['Malformed XML inside <review-issues> block'],
    };
  }

  if (errors.length > 0) {
    return {
      valid: false,
      issues: errors.map((msg) => syntheticContractIssue(msg)),
      errors,
    };
  }

  return { valid: true, issues, errors: [] };
}

/**
 * Run the reviewer agent as a one-shot query.
 *
 * Yields:
 * - `plan:build:review:start` at the beginning
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `plan:build:review:complete` with parsed ReviewIssue[] at the end
 */
export async function* runReview(
  options: ReviewerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, planContent, baseBranch, planId, cwd, verbose, abortController } = options;

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId };

  const prompt = await composeReviewPrompt(planContent, baseBranch, cwd, options.promptAppend);

  let fullText = '';

  for await (const event of harness.run(
    { prompt, cwd, maxTurns: 30, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options) },
    'reviewer',
    planId,
  )) {
    if (isAlwaysYieldedAgentEvent(event) || verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
  }

  const parseResult = parseReviewIssuesStrict(fullText);

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: parseResult.issues };
}
