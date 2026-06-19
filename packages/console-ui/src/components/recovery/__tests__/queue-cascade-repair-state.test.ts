import { describe, expect, it } from 'vitest';
import type { QueueRecoveryAnalyzeResponse } from '@eforge-build/client/browser';
import { deriveCascadeRepairState, deriveDependencyGroups, deriveSelectedRepairActions, removalKey } from '../queue-cascade-repair-state';

function analysis(): QueueRecoveryAnalyzeResponse {
  return {
    selectedPrdId: 'a',
    strategy: 'retry-and-reactivate-descendants',
    eligible: false,
    nodes: [],
    edges: [],
    operations: [],
    warnings: [],
    blockers: [{ code: 'dispatch-preflight-blocked', message: 'dispatch blocked' }],
    dependencyClassifications: [
      { targetPrdId: 'a', dependentPrdId: 'a', dependencyPrdId: 'blocking-1', status: 'blocking', reason: 'still active' },
      { targetPrdId: 'a', dependentPrdId: 'a', dependencyPrdId: 'done-1', status: 'satisfied', reason: 'completed' },
      { targetPrdId: 'b', dependentPrdId: 'b', dependencyPrdId: 'terminal-1', status: 'terminal', reason: 'failed upstream' },
      { targetPrdId: 'b', dependentPrdId: 'b', dependencyPrdId: 'stale-1', status: 'stale-historical', reason: 'missing artifact' },
    ],
    dispatchPreflight: {
      canApply: false,
      blockers: [{ code: 'dispatch-preflight-blocked', message: 'choose stack_parent' }],
      warnings: [],
      items: [{ targetPrdId: 'a', canDispatch: false, blockers: ['choose stack_parent'], warnings: [], stackingEnabled: true, meaningfulDependencyIds: ['done-1', 'done-2'], requiresStackParentChoice: true }],
    },
    availableRepairActions: [
      { kind: 'remove-depends-on', targetPrdId: 'a', dependencyIds: ['done-1'] },
      { kind: 'set-stack-parent', targetPrdId: 'a', selectedParentId: 'done-2' },
    ],
  };
}

describe('queue cascade repair state', () => {
  it('groups selected removals and emits selected repair actions', () => {
    const selected = deriveSelectedRepairActions(analysis(), { [removalKey('a', 'done-1')]: true }, { a: 'done-2' });
    expect(selected).toEqual([
      { kind: 'remove-depends-on', targetPrdId: 'a', dependencyIds: ['done-1'] },
      { kind: 'set-stack-parent', targetPrdId: 'a', selectedParentId: 'done-2' },
    ]);
  });

  it('requires stack_parent choices before apply', () => {
    const state = deriveCascadeRepairState(analysis(), {}, {});
    expect(state.unresolvedPreflightBlockers[0]).toContain('requires an explicit stack_parent selection');
    expect(state.requiresDependencyRemovalConfirmation).toBe(false);
    expect(state.applyDisabledReasons).toEqual(expect.arrayContaining([expect.stringContaining('stack_parent')]));
  });

  it('derives dependency groups across all client-owned classification statuses', () => {
    const groups = deriveDependencyGroups(analysis().dependencyClassifications);
    expect(groups).toEqual([
      { targetPrdId: 'a', rows: expect.arrayContaining([expect.objectContaining({ status: 'blocking' }), expect.objectContaining({ status: 'satisfied' })]) },
      { targetPrdId: 'b', rows: expect.arrayContaining([expect.objectContaining({ status: 'terminal' }), expect.objectContaining({ status: 'stale-historical' })]) },
    ]);
  });

  it('requires dependency-removal confirmation only after an operator selects a removal', () => {
    expect(deriveCascadeRepairState(analysis(), {}, { a: 'done-2' }).requiresDependencyRemovalConfirmation).toBe(false);
    expect(deriveCascadeRepairState(analysis(), { [removalKey('a', 'done-1')]: true }, { a: 'done-2' }).requiresDependencyRemovalConfirmation).toBe(true);
  });

  it('keeps unrepaired dispatch preflight blockers disabled while suppressing selected stack-parent repairs', () => {
    const base = analysis();
    const withPrdBlockers = {
      ...base,
      blockers: [
        { code: 'dispatch-preflight-blocked', prdId: 'a', message: 'choose stack_parent for a' },
        { code: 'dispatch-preflight-blocked', prdId: 'b', message: 'unrepairable dispatch blocker' },
      ],
    } satisfies QueueRecoveryAnalyzeResponse;

    const state = deriveCascadeRepairState(withPrdBlockers, {}, { a: 'done-2' });
    expect(state.applyDisabledReasons).not.toContain('choose stack_parent for a');
    expect(state.applyDisabledReasons).toContain('unrepairable dispatch blocker');
  });
});
