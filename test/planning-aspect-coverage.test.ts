import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { derivePlanningAspectCoverage, derivePlanningAtomGraph, deriveSourceInventory, type PlanningAspectCoverageUpdate, type PlanningCriterionAspect } from '@eforge-build/engine/compile-resilience/planning-decomposition';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 2_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 4, maxSubsystemsPerUnit: 4, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Coverage Plan', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function buildCoverage(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'prd.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'prd.md', limits, inventory });
  return { graph, inventory };
}

describe('planning aspect coverage accounting', () => {
  it('derives multiple evidence aspects for one criterion without conflating raw coverage with completion', () => {
    const { graph, inventory } = buildCoverage([
      'engine and client changes update `packages/engine/src/config.ts` and `packages/client/src/events.ts` together.',
    ]);

    const coverage = derivePlanningAspectCoverage({ graph, inventory });
    const evidenceAspects = coverage.aspects.filter((aspect) => aspect.criterionId === 'ac-001' && aspect.source.kind === 'evidence');
    const criterion = coverage.criteria.find((item) => item.criterionId === 'ac-001');

    expect(evidenceAspects.map((aspect) => aspect.aspectId).sort()).toEqual(['ac-001:evidence:packages-client-src-events-ts', 'ac-001:evidence:packages-engine-src-config-ts']);
    expect(evidenceAspects.map((aspect) => aspect.source.value).sort()).toEqual(['packages/client/src/events.ts', 'packages/engine/src/config.ts']);
    expect(criterion?.rawCoveredByAtomIds.length).toBeGreaterThan(0);
    expect(criterion?.complete).toBe(false);
    expect(criterion?.pendingAspectIds.length).toBe(criterion?.requiredAspectIds.length);
  });

  it('reports partial aspect coverage separately from complete criterion coverage', () => {
    const { graph, inventory } = buildCoverage([
      'engine and client changes update `packages/engine/src/config.ts` and `packages/client/src/events.ts` together.',
    ]);
    const baseline = derivePlanningAspectCoverage({ graph, inventory });
    const engineAspect = baseline.aspects.find((aspect) => aspect.source.value === 'packages/engine/src/config.ts');
    expect(engineAspect).toBeDefined();

    const partial = derivePlanningAspectCoverage({ graph, inventory, updates: [{ aspectId: engineAspect!.aspectId, status: 'resolved', completedByAtomIds: engineAspect!.atomIds }] });
    const criterion = partial.criteria.find((item) => item.criterionId === 'ac-001');

    expect(criterion?.resolvedAspectIds).toContain(engineAspect!.aspectId);
    expect(criterion?.complete).toBe(false);
    expect(criterion?.pendingAspectIds.length).toBeGreaterThan(0);
    expect(partial.rawCriterionCoverage.find((item) => item.criterionId === 'ac-001')?.coveredByAtomIds.length).toBeGreaterThan(0);
  });

  it('treats skipped, residue, and follow-up aspect states as represented only with executable metadata', () => {
    const { graph } = buildCoverage(['engine criterion has several independently accountable aspects.']);
    const aspects: PlanningCriterionAspect[] = [
      aspect('ac-001:subsystem:engine', 'ac-001', 'engine'),
      aspect('ac-001:subsystem:docs', 'ac-001', 'docs'),
      aspect('ac-001:general:residue', 'ac-001', 'residue'),
      aspect('ac-001:general:follow-up', 'ac-001', 'follow-up'),
    ];

    const coverage = derivePlanningAspectCoverage({ graph, aspects, updates: [
      { aspectId: 'ac-001:subsystem:engine', status: 'resolved', completedByAtomIds: ['atom-a'] },
      { aspectId: 'ac-001:subsystem:docs', status: 'skipped', reason: 'docs are unchanged for this slice' },
      { aspectId: 'ac-001:general:residue', status: 'represented', representation: { kind: 'residue', moduleId: 'module-residue', reason: 'source detail remains bounded residue', validationExpectation: 'module captures bounded unknowns' } },
      { aspectId: 'ac-001:general:follow-up', status: 'represented', representation: { kind: 'follow-up', moduleId: 'module-follow-up', reason: 'follow-up module owns deferred verification', validationExpectation: 'module validates follow-up behavior' } },
    ] });
    const criterion = coverage.criteria[0];

    expect(criterion.complete).toBe(true);
    expect(criterion.skippedAspectIds).toEqual(['ac-001:subsystem:docs']);
    expect(criterion.representedAspectIds).toEqual(['ac-001:general:follow-up', 'ac-001:general:residue']);
    expect(coverage.validationErrors).toEqual([]);
  });

  it('requires every required aspect to be resolved, skipped, or represented before a criterion is complete', () => {
    const { graph } = buildCoverage(['engine criterion has required implementation and validation aspects.']);
    const aspects: PlanningCriterionAspect[] = [aspect('ac-001:general:implementation', 'ac-001', 'implementation'), aspect('ac-001:general:validation', 'ac-001', 'validation')];

    const missingValidation = derivePlanningAspectCoverage({ graph, aspects, updates: [{ aspectId: 'ac-001:general:implementation', status: 'resolved' }] });
    expect(missingValidation.criteria[0].complete).toBe(false);
    expect(missingValidation.criteria[0].pendingAspectIds).toEqual(['ac-001:general:validation']);

    const emptyResolution = derivePlanningAspectCoverage({ graph, aspects: [aspects[0]], updates: [{ aspectId: 'ac-001:general:implementation', status: 'resolved', completedByAtomIds: [] }] });
    expect(emptyResolution.criteria[0].complete).toBe(false);
    expect(emptyResolution.validationErrors).toEqual(['resolved aspect requires completed atom ids:ac-001:general:implementation']);

    const complete = derivePlanningAspectCoverage({ graph, aspects, updates: [{ aspectId: 'ac-001:general:implementation', status: 'resolved' }, { aspectId: 'ac-001:general:validation', status: 'represented', representation: { kind: 'follow-up', moduleId: 'module-validation', reason: 'validation remains bounded follow-up work', validationExpectation: 'follow-up module validates behavior' } }] });
    expect(complete.criteria[0].complete).toBe(true);

    const vagueRepresentation = derivePlanningAspectCoverage({ graph, aspects, updates: [{ aspectId: 'ac-001:general:implementation', status: 'resolved' }, { aspectId: 'ac-001:general:validation', status: 'represented', representation: { kind: 'residue', moduleId: 'module-validation', reason: '', validationExpectation: '' } }] });
    expect(vagueRepresentation.criteria[0].complete).toBe(false);
    expect(vagueRepresentation.validationErrors).toEqual(['represented aspect requires kind, module, reason, and validation expectation:ac-001:general:validation']);

    const malformedUpdate = { aspectId: 'ac-001:general:validation', status: 'represented', representation: { kind: 'residue', moduleId: 'module-validation' } } as unknown as PlanningAspectCoverageUpdate;
    const malformedRepresentation = derivePlanningAspectCoverage({ graph, aspects, updates: [{ aspectId: 'ac-001:general:implementation', status: 'resolved' }, malformedUpdate] });
    expect(malformedRepresentation.criteria[0].complete).toBe(false);
    expect(malformedRepresentation.validationErrors).toEqual(['represented aspect requires kind, module, reason, and validation expectation:ac-001:general:validation']);
  });
});

function aspect(aspectId: string, criterionId: string, value: string): PlanningCriterionAspect {
  const source = aspectId.includes(':subsystem:') ? { kind: 'subsystem' as const, value } : { kind: 'general' as const, value };
  return { aspectId, criterionId, label: `${source.kind}: ${value}`, source, required: true, atomIds: ['atom-a'] };
}
