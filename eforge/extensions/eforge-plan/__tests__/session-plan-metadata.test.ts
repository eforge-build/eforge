import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter, loadSessionPlan, writeSessionPlan } from '../../../../packages/input/src/index.js';
import { readSessionPlanSourceMetadata, updateSessionPlanSourceMetadata } from '../session-plan-metadata.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-metadata-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('session plan source metadata', () => {
  it('merges trusted source linkage without replacing unrelated eforge_plan metadata', async () => {
    await withTempProject(async (cwd) => {
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'linked-session', topic: 'Linked session' });
      const plan = await loadSessionPlan({ cwd, session: 'linked-session' });
      await writeSessionPlan({ cwd, plan: { ...plan, profile: 'excursion', agent_profile: 'planner', open_questions: ['Keep this?'], eforge_plan: { custom_flag: true, source_item_id: 'stale-item', source_recommendation_ref: 'stale-ref' } } });

      await updateSessionPlanSourceMetadata({
        cwd,
        session: 'linked-session',
        sourceItemIds: ['item-one', 'item-two'],
        sourceEpicIds: ['epic-one'],
        promotedAt: '2026-01-01T00:00:00.000Z',
      });

      const updated = await loadSessionPlan({ cwd, session: 'linked-session' });
      expect(updated.profile).toBe('excursion');
      expect(updated.agent_profile).toBe('planner');
      expect(updated.open_questions).toEqual(['Keep this?']);
      expect(updated.eforge_plan).toMatchObject({ custom_flag: true, source_item_ids: ['item-one', 'item-two'], source_epic_ids: ['epic-one'], source_epic_id: 'epic-one', promoted_at: '2026-01-01T00:00:00.000Z' });
      expect(updated.eforge_plan).not.toHaveProperty('source_item_id');
      expect(updated.eforge_plan).not.toHaveProperty('source_recommendation_ref');
      await expect(readSessionPlanSourceMetadata({ cwd, session: 'linked-session' })).resolves.toEqual({ sourceItemIds: ['item-one', 'item-two'], sourceEpicIds: ['epic-one'], promotedAt: '2026-01-01T00:00:00.000Z' });
    });
  });
});
