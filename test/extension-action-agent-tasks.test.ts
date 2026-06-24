import { describe, expect, it } from 'vitest';
import { Type } from '@eforge-build/extension-sdk';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/index';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';

const extensionName = 'tasks';
const extensionPath = '/project/.eforge/extensions/tasks.mjs';

describe('extension action agent task API', () => {
  it('provides ctx.agentTasks and delegates start/get/cancel to the daemon provider', async () => {
    const calls: string[] = [];
    const registry = registryWithAction(async (_input, ctx: any) => {
      const started = await ctx.agentTasks.start({ kind: 'eforge-plan.planning-draft', input: { topic: 'demo' } });
      const got = await ctx.agentTasks.get(started.task.taskId);
      const cancelled = await ctx.agentTasks.cancel(got.task.taskId, 'done');
      return { taskId: cancelled.task.taskId };
    });

    const result = await dispatchExtensionAction(registry, {
      actionId: 'tasks:run',
      input: {},
      requestedBy: { host: 'console' },
      cwd: '/project',
      timeoutMs: 1000,
      agentTasks(extension) {
        expect(extension).toEqual({ extensionName, extensionPath });
        return {
          async start(request) {
            calls.push(`start:${request.kind}:${request.input.topic}`);
            return { task: { taskId: 'task-123', kind: request.kind, status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' } };
          },
          async get(taskId) {
            calls.push(`get:${taskId}`);
            return { task: { taskId, kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' } };
          },
          async cancel(taskId, reason) {
            calls.push(`cancel:${taskId}:${reason}`);
            return { task: { taskId, kind: 'eforge-plan.planning-draft', status: 'cancelled', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', cancelledAt: '2026-01-01T00:00:01.000Z', errorMessage: reason } };
          },
        };
      },
    });

    expect(result).toMatchObject({ kind: 'success', output: { taskId: 'task-123' } });
    expect(calls).toEqual(['start:eforge-plan.planning-draft:demo', 'get:task-123', 'cancel:task-123:done']);
  });

  it('provides immutable dependency and capability lookup data on action context', async () => {
    const registry = registryWithAction((_input, ctx: any) => ({
      dependency: ctx.dependencies.get('provider').available,
      capability: ctx.capabilities.get('demo.capability', '>=1.0.0').available,
      providerCount: ctx.capabilities.get('demo.capability').providers.length,
    }), Type.Object({
      dependency: Type.Boolean(),
      capability: Type.Boolean(),
      providerCount: Type.Number(),
    }, { additionalProperties: false }));
    registry.extensions.push({
      name: 'provider',
      path: '/project/.eforge/extensions/provider.mjs',
      entrypoint: '/project/.eforge/extensions/provider.mjs',
      scope: 'project-local',
      source: 'auto',
      strategy: 'dynamic-import',
      capabilities: [{ name: 'demo.capability', version: '1.0.0' }],
      registrations: emptyRegistrations(),
    });

    const result = await dispatchExtensionAction(registry, {
      actionId: 'tasks:run',
      input: {},
      requestedBy: { host: 'console' },
      cwd: '/project',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ kind: 'success', output: { dependency: true, capability: true, providerCount: 1 } });
  });
});

function emptyRegistrations() {
  return {
    eventHooks: 0,
    agentRunHooks: 0,
    policyGates: 0,
    profileRouters: 0,
    inputSources: 0,
    reviewerPerspectives: 0,
    validationProviders: 0,
    tools: 0,
    prdEnrichers: 0,
    actions: 0,
    agentTasks: 0,
    consoleContributions: 0,
    consoleWorkstations: 0,
    integrationCommands: 0,
    deepLinks: 0,
  };
}

function registryWithAction(handler: (input: Record<string, unknown>, ctx: unknown) => unknown, outputSchema = Type.Object({ taskId: Type.String() }, { additionalProperties: false })): NativeExtensionRegistry {
  return {
    extensions: [],
    candidates: [],
    diagnostics: [],
    eventHooks: [],
    agentRunHooks: [],
    policyGates: [],
    profileRouters: [],
    inputSources: [],
    reviewerPerspectives: [],
    validationProviders: [],
    tools: [],
    prdEnrichers: [],
    agentTasks: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    actions: [{
      kind: 'action',
      extensionName,
      extensionPath,
      localId: 'run',
      id: 'tasks:run',
      value: {
        id: 'run',
        title: 'Run task',
        inputSchema: Type.Object({}, { additionalProperties: false }),
        outputSchema,
        handler,
      },
    }],
  } as NativeExtensionRegistry;
}
