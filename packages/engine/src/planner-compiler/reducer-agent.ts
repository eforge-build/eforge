import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig, CustomTool } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { utf8ByteLength } from './source-analysis.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import { PlanningReduceOutputSchema, validatePlanningReduceModuleBoundaries, type PlanningReduceOutput, type PlanningReduceTask } from './reduce-contracts.js';
import { boundedOrReference, minimumReduceDigestPromptByteLength, PLANNING_MODULE_DOCS_WORK_PROMPT_RULE, PLANNING_MODULE_REVIEW_INTENT_PROMPT_RULE, PLANNING_MODULE_TEST_WORK_PROMPT_RULE, PLANNING_MODULE_WORK_DIGEST_MIRROR_RULE, validatePlanningReduceDigest, withCandidateWorkDeclarations, type PlanningReduceDigest, type PlanningReduceDigestIssue } from './reduce-digest-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { emitPlannerCompilerCheckpointWarning, emitPlannerCompilerRetry, PLANNER_COMPILER_AGENT_MAX_ATTEMPTS, retryablePlannerCompilerSubtype } from './agent-retry.js';
import type { PlanningModuleBoundaryBudget } from './module-boundary-budget.js';

export interface RunPlanningReducerInput { task: PlanningReduceTask; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; abortSignal?: AbortSignal; onEvent?: PlannerCompilerEventSink }
export interface PlanningReducerResult { output: PlanningReduceOutput; events: EforgeEvent[]; resultText: string; prompt: string }
const SUBMIT_REDUCE_OUTPUT_TOOL = 'submit_reduce_output';

export async function runPlanningReducer(input: RunPlanningReducerInput): Promise<PlanningReducerResult> {
  assertFeasibleReduceDigestBudget(input.task);
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
        customTools: [createReduceOutputSubmissionTool(submitToolName, input.task, (output) => {
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

function assertFeasibleReduceDigestBudget(task: PlanningReduceTask): void {
  const minimum = minimumReduceDigestPromptByteLength({ sourceId: task.node.nodeId, sourceKind: 'reduce', criterionIds: task.node.criterionIds, aspectIds: task.node.aspectIds });
  if (task.budget.maxReduceDigestPromptBytes < minimum) throw new Error(`reduce digest prompt budget impossible:${task.node.nodeId}:minimum ${minimum} > assigned ${task.budget.maxReduceDigestPromptBytes}`);
}

export function formatPlanningReducerPrompt(task: PlanningReduceTask, submitToolName = SUBMIT_REDUCE_OUTPUT_TOOL): string {
  return `You are a bounded reducer for eforge's planner compiler.

Synthesize only this reduce node without repository tools. Deduplicate fragments/modules, reconcile conflicts, preserve traceability, and submit through ${submitToolName}. Correct rejected submissions; stop after the first acceptance. Do not return JSON in text.

Reducer inputs are bounded producer-authored digests. Full artifact markdown and long descriptions are intentionally omitted from this prompt; preserve and reason from the IDs, traceability, intent, purpose, gaps, and conflicts in the digests.

## Reduce task

${JSON.stringify({ graphId: task.graphId, node: promptReduceNode(task), budget: task.budget }, null, 2)}

${formatModuleBoundaryCeilings(task.moduleBoundaryBudget)}

## Atom output reducer digests

${JSON.stringify(task.atomOutputs.map(reduceDigestForAtomOutput), null, 2)}

## Child reduce output reducer digests

${JSON.stringify(task.childOutputs.map(reduceDigestForReduceOutput), null, 2)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema.

- nodeId must be exactly "${task.node.nodeId}".
- Link every fragment, module, conflict, and gap to provided criterionIds and aspectIds.
- Completed outputs must not contain representationRequired gaps.
- Source/localization gaps (missing owner paths, missing contract/entrypoint/config/consumer surface evidence, directory-only evidence, missing materialized source, or localization ambiguity) must be emitted as structured gaps with issueKind, sourceLocalizationSignal: true, relevant sourceNeedIds, affectedAtomIds, ownerPaths when known, criterionIds, and aspectIds. Do not convert these gaps into implementation candidates.
- Only source/localization gaps with concrete ownerPaths, productScopedOutputRefs, and productScopedValidationRefs tied to original criterionIds can later become buildable residue; otherwise they are repair-only compiler diagnostics.
- Produce the smallest coherent module set. Coalesce only within moduleBoundaryBudget; ownership, dependency, or a breached ceiling can require a split, but generic labels cannot.
- Every module must fit the context, criterion, and subsystem ceilings. On rejection, split or narrow it without dropping coverage, then resubmit.
- ${PLANNING_MODULE_DOCS_WORK_PROMPT_RULE}
- ${PLANNING_MODULE_TEST_WORK_PROMPT_RULE}
- ${PLANNING_MODULE_REVIEW_INTENT_PROMPT_RULE}
- Preserve model-authored intent from digest modules when re-emitting module candidates; when merging modules, keep the strongest docs/test work and a single explicit test owner, and justify the merged review depth.
- ${PLANNING_MODULE_WORK_DIGEST_MIRROR_RULE}
- Failed outputs must not include fragments or module candidates.
- Include reduceDigest. It is the canonical bounded digest for parent reducers; do not copy full markdown into it.
- reduceDigest.sourceId must be exactly "${task.node.nodeId}" and reduceDigest.sourceKind must be "reduce".
- reduceDigest's formatted prompt JSON must fit within ${task.budget.maxReduceDigestPromptBytes} bytes (assigned by the map/reduce budget planner); prefer fewer fragments/modules with concise intent/purpose over long prose.
- Keep compactSummary within ${task.budget.maxReduceSummaryBytes} bytes.
`;
}

function promptReduceNode(task: PlanningReduceTask): Pick<PlanningReduceTask['node'], 'nodeId' | 'depth' | 'inputAtomIds' | 'inputNodeIds'> {
  const { nodeId, depth, inputAtomIds, inputNodeIds } = task.node;
  return { nodeId, depth, inputAtomIds, inputNodeIds };
}

function formatModuleBoundaryCeilings(budget: PlanningModuleBoundaryBudget): string {
  return `Module ceilings: context=${budget.maxSourceContextBytes} bytes; criteria=${budget.maxCriteriaPerModule}; subsystems=${budget.maxSubsystemsPerModule}.`;
}

function createReduceOutputSubmissionTool(submitToolName: string, task: PlanningReduceTask, onSubmit: (output: PlanningReduceOutput) => boolean): CustomTool {
  return {
    name: SUBMIT_REDUCE_OUTPUT_TOOL,
    description: 'Submit the structured bounded reduce output. This is the only way to complete a reduce turn.',
    inputSchema: PlanningReduceOutputSchema,
    handler: async (input: unknown) => {
      const parsed = safeParseWithSchema(PlanningReduceOutputSchema, input);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      const output = parsed.data as PlanningReduceOutput;
      if (output.status === 'completed' && !output.reduceDigest) return `Submission rejected: completed reduce output requires reduceDigest.\nCall ${submitToolName} again with a compact, semantically valid reduceDigest.`;
      if (output.reduceDigest) {
        const errors = validatePlanningReduceDigest({ digest: output.reduceDigest, expectedSourceId: task.node.nodeId, expectedSourceKind: 'reduce', allowedCriterionIds: task.node.criterionIds, allowedAspectIds: task.node.aspectIds, maxPromptBytes: task.budget.maxReduceDigestPromptBytes });
        if (errors.length > 0) return `Submission rejected: ${errors.join('; ')}\nCall ${submitToolName} again with a compact, semantically valid reduceDigest.`;
        // Parents consume the digest with modules rebuilt from moduleCandidates, so the
        // rebuilt projection must satisfy the same budgets as the authored digest or the
        // prompt-budget planner's safety proof no longer covers execution.
        const projected = withCandidateWorkDeclarations(output.reduceDigest, output.moduleCandidates ?? []);
        if (projected !== output.reduceDigest) {
          const projectedErrors = validatePlanningReduceDigest({ digest: projected, expectedSourceId: task.node.nodeId, expectedSourceKind: 'reduce', allowedCriterionIds: task.node.criterionIds, allowedAspectIds: task.node.aspectIds, maxPromptBytes: task.budget.maxReduceDigestPromptBytes });
          if (projectedErrors.length > 0) return `Submission rejected: reduceDigest rebuilt from moduleCandidates fails validation: ${projectedErrors.join('; ')}\nParent reducers consume reduceDigest.modules rebuilt from moduleCandidates; trim, split, or mirror the candidates so the rebuilt digest fits its budgets, then call ${submitToolName} again.`;
        }
      }
      const moduleErrors = validatePlanningReduceModuleBoundaries(task, output);
      if (moduleErrors.length > 0) return `Submission rejected: ${moduleErrors.join('; ')}\nSplit or narrow violating modules without dropping criterion/aspect coverage, mirror the repaired candidates in reduceDigest.modules, then call ${submitToolName} again.`;
      if (!onSubmit(output)) return `Error: ${submitToolName} was already called. Only one reduce output submission is allowed.`;
      return 'Reduce output submitted successfully.';
    },
  };
}

function reduceDigestForAtomOutput(output: PlanningAtomOutput): PlanningReduceDigest {
  if (output.reduceDigest) return withCandidateWorkDeclarations(output.reduceDigest, output.moduleCandidates ?? []);
  const fragments = output.planFragments ?? [];
  const modules = output.moduleCandidates ?? [];
  return {
    sourceId: output.atomId,
    sourceKind: 'atom',
    status: output.status,
    summary: boundedOrReference(output.compactHandoff ?? output.error, `No producer-authored reducer digest was supplied for atom ${output.atomId}; use artifact IDs and traceability only.`),
    criterionIds: uniq([...fragments.flatMap((fragment) => fragment.criterionIds), ...modules.flatMap((module) => module.criterionIds)]),
    aspectIds: uniq([...output.aspectUpdates.map((update) => update.aspectId), ...fragments.flatMap((fragment) => fragment.aspectIds), ...modules.flatMap((module) => module.aspectIds)]),
    fragments: fragments.map((fragment) => ({ fragmentId: fragment.fragmentId, title: fragment.title, intent: boundedOrReference(fragment.markdown, `Full markdown retained in atom artifact fragment ${fragment.fragmentId}.`), criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], ...(fragment.dependsOnFragmentIds ? { dependsOnFragmentIds: [...fragment.dependsOnFragmentIds] } : {}) })),
    modules: modules.map((module) => ({ moduleId: module.moduleId, title: module.title, purpose: boundedOrReference(module.description, `Full description retained in atom artifact module ${module.moduleId}.`), criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], validationExpectation: boundedOrReference(module.validationExpectation, `Validation details retained in atom artifact module ${module.moduleId}.`), ...(module.docsWork ? { docsWork: module.docsWork } : {}), ...(module.testWork ? { testWork: module.testWork } : {}), ...(module.testOwnership ? { testOwnership: module.testOwnership } : {}), ...(module.reviewDepth ? { reviewDepth: module.reviewDepth } : {}), ...(module.reviewRationale ? { reviewRationale: module.reviewRationale } : {}), ...(module.dependsOnModuleIds ? { dependsOnModuleIds: [...module.dependsOnModuleIds] } : {}) })),
  };
}

function reduceDigestForReduceOutput(output: PlanningReduceOutput): PlanningReduceDigest {
  if (output.reduceDigest) return withCandidateWorkDeclarations(output.reduceDigest, output.moduleCandidates ?? []);
  const fragments = output.planFragments ?? [];
  const modules = output.moduleCandidates ?? [];
  const issues: PlanningReduceDigestIssue[] = [
    ...(output.conflicts ?? []).map((conflict) => issueDigest('conflict', conflict.conflictId, conflict.title, conflict.description, conflict.criterionIds, conflict.aspectIds, conflict.sourceIds)),
    ...(output.gaps ?? []).map((gap) => issueDigest('gap', gap.gapId, gap.title, gap.description, gap.criterionIds, gap.aspectIds, gap.sourceIds, gap.representationRequired)),
  ];
  return {
    sourceId: output.nodeId,
    sourceKind: 'reduce',
    status: output.status,
    summary: boundedOrReference(output.compactSummary || output.error, `No producer-authored reducer digest was supplied for reduce node ${output.nodeId}; use artifact IDs and traceability only.`),
    criterionIds: uniq([...fragments.flatMap((fragment) => fragment.criterionIds), ...modules.flatMap((module) => module.criterionIds), ...issues.flatMap((issue) => issue.criterionIds)]),
    aspectIds: uniq([...fragments.flatMap((fragment) => fragment.aspectIds), ...modules.flatMap((module) => module.aspectIds), ...issues.flatMap((issue) => issue.aspectIds)]),
    fragments: fragments.map((fragment) => ({ fragmentId: fragment.fragmentId, title: fragment.title, intent: boundedOrReference(fragment.markdown, `Full markdown retained in reduce artifact fragment ${fragment.fragmentId}.`), criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], ...(fragment.dependsOnFragmentIds ? { dependsOnFragmentIds: [...fragment.dependsOnFragmentIds] } : {}) })),
    modules: modules.map((module) => ({ moduleId: module.moduleId, title: module.title, purpose: boundedOrReference(module.description, `Full description retained in reduce artifact module ${module.moduleId}.`), criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], validationExpectation: boundedOrReference(module.validationExpectation, `Validation details retained in reduce artifact module ${module.moduleId}.`), ...(module.docsWork ? { docsWork: module.docsWork } : {}), ...(module.testWork ? { testWork: module.testWork } : {}), ...(module.testOwnership ? { testOwnership: module.testOwnership } : {}), ...(module.reviewDepth ? { reviewDepth: module.reviewDepth } : {}), ...(module.reviewRationale ? { reviewRationale: module.reviewRationale } : {}), ...(module.dependsOnModuleIds ? { dependsOnModuleIds: [...module.dependsOnModuleIds] } : {}) })),
    issues,
  };
}

function issueDigest(kind: 'conflict' | 'gap', issueId: string, title: string, description: string, criterionIds: string[], aspectIds: string[], sourceIds?: string[], representationRequired?: boolean): PlanningReduceDigestIssue {
  return { issueId, kind, title, summary: boundedOrReference(description, `Full ${kind} description retained in reduce artifact issue ${issueId}.`), criterionIds: [...criterionIds], aspectIds: [...aspectIds], ...(sourceIds ? { sourceIds: [...sourceIds] } : {}), ...(representationRequired ? { representationRequired } : {}) };
}

function uniq(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))].sort(); }
