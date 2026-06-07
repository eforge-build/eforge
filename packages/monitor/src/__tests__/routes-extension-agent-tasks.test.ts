import { request } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, type EforgeEvent } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole } from '@eforge-build/engine/events';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { openDatabase, type MonitorDB } from '../db.js';
import { startServer } from '../server.js';
import { ExtensionAgentTaskService } from '../routes/extensions/agent-task-service.js';
import { createMonitorContext } from '../context.js';
import { resolveAgentTaskRecordPath } from '../routes/extensions/agent-task-store.js';

const submittedResult = {
  summary: 'Drafted a plan',
  assumptionsOpenQuestions: ['Confirm scope'],
  planDrafts: [{ title: 'Plan A', body: 'Implement A' }],
};

describe('extension agent task routes and service', () => {
  it('starts, persists, reads, completes, and emits sanitized lifecycle events', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-'));
    const harness = new SubmitHarness(submittedResult);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const start = await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Build plans' } });
      expect(start.status).toBe(200);
      const startBody = await start.json() as { task: { taskId: string; status: string } };
      expect(startBody.task.status).toBe('running');
      const get = await fetch(`${server.url}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: startBody.task.taskId })}`);
      expect(get.status).toBe(200);
      expect((await get.json()).task.taskId).toBe(startBody.task.taskId);

      const completed = await waitForTask(server.url, startBody.task.taskId, 'completed');
      expect(completed.result).toEqual(submittedResult);
      expect(harness.calls[0]?.tools).toBe('read-only');
      expect(taskEvents(db, startBody.task.taskId).map((event) => event.type)).toEqual([
        'extension:agent-task:start',
        'extension:agent-task:progress',
        'extension:agent-task:complete',
      ]);
    } finally {
      await server.stop();
    }
  });

  it('writes a running record before queueing the harness call', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-service-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const harness = new SubmitHarness(submittedResult);
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start({ kind: 'eforge-plan.planning-draft', input: { topic: 'Build plans' } });
      const raw = JSON.parse(await readFile(resolveAgentTaskRecordPath(cwd, started.task.taskId), 'utf-8')) as { status: string };
      expect(raw.status).toBe('running');
      expect(harness.calls).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('cancels a running task and emits cancellation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-cancel-'));
    const harness = new AbortAwareHarness();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Cancel me' } })).json() as { task: { taskId: string } };
      await harness.started;
      const cancel = await postJson(server.url, buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId: startBody.task.taskId }), { reason: 'operator' });
      expect(cancel.status).toBe(200);
      expect((await cancel.json()).task.status).toBe('cancelled');
      expect(harness.aborted).toBe(true);
      expect(taskEvents(db, startBody.task.taskId).map((event) => event.type)).toContain('extension:agent-task:cancelled');
    } finally {
      await server.stop();
    }
  });

  it('maps failures to failed task records without crashing the daemon', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-fail-'));
    const harness = new FailingHarness(new Error('secret failure details'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Fail' } })).json() as { task: { taskId: string } };
      const failed = await waitForTask(server.url, startBody.task.taskId, 'failed');
      expect(failed.errorMessage).toContain('secret failure details');
      expect(await fetch(`${server.url}${API_ROUTES.health}`)).toBeDefined();
      expect(taskEvents(db, startBody.task.taskId).map((event) => event.type)).toContain('extension:agent-task:failed');
    } finally {
      await server.stop();
    }
  });

  it('rejects unsafe requests with expected status codes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-security-'));
    const server = await startServer(openDatabase(join(cwd, '.eforge', 'monitor.db')), 0, { cwd, agentRuntimes: singletonRegistry(new SubmitHarness(submittedResult)) });
    try {
      expect((await rawPost(server.port, API_ROUTES.extensionAgentTaskStart, '{}', { Host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
      expect((await rawPost(server.port, API_ROUTES.extensionAgentTaskStart, '{}', { Host: 'localhost', 'Sec-Fetch-Site': 'cross-site', 'content-type': 'application/json' })).status).toBe(403);
      expect((await fetch(`${server.url}${API_ROUTES.extensionAgentTaskStart}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
      expect((await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'unsupported', input: { topic: 'x' } })).status).toBe(400);
      expect((await fetch(`${server.url}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'bad id' })}`)).status).toBe(400);
      expect((await fetch(`${server.url}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'task-missing' })}`)).status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitForTask(base: string, taskId: string, status: string): Promise<any> {
  for (let i = 0; i < 50; i += 1) {
    const body = await (await fetch(`${base}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId })}`)).json() as { task: any };
    if (body.task.status === status) return body.task;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${status}`);
}

function taskEvents(db: MonitorDB, taskId: string): Array<Record<string, any>> {
  return db.getDaemonEventsAfter(0)
    .map((event) => JSON.parse(event.data) as Record<string, any>)
    .filter((event) => event.taskId === taskId);
}

function rawPost(port: number, path: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: responseBody }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

class SubmitHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];
  constructor(private readonly submission: unknown) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    const agentId = 'agent-submit';
    yield { type: 'agent:start', agent, planId, agentId, model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
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

class FailingHarness implements AgentHarness {
  constructor(private readonly error: Error) {}
  effectiveCustomToolName(name: string): string { return name; }
  async *run(_options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    yield { type: 'agent:start', agent, planId, agentId: 'agent-fail', model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    throw this.error;
  }
}

class AbortAwareHarness implements AgentHarness {
  aborted = false;
  private resolveStarted!: () => void;
  readonly started = new Promise<void>((resolve) => { this.resolveStarted = resolve; });

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    yield { type: 'agent:start', agent, planId, agentId: 'agent-1', model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    await new Promise<void>((resolve) => {
      options.abortSignal?.addEventListener('abort', () => { this.aborted = true; resolve(); }, { once: true });
      this.resolveStarted();
    });
    throw new Error('aborted');
  }
}
