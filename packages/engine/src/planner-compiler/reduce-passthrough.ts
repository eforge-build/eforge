import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomModuleCandidate, PlanningAtomOutput, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import { buildPlanningReduceTask, validatePlanningReduceOutput, type PlanningReduceNode, type PlanningReduceOutput, type PlanningReduceTree } from './reduce-contracts.js';
import { clonePlanningReduceDigest } from './reduce-digest-contracts.js';
import { utf8ByteLength } from './source-analysis.js';

/**
 * Deterministic single-atom fast path: when the reduce tree degenerates to
 * one node fed by exactly one accepted atom that reports no digest issues,
 * the reducer agent adds nothing - its inputs already are the canonical
 * synthesis. Construct the root reduce output directly from the atom output.
 * Returns undefined whenever eligibility or validation fails, so the caller
 * falls back to the reducer agent (fail closed to the agent path).
 */
export function singleAtomPassthroughOutput(graph: PlanningAtomGraph, tree: PlanningReduceTree, node: PlanningReduceNode, atomOutput: PlanningAtomOutput): PlanningReduceOutput | undefined {
  if (tree.nodes.length !== 1 || node.inputNodeIds.length !== 0 || node.inputAtomIds.length !== 1) return undefined;
  if (node.inputAtomIds[0] !== atomOutput.atomId) return undefined;
  if (atomOutput.status !== 'completed' || !atomOutput.reduceDigest) return undefined;
  if ((atomOutput.reduceDigest.issues ?? []).length > 0) return undefined;

  const digest = { ...clonePlanningReduceDigest(atomOutput.reduceDigest), sourceId: node.nodeId, sourceKind: 'reduce' as const };
  const output: PlanningReduceOutput = {
    nodeId: node.nodeId,
    status: 'completed',
    compactSummary: boundedSummary(`Deterministic single-atom passthrough of ${atomOutput.atomId}. ${atomOutput.reduceDigest.summary}`, tree.limits.maxReduceSummaryBytes),
    reduceDigest: digest,
    ...(atomOutput.planFragments && atomOutput.planFragments.length > 0 ? { planFragments: atomOutput.planFragments.map(cloneFragment) } : {}),
    ...(atomOutput.moduleCandidates && atomOutput.moduleCandidates.length > 0 ? { moduleCandidates: atomOutput.moduleCandidates.map(cloneModule) } : {}),
  };

  const validation = validatePlanningReduceOutput({ graph, tree, task: buildPlanningReduceTask(tree, node, [atomOutput], []), output });
  return validation.ok ? output : undefined;
}

function boundedSummary(summary: string, maxBytes: number): string {
  let bounded = summary;
  while (bounded.length > 0 && utf8ByteLength(bounded) > maxBytes) bounded = bounded.slice(0, Math.max(0, bounded.length - Math.max(16, bounded.length - maxBytes)));
  return bounded;
}

function cloneFragment(fragment: PlanningAtomPlanFragment): PlanningAtomPlanFragment {
  return { ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], ...(fragment.dependsOnFragmentIds ? { dependsOnFragmentIds: [...fragment.dependsOnFragmentIds] } : {}) };
}

function cloneModule(module: PlanningAtomModuleCandidate): PlanningAtomModuleCandidate {
  return { ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], ...(module.dependsOnModuleIds ? { dependsOnModuleIds: [...module.dependsOnModuleIds] } : {}) };
}
