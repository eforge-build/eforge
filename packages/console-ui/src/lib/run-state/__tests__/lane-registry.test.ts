/**
 * Tests for the lane registry: labels, ordering, and plan-NN fallback.
 */
import { describe, it, expect } from 'vitest';
import { laneLabel, laneOrder, LANE_REGISTRY } from '../lane-registry';

describe('laneLabel', () => {
  it('returns "Planning" for planning', () => {
    expect(laneLabel('planning')).toBe('Planning');
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

  it('returns "Plan NN" for plan-NN-* ids', () => {
    expect(laneLabel('plan-01')).toBe('Plan 01');
    expect(laneLabel('plan-01-some-feature')).toBe('Plan 01');
    expect(laneLabel('plan-12-multi-digit')).toBe('Plan 12');
  });

  it('returns the raw id for unknown lane keys', () => {
    expect(laneLabel('custom-lane')).toBe('custom-lane');
  });
});

describe('laneOrder', () => {
  it('returns 0 for planning', () => {
    expect(laneOrder('planning')).toBe(0);
  });

  it('returns 1 for plan-NN ids (plan tier)', () => {
    expect(laneOrder('plan-01')).toBe(1);
    expect(laneOrder('plan-99-feature')).toBe(1);
  });

  it('returns 2 for validation', () => {
    expect(laneOrder('validation')).toBe(2);
  });

  it('returns 3 for gap-close', () => {
    expect(laneOrder('gap-close')).toBe(3);
  });

  it('returns 4 for final-validation', () => {
    expect(laneOrder('final-validation')).toBe(4);
  });

  it('returns 1 (plan tier) for unknown lane keys', () => {
    expect(laneOrder('unknown')).toBe(1);
  });
});

describe('LANE_REGISTRY', () => {
  it('contains all known phase lanes in order', () => {
    const ids = LANE_REGISTRY.map((e) => e.id);
    expect(ids).toEqual(['planning', 'validation', 'gap-close', 'final-validation']);
  });

  it('all entries have kind "phase"', () => {
    for (const entry of LANE_REGISTRY) {
      expect(entry.kind).toBe('phase');
    }
  });

  it('orders are strictly increasing', () => {
    for (let i = 1; i < LANE_REGISTRY.length; i++) {
      expect(LANE_REGISTRY[i].order).toBeGreaterThan(LANE_REGISTRY[i - 1].order);
    }
  });
});
