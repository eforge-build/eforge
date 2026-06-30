import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { findJsonObjectText } from '../validation/json-object-extractor.js';
import { utf8ByteLength } from './source-analysis.js';
import type { PlanningAtomModuleCandidate, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import type { PlanningReduceConflict, PlanningReduceGap, PlanningReduceOutput, PlanningReduceOutputStatus, PlanningReduceTask } from './reduce-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';

export interface RunPlanningReducerInput { task: PlanningReduceTask; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; abortSignal?: AbortSignal; onEvent?: PlannerCompilerEventSink }
export interface PlanningReducerResult { output: PlanningReduceOutput; events: EforgeEvent[]; resultText: string; prompt: string }

export async function runPlanningReducer(input: RunPlanningReducerInput): Promise<PlanningReducerResult> {
  const prompt = formatPlanningReducerPrompt(input.task);
  if (utf8ByteLength(prompt) > input.task.budget.maxReducePromptBytes) throw new Error(`reduce prompt budget exceeded:${input.task.node.nodeId}`);
  const events: EforgeEvent[] = [];
  let streamedText = '';
  let resultText = '';
  for await (const event of input.harness.run({
    ...pickSdkOptions(input.agentOptions ?? {}),
    prompt,
    cwd: input.cwd,
    maxTurns: input.agentOptions?.maxTurns ?? 4,
    tools: 'none',
    abortSignal: input.abortSignal,
    phase: 'compile',
    stage: 'planner',
  }, 'planner', input.task.node.nodeId)) {
    input.onEvent?.(event);
    events.push(event);
    if (event.type === 'agent:message') streamedText += event.content;
    if (event.type === 'agent:result' && event.result.resultText !== undefined) resultText = event.result.resultText;
  }
  const candidate = resultText.trim() ? resultText : streamedText;
  return { output: parsePlanningReduceOutput(candidate, input.task.node.nodeId), events, resultText: candidate, prompt };
}

export function formatPlanningReducerPrompt(task: PlanningReduceTask): string {
  return `You are a bounded reducer for eforge's planner compiler.

Synthesize only the reduce node below. Do not inspect the repository or call tools. Deduplicate fragments and modules, reconcile conflicts, preserve criterion/aspect traceability, and return exactly one JSON object. Do not wrap it in commentary.

## Reduce task

${JSON.stringify({ graphId: task.graphId, node: task.node, budget: task.budget }, null, 2)}

## Atom outputs

${JSON.stringify(task.atomOutputs.map(summarizeAtomOutput), null, 2)}

## Child reduce outputs

${JSON.stringify(task.childOutputs.map(summarizeReduceOutput), null, 2)}

## Required JSON shape

{
  "nodeId": "${task.node.nodeId}",
  "status": "completed | failed | incomplete",
  "compactSummary": "bounded synthesis summary",
  "planFragments": [
    { "fragmentId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "markdown": "bounded plan fragment" }
  ],
  "moduleCandidates": [
    { "moduleId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "description": "bounded module work", "validationExpectation": "how to validate" }
  ],
  "conflicts": [
    { "conflictId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "description": "conflict to resolve" }
  ],
  "gaps": [
    { "gapId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "description": "gap to represent", "representationRequired": true }
  ],
  "validationStrategy": "how the reduced work should be validated"
}

Rules:
- Link every fragment, module, conflict, and gap to provided criterionIds and aspectIds.
- Completed outputs must not contain representationRequired gaps.
- Failed outputs must not include fragments or module candidates.
- Keep compactSummary within ${task.budget.maxReduceSummaryBytes} bytes.
`;
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

function summarizeAtomOutput(output: unknown): unknown { return output; }
function summarizeReduceOutput(output: unknown): unknown { return output; }

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
