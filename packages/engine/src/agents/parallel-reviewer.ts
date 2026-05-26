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
import { runReview, parseReviewIssuesStrict, computeReviewContext } from './reviewer.js';
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

function syntheticPerspectiveErrorIssue(perspective: string, err: unknown): ReviewIssue {
  return {
    severity: 'critical',
    category: 'review-contract',
    file: 'reviewer-output',
    description: `Reviewer perspective "${perspective}" failed: ${err instanceof Error ? err.message : String(err)}`,
  };
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
    const { stdout } = await exec('git', ['diff', `${baseBranch}...HEAD`, '--name-only'], { cwd });
    changedFiles = stdout.trim().split('\n').filter(Boolean);
  } catch {
    // Non-git directory or git unavailable — default to empty
  }

  try {
    const { stdout } = await exec('git', ['diff', `${baseBranch}...HEAD`, '--stat'], { cwd });
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
  // --- eforge:region plan-02-extension-perspective-runtime ---
  /** Extension reviewer perspective registrations from the native extension registry. */
  extensionReviewerPerspectives?: ReviewerPerspectiveRegistration[];
  /** Timeout for extension reviewer perspective applicability predicates. */
  extensionApplicabilityTimeoutMs?: number;
  // --- eforge:endregion plan-02-extension-perspective-runtime ---
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
export async function* runParallelReview(
  options: ParallelReviewerOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, planContent, baseBranch, planId, cwd, verbose, abortController, strategy, perspectives: perspectivesOverride, extensionReviewerPerspectives, extensionApplicabilityTimeoutMs } = options;

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
      ...pickSdkOptions(options),
    });
    return;
  }

  // Compute string-format review context once for injection into all perspective prompts.
  // This avoids repeating git invocations per-perspective and ensures reviewers with
  // read-only tools (no bash/Bash) still see the changed files and diff excerpt.
  const reviewContext = await computeReviewContext(cwd, baseBranch);

  // Above threshold (or forced parallel) - run parallel specialist reviewers
  // Use perspectives override if provided, otherwise determine from file categories
  let perspectives: string[];
  // --- eforge:region plan-02-extension-perspective-runtime ---
  // Extension perspective lookup — built from the registry for fast retrieval in tasks
  const extensionPerspectiveByKey = new Map(
    (extensionReviewerPerspectives ?? []).map((r) => [r.value.key, r]),
  );
  // --- eforge:endregion plan-02-extension-perspective-runtime ---

  if (perspectivesOverride) {
    // --- eforge:region plan-02-extension-perspective-runtime ---
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
    // --- eforge:endregion plan-02-extension-perspective-runtime ---
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

    // --- eforge:region plan-02-extension-perspective-runtime ---
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
    // --- eforge:endregion plan-02-extension-perspective-runtime ---
  }

  if (perspectives.length === 0) {
    if (perspectivesOverride) {
      // The user explicitly requested only dynamic perspectives that were
      // skipped (unknown, inapplicable, or failed applicability). Do not ignore
      // that explicit selection by falling back to the generic reviewer.
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId };
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: [] };
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
      ...pickSdkOptions(options),
    });
    return;
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:start', planId };
  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:start', planId, perspectives };

  // Build parallel tasks for each perspective
  const allIssues: Array<{ perspective: string; issues: ReviewIssue[] }> = [];

  const tasks: ParallelTask<EforgeEvent>[] = perspectives.map((perspective) => ({
    id: `review-${perspective}`,
    run: async function* (): AsyncGenerator<EforgeEvent> {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:start', planId, perspective };

      // --- eforge:region plan-02-extension-perspective-runtime ---
      if (!isBuiltInReviewPerspective(perspective)) {
        // Extension perspective dispatch: use generic reviewer prompt with fragment appended
        const registration = extensionPerspectiveByKey.get(perspective);
        if (!registration) {
          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:review:parallel:perspective:error',
            planId,
            perspective,
            error: `Extension perspective '${perspective}' is not registered by any loaded extension`,
          };
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
            plan_content: planContent,
            base_branch: baseBranch,
            changed_files: reviewContext.changedFiles,
            diff_context: reviewContext.diffContext,
            review_issue_schema: getReviewIssueSchemaYaml(),
          }, combinedPromptAppend);

          let fullText = '';

          for await (const event of harness.run(
            { prompt, cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options), perspective },
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
          allIssues.push({ perspective, issues: parseResult.issues });

          yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues: parseResult.issues };
        } catch (err) {
          allIssues.push({ perspective, issues: [syntheticPerspectiveErrorIssue(perspective, err)] });
          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:review:parallel:perspective:error',
            planId,
            perspective,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        return;
      }
      // --- eforge:endregion plan-02-extension-perspective-runtime ---

      try {
        const prompt = await loadPrompt(PERSPECTIVE_PROMPTS[perspective], {
          plan_content: planContent,
          base_branch: baseBranch,
          changed_files: reviewContext.changedFiles,
          diff_context: reviewContext.diffContext,
          review_issue_schema: PERSPECTIVE_SCHEMA_YAML[perspective](),
        }, options.promptAppend);

        let fullText = '';

        for await (const event of harness.run(
          { prompt, cwd, maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.review, tools: 'read-only', abortSignal: abortController?.signal, ...pickSdkOptions(options), perspective },
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
        allIssues.push({ perspective, issues: parseResult.issues });

        yield { timestamp: new Date().toISOString(), type: 'plan:build:review:parallel:perspective:complete', planId, perspective, issues: parseResult.issues };
      } catch (err) {
        allIssues.push({ perspective, issues: [syntheticPerspectiveErrorIssue(perspective, err)] });
        yield {
          timestamp: new Date().toISOString(),
          type: 'plan:build:review:parallel:perspective:error',
          planId,
          perspective,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }));

  // Run all perspective reviews in parallel
  for await (const event of runParallel(tasks)) {
    yield event;
  }

  // Aggregate and deduplicate issues
  const mergedIssues = deduplicateIssues(
    allIssues.flatMap((r) => r.issues),
  );

  yield { timestamp: new Date().toISOString(), type: 'plan:build:review:complete', planId, issues: mergedIssues };
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
