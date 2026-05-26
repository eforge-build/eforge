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
  // --- eforge:region plan-02-engine-acceptance-gates ---
  /** Expected acceptance criteria inventory for prompt injection. When non-empty, the criteria are
   *  listed in the prompt so the validator knows which ACs to produce verdicts for. */
  expectedAcceptanceCriteria?: import('../validation/acceptance-criteria.js').ExpectedAcceptanceCriterion[];
  // --- eforge:endregion plan-02-engine-acceptance-gates ---
  // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
  /** Deterministic validation command results from the validate phase.
   *  When provided, the validator prompt includes a bounded evidence appendix so
   *  command-based acceptance criteria can cite successful command execution. */
  validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }>;
  // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
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

  // --- eforge:region plan-02-engine-acceptance-gates ---
  const criteriaText = options.expectedAcceptanceCriteria && options.expectedAcceptanceCriteria.length > 0
    ? options.expectedAcceptanceCriteria.map((c) => `${c.id}: ${c.text}`).join('\n')
    : '';
  // --- eforge:endregion plan-02-engine-acceptance-gates ---
  // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
  const validationEvidence = formatValidationCommandEvidence(options.validationCommandEvidence);
  const validationEvidenceInstruction = validationEvidence
    ? '9. When the **Deterministic Validation Command Evidence** section is present: a command with exit code 0 MAY serve as supporting evidence for a command-based acceptance criterion (e.g., a passing `pnpm type-check` supports "code must type-check"). A non-zero exit code or timeout is direct failure evidence. Absence of a command result means `unknown` — do not infer success'
    : '';
  // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
  const prompt = await loadPrompt('prd-validator', {
    prd: options.prdContent,
    diff: options.diff,
    // --- eforge:region plan-02-engine-acceptance-gates ---
    criteria: criteriaText,
    // --- eforge:endregion plan-02-engine-acceptance-gates ---
    // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
    validationEvidence,
    validationEvidenceInstruction,
    // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
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

// --- eforge:region plan-01-recovery-and-acceptance-reporting ---
const MAX_COMMAND_OUTPUT_CHARS = 500;

/**
 * Format validation command evidence for injection into the PRD validator prompt.
 * Produces an empty string when no evidence is provided (omits the section entirely).
 * Each command's output is bounded to MAX_COMMAND_OUTPUT_CHARS to prevent context bloat.
 */
export function formatValidationCommandEvidence(
  commands?: Array<{ command: string; exitCode: number; output?: string }>,
): string {
  if (!commands || commands.length === 0) return '';

  const lines: string[] = [
    '## Deterministic Validation Command Evidence',
    '',
    'The following commands were executed in the merge worktree before this validation ran.',
    'Exit code 0 means the command succeeded; non-zero or timed-out means failure.',
    '',
  ];

  for (const cmd of commands) {
    const status = cmd.exitCode === 0 ? 'PASSED' : `FAILED (exit ${cmd.exitCode})`;
    lines.push(`### \`${cmd.command}\` — ${status}`);
    lines.push(`exitCode: ${cmd.exitCode}`);
    if (cmd.output) {
      const truncated = cmd.output.length > MAX_COMMAND_OUTPUT_CHARS
        ? cmd.output.slice(0, MAX_COMMAND_OUTPUT_CHARS) + '\n[...truncated]'
        : cmd.output;
      lines.push('```');
      lines.push(truncated);
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}
// --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---

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
      // --- eforge:region plan-02-engine-acceptance-gates ---
      // Map instead of filter: malformed entries produce a synthetic failure gap rather than
      // being silently dropped. Dropping malformed entries would hide validator bugs and
      // allow a corrupted gap list to appear as "no gaps" (fail-open).
      gaps = parsed.gaps.map((g: unknown): PrdValidationGap => {
        if (
          typeof g === 'object' && g !== null &&
          typeof (g as Record<string, unknown>).requirement === 'string' &&
          typeof (g as Record<string, unknown>).explanation === 'string'
        ) {
          const validGap = g as { requirement: string; explanation: string; complexity?: string };
          const gap: PrdValidationGap = {
            requirement: validGap.requirement,
            explanation: validGap.explanation,
          };
          if (typeof validGap.complexity === 'string' && VALID_COMPLEXITIES.has(validGap.complexity)) {
            gap.complexity = validGap.complexity as PrdValidationGap['complexity'];
          }
          return gap;
        }
        return {
          requirement: 'Malformed PRD validation gap entry',
          explanation: 'The validator returned a gap entry that could not be parsed; treating as a validation failure.',
        };
      });
      // --- eforge:endregion plan-02-engine-acceptance-gates ---
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
