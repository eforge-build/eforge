import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type PrdValidationGap, type AcceptanceCriterionVerdict } from '../events.js';
import { loadPrompt } from '../prompts.js';

export interface PrdValidatorOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  prdContent: string;
  diff: string;
  verbose?: boolean;
  abortController?: AbortController;
}

/**
 * PRD validator agent — compares original PRD requirements against the full
 * worktree diff and reports substantive gaps. Also produces per-criterion
 * acceptance verdicts for final gate consumption.
 */
export async function* runPrdValidator(
  options: PrdValidatorOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' };

  const prompt = await loadPrompt('prd-validator', {
    prd: options.prdContent,
    diff: options.diff,
  }, options.promptAppend);

  let gaps: PrdValidationGap[] = [];
  let completionPercent: number | undefined;
  let acceptanceVerdicts: AcceptanceCriterionVerdict[] | undefined;

  try {
    let accumulatedText = '';

    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: 15,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'prd-validator',
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }

      // Accumulate text from agent messages
      if (event.type === 'agent:message' && 'content' in event) {
        accumulatedText += event.content;
      }
    }

    // Fail closed on empty output — an agent that produced nothing cannot
    // certify the implementation. This typically means the backend returned
    // no content (e.g. unreachable model).
    if (accumulatedText.trim() === '') {
      throw new Error('PRD validator produced no output — backend may be unreachable');
    }

    // Parse structured JSON output from accumulated text
    const parsed = parseGaps(accumulatedText);
    gaps = parsed.gaps;
    completionPercent = parsed.completionPercent;
    acceptanceVerdicts = parsed.acceptanceVerdicts;
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Re-throw all other errors — fail closed so a broken validator does not
    // silently certify a build as passing.
    throw err;
  }

  const passed = gaps.length === 0;
  yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed, gaps, completionPercent };

  // Synthesize an unknown verdict when the agent omitted the verdict array —
  // fail-closed: missing verdicts cannot certify acceptance criteria as met.
  const synthesizedUnknownVerdict: AcceptanceCriterionVerdict = {
    criterion: 'Acceptance criteria',
    verdict: 'unknown',
    evidence: 'The validator did not produce acceptance criterion verdicts.',
  };
  const verdicts: AcceptanceCriterionVerdict[] = acceptanceVerdicts && acceptanceVerdicts.length > 0
    ? acceptanceVerdicts
    : [synthesizedUnknownVerdict];
  const acceptancePassed = verdicts.every((v) => v.verdict === 'pass');

  yield {
    timestamp: new Date().toISOString(),
    type: 'acceptance_validation:complete',
    passed: acceptancePassed,
    verdicts,
    source: 'prd',
  };
}

const VALID_COMPLEXITIES = new Set(['trivial', 'moderate', 'significant']);

/**
 * Parse gap analysis and acceptance verdict JSON from agent output.
 * Looks for a JSON block containing { "gaps": [...] } and optional fields.
 *
 * Returns `acceptanceVerdicts: undefined` when the verdict array is absent or
 * the output is unparseable — callers should synthesize a failing verdict in
 * that case (fail-closed behavior).
 */
export function parseGaps(text: string): {
  gaps: PrdValidationGap[];
  completionPercent: number | undefined;
  acceptanceVerdicts: AcceptanceCriterionVerdict[] | undefined;
} {
  const unparseableGap: PrdValidationGap = {
    requirement: 'PRD validator output unparseable',
    explanation: 'Agent output did not contain a parsable JSON gap-analysis block.',
  };

  // Try to find a JSON block (fenced or raw)
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ?? text.match(/(\{[\s\S]*"gaps"[\s\S]*\})/);
  if (!jsonMatch) {
    // Non-empty input with no JSON block: fail closed with a synthetic gap.
    if (text.trim() === '') return { gaps: [], completionPercent: undefined, acceptanceVerdicts: undefined };
    return { gaps: [unparseableGap], completionPercent: undefined, acceptanceVerdicts: undefined };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    const completionPercent = typeof parsed.completionPercent === 'number' ? parsed.completionPercent : undefined;

    let gaps: PrdValidationGap[];
    if (Array.isArray(parsed.gaps)) {
      gaps = parsed.gaps
        .filter((g: unknown): g is { requirement: string; explanation: string; complexity?: string } =>
          typeof g === 'object' && g !== null &&
          typeof (g as Record<string, unknown>).requirement === 'string' &&
          typeof (g as Record<string, unknown>).explanation === 'string',
        )
        .map((g: { requirement: string; explanation: string; complexity?: string }) => {
          const gap: PrdValidationGap = {
            requirement: g.requirement,
            explanation: g.explanation,
          };
          if (typeof g.complexity === 'string' && VALID_COMPLEXITIES.has(g.complexity)) {
            gap.complexity = g.complexity as PrdValidationGap['complexity'];
          }
          return gap;
        });
    } else {
      gaps = [unparseableGap];
    }

    // Parse acceptance verdicts — absent key yields undefined (fail-closed signal).
    // Items with missing or empty evidence are classified as `unknown`.
    let acceptanceVerdicts: AcceptanceCriterionVerdict[] | undefined;
    if (Array.isArray(parsed.acceptanceVerdicts) && parsed.acceptanceVerdicts.length > 0) {
      const parsedVerdicts = parsed.acceptanceVerdicts
        .map((v: unknown): AcceptanceCriterionVerdict => {
          if (typeof v !== 'object' || v === null) {
            return {
              criterion: 'Unknown criterion',
              verdict: 'unknown',
              evidence: 'Malformed acceptance verdict entry.',
            };
          }

          const verdictEntry = v as Record<string, unknown>;
          const rawCriterion = verdictEntry.criterion;
          const hasCriterion = typeof rawCriterion === 'string' && rawCriterion.trim() !== '';
          const criterion = hasCriterion ? rawCriterion.trim() : 'Unknown criterion';
          const rawEvidence = typeof verdictEntry.evidence === 'string' ? verdictEntry.evidence.trim() : '';

          // A verdict without a criterion or evidence cannot certify an AC.
          if (!hasCriterion) {
            return {
              criterion,
              verdict: 'unknown',
              evidence: 'No criterion provided for this acceptance verdict.',
            };
          }

          // Missing or empty evidence → unknown (fail-closed)
          if (rawEvidence === '') {
            return {
              criterion,
              verdict: 'unknown',
              evidence: 'No evidence provided for this criterion.',
            };
          }

          const rawVerdict = verdictEntry.verdict;
          let verdict: 'pass' | 'fail' | 'unknown';
          if (rawVerdict === 'pass' || rawVerdict === 'fail' || rawVerdict === 'unknown') {
            verdict = rawVerdict;
          } else {
            verdict = 'unknown';
          }

          return { criterion, verdict, evidence: rawEvidence };
        });
      acceptanceVerdicts = parsedVerdicts.length > 0 ? parsedVerdicts : undefined;
    }

    return { gaps, completionPercent, acceptanceVerdicts };
  } catch {
    // JSON parse failure — fail closed with a synthetic gap
  }

  return { gaps: [unparseableGap], completionPercent: undefined, acceptanceVerdicts: undefined };
}
