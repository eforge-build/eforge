import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { expect } from 'vitest';
import { captureCanonicalBacklogItem, upsertCanonicalEpic, updateCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { writeCanonicalRecommendations } from '../canonical/recommendation-records.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { openEforgePlanStore, type EforgePlanStore } from '../sqlite/index.js';
import { rebuildSearchIndex } from '../search/index.js';
import type { BacklogRecommendationModel } from '../schema.js';
import eforgePlanExtension from '../index.js';

export async function withTempSearchProject<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-search-'));
  try {
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export function withSearchStore<T>(cwd: string, fn: (store: EforgePlanStore) => T): T {
  const store = openEforgePlanStore(cwd);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export function seedSearchCorpus(cwd: string): void {
  upsertCanonicalEpic(cwd, {
    id: 'epic-orion',
    title: 'Orion Delivery Epic',
    status: 'candidate',
    tags: ['portfolio'],
    body: 'Epic overview for all-domain search.',
    sections: [{ sectionName: 'Summary', content: 'Coordinates the nebula integration roadmap.' }],
  });
  upsertCanonicalEpic(cwd, {
    id: 'epic-archive',
    title: 'Archived Epic',
    status: 'candidate',
  });

  captureCanonicalBacklogItem(cwd, {
    id: 'item-title',
    title: 'Orion gateway title hit',
    status: 'candidate',
    tags: ['frontend', 'launch'],
    epicId: 'epic-orion',
    updated: '2027-01-03T00:00:00.000Z',
    body: 'Implementation notes without the body-only keyword.',
    sections: [
      { sectionName: 'Claim', content: 'Users can launch the gateway safely.' },
      { sectionName: 'Evidence', content: 'Telemetry proves title search coverage.' },
      { sectionName: 'Acceptance Criteria', content: 'The UI renders compact summaries.' },
    ],
  });
  captureCanonicalBacklogItem(cwd, {
    id: 'item-body',
    title: 'Gateway body hit',
    status: 'planned',
    tags: ['backend'],
    epicId: 'epic-orion',
    dependsOn: ['item-title'],
    updated: '2027-01-02T00:00:00.000Z',
    body: 'A body-only orion reference lives here.',
    sections: [{ sectionName: 'Acceptance Criteria', content: 'The rare acceptance token zetaonly is indexed only with body search.' }],
  });
  captureCanonicalBacklogItem(cwd, {
    id: 'item-archive',
    title: 'Archive-only card',
    status: 'stale',
    tags: ['launch'],
    epicId: 'epic-archive',
    updated: '2027-01-01T00:00:00.000Z',
    body: 'Archived cards are hidden unless requested.',
  });

  syncSessionPlanArtifact(cwd, {
    session: 'session-orion',
    topic: 'Orion launch session',
    status: 'ready',
    path: join(cwd, '.eforge/session-plans/session-orion.md'),
    content: '---\nsession: session-orion\ntopic: Orion launch session\neforge_plan:\n  source_item_ids: [item-title]\n  source_epic_ids: [epic-orion]\n  source_recommendation_ref: rec-orion\n---\n# Secret markdown artifact body\n\nDO_NOT_INDEX_MARKDOWN_BODY\n',
    sourceItemIds: ['item-title'],
    sourceEpicIds: ['epic-orion'],
    sourceRecommendationRef: 'rec-orion',
    summaryText: 'Session summary mentions orion readiness.',
    readinessSummary: { status: 'ready', notes: ['orion-ready'] },
  });

  const model: BacklogRecommendationModel = {
    schemaVersion: 1,
    updatedAt: '2027-01-04T00:00:00.000Z',
    activeWork: [{ itemId: 'item-title', ref: 'active:item-title', rationale: 'orion work is already active' }],
    readyCandidates: [{ itemId: 'item-body', ref: 'ready:item-body', rationale: 'zetaonly acceptance needs follow-up' }],
    recommendedNextSequence: [{ itemId: 'item-title', ref: 'next:item-title', rationale: 'orion launch should go first' }],
    safeParallelizableGroups: [{ ref: 'rec-orion', title: 'Orion parallel lane', itemIds: ['item-title', 'item-body'], rationale: 'Parallelize orion validation.' }],
    blockedChains: [],
    rationaleAndAssumptions: ['orion recommendations are safe to search.'],
  };
  writeCanonicalRecommendations(cwd, model, {
    recommendedNextItemIds: ['item-title'],
    safeParallelizableGroups: model.safeParallelizableGroups,
    blockedChainCount: 0,
    rationaleAndAssumptions: model.rationaleAndAssumptions,
  });
}

export function seedAndRebuildSearchCorpus(cwd: string): void {
  seedSearchCorpus(cwd);
  withSearchStore(cwd, (store) => rebuildSearchIndex(store));
}

export function dirtyItemAfterRebuild(cwd: string): void {
  updateCanonicalBacklogItem(cwd, 'item-title', { title: 'Orion gateway title hit updated' });
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

export async function invokeSearchAction(cwd: string, actionId: 'search-items' | 'search-planning-records', input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 2000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}
