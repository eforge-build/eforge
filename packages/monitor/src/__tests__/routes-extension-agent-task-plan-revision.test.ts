import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole } from '@eforge-build/engine/events';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import { EforgePlanPlanningDraftInputSchema, EforgePlanPlanningDraftResultSchema, type EforgeEvent } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import { ExtensionAgentTaskService } from '../routes/extensions/agent-task-service.js';

const revisionResult = {
  summary: 'Answered revision turn.',
  assumptionsOpenQuestions: [],
  planRevisionTurn: {
    schemaVersion: 1,
    targetSession: 'demo-session',
    assistantMessage: 'No patch is needed for this answer-only revision turn.',
    basePlanFingerprint: '1'.repeat(64),
    noPatchReason: 'The existing plan already covers the request.',
  },
};

describe('extension agent task plan revision metadata', () => {
  it('persists completed revision turns with one output section', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-revision-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(new SubmitHarness(revisionResult)) });
    try {
      await mkdir(join(cwd, 'prompts'), { recursive: true });
      await writeFile(join(cwd, 'prompts', 'planning.md'), 'Topic: {{topic}}\n', 'utf-8');
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start(
        { kind: 'eforge-plan.planning-draft', input: { topic: 'Revise plan', requestedOutputSections: ['planRevisionTurn'], existingSessionPlan: '# Scope\nExisting.' } },
        { registry: planningRegistry(cwd) },
      );
      const completed = await waitForTask(service, started.task.taskId);
      expect(completed.metadata?.outputSectionCount).toBe(1);
      expect(completed.result?.planRevisionTurn?.targetSession).toBe('demo-session');
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function planningRegistry(extensionPath: string): NativeExtensionRegistry {
  return {
    agentTasks: [{ kind: 'agentTask', extensionName: 'eforge-plan', extensionPath, localId: 'planning-draft', id: 'eforge-plan:planning-draft', value: { id: 'planning-draft', title: 'Planning draft', inputSchema: EforgePlanPlanningDraftInputSchema, outputSchema: EforgePlanPlanningDraftResultSchema, prompt: { kind: 'asset' as const, asset: 'prompts/planning.md' }, resolvePrompt: (ctx: any) => { let submitted: unknown; const submitTool = ctx.effectiveCustomToolName?.('submit_eforge_plan_planning_result') ?? 'submit_eforge_plan_planning_result'; return { variables: { topic: ctx.input.topic }, run: { role: 'planner', tools: [{ name: submitTool, description: 'submit', inputSchema: EforgePlanPlanningDraftResultSchema, handler: async (input: unknown) => { submitted = input; return 'submitted'; } }] }, getResult: () => submitted, missingResultMessage: 'missing result' }; } } }],
    actions: [], tools: [], eventHooks: [], agentRunHooks: [], policyGates: [], profileRouters: [], runtimeChoiceRouters: [], inputSources: [], reviewerPerspectives: [], validationProviders: [], prdEnrichers: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [], extensions: [], candidates: [],
  } as NativeExtensionRegistry;
}

async function waitForTask(service: ExtensionAgentTaskService, taskId: string): Promise<any> {
  for (let i = 0; i < 250; i += 1) {
    const { task } = await service.get(taskId);
    if (task.status === 'completed') return task;
    if (task.status === 'failed') throw new Error(task.errorMessage);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for completed revision task');
}

class SubmitHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];
  constructor(private readonly submission: unknown) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    const agentId = 'agent-revision';
    yield { type: 'agent:start', agent, planId, agentId, model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', runtimeChoice: 'default', runtimeChoiceQualified: 'planning.default', runtimeChoiceSource: 'default', timestamp: new Date().toISOString() };
    const tool = options.customTools?.find((candidate) => candidate.name === 'submit_eforge_plan_planning_result');
    if (tool) {
      yield { type: 'agent:tool_use', agent, planId, agentId, tool: tool.name, toolUseId: 'tool-1', input: this.submission, timestamp: new Date().toISOString() };
      const output = await tool.handler(this.submission);
      yield { type: 'agent:tool_result', agent, planId, agentId, tool: tool.name, toolUseId: 'tool-1', output, timestamp: new Date().toISOString() };
    }
    yield { type: 'agent:result', agent, planId, agentId, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {} }, timestamp: new Date().toISOString() };
    yield { type: 'agent:stop', agent, planId, agentId, timestamp: new Date().toISOString() };
  }
}
