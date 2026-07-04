import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { classifyAgentTerminalSubtype, pickSdkOptions } from '../harness.js';
import { isRetryableInfrastructureSubtype } from '../retry.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { formatSubmissionValidationError } from './common.js';
import { getIntakeSubmissionSchemaYaml, intakeSubmissionSchema, type IntakeSubmission } from '../schemas.js';
import {
  AC_EXTRACTION_MIN_CONFIDENCE,
  AC_INVENTORY_VERSION,
  formatAcceptanceInventoryDiagnostics,
  normalizeGroundingText,
  validateCanonicalAcceptanceCriteriaInventory,
  type AcceptanceInventoryDiagnostic,
  type CanonicalAcceptanceCriteriaInventory,
} from '../validation/acceptance-criteria-inventory.js';

/** Give up after this many invalid submissions instead of burning turns forever. */
export const MAX_INVALID_INTAKE_SUBMISSIONS = 5;

/**
 * Options for the intake agent.
 */
export interface IntakeOptions extends SdkPassthroughConfig {
  /** Harness for running the agent */
  harness: AgentHarness;
  /** Working directory */
  cwd: string;
  /** Raw input: a full PRD, a rough spec, or a bare prompt. */
  sourceContent: string;
  /** Accept a submission with zero acceptance criteria. */
  allowNoAcceptanceCriteria?: boolean;
  /** Whether to emit verbose agent-level events */
  verbose?: boolean;
  /** AbortController for cancellation */
  abortController?: AbortController;
  /** Override max conversation turns (default: planning tier default). */
  maxTurns?: number;
}

/**
 * Result from the intake agent: the formatted PRD body and the canonical
 * acceptance criteria inventory grounded in that body.
 */
export interface IntakeResult {
  /** The formatted PRD markdown body */
  body: string;
  /** Validated inventory with stable ac-### ids assigned */
  inventory: CanonicalAcceptanceCriteriaInventory;
}

/**
 * The intake agent finished without producing a valid structured submission.
 * Fail-closed: enqueue must not proceed on a missing or invalid inventory.
 */
export class IntakeSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeSubmissionError';
  }
}

/**
 * Per-diagnostic retry hints for ungrounded source quotes. Distinguishes
 * "the quote exists in the raw input but not in your formattedBody" from
 * "the quote is not contiguous text anywhere" so the model can self-correct.
 */
function groundingHints(
  diagnostics: readonly AcceptanceInventoryDiagnostic[],
  submission: IntakeSubmission,
  sourceContent: string,
): string[] {
  const normalizedSource = normalizeGroundingText(sourceContent);
  const hints: string[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.kind !== 'ungrounded-source-quote' || !diagnostic.path) continue;
    const match = /^criteria\[(\d+)\]/.exec(diagnostic.path);
    if (!match) continue;
    const index = Number(match[1]);
    const quote = submission.criteria[index]?.sourceQuote;
    if (quote === undefined) continue;
    hints.push(normalizedSource.includes(normalizeGroundingText(quote))
      ? `  - criteria[${index}].sourceQuote appears in the raw input but not in your formattedBody. Carry that text into formattedBody, or re-quote from the formattedBody you are submitting.`
      : `  - criteria[${index}].sourceQuote must be one contiguous verbatim passage from formattedBody. Do not stitch together non-adjacent lines (e.g. a parent list item plus a distant sub-bullet); quote just the sub-bullet instead.`);
  }
  return hints;
}

/**
 * Append retry-or-stop guidance based on the invalid-submission budget and
 * join the message lines. Once the budget is exhausted the model is told that
 * intake will fail unless it produces a fully valid submission; before that,
 * the optional retry instruction is appended (schema errors carry their own
 * retry instruction, so that path passes none).
 */
function withBudgetGuidance(lines: string[], invalidCount: number, retryInstruction?: string): string {
  if (invalidCount >= MAX_INVALID_INTAKE_SUBMISSIONS) {
    lines.push('', `Submission budget exhausted after ${invalidCount} invalid attempts. Intake will fail unless you submit a fully corrected, valid payload.`);
  } else if (retryInstruction !== undefined) {
    lines.push('', retryInstruction);
  }
  return lines.join('\n');
}

/**
 * Create the structured submission tool for intake. The handler validates the
 * payload against the schema and the canonical inventory rules; validation
 * failures are returned as tool output so the model corrects and resubmits.
 * Both schema-parse failures and inventory-validation failures count against
 * the invalid-submission budget and feed the fail-closed diagnostics.
 */
function createIntakeSubmissionTool(deps: {
  sourceContent: string;
  allowNoAcceptanceCriteria?: boolean;
  onSubmit: (result: IntakeResult) => boolean;
  onInvalid: (diagnostics: readonly AcceptanceInventoryDiagnostic[]) => number;
}): CustomTool {
  return {
    name: 'submit_intake',
    description: 'Submit the formatted PRD body together with its extracted canonical acceptance criteria. This is the only way to complete intake.',
    inputSchema: intakeSubmissionSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseWithSchema(intakeSubmissionSchema, input);
      if (!parsed.success) {
        const invalidCount = deps.onInvalid(parsed.error.errors.map((error): AcceptanceInventoryDiagnostic => ({
          kind: 'invalid-schema',
          message: `${error.path ? error.path.replace(/^\//, '').replace(/\//g, '.') : '(root)'}: ${error.message}`,
        })));
        return withBudgetGuidance([formatSubmissionValidationError(parsed.error.errors)], invalidCount);
      }
      const submission = parsed.data;
      const candidate = {
        version: AC_INVENTORY_VERSION,
        criteria: submission.criteria,
        ...(submission.warnings !== undefined ? { warnings: submission.warnings } : {}),
      };
      const result = validateCanonicalAcceptanceCriteriaInventory(candidate, submission.formattedBody, {
        allowNoAcceptanceCriteria: deps.allowNoAcceptanceCriteria,
        requireIds: false,
      });
      if (!result.valid) {
        const invalidCount = deps.onInvalid(result.diagnostics);
        const lines = [formatAcceptanceInventoryDiagnostics(result.diagnostics), ...groundingHints(result.diagnostics, submission, deps.sourceContent)];
        return withBudgetGuidance(lines, invalidCount, 'Fix each issue above and call the submission tool again with the corrected payload. Do NOT output the PRD or JSON as plain text - this tool is the only way to complete intake.');
      }
      if (!deps.onSubmit({ body: submission.formattedBody, inventory: result.inventory })) {
        return 'Error: intake was already submitted. Only one valid submission is allowed.';
      }
      return 'Intake submitted successfully.';
    },
  };
}

/**
 * Run the intake agent: a single planning-tier, toolless (except the
 * submission tool) query that formats raw input into the strict PRD shape and
 * extracts the canonical acceptance criteria inventory in one structured
 * submission. Grounding and quality validation happen inside the submission
 * tool handler, so the model gets actionable feedback and retries instead of
 * failing the enqueue on the first imperfect extraction.
 */
export async function* runIntake(
  options: IntakeOptions,
): AsyncGenerator<EforgeEvent, IntakeResult> {
  let captured: IntakeResult | null = null;
  let invalidCount = 0;
  let lastDiagnostics: readonly AcceptanceInventoryDiagnostic[] = [];

  const submissionTool = createIntakeSubmissionTool({
    sourceContent: options.sourceContent,
    allowNoAcceptanceCriteria: options.allowNoAcceptanceCriteria,
    onSubmit: (result) => {
      if (captured !== null) return false;
      captured = result;
      return true;
    },
    onInvalid: (diagnostics) => {
      lastDiagnostics = diagnostics;
      return ++invalidCount;
    },
  });

  const prompt = await loadPrompt('intake', {
    source: options.sourceContent,
    minConfidence: String(AC_EXTRACTION_MIN_CONFIDENCE),
    submitTool: options.harness.effectiveCustomToolName(submissionTool.name),
    submission_schema: getIntakeSubmissionSchemaYaml(),
  }, options.promptAppend);

  for await (const event of options.harness.run(
    {
      prompt,
      cwd: options.cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
      tools: 'none',
      abortSignal: options.abortController?.signal,
      customTools: [submissionTool],
      ...pickSdkOptions(options),
    },
    'formatter',
  )) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
      yield event;
    }
  }

  if (captured === null) {
    const detail = lastDiagnostics.length > 0
      ? ` Last rejected submission:\n${formatAcceptanceInventoryDiagnostics(lastDiagnostics)}`
      : '';
    throw new IntakeSubmissionError(`Intake agent finished without a valid submission after ${invalidCount} invalid attempt(s).${detail}`);
  }
  return captured;
}

export const INTAKE_AGENT_MAX_ATTEMPTS = 2;

/**
 * Run intake with retry on transient infrastructure failures (backend transport
 * drops such as WebSocket idle timeouts). Intake has no side effects before its
 * structured submission is returned, so rerunning the whole agent turn is safe.
 * Submission-quality failures (IntakeSubmissionError) are not retried here; the
 * submission tool's in-loop feedback already covers those.
 */
export async function* runIntakeWithTransientRetry(
  options: IntakeOptions,
): AsyncGenerator<EforgeEvent, IntakeResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return yield* runIntake(options);
    } catch (err) {
      const subtype = classifyAgentTerminalSubtype(err);
      if (!subtype || !isRetryableInfrastructureSubtype(subtype) || attempt >= INTAKE_AGENT_MAX_ATTEMPTS) throw err;
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:retry',
        agent: 'formatter',
        attempt,
        maxAttempts: INTAKE_AGENT_MAX_ATTEMPTS,
        subtype,
        label: 'intake-infrastructure-retry',
      };
    }
  }
}
