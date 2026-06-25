import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import type { ExtensionAgentTaskRecord } from '@eforge-build/client';
import { assertRecommendationSelectionActionable, buildRecommendationActionability } from '../recommendation-actionability.js';
import { writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel } from '../recommendations-store.js';
import { recordPlanningTaskWorkflowEntry, resolvePlanningTaskWorkflowIndexPath } from '../planning-task-workflow-store.js';
import { updateSessionPlanSourceMetadata } from '../session-plan-metadata.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';
import type { BacklogRecommendationModel } from '../schema.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-actionability-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function model(itemIds: string[] = ['item-one']): BacklogRecommendationModel {
  return {
    ...createEmptyRecommendationModel(),
    recommendedNextSequence: itemIds.map((itemId) => ({ itemId, ref: `next-${itemId}` })),
    safeParallelizableGroups: [{ ref: 'group-one', itemIds }],
  };
}

async function seedItems(cwd: string, itemIds: string[] = ['item-one']): Promise<void> {
  for (const itemId of itemIds) {
    await writeBacklogItem(cwd, { id: itemId, status: 'candidate', body: `# ${itemId}\n\n## Claim\n\nPlan ${itemId}.\n` });
  }
}

async function writeLegacyPlanningTaskWorkflowEntry(cwd: string, entry: Parameters<typeof recordPlanningTaskWorkflowEntry>[1]): Promise<void> {
  const path = resolvePlanningTaskWorkflowIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ schemaVersion: 1, entries: [entry] }), 'utf-8');
}

function runningTask(taskId: string): ExtensionAgentTaskRecord {
  return { taskId, kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' };
}

function expectNonActionable(actionability: unknown, expected: { reasonCode: string; lifecycleState: string; associatedLink: Record<string, unknown> }): void {
  expect(actionability).toMatchObject({ state: 'non-actionable', reasonCode: expected.reasonCode, lifecycleState: expected.lifecycleState });
  expect(actionability).toMatchObject({ reasonMessage: expect.stringMatching(/\S/) });
  expect(actionability).toMatchObject({ associatedLinks: expect.arrayContaining([expect.objectContaining(expected.associatedLink)]) });
}

describe('recommendation actionability projection', () => {
  it('suppresses an item covered by an editable session plan', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'planned-session', topic: 'Existing plan' });
      await updateSessionPlanSourceMetadata({ cwd, session: 'planned-session', sourceItemIds: ['item-one'], sourceEpicIds: [], promotedAt: '2026-01-01T00:00:00.000Z' });

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'planned-session-plan', lifecycleState: 'planned', associatedLink: { kind: 'session-plan', session: 'planned-session', status: 'planning' } });
    });
  });

  it('suppresses an item covered by a submitted session plan', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const planning = createSessionPlanningWorkflowAdapter();
      await planning.flat.create({ cwd, session: 'submitted-session', topic: 'Submitted plan' });
      await updateSessionPlanSourceMetadata({ cwd, session: 'submitted-session', sourceItemIds: ['item-one'], sourceEpicIds: [], promotedAt: '2026-01-01T00:00:00.000Z' });
      await planning.flat.setStatus({ cwd, session: 'submitted-session', status: 'submitted', metadata: { eforge_session: 'build-session' } });

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'submitted-session-plan', lifecycleState: 'planned', associatedLink: { kind: 'session-plan', session: 'submitted-session', status: 'submitted' } });
    });
  });

  it('suppresses an item covered by an active planning task', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-active', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Plan item one.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft'] });

      const output = await buildRecommendationActionability(cwd, model(), { async get(taskId) { return { task: runningTask(taskId) }; } });

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLink: { kind: 'planning-task', taskId: 'task-active', status: 'running' } });
    });
  });

  it('suppresses an item covered by a queued trace', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const trace = createTraceSidecar('item-one');
      trace.queuePrds.push({ prdId: 'prd-one', status: 'queued', path: '.eforge/prds/prd-one.md', queuedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'queued-trace', lifecycleState: 'queue', associatedLink: { kind: 'queue-prd', prdId: 'prd-one', status: 'queued' } });
    });
  });

  it('suppresses item IDs resolved from an active planning task recommendation selection', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-active', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Plan recommendation.', selection: { recommendationRef: 'next-item-one' }, requestedOutputSections: ['sessionPlanCreationDraft'] });

      const output = await buildRecommendationActionability(cwd, model(), { async get(taskId) { return { task: runningTask(taskId) }; } });

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLink: { kind: 'planning-task', taskId: 'task-active', status: 'running' } });
    });
  });

  it('suppresses item IDs resolved from an active planning task epic selection', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', epic: 'epic-one', status: 'candidate', body: '# item-one\n\n## Claim\n\nPlan item-one.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-active', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Plan epic.', selection: { epicId: 'epic-one' }, requestedOutputSections: ['sessionPlanCreationDraft'] });

      const output = await buildRecommendationActionability(cwd, model(), { async get(taskId) { return { task: runningTask(taskId) }; } });

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLink: { kind: 'planning-task', taskId: 'task-active', status: 'running' } });
    });
  });

  it('honors excluded parent tasks when only the legacy workflow index exists', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      await writeLegacyPlanningTaskWorkflowEntry(cwd, { taskId: 'task-parent', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Plan item one.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft'] });
      const agentTasks = { async get(taskId: string) { return { task: runningTask(taskId) }; } };

      await expect(assertRecommendationSelectionActionable(cwd, ['item-one'], agentTasks)).rejects.toMatchObject({
        details: [expect.objectContaining({ path: 'itemIds', suppressedItems: [expect.objectContaining({ itemId: 'item-one', reasonCode: 'active-planning-task' })] })],
      });
      await expect(assertRecommendationSelectionActionable(cwd, ['item-one'], agentTasks, 'itemIds', { excludePlanningTaskIds: ['task-parent'] })).resolves.toBeUndefined();
    });
  });

  it('uses trace evidence to reject direct duplicate planning selections', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const trace = createTraceSidecar('item-one');
      trace.queuePrds.push({ prdId: 'prd-one', status: 'queued', path: '.eforge/prds/prd-one.md', queuedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);

      await expect(assertRecommendationSelectionActionable(cwd, ['item-one'])).rejects.toMatchObject({
        details: [expect.objectContaining({
          path: 'itemIds',
          suppressedItems: [expect.objectContaining({ itemId: 'item-one', reasonCode: 'queued-trace' })],
        })],
      });
    });
  });

  it('suppresses an item covered by an active build trace', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const trace = createTraceSidecar('item-one');
      trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'building-trace', lifecycleState: 'build', associatedLink: { kind: 'build-run', runId: 'run-one', status: 'running' } });
    });
  });

  it('suppresses an item covered by an active build-session trace', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const trace = createTraceSidecar('item-one');
      trace.buildSessions.push({ sessionId: 'build-session-one', runId: 'run-one', status: 'running', startedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'active-build-session-trace', lifecycleState: 'build', associatedLink: { kind: 'build-session', sessionId: 'build-session-one', status: 'running' } });
    });
  });

  it('suppresses an item covered by an open PR trace', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd);
      const trace = createTraceSidecar('item-one');
      trace.landingResults.push({ featureBranch: 'feature/item-one', status: 'pr-open', prUrl: 'https://example.test/pr/1', landedAt: '2026-01-01T00:00:00.000Z' });
      await writeTraceSidecar(cwd, trace);

      const output = await buildRecommendationActionability(cwd, model());

      expectNonActionable(output.recommendedNextSequence[0]?.actionability, { reasonCode: 'open-pr-trace', lifecycleState: 'pr-open', associatedLink: { prUrl: 'https://example.test/pr/1' } });
    });
  });

  it('keeps mixed safe-parallel groups partially actionable for the actionable subset', async () => {
    await withTempProject(async (cwd) => {
      await seedItems(cwd, ['item-one', 'item-two']);
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'planned-session', topic: 'Existing plan' });
      await updateSessionPlanSourceMetadata({ cwd, session: 'planned-session', sourceItemIds: ['item-one'], sourceEpicIds: [], promotedAt: '2026-01-01T00:00:00.000Z' });

      const output = await buildRecommendationActionability(cwd, model(['item-one', 'item-two']));

      expect(output.safeParallelizableGroups[0]).toMatchObject({
        ref: 'group-one',
        state: 'partially-actionable',
        actionableItemIds: ['item-two'],
        suppressedItemIds: ['item-one'],
      });
      expect(output.safeParallelizableGroups[0]?.items.map((item) => [item.itemId, item.state])).toEqual([['item-one', 'non-actionable'], ['item-two', 'actionable']]);
      expectNonActionable(output.safeParallelizableGroups[0]?.items[0], { reasonCode: 'planned-session-plan', lifecycleState: 'planned', associatedLink: { kind: 'session-plan', session: 'planned-session', status: 'planning' } });
    });
  });
});
