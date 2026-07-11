import { describe, expect, it } from 'vitest';
import {
  derivePlanPipelineSettings,
  HEAVY_REVIEW_MIN_SCORE,
  LARGE_PLAN_ASPECT_COUNT,
  LARGE_PLAN_CRITERION_COUNT,
  LARGE_PLAN_SOURCE_BYTES,
  MULTI_SUBSYSTEM_COUNT,
  type PlanPipelineModuleSignals,
  type PlanPipelineRiskInputs,
} from '@eforge-build/engine/planner-compiler';

function module(overrides: Partial<PlanPipelineModuleSignals> & { moduleId: string }): PlanPipelineModuleSignals {
  return { criterionIds: ['ac-001'], aspectIds: ['ac-001:general:general'], dependsOnModuleIds: [], residue: false, ...overrides };
}

function atom(overrides: Partial<PlanPipelineRiskInputs['atoms'][number]> & { atomId: string }): PlanPipelineRiskInputs['atoms'][number] {
  return { criterionIds: ['ac-001'], subsystemHints: [], estimate: { sourceBytes: 500, criteriaCount: 1, subsystemCount: 0, evidencePathCount: 0, estimatedPromptBytes: 2_000 }, ...overrides };
}

function inputs(overrides: Partial<PlanPipelineRiskInputs>): PlanPipelineRiskInputs {
  return { modules: [], atoms: [], localizationRecords: [], residueCandidates: [], ...overrides };
}

describe('per-plan pipeline derivation', () => {
  it('derives light review for a trivial module with no risk factors', () => {
    const derivation = derivePlanPipelineSettings(inputs({ modules: [module({ moduleId: 'module-a' })], atoms: [atom({ atomId: 'atom-a' })] }));

    expect(derivation.plans).toHaveLength(1);
    expect(derivation.plans[0].build).toEqual(['implement', 'review-cycle']);
    expect(derivation.plans[0].review).toEqual({ strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' });
    expect(derivation.plans[0].risk).toEqual({ moduleId: 'module-a', score: 0, factors: [] });
    expect(derivation.plans[0].rationale).toContain('no risk factors');
  });

  it('maps each risk factor from its signal', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'module-large', criterionIds: ['ac-001', 'ac-002', 'ac-003'] }),
        module({ moduleId: 'module-bytes', criterionIds: ['ac-010'] }),
        module({ moduleId: 'module-aspects', criterionIds: ['ac-020'], aspectIds: Array.from({ length: LARGE_PLAN_ASPECT_COUNT }, (_, index) => `ac-020:aspect-${index}`) }),
        module({ moduleId: 'module-lowconf', criterionIds: ['ac-030'] }),
        module({ moduleId: 'module-subsystems', criterionIds: ['ac-040'] }),
        module({ moduleId: 'module-root', criterionIds: ['ac-050'] }),
        module({ moduleId: 'module-leaf', criterionIds: ['ac-060'], dependsOnModuleIds: ['module-root'] }),
      ],
      atoms: [
        atom({ atomId: 'atom-bytes', criterionIds: ['ac-010'], estimate: { sourceBytes: LARGE_PLAN_SOURCE_BYTES, criteriaCount: 1, subsystemCount: 0, evidencePathCount: 0, estimatedPromptBytes: 2_000 } }),
        atom({ atomId: 'atom-subsystems', criterionIds: ['ac-040'], subsystemHints: Array.from({ length: MULTI_SUBSYSTEM_COUNT }, (_, index) => `subsystem-${index}`) }),
      ],
      localizationRecords: [
        { confidence: 'low', status: 'partial', linkedCriterionIds: ['ac-030'], linkedAspectIds: [] },
        { confidence: 'high', status: 'resolved', linkedCriterionIds: ['ac-001', 'ac-010', 'ac-020', 'ac-040', 'ac-050', 'ac-060'], linkedAspectIds: [] },
      ],
    }));

    const byId = new Map(derivation.plans.map((plan) => [plan.moduleId, plan]));
    expect(byId.get('module-large')?.risk.factors).toEqual([]);
    expect(byId.get('module-bytes')?.risk.factors).toEqual(['large-plan']);
    expect(byId.get('module-aspects')?.risk.factors).toEqual([]);
    expect(byId.get('module-lowconf')?.risk.factors).toEqual(['low-confidence-localization']);
    expect(byId.get('module-subsystems')?.risk.factors).toEqual(['multi-subsystem']);
    expect(byId.get('module-root')?.risk.factors).toEqual(['dependency-root']);
    expect(byId.get('module-leaf')?.risk.factors).toEqual([]);
  });

  it('escalates residue modules and repair-only residue to heavy review', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [module({ moduleId: 'candidate-residue', residue: true })],
      residueCandidates: [{ candidateId: 'candidate-residue', buildability: 'repair-only', criterionIds: ['ac-001'] }],
    }));

    expect(derivation.plans[0].risk.score).toBeGreaterThanOrEqual(HEAVY_REVIEW_MIN_SCORE);
    expect(derivation.plans[0].risk.factors).toEqual(['residue-derived', 'repair-only-residue']);
    expect(derivation.plans[0].review).toEqual({ strategy: 'parallel', perspectives: ['code', 'security', 'test', 'verify'], maxRounds: 2, evaluatorStrictness: 'strict' });
    expect(derivation.plans[0].build).toEqual(['implement', 'test-cycle', 'review-cycle']);
  });

  it('treats unresolved localization records as low confidence regardless of scored confidence', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [module({ moduleId: 'module-a', aspectIds: ['ac-001:general:general'] })],
      localizationRecords: [{ confidence: 'medium', status: 'unresolved', linkedCriterionIds: [], linkedAspectIds: ['ac-001:general:general'] }],
    }));

    expect(derivation.plans[0].risk.factors).toEqual(['low-confidence-localization']);
    expect(derivation.plans[0].review.perspectives).toEqual(['code', 'test']);
    expect(derivation.plans[0].build).toEqual(['implement', 'review-cycle']);
  });

  it('produces different review settings for a large risky plan and a trivial plan', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'module-risky', criterionIds: Array.from({ length: LARGE_PLAN_CRITERION_COUNT }, (_, index) => `ac-10${index}`) }),
        module({ moduleId: 'module-trivial', criterionIds: ['ac-200'] }),
      ],
      atoms: [
        atom({ atomId: 'atom-risky', criterionIds: ['ac-100'], subsystemHints: ['engine', 'monitor', 'client'], estimate: { sourceBytes: LARGE_PLAN_SOURCE_BYTES, criteriaCount: 3, subsystemCount: 3, evidencePathCount: 0, estimatedPromptBytes: 20_000 } }),
        atom({ atomId: 'atom-trivial', criterionIds: ['ac-200'] }),
      ],
      localizationRecords: [{ confidence: 'low', status: 'partial', linkedCriterionIds: ['ac-100'], linkedAspectIds: [] }],
    }));

    const risky = derivation.plans.find((plan) => plan.moduleId === 'module-risky');
    const trivial = derivation.plans.find((plan) => plan.moduleId === 'module-trivial');
    expect(risky?.review).toEqual({ strategy: 'parallel', perspectives: ['code', 'security', 'test', 'verify'], maxRounds: 2, evaluatorStrictness: 'strict' });
    expect(trivial?.review).toEqual({ strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' });
    expect(risky?.review).not.toEqual(trivial?.review);
    expect(risky?.build).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(trivial?.build).toEqual(['implement', 'review-cycle']);
  });

  it('derives docs build stages from declared docs work', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'module-author', docsWork: 'author-new' }),
        module({ moduleId: 'module-sync', criterionIds: ['ac-002'], docsWork: 'sync-existing' }),
        module({ moduleId: 'module-none', criterionIds: ['ac-003'], docsWork: 'none' }),
      ],
    }));

    const byId = new Map(derivation.plans.map((plan) => [plan.moduleId, plan]));
    expect(byId.get('module-author')?.build).toEqual([['implement', 'doc-author'], 'doc-sync', 'review-cycle']);
    expect(byId.get('module-sync')?.build).toEqual(['implement', 'doc-sync', 'review-cycle']);
    expect(byId.get('module-none')?.build).toEqual(['implement', 'review-cycle']);
    expect(byId.get('module-author')?.rationale).toContain('declared docs work author-new');
  });

  it('derives test build stages from legacy test work declarations', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'module-author', testWork: 'author-new' }),
        module({ moduleId: 'module-exercise', criterionIds: ['ac-002'], testWork: 'exercise-existing' }),
      ],
    }));

    const byId = new Map(derivation.plans.map((plan) => [plan.moduleId, plan]));
    expect(byId.get('module-author')?.build).toEqual(['implement', 'test-write', 'test-cycle', 'review-cycle']);
    expect(byId.get('module-author')?.testOwnership).toBe('test-writer');
    expect(byId.get('module-exercise')?.build).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(byId.get('module-exercise')?.testOwnership).toBe('existing-only');
    expect(byId.get('module-author')?.rationale).toContain('test work author-new');
  });

  it('normalizes typed test ownership into one authoring stage', () => {
    const derivation = derivePlanPipelineSettings(inputs({ modules: [
      module({ moduleId: 'module-builder', testWork: 'author-new', testOwnership: 'builder' }),
      module({ moduleId: 'module-writer', criterionIds: ['ac-002'], testWork: 'author-new', testOwnership: 'test-writer' }),
      module({ moduleId: 'module-existing', criterionIds: ['ac-003'], testWork: 'exercise-existing', testOwnership: 'existing-only' }),
    ] }));

    const byId = new Map(derivation.plans.map((plan) => [plan.moduleId, plan]));
    expect(byId.get('module-builder')?.build).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(byId.get('module-writer')?.build).toEqual(['implement', 'test-write', 'test-cycle', 'review-cycle']);
    expect(byId.get('module-existing')?.build).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(derivation.plans.filter((plan) => plan.build.includes('test-write'))).toHaveLength(1);
    expect(derivation.defaultBuild).toEqual(['implement', 'test-write', 'test-cycle', 'review-cycle']);
  });

  it('honors model review intent while retaining deterministic safety floors', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'module-light', reviewDepth: 'light', reviewRationale: 'Small localized change.' }),
        module({ moduleId: 'module-heavy', criterionIds: ['ac-002'], reviewDepth: 'heavy', reviewRationale: 'Security-sensitive contract.' }),
        module({ moduleId: 'candidate-residue', criterionIds: ['ac-003'], residue: true, reviewDepth: 'light', reviewRationale: 'Requested light review.' }),
      ],
      residueCandidates: [{ candidateId: 'candidate-residue', buildability: 'repair-only', criterionIds: ['ac-003'] }],
    }));

    const byId = new Map(derivation.plans.map((plan) => [plan.moduleId, plan]));
    expect(byId.get('module-light')?.reviewDepth).toBe('light');
    expect(byId.get('module-heavy')?.reviewDepth).toBe('heavy');
    expect(byId.get('candidate-residue')?.reviewDepth).toBe('heavy');
    expect(derivation.defaultReview.evaluatorStrictness).toBe('strict');
  });

  it('combines docs and test declarations with heavy risk without duplicating test-cycle', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [module({ moduleId: 'candidate-residue', residue: true, docsWork: 'author-new', testWork: 'author-new' })],
      residueCandidates: [{ candidateId: 'candidate-residue', buildability: 'repair-only', criterionIds: ['ac-001'] }],
    }));

    expect(derivation.plans[0].risk.score).toBeGreaterThanOrEqual(HEAVY_REVIEW_MIN_SCORE);
    expect(derivation.plans[0].build).toEqual([['implement', 'doc-author'], 'doc-sync', 'test-write', 'test-cycle', 'review-cycle']);
  });

  it('derives set-level defaults from the highest plan risk score', () => {
    const derivation = derivePlanPipelineSettings(inputs({
      modules: [
        module({ moduleId: 'candidate-residue', residue: true }),
        module({ moduleId: 'module-trivial', criterionIds: ['ac-200'] }),
      ],
      residueCandidates: [{ candidateId: 'candidate-residue', buildability: 'repair-only', criterionIds: ['ac-001'] }],
    }));

    expect(derivation.defaultBuild).toEqual(['implement', 'test-cycle', 'review-cycle']);
    expect(derivation.defaultReview.evaluatorStrictness).toBe('strict');
    expect(derivation.rationale).toContain('candidate-residue');
    expect(derivation.rationale).toContain('module-trivial');
  });

  it('is deterministic for identical inputs', () => {
    const riskInputs = inputs({
      modules: [module({ moduleId: 'module-b', dependsOnModuleIds: ['module-a'] }), module({ moduleId: 'module-a' })],
      atoms: [atom({ atomId: 'atom-a' })],
    });

    const first = derivePlanPipelineSettings(riskInputs);
    const second = derivePlanPipelineSettings(riskInputs);

    expect(second).toEqual(first);
    expect(first.plans.map((plan) => plan.moduleId)).toEqual(['module-a', 'module-b']);
  });
});
