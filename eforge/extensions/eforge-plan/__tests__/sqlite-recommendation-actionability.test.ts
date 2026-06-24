import { describe, expect, it } from 'vitest';
import { getRecommendationProjection, buildRecommendationActionability } from '../projections/index.js';
import { seedProjectionBacklog, seedRecommendations, withTempProjectionProject } from './sqlite-projection-fixtures.js';

describe('SQLite recommendation actionability projections', () => {
  it('reconstructs the current recommendation model from SQLite lane rows', async () => {
    await withTempProjectionProject(async (cwd) => {
      const model = seedRecommendationsAfterBacklog(cwd);

      const output = await getRecommendationProjection(cwd);

      expect(output.recommendations).toMatchObject({ schemaVersion: 1, updatedAt: model.updatedAt, rationaleAndAssumptions: model.rationaleAndAssumptions });
      expect(output.recommendations.readyCandidates).toEqual([
        expect.objectContaining({ itemId: 'planned' }),
        expect.objectContaining({ itemId: 'candidate' }),
      ]);
      expect(output.recommendations.safeParallelizableGroups).toEqual([expect.objectContaining({ ref: 'group-1', itemIds: ['running', 'candidate'] })]);
      expect(output.status).toMatchObject({ state: 'fresh' });
      expect(output.recommendationFreshness).toMatchObject({ state: 'fresh' });
    });
  });

  it('marks planned and active build recommendation entries suppressed with associated links', async () => {
    await withTempProjectionProject(async (cwd) => {
      const model = seedRecommendationsAfterBacklog(cwd);

      const actionability = await buildRecommendationActionability(cwd, model);
      const planned = actionability.readyCandidates.find((entry) => entry.itemId === 'planned')?.actionability;
      const running = actionability.activeWork.find((entry) => entry.itemId === 'running')?.actionability;
      const candidate = actionability.readyCandidates.find((entry) => entry.itemId === 'candidate')?.actionability;

      expect(planned).toMatchObject({ state: 'non-actionable', disposition: 'suppressed', lifecycleState: 'planned', reasonCode: 'planned-session-plan' });
      expect(planned?.associatedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'session-plan', session: 'plan-planned' })]));
      expect(running).toMatchObject({ state: 'non-actionable', disposition: 'suppressed', lifecycleState: 'build', reasonCode: 'running-build' });
      expect(running?.associatedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-session', buildSessionId: 'build-session-1' })]));
      expect(candidate).toMatchObject({ state: 'actionable', disposition: 'actionable', lifecycleState: 'none' });
    });
  });

  it('de-actions terminal merged, shipped, failed, and partial evidence instead of presenting fresh planning candidates', async () => {
    await withTempProjectionProject(async (cwd) => {
      const model = seedRecommendationsAfterBacklog(cwd);

      const actionability = await buildRecommendationActionability(cwd, model);
      const shipped = actionability.recommendedNextSequence.find((entry) => entry.itemId === 'shipped')?.actionability;
      const failed = actionability.recommendedNextSequence.find((entry) => entry.itemId === 'failed')?.actionability;

      expect(shipped).toMatchObject({ state: 'non-actionable', disposition: 'de-actioned', lifecycleState: 'shipped', reasonCode: 'shipped-result' });
      expect(failed).toMatchObject({ state: 'non-actionable', disposition: 'de-actioned', lifecycleState: 'failed', reasonCode: 'failed-result' });
    });
  });

  it('reports partially-actionable safe-parallel groups with deterministic item partitions', async () => {
    await withTempProjectionProject(async (cwd) => {
      const model = seedRecommendationsAfterBacklog(cwd);

      const actionability = await buildRecommendationActionability(cwd, model);
      const group = actionability.safeParallelizableGroups.find((entry) => entry.ref === 'group-1');

      expect(group).toMatchObject({ state: 'partially-actionable', itemIds: ['running', 'candidate'], actionableItemIds: ['candidate'], suppressedItemIds: ['running'] });
      expect(group?.items.map((item) => item.itemId)).toEqual(['running', 'candidate']);
    });
  });
});

function seedRecommendationsAfterBacklog(cwd: string) {
  seedProjectionBacklog(cwd);
  return seedRecommendations(cwd);
}
