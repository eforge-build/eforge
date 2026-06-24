import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT } from '@eforge-build/client';
import { createEforgeProjectPaths, type ExtensionActionContext } from '@eforge-build/extension-sdk';
import { retryPlanningAgentTaskAction, startPlanningAgentTaskAction } from '../eforge/extensions/eforge-plan/agent-task-actions.js';
import { applyCompletedPlanningAgentTaskResult } from '../eforge/extensions/eforge-plan/planner-orchestration.js';
import { readBacklogItem, writeBacklogItem } from '../eforge/extensions/eforge-plan/markdown-store.js';
import { recordPlanningTaskWorkflowEntry } from '../eforge/extensions/eforge-plan/planning-task-workflow-store.js';
import { createEmptyRecommendationModel, readRecommendations } from '../eforge/extensions/eforge-plan/recommendations-store.js';
import { MAX_PLANNING_AGENT_USER_GOAL_LENGTH } from '../eforge/extensions/eforge-plan/planning-agent-task-schemas.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-task-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function testContext(cwd: string, start: ExtensionActionContext['agentTasks']['start']): ExtensionActionContext {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return {
    invocationId: 'invocation-1',
    actionId: 'start-planning-agent-task',
    requestedBy: { kind: 'human' },
    cwd,
    signal: new AbortController().signal,
    logger,
    paths: createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }),
    agentTasks: { start, get: async () => { throw new Error('unused'); }, cancel: async () => { throw new Error('unused'); } },
    buildQueue: { enqueue: async () => { throw new Error('unused'); } },
  };
}

describe('eforge-plan planning agent task actions', () => {
  it('bounds oversized user goals before sending the task topic and source text', async () => {
    await withTempProject(async (cwd) => {
      const oversizedGoal = 'Plan '.repeat(MAX_PLANNING_AGENT_USER_GOAL_LENGTH);
      let request: Parameters<ExtensionActionContext['agentTasks']['start']>[0] | undefined;

      await startPlanningAgentTaskAction.handler({ userGoal: oversizedGoal }, testContext(cwd, async (value) => {
        request = value;
        return { task: { taskId: 'task-1', kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, status: 'queued', createdAt: new Date().toISOString() } } as Awaited<ReturnType<ExtensionActionContext['agentTasks']['start']>>;
      }));

      expect(request).toMatchObject({ task: { id: 'planning-draft' } });
      expect(request?.input.topic).toHaveLength(MAX_PLANNING_AGENT_USER_GOAL_LENGTH);
      expect(request?.input.topic).toContain('…[truncated]');
      expect(String(request?.input.sourceText)).toContain('…[truncated]');
      expect(String(request?.input.sourceText)).not.toContain(oversizedGoal);
    });
  });

  it('rejects missing selected session-plan sections before writing recommendations', async () => {
    await withTempProject(async (cwd) => {
      const task = {
        taskId: 'task-1',
        kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
        status: 'completed',
        result: {
          recommendations: createEmptyRecommendationModel(),
          sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Scope content.' }] },
        },
      };

      await expect(applyCompletedPlanningAgentTaskResult(cwd, task, {
        taskId: 'task-1',
        applyRecommendations: true,
        applySessionPlanDrafts: [{ session: 'demo', sections: ['scope', 'acceptance-criteria'] }],
      })).rejects.toThrow('acceptance-criteria');

      expect(await readRecommendations(cwd)).toBeNull();
    });
  });

  it('applies a session-plan creation draft and returns the created plan path without submitting it', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const task = {
        taskId: 'task-1',
        kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
        status: 'completed',
        result: {
          summary: 'Drafted a plan.',
          assumptionsOpenQuestions: ['Assumes scope is small.'],
          decision: 'ready',
          sessionPlanCreationDraft: {
            session: 'root-session',
            topic: 'Root topic',
            planningType: 'feature',
            planningDepth: 'focused',
            sections: [
              { dimension: 'problem-statement', content: 'Users need the root workflow to preserve generated context.' },
              { dimension: 'scope', content: 'Generated scope.' },
              { dimension: 'acceptance-criteria', content: '- Created session plan contains all generated feature readiness sections.' },
              { dimension: 'code-impact', content: 'Update the extension apply path and session-plan write flow.' },
              { dimension: 'design-decisions', content: 'Validate the AI draft before persisting a session plan.' },
              { dimension: 'assumptions-and-validation', content: 'Run the extension action apply tests and inspect readiness output.' },
            ],
          },
        },
      };

      const result = await applyCompletedPlanningAgentTaskResult(cwd, task, { taskId: 'task-1', applySessionPlanCreationDraft: {} });

      expect(result.sessionPlanCreationDraft).toMatchObject({ session: 'root-session', relativePath: '.eforge/session-plans/root-session.md' });
      expect(result.sessionPlanCreationDraft?.readiness).toMatchObject({ ready: true, missingDimensions: [] });
      expect([
        ...result.sessionPlanCreationDraft!.readiness.coveredDimensions,
        ...result.sessionPlanCreationDraft!.readiness.skippedDimensions,
      ].sort()).toEqual([
        'acceptance-criteria',
        'assumptions-and-validation',
        'code-impact',
        'design-decisions',
        'problem-statement',
        'scope',
      ]);
      const markdown = await readFile(join(cwd, '.eforge', 'session-plans', 'root-session.md'), 'utf-8');
      expect(markdown).toContain('Generated scope.');
      expect(markdown).not.toContain('status: submitted');
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('planned');
    });
  });

  it('retries a planning task reusing its preserved request context', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-original',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Original goal',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
        session: 'session-x',
        planningType: 'feature',
        planningDepth: 'deep',
        includeRoadmap: false,
      });

      let request: Parameters<ExtensionActionContext['agentTasks']['start']>[0] | undefined;
      const output = await retryPlanningAgentTaskAction.handler({ taskId: 'task-original' }, testContext(cwd, async (value) => {
        request = value;
        return { task: { taskId: 'task-retry', kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, status: 'queued', createdAt: new Date().toISOString() } } as Awaited<ReturnType<ExtensionActionContext['agentTasks']['start']>>;
      })) as { entry: { parentTaskId?: string; selection: { itemIds?: string[] } } };

      expect(request).toMatchObject({ task: { id: 'session-plan-creation' } });
      expect(request?.input).toMatchObject({ topic: 'Draft a session plan for Item One.', session: 'session-x', planningType: 'feature', planningDepth: 'deep', requestedOutputSections: ['sessionPlanCreationDraft'] });
      expect((request?.input as Record<string, unknown> | undefined)?.sessionPlanCreationReadiness).toMatchObject({
        resolved: {
          planningType: 'feature',
          planningDepth: 'deep',
          requiredDimensions: ['problem-statement', 'scope', 'acceptance-criteria', 'code-impact', 'design-decisions', 'assumptions-and-validation'],
        },
      });
      expect(output.entry).toMatchObject({ parentTaskId: 'task-original', selection: { itemIds: ['item-one'] } });
    });
  });
});
