import { readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMarkdownRecord } from '../markdown-store.js';
import { promoteBacklogSelection } from '../promote.js';
import { resolvePromotionSelection } from '../promotion-selection.js';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { writeRecommendations } from '../recommendations-store.js';
import { readTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-selection-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function seedBacklog(cwd: string) {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', tags: [], body: '# Epic One\n\nEpic evidence.' });
  await writeBacklogItem(cwd, { id: 'dep-one', status: 'planned', tags: [], depends_on: [], epic: 'epic-one', body: '# Dependency One\n\n## Claim\n\nBuild dependency.\n\n## Evidence\n\nDependency evidence.' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', tags: [], depends_on: ['dep-one'], epic: 'epic-one', body: '# Item One\n\n## Claim\n\nBuild item one.\n\n## Evidence\n\nItem one evidence.\n\n## Acceptance Criteria\n\n- Item one done.' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', tags: [], depends_on: ['item-one'], epic: 'epic-one', body: '# Item Two\n\n## Claim\n\nBuild item two.\n\n## Evidence\n\nItem two evidence.\n\n## Risks\n\n- Integration risk.' });
}

async function readSessionPlan(cwd: string, session: string) {
  const raw = await readFile(join(cwd, '.eforge', 'session-plans', `${session}.md`), 'utf-8');
  return { raw, parsed: parseMarkdownRecord(raw), frontmatter: parseMarkdownRecord(raw).frontmatter };
}

describe('eforge-plan promotion selection', () => {
  it('promotes explicit multi-item selection to one excursion session plan with traces and active item status', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const result = await promoteBacklogSelection({ cwd, itemIds: ['item-two', 'item-one'], session: 'multi-session' });
      const files = await readdir(join(cwd, '.eforge', 'session-plans'));
      const { raw, frontmatter } = await readSessionPlan(cwd, 'multi-session');

      expect(files).toEqual(['multi-session.md']);
      expect(result.itemIds).toEqual(['item-two', 'item-one']);
      expect(frontmatter.profile).toBe('excursion');
      expect(frontmatter.eforge_plan).toMatchObject({ source_item_ids: ['item-two', 'item-one'], source_epic_ids: ['epic-one'] });
      expect(frontmatter.eforge_plan).not.toHaveProperty('source_item_id');
      expect(raw).toContain('Backlog item id: item-two');
      expect(raw).toContain('Backlog item id: item-one');
      expect(raw).toContain('### item-two\n\nDepends on: item-one');
      expect(raw).toContain('### item-one\n\nDepends on: dep-one');
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('active');
      expect((await readBacklogItem(cwd, 'item-two'))?.status).toBe('active');
      expect((await readTraceSidecar(cwd, 'item-one'))?.promotedSessionPlans).toHaveLength(1);
      expect((await readTraceSidecar(cwd, 'item-two'))?.promotedSessionPlans[0]?.session).toBe('multi-session');
    });
  });

  it('promotes an epic selection in dependency-before-dependent order and can mark items planned', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      const result = await promoteBacklogSelection({ cwd, epicId: 'epic-one', session: 'epic-session', status: 'planned' });
      const { raw, frontmatter } = await readSessionPlan(cwd, 'epic-session');

      expect(result.itemIds).toEqual(['dep-one', 'item-one', 'item-two']);
      expect(frontmatter.profile).toBe('excursion');
      expect(frontmatter.eforge_plan).toMatchObject({ source_epic_ids: ['epic-one'], source_item_ids: ['dep-one', 'item-one', 'item-two'], source_epic_id: 'epic-one' });
      expect(raw).toContain('Epic epic-one: Epic One');
      expect((await readBacklogItem(cwd, 'item-two'))?.status).toBe('planned');
    });
  });

  it('promotes a recommendation group ref and respects recommended and caller profiles', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeRecommendations(cwd, {
        schemaVersion: 1,
        activeWork: [],
        readyCandidates: [],
        recommendedNextSequence: [{ ref: 'next-one', itemId: 'item-one', rationale: 'Next.' }],
        safeParallelizableGroups: [{ ref: 'group-one', title: 'Group One', itemIds: ['item-one', 'item-two'], recommendedProfile: 'expedition', rationale: 'Together.' }],
        blockedChains: [],
        rationaleAndAssumptions: ['Validate together.'],
      });

      await promoteBacklogSelection({ cwd, recommendationRef: 'group-one', session: 'group-session' });
      const groupPlan = await readSessionPlan(cwd, 'group-session');
      expect(groupPlan.frontmatter.profile).toBe('expedition');
      expect(groupPlan.frontmatter.eforge_plan).toMatchObject({ source_recommendation_ref: 'group-one', source_item_ids: ['item-one', 'item-two'] });
      expect(groupPlan.raw).toContain('Recommendation rationale: Together.');
      expect(groupPlan.raw).toContain('- Validate together.');

      await promoteBacklogSelection({ cwd, recommendationRef: 'group-one', session: 'caller-profile-session', profile: 'errand' });
      expect((await readSessionPlan(cwd, 'caller-profile-session')).frontmatter.profile).toBe('errand');
    });
  });

  it('supports recommendation refs on one-item next-sequence entries', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await writeRecommendations(cwd, {
        schemaVersion: 1,
        activeWork: [],
        readyCandidates: [],
        recommendedNextSequence: [{ ref: 'next-one', itemId: 'item-one', rationale: 'Next item.', confidence: 'high' }],
        safeParallelizableGroups: [],
        blockedChains: [],
        rationaleAndAssumptions: [],
      });
      await promoteBacklogSelection({ cwd, recommendationRef: 'next-one', session: 'next-session' });
      const { raw, frontmatter } = await readSessionPlan(cwd, 'next-session');
      expect(frontmatter.profile).toBeNull();
      expect(frontmatter.eforge_plan).toMatchObject({ source_recommendation_ref: 'next-one', source_item_id: 'item-one', source_item_ids: ['item-one'] });
      expect(raw).toContain('Recommendation confidence: high');
    });
  });

  it('rejects invalid selector combinations and duplicate explicit item ids', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await expect(resolvePromotionSelection({ cwd })).rejects.toThrow(/exactly one selector/);
      await expect(resolvePromotionSelection({ cwd, itemIds: ['item-one'], epicId: 'epic-one' })).rejects.toThrow(/exactly one selector/);
      await expect(resolvePromotionSelection({ cwd, itemIds: ['item-one', 'item-one'] })).rejects.toThrow(/Duplicate backlog item id/);
      await expect(writeRecommendations(cwd, {
        schemaVersion: 1,
        activeWork: [],
        readyCandidates: [],
        recommendedNextSequence: [],
        safeParallelizableGroups: [{ ref: 'empty-group', itemIds: [] }],
        blockedChains: [],
        rationaleAndAssumptions: [],
      })).rejects.toThrow(/must include at least one item id/);
    });
  });
});
