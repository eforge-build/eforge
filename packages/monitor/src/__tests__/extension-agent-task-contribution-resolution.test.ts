import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { EforgePlanPlanningDraftInputSchema, EforgePlanPlanningDraftResultSchema } from '@eforge-build/client';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import { openDatabase } from '../db.js';
import { createMonitorContext } from '../context.js';
import { ExtensionAgentTaskService } from '../routes/extensions/agent-task-service.js';

describe('extension agent task contribution resolution', () => {
  it('requires a registered contribution for legacy-kind starts and does not fall back', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-contribution-legacy-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    try {
      const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry({ async *run() {}, effectiveCustomToolName: (name: string) => name }) });
      const service = new ExtensionAgentTaskService(context);
      await expect(service.start({ kind: 'eforge-plan.planning-draft', input: { topic: 'No fallback' } })).rejects.toMatchObject({ status: 404 });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('resolves prompt templates from export prompt sources', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-contribution-export-'));
    const extensionRoot = join(cwd, 'extension');
    await mkdir(extensionRoot, { recursive: true });
    await writeFile(join(extensionRoot, 'prompts.mjs'), `export function buildPrompt() { return 'Prompt from export'; }\n`, 'utf-8');
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    try {
      const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry({ async *run() {}, effectiveCustomToolName: (name: string) => name }) });
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start({ task: { id: 'export-task', extensionName: 'export-owner' }, input: { topic: 'Export' } }, { registry: registryWithTask('export-owner', extensionRoot, { kind: 'export', module: './prompts.mjs', exportName: 'buildPrompt' }) });
      expect(started.task.status).toBe('running');
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects unknown owner-scoped task contributions before enqueueing work', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-contribution-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    try {
      const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry({ async *run() {}, effectiveCustomToolName: (name: string) => name }) });
      const service = new ExtensionAgentTaskService(context);
      await expect(service.start({ task: { id: 'missing-task' }, input: {} })).rejects.toMatchObject({ status: 404 });
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function registryWithTask(extensionName: string, extensionPath: string, prompt: { kind: 'asset'; asset: string } | { kind: 'export'; module: string; exportName?: string }): NativeExtensionRegistry {
  return {
    agentTasks: [{ kind: 'agentTask', extensionName, extensionPath, localId: 'export-task', id: `${extensionName}:export-task`, value: { id: 'export-task', title: 'Export task', inputSchema: EforgePlanPlanningDraftInputSchema, outputSchema: EforgePlanPlanningDraftResultSchema, prompt } }],
    actions: [], tools: [], eventHooks: [], agentRunHooks: [], policyGates: [], profileRouters: [], runtimeChoiceRouters: [], inputSources: [], reviewerPerspectives: [], validationProviders: [], prdEnrichers: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [], extensions: [], candidates: [],
  } as NativeExtensionRegistry;
}
