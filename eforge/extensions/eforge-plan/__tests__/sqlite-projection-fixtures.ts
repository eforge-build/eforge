import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { expect } from 'vitest';
import { captureCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { writeCanonicalRecommendations } from '../canonical/recommendation-records.js';
import { recordSessionPlanSubmitted, syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { withCanonicalTransaction } from '../canonical/store.js';
import type { BacklogRecommendationModel } from '../schema.js';
import eforgePlanExtension from '../index.js';

export function withTempProjectionProject<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), 'eforge-plan-projections-'));
  return Promise.resolve(fn(cwd)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

export function seedProjectionBacklog(cwd: string): void {
  upsertCanonicalEpic(cwd, { id: 'epic-a', title: 'Epic A', status: 'candidate', body: 'Epic body.' });
  captureCanonicalBacklogItem(cwd, { id: 'candidate', title: 'Candidate', status: 'candidate', epicId: 'epic-a', body: 'Candidate body.' });
  captureCanonicalBacklogItem(cwd, { id: 'planned', title: 'Planned', status: 'candidate', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'submitted', title: 'Submitted', status: 'planned', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'queued', title: 'Queued', status: 'candidate', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'running', title: 'Running', status: 'active', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'pr-open', title: 'PR Open', status: 'candidate', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'failed', title: 'Failed', status: 'candidate', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'shipped', title: 'Shipped', status: 'candidate', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'archived', title: 'Archived', status: 'stale', epicId: 'epic-a' });
  captureCanonicalBacklogItem(cwd, { id: 'blocked', title: 'Blocked', status: 'candidate', epicId: 'epic-a', dependsOn: ['missing-dep'] });

  writeSessionPlan(cwd, 'plan-planned', ['planned'], { status: 'ready', provenance: 'selected-item' });
  writeSessionPlan(cwd, 'plan-submitted', ['submitted'], { status: 'submitted', provenance: 'selected-item' });
  writeSessionPlan(cwd, 'plan-running', ['running'], { status: 'ready', provenance: 'selected-item' });
  writeSessionPlan(cwd, 'plan-failed', ['failed'], { status: 'ready', provenance: 'selected-item' });
  withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 'plan-submitted', queuePrdId: 'submitted-prd', path: '.eforge/session-plans/plan-submitted.md', itemIds: ['submitted'], timestamp: '2027-01-01T00:01:00.000Z' }));
  recordCanonicalLifecycleEvent(cwd, { eventKey: 'queued-1', type: 'enqueue:complete', id: 'queue-1', session: 'plan-submitted', timestamp: '2027-01-01T00:02:00.000Z' }, ['queued']);
  recordCanonicalLifecycleEvent(cwd, { eventKey: 'running-1', type: 'session:start', session: 'plan-running', sessionId: 'build-session-1', runId: 'run-1', timestamp: '2027-01-01T00:03:00.000Z' }, ['running']);
  recordCanonicalLifecycleEvent(cwd, { eventKey: 'pr-open-1', type: 'landing:complete', action: 'pr', prUrl: 'https://example.test/pr/1', timestamp: '2027-01-01T00:04:00.000Z' }, ['pr-open']);
  recordCanonicalLifecycleEvent(cwd, { eventKey: 'failed-1', type: 'session:end', session: 'plan-failed', sessionId: 'build-session-failed', status: 'failed', timestamp: '2027-01-01T00:05:00.000Z' }, ['failed']);
  recordCanonicalLifecycleEvent(cwd, { eventKey: 'shipped-1', type: 'landing:complete', action: 'merge', commitSha: 'abc123', timestamp: '2027-01-01T00:06:00.000Z' }, ['shipped']);
}

export function writeSessionPlan(cwd: string, session: string, itemIds: string[], options: { status?: string; provenance?: string; recommendationRef?: string } = {}): string {
  const dir = join(cwd, '.eforge/session-plans');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${session}.md`);
  const content = `---\nsession: ${session}\ntopic: ${session}\nstatus: ${options.status ?? 'ready'}\neforge_plan:\n  source_item_ids: [${itemIds.join(', ')}]\n${options.recommendationRef ? `  source_recommendation_ref: ${options.recommendationRef}\n` : ''}---\n# ${session}\n\nMarkdown body for ${session}.\n`;
  writeFileSync(path, content);
  syncSessionPlanArtifact(cwd, { session, path, content, status: options.status, sourceItemIds: itemIds, provenance: options.provenance ?? 'selected-item', sourceRecommendationRef: options.recommendationRef });
  return path;
}

export function seedRecommendations(cwd: string): BacklogRecommendationModel {
  const model: BacklogRecommendationModel = {
    schemaVersion: 1,
    updatedAt: '2026-01-01T00:10:00.000Z',
    activeWork: [{ itemId: 'running', ref: 'active:running' }],
    readyCandidates: [{ itemId: 'planned', ref: 'ready:planned' }, { itemId: 'candidate', ref: 'ready:candidate' }],
    recommendedNextSequence: [{ itemId: 'shipped', ref: 'next:shipped' }, { itemId: 'failed', ref: 'next:failed' }],
    safeParallelizableGroups: [{ ref: 'group-1', title: 'Mixed group', itemIds: ['running', 'candidate'] }],
    blockedChains: [],
    rationaleAndAssumptions: ['Seeded for projection tests.'],
  };
  writeCanonicalRecommendations(cwd, model, { recommendedNextItemIds: ['shipped', 'failed'], safeParallelizableGroups: model.safeParallelizableGroups, blockedChainCount: 0, rationaleAndAssumptions: model.rationaleAndAssumptions });
  return model;
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

export async function invokePlanAction(cwd: string, actionId: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 2000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}
