import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { findJsonObjectText } from '../validation/json-object-extractor.js';
import type { PlanningAtomTask, PlanningAtomOutput, PlanningAtomOutputStatus, PlanningAtomPlanFragment, PlanningAtomModuleCandidate } from './atom-planning-contracts.js';
import { formatPlanningAtomSourceMaterialization, materializePlanningAtomSource, type PlanningAtomSourceMaterialization } from './atom-source-materialization.js';
import type { PlanningAspectCoverageUpdate } from './coverage-accounting.js';
import type { PlanningSharedFinding } from './shared-brief-contracts.js';

export interface RunPlanningAtomPlannerInput { task: PlanningAtomTask; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; abortSignal?: AbortSignal; acceptedSharedFindings?: PlanningSharedFinding[] }
export interface PlanningAtomPlannerResult { output: PlanningAtomOutput; events: EforgeEvent[]; resultText: string; materialization: PlanningAtomSourceMaterialization }

export async function runPlanningAtomPlanner(input: RunPlanningAtomPlannerInput): Promise<PlanningAtomPlannerResult> {
  const materialization = materializePlanningAtomSource({ sourceContent: input.sourceContent, task: input.task });
  if (materialization.errors.length > 0) throw new Error(materialization.errors.join('; '));

  const prompt = formatPlanningAtomPrompt(input.task, materialization, input.acceptedSharedFindings ?? []);
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
  }, 'planner', input.task.atomId)) {
    events.push(event);
    if (event.type === 'agent:message') streamedText += event.content;
    if (event.type === 'agent:result' && event.result.resultText !== undefined) resultText = event.result.resultText;
  }

  const candidate = resultText.trim() ? resultText : streamedText;
  return { output: parsePlanningAtomOutput(candidate, input.task.atomId), events, resultText: candidate, materialization };
}

export function formatPlanningAtomPrompt(task: PlanningAtomTask, materialization: PlanningAtomSourceMaterialization, acceptedSharedFindings: PlanningSharedFinding[] = []): string {
  return `You are a bounded atom planner for eforge's planner compiler.

Plan only the atom below. Do not inspect the repository or call tools. Use the provided source excerpts, evidence paths, interface keys, and aspect IDs. Return exactly one JSON object matching the requested shape. Do not wrap it in commentary.

## Atom task

${JSON.stringify({
    graphId: task.graphId,
    atomId: task.atomId,
    title: task.title,
    reason: task.reason,
    criterionIds: task.criterionIds,
    aspectIds: task.aspectIds,
    subsystemHints: task.subsystemHints,
    evidencePaths: task.evidencePaths,
    interfaceKeys: task.interfaceKeys,
    dependencyHints: task.dependencyHints,
    budget: task.budget,
    estimate: task.estimate,
  }, null, 2)}

## Source excerpts

${formatPlanningAtomSourceMaterialization(materialization)}

## Shared planning brief

${formatSharedPlanningBriefForAtom(task, acceptedSharedFindings)}

## Required JSON shape

{
  "atomId": "${task.atomId}",
  "status": "completed | skipped | failed",
  "aspectUpdates": [
    { "aspectId": "one of the provided aspectIds", "status": "resolved", "completedByAtomIds": ["${task.atomId}"] }
  ],
  "planFragments": [
    { "fragmentId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "markdown": "bounded plan fragment" }
  ],
  "moduleCandidates": [
    { "moduleId": "stable-id", "title": "short title", "criterionIds": [], "aspectIds": [], "description": "bounded module work", "validationExpectation": "how to validate" }
  ],
  "sharedFindings": [
    { "findingId": "stable-id", "sourceAtomId": "${task.atomId}", "evidencePath": "owned shared evidence path", "aspectIds": [], "summary": "reusable bounded finding", "byteLength": 123 }
  ],
  "compactHandoff": "optional bounded summary"
}

Rules:
- Every resolved aspect must cite completedByAtomIds containing ${task.atomId}.
- Use aspectUpdates[].status "represented" with representation.kind residue or follow-up when executable follow-up work represents an aspect.
- Use skipped only with a concrete reason.
- Failed outputs must not include aspect updates.
- Emit sharedFindings only for shared evidence this atom owns; consumer atoms should use accepted findings instead of repeating exploration.
`;
}

export function parsePlanningAtomOutput(text: string, expectedAtomId: string): PlanningAtomOutput {
  const jsonText = findJsonObjectText(text);
  if (!jsonText) throw new Error('Atom planner output did not contain a JSON object');
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return coercePlanningAtomOutput(parsed, expectedAtomId);
}

function coercePlanningAtomOutput(value: Record<string, unknown>, expectedAtomId: string): PlanningAtomOutput {
  const atomId = stringValue(value.atomId) ?? expectedAtomId;
  const status = outputStatus(value.status);
  if (!status) throw new Error(`Atom planner output has invalid status:${String(value.status)}`);
  return {
    atomId,
    status,
    aspectUpdates: arrayValue(value.aspectUpdates).map(coerceAspectUpdate),
    ...(arrayValue(value.planFragments).length > 0 ? { planFragments: arrayValue(value.planFragments).map(coercePlanFragment) } : {}),
    ...(arrayValue(value.moduleCandidates).length > 0 ? { moduleCandidates: arrayValue(value.moduleCandidates).map(coerceModuleCandidate) } : {}),
    ...(arrayValue(value.sharedFindings).length > 0 ? { sharedFindings: arrayValue(value.sharedFindings).map(coerceSharedFinding) } : {}),
    ...(stringValue(value.compactHandoff) !== undefined ? { compactHandoff: stringValue(value.compactHandoff) } : {}),
    ...(stringValue(value.error) !== undefined ? { error: stringValue(value.error) } : {}),
  };
}

function coerceAspectUpdate(value: unknown): PlanningAspectCoverageUpdate {
  const record = objectValue(value);
  const aspectId = stringValue(record.aspectId);
  const status = record.status === 'pending' || record.status === 'resolved' || record.status === 'skipped' || record.status === 'represented' ? record.status : undefined;
  if (!aspectId || !status) throw new Error('Atom planner output contains invalid aspect update');
  return {
    aspectId,
    status,
    ...(stringArrayValue(record.completedByAtomIds).length > 0 ? { completedByAtomIds: stringArrayValue(record.completedByAtomIds) } : {}),
    ...(stringValue(record.reason) !== undefined ? { reason: stringValue(record.reason) } : {}),
    ...(objectValueOrUndefined(record.representation) ? { representation: coerceRepresentation(objectValue(record.representation)) } : {}),
  };
}

function coerceRepresentation(record: Record<string, unknown>): PlanningAspectCoverageUpdate['representation'] {
  const kind = record.kind === 'residue' || record.kind === 'follow-up' ? record.kind : undefined;
  const moduleId = stringValue(record.moduleId);
  const reason = stringValue(record.reason);
  const validationExpectation = stringValue(record.validationExpectation);
  if (!kind || moduleId === undefined || reason === undefined || validationExpectation === undefined) throw new Error('Atom planner output contains invalid aspect representation');
  return { kind, moduleId, reason, validationExpectation };
}

function coercePlanFragment(value: unknown): PlanningAtomPlanFragment {
  const record = objectValue(value);
  return { fragmentId: requiredString(record.fragmentId, 'plan fragment id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), markdown: requiredString(record.markdown, 'plan fragment markdown'), ...(stringArrayValue(record.dependsOnFragmentIds).length > 0 ? { dependsOnFragmentIds: stringArrayValue(record.dependsOnFragmentIds) } : {}) };
}

function coerceSharedFinding(value: unknown): PlanningSharedFinding {
  const record = objectValue(value);
  const summary = requiredString(record.summary, 'shared finding summary');
  return {
    findingId: requiredString(record.findingId, 'shared finding id'),
    sourceAtomId: requiredString(record.sourceAtomId, 'shared finding source atom'),
    ...(stringValue(record.evidencePath) !== undefined ? { evidencePath: stringValue(record.evidencePath) } : {}),
    ...(stringValue(record.interfaceKey) !== undefined ? { interfaceKey: stringValue(record.interfaceKey) } : {}),
    aspectIds: stringArrayValue(record.aspectIds),
    summary,
    ...(stringValue(record.validationExpectation) !== undefined ? { validationExpectation: stringValue(record.validationExpectation) } : {}),
    byteLength: numberValue(record.byteLength) ?? new TextEncoder().encode(summary).length,
  };
}

function coerceModuleCandidate(value: unknown): PlanningAtomModuleCandidate {
  const record = objectValue(value);
  return { moduleId: requiredString(record.moduleId, 'module candidate id'), title: stringValue(record.title) ?? '', criterionIds: stringArrayValue(record.criterionIds), aspectIds: stringArrayValue(record.aspectIds), description: requiredString(record.description, 'module candidate description'), validationExpectation: requiredString(record.validationExpectation, 'module candidate validation expectation'), ...(stringArrayValue(record.dependsOnModuleIds).length > 0 ? { dependsOnModuleIds: stringArrayValue(record.dependsOnModuleIds) } : {}) };
}

function outputStatus(value: unknown): PlanningAtomOutputStatus | undefined {
  return value === 'completed' || value === 'skipped' || value === 'failed' ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error('Atom planner output contains invalid object');
}

function formatSharedPlanningBriefForAtom(task: PlanningAtomTask, acceptedSharedFindings: PlanningSharedFinding[]): string {
  if (!task.sharedBrief) return 'No shared planning brief is associated with this atom.';
  const relevantFindings = acceptedSharedFindings.filter((finding) => isRelevantSharedFinding(task, finding));
  return JSON.stringify({
    ownedEvidencePaths: task.sharedBrief.ownedEvidencePaths,
    localEvidencePaths: task.sharedBrief.localEvidencePaths,
    ownedInterfaceKeys: task.sharedBrief.ownedInterfaceKeys,
    sharedEvidenceRefs: task.sharedBrief.sharedEvidenceRefs,
    sharedInterfaceRefs: task.sharedBrief.sharedInterfaceRefs,
    prerequisiteAtomIds: task.sharedBrief.prerequisiteAtomIds,
    sections: task.sharedBrief.sections,
    acceptedSharedFindings: relevantFindings,
  }, null, 2);
}

function isRelevantSharedFinding(task: PlanningAtomTask, finding: PlanningSharedFinding): boolean {
  const brief = task.sharedBrief;
  if (!brief) return false;
  const evidenceMatch = finding.evidencePath && brief.sharedEvidenceRefs.some((ref) => ref.path === finding.evidencePath && ref.primaryAtomId === finding.sourceAtomId);
  const interfaceMatch = finding.interfaceKey && brief.sharedInterfaceRefs.some((ref) => ref.key === finding.interfaceKey && ref.primaryAtomId === finding.sourceAtomId);
  return Boolean(evidenceMatch || interfaceMatch);
}

function objectValueOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function stringArrayValue(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function requiredString(value: unknown, label: string): string {
  const text = stringValue(value);
  if (text === undefined) throw new Error(`Atom planner output missing ${label}`);
  return text;
}
