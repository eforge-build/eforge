import { describe, it, expect } from 'vitest';
import {
  handlePlanStatusChange,
  handlePlanErrorSet,
  handlePlanErrorClear,
  handleMergeWorktreeSet,
  handleMergeWorktreeClear,
} from '../handlers/handle-plan-lifecycle';
import { initialRunState } from '../reducer';
import type { EforgeEvent } from '../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

const PLAN_ID = 'plan-01';

describe('handle-plan-lifecycle', () => {
  // ---------------------------------------------------------------------------
  // handlePlanStatusChange — maps engine PlanStatus to UI PipelineStage
  // ---------------------------------------------------------------------------
  describe('handlePlanStatusChange', () => {
    it('running → implement', () => {
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'running' });
      const delta = handlePlanStatusChange(event, initialRunState);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('implement');
    });

    it('completed → complete', () => {
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'completed' });
      const delta = handlePlanStatusChange(event, initialRunState);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('complete');
    });

    it('failed → failed', () => {
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'failed' });
      const delta = handlePlanStatusChange(event, initialRunState);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('failed');
    });

    it('blocked → failed (blocked plans shown as failed in UI)', () => {
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'blocked' });
      const delta = handlePlanStatusChange(event, initialRunState);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('failed');
    });

    it('merged → complete', () => {
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'merged' });
      const delta = handlePlanStatusChange(event, initialRunState);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('complete');
    });

    it('pending → returns undefined (plan reset, do not advance stage)', () => {
      const state = { ...initialRunState, planStatuses: { [PLAN_ID]: 'implement' as const } };
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'pending' });
      const delta = handlePlanStatusChange(event, state);
      expect(delta).toBeUndefined();
    });

    it('preserves other plan statuses when updating one plan', () => {
      const OTHER = 'plan-02';
      const state = { ...initialRunState, planStatuses: { [OTHER]: 'review' as const } };
      const event = makeEvent('plan:status:change', { planId: PLAN_ID, status: 'running' });
      const delta = handlePlanStatusChange(event, state);
      expect(delta?.planStatuses?.[PLAN_ID]).toBe('implement');
      expect(delta?.planStatuses?.[OTHER]).toBe('review');
    });
  });

  // ---------------------------------------------------------------------------
  // No-op handlers — engine-side tracking, no UI state effect
  // ---------------------------------------------------------------------------
  describe('handlePlanErrorSet', () => {
    it('returns undefined (engine-side error tracking, no UI state change)', () => {
      const event = makeEvent('plan:error:set', { planId: PLAN_ID, error: 'compile error' });
      const delta = handlePlanErrorSet(event, initialRunState);
      expect(delta).toBeUndefined();
    });
  });

  describe('handlePlanErrorClear', () => {
    it('returns undefined (engine-side error tracking, no UI state change)', () => {
      const event = makeEvent('plan:error:clear', { planId: PLAN_ID });
      const delta = handlePlanErrorClear(event, initialRunState);
      expect(delta).toBeUndefined();
    });
  });

  describe('handleMergeWorktreeSet', () => {
    it('returns undefined (daemon-scoped concern, no per-session UI state effect)', () => {
      const event = makeEvent('merge:worktree:set', { path: '/tmp/worktree' });
      const delta = handleMergeWorktreeSet(event, initialRunState);
      expect(delta).toBeUndefined();
    });
  });

  describe('handleMergeWorktreeClear', () => {
    it('returns undefined (daemon-scoped concern, no per-session UI state effect)', () => {
      const event = makeEvent('merge:worktree:clear', {});
      const delta = handleMergeWorktreeClear(event, initialRunState);
      expect(delta).toBeUndefined();
    });
  });
});
