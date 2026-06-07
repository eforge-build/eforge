import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT } from '@eforge-build/client';
import { createEforgeProjectPaths, type ExtensionActionContext } from '@eforge-build/extension-sdk';
import { startPlanningAgentTaskAction } from '../eforge/extensions/eforge-plan/agent-task-actions.js';
import { applyCompletedPlanningAgentTaskResult } from '../eforge/extensions/eforge-plan/planner-orchestration.js';
import { createEmptyRecommendationModel, readRecommendations } from '../eforge/extensions/eforge-plan/recommendations-store.js';
import { MAX_PLANNING_AGENT_USER_GOAL_LENGTH } from '../eforge/extensions/eforge-plan/schema.js';

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
  };
}

describe('eforge-plan planning agent task actions', () => {
  it('bounds oversized user goals before sending the task topic and source text', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-task-'));
    const oversizedGoal = 'Plan '.repeat(MAX_PLANNING_AGENT_USER_GOAL_LENGTH);
    let request: Parameters<ExtensionActionContext['agentTasks']['start']>[0] | undefined;

    await startPlanningAgentTaskAction.handler({ userGoal: oversizedGoal }, testContext(cwd, async (value) => {
      request = value;
      return { task: { taskId: 'task-1', kind: value.kind, status: 'queued', createdAt: new Date().toISOString() } } as Awaited<ReturnType<ExtensionActionContext['agentTasks']['start']>>;
    }));

    expect(request?.input.topic).toHaveLength(MAX_PLANNING_AGENT_USER_GOAL_LENGTH);
    expect(request?.input.topic).toContain('…[truncated]');
    expect(String(request?.input.sourceText)).toContain('…[truncated]');
    expect(String(request?.input.sourceText)).not.toContain(oversizedGoal);
  });

  it('rejects missing selected session-plan sections before writing recommendations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-apply-'));
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
