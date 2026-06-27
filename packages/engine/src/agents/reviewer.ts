import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { classifyAgentTerminalSubtype, pickSdkOptions } from '../harness.js';
import { isRetryableInfrastructureSubtype } from '../retry.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type ReviewIssue } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { getReviewIssueSchemaYaml } from '../schemas.js';
import { assignReviewIssueIds, normalizeReviewIssueId } from '../review-issue-traceability.js';

const exec = promisify(execFile);

/** Max byte length for diff context injected into reviewer prompts. */
const DIFF_CONTEXT_MAX_BYTES = 80_000;

/** Max character length for plan content injected into reviewer prompts. */
export const REVIEW_PLAN_CONTENT_MAX_CHARS = 32_000;

const GENERATED_REVIEW_ARTIFACT_PATH_PREFIXES = [
  'eforge/plans/',
  'eforge/prds/',
] as const;

/**
 * Return true for eforge-owned build provenance artifacts that should not be
 * reviewed as implementation changes. The active plan body is supplied to
 * reviewers separately, and cleanup removes these artifacts after successful
 * builds.
 */
export function isGeneratedReviewArtifactPath(file: string): boolean {
  return GENERATED_REVIEW_ARTIFACT_PATH_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/** Remove eforge-generated build provenance artifacts from review file lists. */
export function filterGeneratedReviewArtifactPaths(files: string[]): string[] {
  return files.filter((file) => !isGeneratedReviewArtifactPath(file));
}

/** Git pathspecs used to keep review diff context focused on implementation changes. */
export function getReviewDiffPathspecArgs(): string[] {
  return [
    '--',
    '.',
    ':(exclude)eforge/plans/**',
    ':(exclude)eforge/prds/**',
    ':(exclude)web/content/reference/**',
    ':(exclude)web/public/reference/**',
    ':(exclude)web/public/schemas/**',
    ':(exclude)web/public/llms-full.txt',
  ];
}

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
): Promise<{ changedFiles: string; changedFilesList: string[]; diffContext: string }> {
  let changedFiles = '';
  let changedFilesList: string[] = [];
  let diffContext = '';

  try {
    const { stdout } = await exec('git', ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '--end-of-options', `${baseBranch}...HEAD`, ...getReviewDiffPathspecArgs()], { cwd });
    changedFilesList = filterGeneratedReviewArtifactPaths(stdout.trim().split('\n').filter(Boolean));
    changedFiles = changedFilesList.join('\n');
  } catch {
    // Not a git repo or git unavailable — leave empty
  }

  try {
    const { stdout } = await exec(
      'git',
      ['diff', '--no-ext-diff', '--no-textconv', '--unified=3', '--stat', '--end-of-options', `${baseBranch}...HEAD`, ...getReviewDiffPathspecArgs()],
      { cwd },
    );
    diffContext = stdout.length > DIFF_CONTEXT_MAX_BYTES
      ? stdout.slice(0, DIFF_CONTEXT_MAX_BYTES) + '\n... [diff truncated]'
      : stdout;
  } catch {
    // Not a git repo or git unavailable — leave empty
  }

  return { changedFiles, changedFilesList, diffContext };
}

/** Bound plan content injected into reviewer prompts so oversized PRDs do not exceed provider context windows. */
export function boundReviewPlanContent(planContent: string): string {
  if (planContent.length <= REVIEW_PLAN_CONTENT_MAX_CHARS) return planContent;

  const marker = `\n\n[... plan content truncated from ${planContent.length} chars to ${REVIEW_PLAN_CONTENT_MAX_CHARS} chars for reviewer context; inspect changed files for omitted details ...]\n\n`;
  const available = Math.max(0, REVIEW_PLAN_CONTENT_MAX_CHARS - marker.length);
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;

  return `${planContent.slice(0, headLength)}${marker}${planContent.slice(planContent.length - tailLength)}`;
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
  /** Override max conversation turns (default: review tier default) */
  maxTurns?: number;
  /** Zero-based review-cycle round for lifecycle event metadata. */
  round?: number;
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
): Promise<{ prompt: string; changedFiles: string[] }> {
  const { changedFiles, changedFilesList, diffContext } = await computeReviewContext(cwd, baseBranch);
  const prompt = await loadPrompt('reviewer', {
    plan_content: boundReviewPlanContent(planContent),
    base_branch: baseBranch,
    changed_files: changedFiles,
    diff_context: diffContext,
    review_issue_schema: getReviewIssueSchemaYaml(),
  }, append);
  return { prompt, changedFiles: changedFilesList };
}

/**
 * Legacy fail-open parser for `<review-issues>` XML blocks.
 *
 * Advisory-only: planning reviewers (plan-reviewer, architecture-reviewer,
 * cohesion-reviewer) intentionally use this parser because their outputs are
 * advisory — a missing or malformed XML block is treated as "no issues" rather
 * than a contract violation. Build reviewers must use parseReviewIssuesStrict
 * instead.
 *
 * Handles:
 * - Multiple `<review-issues>` blocks (merges all issues)
 * - Missing optional attributes (line, fix)
 * - Malformed XML (returns empty array, never throws)
 * - No XML present (returns empty array)
 * - Non-numeric line attribute (silently omits the line field)
 *
 * @deprecated For build reviewers, use parseReviewIssuesStrict which enforces
 *   the terminal-block contract and treats contract violations as critical issues.
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
        const issueId = extractReviewIssueId(attrs);

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

        if (issueId) {
          issue.issueId = issueId;
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
 * Merge streamed reviewer text with final result text without duplicating
 * overlapping complete payloads.
 */
// --- eforge:region reviewer-late-transport-recovery ---
export function mergeReviewerResultText(fullText: string, resultText: string): string {
  if (!fullText) return resultText;
  if (fullText.includes(resultText)) return fullText;
  if (resultText.includes(fullText)) return resultText;
  return fullText + resultText;
}
// --- eforge:endregion reviewer-late-transport-recovery ---

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

function extractReviewIssueId(attrs: string): string | undefined {
  const issueIdMatch = attrs.match(/issueId="([^"]*)"/);
  const kebabIssueIdMatch = attrs.match(/issue-id="([^"]*)"/);
  return normalizeReviewIssueId(issueIdMatch?.[1] ?? kebabIssueIdMatch?.[1]);
}

function reviewIssueLaneForParseResult(parseResult: ParseReviewIssuesResult): string {
  return parseResult.valid ? 'single' : 'review-contract';
}

function assignParsedReviewIssueIds(parseResult: ParseReviewIssuesResult, round: number | undefined): ReviewIssue[] {
  return assignReviewIssueIds(parseResult.issues, { round, lane: reviewIssueLaneForParseResult(parseResult) });
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
  const blocks: Array<{ content: string; endIndex: number }> = [];
  let blockMatch: RegExpExecArray | null;

  try {
    while ((blockMatch = blockRegex.exec(text)) !== null) {
      blocks.push({ content: blockMatch[1], endIndex: blockRegex.lastIndex });
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

  // Exactly one block — enforce terminal-block contract: only whitespace may follow the closing tag.
  const afterBlock = text.slice(blocks[0].endIndex);
  if (afterBlock.trim().length > 0) {
    return {
      valid: false,
      issues: [syntheticContractIssue(
        'Reviewer output has non-whitespace content after the terminal <review-issues> block. ' +
        'Only whitespace may follow the closing tag.',
      )],
      errors: ['Trailing non-whitespace content after </review-issues>'],
    };
  }

  // Exactly one block with valid terminal position — validate each issue inside it
  const blockContent = blocks[0].content;
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
      const lineMatch = attrs.match(/line="([^"]*)"/);
      const issueId = extractReviewIssueId(attrs);

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
        const rawLine = lineMatch[1];
        if (/^[1-9]\d*$/.test(rawLine)) {
          issue.line = Number(rawLine);
        } else {
          errors.push(`Issue has a non-numeric line attribute: "${rawLine}" (must be a positive integer or omitted)`);
          continue;
        }
      }

      if (issueId) {
        issue.issueId = issueId;
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
  const { harness, planContent, baseBranch, planId, cwd, verbose, abortController, round } = options;

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId, ...(round !== undefined ? { round } : {}) };

  const { prompt, changedFiles } = await composeReviewPrompt(planContent, baseBranch, cwd, options.promptAppend);

  let fullText = '';
  let reviewerAgentId: string | undefined;
  let sawAgentResult = false;

  try {
    for await (const event of harness.run(
      { prompt, cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options), changedFiles },
      'reviewer',
      planId,
    )) {
      if (event.type === 'agent:start' && event.agent === 'reviewer') {
        reviewerAgentId = event.agentId;
      }
      if (event.type === 'agent:message' && event.content) {
        fullText += event.content;
      }
      if (event.type === 'agent:result') {
        sawAgentResult = true;
        if ('agentId' in event && typeof event.agentId === 'string') {
          reviewerAgentId = event.agentId;
        }
        if (event.result.resultText) {
          fullText = mergeReviewerResultText(fullText, event.result.resultText);
        }
      }
      if (isAlwaysYieldedAgentEvent(event) || verbose) {
        yield event;
      }
    }
  } catch (err) {
    const terminalSubtype = classifyAgentTerminalSubtype(err);
    const parseResult = parseReviewIssuesStrict(fullText);
    if (sawAgentResult && terminalSubtype !== undefined && isRetryableInfrastructureSubtype(terminalSubtype) && parseResult.valid) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:warning',
        planId,
        agentId: reviewerAgentId ?? 'unknown-reviewer',
        agent: 'reviewer',
        code: 'reviewer-late-infrastructure-error-downgraded',
        message: err instanceof Error ? err.message : String(err),
      };
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: assignParsedReviewIssueIds(parseResult, round), ...(round !== undefined ? { round } : {}) };
      return;
    }
    throw err;
  }

  const parseResult = parseReviewIssuesStrict(fullText);

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: assignParsedReviewIssueIds(parseResult, round), ...(round !== undefined ? { round } : {}) };
}
