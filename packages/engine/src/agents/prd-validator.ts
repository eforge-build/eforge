import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent, type PrdValidationGap, type AcceptanceCriterionVerdict, type AcceptanceCriteriaConflict } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';

export interface PrdValidatorOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  prdContent: string;
  diff: string;
  verbose?: boolean;
  abortController?: AbortController;
  /** Override max conversation turns (default: implementation tier default). */
  maxTurns?: number;
  /** Expected acceptance criteria inventory for prompt injection. When non-empty, the criteria are
   *  listed in the prompt so the validator knows which ACs to produce verdicts for. */
  expectedAcceptanceCriteria?: import('../validation/acceptance-criteria.js').ExpectedAcceptanceCriterion[];
  /** Deterministic validation command results from the validate phase.
   *  When provided, the validator prompt includes a bounded evidence appendix so
   *  command-based acceptance criteria can cite successful command execution. */
  validationCommandEvidence?: Array<{ command: string; exitCode: number; output?: string }>;
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

  const criteriaText = options.expectedAcceptanceCriteria && options.expectedAcceptanceCriteria.length > 0
    ? options.expectedAcceptanceCriteria.map((c) => `${c.id}: ${c.text}`).join('\n')
    : '';
  const validationEvidence = formatValidationCommandEvidence(options.validationCommandEvidence);
  const validationEvidenceInstruction = validationEvidence
    ? '10. When the **Deterministic Validation Command Evidence** section is present: a command with exit code 0 MAY serve as supporting evidence for a command-based acceptance criterion (e.g., a passing `pnpm type-check` supports "code must type-check"). A non-zero exit code or timeout is direct failure evidence. Absence of a command result means `unknown` — do not infer success'
    : '';
  const prompt = await loadPrompt('prd-validator', {
    prd: options.prdContent,
    diff: options.diff,
    criteria: criteriaText,
    validationEvidence,
    validationEvidenceInstruction,
  }, options.promptAppend);

  let gaps: PrdValidationGap[] = [];
  let completionPercent: number | undefined;
  let acceptanceVerdicts: AcceptanceCriterionVerdict[] | undefined;
  let acceptanceConflicts: AcceptanceCriteriaConflict[] | undefined;

  try {
    let accumulatedText = '';

    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
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
    acceptanceConflicts = parsed.acceptanceConflicts;
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
    ...(acceptanceConflicts && acceptanceConflicts.length > 0 ? { acceptanceConflicts } : {}),
    source: 'prd',
  };
}

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

const VALID_COMPLEXITIES = new Set(['trivial', 'moderate', 'significant']);
const VALID_CONFLICT_SCOPES = new Set(['narrow', 'broad', 'unknown']);
const VALID_CONFLICT_ACTIONS = new Set(['revise_acceptance_criteria', 'manual_review']);

/**
 * Parse gap analysis and acceptance verdict JSON from agent output.
 * Looks for a JSON object in fenced or raw output and tolerates prose around it.
 *
 * Returns `acceptanceVerdicts: undefined` when the verdict array is absent or
 * the output is unparseable — callers should synthesize a failing verdict in
 * that case (fail-closed behavior).
 */
export function parseGaps(text: string): {
  gaps: PrdValidationGap[];
  completionPercent: number | undefined;
  acceptanceVerdicts: AcceptanceCriterionVerdict[] | undefined;
  acceptanceConflicts: AcceptanceCriteriaConflict[] | undefined;
} {
  const unparseableGap: PrdValidationGap = {
    requirement: 'PRD validator output unparseable',
    explanation: 'Agent output did not contain a parsable JSON gap-analysis block.',
  };

  if (text.trim() === '') {
    return { gaps: [], completionPercent: undefined, acceptanceVerdicts: undefined, acceptanceConflicts: undefined };
  }

  const jsonText = findJsonObjectText(text);
  if (!jsonText) {
    return { gaps: [unparseableGap], completionPercent: undefined, acceptanceVerdicts: undefined, acceptanceConflicts: undefined };
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const completionPercent = typeof parsed.completionPercent === 'number' ? parsed.completionPercent : undefined;
    const gaps = parseValidationGaps(parsed.gaps, unparseableGap);
    const acceptanceVerdicts = parseAcceptanceVerdicts(parsed.acceptanceVerdicts);
    const acceptanceConflicts = parseAcceptanceConflicts(parsed.acceptanceConflicts);

    return { gaps, completionPercent, acceptanceVerdicts, acceptanceConflicts };
  } catch {
    return { gaps: [unparseableGap], completionPercent: undefined, acceptanceVerdicts: undefined, acceptanceConflicts: undefined };
  }
}

function parseValidationGaps(rawGaps: unknown, unparseableGap: PrdValidationGap): PrdValidationGap[] {
  if (!Array.isArray(rawGaps)) return [unparseableGap];

  // Map instead of filter: malformed entries produce a synthetic failure gap rather than
  // being silently dropped. Dropping malformed entries would hide validator bugs and
  // allow a corrupted gap list to appear as "no gaps" (fail-open).
  return rawGaps.map((g: unknown): PrdValidationGap => {
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
}

function parseAcceptanceVerdicts(rawVerdicts: unknown): AcceptanceCriterionVerdict[] | undefined {
  if (!Array.isArray(rawVerdicts) || rawVerdicts.length === 0) return undefined;
  const parsedVerdicts = rawVerdicts.map((v: unknown): AcceptanceCriterionVerdict => {
    if (typeof v !== 'object' || v === null) {
      return { criterion: 'Unknown criterion', verdict: 'unknown', evidence: 'Malformed acceptance verdict entry.' };
    }

    const verdictEntry = v as Record<string, unknown>;
    const rawCriterion = verdictEntry.criterion;
    const hasCriterion = typeof rawCriterion === 'string' && rawCriterion.trim() !== '';
    const criterion = hasCriterion ? rawCriterion.trim() : 'Unknown criterion';
    const rawEvidence = typeof verdictEntry.evidence === 'string' ? verdictEntry.evidence.trim() : '';

    if (!hasCriterion) {
      return { criterion, verdict: 'unknown', evidence: 'No criterion provided for this acceptance verdict.' };
    }
    if (rawEvidence === '') {
      return { criterion, verdict: 'unknown', evidence: 'No evidence provided for this criterion.' };
    }

    const rawVerdict = verdictEntry.verdict;
    const verdict = rawVerdict === 'pass' || rawVerdict === 'fail' || rawVerdict === 'unknown'
      ? rawVerdict
      : 'unknown';
    return { criterion, verdict, evidence: rawEvidence };
  });
  return parsedVerdicts.length > 0 ? parsedVerdicts : undefined;
}

function parseAcceptanceConflicts(rawConflicts: unknown): AcceptanceCriteriaConflict[] | undefined {
  if (!Array.isArray(rawConflicts) || rawConflicts.length === 0) return undefined;
  const conflicts = rawConflicts
    .map(parseAcceptanceConflict)
    .filter((conflict): conflict is AcceptanceCriteriaConflict => conflict !== undefined);
  return conflicts.length > 0 ? conflicts : undefined;
}

function parseAcceptanceConflict(rawConflict: unknown): AcceptanceCriteriaConflict | undefined {
  if (typeof rawConflict !== 'object' || rawConflict === null) return undefined;
  const entry = rawConflict as Record<string, unknown>;
  const criterion = typeof entry.criterion === 'string' ? entry.criterion.trim() : '';
  const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
  const conflictsWith = typeof entry.conflictsWith === 'string' ? entry.conflictsWith.trim() : '';
  const scope = typeof entry.scope === 'string' && VALID_CONFLICT_SCOPES.has(entry.scope)
    ? entry.scope as AcceptanceCriteriaConflict['scope']
    : 'unknown';
  const recommendedAction = typeof entry.recommendedAction === 'string' && VALID_CONFLICT_ACTIONS.has(entry.recommendedAction)
    ? entry.recommendedAction as AcceptanceCriteriaConflict['recommendedAction']
    : 'manual_review';

  if (!criterion || !evidence || !conflictsWith) return undefined;
  return { criterion, evidence, conflictsWith, scope, recommendedAction };
}

function findJsonObjectText(text: string): string | undefined {
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  for (const block of fencedBlocks) {
    const objectText = findBalancedObject(block);
    if (objectText) return objectText;
  }
  return findBalancedObject(text);
}

function findBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return undefined;
}
