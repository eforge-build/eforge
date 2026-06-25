import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { withCanonicalTransaction } from '../canonical/store.js';
import { recordLifecycleEvidence } from '../sqlite/index.js';
import { invokePlanAction, seedProjectionBacklog, seedRecommendations, withTempProjectionProject } from './sqlite-projection-fixtures.js';

describe('SQLite projection extension actions', () => {
  it('dispatches get-item with SQL user status, effective lifecycle, optional links, and bounded fields', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const compact = await invokePlanAction(cwd, 'get-item', { id: 'running', includeBody: false, includeSections: false, includeLifecycleRows: false });
      const withLinks = await invokePlanAction(cwd, 'get-item', { id: 'running', includeLifecycleRows: true });

      expect(compact.item).toMatchObject({ id: 'running', status: 'active', userStatus: 'active', lifecycleState: 'build', lane: 'in-progress' });
      expect(compact.item).not.toHaveProperty('body');
      expect(compact.item).not.toHaveProperty('sections');
      expect(compact.item).not.toHaveProperty('linkRows');
      expect(compact.item).not.toHaveProperty('failureEvidence');
      expect(withLinks.item).toMatchObject({ reasonCodes: ['running-build'] });
      expect(withLinks.item.linkRows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1' })]));
    });
  });

  it('dispatches get-epic with SQLite item counts and deterministic item pagination', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      const first = await invokePlanAction(cwd, 'get-epic', { id: 'epic-a', limit: 1, offset: 0, includeBody: false });
      const second = await invokePlanAction(cwd, 'get-epic', { id: 'epic-a', limit: 1, offset: 1, includeBody: false });

      expect(first.epic).toMatchObject({ id: 'epic-a', totalItems: 10, itemCount: 10, openItemCount: 8 });
      expect(first).toMatchObject({ totalItems: 10, itemCount: 10, limit: 1, offset: 0 });
      expect(first.items).toHaveLength(1);
      expect(second).toMatchObject({ totalItems: 10, itemCount: 10, limit: 1, offset: 1 });
      expect(second.items).toHaveLength(1);
      expect((second.items as Array<{ id: string }>)[0].id).not.toBe((first.items as Array<{ id: string }>)[0].id);
    });
  });

  it('dispatches compact/debug/markdown board actions from the same SQL lifecycle projection', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);

      for (const [id, state, reasonCode] of [['partial', 'partial', 'partial-plan'], ['merged', 'merged', 'merged-result']] as const) {
        captureCanonicalBacklogItem(cwd, { id, title: id, status: 'candidate', epicId: 'epic-a' });
        withCanonicalTransaction(cwd, (store) => recordLifecycleEvidence(store, { evidenceKey: `manual-${id}`, itemRef: id, itemId: id, lifecycleState: state as never, reasonCode, evidenceKind: 'event', status: state, isCurrent: true, isTerminal: true, occurredAt: '2027-01-01T00:07:00.000Z', links: { url: `https://example.test/${id}` } }));
      }

      const compact = await invokePlanAction(cwd, 'list-board-compact', { includeClosed: true, includeArchive: true, limit: 500 });
      const board = await invokePlanAction(cwd, 'list-board', { includeArchive: true });
      const markdown = await invokePlanAction(cwd, 'render-board-markdown', { includeArchive: true });

      expect(compact).toMatchObject({ limit: 100, pagination: expect.objectContaining({ limit: 100 }) });
      expect(compact.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'candidate', planEligible: true }),
        expect.objectContaining({ id: 'planned', planEligible: false, planEligibilityReasonCode: 'planned-session-plan', planEligibilityReasonMessage: expect.stringContaining('planned-session-plan'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'session-plan', session: 'plan-planned' })]) }),
        expect.objectContaining({ id: 'submitted', planEligible: false, planEligibilityReasonCode: 'submitted-session-plan', planEligibilityReasonMessage: expect.stringContaining('submitted-session-plan'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'queue-prd', id: 'submitted-prd' })]) }),
        expect.objectContaining({ id: 'queued', planEligible: false, planEligibilityReasonCode: 'queued-build', planEligibilityReasonMessage: expect.stringContaining('queued-build'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'queue-prd' })]), lane: 'in-progress', reasonCodes: ['queued-build'] }),
        expect.objectContaining({ id: 'running', planEligible: false, planEligibilityReasonCode: 'running-build', planEligibilityReasonMessage: expect.stringContaining('running-build'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1' })]) }),
        expect.objectContaining({ id: 'pr-open', planEligible: false, planEligibilityReasonCode: 'open-pr', planEligibilityReasonMessage: expect.stringContaining('open-pr'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'lifecycle-evidence', reasonCode: 'open-pr' })]) }),
        expect.objectContaining({ id: 'blocked', planEligible: false, planEligibilityReasonCode: 'unresolved-dependency', planEligibilityLinks: [] }),
        expect.objectContaining({ id: 'failed', planEligible: false, planEligibilityReasonCode: 'failed-result', planEligibilityReasonMessage: expect.stringContaining('failed-result'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'build-session' })]) }),
        expect.objectContaining({ id: 'partial', planEligible: false, planEligibilityReasonCode: 'partial-plan', planEligibilityReasonMessage: expect.stringContaining('partial-plan'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'lifecycle-evidence' })]) }),
        expect.objectContaining({ id: 'merged', planEligible: false, planEligibilityReasonCode: 'merged-result', planEligibilityReasonMessage: expect.stringContaining('merged-result'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'lifecycle-evidence' })]) }),
        expect.objectContaining({ id: 'shipped', planEligible: false, planEligibilityReasonCode: 'shipped-result', planEligibilityReasonMessage: expect.stringContaining('shipped-result'), planEligibilityLinks: expect.arrayContaining([expect.objectContaining({ kind: 'lifecycle-evidence' })]) }),
      ]));
      expect(board.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'queued', lane: 'in-progress', reasonCodes: ['queued-build'] })]));
      expect(markdown.markdown).toContain('queued-build');
    });
  });

  it('dispatches get-recommendations with SQL current model and actionability dispositions', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      seedRecommendations(cwd);

      const output = await invokePlanAction(cwd, 'get-recommendations');

      expect(output.recommendations).toMatchObject({ schemaVersion: 1 });
      expect(output.recommendationActionability).toMatchObject({ schemaVersion: 1 });
      expect(JSON.stringify(output.recommendationActionability)).toContain('planned-session-plan');
      expect(JSON.stringify(output.recommendationActionability)).toContain('suppressed');
      expect(JSON.stringify(output.recommendationActionability)).toContain('de-actioned');
    });
  });
});
