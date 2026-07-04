import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions, type CustomTool } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { composeAbortSignal, isAbortError } from './abort-utils.js';
import { derivePlanningCriterionAspects } from './coverage-accounting.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import {
  explorationHintsFromSubmission,
  REPOSITORY_EXPLORATION_HINT_KINDS,
  RepositoryExplorationOutcomeSchema,
  synthesizeBudgetExhaustedExplorationOutcome,
  type RepositoryExplorationOutcome,
} from './exploration-contracts.js';
import type { SourceLocalizationBundle, SourceLocalizationDiagnostic, SourceLocalizationInputHints, SourceLocalizationRecord } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';
import type { PlanningAtomGraph } from './atom-graph.js';

export const REPOSITORY_EXPLORATION_PLAN_ID = 'repository-exploration';
const SUBMIT_EXPLORATION_OUTCOME_TOOL = 'submit_exploration_outcome';
const MAX_PROMPT_NEEDS = 50;
const MAX_PROMPT_CRITERION_TEXT = 300;
export const DEFAULT_EXPLORATION_MAX_TURNS = 12;

export interface RunRepositoryExplorationAgentInput {
  cwd: string;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  inventory: SourceInventory;
  baselineBundle: SourceLocalizationBundle;
  graph?: PlanningAtomGraph;
  maxToolUses: number;
  /** Restrict the prompt's unresolved-needs list to these need ids for per-scope rescope reruns. */
  scopeNeedIds?: string[];
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export interface RepositoryExplorationAgentResult {
  status: 'completed' | 'degraded';
  outcome: RepositoryExplorationOutcome;
  hints?: SourceLocalizationInputHints;
  diagnostics: SourceLocalizationDiagnostic[];
  unknownIdDrops: Array<{ field: string; id: string; index?: number }>;
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
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_EXPLORATION_OUTCOME_TOOL);
  const maxTurns = input.agentOptions?.maxTurns ?? DEFAULT_EXPLORATION_MAX_TURNS;
  const prompt = formatRepositoryExplorationPrompt(input.inventory, input.baselineBundle, input.maxToolUses, submitToolName, input.scopeNeedIds);
  const events: EforgeEvent[] = [];
  let submission: RepositoryExplorationOutcome | undefined;
  let toolUses = 0;
  let degradedReason: string | undefined;
  const onSubmit = (value: RepositoryExplorationOutcome): boolean => {
    if (submission) return false;
    submission = value;
    return true;
  };

  const firstPass = new AbortController();
  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt,
      cwd: input.cwd,
      maxTurns,
      tools: 'read-only',
      customTools: [createExplorationSubmissionTool(submitToolName, onSubmit)],
      abortSignal: composeAbortSignal(input.abortSignal, firstPass.signal),
      phase: 'compile',
      stage: 'planner',
    }, 'planner', REPOSITORY_EXPLORATION_PLAN_ID)) {
      input.onEvent?.(event);
      events.push(event);
      if (event.type === 'agent:tool_use' && !isSubmitTool(event.tool, submitToolName)) {
        toolUses += 1;
        if (toolUses >= input.maxToolUses && !firstPass.signal.aborted && !submission) firstPass.abort();
      }
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    if (!firstPass.signal.aborted || !isAbortError(err)) degradedReason = err instanceof Error ? err.message : String(err);
  }

  if (!submission && firstPass.signal.aborted && !degradedReason) {
    degradedReason = await runExplorationSubmitGrace(input, submitToolName, onSubmit, events, toolUses, maxTurns);
  }
  if (!submission) return outcomeResult(input, synthesizeBudgetExhaustedExplorationOutcome(input.baselineBundle, toolUses), events, toolUses, degradedReason);
  return outcomeResult(input, submission, events, toolUses);
}

async function runExplorationSubmitGrace(input: RunRepositoryExplorationAgentInput, submitToolName: string, onSubmit: (submission: RepositoryExplorationOutcome) => boolean, events: EforgeEvent[], toolUses: number, maxTurns: number): Promise<string | undefined> {
  const gracePrompt = `${formatRepositoryExplorationPrompt(input.inventory, input.baselineBundle, input.maxToolUses, submitToolName, input.scopeNeedIds)}\n\nTool budget is exhausted after ${toolUses} read-only tool uses. Do not call repository tools. You are now in submit-only grace mode: call ${submitToolName} with status \"budget-exhausted\", unresolvedNeedIds, reasons including \"tool-budget\", attempted query context if known, empty rescopeHints if none, and toolUseCount ${toolUses}.`;
  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt: gracePrompt,
      cwd: input.cwd,
      maxTurns: Math.max(1, Math.min(2, maxTurns)),
      tools: 'none',
      customTools: [createExplorationSubmissionTool(submitToolName, onSubmit)],
      abortSignal: input.abortSignal,
      phase: 'compile',
      stage: 'planner',
    }, 'planner', REPOSITORY_EXPLORATION_PLAN_ID)) {
      input.onEvent?.(event);
      events.push(event);
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

function outcomeResult(input: RunRepositoryExplorationAgentInput, submission: RepositoryExplorationOutcome, events: EforgeEvent[], toolUses: number, degradedReason?: string): RepositoryExplorationAgentResult {
  const { outcome, hints, diagnostics, unknownIdDrops } = explorationHintsFromSubmission(submission, {
    allowedNeedIds: input.baselineBundle.records.map((record) => record.needId),
    allowedCriterionIds: input.inventory.criteria.map((criterion) => criterion.id),
    allowedAspectIds: allowedAspectIds(input),
  });
  const allDiagnostics = degradedReason ? [{ code: 'exploration-degraded', message: degradedReason, severity: 'warning' as const }, ...diagnostics] : diagnostics;
  return { status: hints || outcome.status !== 'completed' ? 'completed' : 'degraded', outcome: { ...outcome, toolUseCount: toolUses }, hints, diagnostics: allDiagnostics, unknownIdDrops, toolUses, events };
}

function allowedAspectIds(input: RunRepositoryExplorationAgentInput): string[] {
  if (input.graph) return derivePlanningCriterionAspects(input.graph, input.inventory).map((aspect) => aspect.aspectId);
  return [...new Set(input.baselineBundle.records.flatMap((record) => record.linkedAspectIds))];
}

function createExplorationSubmissionTool(submitToolName: string, onSubmit: (submission: RepositoryExplorationOutcome) => boolean): CustomTool {
  return {
    name: SUBMIT_EXPLORATION_OUTCOME_TOOL,
    description: 'Submit the structured repository exploration outcome. This is the only way to complete a repository-exploration turn.',
    inputSchema: RepositoryExplorationOutcomeSchema,
    handler: async (value: unknown) => {
      const parsed = safeParseWithSchema(RepositoryExplorationOutcomeSchema, value);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      if (!onSubmit(parsed.data as RepositoryExplorationOutcome)) return `Error: ${submitToolName} was already called. Only one exploration outcome is allowed.`;
      return 'Exploration outcome submitted successfully.';
    },
  };
}

function isSubmitTool(tool: string, submitToolName: string): boolean {
  return tool === submitToolName || tool === SUBMIT_EXPLORATION_OUTCOME_TOOL;
}

export function formatRepositoryExplorationPrompt(inventory: SourceInventory, baselineBundle: SourceLocalizationBundle, maxToolUses: number, submitToolName = SUBMIT_EXPLORATION_OUTCOME_TOOL, scopeNeedIds?: string[]): string {
  return `You are a bounded repository exploration agent for eforge's planner compiler.

Locate the repository files, directories, and interfaces that ground the source needs below, then complete this turn by calling ${submitToolName} exactly once with a structured exploration outcome. Do not return JSON in text, do not modify anything, and do not plan the work itself - downstream tool-less planners consume your outcome.

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

${formatNeedsForPrompt(baselineBundle, scopeNeedIds)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema: { "status": "completed" | "needs-rescope" | "budget-exhausted" | "ambiguous", "projectHints"?: [...], "unresolvedNeedIds"?: [...], "reasons"?: [...], "attemptedQueries"?: [...], "candidatePaths"?: [...], "rescopeHints"?: [], "notes"?: "...", "toolUseCount"?: number }.

- Use status "completed" when you found useful concrete hints, "needs-rescope" when the source is too broad, "ambiguous" when multiple incompatible owners remain plausible, and "budget-exhausted" when tool budget prevents resolution.
- Each hint: { "needId"?, "kind", "query", "paths"?, "keywords"?, "subsystemHints"?, "interfaceKeys"?, "criterionIds"?, "aspectIds"? }.
- kind must be one of: ${REPOSITORY_EXPLORATION_HINT_KINDS.join(', ')}.
- Key every hint to the criterion ids (and aspect ids when listed) it grounds; unkeyed hints localize poorly.
- paths must be repository-relative (no leading "/", no ".." segments) and must name files or directories you actually confirmed exist.
- Prefer a few high-confidence hints with concrete paths over many speculative ones.
- If you find nothing useful for a need, omit it rather than guessing.
`;
}

function formatNeedsForPrompt(bundle: SourceLocalizationBundle, scopeNeedIds?: string[]): string {
  const scope = scopeNeedIds ? new Set(scopeNeedIds) : undefined;
  const needsAttention = bundle.records.filter((record) => (record.status !== 'resolved' || record.confidence !== 'high') && (!scope || scope.has(record.needId)));
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
