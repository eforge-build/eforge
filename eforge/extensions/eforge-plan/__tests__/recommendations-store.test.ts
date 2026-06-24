import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import eforgePlanExtension from '../index.js';
import { writeBacklogItem } from '../markdown-store.js';
import {
  createEmptyRecommendationModel,
  readRecommendations,
  resolveRecommendationsPath,
  writeRecommendations,
} from '../recommendations-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-recommendations-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  return { ...state, extensions: [], candidates: [] };
}

async function seedReferencedBacklog(cwd: string) {
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n' });
  await writeBacklogItem(cwd, { id: 'item-three', status: 'candidate', body: '# Item Three\n' });
}

function recommendationModel() {
  return {
    ...createEmptyRecommendationModel(),
    updatedAt: '2026-01-01T00:00:00.000Z',
    recommendedNextSequence: [{ itemId: 'item-one', rationale: 'Highest leverage.', confidence: 'high' }],
    safeParallelizableGroups: [{ ref: 'group-one', title: 'Parallel work', itemIds: ['item-one', 'item-two'], recommendedProfile: 'errand' as const }],
    blockedChains: [{ itemIds: ['item-three'], blockedBy: ['item-two'] }],
    rationaleAndAssumptions: ['Assume dependencies stay stable.'],
  };
}

describe('eforge-plan recommendation storage', () => {
  it('resolves the private project-local recommendation path', async () => {
    await withTempProject(async (cwd) => {
      const path = resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
      expect(path.endsWith(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}recommendations${sep}current.json`)).toBe(true);
      expect(path).not.toContain(`${sep}.backlog${sep}recommendations.json`);
    });
  });

  it('writes and reads valid recommendation models', async () => {
    await withTempProject(async (cwd) => {
      await seedReferencedBacklog(cwd);
      const written = await writeRecommendations(cwd, recommendationModel());
      expect(written.recommendedNextSequence.map((entry) => entry.itemId)).toEqual(['item-one']);
      const path = resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
      expect(existsSync(path)).toBe(true);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
      expect(JSON.parse(await readFile(path, 'utf-8'))).toMatchObject({ schemaVersion: 1 });
      expect(await readRecommendations(cwd)).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-one' }] });
    });
  });

  it('treats missing recommendation storage as null', async () => {
    await withTempProject(async (cwd) => {
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });

  it('rejects malformed payloads before creating current.json', async () => {
    await withTempProject(async (cwd) => {
      await seedReferencedBacklog(cwd);
      await expect(writeRecommendations(cwd, { schemaVersion: 2 })).rejects.toThrow(/Expected 1|schemaVersion/);
      await expect(writeRecommendations(cwd, { ...recommendationModel(), extra: true })).rejects.toThrow(/additional|Unexpected property|extra/i);
      await expect(writeRecommendations(cwd, {
        ...recommendationModel(),
        recommendedNextSequence: [{ itemId: 'item-one', extra: true }],
      })).rejects.toThrow(/additional|Unexpected property|extra/i);
      const path = resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
      expect(existsSync(path)).toBe(false);
    });
  });

  it('ignores .backlog/recommendations.json storage', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.backlog'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'recommendations.json'), JSON.stringify(recommendationModel()));
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });

  it('put-recommendations writes current.json under private extension storage', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.backlog'), { recursive: true });
      await seedReferencedBacklog(cwd);
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: recommendationModel(),
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('success');
      const path = resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
      expect(existsSync(path)).toBe(true);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
      expect(path).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}recommendations${sep}`);
    });
  });

  it('get-recommendations returns null and a private storage path when current.json is missing', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:get-recommendations',
        input: {},
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(result.output).toMatchObject({ recommendations: null });
      expect('recommendationSummary' in (result.output as Record<string, unknown>)).toBe(false);
      expect((result.output as { path: string }).path.endsWith(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}recommendations${sep}current.json`)).toBe(true);
    });
  });

  it('get-recommendations returns the stored model and projected summary', async () => {
    await withTempProject(async (cwd) => {
      await seedReferencedBacklog(cwd);
      const model = recommendationModel();
      await writeRecommendations(cwd, model);
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:get-recommendations',
        input: {},
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(result.output).toMatchObject({
        recommendations: model,
        recommendationSummary: {
          recommendedNextItemIds: ['item-one'],
          safeParallelizableGroups: model.safeParallelizableGroups,
          blockedChainCount: 1,
          rationaleAndAssumptions: ['Assume dependencies stay stable.'],
        },
        // --- eforge:region plan-04-recommendation-actionability-server ---
        recommendationActionability: {
          recommendedNextSequence: [{ itemId: 'item-one', actionability: { state: 'actionable', lifecycleState: 'none' } }],
          safeParallelizableGroups: [{ ref: 'group-one', actionableItemIds: ['item-one', 'item-two'], suppressedItemIds: [] }],
        },
        // --- eforge:endregion plan-04-recommendation-actionability-server ---
      });
      // --- eforge:region plan-04-recommendation-actionability-server ---
      const raw = JSON.parse(await readFile(resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' })), 'utf-8')) as Record<string, unknown>;
      expect(raw).not.toHaveProperty('recommendationActionability');
      // --- eforge:endregion plan-04-recommendation-actionability-server ---
    });
  });

  it('malformed put-recommendations input returns invalid-input before creating current.json', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: { schemaVersion: 1, recommendedNextSequence: [{ ref: 'missing-item-id' }] },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(result.kind).toBe('invalid-input');
      const path = resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
      expect(existsSync(path)).toBe(false);
    });
  });
});
