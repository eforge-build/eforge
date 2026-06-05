import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBacklogItem, writeBacklogItem } from '../markdown-store.js';
import { applyLifecycleEvent, correlateLifecycleEvent, decideLifecycleUpdate } from '../lifecycle.js';
import { createTraceSidecar, readTraceSidecar, writeTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-lifecycle-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function trace(itemId: string) {
  const value = createTraceSidecar(itemId);
  value.promotedSessionPlans.push({ session: 'session-one', path: '/project/.eforge/session-plans/session-one.md', status: 'ready' });
  value.queuePrds.push({ prdId: 'prd-one', status: 'queued' });
  value.buildRuns.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'running' });
  value.buildRunIds = ['run-one'];
  value.buildSessions.push({ sessionId: 'session-id-one', runId: 'run-two', status: 'running' });
  value.buildSessionIds = ['build-session-one', 'session-id-one'];
  value.landingResults.push({ featureBranch: 'feature/one', commitSha: 'commit-one', status: 'started' });
  return value;
}

describe('eforge-plan lifecycle correlation', () => {
  it('correlates by promoted paths, input ids, PRD ids, sessionId, runId, and landing evidence', () => {
    const traces = [trace('item-one')];
    for (const event of [
      { type: 'enqueue:start', source: '/project/.eforge/session-plans/session-one.md' },
      { type: 'enqueue:start', source: 'eforge://input/eforge-plan/item-one' },
      { type: 'enqueue:complete', id: 'prd-one', filePath: '.eforge/queue/prd-one.md' },
      { type: 'queue:prd:complete', prdId: 'prd-one', status: 'completed' },
      { type: 'session:start', sessionId: 'session-id-one' },
      { type: 'session:end', runId: 'run-one', sessionId: 'build-session-one' },
      { type: 'landing:complete', action: 'merge', featureBranch: 'feature/one', commitSha: 'commit-one' },
    ]) {
      expect(correlateLifecycleEvent(event, traces)).toMatchObject({ kind: 'single', itemId: 'item-one' });
    }
  });

  it('records failed and skipped queue results without stale, superseded, or shipped status decisions', () => {
    const traces = [trace('item-one')];
    for (const status of ['failed', 'skipped']) {
      const decision = decideLifecycleUpdate({ type: 'queue:prd:complete', prdId: 'prd-one', status }, traces);
      expect(decision.trace).toMatchObject({ kind: 'queue-prd', prdId: 'prd-one', status });
      expect(decision.status).toBeUndefined();
    }
  });

  it('records PR-open landing evidence and leaves the item active', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'active', tags: [], depends_on: [], body: '# Item\n' });
      await writeTraceSidecar(cwd, trace('item-one'));
      await applyLifecycleEvent(cwd, { type: 'landing:complete', action: 'pr', featureBranch: 'feature/one', baseBranch: 'main', prUrl: 'https://example.com/pr/1', timestamp: '2026-01-01T00:00:00.000Z' });

      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('active');
      expect((await readTraceSidecar(cwd, 'item-one'))?.landingResults.find((entry) => entry.featureBranch === 'feature/one')?.status).toBe('pr-open');
    });
  });

  it('marks items shipped for confirmed local merge and auto-merge completion', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'active', tags: [], depends_on: [], body: '# Item\n' });
      await writeTraceSidecar(cwd, trace('item-one'));
      await applyLifecycleEvent(cwd, { type: 'landing:complete', action: 'merge', featureBranch: 'feature/one', baseBranch: 'main', commitSha: 'commit-one', timestamp: '2026-01-01T00:00:00.000Z' });
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('shipped');

      await writeBacklogItem(cwd, { id: 'item-two', status: 'active', tags: [], depends_on: [], body: '# Item Two\n' });
      const second = createTraceSidecar('item-two');
      second.landingResults.push({ featureBranch: 'feature/two', status: 'pr-open' });
      await writeTraceSidecar(cwd, second);
      await applyLifecycleEvent(cwd, { type: 'landing:auto-merge:complete', featureBranch: 'feature/two', prUrl: 'https://example.com/pr/2', timestamp: '2026-01-01T00:00:00.000Z' });
      expect((await readBacklogItem(cwd, 'item-two'))?.status).toBe('shipped');
    });
  });

  it('does not mutate backlog status when correlation is ambiguous', () => {
    const traces = [trace('one'), trace('two')];
    const decision = decideLifecycleUpdate({ type: 'queue:prd:complete', prdId: 'prd-one', status: 'completed' }, traces);
    expect(decision.correlation.kind).toBe('ambiguous');
    expect(decision.status).toBeUndefined();
    expect(decision.trace).toBeUndefined();
  });
});
