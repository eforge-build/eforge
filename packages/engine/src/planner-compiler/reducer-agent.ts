import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { findJsonObjectText } from '../validation/json-object-extractor.js';
import { utf8ByteLength } from './source-analysis.js';
import type { PlanningAtomModuleCandidate, PlanningAtomOutput, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import { PlanningReduceOutputSchema, type PlanningReduceConflict, type PlanningReduceGap, type PlanningReduceOutput, type PlanningReduceOutputStatus, type PlanningReduceTask } from './reduce-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { emitPlannerCompilerCheckpointWarning, emitPlannerCompilerRetry, PLANNER_COMPILER_AGENT_MAX_ATTEMPTS, retryablePlannerCompilerSubtype } from './agent-retry.js';

export interface RunPlanningReducerInput { task: PlanningReduceTask; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; abortSignal?: AbortSignal; onEvent?: PlannerCompilerEventSink }
export interface PlanningReducerResult { output: PlanningReduceOutput; events: EforgeEvent[]; resultText: string; prompt: string }
const SUBMIT_REDUCE_OUTPUT_TOOL = 'submit_reduce_output';

export async function runPlanningReducer(input: RunPlanningReducerInput): Promise<PlanningReducerResult> {
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_REDUCE_OUTPUT_TOOL);
  const prompt = formatPlanningReducerPrompt(input.task, submitToolName);
  if (utf8ByteLength(prompt) > input.task.budget.maxReducePromptBytes) throw new Error(`reduce prompt budget exceeded:${input.task.node.nodeId}`);
  const events: EforgeEvent[] = [];
  let candidate = '';

  for (let attempt = 1; attempt <= PLANNER_COMPILER_AGENT_MAX_ATTEMPTS; attempt += 1) {
    const attemptEvents: EforgeEvent[] = [];
    let submittedOutput: PlanningReduceOutput | undefined;
    let streamedText = '';
    let resultText = '';
    try {
      for await (const event of input.harness.run({
        ...pickSdkOptions(input.agentOptions ?? {}),
        prompt,
        cwd: input.cwd,
        maxTurns: input.agentOptions?.maxTurns ?? 4,
        tools: 'none',
        customTools: [createReduceOutputSubmissionTool(submitToolName, (output) => {
          if (submittedOutput) return false;
          submittedOutput = output;
          return true;
        })],
        abortSignal: input.abortSignal,
        phase: 'compile',
        stage: 'planner',
      }, 'planner', input.task.node.nodeId)) {
        input.onEvent?.(event);
        events.push(event);
        attemptEvents.push(event);
        if (event.type === 'agent:message') streamedText += event.content;
        if (event.type === 'agent:result' && event.result.resultText !== undefined) resultText = event.result.resultText;
      }
      candidate = resultText.trim() ? resultText : streamedText;
      if (!submittedOutput) throw new Error(`Reducer did not call ${submitToolName}`);
      return { output: submittedOutput, events, resultText: candidate, prompt };
    } catch (err) {
      candidate = resultText.trim() ? resultText : streamedText;
      const subtype = retryablePlannerCompilerSubtype(err);
      if (submittedOutput && subtype) {
        emitPlannerCompilerCheckpointWarning({ events, onEvent: input.onEvent, attemptEvents, subtype, label: 'reducer-infrastructure', planId: input.task.node.nodeId, err });
        return { output: submittedOutput, events, resultText: candidate, prompt };
      }
      if (!subtype || attempt >= PLANNER_COMPILER_AGENT_MAX_ATTEMPTS) throw err;
      emitPlannerCompilerRetry({ events, onEvent: input.onEvent, attempt, subtype, label: 'reducer-infrastructure-retry', planId: input.task.node.nodeId });
    }
  }

  throw new Error(`Reducer did not call ${submitToolName}`);
}

export function formatPlanningReducerPrompt(task: PlanningReduceTask, submitToolName = SUBMIT_REDUCE_OUTPUT_TOOL): string {
  return `You are a bounded reducer for eforge's planner compiler.

Synthesize only the reduce node below. Do not inspect the repository or call repository tools. Deduplicate fragments and modules, reconcile conflicts, preserve criterion/aspect traceability, and complete this turn by calling ${submitToolName} exactly once. Do not return JSON in text.

## Reduce task

${JSON.stringify({ graphId: task.graphId, node: task.node, budget: task.budget }, null, 2)}

## Atom outputs

${JSON.stringify(task.atomOutputs.map(summarizeAtomOutput), null, 2)}

## Child reduce outputs

${JSON.stringify(task.childOutputs.map(summarizeReduceOutput), null, 2)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema.

- nodeId must be exactly "${task.node.nodeId}".
- Link every fragment, module, conflict, and gap to provided criterionIds and aspectIds.
- Completed outputs must not contain representationRequired gaps.
- Failed outputs must not include fragments or module candidates.
- Keep compactSummary within ${task.budget.maxReduceSummaryBytes} bytes.
`;
}

function createReduceOutputSubmissionTool(submitToolName: string, onSubmit: (output: PlanningReduceOutput) => boolean): CustomTool {
  return {
    name: SUBMIT_REDUCE_OUTPUT_TOOL,
    description: 'Submit the structured bounded reduce output. This is the only way to complete a reduce turn.',
    inputSchema: PlanningReduceOutputSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseWithSchema(PlanningReduceOutputSchema, input);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      if (!onSubmit(parsed.data as PlanningReduceOutput)) return `Error: ${submitToolName} was already called. Only one reduce output submission is allowed.`;
      return 'Reduce output submitted successfully.';
    },
  };
}

export function parsePlanningReduceOutput(text: string, expectedNodeId: string): PlanningReduceOutput {
  const jsonText = findJsonObjectText(text);
  if (!jsonText) throw new Error('Reducer output did not contain a JSON object');
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return coercePlanningReduceOutput(parsed, expectedNodeId);
}

function coercePlanningReduceOutput(value: Record<string, unknown>, expectedNodeId: string): PlanningReduceOutput {
  const nodeId = stringValue(value.nodeId) ?? expectedNodeId;
  const status = reduceStatus(value.status);
  if (!status) throw new Error(`Reducer output has invalid status:${String(value.status)}`);
  return {
    nodeId,
    status,
    compactSummary: stringValue(value.compactSummary) ?? '',
    ...(arrayValue(value.planFragments).length > 0 ? { planFragments: arrayValue(value.planFragments).map(coercePlanFragment) } : {}),
    ...(arrayValue(value.moduleCandidates).length > 0 ? { moduleCandidates: arrayValue(value.moduleCandidates).map(coerceModuleCandidate) } : {}),
    ...(arrayValue(value.conflicts).length > 0 ? { conflicts: arrayValue(value.conflicts).map(coerceConflict) } : {}),
    ...(arrayValue(value.gaps).length > 0 ? { gaps: arrayValue(value.gaps).map(coerceGap) } : {}),
    ...(stringValue(value.validationStrategy) !== undefined ? { validationStrategy: stringValue(value.validationStrategy) } : {}),
    ...(stringValue(value.error) !== undefined ? { error: stringValue(value.error) } : {}),
  };
}

function summarizeAtomOutput(output: PlanningAtomOutput): unknown {
  return {
    atomId: output.atomId,
    status: output.status,
    aspectIds: output.aspectUpdates.map((update) => update.aspectId).sort(),
    planFragments: (output.planFragments ?? []).slice(0, 8).map((fragment) => ({ ...fragment, markdown: boundText(fragment.markdown, 900) })),
    moduleCandidates: (output.moduleCandidates ?? []).slice(0, 8).map((module) => ({ ...module, description: boundText(module.description, 900), validationExpectation: boundText(module.validationExpectation, 500) })),
    compactHandoff: output.compactHandoff ? boundText(output.compactHandoff, 900) : undefined,
    error: output.error ? boundText(output.error, 500) : undefined,
  };
}
function summarizeReduceOutput(output: PlanningReduceOutput): unknown {
  return {
    nodeId: output.nodeId,
    status: output.status,
    compactSummary: boundText(output.compactSummary, 1_200),
    planFragments: (output.planFragments ?? []).slice(0, 8).map((fragment) => ({ ...fragment, markdown: boundText(fragment.markdown, 900) })),
    moduleCandidates: (output.moduleCandidates ?? []).slice(0, 8).map((module) => ({ ...module, description: boundText(module.description, 900), validationExpectation: boundText(module.validationExpectation, 500) })),
    conflicts: (output.conflicts ?? []).slice(0, 8).map((conflict) => ({ ...conflict, description: boundText(conflict.description, 700) })),
    gaps: (output.gaps ?? []).slice(0, 8).map((gap) => ({ ...gap, description: boundText(gap.description, 700) })),
    validationStrategy: output.validationStrategy ? boundText(output.validationStrategy, 700) : undefined,
    error: output.error ? boundText(output.error, 500) : undefined,
  };
}

function coercePlanFragment(value: unknown): PlanningAtomPlanFragment {
  const record = objectValue(value);
  return { fragmentId: requiredString(record.fragmentId, 'plan fragment id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), markdown: requiredString(record.markdown, 'plan fragment markdown'), ...(stringArrayValue(record.dependsOnFragmentIds).length > 0 ? { dependsOnFragmentIds: stringArrayValue(record.dependsOnFragmentIds) } : {}) };
}

function coerceModuleCandidate(value: unknown): PlanningAtomModuleCandidate {
  const record = objectValue(value);
  return { moduleId: requiredString(record.moduleId, 'module candidate id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), description: requiredString(record.description, 'module candidate description'), validationExpectation: requiredString(record.validationExpectation, 'module candidate validation expectation'), ...(stringArrayValue(record.dependsOnModuleIds).length > 0 ? { dependsOnModuleIds: stringArrayValue(record.dependsOnModuleIds) } : {}) };
}

function coerceConflict(value: unknown): PlanningReduceConflict {
  const record = objectValue(value);
  return { conflictId: requiredString(record.conflictId, 'conflict id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), description: requiredString(record.description, 'conflict description'), ...(stringArrayValue(record.sourceIds).length > 0 ? { sourceIds: stringArrayValue(record.sourceIds) } : {}) };
}

function coerceGap(value: unknown): PlanningReduceGap {
  const record = objectValue(value);
  return { gapId: requiredString(record.gapId, 'gap id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), description: requiredString(record.description, 'gap description'), representationRequired: record.representationRequired === true, ...(stringArrayValue(record.sourceIds).length > 0 ? { sourceIds: stringArrayValue(record.sourceIds) } : {}) };
}

function boundText(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let result = '';
  for (const char of value) {
    if (utf8ByteLength(`${result}${char}…`) > maxBytes) break;
    result += char;
  }
  return `${result}…`;
}

function reduceStatus(value: unknown): PlanningReduceOutputStatus | undefined {
  return value === 'completed' || value === 'failed' || value === 'incomplete' ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error('Reducer output contains invalid object');
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function stringArrayValue(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function requiredString(value: unknown, label: string): string {
  const text = stringValue(value);
  if (text === undefined) throw new Error(`Reducer output missing ${label}`);
  return text;
}
