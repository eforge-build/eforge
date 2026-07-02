import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions, type CustomTool } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { composeAbortSignal, isAbortError } from './abort-utils.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import {
  explorationHintsFromSubmission,
  REPOSITORY_EXPLORATION_HINT_KINDS,
  RepositoryExplorationSubmissionSchema,
  type RepositoryExplorationSubmission,
} from './exploration-contracts.js';
import type { SourceLocalizationBundle, SourceLocalizationDiagnostic, SourceLocalizationInputHints, SourceLocalizationRecord } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';

export const REPOSITORY_EXPLORATION_PLAN_ID = 'repository-exploration';
const SUBMIT_EXPLORATION_HINTS_TOOL = 'submit_exploration_hints';
const MAX_PROMPT_NEEDS = 50;
const MAX_PROMPT_CRITERION_TEXT = 300;
const DEFAULT_EXPLORATION_MAX_TURNS = 12;

export interface RunRepositoryExplorationAgentInput {
  cwd: string;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  inventory: SourceInventory;
  baselineBundle: SourceLocalizationBundle;
  maxToolUses: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export interface RepositoryExplorationAgentResult {
  status: 'completed' | 'degraded';
  hints?: SourceLocalizationInputHints;
  diagnostics: SourceLocalizationDiagnostic[];
  toolUses: number;
  events: EforgeEvent[];
}

/**
 * Bounded read-only repository exploration. The only compiler-path agent
 * with repository access: it inspects the repo to localize vague source
 * needs and emits structured hints for deterministic localization. All
 * failure modes except an external abort degrade to a no-hints result -
 * exploration must never fail the compile.
 */
export async function runRepositoryExplorationAgent(input: RunRepositoryExplorationAgentInput): Promise<RepositoryExplorationAgentResult> {
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_EXPLORATION_HINTS_TOOL);
  const prompt = formatRepositoryExplorationPrompt(input.inventory, input.baselineBundle, input.maxToolUses, submitToolName);
  const events: EforgeEvent[] = [];
  const budgetController = new AbortController();
  let submission: RepositoryExplorationSubmission | undefined;
  let toolUses = 0;
  let degradedReason: string | undefined;

  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt,
      cwd: input.cwd,
      maxTurns: input.agentOptions?.maxTurns ?? DEFAULT_EXPLORATION_MAX_TURNS,
      tools: 'read-only',
      customTools: [createExplorationSubmissionTool(submitToolName, (value) => {
        if (submission) return false;
        submission = value;
        return true;
      })],
      abortSignal: composeAbortSignal(input.abortSignal, budgetController.signal),
      phase: 'compile',
      stage: 'planner',
    }, 'planner', REPOSITORY_EXPLORATION_PLAN_ID)) {
      input.onEvent?.(event);
      events.push(event);
      if (event.type === 'agent:tool_use' && event.tool !== submitToolName && event.tool !== SUBMIT_EXPLORATION_HINTS_TOOL) {
        toolUses += 1;
        if (toolUses > input.maxToolUses && !budgetController.signal.aborted) budgetController.abort();
      }
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    if (!budgetController.signal.aborted || !isAbortError(err)) degradedReason = err instanceof Error ? err.message : String(err);
  }

  if (!submission) {
    return degradedResult(events, toolUses, degradedReason ?? (budgetController.signal.aborted ? `exploration tool budget exhausted after ${input.maxToolUses} tool uses without a submission` : `exploration agent did not call ${submitToolName}`));
  }
  const { hints, diagnostics } = explorationHintsFromSubmission(submission);
  if (!hints) return { status: 'degraded', diagnostics, toolUses, events };
  return { status: 'completed', hints, diagnostics, toolUses, events };
}

function degradedResult(events: EforgeEvent[], toolUses: number, reason: string): RepositoryExplorationAgentResult {
  return { status: 'degraded', diagnostics: [{ code: 'exploration-degraded', message: reason, severity: 'warning' }], toolUses, events };
}

function createExplorationSubmissionTool(submitToolName: string, onSubmit: (submission: RepositoryExplorationSubmission) => boolean): CustomTool {
  return {
    name: SUBMIT_EXPLORATION_HINTS_TOOL,
    description: 'Submit structured repository localization hints. This is the only way to complete a repository-exploration turn.',
    inputSchema: RepositoryExplorationSubmissionSchema,
    handler: async (value: unknown) => {
      const parsed = safeParseWithSchema(RepositoryExplorationSubmissionSchema, value);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      if (!onSubmit(parsed.data as RepositoryExplorationSubmission)) return `Error: ${submitToolName} was already called. Only one hint submission is allowed.`;
      return 'Exploration hints submitted successfully.';
    },
  };
}

export function formatRepositoryExplorationPrompt(inventory: SourceInventory, baselineBundle: SourceLocalizationBundle, maxToolUses: number, submitToolName = SUBMIT_EXPLORATION_HINTS_TOOL): string {
  return `You are a bounded repository exploration agent for eforge's planner compiler.

Locate the repository files, directories, and interfaces that ground the source needs below, then complete this turn by calling ${submitToolName} exactly once with structured localization hints. Do not return JSON in text, do not modify anything, and do not plan the work itself - downstream tool-less planners consume your hints.

You may use the available repository inspection tools at most ${maxToolUses} times; prioritize the unresolved needs below.

## Source inventory summary

${JSON.stringify({
    criterionCount: inventory.summary.criterionCount,
    subsystemHints: inventory.summary.subsystemHints,
    interfaceKeys: inventory.summary.interfaceKeys,
    criteria: inventory.criteria.map((criterion) => ({
      id: criterion.id,
      text: truncate(criterion.text, MAX_PROMPT_CRITERION_TEXT),
      subsystemHints: criterion.subsystemHints,
      interfaceKeys: criterion.interfaceKeys,
      evidencePaths: criterion.evidencePaths,
    })),
  }, null, 2)}

## Unresolved and low-confidence source needs

${formatNeedsForPrompt(baselineBundle)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema: { "projectHints": [...], "notes"?: "..." }.

- Each hint: { "kind", "query", "paths"?, "keywords"?, "subsystemHints"?, "interfaceKeys"?, "criterionIds"?, "aspectIds"? }.
- kind must be one of: ${REPOSITORY_EXPLORATION_HINT_KINDS.join(', ')}.
- Key every hint to the criterion ids (and aspect ids when listed) it grounds; unkeyed hints localize poorly.
- paths must be repository-relative (no leading "/", no ".." segments) and must name files or directories you actually confirmed exist.
- Prefer a few high-confidence hints with concrete paths over many speculative ones.
- If you find nothing useful for a need, omit it rather than guessing.
`;
}

function formatNeedsForPrompt(bundle: SourceLocalizationBundle): string {
  const needsAttention = bundle.records.filter((record) => record.status !== 'resolved' || record.confidence !== 'high');
  const shown = needsAttention.slice(0, MAX_PROMPT_NEEDS);
  if (shown.length === 0) return 'All derived source needs already resolved with high confidence; submit hints only if you find stronger owners.';
  const lines = shown.map((record) => JSON.stringify(promptNeed(record)));
  const omitted = needsAttention.length - shown.length;
  return [...lines, ...(omitted > 0 ? [`(${omitted} additional needs omitted for brevity)`] : [])].join('\n');
}

function promptNeed(record: SourceLocalizationRecord): Record<string, unknown> {
  return {
    needId: record.needId,
    kind: record.kind,
    query: truncate(record.query, MAX_PROMPT_CRITERION_TEXT),
    status: record.status,
    confidence: record.confidence,
    criterionIds: record.linkedCriterionIds,
    aspectIds: record.linkedAspectIds,
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
