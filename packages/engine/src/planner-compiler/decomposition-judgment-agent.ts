import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions, type CustomTool } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { isAbortError } from './abort-utils.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import type { PlanningRescopeDirective } from './atom-graph.js';
import {
  DecompositionJudgmentSubmissionSchema,
  directivesFromJudgmentGroups,
  type DecompositionJudgmentSubmission,
} from './decomposition-judgment-contracts.js';
import type { SourceInventory } from './source-inventory.js';

export const DECOMPOSITION_JUDGMENT_PLAN_ID = 'decomposition-judgment';
const SUBMIT_JUDGMENT_TOOL = 'submit_decomposition_judgment';
const MAX_PROMPT_CRITERION_TEXT = 400;
const DEFAULT_JUDGMENT_MAX_TURNS = 4;

export interface RunDecompositionJudgmentInput {
  cwd: string;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  inventory: SourceInventory;
  concreteSubsystemCount: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export type DecompositionJudgmentResult =
  | { verdict: 'cohesive'; rationale: string }
  | { verdict: 'split'; rationale: string; directives: PlanningRescopeDirective[]; source: 'agent' }
  | { verdict: 'split'; rationale: string; directives?: undefined; source: 'invalid-groups'; problems: string[] }
  | { verdict: 'unavailable'; rationale: string };

/**
 * Bounded decomposition judgment for a subsystem-diverse collapsed root: an
 * agent decides whether the criterion set reads as one implementer's coherent
 * unit or as independent workstreams that should be planned separately, and
 * proposes the criterion grouping when splitting. No repository access - the
 * judgment is over the criteria inventory only. Fail-open by construction:
 * any error or missing submission resolves to 'unavailable' and the caller
 * keeps today's collapse behavior.
 */
export async function runDecompositionJudgment(input: RunDecompositionJudgmentInput): Promise<DecompositionJudgmentResult> {
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_JUDGMENT_TOOL);
  const prompt = formatDecompositionJudgmentPrompt(input.inventory, input.concreteSubsystemCount, submitToolName);
  let submission: DecompositionJudgmentSubmission | undefined;
  const onSubmit = (value: DecompositionJudgmentSubmission): boolean => {
    if (submission) return false;
    submission = value;
    return true;
  };
  let failureReason: string | undefined;
  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt,
      cwd: input.cwd,
      maxTurns: input.agentOptions?.maxTurns ?? DEFAULT_JUDGMENT_MAX_TURNS,
      tools: 'none',
      customTools: [createJudgmentSubmissionTool(submitToolName, onSubmit)],
      abortSignal: input.abortSignal,
      phase: 'compile',
      stage: 'planner',
    }, 'planner', DECOMPOSITION_JUDGMENT_PLAN_ID)) {
      input.onEvent?.(event as EforgeEvent);
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    failureReason = err instanceof Error ? err.message : String(err);
  }

  if (!submission) return { verdict: 'unavailable', rationale: failureReason ?? `judgment agent did not call ${submitToolName}` };
  if (submission.decision === 'cohesive') return { verdict: 'cohesive', rationale: submission.rationale };
  const groups = submission.groups ?? [];
  const validation = directivesFromJudgmentGroups(input.inventory, groups);
  if (!validation.ok) return { verdict: 'split', rationale: submission.rationale, source: 'invalid-groups', problems: validation.problems };
  return { verdict: 'split', rationale: submission.rationale, directives: validation.directives, source: 'agent' };
}

function createJudgmentSubmissionTool(submitToolName: string, onSubmit: (submission: DecompositionJudgmentSubmission) => boolean): CustomTool {
  return {
    name: SUBMIT_JUDGMENT_TOOL,
    description: 'Submit the structured decomposition judgment. This is the only way to complete a decomposition-judgment turn.',
    inputSchema: DecompositionJudgmentSubmissionSchema,
    handler: async (value: unknown) => {
      const parsed = safeParseWithSchema(DecompositionJudgmentSubmissionSchema, value);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      if (!onSubmit(parsed.data as DecompositionJudgmentSubmission)) return `Error: ${submitToolName} was already called. Only one judgment is allowed.`;
      return 'Decomposition judgment submitted successfully.';
    },
  };
}

export function formatDecompositionJudgmentPrompt(inventory: SourceInventory, concreteSubsystemCount: number, submitToolName = SUBMIT_JUDGMENT_TOOL): string {
  return `You are a bounded decomposition judge for eforge's planner compiler.

A PRD's acceptance criteria currently compile into a single planning unit owned by one implementer. The criteria span ${concreteSubsystemCount} distinct subsystem signals, so this may be several independent workstreams disguised as one unit. Decide which it is, then complete this turn by calling ${submitToolName} exactly once. Do not return JSON in text.

Judge cohesion, not size:
- Submit "decision": "cohesive" when the criteria describe one coherent change a single implementer should own end to end - shared data flow, one trust boundary, tightly coupled edits where splitting would force constant cross-unit coordination.
- Submit "decision": "split" when the criteria bundle independent workstreams - distinct subsystems, distinct invariants, or distinct test surfaces that separate implementers could build in parallel with only interface-level coordination.
- Validation-only criteria (type checks, test-suite runs, lint gates) belong with the workstream they validate, not in their own group.

When splitting, propose the grouping:
- Every criterion id below must appear in exactly one group.
- Use 2 or more groups; each group should be a unit one implementer can own coherently.
- "groupKey" is a short kebab-case name for the workstream; each group's "rationale" says why it stands alone.

## Acceptance criteria

${JSON.stringify(inventory.criteria.map((criterion) => ({
    id: criterion.id,
    text: truncate(criterion.text, MAX_PROMPT_CRITERION_TEXT),
    subsystemHints: criterion.subsystemHints,
    interfaceKeys: criterion.interfaceKeys,
    evidencePaths: criterion.evidencePaths,
  })), null, 2)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema: { "decision": "cohesive" | "split", "rationale": "...", "groups": [...] }.

- "rationale" is shown to the user as the decomposition explanation - make it a concrete one-or-two-sentence summary.
- Include "groups" only when "decision" is "split": each entry is { "groupKey", "criterionIds", "rationale" }.
`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
