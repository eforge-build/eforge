/**
 * Shared fixture builders for bounded planner compiler tests: PRD synthesis,
 * expected atom-task derivation, StubHarness submission scripts, and workspace
 * setup. Used by the stage-integration, planning-quality, and parity suites.
 */
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CompilePreflightRisk, PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import {
  buildPlanningAtomTasks,
  derivePlanningAtomGraph,
  deriveSharedPlanningBrief,
  deriveSourceInventory,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceOutput,
} from '@eforge-build/engine/planner-compiler';

export const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

export function prd(criteria: string[]): string {
  return ['# Compiler Stage', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

export function expectedTasks(content: string, limits: PlanningDecompositionLimits): PlanningAtomTask[] {
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: undefined });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  return buildPlanningAtomTasks({ graph, inventory, sharedBrief });
}

export function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
  };
}

export function completedReduceOutput(output: PlanningAtomOutput): PlanningReduceOutput {
  return {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced stage synthesis.',
    reduceDigest: { sourceId: 'reduce-000-001', sourceKind: 'reduce', status: 'completed', summary: 'Reduced stage synthesis.', criterionIds: [...new Set([...(output.planFragments ?? []).flatMap((fragment) => fragment.criterionIds), ...(output.moduleCandidates ?? []).flatMap((module) => module.criterionIds)])].sort(), aspectIds: [...new Set([...(output.planFragments ?? []).flatMap((fragment) => fragment.aspectIds), ...(output.moduleCandidates ?? []).flatMap((module) => module.aspectIds)])].sort() },
    planFragments: output.planFragments,
    moduleCandidates: [{ moduleId: 'module-reduce-000-001', title: 'Reduced module', criterionIds: output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [], aspectIds: output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [], description: 'Implement reduced stage work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

export function sourceGapOutput(task: PlanningAtomTask, gapId: string): PlanningReduceOutput {
  return {
    nodeId: 'reduce-000-001',
    status: 'incomplete',
    compactSummary: `Missing localized owner path for ${task.atomId}.`,
    gaps: [{ gapId, title: 'Missing localized owner path', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Missing localized owner path prevents source-grounded product planning.', representationRequired: true, issueKind: 'missing-owner-path', sourceLocalizationSignal: true, affectedAtomIds: [task.atomId] }],
  };
}

export function atomSubmission(output: PlanningAtomOutput) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
}

export function explorationSubmission(paths: string[], criterionIds: string[]) {
  return { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-exploration', input: { status: 'completed', projectHints: [{ kind: 'literal-path', query: 'grounded flag owner', paths, criterionIds }] }, output: 'ok' }] };
}

export function reduceSubmission(output: PlanningReduceOutput) {
  return { toolCalls: [{ tool: 'submit_reduce_output', toolUseId: `submit-${output.nodeId}`, input: output, output: 'ok' }] };
}

/**
 * Satisfaction-gate response for stage-level tests: the gate runs first on
 * every compile, so scripted harnesses must consume one run before their
 * exploration/atom/reduce entries. Reports "not satisfied" so the compile
 * proceeds.
 */
export function unsatisfiedGateSubmission() {
  return { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-gate', input: { alreadySatisfied: false, reason: 'Requested work is not implemented yet.', verdicts: [] }, output: 'ok' }] };
}

/** Satisfaction-gate response claiming every criterion is already implemented. */
export function satisfiedGateSubmission(criterionIds: string[], evidencePaths: string[]) {
  return { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-gate', input: { alreadySatisfied: true, reason: 'All acceptance criteria are already implemented.', verdicts: criterionIds.map((criterionId) => ({ criterionId, satisfied: true, evidencePaths, explanation: 'Implemented in the current tree.' })) }, output: 'ok' }] };
}


/** A no-fix reviewer script: empty issues block, no submission tool call. */
export function noFixReviewerResponse() {
  return { text: '<review-issues></review-issues>' };
}

export function overflowRisk(content: string): CompilePreflightRisk {
  return {
    level: 'overflow-risk',
    sourceBytes: content.length,
    promptSourceBytes: content.length,
    acceptanceCriteriaCount: 1,
    score: 100,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 1, subsystems: ['engine'], evidence: [] },
    reasons: ['test-overflow'],
    recommendation: { action: 'bounded-decomposition', reason: 'test bounded compiler route' },
  };
}

export async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eforge-compiler-stage-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  return root;
}

export async function readFileText(file: string): Promise<string> {
  return readFile(file, 'utf8');
}
