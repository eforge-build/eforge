import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import { RECOMMENDATION_STALE_REASON_LIMIT, buildRecommendationSourceProjection, computeRecommendationSourceFingerprint, markRecommendationsStaleForLifecycleUpdate } from '../recommendation-status.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-recommendation-status-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}

function statusPath(cwd: string): string {
  return join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'recommendations', 'status.json');
}

async function getRecommendations(cwd: string) {
  const result = await dispatchExtensionAction(registry(), {
    actionId: 'eforge-plan:get-recommendations',
    input: {},
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

async function seedBacklog(cwd: string) {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\nCoordinate recommendation work.\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', epic: 'epic-one', body: '# Item One\n\n## Claim\n\nFirst item.\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nSecond item.\n' });
}

function validModel() {
  return {
    ...createEmptyRecommendationModel(),
    activeWork: [{ itemId: 'item-one', rationale: 'Already active.' }],
    readyCandidates: [{ itemId: 'item-two', rationale: 'Ready now.' }],
    recommendedNextSequence: [{ itemId: 'item-two', rationale: 'Best next.' }],
    safeParallelizableGroups: [{ ref: 'group-one', itemIds: ['item-one', 'item-two'], epicIds: ['epic-one'], rationale: 'Independent enough.' }],
    blockedChains: [{ ref: 'chain-one', itemIds: ['item-two'], blockedBy: ['item-one'], rationale: 'Wait for active work.' }],
    rationaleAndAssumptions: ['Prefer known backlog ids.'],
  };
}

function expectStatus(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object));
  return value as Record<string, unknown>;
}

describe('recommendation freshness status', () => {
  it('returns missing status with private current and sidecar paths without writing the legacy file', async () => {
    await withTempProject(async (cwd) => {
      const output = await getRecommendations(cwd);
      const status = expectStatus(output.status);

      expect(output.recommendations).toBeNull();
      expect(status.state).toBe('missing');
      expect(status.reasons).toEqual([]);
      expect(String(output.path)).toBe(resolveRecommendationsPathForCwd(cwd));
      expect(String(output.path)).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}recommendations${sep}current.json`);
      expect(String(status.statusPath)).toBe(statusPath(cwd));
      expect(String(status.currentPath)).toBe(resolveRecommendationsPathForCwd(cwd));
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
      expect(existsSync(statusPath(cwd))).toBe(false);
    });
  });

  it('derives stale status for an existing model with no sidecar and does not use the legacy recommendation file', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeRecommendations(cwd, validModel());

      const output = await getRecommendations(cwd);
      const status = expectStatus(output.status);
      expect(output.recommendations).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-two' }] });
      expect(status.state).toBe('stale');
      expect(JSON.stringify(status.staleReasons)).toMatch(/sidecar|metadata|status/i);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });

  it('records a last-applied source fingerprint after a valid write and reports fresh while inputs match', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: validModel(),
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('success');

      const statusRaw = await readFile(statusPath(cwd), 'utf-8');
      const storedStatus = JSON.parse(statusRaw) as Record<string, unknown>;
      const fingerprint = JSON.stringify(storedStatus).match(/[a-f0-9]{64}/)?.[0];
      expect(fingerprint).toBeDefined();

      const output = await getRecommendations(cwd);
      const status = expectStatus(output.status);
      expect(status.state).toBe('fresh');
      expect(status.lastRefreshedBy).toBe('put-recommendations');
      expect(status.freshAt).toEqual(expect.any(String));
      expect(JSON.stringify(status.reasons ?? [])).toBe('[]');
      expect(JSON.stringify(status.staleReasons ?? [])).toBe('[]');
      expect(String(status.sourceFingerprint)).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });

  it('exposes stale lifecycle freshness even when no current recommendation model exists', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      await markRecommendationsStaleForLifecycleUpdate(cwd, {
        eventType: 'session:end',
        itemIds: ['item-one'],
        correlationKind: 'single',
        timestamp: '2026-01-01T00:00:00.000Z',
        summary: 'Recommendations are stale after single lifecycle update session:end for item-one.',
        refs: ['run-one', 'session-one'],
      });

      const output = await getRecommendations(cwd);
      const status = expectStatus(output.status);
      expect(output.recommendations).toBeNull();
      expect(status.state).toBe('stale');
      expect(status.staleSince).toEqual(expect.any(String));
      expect(status.reasons).toEqual([
        expect.objectContaining({
          eventType: 'session:end',
          itemIds: ['item-one'],
          correlationKind: 'single',
          timestamp: '2026-01-01T00:00:00.000Z',
          summary: 'Recommendations are stale after single lifecycle update session:end for item-one.',
          refs: ['run-one', 'session-one'],
        }),
      ]);
      expect(status.staleReasons).toEqual(status.reasons);
      expect(existsSync(resolveRecommendationsPathForCwd(cwd))).toBe(false);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });

  it('deduplicates repeated stale reasons and trims persisted history to the latest bounded window', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      for (let index = 0; index < RECOMMENDATION_STALE_REASON_LIMIT + 5; index += 1) {
        await markRecommendationsStaleForLifecycleUpdate(cwd, {
          eventType: `session:end:${index}`,
          itemIds: ['item-one'],
          correlationKind: 'single',
          timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
          summary: `Lifecycle update ${index}`,
        });
      }
      await markRecommendationsStaleForLifecycleUpdate(cwd, {
        eventType: 'session:end:24',
        itemIds: ['item-one'],
        correlationKind: 'single',
        timestamp: '2026-01-01T00:00:24.000Z',
        summary: 'Lifecycle update 24',
      });

      const storedStatus = JSON.parse(await readFile(statusPath(cwd), 'utf-8')) as { reasons?: Array<{ eventType?: string }> };
      expect(storedStatus.reasons).toHaveLength(RECOMMENDATION_STALE_REASON_LIMIT);
      expect(storedStatus.reasons?.[0]?.eventType).toBe('session:end:5');
      expect(storedStatus.reasons?.at(-1)?.eventType).toBe('session:end:24');
      expect(storedStatus.reasons?.filter((reason) => reason.eventType === 'session:end:24')).toHaveLength(1);

      const status = expectStatus((await getRecommendations(cwd)).status);
      expect(status.reasons).toHaveLength(RECOMMENDATION_STALE_REASON_LIMIT);
    });
  });

  it('ignores trace sidecars for closed backlog items in the open-backlog source fingerprint', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeBacklogItem(cwd, { id: 'item-closed', status: 'shipped', body: '# Closed\n\n## Claim\n\nDone.\n' });
      const before = await computeRecommendationSourceFingerprint(cwd);
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-closed'), buildRunIds: ['closed-run'], buildRuns: [{ runId: 'closed-run', sessionId: 'closed-session', status: 'running' }] });
      const projection = await buildRecommendationSourceProjection(cwd);
      expect((projection.traceSummaries as Array<{ itemId: string }>).map((summary) => summary.itemId)).not.toContain('item-closed');
      expect(await computeRecommendationSourceFingerprint(cwd)).toBe(before);
    });
  });

  it('reports source fingerprint drift as stale without rewriting current.json', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const put = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: validModel(),
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(put.kind).toBe('success');
      const before = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');

      await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nSecond item changed.\n' });

      const output = await getRecommendations(cwd);
      const status = expectStatus(output.status);
      expect(status.state).toBe('stale');
      expect(JSON.stringify(status.staleReasons)).toMatch(/fingerprint|drift|source/i);
      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(before);
    });
  });
});
