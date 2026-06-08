import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-recommendation-status-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
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
      expect(JSON.stringify(status.staleReasons ?? [])).toBe('[]');
      expect(String(status.sourceFingerprint)).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
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
