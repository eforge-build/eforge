import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlannerResult, preparePlannerContext } from '../planner-orchestration.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, readRecommendations, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-planner-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function seed(cwd: string) {
  await mkdir(join(cwd, 'docs'), { recursive: true });
  await writeFile(join(cwd, 'docs', 'roadmap.md'), '# Roadmap\n\n## Planning\n\nShip planner orchestration.\n');
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: ['planning'], body: '# Epic One\n\n## Goal\n\nCoordinate planning.\n' });
  await writeBacklogItem(cwd, {
    id: 'item-one',
    status: 'planned',
    tags: ['ai'],
    epic: 'epic-one',
    depends_on: ['item-zero'],
    body: '# Item One\n\n## Claim\n\nPlan the next item.\n\n## Blockers\n\n- Needs dependency.\n',
  });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nSecond item.\n' });
  await writeRecommendations(cwd, {
    ...createEmptyRecommendationModel(),
    recommendedNextSequence: [{ ref: 'next-one', itemId: 'item-one', rationale: 'Best next.' }],
    rationaleAndAssumptions: ['Prefer ready planning work.'],
  });
}

describe('planner orchestration', () => {
  it('builds context packets with recommendations, dependencies, epics, and roadmap evidence', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const packet = await preparePlannerContext(cwd, {});

      expect(packet.schemaVersion).toBe(1);
      expect(packet.items.map((item) => item.id).sort()).toEqual(['item-one', 'item-two']);
      expect(packet.epics.map((epic) => epic.id)).toEqual(['epic-one']);
      expect(packet.recommendations.exists).toBe(true);
      expect(packet.recommendationRationale).toEqual(['Prefer ready planning work.']);
      expect(packet.dependencies.find((entry) => entry.itemId === 'item-one')).toMatchObject({ blockers: ['Needs dependency.'], dependsOn: ['item-zero'] });
      expect(packet.roadmapEvidence).toMatchObject({ path: 'docs/roadmap.md', exists: true });
      expect(packet.roadmapEvidence.headings).toContain('Roadmap');
    });
  });

  it('returns only selected item IDs for item selectors', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const packet = await preparePlannerContext(cwd, { itemIds: ['item-two'] });
      expect(packet.selection.itemIds).toEqual(['item-two']);
      expect(packet.items.map((item) => item.id)).toEqual(['item-two']);
    });
  });

  it('resolves recommendation refs and can omit roadmap evidence on request', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const packet = await preparePlannerContext(cwd, { recommendationRef: 'next-one', includeRoadmap: false });
      expect(packet.selection).toMatchObject({ kind: 'recommendationRef', itemIds: ['item-one'], epicIds: ['epic-one'], recommendationRef: 'next-one' });
      expect(packet.items.map((item) => item.id)).toEqual(['item-one']);
      expect(packet.roadmapEvidence).toEqual({ path: 'docs/roadmap.md', exists: false, headings: [], excerpts: [] });
    });
  });

  it('returns an empty recommendation model when private recommendation storage is missing', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nPlan item one.\n' });
      const packet = await preparePlannerContext(cwd, {});
      expect(packet.recommendations.exists).toBe(false);
      expect(packet.recommendations.model).toEqual(createEmptyRecommendationModel());
      expect(packet.recommendationRationale).toEqual([]);
    });
  });

  it('rejects empty planner results without recommendations or handoff drafts', async () => {
    await withTempProject(async (cwd) => {
      await expect(applyPlannerResult(cwd, {})).rejects.toThrow(/must include recommendations, handoffDraft, or both/);
    });
  });

  it('applies recommendation updates to private storage', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const model = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-two', rationale: 'Ready.' }] };
      const result = await applyPlannerResult(cwd, { recommendations: model });
      expect(existsSync(resolveRecommendationsPathForCwd(cwd))).toBe(true);
      expect(await readRecommendations(cwd)).toMatchObject({ readyCandidates: [{ itemId: 'item-two' }] });
      expect(result.recommendations).toMatchObject({ path: resolveRecommendationsPathForCwd(cwd) });
    });
  });

  it('applies handoff drafts through the promotion-selection helper', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const result = await applyPlannerResult(cwd, { handoffDraft: { selection: { itemIds: ['item-one'], status: 'active' }, session: 'planner-handoff' } });
      expect(result.handoff).toMatchObject({ session: 'planner-handoff', itemIds: ['item-one'] });
      const files = await readdir(join(cwd, '.eforge', 'session-plans'));
      expect(files).toEqual(['planner-handoff.md']);
    });
  });
});
