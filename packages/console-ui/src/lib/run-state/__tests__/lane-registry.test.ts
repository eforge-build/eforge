/**
 * Tests for the lane registry: labels, ordering, and plan-NN fallback.
 */
import { describe, it, expect } from 'vitest';
import { isFeatureBranchLane, isRegisteredPhaseLane, laneLabel, laneOrder, LANE_REGISTRY } from '../lane-registry';

describe('laneLabel', () => {
  it('returns "Planning" for planning', () => {
    expect(laneLabel('planning')).toBe('Planning');
  });

  it('returns "Direct Base Sync" for base-sync', () => {
    expect(laneLabel('base-sync')).toBe('Direct Base Sync');
  });

  it('returns "Validation" for validation', () => {
    expect(laneLabel('validation')).toBe('Validation');
  });

  it('returns "Gap Close" for gap-close', () => {
    expect(laneLabel('gap-close')).toBe('Gap Close');
  });

  it('returns "Final Validation" for final-validation', () => {
    expect(laneLabel('final-validation')).toBe('Final Validation');
  });

  it('returns readable labels for the compile phase lanes', () => {
    expect(laneLabel('satisfaction-gate')).toBe('Satisfaction Gate');
    expect(laneLabel('repository-exploration')).toBe('Repo Exploration');
  });

  it('returns "Plan NN" for plan-NN-* ids', () => {
    expect(laneLabel('plan-01')).toBe('Plan 01');
    expect(laneLabel('plan-01-some-feature')).toBe('Plan 01');
    expect(laneLabel('plan-12-multi-digit')).toBe('Plan 12');
  });

  it('returns feature branch labels for direct base-sync branch lane keys', () => {
    expect(laneLabel('eforge/feature-x')).toBe('Feature branch: eforge/feature-x');
  });

  it('returns the raw id for unknown lane keys', () => {
    expect(laneLabel('custom-lane')).toBe('custom-lane');
  });
});

describe('laneOrder', () => {
  it('returns 0 for the planning-tier lanes', () => {
    expect(laneOrder('planning')).toBe(0);
    expect(laneOrder('satisfaction-gate')).toBe(0);
    expect(laneOrder('repository-exploration')).toBe(0);
  });

  it('returns 1 for plan-NN ids (plan tier)', () => {
    expect(laneOrder('plan-01')).toBe(1);
    expect(laneOrder('plan-99-feature')).toBe(1);
  });

  it('returns 2 for base-sync', () => {
    expect(laneOrder('base-sync')).toBe(2);
  });

  it('returns 3 for validation', () => {
    expect(laneOrder('validation')).toBe(3);
  });

  it('returns 4 for gap-close', () => {
    expect(laneOrder('gap-close')).toBe(4);
  });

  it('returns 5 for final-validation', () => {
    expect(laneOrder('final-validation')).toBe(5);
  });

  it('returns 1 (plan tier) for unknown lane keys', () => {
    expect(laneOrder('unknown')).toBe(1);
  });
});

describe('isRegisteredPhaseLane', () => {
  it('returns true for registered phase lanes', () => {
    expect(isRegisteredPhaseLane('base-sync')).toBe(true);
    expect(isRegisteredPhaseLane('validation')).toBe(true);
    expect(isRegisteredPhaseLane('gap-close')).toBe(true);
    expect(isRegisteredPhaseLane('final-validation')).toBe(true);
  });

  it('returns false for plan and unknown lane ids', () => {
    expect(isRegisteredPhaseLane('plan-01')).toBe(false);
    expect(isRegisteredPhaseLane('acceptance-validation')).toBe(false);
  });
});

describe('isFeatureBranchLane', () => {
  it('recognizes direct base-sync feature branch lane keys', () => {
    expect(isFeatureBranchLane('eforge/feature-x')).toBe(true);
    expect(isFeatureBranchLane('plan-01')).toBe(false);
  });
});

describe('LANE_REGISTRY', () => {
  it('contains all known phase lanes in order', () => {
    const ids = LANE_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(['planning', 'satisfaction-gate', 'repository-exploration', 'base-sync', 'validation', 'gap-close', 'final-validation']);
  });

  it('all entries have kind "phase"', () => {
    for (const entry of LANE_REGISTRY) {
      expect(entry.kind).toBe('phase');
    }
  });

  it('orders are non-decreasing (compile-tier lanes share order 0)', () => {
    for (let i = 1; i < LANE_REGISTRY.length; i++) {
      expect(LANE_REGISTRY[i].order).toBeGreaterThanOrEqual(LANE_REGISTRY[i - 1].order);
    }
  });
});
