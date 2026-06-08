import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import { applyPlannerResult } from '../planner-orchestration.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import type { BacklogRecommendationModel } from '../schema.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-recommendation-apply-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}

async function seedBacklog(cwd: string) {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n' });
  await writeBacklogEpic(cwd, { id: 'epic-two', status: 'planned', body: '# Epic Two\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', epic: 'epic-one', body: '# Item One\n\n## Claim\n\nFirst.\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', epic: 'epic-two', body: '# Item Two\n\n## Claim\n\nSecond.\n' });
  await writeBacklogItem(cwd, { id: 'item-three', status: 'candidate', body: '# Item Three\n\n## Claim\n\nThird.\n' });
}

function baselineModel(): BacklogRecommendationModel {
  return {
    ...createEmptyRecommendationModel(),
    recommendedNextSequence: [{ itemId: 'item-one', rationale: 'Keep previous bytes visible.' }],
    rationaleAndAssumptions: ['Baseline.'],
  };
}

function fullyReferencedModel(): BacklogRecommendationModel {
  return {
    ...createEmptyRecommendationModel(),
    activeWork: [{ itemId: 'item-one', rationale: 'In progress.' }],
    readyCandidates: [{ itemId: 'item-two', rationale: 'Ready.' }],
    recommendedNextSequence: [{ itemId: 'item-three', rationale: 'Next.' }],
    safeParallelizableGroups: [{ ref: 'group-one', title: 'Safe group', itemIds: ['item-two', 'item-three'], epicIds: ['epic-two'], safeToPlanTogether: true }],
    blockedChains: [{ ref: 'blocked-one', itemIds: ['item-three'], blockedBy: ['item-one'], rationale: 'Needs item one.' }],
    rationaleAndAssumptions: ['All references are known.'],
  };
}

async function expectRejectedBeforeCurrentJsonChanges(cwd: string, model: BacklogRecommendationModel) {
  await writeRecommendations(cwd, baselineModel());
  const before = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');

  const result = await dispatchExtensionAction(registry(), {
    actionId: 'eforge-plan:put-recommendations',
    input: model,
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
  });

  expect(result.kind).toBe('invalid-input');
  expect(JSON.stringify(result)).toMatch(/missing|Expected an existing (item|epic) id/);
  expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(before);
}

describe('recommendation apply reference validation', () => {
  it('accepts known item and epic references and records freshness metadata', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: fullyReferencedModel(),
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(result.kind).toBe('success');
      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toContain('item-three');
      const statusPath = join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'recommendations', 'status.json');
      expect(existsSync(statusPath)).toBe(true);
      expect(await readFile(statusPath, 'utf-8')).toMatch(/[a-f0-9]{64}/);
    });
  });

  it('rejects every unknown recommendation reference before current.json changes', async () => {
    const cases: Array<{ name: string; mutate: (model: BacklogRecommendationModel) => void }> = [
      { name: 'activeWork', mutate: (model) => { model.activeWork = [{ itemId: 'missing-active' }]; } },
      { name: 'readyCandidates', mutate: (model) => { model.readyCandidates = [{ itemId: 'missing-ready' }]; } },
      { name: 'recommendedNextSequence', mutate: (model) => { model.recommendedNextSequence = [{ itemId: 'missing-next' }]; } },
      { name: 'safeParallelizableGroups.itemIds', mutate: (model) => { model.safeParallelizableGroups[0]!.itemIds = ['missing-group-item']; } },
      { name: 'safeParallelizableGroups.epicIds', mutate: (model) => { model.safeParallelizableGroups[0]!.epicIds = ['missing-epic']; } },
      { name: 'blockedChains.itemIds', mutate: (model) => { model.blockedChains[0]!.itemIds = ['missing-blocked-item']; } },
      { name: 'blockedChains.blockedBy', mutate: (model) => { model.blockedChains[0]!.blockedBy = ['missing-blocker']; } },
    ];

    for (const entry of cases) {
      await withTempProject(async (cwd) => {
        await seedBacklog(cwd);
        const model = fullyReferencedModel();
        entry.mutate(model);
        await expectRejectedBeforeCurrentJsonChanges(cwd, model);
      });
    }
  });

  it('rejects empty safe parallelizable group itemIds before current.json changes', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeRecommendations(cwd, baselineModel());
      const before = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:put-recommendations',
        input: { ...fullyReferencedModel(), safeParallelizableGroups: [{ ...fullyReferencedModel().safeParallelizableGroups[0]!, itemIds: [] }] },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(result.kind).toBe('invalid-input');
      expect(JSON.stringify(result)).toMatch(/group-one|itemIds|at least one/i);
      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(before);
    });
  });

  it('validates direct planner result applies and preserves previous recommendations on failure', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeRecommendations(cwd, baselineModel());
      const before = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');

      await expect(applyPlannerResult(cwd, {
        recommendations: { ...fullyReferencedModel(), recommendedNextSequence: [{ itemId: 'missing-planner-ref' }] },
      })).rejects.toThrow(/missing-planner-ref|recommendedNextSequence/i);

      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(before);
    });
  });

  it('direct planner result applies clear stale status when sources match and record drift after source changes', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const freshApply = await applyPlannerResult(cwd, { recommendations: fullyReferencedModel() });
      expect(freshApply.recommendations).toMatchObject({ status: { state: 'fresh' } });

      await writeBacklogItem(cwd, { id: 'item-three', status: 'candidate', body: '# Item Three\n\n## Claim\n\nSource drift.\n' });
      const driftApply = await applyPlannerResult(cwd, { recommendations: fullyReferencedModel() });
      expect(driftApply.recommendations).toMatchObject({ status: { state: 'stale' } });
      expect(JSON.stringify(driftApply.recommendations)).toMatch(/drift|fingerprint|source/i);
      const status = JSON.parse(await readFile(join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'recommendations', 'status.json'), 'utf-8'));
      expect(JSON.stringify(status)).toMatch(/drift|fingerprint|source/i);
    });
  });
});
