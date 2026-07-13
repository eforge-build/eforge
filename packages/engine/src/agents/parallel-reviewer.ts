/**
 * Parallel review orchestrator - fans out to specialist reviewers when
 * the changeset is large enough, otherwise delegates to the single reviewer.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { SEVERITY_ORDER, isAlwaysYieldedAgentEvent, type EforgeEvent, type ReviewIssue } from '../events.js';
import type { ReviewPerspective } from '../review-heuristics.js';
import { selectInitialReviewPerspectives, shouldParallelizeReview, isBuiltInReviewPerspective, FILE_COUNT_THRESHOLD, LINE_COUNT_THRESHOLD } from '../review-heuristics.js';
import { emitBuildDecisionForPlan } from '../decisions.js';
import { runParallel, type ParallelTask } from '../concurrency.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { assignReviewIssueIds } from '../review-issue-traceability.js';
import {
  runReview,
  parseReviewIssuesStrict,
  computeReviewContext,
  boundReviewPlanContent,
  filterGeneratedReviewArtifactPaths,
  getReviewDiffPathspecArgs,
  mergeReviewerResultText,
} from './reviewer.js';
import { isSalvageableLateReviewerOutputError, salvageReviewIssuesFromMalformedReviewOutput } from './reviewer-output-salvage.js';
import {
  getReviewIssueSchemaYaml,
  getCodeReviewIssueSchemaYaml,
  getSecurityReviewIssueSchemaYaml,
  getApiReviewIssueSchemaYaml,
  getDocsReviewIssueSchemaYaml,
  getTestsReviewIssueSchemaYaml,
  getVerifyReviewIssueSchemaYaml,
} from '../schemas.js';
import type { ReviewerPerspectiveRegistration } from '../extensions/types.js';
import {
  selectExtensionPerspectives,
  buildExtensionPerspectivePromptSection,
} from '../extensions/reviewer-perspective-runtime.js';

const exec = promisify(execFile);

// --- eforge:region reviewer-late-transport-recovery ---
function recoverLateReviewerIssues(fullText: string, err: unknown): ReviewIssue[] | undefined {
  if (!isSalvageableLateReviewerOutputError(err)) return undefined;
  const parseResult = parseReviewIssuesStrict(fullText);
  if (parseResult.valid) return parseResult.issues;
  const salvagedIssues = salvageReviewIssuesFromMalformedReviewOutput(fullText);
  return salvagedIssues.length > 0 ? salvagedIssues : undefined;
}
// --- eforge:endregion reviewer-late-transport-recovery ---

function syntheticPerspectiveErrorIssue(perspective: string, err: unknown): ReviewIssue {
  return {
    severity: 'critical',
    category: 'review-contract',
    file: 'reviewer-output',
    description: `Reviewer perspective "${perspective}" failed: ${err instanceof Error ? err.message : String(err)}`,
  };
}

function assignPerspectiveReviewIssueIds(issues: ReviewIssue[], perspective: string, round: number | undefined): ReviewIssue[] {
  return assignReviewIssueIds(issues, { round, lane: perspective });
}

function aggregateIssuesInPerspectiveOrder(
  allIssues: Array<{ perspective: string; issues: ReviewIssue[] }>,
  perspectives: string[],
): ReviewIssue[] {
  return perspectives.flatMap((perspective) => allIssues
    .filter((entry) => entry.perspective === perspective)
    .flatMap((entry) => entry.issues));
}

/**
 * Compute the changeset metrics used by the auto-threshold parallelization
 * heuristic. Returns file count, changed-line count, and the threshold values
 * so callers can populate the `auto` block of a `review-strategy` decision.
 */
export async function computeReviewThresholdSnapshot(
  cwd: string,
  baseBranch: string,
): Promise<{
  changedFiles: string[];
  changedLines: number;
  willParallelize: boolean;
  threshold: { files: number; lines: number };
}> {
  let changedFiles: string[] = [];
  let changedLines = 0;

  try {
    const { stdout } = await exec('git', ['diff', '--name-only', '--end-of-options', `${baseBranch}...HEAD`, ...getReviewDiffPathspecArgs()], { cwd });
    changedFiles = filterGeneratedReviewArtifactPaths(stdout.trim().split('\n').filter(Boolean));
  } catch {
    // Non-git directory or git unavailable — default to empty
  }

  try {
    const { stdout } = await exec('git', ['diff', '--stat', '--end-of-options', `${baseBranch}...HEAD`, ...getReviewDiffPathspecArgs()], { cwd });
    const statLine = stdout.trim().split('\n').pop() ?? '';
    const insertMatch = statLine.match(/(\d+)\s+insertion/);
    const deleteMatch = statLine.match(/(\d+)\s+deletion/);
    changedLines = (insertMatch ? parseInt(insertMatch[1], 10) : 0) +
      (deleteMatch ? parseInt(deleteMatch[1], 10) : 0);
  } catch {
    // Non-critical — default to 0
  }

  return {
    changedFiles,
    changedLines,
    willParallelize: shouldParallelizeReview(changedFiles, { lines: changedLines }),
    threshold: { files: FILE_COUNT_THRESHOLD, lines: LINE_COUNT_THRESHOLD },
  };
}

export interface ParallelReviewerOptions extends SdkPassthroughConfig {
  /** Harness for running agents */
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
  /** Override review strategy. 'auto' = existing heuristic, 'single' = always single, 'parallel' = always parallel */
  strategy?: 'auto' | 'single' | 'parallel';
  /** Override which review perspectives to use (only applies when parallel path is taken) */
  perspectives?: string[];
  /** Override max conversation turns (default: review tier default) */
  maxTurns?: number;
  /** Extension reviewer perspective registrations from the native extension registry. */
  extensionReviewerPerspectives?: ReviewerPerspectiveRegistration[];
  /** Timeout for extension reviewer perspective applicability predicates. */
  extensionApplicabilityTimeoutMs?: number;
  /** Zero-based review-cycle round for lifecycle event metadata. */
  round?: number;
}

/** Map perspective names to prompt file names */
const PERSPECTIVE_PROMPTS: Record<ReviewPerspective, string> = {
  code: 'reviewer-code',
  security: 'reviewer-security',
  api: 'reviewer-api',
  docs: 'reviewer-docs',
  test: 'reviewer-tests',
  verify: 'reviewer-verify',
};

/** Map perspective names to schema YAML getters */
const PERSPECTIVE_SCHEMA_YAML: Record<ReviewPerspective, () => string> = {
  code: getCodeReviewIssueSchemaYaml,
  security: getSecurityReviewIssueSchemaYaml,
  api: getApiReviewIssueSchemaYaml,
  docs: getDocsReviewIssueSchemaYaml,
  test: getTestsReviewIssueSchemaYaml,
  verify: getVerifyReviewIssueSchemaYaml,
};

/**
 * Run parallel review if the changeset is large enough, otherwise delegate
 * to the existing single `runReview()`.
 *
 * Always yields `plan:build:review:start` and `plan:build:review:complete` with issues.
 * When parallelized, also yields parallel lifecycle events in between.
 */

/**
 * Emits a perspective failure as the wire error event plus a build decision,
 * so degraded review rounds are visible in the monitor's decision trail.
 */
function* perspectiveErrorEvents(planId: string, perspective: string, error: string, roundMetadata: { round?: number }): Generator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:error', planId, perspective, error, ...roundMetadata } as EforgeEvent;
  yield emitBuildDecisionForPlan(planId, {
    kind: 'review-perspective-degraded',
    rationale: `Review perspective '${perspective}' failed and the round continues without it: ${error}`,
    perspective,
    round: roundMetadata.round ?? 0,
  });
}

export async function* runParallelReview(
  options: ParallelReviewerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, planContent, baseBranch, planId, cwd, verbose, abortController, strategy, perspectives: perspectivesOverride, extensionReviewerPerspectives, extensionApplicabilityTimeoutMs, round } = options;
  const roundMetadata = round !== undefined ? { round } : {};

  // Short-circuit: strategy 'single' always delegates to single reviewer
  if (strategy === 'single') {
    yield* runReview({
      harness,
      planContent,
      baseBranch,
      planId,
      cwd,
      verbose,
      abortController,
      promptAppend: options.promptAppend,
      round,
      ...pickSdkOptions(options),
    });
    return;
  }

  // Get changeset metrics (delegates to shared helper to avoid duplication)
  const snapshot = await computeReviewThresholdSnapshot(cwd, baseBranch);
  const changedFiles = snapshot.changedFiles;
  const changedLines = snapshot.changedLines;

  // Check threshold: strategy 'parallel' skips the heuristic, 'auto' (default) uses it
  if (strategy !== 'parallel' && !shouldParallelizeReview(changedFiles, { lines: changedLines })) {
    // Below threshold - delegate to existing single reviewer
    yield* runReview({
      harness,
      planContent,
      baseBranch,
      planId,
      cwd,
      verbose,
      abortController,
      promptAppend: options.promptAppend,
      round,
      ...pickSdkOptions(options),
    });
    return;
  }

  // Compute string-format review context once for injection into all perspective prompts.
  // This avoids repeating git invocations per-perspective and ensures reviewers with
  // read-only tools (no bash/Bash) still see the changed files and diff excerpt.
  const reviewContext = await computeReviewContext(cwd, baseBranch);
  const reviewerPlanContent = boundReviewPlanContent(planContent);

  // Above threshold (or forced parallel) - run parallel specialist reviewers
  // Use perspectives override if provided, otherwise determine from file categories
  let perspectives: string[];
  // Extension perspective lookup — built from the registry for fast retrieval in tasks
  const extensionPerspectiveByKey = new Map(
    (extensionReviewerPerspectives ?? []).map((r) => [r.value.key, r]),
  );

  if (perspectivesOverride) {
    // Explicit mode: keep built-ins as-is, but route dynamic keys through the
    // extension selector so unknown/non-applicable/failing perspectives are
    // diagnosed and skipped rather than dispatched into the built-in maps.
    const builtInPerspectives = perspectivesOverride.filter(isBuiltInReviewPerspective);
    const dynamicPerspectiveKeys = perspectivesOverride.filter((k) => !isBuiltInReviewPerspective(k));
    let selectedExtensionPerspectives: string[] = [];
    if (dynamicPerspectiveKeys.length > 0) {
      const applicabilityInput = { changedFiles, changedLines };
      const selectionResult = await selectExtensionPerspectives({
        registrations: extensionReviewerPerspectives ?? [],
        explicitKeys: dynamicPerspectiveKeys,
        applicabilityInput,
        planId,
        timeoutMs: extensionApplicabilityTimeoutMs,
      });
      for (const diagEvent of selectionResult.diagnosticEvents) {
        yield diagEvent;
      }
      selectedExtensionPerspectives = selectionResult.selectedKeys;
    }
    perspectives = [...builtInPerspectives, ...selectedExtensionPerspectives];
  } else {
    const selection = selectInitialReviewPerspectives({ changedFiles, changedLines });
    perspectives = selection.perspectives;

    // Emit perspectives-inferred decision — only when inference ran (no override supplied)
    yield emitBuildDecisionForPlan(planId, {
      kind: 'perspectives-inferred',
      rationale: `Perspectives inferred from ${changedFiles.length} changed files: ${selection.perspectives.length > 0 ? selection.perspectives.join(', ') : 'none (falling back to single reviewer)'}. ${selection.rationale}`,
      perspectives: selection.perspectives,
      categories: selection.categories,
      rules: selection.rules,
    });

    // Auto-select applicable extension perspectives and append them
    if (extensionReviewerPerspectives && extensionReviewerPerspectives.length > 0) {
      const applicabilityInput = { changedFiles, changedLines };
      const selectionResult = await selectExtensionPerspectives({
        registrations: extensionReviewerPerspectives,
        applicabilityInput,
        planId,
        timeoutMs: extensionApplicabilityTimeoutMs,
      });
      for (const diagEvent of selectionResult.diagnosticEvents) {
        yield diagEvent;
      }
      perspectives = [...perspectives, ...selectionResult.selectedKeys];
    }
  }

  if (perspectives.length === 0) {
    if (perspectivesOverride) {
      // The user explicitly requested only dynamic perspectives that were
      // skipped (unknown, inapplicable, or failed applicability). Do not ignore
      // that explicit selection by falling back to the generic reviewer.
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId, ...roundMetadata };
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: [], ...roundMetadata };
      return;
    }
    // No auto-inferred perspectives - fall back to single reviewer
    yield* runReview({
      harness,
      planContent,
      baseBranch,
      planId,
      cwd,
      verbose,
      abortController,
      promptAppend: options.promptAppend,
      round,
      ...pickSdkOptions(options),
    });
    return;
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId, ...roundMetadata };
  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:start', planId, perspectives, ...roundMetadata };

  // Build parallel tasks for each perspective
  const allIssues: Array<{ perspective: string; issues: ReviewIssue[] }> = [];

  const tasks: ParallelTask<EforgeEvent>[] = perspectives.map((perspective) => ({
    id: `review-${perspective}`,
    run: async function* (): AsyncGenerator<EforgeEvent> {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:start', planId, perspective, ...roundMetadata };

      if (!isBuiltInReviewPerspective(perspective)) {
        // Extension perspective dispatch: use generic reviewer prompt with fragment appended
        const registration = extensionPerspectiveByKey.get(perspective);
        if (!registration) {
          yield* perspectiveErrorEvents(planId, perspective, `Extension perspective '${perspective}' is not registered by any loaded extension`, roundMetadata);
          return;
        }

        try {
          const extensionSection = buildExtensionPerspectivePromptSection(
            registration.extensionName,
            registration.extensionPath,
            registration.value,
          );
          const combinedPromptAppend = options.promptAppend
            ? `${options.promptAppend}\n\n${extensionSection}`
            : extensionSection;

          const prompt = await loadPrompt('reviewer', {
            plan_content: reviewerPlanContent,
            base_branch: baseBranch,
            changed_files: reviewContext.changedFiles,
            diff_context: reviewContext.diffContext,
            review_issue_schema: getReviewIssueSchemaYaml(),
          }, combinedPromptAppend);

          let fullText = '';
          let reviewerAgentId: string | undefined;
          let sawAgentResult = false;

          try {
            for await (const event of harness.run(
              { prompt, cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options), perspective, changedFiles: [...snapshot.changedFiles] },
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

            const parseResult = parseReviewIssuesStrict(fullText);
            const issues = assignPerspectiveReviewIssueIds(parseResult.issues, perspective, round);
            allIssues.push({ perspective, issues });

            yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues, ...roundMetadata };
          } catch (err) {
            const lateIssues = sawAgentResult ? recoverLateReviewerIssues(fullText, err) : undefined;
            if (lateIssues !== undefined) {
              const issues = assignPerspectiveReviewIssueIds(lateIssues, perspective, round);
              allIssues.push({ perspective, issues });
              yield {
                timestamp: new Date().toISOString(),
                type: 'agent:warning',
                planId,
                agentId: reviewerAgentId ?? `unknown-reviewer-${perspective}`,
                agent: 'reviewer',
                code: 'reviewer-late-infrastructure-error-downgraded',
                message: `Reviewer perspective "${perspective}" completed with parseable or salvageable output before a late backend error: ${err instanceof Error ? err.message : String(err)}`,
              };
              yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues, ...roundMetadata };
              return;
            }
            allIssues.push({ perspective, issues: assignPerspectiveReviewIssueIds([syntheticPerspectiveErrorIssue(perspective, err)], perspective, round) });
            yield* perspectiveErrorEvents(planId, perspective, err instanceof Error ? err.message : String(err), roundMetadata);
          }
          return;
        } catch (err) {
          allIssues.push({ perspective, issues: assignPerspectiveReviewIssueIds([syntheticPerspectiveErrorIssue(perspective, err)], perspective, round) });
          yield* perspectiveErrorEvents(planId, perspective, err instanceof Error ? err.message : String(err), roundMetadata);
        }
        return;
      }

      let fullText = '';
      let reviewerAgentId: string | undefined;
      let sawAgentResult = false;

      try {
        const prompt = await loadPrompt(PERSPECTIVE_PROMPTS[perspective], {
          plan_content: reviewerPlanContent,
          base_branch: baseBranch,
          changed_files: reviewContext.changedFiles,
          diff_context: reviewContext.diffContext,
          review_issue_schema: PERSPECTIVE_SCHEMA_YAML[perspective](),
        }, options.promptAppend);

        for await (const event of harness.run(
          { prompt, cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options), perspective, changedFiles: [...snapshot.changedFiles] },
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

        const parseResult = parseReviewIssuesStrict(fullText);
        const issues = assignPerspectiveReviewIssueIds(parseResult.issues, perspective, round);
        allIssues.push({ perspective, issues });

        yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues, ...roundMetadata };
      } catch (err) {
        const lateIssues = sawAgentResult ? recoverLateReviewerIssues(fullText, err) : undefined;
        if (lateIssues !== undefined) {
          const issues = assignPerspectiveReviewIssueIds(lateIssues, perspective, round);
          allIssues.push({ perspective, issues });
          yield {
            timestamp: new Date().toISOString(),
            type: 'agent:warning',
            planId,
            agentId: reviewerAgentId ?? `unknown-reviewer-${perspective}`,
            agent: 'reviewer',
            code: 'reviewer-late-infrastructure-error-downgraded',
            message: `Reviewer perspective "${perspective}" completed with parseable or salvageable output before a late backend error: ${err instanceof Error ? err.message : String(err)}`,
          };
          yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues, ...roundMetadata };
          return;
        }
        allIssues.push({ perspective, issues: assignPerspectiveReviewIssueIds([syntheticPerspectiveErrorIssue(perspective, err)], perspective, round) });
        yield* perspectiveErrorEvents(planId, perspective, err instanceof Error ? err.message : String(err), roundMetadata);
      }
    },
  }));

  // Run all perspective reviews in parallel
  for await (const event of runParallel(tasks)) {
    yield event;
  }

  // Aggregate and deduplicate issues
  const mergedIssues = assignReviewIssueIds(
    deduplicateIssues(aggregateIssuesInPerspectiveOrder(allIssues, perspectives)),
    { round, lane: 'aggregate' },
  );

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: mergedIssues, ...roundMetadata };
}

/**
 * Deduplicate issues that appear across multiple perspectives.
 * Two issues are considered duplicates if they share the same file, line, and
 * a similar description. When duplicates are found, the highest severity wins.
 */
export function deduplicateIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const seen = new Map<string, ReviewIssue>();

  for (const issue of issues) {
    const key = `${issue.file}:${issue.line ?? ''}:${issue.description}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, issue);
    } else if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[existing.severity]) {
      // Higher severity wins
      seen.set(key, issue);
    }
  }

  return Array.from(seen.values());
}
