import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { applyCompletedPlanningAgentTaskResult, applyPlannerResult, preparePlannerContext } from '../planner-orchestration.js';
import { parseMarkdownRecord, readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, readRecommendations, resolveRecommendationsPathForCwd, writeRecommendations } from '../recommendations-store.js';
import { createTraceSidecar, readTraceSidecar, writeTraceSidecar } from '../trace-store.js';
import { recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import type { PlanningTaskWorkflowSelection } from '../planning-agent-task-schemas.js';

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
  it('builds context packets with recommendations, dependencies, epics, roadmap context, and trace summaries', async () => {
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
      expect(packet.roadmapContext.discoveredContextSources[0]).toMatchObject({ path: 'docs/roadmap.md', exists: true, kind: 'discovered-conventional' });
      expect(packet.roadmapContext.discoveredContextSources[0]?.headings).toContain('Roadmap');
      expect(packet.traceSummaries).toEqual([expect.objectContaining({
        itemId: 'item-one',
        epicId: 'epic-one',
        hasActiveTrace: true,
        activeReasons: expect.arrayContaining(['active build run trace run-one']),
      })]);
      expect(packet.traceSummaries[0]?.activeReasons).not.toContain('active session-plan trace session-one');
      expect(JSON.stringify(packet.traceSummaries).length).toBeLessThan(2000);
    });
  });

  it('returns only selected item IDs and relevant trace summaries for item selectors', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-one', 'epic-one'), buildRunIds: ['run-one'], buildRuns: [{ runId: 'run-one', sessionId: 'session-one', status: 'running' }] });
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-two'), buildRunIds: ['run-two'], buildRuns: [{ runId: 'run-two', sessionId: 'session-two', status: 'running' }] });
      const packet = await preparePlannerContext(cwd, { itemIds: ['item-two'] });
      expect(packet.selection.itemIds).toEqual(['item-two']);
      expect(packet.items.map((item) => item.id)).toEqual(['item-two']);
      expect(packet.traceSummaries.map((summary) => summary.itemId)).toEqual(['item-two']);
    });
  });

  it('resolves recommendation refs and can omit roadmap context on request', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const packet = await preparePlannerContext(cwd, { recommendationRef: 'next-one', includeRoadmap: false });
      expect(packet.selection).toMatchObject({ kind: 'recommendationRef', itemIds: ['item-one'], epicIds: ['epic-one'], recommendationRef: 'next-one' });
      expect(packet.items.map((item) => item.id)).toEqual(['item-one']);
      expect(packet.roadmapContext.sharedContextSources).toEqual([]);
      expect(packet.roadmapContext.discoveredContextSources).toEqual([]);
      expect(packet.roadmapContext.assumptions.join('\n')).toMatch(/includeRoadmap was false/);
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

  function creationDraftTask(session: string, extra: Record<string, unknown> = {}, draftExtra: Record<string, unknown> = {}) {
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
          ...draftExtra,
          sections: [
            { dimension: 'problem-statement', content: 'The generated feature needs a clear implementation plan.' },
            { dimension: 'scope', content: 'Generated scope content.' },
            { dimension: 'acceptance-criteria', content: '- Feature session plan includes every required readiness section.' },
            { dimension: 'code-impact', content: 'Update the eforge-plan extension apply flow and related tests.' },
            { dimension: 'design-decisions', content: 'Validate generated drafts before any persistence.' },
            { dimension: 'assumptions-and-validation', content: 'Run targeted apply tests and type checking.' },
          ],
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

  it('never persists the seeded planner prompt as a plan topic, falling back to a humanized session slug', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await applyCompletedPlanningAgentTaskResult(
        cwd,
        creationDraftTask('group-kernel-playbook-migration', {}, { topic: 'Draft a session plan for recommendation group-kernel-playbook-migration covering Add contracts, Remove host surfaces.' }),
        { taskId: 'task-creation', applySessionPlanCreationDraft: {} },
      );
      const loaded = await createSessionPlanningWorkflowAdapter().flat.load({ cwd, session: 'group-kernel-playbook-migration' });
      expect(loaded.plan.topic).toBe('Kernel Playbook Migration');
    });
  });

  it('preserves an agent-authored concise topic', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await applyCompletedPlanningAgentTaskResult(
        cwd,
        creationDraftTask('authored-topic-session', {}, { topic: 'Annotation-driven plan revisions' }),
        { taskId: 'task-creation', applySessionPlanCreationDraft: {} },
      );
      const loaded = await createSessionPlanningWorkflowAdapter().flat.load({ cwd, session: 'authored-topic-session' });
      expect(loaded.plan.topic).toBe('Annotation-driven plan revisions');
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

  async function recordCreationWorkflow(cwd: string, selection: PlanningTaskWorkflowSelection, taskId = 'task-creation') {
    await recordPlanningTaskWorkflowEntry(cwd, {
      taskId,
      originalRequest: 'Plan selected backlog work.',
      derivedRequest: 'Draft a session plan for selected backlog work.',
      selection,
      requestedOutputSections: ['sessionPlanCreationDraft'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }

  async function readSessionPlanFrontmatter(cwd: string, session: string): Promise<Record<string, unknown>> {
    const raw = await readFile(join(cwd, '.eforge', 'session-plans', `${session}.md`), 'utf-8');
    return parseMarkdownRecord(raw).frontmatter;
  }

  function bugfixCreationDraftTask(session: string, sections = [
    { dimension: 'problem-statement', content: 'Grouped fast UX fixes regress dashboard refresh behavior.' },
    { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh.' },
    { dimension: 'root-cause', content: 'Filter state is reset before the refresh callback reads it.' },
    { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
    { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI coverage and a smoke check.' },
  ], skippedDimensions: Array<{ dimension: string; reason: string }> = []) {
    return {
      taskId: 'task-creation',
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      result: {
        summary: 'Drafted a bugfix plan.',
        assumptionsOpenQuestions: [],
        decision: 'ready',
        sessionPlanCreationDraft: {
          session,
          topic: 'Group fast UX bugfixes',
          planningType: 'bugfix',
          planningDepth: 'focused',
          sections,
          skippedDimensions,
        },
      },
    };
  }

  it('applies a recommendation-lane bugfix/focused creation draft only when required ids are covered or skipped', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await writeRecommendations(cwd, {
        ...createEmptyRecommendationModel(),
        safeParallelizableGroups: [{ ref: 'group-fast-ux-bugfixes', title: 'Fast UX fixes', itemIds: ['item-one', 'item-two'], rationale: 'Plan together.' }],
      });
      await recordCreationWorkflow(cwd, { recommendationRef: 'group-fast-ux-bugfixes' });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, bugfixCreationDraftTask('group-fast-ux-bugfixes', [
        { dimension: 'problem-statement', content: 'Grouped fast UX fixes regress dashboard refresh behavior.' },
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh.' },
        { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI coverage and a smoke check.' },
      ], [{ dimension: 'root-cause', reason: 'Root cause needs production telemetry and is explicitly tracked.' }]), {
        taskId: 'task-creation',
        applySessionPlanCreationDraft: {},
      });

      expect(result.sessionPlanCreationDraft?.readiness).toMatchObject({ ready: true, missingDimensions: [] });
      const readiness = result.sessionPlanCreationDraft!.readiness;
      expect([...readiness.coveredDimensions, ...readiness.skippedDimensions].sort()).toEqual([
        'acceptance-criteria',
        'assumptions-and-validation',
        'problem-statement',
        'reproduction-steps',
        'root-cause',
      ]);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'group-fast-ux-bugfixes.md'))).toBe(true);
    });
  });

  it('rejects group-fast-ux-bugfixes friendly-heading creation drafts before writing a session plan', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await writeRecommendations(cwd, {
        ...createEmptyRecommendationModel(),
        safeParallelizableGroups: [{ ref: 'group-fast-ux-bugfixes', title: 'Fast UX fixes', itemIds: ['item-one', 'item-two'], rationale: 'Plan together.' }],
      });
      await recordCreationWorkflow(cwd, { recommendationRef: 'group-fast-ux-bugfixes' });
      await expect(applyCompletedPlanningAgentTaskResult(cwd, bugfixCreationDraftTask('group-fast-ux-bugfixes', [
        { dimension: 'Goal', content: 'Fix the grouped UX bug quickly.' },
        { dimension: 'Scope', content: 'Limit the fix to dashboard refresh behavior.' },
        { dimension: 'Context and Evidence', content: 'The current plan uses friendly headings.' },
        { dimension: 'Implementation Plan', content: 'Patch the refresh code.' },
        { dimension: 'Validation', content: 'Run dashboard tests.' },
        { dimension: 'Risks and Guardrails', content: 'Avoid broad UI rewrites.' },
      ]), { taskId: 'task-creation', applySessionPlanCreationDraft: {} })).rejects.toThrow(/expected required dimension ids: problem-statement, reproduction-steps, root-cause, acceptance-criteria, assumptions-and-validation/);

      await expect(applyCompletedPlanningAgentTaskResult(cwd, bugfixCreationDraftTask('group-fast-ux-bugfixes', [
        { dimension: 'Goal', content: 'Fix the grouped UX bug quickly.' },
        { dimension: 'Validation', content: 'Run dashboard tests.' },
      ]), { taskId: 'task-creation', applySessionPlanCreationDraft: {} })).rejects.toThrow(/unknown dimension ids: Goal, Validation/);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'group-fast-ux-bugfixes.md'))).toBe(false);
    });
  });

  it('rejects creation drafts with acceptance-criteria diagnostics before writing a session plan', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await expect(applyCompletedPlanningAgentTaskResult(cwd, bugfixCreationDraftTask('bad-ac-session', [
        { dimension: 'problem-statement', content: 'Grouped fast UX fixes regress dashboard refresh behavior.' },
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh.' },
        { dimension: 'root-cause', content: 'Filter state is reset before the refresh callback reads it.' },
        { dimension: 'acceptance-criteria', content: '- Works correctly.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI coverage and a smoke check.' },
      ]), { taskId: 'task-creation', applySessionPlanCreationDraft: {} })).rejects.toThrow(/acceptance criteria/i);
      expect(existsSync(join(cwd, '.eforge', 'session-plans', 'bad-ac-session.md'))).toBe(false);
    });
  });

  it('links AI creation drafts to item workflow selections, writes trace sidecars, ignores spoofed model ids, and leaves item statuses unchanged', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await recordCreationWorkflow(cwd, { itemIds: ['item-one'] });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('linked-item-session', {
        sourceRefs: { sourceItemIds: ['item-two'], sourceEpicIds: ['spoof-epic'], recommendationRef: 'spoof-rec' },
        traceItemIds: ['item-two'],
      }, {
        sourceItemIds: ['item-two'],
        source_item_ids: ['item-two'],
        traceItemIds: ['item-two'],
      }), { taskId: 'task-creation', applySessionPlanCreationDraft: {} });

      expect(result.sessionPlanCreationDraft).toMatchObject({
        session: 'linked-item-session',
        relativePath: '.eforge/session-plans/linked-item-session.md',
        sourceRefs: { sourceItemIds: ['item-one'], sourceEpicIds: ['epic-one'] },
        traceItemIds: ['item-one'],
      });
      const frontmatter = await readSessionPlanFrontmatter(cwd, 'linked-item-session');
      expect(frontmatter.eforge_plan).toMatchObject({ source_item_ids: ['item-one'], source_epic_ids: ['epic-one'], source_item_id: 'item-one', source_epic_id: 'epic-one' });
      expect(frontmatter.eforge_plan).not.toMatchObject({ source_item_ids: ['item-two'] });
      expect(frontmatter.eforge_plan).not.toHaveProperty('source_recommendation_ref');
      const trace = await readTraceSidecar(cwd, 'item-one');
      expect(trace?.promotedSessionPlans[0]).toMatchObject({ session: 'linked-item-session', status: 'planning', promotedAt: expect.any(String) });
      expect(await readTraceSidecar(cwd, 'item-two')).toBeNull();
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('planned');
      expect((await readBacklogItem(cwd, 'item-two'))?.status).toBe('candidate');
    });
  });

  it('links AI creation drafts to item workflow selections with source recommendation refs', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await recordCreationWorkflow(cwd, { itemIds: ['item-one'], sourceRecommendationRef: 'group-one' });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('linked-source-recommendation-session'), { taskId: 'task-creation', applySessionPlanCreationDraft: {} });

      expect(result.sessionPlanCreationDraft).toMatchObject({
        sourceRefs: { sourceItemIds: ['item-one'], sourceEpicIds: ['epic-one'], recommendationRef: 'group-one' },
        traceItemIds: ['item-one'],
      });
      const frontmatter = await readSessionPlanFrontmatter(cwd, 'linked-source-recommendation-session');
      expect(frontmatter.eforge_plan).toMatchObject({ source_item_ids: ['item-one'], source_epic_ids: ['epic-one'], source_recommendation_ref: 'group-one' });
    });
  });

  it('links AI creation drafts to recommendation workflow selections and traces all resolved source items', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await writeRecommendations(cwd, {
        ...createEmptyRecommendationModel(),
        safeParallelizableGroups: [{ ref: 'group-one', title: 'Group One', itemIds: ['item-one', 'item-two'], epicIds: ['epic-one'], rationale: 'Plan together.' }],
      });
      await recordCreationWorkflow(cwd, { recommendationRef: 'group-one' });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('linked-recommendation-session'), { taskId: 'task-creation', applySessionPlanCreationDraft: {} });

      expect(result.sessionPlanCreationDraft).toMatchObject({
        sourceRefs: { sourceItemIds: ['item-one', 'item-two'], sourceEpicIds: ['epic-one'], recommendationRef: 'group-one' },
        traceItemIds: ['item-one', 'item-two'],
      });
      const frontmatter = await readSessionPlanFrontmatter(cwd, 'linked-recommendation-session');
      expect(frontmatter.eforge_plan).toMatchObject({ source_item_ids: ['item-one', 'item-two'], source_epic_ids: ['epic-one'], source_recommendation_ref: 'group-one' });
      expect(frontmatter.eforge_plan).not.toHaveProperty('source_item_id');
      expect((await readTraceSidecar(cwd, 'item-one'))?.promotedSessionPlans[0]?.session).toBe('linked-recommendation-session');
      expect((await readTraceSidecar(cwd, 'item-two'))?.promotedSessionPlans[0]?.session).toBe('linked-recommendation-session');
    });
  });

  it('links AI creation drafts to epic workflow selections and traces the open epic items', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      await recordCreationWorkflow(cwd, { epicId: 'epic-one' });
      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('linked-epic-session'), { taskId: 'task-creation', applySessionPlanCreationDraft: {} });

      expect(result.sessionPlanCreationDraft).toMatchObject({
        sourceRefs: { sourceItemIds: ['item-one'], sourceEpicIds: ['epic-one'] },
        traceItemIds: ['item-one'],
      });
      const frontmatter = await readSessionPlanFrontmatter(cwd, 'linked-epic-session');
      expect(frontmatter.eforge_plan).toMatchObject({ source_item_ids: ['item-one'], source_epic_ids: ['epic-one'], source_item_id: 'item-one', source_epic_id: 'epic-one' });
      expect((await readTraceSidecar(cwd, 'item-one'))?.promotedSessionPlans[0]).toMatchObject({ session: 'linked-epic-session', status: 'planning' });
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
      const validDraft = {
        session: 'new-session',
        topic: 'Created topic',
        planningType: 'feature',
        planningDepth: 'focused',
        sections: [
          { dimension: 'problem-statement', content: 'The generated feature needs a clear implementation plan.' },
          { dimension: 'scope', content: 'Generated scope content.' },
          { dimension: 'acceptance-criteria', content: '- Feature session plan includes every required readiness section.' },
          { dimension: 'code-impact', content: 'Update the eforge-plan extension apply flow and related tests.' },
          { dimension: 'design-decisions', content: 'Validate generated drafts before any persistence.' },
          { dimension: 'assumptions-and-validation', content: 'Run targeted apply tests and type checking.' },
        ],
      };
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

  it('allows a creation draft to replace an abandoned target session plan', async () => {
    await withTempProject(async (cwd) => {
      await seed(cwd);
      const planning = createSessionPlanningWorkflowAdapter();
      await planning.flat.create({ cwd, session: 'abandoned-session', topic: 'Old abandoned plan' });
      await planning.flat.setSection({ cwd, session: 'abandoned-session', dimension: 'scope', content: 'Old abandoned content.' });
      await planning.flat.setStatus({ cwd, session: 'abandoned-session', status: 'abandoned' });

      const result = await applyCompletedPlanningAgentTaskResult(cwd, creationDraftTask('abandoned-session'), {
        taskId: 'task-creation',
        applySessionPlanCreationDraft: {},
      });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'abandoned-session.md'), 'utf-8');
      const loaded = await planning.flat.load({ cwd, session: 'abandoned-session' });

      expect(result.sessionPlanCreationDraft).toMatchObject({ session: 'abandoned-session', relativePath: '.eforge/session-plans/abandoned-session.md' });
      expect(loaded.plan.status).toBe('planning');
      expect(raw).toContain('status: planning');
      expect(raw).toContain('Generated scope content.');
      expect(raw).not.toContain('Old abandoned content.');
    });
  });
});
