import { describe, it, expect } from 'vitest';
import {
  handlePlanBuildDocSyncStart,
  handlePlanBuildReviewComplete,
  handlePlanBuildTestComplete,
  handlePlanBuildFilesChanged,
  handlePlanBuildReviewPerspectiveComplete,
  handlePlanMergeComplete,
} from '../handle-plan-build';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

const PLAN_ID = 'plan-01';

describe('handle-plan-build smoke', () => {
  it('plan:build:doc-sync:start advances stage to doc-sync', () => {
    const state = { ...initialRunState, planStatuses: { [PLAN_ID]: 'implement' as const } };
    const event = makeEvent('plan:build:doc-sync:start', { planId: PLAN_ID });
    const delta = handlePlanBuildDocSyncStart(event, state);
    expect(delta?.planStatuses?.[PLAN_ID]).toBe('doc-sync');
  });

  it('plan:build:review:complete advances to evaluate and extracts reviewIssues', () => {
    const issues = [{ severity: 'warning', category: 'style', file: 'a.ts', description: 'Missing docs' }];
    const event = makeEvent('plan:build:review:complete', { planId: PLAN_ID, issues });
    const delta = handlePlanBuildReviewComplete(event, initialRunState);
    expect(delta?.planStatuses?.[PLAN_ID]).toBe('evaluate');
    expect(delta?.reviewIssues?.[PLAN_ID]).toEqual(issues);
  });

  it('plan:build:files_changed updates fileChanges map', () => {
    const files = ['src/a.ts', 'src/b.ts'];
    const event = makeEvent('plan:build:files_changed', { planId: PLAN_ID, files });
    const delta = handlePlanBuildFilesChanged(event, initialRunState);
    expect(delta?.fileChanges?.get(PLAN_ID)).toEqual(files);
  });

  it('plan:build:test:complete extracts non-empty productionIssues into reviewIssues', () => {
    const productionIssues = [
      { severity: 'critical', category: 'production-bug', file: 'src/auth.ts', testFile: 'test/auth.test.ts', description: 'Token not validated' },
    ];
    const event = makeEvent('plan:build:test:complete', {
      planId: PLAN_ID,
      passed: 10,
      failed: 1,
      testBugsFixed: 0,
      productionIssues,
    });
    const delta = handlePlanBuildTestComplete(event, initialRunState);
    expect(delta?.reviewIssues?.[PLAN_ID]).toHaveLength(1);
    expect(delta?.reviewIssues?.[PLAN_ID]?.[0]).toMatchObject({ severity: 'critical', file: 'src/auth.ts' });
  });

  it('plan:build:review:parallel:perspective:complete stores issues keyed by (planId, perspective)', () => {
    const event = makeEvent('plan:build:review:parallel:perspective:complete', {
      planId: PLAN_ID,
      perspective: 'code',
      issues: [{ severity: 'critical', category: 'bug', file: 'a.ts', description: 'critical issue' }],
    });
    const delta = handlePlanBuildReviewPerspectiveComplete(event, initialRunState);
    expect(delta?.reviewIssuesByPerspective?.[PLAN_ID]?.['code']).toHaveLength(1);
  });

  it('plan:merge:complete captures commitSha in mergeCommits without touching planStatuses', () => {
    const event = makeEvent('plan:merge:complete', { planId: PLAN_ID, commitSha: 'abc123' });
    const delta = handlePlanMergeComplete(event, initialRunState);
    expect(delta?.mergeCommits?.[PLAN_ID]).toBe('abc123');
    expect(delta?.planStatuses).toBeUndefined();
  });
});
