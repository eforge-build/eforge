/**
 * Recovery analyst agent runner.
 *
 * One-shot read-only agent (`tools: 'none'`) that forensically reviews a
 * failed build session and emits a typed recovery verdict. Mirrors the
 * staleness-assessor pattern exactly.
 */

import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type BuildFailureSummary } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { getRecoveryVerdictSchemaYaml } from '../schemas.js';
import { parseRecoveryVerdictBlock } from './common.js';
import { determineRecoveryRecommendation, type ContinueRepairEligibilityForRecommendation, type RecoveryRecommendation } from '../recovery/recommendation.js';
import { truncateText } from '../recovery/text-bounds.js';
import { prepareRecoveryAnalystPromptContext } from '../recovery/analyst-context.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options for the recovery analyst agent.
 */
export interface RecoveryAnalystOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** Full PRD file content */
  prdContent: string;
  /** Build failure summary assembled from state + git */
  summary: BuildFailureSummary;
  /** Precomputed deterministic recommendation, including continue-and-repair eligibility. */
  deterministicRecommendation?: RecoveryRecommendation;
  /** Precomputed continue-and-repair eligibility projected for the sidecar. */
  continueRepairEligibility?: ContinueRepairEligibilityForRecommendation;
  /** PRD identifier — propagated into recovery events */
  prdId: string;
  /** Working directory */
  cwd: string;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Override max conversation turns (default: implementation tier default). */
  maxTurns?: number;
}

function formatContinueRepairEligibility(eligibility: ContinueRepairEligibilityForRecommendation | undefined): string {
  if (eligibility === undefined) {
    return 'Continue-and-repair eligibility was not available. Do not infer eligibility from omitted evidence; choose manual unless the failure summary independently justifies retry or abandon.';
  }
  if (!eligibility.eligible) {
    return [
      'Continue-and-repair eligibility: ineligible.',
      eligibility.featureBranch ? `Feature branch: ${eligibility.featureBranch}.` : undefined,
      eligibility.reason ? `Reason: ${eligibility.reason}` : undefined,
    ].filter((line): line is string => line !== undefined).join('\n');
  }
  return [
    'Continue-and-repair eligibility: eligible.',
    eligibility.featureBranch ? `Feature branch: ${eligibility.featureBranch}.` : undefined,
    eligibility.artifactAvailability ? `Artifact availability: ${eligibility.artifactAvailability}.` : undefined,
    eligibility.artifactCommit ? `Artifact commit: ${eligibility.artifactCommit}.` : undefined,
    eligibility.landedCommitCount !== undefined ? `Landed commits: ${eligibility.landedCommitCount}.` : undefined,
    eligibility.failingPlanId ? `Failing plan: ${eligibility.failingPlanId}.` : undefined,
    eligibility.partial !== undefined ? `Partial evidence: ${eligibility.partial ? 'yes' : 'no'}.` : undefined,
  ].filter((line): line is string => line !== undefined).join('\n');
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

/**
 * Run the recovery analyst agent as a one-shot forensic query.
 *
 * Reads the PRD content and build failure summary, then emits a recovery
 * verdict. `tools: 'none'` — the agent is strictly read-only.
 *
 * Yields:
 * - `agent:message`, `agent:tool_use`, `agent:tool_result` events (when verbose)
 * - `agent:result` (always)
 * - `recovery:summary` carrying the BuildFailureSummary
 * - `recovery:complete` carrying the parsed RecoveryVerdict on success
 * - `recovery:error` when the agent output cannot be parsed
 */
export async function* runRecoveryAnalyst(
  options: RecoveryAnalystOptions,
): AsyncGenerator<EforgeEvent> {
  const { harness, prdContent, summary, prdId, cwd, verbose, abortController } = options;

  const partialHint = summary.partial === true
    ? 'Note: this summary is partial (some context was unavailable); prefer verdict=manual and document missing context in the rationale.'
    : '';

  const deterministicRec = options.deterministicRecommendation ?? determineRecoveryRecommendation(summary, options.continueRepairEligibility);
  const promptRationale = truncateText(
    deterministicRec.rationale,
    4_000,
    'deterministic recovery recommendation rationale for prompt',
  ).text;
  const deterministicRecommendation =
    `Deterministic policy recommendation: **${deterministicRec.verdict}**\n\n` +
    `Evidence: ${promptRationale}\n\n` +
    `You may agree or disagree with this recommendation, but you must explain any disagreement with specific evidence from the failure summary. Do not generate successor PRD content.`;
  const continueRepairEligibility = formatContinueRepairEligibility(options.continueRepairEligibility);
  // Build the failing plan IDs list using the same coverage logic as validateAnalystVerdict:
  // prefer failingPlans array, fall back to failingPlan.planId when it is present and not "unknown".
  let failingPlanIds: string[];
  if (summary.failingPlans && summary.failingPlans.length > 0) {
    failingPlanIds = summary.failingPlans.map(p => p.planId);
  } else if (summary.failingPlan?.planId && summary.failingPlan.planId !== 'unknown') {
    failingPlanIds = [summary.failingPlan.planId];
  } else {
    failingPlanIds = [];
  }
  const failedPlanIdsList = failingPlanIds.length > 0
    ? failingPlanIds.join(', ')
    : '(none identified — use partial context indicators in the summary)';

  const promptContext = prepareRecoveryAnalystPromptContext({ prdContent, summary });
  const contextNotes = promptContext.notes.length > 0
    ? promptContext.notes.map(note => `- ${note}`).join('\n')
    : '- No recovery analyst prompt input truncation or evidence omission was applied.';

  const prompt = await loadPrompt(
    'recovery-analyst',
    {
      prdContent: promptContext.prdContent,
      summary: promptContext.summaryJson,
      recovery_schema: getRecoveryVerdictSchemaYaml(),
      partialHint,
      deterministicRecommendation,
      continueRepairEligibility,
      failedPlanIdsList,
      contextNotes,
    },
    options.promptAppend,
  );

  let fullText = '';

  for await (const event of harness.run(
    {
      prompt,
      cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
      tools: 'none',
      abortSignal: abortController?.signal,
      ...pickSdkOptions(options),
    },
    'recovery-analyst',
  )) {
    // Always yield agent:result, agent:tool_use, agent:tool_result; gate agent:message on verbose
    if (isAlwaysYieldedAgentEvent(event) || verbose) {
      yield event;
    }
    if (event.type === 'agent:message' && event.content) {
      fullText += event.content;
    }
    if (event.type === 'agent:result' && event.result.resultText && !fullText.includes(event.result.resultText)) {
      fullText += event.result.resultText;
    }
  }

  // Parse recovery verdict from accumulated text
  const verdict = parseRecoveryVerdictBlock(fullText);

  if (verdict) {
    yield {
      timestamp: new Date().toISOString(),
      type: 'recovery:summary',
      prdId,
      summary,
    };
    yield {
      timestamp: new Date().toISOString(),
      type: 'recovery:complete',
      prdId,
      verdict,
    };
  } else {
    yield {
      timestamp: new Date().toISOString(),
      type: 'recovery:error',
      prdId,
      error: 'Failed to parse recovery verdict from agent output',
      rawOutput: fullText.slice(0, 500),
    };
  }
}
