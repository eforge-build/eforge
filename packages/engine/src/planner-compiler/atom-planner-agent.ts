import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { findJsonObjectText } from '../validation/json-object-extractor.js';
import { PlanningAtomOutputSchema, type PlanningAtomTask, type PlanningAtomOutput, type PlanningAtomOutputStatus, type PlanningAtomPlanFragment, type PlanningAtomModuleCandidate } from './atom-planning-contracts.js';
import { DEFAULT_PLANNING_REDUCE_LIMITS } from './reduce-contracts.js';
import { coercePlanningReduceDigest, deriveReduceDigestTotalByteLimit, minimumReduceDigestPromptByteLength, validatePlanningReduceDigest } from './reduce-digest-contracts.js';
import { formatPlanningAtomSourceMaterialization, materializePlanningAtomSource, type PlanningAtomSourceMaterialization } from './atom-source-materialization.js';
import type { PlanningAspectCoverageUpdate } from './coverage-accounting.js';
import type { PlanningSharedFinding } from './shared-brief-contracts.js';
import { sourceEvidenceRecordsForAtom, type PlanningSourceEvidenceBundle, type PlanningSourceEvidenceRecord } from './source-evidence-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { emitPlannerCompilerCheckpointWarning, emitPlannerCompilerRetry, PLANNER_COMPILER_AGENT_MAX_ATTEMPTS, retryablePlannerCompilerSubtype } from './agent-retry.js';

export interface RunPlanningAtomPlannerInput { task: PlanningAtomTask; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; abortSignal?: AbortSignal; acceptedSharedFindings?: PlanningSharedFinding[]; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; onEvent?: PlannerCompilerEventSink }
export interface PlanningAtomPlannerResult { output: PlanningAtomOutput; events: EforgeEvent[]; resultText: string; materialization: PlanningAtomSourceMaterialization }
const SUBMIT_ATOM_OUTPUT_TOOL = 'submit_atom_output';

export async function runPlanningAtomPlanner(input: RunPlanningAtomPlannerInput): Promise<PlanningAtomPlannerResult> {
  const materialization = materializePlanningAtomSource({ sourceContent: input.sourceContent, task: input.task });
  if (materialization.errors.length > 0) throw new Error(materialization.errors.join('; '));

  assertFeasibleReduceDigestBudget(input.task);
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_ATOM_OUTPUT_TOOL);
  const prompt = formatPlanningAtomPrompt(input.task, materialization, input.acceptedSharedFindings ?? [], sourceEvidenceRecordsForAtom(input.sourceEvidenceBundle, input.task.atomId), submitToolName);
  const events: EforgeEvent[] = [];
  let candidate = '';

  for (let attempt = 1; attempt <= PLANNER_COMPILER_AGENT_MAX_ATTEMPTS; attempt += 1) {
    const attemptEvents: EforgeEvent[] = [];
    let submittedOutput: PlanningAtomOutput | undefined;
    let streamedText = '';
    let resultText = '';
    try {
      for await (const event of input.harness.run({
        ...pickSdkOptions(input.agentOptions ?? {}),
        prompt,
        cwd: input.cwd,
        maxTurns: input.agentOptions?.maxTurns ?? 4,
        tools: 'none',
        customTools: [createAtomOutputSubmissionTool(submitToolName, input.task, (output) => {
          if (submittedOutput) return false;
          submittedOutput = output;
          return true;
        })],
        abortSignal: input.abortSignal,
        phase: 'compile',
        stage: 'planner',
      }, 'planner', input.task.atomId)) {
        input.onEvent?.(event);
        events.push(event);
        attemptEvents.push(event);
        if (event.type === 'agent:message') streamedText += event.content;
        if (event.type === 'agent:result' && event.result.resultText !== undefined) resultText = event.result.resultText;
      }

      candidate = resultText.trim() ? resultText : streamedText;
      if (!submittedOutput) throw new Error(`Atom planner did not call ${submitToolName}`);
      return { output: submittedOutput, events, resultText: candidate, materialization };
    } catch (err) {
      candidate = resultText.trim() ? resultText : streamedText;
      const subtype = retryablePlannerCompilerSubtype(err);
      if (submittedOutput && subtype) {
        emitPlannerCompilerCheckpointWarning({ events, onEvent: input.onEvent, attemptEvents, subtype, label: 'atom-planner-infrastructure', planId: input.task.atomId, err });
        return { output: submittedOutput, events, resultText: candidate, materialization };
      }
      if (!subtype || attempt >= PLANNER_COMPILER_AGENT_MAX_ATTEMPTS) throw err;
      emitPlannerCompilerRetry({ events, onEvent: input.onEvent, attempt, subtype, label: 'atom-planner-infrastructure-retry', planId: input.task.atomId });
    }
  }

  throw new Error(`Atom planner did not call ${submitToolName}`);
}

export function formatPlanningAtomPrompt(task: PlanningAtomTask, materialization: PlanningAtomSourceMaterialization, acceptedSharedFindings: PlanningSharedFinding[] = [], sourceEvidence: PlanningSourceEvidenceRecord[] = [], submitToolName = SUBMIT_ATOM_OUTPUT_TOOL): string {
  return `You are a bounded atom planner for eforge's planner compiler.

Plan only the atom below. Do not inspect the repository or call repository tools. Use the provided source excerpts, evidence paths, interface keys, and aspect IDs. Complete this turn by calling ${submitToolName} exactly once. Do not return JSON in text.

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

## Source evidence

${formatSourceEvidence(sourceEvidence)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema.

- atomId must be exactly "${task.atomId}".
- Every non-failed output must include one aspectUpdates entry for every provided aspectId.
- Every resolved aspect must cite completedByAtomIds containing "${task.atomId}".
- skipped aspect updates require a concrete reason.
- represented aspect updates require exactly this representation shape: { "kind": "residue" | "follow-up", "moduleId": "one moduleCandidates[].moduleId", "reason": "why representation is needed", "validationExpectation": "how the represented work is validated" }.
- Do not use moduleIds, moduleCandidateIds, fragmentIds, or prerequisiteAtomIds inside representation.
- Failed outputs must set aspectUpdates to [] and must not include plan fragments or module candidates.
- Include reduceDigest. It is the canonical bounded digest for reducer agents; do not copy full markdown into it.
- reduceDigest.sourceId must be exactly "${task.atomId}" and reduceDigest.sourceKind must be "atom".
- reduceDigest's formatted prompt JSON must fit within ${atomReduceDigestPromptByteLimit(task)} bytes (assigned by the map/reduce budget planner); prefer fewer fragments/modules with concise intent/purpose over long prose.
- Emit sharedFindings only for shared evidence this atom owns; consumer atoms should use accepted findings instead of repeating exploration.
- Treat source evidence records as the repo-grounded source of truth; records without contentExcerpt are references/status only and must not be invented from.
`;
}

function atomReduceDigestPromptByteLimit(task: PlanningAtomTask): number {
  return task.reduceDigestPromptBudgetBytes ?? deriveReduceDigestTotalByteLimit({ maxReducePromptBytes: DEFAULT_PLANNING_REDUCE_LIMITS.maxReducePromptBytes });
}

function assertFeasibleReduceDigestBudget(task: PlanningAtomTask): void {
  const assigned = atomReduceDigestPromptByteLimit(task);
  const minimum = minimumReduceDigestPromptByteLength({ sourceId: task.atomId, sourceKind: 'atom', criterionIds: task.criterionIds, aspectIds: task.aspectIds });
  if (assigned < minimum) throw new Error(`reduce digest prompt budget impossible:${task.atomId}:minimum ${minimum} > assigned ${assigned}`);
}

function createAtomOutputSubmissionTool(submitToolName: string, task: PlanningAtomTask, onSubmit: (output: PlanningAtomOutput) => boolean): CustomTool {
  return {
    name: SUBMIT_ATOM_OUTPUT_TOOL,
    description: 'Submit the structured bounded planner atom output. This is the only way to complete an atom-planner turn.',
    inputSchema: PlanningAtomOutputSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseWithSchema(PlanningAtomOutputSchema, input);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      const output = parsed.data as PlanningAtomOutput;
      if (output.reduceDigest) {
        const errors = validatePlanningReduceDigest({ digest: output.reduceDigest, expectedSourceId: task.atomId, expectedSourceKind: 'atom', allowedCriterionIds: task.criterionIds, allowedAspectIds: task.aspectIds, maxPromptBytes: atomReduceDigestPromptByteLimit(task) });
        if (errors.length > 0) return `Submission rejected: ${errors.join('; ')}\nCall ${submitToolName} again with a compact, semantically valid reduceDigest.`;
      }
      if (!onSubmit(output)) return `Error: ${submitToolName} was already called. Only one atom output submission is allowed.`;
      return 'Atom output submitted successfully.';
    },
  };
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
    ...(objectValueOrUndefined(value.reduceDigest) ? { reduceDigest: coercePlanningReduceDigest(objectValue(value.reduceDigest)) } : {}),
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

function formatSourceEvidence(records: PlanningSourceEvidenceRecord[]): string {
  if (records.length === 0) return 'No repository source evidence was materialized for this atom.';
  return JSON.stringify(records.map((record) => ({
    path: record.path,
    status: record.status,
    shared: record.shared,
    primaryAtomId: record.primaryAtomId,
    referencedByAtomIds: record.referencedByAtomIds,
    deliveredToAtomIds: record.deliveredToAtomIds,
    byteLength: record.byteLength,
    excerptByteLength: record.excerptByteLength,
    reason: record.reason,
    error: record.error,
    contentExcerpt: record.contentExcerpt,
  })), null, 2);
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
