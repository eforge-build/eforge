import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { EforgeEvent, EventHookContext } from '@eforge-build/extension-sdk';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { findCanonicalNonterminalCoverage } from '../canonical/coverage.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { recordPlanningTaskWorkflowEntry } from '../canonical/planning-task-records.js';
import { writeCanonicalRecommendations } from '../canonical/recommendation-records.js';
import { synchronizeRemovedQueuePrdCoverage } from '../canonical/queue-removal-cleanup.js';
import { recordSessionPlanSubmitted, syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { withCanonicalTransaction } from '../canonical/store.js';
import { listBoardCompactProjection, buildRecommendationActionability } from '../projections/index.js';
import { searchItems } from '../search/actions.js';
import { createEmptyRecommendationModel } from '../recommendations-store.js';
import { getItemDetailProjection } from '../projections/items.js';
import { openEforgePlanStore, recordLifecycleEvidence, upsertBuildRun, upsertBuildSession } from '../sqlite/index.js';
import eforgePlanExtension from '../index.js';

function withTempProject<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), 'eforge-plan-queue-cleanup-'));
  return Promise.resolve(fn(cwd)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function rawDb(cwd: string): DatabaseSync {
  const store = openEforgePlanStore(cwd);
  const db = new DatabaseSync(store.path);
  store.close();
  return db;
}

async function dispatchRegisteredHook(cwd: string, pattern: string, event: EforgeEvent): Promise<void> {
  const { api, state } = createExtensionRecorder('eforge-plan', fileURLToPath(new URL('../index.ts', import.meta.url)));
  eforgePlanExtension(api as never);
  const hook = state.eventHooks.find((entry) => entry.value.pattern === pattern);
  expect(hook).toBeDefined();
  const ctx = {
    event,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    exec: { async run() { return { stdout: cwd, stderr: '', exitCode: 0 }; } },
  } satisfies EventHookContext;
  await (hook!.value.handler as unknown as (event: EforgeEvent, ctx: EventHookContext) => Promise<void>)(event, ctx);
}

function seedSubmittedQueue(cwd: string, input: { itemId: string; session: string; prdId: string; queueStatus?: string }): void {
  captureCanonicalBacklogItem(cwd, { id: input.itemId, title: input.itemId, status: 'candidate' });
  syncSessionPlanArtifact(cwd, { session: input.session, path: join(cwd, `.eforge/session-plans/${input.session}.md`), status: 'ready', sourceItemIds: [input.itemId] });
  withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: input.session, queuePrdId: input.prdId, path: `.eforge/session-plans/${input.session}.md`, itemIds: [input.itemId], status: input.queueStatus ?? 'queued', timestamp: '2026-01-01T00:00:00.000Z' }));
  recordCanonicalLifecycleEvent(cwd, { eventKey: `enqueue:${input.prdId}`, type: 'enqueue:complete', id: input.prdId, session: input.session, status: input.queueStatus ?? 'queued', timestamp: '2026-01-01T00:01:00.000Z' }, [input.itemId]);
}

async function expectEligibleEverywhere(cwd: string, itemId: string, removedPrdId: string): Promise<void> {
  expect(findCanonicalNonterminalCoverage(cwd, [itemId]).ok).toBe(true);
  const board = await listBoardCompactProjection(cwd, { includeClosed: true, includeArchive: true, limit: 100 });
  const boardItem = board.items.find((item: { id: string }) => item.id === itemId);
  expect(boardItem).toMatchObject({ lane: 'inbox', planEligible: true });
  expectNoActiveRemovedCoverage(boardItem, removedPrdId);
  const detailItem = (await getItemDetailProjection(cwd, { id: itemId })).item;
  expect(detailItem).toMatchObject({ planEligible: true });
  expect(detailItem.planEligibilityReasonCode).toBeUndefined();
  expectNoActiveRemovedCoverage(detailItem, removedPrdId);
  const searchItem = (await searchItems(cwd, { query: '', includeArchive: true, limit: 100 })).items.find((item) => item.id === itemId);
  expect(searchItem).toMatchObject({ planEligible: true });
  expectNoActiveRemovedCoverage(searchItem, removedPrdId);
  const model = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId, ref: `ready:${itemId}` }] };
  writeCanonicalRecommendations(cwd, model);
  const actionability = await buildRecommendationActionability(cwd, model);
  expect(actionability.readyCandidates[0]?.actionability).toMatchObject({ state: 'actionable', lifecycleState: 'none' });
  expectNoActiveRemovedCoverage(actionability.readyCandidates[0]?.actionability, removedPrdId);
}

function expectNoActiveRemovedCoverage(value: unknown, removedPrdId: string): void {
  const json = JSON.stringify(value ?? {});
  expect(json).not.toContain('"queued-build"');
  expect(json).not.toContain('"submitted-session-plan"');
  expect(json).not.toContain(`"${removedPrdId}"`);
}

describe('queue removal coverage cleanup', () => {
  it.each(['failed', 'pending', 'waiting', 'skipped'])('marks removed %s queue PRDs terminal and clears stale public coverage', async (queueStatus) => {
    await withTempProject(async (cwd) => {
      const itemId = `removed-${queueStatus}`;
      seedSubmittedQueue(cwd, { itemId, session: `session-${queueStatus}`, prdId: `prd-${queueStatus}`, queueStatus });

      const summary = await synchronizeRemovedQueuePrdCoverage(cwd, `prd-${queueStatus}`, { timestamp: '2026-01-01T00:02:00.000Z' });

      expect(summary).toMatchObject({ prdId: `prd-${queueStatus}`, affectedItemRefs: [itemId], updatedQueuePrdRows: 1, supersededLifecycleRows: 2 });
      const db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT status FROM queue_prds WHERE prd_id = ?').get(`prd-${queueStatus}`)).toMatchObject({ status: 'removed' });
        expect(db.prepare('SELECT status FROM session_plans WHERE session = ?').get(`session-${queueStatus}`)).toMatchObject({ status: 'removed' });
        expect((db.prepare("SELECT count(*) AS count FROM lifecycle_evidence WHERE queue_prd_id = ? AND is_current = 0 AND is_terminal = 1 AND status = 'removed'").get(`prd-${queueStatus}`) as { count: number }).count).toBeGreaterThanOrEqual(2);
      } finally { db.close(); }
      await expectEligibleEverywhere(cwd, itemId, `prd-${queueStatus}`);
    });
  });

  it('clears removed queue coverage when only abandoned plans and applied tasks remain', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'terminal-only-item', session: 'terminal-removed-session', prdId: 'terminal-removed-prd', queueStatus: 'waiting' });
      syncSessionPlanArtifact(cwd, { session: 'terminal-abandoned-session', path: join(cwd, '.eforge/session-plans/terminal-abandoned-session.md'), status: 'abandoned', sourceItemIds: ['terminal-only-item'] });
      recordPlanningTaskWorkflowEntry(cwd, { taskId: 'terminal-applied-task', status: 'applied', itemRefs: ['terminal-only-item'] });
      recordPlanningTaskWorkflowEntry(cwd, { taskId: 'terminal-dismissed-task', status: 'dismissed', itemRefs: ['terminal-only-item'] });

      await synchronizeRemovedQueuePrdCoverage(cwd, 'terminal-removed-prd', { timestamp: '2026-01-01T00:02:00.000Z' });

      await expectEligibleEverywhere(cwd, 'terminal-only-item', 'terminal-removed-prd');
    });
  });

  it('does not treat PRD id substrings in structured links as removed queue evidence', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'removed-substring-base', session: 'substring-base-session', prdId: 'prd-1' });
      captureCanonicalBacklogItem(cwd, { id: 'substring-live-item', title: 'substring-live-item', status: 'candidate' });
      syncSessionPlanArtifact(cwd, { session: 'substring-live-session', path: join(cwd, '.eforge/session-plans/substring-live-session.md'), status: 'ready', sourceItemIds: ['substring-live-item'] });
      withCanonicalTransaction(cwd, (store) => {
        recordSessionPlanSubmitted(store, { session: 'substring-live-session', queuePrdId: 'prd-10', itemIds: ['substring-live-item'], status: 'waiting', timestamp: '2026-01-01T00:01:00.000Z' });
        recordLifecycleEvidence(store, {
        evidenceKey: 'substring-live-prd-10',
        itemRef: 'substring-live-item',
        itemId: 'substring-live-item',
        session: 'substring-live-session',
        lifecycleState: 'queued',
        reasonCode: 'queued-build',
        evidenceKind: 'event',
        status: 'waiting',
        isCurrent: true,
        isTerminal: false,
        occurredAt: '2026-01-01T00:01:30.000Z',
        links: { kind: 'queue-prd', queuePrdId: 'prd-10' },
      });
      });

      await synchronizeRemovedQueuePrdCoverage(cwd, 'prd-1', { timestamp: '2026-01-01T00:02:00.000Z' });

      const db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT is_current, status FROM lifecycle_evidence WHERE evidence_key = ?').get('substring-live-prd-10')).toMatchObject({ is_current: 1, status: 'waiting' });
      } finally { db.close(); }
    });
  });

  it('marks affected backlog and recommendation projections stale', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'dirty-item', session: 'dirty-session', prdId: 'dirty-prd' });
      writeCanonicalRecommendations(cwd, { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'dirty-item', ref: 'ready:dirty' }] });

      await synchronizeRemovedQueuePrdCoverage(cwd, 'dirty-prd', { timestamp: '2026-01-01T00:02:00.000Z' });

      const db = rawDb(cwd);
      try {
        expect((db.prepare("SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = 'backlog_item' AND document_id = 'dirty-item'").get() as { count: number }).count).toBe(1);
        expect(db.prepare('SELECT json_extract(freshness_json, ?) AS status FROM recommendation_runs WHERE is_current = 1').get('$.status')).toMatchObject({ status: 'stale' });
      } finally { db.close(); }
    });
  });

  it('defers cleanup until the queue removal hook is dispatched', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'hook-item', session: 'hook-session', prdId: 'hook-prd', queueStatus: 'waiting' });

      expect((await getItemDetailProjection(cwd, { id: 'hook-item' })).item).toMatchObject({ planEligible: false });
      let db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT status FROM queue_prds WHERE prd_id = ?').get('hook-prd')).toMatchObject({ status: 'waiting' });
      } finally { db.close(); }

      await dispatchRegisteredHook(cwd, 'queue:prd:removed', { type: 'queue:prd:removed', prdId: 'hook-prd', timestamp: '2026-01-01T00:02:00.000Z' } as EforgeEvent);

      db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT status FROM queue_prds WHERE prd_id = ?').get('hook-prd')).toMatchObject({ status: 'removed' });
      } finally { db.close(); }
      await expectEligibleEverywhere(cwd, 'hook-item', 'hook-prd');
    });
  });

  it('cleans stale nonterminal lifecycle evidence when durable build rows are terminal', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'stale-build-item', session: 'stale-build-session', prdId: 'stale-build-prd', queueStatus: 'waiting' });
      withCanonicalTransaction(cwd, (store) => {
        upsertBuildRun(store, { runId: 'stale-terminal-run', session: 'stale-build-session', queuePrdId: 'stale-build-prd', status: 'completed', startedAt: '2026-01-01T00:01:00.000Z', finishedAt: '2026-01-01T00:01:30.000Z' });
        recordLifecycleEvidence(store, {
          evidenceKey: 'stale-terminal-build-evidence',
          itemRef: 'stale-build-item',
          itemId: 'stale-build-item',
          session: 'stale-build-session',
          queuePrdId: 'stale-build-prd',
          runId: 'stale-terminal-run',
          lifecycleState: 'build',
          reasonCode: 'running-build',
          evidenceKind: 'event',
          status: 'running',
          isCurrent: true,
          isTerminal: false,
          occurredAt: '2026-01-01T00:01:20.000Z',
        });
      });

      await synchronizeRemovedQueuePrdCoverage(cwd, 'stale-build-prd', { timestamp: '2026-01-01T00:02:00.000Z' });

      const db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT status FROM session_plans WHERE session = ?').get('stale-build-session')).toMatchObject({ status: 'removed' });
        expect(db.prepare('SELECT is_current, is_terminal, status FROM lifecycle_evidence WHERE evidence_key = ?').get('stale-terminal-build-evidence')).toMatchObject({ is_current: 0, is_terminal: 1, status: 'removed' });
      } finally { db.close(); }
      await expectEligibleEverywhere(cwd, 'stale-build-item', 'stale-build-prd');
    });
  });

  it.each(['pending', 'running'])('keeps live %s queue blockers active', async (queueStatus) => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: `live-${queueStatus}`, session: `live-${queueStatus}-session`, prdId: `live-${queueStatus}-prd`, queueStatus });

      const item = (await getItemDetailProjection(cwd, { id: `live-${queueStatus}` })).item;
      expect(item).toMatchObject({ planEligible: false });
      expect(item.planEligibilityLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'queue-prd', id: `live-${queueStatus}-prd` })]));
    });
  });

  it('preserves independent live queue, active build, and open PR blockers', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'live-queue-item', session: 'removed-session', prdId: 'removed-prd' });
      syncSessionPlanArtifact(cwd, { session: 'live-session', path: join(cwd, '.eforge/session-plans/live-session.md'), status: 'ready', sourceItemIds: ['live-queue-item'] });
      withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 'live-session', queuePrdId: 'live-prd', itemIds: ['live-queue-item'], status: 'pending', timestamp: '2026-01-01T00:01:30.000Z' }));

      seedSubmittedQueue(cwd, { itemId: 'active-build-item', session: 'build-session-plan', prdId: 'build-prd' });
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'build:start', type: 'session:start', session: 'build-session-plan', prdId: 'build-prd', sessionId: 'build-session-live', runId: 'run-live', timestamp: '2026-01-01T00:01:30.000Z' }, ['active-build-item']);

      seedSubmittedQueue(cwd, { itemId: 'open-pr-item', session: 'pr-session-plan', prdId: 'pr-prd' });
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'landing:pr', type: 'landing:complete', action: 'pr', prdId: 'pr-prd', prUrl: 'https://example.test/pr/1', timestamp: '2026-01-01T00:01:30.000Z' }, ['open-pr-item']);

      await synchronizeRemovedQueuePrdCoverage(cwd, 'removed-prd', { timestamp: '2026-01-01T00:02:00.000Z' });
      await synchronizeRemovedQueuePrdCoverage(cwd, 'build-prd', { timestamp: '2026-01-01T00:02:00.000Z' });
      await synchronizeRemovedQueuePrdCoverage(cwd, 'pr-prd', { timestamp: '2026-01-01T00:02:00.000Z' });

      expect(findCanonicalNonterminalCoverage(cwd, ['live-queue-item']).ok).toBe(false);
      const liveQueueItem = (await getItemDetailProjection(cwd, { id: 'live-queue-item' })).item;
      expect(liveQueueItem).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'submitted-session-plan' });
      expect(liveQueueItem.planEligibilityLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'queue-prd', id: 'live-prd' })]));
      expect(JSON.stringify(liveQueueItem.planEligibilityLinks)).not.toContain('removed-prd');
      const db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT is_current, is_terminal, status FROM lifecycle_evidence WHERE queue_prd_id = ? ORDER BY evidence_key LIMIT 1').get('removed-prd')).toMatchObject({ is_current: 0, is_terminal: 1, status: 'removed' });
        expect(db.prepare('SELECT is_current FROM lifecycle_evidence WHERE queue_prd_id = ? ORDER BY evidence_key LIMIT 1').get('live-prd')).toMatchObject({ is_current: 1 });
        expect(db.prepare('SELECT status FROM queue_prds WHERE prd_id = ?').get('live-prd')).toMatchObject({ status: 'pending' });
      } finally { db.close(); }
      expect((await getItemDetailProjection(cwd, { id: 'active-build-item' })).item).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'running-build' });
      expect((await getItemDetailProjection(cwd, { id: 'open-pr-item' })).item).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'open-pr' });
    });
  });

  it('preserves submitted handoff blockers with live queue and live build links', async () => {
    await withTempProject(async (cwd) => {
      seedSubmittedQueue(cwd, { itemId: 'handoff-live-queue', session: 'handoff-live-queue-session', prdId: 'handoff-removed-queue-prd', queueStatus: 'waiting' });
      withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 'handoff-live-queue-session', queuePrdId: 'handoff-live-prd', itemIds: ['handoff-live-queue'], status: 'waiting', timestamp: '2026-01-01T00:01:30.000Z' }));
      seedSubmittedQueue(cwd, { itemId: 'handoff-live-build', session: 'handoff-live-build-session', prdId: 'handoff-removed-build-prd' });
      withCanonicalTransaction(cwd, (store) => {
        upsertBuildRun(store, { runId: 'handoff-run', session: 'handoff-live-build-session', status: 'running', startedAt: '2026-01-01T00:01:00.000Z' });
        upsertBuildSession(store, { buildSessionId: 'handoff-build-session', session: 'handoff-live-build-session', status: 'running', startedAt: '2026-01-01T00:01:00.000Z' });
        recordLifecycleEvidence(store, {
          evidenceKey: 'handoff-live-build-linked-evidence',
          itemRef: 'handoff-live-build',
          itemId: 'handoff-live-build',
          session: 'handoff-live-build-session',
          queuePrdId: 'handoff-removed-build-prd',
          lifecycleState: 'submitted',
          reasonCode: 'submitted-session-plan',
          evidenceKind: 'event',
          status: 'submitted',
          isCurrent: true,
          isTerminal: false,
          occurredAt: '2026-01-01T00:01:30.000Z',
          links: [{ kind: 'queue-prd', queuePrdId: 'handoff-removed-build-prd' }, { kind: 'build-run', runId: 'handoff-run' }],
        });
      });

      await synchronizeRemovedQueuePrdCoverage(cwd, 'handoff-removed-queue-prd', { timestamp: '2026-01-01T00:02:00.000Z' });
      await synchronizeRemovedQueuePrdCoverage(cwd, 'handoff-removed-build-prd', { timestamp: '2026-01-01T00:02:00.000Z' });

      const liveQueueItem = (await getItemDetailProjection(cwd, { id: 'handoff-live-queue' })).item;
      expect(liveQueueItem).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'submitted-session-plan' });
      expect(liveQueueItem.planEligibilityLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'queue-prd', id: 'handoff-live-prd' })]));
      const liveBuildItem = (await getItemDetailProjection(cwd, { id: 'handoff-live-build' })).item;
      expect(liveBuildItem).toMatchObject({ planEligible: false, planEligibilityReasonCode: 'submitted-session-plan' });
      expect(liveBuildItem.planEligibilityLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', id: 'handoff-run' })]));
      const db = rawDb(cwd);
      try {
        expect(db.prepare('SELECT is_current, status FROM lifecycle_evidence WHERE evidence_key = ?').get('handoff-live-build-linked-evidence')).toMatchObject({ is_current: 1, status: 'submitted' });
      } finally { db.close(); }
    });
  });
});
