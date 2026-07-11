import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { safeParseWithSchema } from '@eforge-build/client';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSourceInventory, PlanningAtomModuleCandidateSchema, summarizePlanningAtomOutputs, validatePlanningAtomOutput, validatePlanningAtomOutputForTask, type PlanningAtomOutput, type PlanningAtomTask, type PlanningCriterionAspect } from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Atom Contracts', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function graphFrom(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'atom-contracts.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'atom-contracts.md', limits, inventory });
  return { graph, inventory };
}

describe('planning atom map contracts', () => {
  it('builds atom tasks with aspect IDs and bounded source context', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.', 'client CLI updates `packages/client/src/events.ts` after ac-001.']);

    const tasks = buildPlanningAtomTasks({ graph, inventory });

    expect(tasks.length).toBe(2);
    expect(tasks.every((task) => task.graphId === graph.graphId)).toBe(true);
    expect(tasks.flatMap((task) => task.aspectIds).sort()).toEqual([
      'ac-001:evidence:packages-engine-src-config-ts',
      'ac-001:interface:config',
      'ac-001:interface:configuration',
      'ac-002:evidence:packages-client-src-events-ts',
      'ac-002:interface:command-surface',
    ]);
    expect(tasks.every((task) => task.sourceSlices.every((slice) => slice.byteLength <= limits.maxPromptSourceBytes))).toBe(true);
    expect(tasks.every((task) => task.workProfile.shape === 'bounded-decomposition')).toBe(true);
    expect(tasks.every((task) => task.workProfile.planningUnitCount === 2)).toBe(true);
  });

  it('validates atom output against owned aspects, links, and compact handoff budget', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });
    const aspectId = task.aspectIds[0];

    const valid = validatePlanningAtomOutput({ graph, inventory, task, output: {
      atomId: task.atomId,
      status: 'completed',
      compactHandoff: 'bounded handoff',
      aspectUpdates: resolvedUpdates(task),
      planFragments: [{ fragmentId: 'fragment-engine', title: 'Engine plan', criterionIds: ['ac-001'], aspectIds: task.aspectIds, markdown: 'Implement the engine config change.' }],
      moduleCandidates: [{ moduleId: 'module-engine', title: 'Engine module', criterionIds: ['ac-001'], aspectIds: task.aspectIds, description: 'Update engine config.', validationExpectation: 'Config tests pass.' }],
    } });

    expect(valid).toEqual({ ok: true, errors: [] });
  });

  it('accepts typed plan intent on module candidates and rejects unknown literals', () => {
    const candidate = { moduleId: 'module-engine', title: 'Engine module', criterionIds: ['ac-001'], aspectIds: ['ac-001:general:general'], description: 'Update engine config.', validationExpectation: 'Config tests pass.' };
    const intent = { docsWork: 'author-new', testWork: 'author-new', testOwnership: 'builder', reviewDepth: 'light', reviewRationale: 'Localized single-module change.' };

    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, { ...candidate, ...intent }).success).toBe(true);
    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, candidate).success).toBe(true);
    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, { ...candidate, docsWork: 'docs-please' }).success).toBe(false);
    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, { ...candidate, testWork: 'sync-existing' }).success).toBe(false);
    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, { ...candidate, testOwnership: 'tester' }).success).toBe(false);
    expect(safeParseWithSchema(PlanningAtomModuleCandidateSchema, { ...candidate, reviewDepth: 'extreme' }).success).toBe(false);
  });

  it('requires rationale when a module candidate declares review depth', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });
    const output: PlanningAtomOutput = {
      atomId: task.atomId,
      status: 'completed',
      aspectUpdates: resolvedUpdates(task),
      moduleCandidates: [{ moduleId: 'module-engine', title: 'Engine', criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: 'Update engine config.', validationExpectation: 'Checks pass.', testOwnership: 'builder', reviewDepth: 'light' }],
    };

    expect(validatePlanningAtomOutputForTask({ task, output })).toEqual({ ok: false, errors: ['module candidate review depth requires rationale:module-engine'] });
  });

  it('rejects unknown aspects and resolved aspects that do not cite the producing atom', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });

    const invalid = validatePlanningAtomOutput({ graph, inventory, task, output: {
      atomId: task.atomId,
      status: 'completed',
      aspectUpdates: [
        ...resolvedUpdates(task).filter((update) => update.aspectId !== 'ac-001:evidence:packages-engine-src-config-ts'),
        { aspectId: 'ac-001:evidence:packages-engine-src-config-ts', status: 'resolved', completedByAtomIds: ['other-atom'] },
        { aspectId: 'ac-999:evidence:missing', status: 'resolved', completedByAtomIds: [task.atomId] },
      ],
    } });

    expect(invalid).toEqual({ ok: false, errors: [`resolved aspect cites non-owner atom:${task.atomId}:ac-001:evidence:packages-engine-src-config-ts:other-atom`, `resolved aspect must cite producing atom:${task.atomId}:ac-001:evidence:packages-engine-src-config-ts`, 'unknown aspect:ac-999:evidence:missing'] });
  });

  it('submit-time task validation accepts resolved aspects that cite co-owner atoms', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.', 'client CLI updates `packages/client/src/events.ts` after ac-001.']);
    const ownerAtomIds = graph.atoms.map((atom) => atom.atomId).sort();
    const sharedAspect: PlanningCriterionAspect = { aspectId: 'ac-001:general:shared', criterionId: 'ac-001', label: 'general: shared', source: { kind: 'general', value: 'shared' }, required: true, atomIds: ownerAtomIds };
    const [task] = buildPlanningAtomTasks({ graph, inventory, aspects: [sharedAspect] });
    const output: PlanningAtomOutput = { atomId: task.atomId, status: 'completed', aspectUpdates: [{ aspectId: sharedAspect.aspectId, status: 'resolved', completedByAtomIds: ownerAtomIds }] };

    expect(task.aspects).toEqual([sharedAspect]);
    expect(validatePlanningAtomOutputForTask({ task, output })).toEqual({ ok: true, errors: [] });
    expect(validatePlanningAtomOutput({ graph, inventory, aspects: [sharedAspect], task, output })).toEqual({ ok: true, errors: [] });
  });

  it('rejects vague represented outputs and over-budget compact handoffs', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });

    const invalid = validatePlanningAtomOutput({ graph, inventory, task, output: {
      atomId: task.atomId,
      status: 'completed',
      compactHandoff: 'x'.repeat(task.budget.maxCompactHandoffBytes + 1),
      aspectUpdates: [
        { aspectId: task.aspectIds[0], status: 'represented', representation: { kind: 'residue', moduleId: 'module-residue', reason: '', validationExpectation: '' } },
        ...resolvedUpdates(task).slice(1),
      ],
    } });

    expect(invalid).toEqual({ ok: false, errors: [`compact handoff budget exceeded:${task.atomId}`, `represented aspect requires kind, module, reason, and validation expectation:${task.aspectIds[0]}`] });
  });

  it('rejects invalid fragment and module dependency references', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });
    const aspectId = task.aspectIds[0];

    const invalid = validatePlanningAtomOutput({ graph, inventory, task, output: {
      atomId: task.atomId,
      status: 'completed',
      aspectUpdates: resolvedUpdates(task),
      planFragments: [
        { fragmentId: 'fragment-main', title: 'Main', criterionIds: ['ac-001'], aspectIds: [aspectId], markdown: 'Main plan.', dependsOnFragmentIds: ['missing-fragment'] },
        { fragmentId: 'fragment-self', title: 'Self', criterionIds: ['ac-001'], aspectIds: [aspectId], markdown: 'Self plan.', dependsOnFragmentIds: ['fragment-self'] },
      ],
      moduleCandidates: [
        { moduleId: 'module-main', title: 'Main', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Main module.', validationExpectation: 'Main passes.', dependsOnModuleIds: ['missing-module'] },
        { moduleId: 'module-self', title: 'Self', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Self module.', validationExpectation: 'Self passes.', dependsOnModuleIds: ['module-self'] },
      ],
    } });

    expect(invalid).toEqual({ ok: false, errors: ['module candidate dependency missing:module-main:missing-module', 'module candidate dependency self-reference:module-self', 'plan fragment dependency missing:fragment-main:missing-fragment', 'plan fragment dependency self-reference:fragment-self'] });
  });

  it('summarizes atom outputs into aspect coverage without legacy decomposition models', () => {
    const { graph, inventory } = graphFrom(['engine updates `packages/engine/src/config.ts`.']);
    const [task] = buildPlanningAtomTasks({ graph, inventory });

    const summary = summarizePlanningAtomOutputs({ graph, inventory, outputs: [{ atomId: task.atomId, status: 'completed', aspectUpdates: resolvedUpdates(task) }] });

    expect(summary.validationErrors).toEqual([]);
    expect(summary.coverage.completeCriteria).toEqual(['ac-001']);
    expect(summary.coverage.criteria[0].resolvedAspectIds).toEqual(task.aspectIds);
  });
});

function resolvedUpdates(task: PlanningAtomTask) {
  return task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved' as const, completedByAtomIds: [task.atomId] }));
}
