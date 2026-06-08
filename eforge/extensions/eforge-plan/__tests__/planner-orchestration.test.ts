import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '../../../../packages/input/src/index.js';
import { applyCompletedPlanningAgentTaskResult, applyPlannerResult, preparePlannerContext } from '../planner-orchestration.js';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, readRecommendations, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

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
  it('builds context packets with recommendations, dependencies, epics, roadmap evidence, and trace summaries', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await writeTraceSidecar(cwd, {
        ...createTraceSidecar('item-one', 'epic-one'),
        promotedSessionPlans: [{ session: 'session-one', status: 'active', path: '.eforge/session-plans/session-one.md' }],
        buildRuns: [{ runId: 'run-one', sessionId: 'session-one', status: 'running' }],
        buildRunIds: ['run-one'],
        buildSessionIds: ['session-one'],
      });
      const packet = await preparePlannerContext(cwd, {});

      expect(packet.schemaVersion).toBe(1);
      expect(packet.items.map((item) => item.id).sort()).toEqual(['item-one', 'item-two']);
      expect(packet.epics.map((epic) => epic.id)).toEqual(['epic-one']);
      expect(packet.recommendations.exists).toBe(true);
      expect(packet.recommendationRationale).toEqual(['Prefer ready planning work.']);
      expect(packet.dependencies.find((entry) => entry.itemId === 'item-one')).toMatchObject({ blockers: ['Needs dependency.'], dependsOn: ['item-zero'] });
      expect(packet.roadmapEvidence).toMatchObject({ path: 'docs/roadmap.md', exists: true });
      expect(packet.roadmapEvidence.headings).toContain('Roadmap');
      expect(packet.traceSummaries).toEqual([expect.objectContaining({
        itemId: 'item-one',
        epicId: 'epic-one',
        hasActiveTrace: true,
        activeReasons: expect.arrayContaining(['active session-plan trace session-one', 'active build run trace run-one']),
      })]);
      expect(JSON.stringify(packet.traceSummaries).length).toBeLessThan(2000);
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

  it('applies completed planning task session-plan sections through the adapter', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'task-session', topic: 'Task session' });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, {
        taskId: 'task-complete',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        result: {
          summary: 'Done',
          assumptionsOpenQuestions: [],
          recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-two' }] },
          handoffDrafts: [{ selection: { itemIds: ['item-two'], status: 'active' }, session: 'unselected-handoff' }],
          sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Generated scope.' }, { dimension: 'risks', content: 'Generated risks.' }] },
        },
      }, { taskId: 'task-complete', applySessionPlanDrafts: [{ session: 'task-session', sections: ['scope'] }] });
      expect(result.applied).toMatchObject({ recommendations: false, handoffDrafts: 0, sessionPlanSections: 1 });
      const markdown = await readFile(join(cwd, '.eforge', 'session-plans', 'task-session.md'), 'utf-8');
      expect(markdown).toContain('Generated scope.');
      expect(markdown).not.toContain('Generated risks.');
      expect(await readRecommendations(cwd)).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-one' }] });
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'unselected-handoff.md'))).toBe(false);
    });
  });

  it('applies completed planning task handoff drafts by single draft, index, and overrides', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const single = await applyCompletedPlanningAgentTaskResult(cwd, {
        taskId: 'task-single-handoff',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        result: { summary: 'Done', assumptionsOpenQuestions: [], handoffDraft: { selection: { itemIds: ['item-one'], status: 'active' }, session: 'single-handoff' } },
      }, { taskId: 'task-single-handoff', applyHandoffDrafts: [{}] });
      expect(single.applied.handoffDrafts).toBe(1);
      expect(single.handoffs?.[0]).toMatchObject({ session: 'single-handoff', itemIds: ['item-one'] });

      const indexed = await applyCompletedPlanningAgentTaskResult(cwd, {
        taskId: 'task-array-handoff',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        result: { summary: 'Done', assumptionsOpenQuestions: [], handoffDrafts: [
          { selection: { itemIds: ['item-one'], status: 'active' }, session: 'first-handoff' },
          { selection: { itemIds: ['item-two'], status: 'planned' }, session: 'second-handoff' },
        ] },
      }, { taskId: 'task-array-handoff', applyHandoffDrafts: [{ index: 1, session: 'override-handoff', selection: { itemIds: ['item-two'], status: 'active' } }] });
      expect(indexed.applied.handoffDrafts).toBe(1);
      expect(indexed.handoffs?.[0]).toMatchObject({ session: 'override-handoff', itemIds: ['item-two'] });
    });
  });

  function creationDraftTask(session: string, extra: Record<string, unknown> = {}) {
    return {
      taskId: 'task-creation',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      result: {
        summary: 'Drafted a plan.',
        assumptionsOpenQuestions: ['Assumes API is stable.'],
        decision: 'ready',
        ...extra,
        sessionPlanCreationDraft: {
          session,
          topic: 'Created topic',
          planningType: 'feature',
          planningDepth: 'focused',
          sections: [{ dimension: 'scope', content: 'Generated scope content.' }],
        },
      },
    };
  }

  it('applies an AI creation draft through adapter-backed create/select/section/metadata operations and returns readiness detail', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('new-session'), {
        taskId: 'task-creation',
        applySessionPlanCreationDraft: { profile: 'excursion', agentProfile: 'planner', openQuestions: ['Custom open question'] },
      });
      expect(result.sessionPlanCreationDraft).toMatchObject({ session: 'new-session', relativePath: '.eforge/session-plans/new-session.md' });
      expect(result.sessionPlanCreationDraft?.readiness).toMatchObject({ ready: expect.any(Boolean), missingDimensions: expect.any(Array) });
      const loaded = await createSessionPlanningWorkflowAdapter().flat.load({ cwd, session: 'new-session' });
      expect(loaded.plan.profile).toBe('excursion');
      expect(loaded.plan.agent_profile).toBe('planner');
      expect(loaded.plan.open_questions).toEqual(['Custom open question']);
      expect(loaded.plan.required_dimensions.length).toBeGreaterThan(0);
      const markdown = await readFile(join(cwd, '.eforge', 'session-plans', 'new-session.md'), 'utf-8');
      expect(markdown).toContain('Generated scope content.');
      expect(markdown).not.toContain('status: submitted');
    });
  });

  it('defaults creation-draft open questions to the result assumptions and leaves backlog items unshipped', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('plan-session'), { taskId: 'task-creation', applySessionPlanCreationDraft: {} });
      const loaded = await createSessionPlanningWorkflowAdapter().flat.load({ cwd, session: 'plan-session' });
      expect(loaded.plan.open_questions).toEqual(['Assumes API is stable.']);
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('planned');
      expect((await readBacklogItem(cwd, 'item-two'))?.status).toBe('candidate');
    });
  });

  it('rejects a creation draft whose target session already exists before writing recommendations', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'dup-session', topic: 'Existing plan' });
      const dupPath = join(cwd, '.eforge', 'session-plans', 'dup-session.md');
      const before = await readFile(dupPath, 'utf-8');
      await expect(applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('dup-session', {
        recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-two', rationale: 'Ready.' }] },
      }), {
        taskId: 'task-creation',
        applyRecommendations: true,
        applySessionPlanCreationDraft: {},
      })).rejects.toThrow(/already exists/);
      // The pre-existing plan must be byte-for-byte untouched: rejection happens before any write.
      expect(await readFile(dupPath, 'utf-8')).toBe(before);
      expect(await readRecommendations(cwd)).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-one' }] });
    });
  });

  it('rejects creation-draft applies for a missing draft, unsupported planning type or depth, and a blank override session before writing recommendations', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const recommendations = { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-two', rationale: 'Ready.' }] };
      const baseResult = { summary: 'Drafted a plan.', assumptionsOpenQuestions: ['Assumes API is stable.'], decision: 'ready', recommendations };
      const validDraft = { session: 'new-session', topic: 'Created topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Generated scope content.' }] };
      const cases: Array<{ result: Record<string, unknown>; selection: { session?: string }; error: RegExp }> = [
        { result: { ...baseResult }, selection: {}, error: /does not include a session-plan creation draft/ },
        { result: { ...baseResult, sessionPlanCreationDraft: { ...validDraft, planningType: 'nonsense' } }, selection: {}, error: /unsupported planning type/ },
        { result: { ...baseResult, sessionPlanCreationDraft: { ...validDraft, planningDepth: 'nonsense' } }, selection: {}, error: /unsupported planning depth/ },
        { result: { ...baseResult, sessionPlanCreationDraft: { ...validDraft } }, selection: { session: '   ' }, error: /non-empty target session id/ },
      ];
      for (const testCase of cases) {
        await expect(applyCompletedPlanningAgentTaskResult(cwd, {
          taskId: 'task-creation',
          kind: 'eforge-plan.planning-draft',
          status: 'completed',
          result: testCase.result,
        }, {
          taskId: 'task-creation',
          applyRecommendations: true,
          applySessionPlanCreationDraft: testCase.selection,
        })).rejects.toThrow(testCase.error);
        // Validation rejects before any recommendation write: seeded recommendations stay intact.
        expect(await readRecommendations(cwd)).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-one' }] });
      }
      // No session-plan files are created for the rejected creation drafts.
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'new-session.md'))).toBe(false);
    });
  });

  it('retargets a creation draft to an explicit override session', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('draft-session'), {
        taskId: 'task-creation',
        applySessionPlanCreationDraft: { session: 'override-session' },
      });
      expect(result.sessionPlanCreationDraft).toMatchObject({ session: 'override-session', relativePath: '.eforge/session-plans/override-session.md' });
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'override-session.md'))).toBe(true);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'draft-session.md'))).toBe(false);
    });
  });

  it('rejects a creation draft whose explicit override session already exists before writing recommendations', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'override-session', topic: 'Existing plan' });
      const overridePath = join(cwd, '.eforge', 'session-plans', 'override-session.md');
      const before = await readFile(overridePath, 'utf-8');
      await expect(applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('draft-session', {
        recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-two', rationale: 'Ready.' }] },
      }), {
        taskId: 'task-creation',
        applyRecommendations: true,
        applySessionPlanCreationDraft: { session: 'override-session' },
      })).rejects.toThrow(/already exists/);
      // The pre-existing override target plan must be byte-for-byte untouched.
      expect(await readFile(overridePath, 'utf-8')).toBe(before);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'draft-session.md'))).toBe(false);
      expect(await readRecommendations(cwd)).toMatchObject({ recommendedNextSequence: [{ itemId: 'item-one' }] });
    });
  });
});
