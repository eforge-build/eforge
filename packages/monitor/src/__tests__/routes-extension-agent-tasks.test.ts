import { request } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  recommendations: { schemaVersion: 1, activeWork: [], readyCandidates: [{ itemId: 'item-one' }], recommendedNextSequence: [], safeParallelizableGroups: [], blockedChains: [], rationaleAndAssumptions: [] },
  handoffDrafts: [{ selection: { itemIds: ['item-one'], status: 'active' }, session: 'handoff-one' }],
  planDrafts: [{ title: 'Plan A', body: 'Implement A' }],
};

const BODY_SHA = 'a'.repeat(64);

const backlogCurationDraft = {
  schemaVersion: 1,
  sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
  summary: ['Curated stale backlog records.'],
  itemChanges: [{
    id: 'item-1',
    kind: 'item',
    precondition: { id: 'item-1', kind: 'item', bodySha256: BODY_SHA, sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111' },
    metadata: { last_checked: '2026-01-01', stale_after: '2026-02-01' },
    sectionOperations: [{ heading: 'Evidence', action: 'append', content: 'Durable evidence from source text.' }],
    rationale: 'The item has fresh implementation evidence.',
    evidence: ['Source text says the item remains active.'],
  }],
  epicChanges: [],
  noOpRechecks: [],
  skipped: [],
  needsInput: [],
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
      const events = taskEvents(db, startBody.task.taskId);
      expect(events.map((event) => event.type)).toEqual([
        'extension:agent-task:start',
        'extension:agent-task:progress',
        'extension:agent-task:complete',
      ]);
      expect(events.map((event) => event.extensionName)).toEqual(['daemon-route', 'daemon-route', 'daemon-route']);
      expect(events.map((event) => event.status)).toEqual(['running', 'running', 'completed']);
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('persists section progress reports to the record and daemon events', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-progress-'));
    const progress = { currentSection: 'scope', coveredSections: ['summary'], remainingSections: ['risks', 'verification'], message: 'Drafting scope' };
    const harness = new ProgressSubmitHarness(submittedResult, progress);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Build plans', requestedOutputSections: ['planDrafts'] } })).json() as { task: { taskId: string } };
      const completed = await waitForTask(server.url, startBody.task.taskId, 'completed');
      expect(completed.metadata.sectionProgress).toEqual({ currentSection: 'scope', coveredSections: ['summary'], remainingSections: ['risks', 'verification'] });
      const events = taskEvents(db, startBody.task.taskId);
      const progressEvents = events.filter((event) => event.type === 'extension:agent-task:progress');
      const sectionEvent = progressEvents.find((event) => event.metadata?.sectionProgress?.currentSection === 'scope');
      expect(sectionEvent).toBeDefined();
      expect(sectionEvent?.metadata.sectionProgress).toEqual({ currentSection: 'scope', coveredSections: ['summary'], remainingSections: ['risks', 'verification'] });
      expect(sectionEvent?.status).toBe('running');
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('completes a task with a ready session-plan creation draft', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-creation-'));
    const creationResult = {
      summary: 'Created a session-plan draft.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: {
        session: 'demo-session',
        topic: 'Build plans',
        planningType: 'feature',
        planningDepth: 'focused',
        sections: [{ dimension: 'scope', content: 'Generated scope.' }],
      },
    };
    const harness = new SubmitHarness(creationResult);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Build plans', requestedOutputSections: ['sessionPlanCreationDraft'] } })).json() as { task: { taskId: string } };
      const completed = await waitForTask(server.url, startBody.task.taskId, 'completed');
      expect(completed.result).toEqual(creationResult);
      expect(completed.metadata.outputSectionCount).toBe(1);
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('completes a curation-only task with one output section', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-curation-'));
    const curationResult = {
      summary: 'Drafted backlog curation.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft,
    };
    const harness = new SubmitHarness(curationResult);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] } })).json() as { task: { taskId: string } };
      const completed = await waitForTask(server.url, startBody.task.taskId, 'completed');
      expect(completed.result).toEqual(curationResult);
      expect(completed.metadata.outputSectionCount).toBe(1);
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('counts curation and recommendations as separate completed output sections', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-curation-recommendations-'));
    const curationWithRecommendations = {
      summary: 'Drafted backlog curation with recommendations.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft,
      recommendations: { schemaVersion: 1, activeWork: [], readyCandidates: [{ itemId: 'item-1' }], recommendedNextSequence: [], safeParallelizableGroups: [], blockedChains: [], rationaleAndAssumptions: [] },
    };
    const harness = new SubmitHarness(curationWithRecommendations);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft', 'recommendations'] } })).json() as { task: { taskId: string } };
      const completed = await waitForTask(server.url, startBody.task.taskId, 'completed');
      expect(completed.result).toEqual(curationWithRecommendations);
      expect(completed.metadata.outputSectionCount).toBe(2);
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails a task whose curation draft submission is malformed without persisting a result', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-curation-malformed-'));
    const malformedResult = {
      summary: 'Malformed backlog curation.',
      assumptionsOpenQuestions: [],
      backlogCurationDraft: {
        ...backlogCurationDraft,
        itemChanges: [{ ...backlogCurationDraft.itemChanges[0], precondition: { id: 'item-1', kind: 'item' } }],
      },
    };
    const harness = new SubmitHarness(malformedResult);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Curate backlog', requestedOutputSections: ['backlogCurationDraft'] } })).json() as { task: { taskId: string } };
      const failed = await waitForTask(server.url, startBody.task.taskId, 'failed');
      expect(failed.status).toBe('failed');
      expect(failed.result).toBeUndefined();
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('writes a running record before queueing the harness call', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-service-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    let startedTaskId = '';
    let resolveRecorded!: () => void;
    let rejectRecorded!: (error: unknown) => void;
    const recordedRunning = new Promise<void>((resolve, reject) => { resolveRecorded = resolve; rejectRecorded = reject; });
    const harness = new SubmitHarness(submittedResult, async (_options, _agent, taskId) => {
      try {
        startedTaskId = taskId ?? '';
        const raw = JSON.parse(await readFile(resolveAgentTaskRecordPath(cwd, startedTaskId), 'utf-8')) as { status: string };
        expect(raw.status).toBe('running');
        resolveRecorded();
      } catch (error) {
        rejectRecorded(error);
        throw error;
      }
    });
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start({ kind: 'eforge-plan.planning-draft', input: { topic: 'Build plans' } });
      expect(started.task.status).toBe('running');
      await waitFor(() => startedTaskId === started.task.taskId);
      await recordedRunning;
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('resolves deferred source providers in the background task before running the planner', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-source-provider-'));
    const extensionRoot = join(cwd, '.eforge', 'extensions', 'source-owner');
    await mkdir(extensionRoot, { recursive: true });
    await writeFile(join(extensionRoot, 'source-provider.mjs'), `export function buildSource({ input }) { return { sourceText: 'deferred-source:' + input.marker }; }\n`);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const harness = new SubmitHarness(submittedResult);
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start(
        { kind: 'eforge-plan.planning-draft', input: { topic: 'Build with deferred source', sourceProvider: { module: './source-provider.mjs', exportName: 'buildSource', input: { marker: 'alpha' } } } },
        { owner: { extensionName: 'source-owner', extensionPath: extensionRoot } },
      );
      await waitFor(() => taskEvents(db, started.task.taskId).some((event) => event.type === 'extension:agent-task:complete'));
      expect(String(harness.calls[0]?.prompt)).toContain('deferred-source:alpha');
      expect(taskEvents(db, started.task.taskId).some((event) => event.metadata?.progressMessage === 'Preparing planner source')).toBe(true);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('resolves deferred source providers relative to file-layout extension directories', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-file-source-provider-'));
    const extensionDir = join(cwd, '.eforge', 'extensions');
    const extensionPath = join(extensionDir, 'source-owner.mjs');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(extensionPath, `export default function extension() {}\n`);
    await writeFile(join(extensionDir, 'source-provider.mjs'), `export function buildSource({ input }) { return { sourceText: 'file-layout-source:' + input.marker }; }\n`);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const harness = new SubmitHarness(submittedResult);
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start(
        { kind: 'eforge-plan.planning-draft', input: { topic: 'Build with file-layout deferred source', sourceProvider: { module: './source-provider.mjs', exportName: 'buildSource', input: { marker: 'beta' } } } },
        { owner: { extensionName: 'source-owner', extensionPath } },
      );
      await waitFor(() => taskEvents(db, started.task.taskId).some((event) => event.type === 'extension:agent-task:complete'));
      expect(String(harness.calls[0]?.prompt)).toContain('file-layout-source:beta');
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('emits owner extension name for extension-owned service tasks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-owner-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(new SubmitHarness(submittedResult)) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start(
        { kind: 'eforge-plan.planning-draft', input: { topic: 'Build owner plans' } },
        { owner: { extensionName: 'owner-extension', extensionPath: '/project/.eforge/extensions/owner-extension.js' } },
      );
      await waitFor(() => taskEvents(db, started.task.taskId).some((event) => event.type === 'extension:agent-task:complete'));
      const events = taskEvents(db, started.task.taskId);
      expect(events.map((event) => event.extensionName)).toEqual(['owner-extension', 'owner-extension', 'owner-extension']);
      expect(events.map((event) => event.status)).toEqual(['running', 'running', 'completed']);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
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
      const events = taskEvents(db, startBody.task.taskId);
      expect(events.map((event) => event.type)).toContain('extension:agent-task:cancelled');
      expect(events.find((event) => event.type === 'extension:agent-task:cancelled')).toMatchObject({ extensionName: 'daemon-route', status: 'cancelled' });
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
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
      const events = taskEvents(db, startBody.task.taskId);
      expect(events.map((event) => event.type)).toContain('extension:agent-task:failed');
      expect(events.find((event) => event.type === 'extension:agent-task:failed')).toMatchObject({ extensionName: 'daemon-route', status: 'failed' });
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('fails a task whose harness never submits with the sanitized non-submission error', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-no-submit-'));
    const harness = new NoSubmitHarness();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const startBody = await (await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'Never submit' } })).json() as { task: { taskId: string } };
      const failed = await waitForTask(server.url, startBody.task.taskId, 'failed');
      expect(failed.errorMessage).toContain('did not call submit_eforge_plan_planning_result');
      expect(failed.errorMessage.length).toBeLessThanOrEqual(1000);
      // Sanitized: no ASCII control characters survive into the persisted error message.
      // eslint-disable-next-line no-control-regex
      expect(/[\u0000-\u001f\u007f]/.test(failed.errorMessage)).toBe(false);
      expect(failed.result).toBeUndefined();
      const events = taskEvents(db, startBody.task.taskId);
      const failedEvent = events.find((event) => event.type === 'extension:agent-task:failed');
      expect(failedEvent).toMatchObject({ extensionName: 'daemon-route', status: 'failed' });
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects unsafe requests with expected status codes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-security-'));
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, agentRuntimes: singletonRegistry(new SubmitHarness(submittedResult)) });
    try {
      expect((await rawPost(server.port, API_ROUTES.extensionAgentTaskStart, '{}', { Host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
      expect((await rawPost(server.port, API_ROUTES.extensionAgentTaskStart, '{}', { Host: 'localhost', 'Sec-Fetch-Site': 'cross-site', 'content-type': 'application/json' })).status).toBe(403);
      expect((await fetch(`${server.url}${API_ROUTES.extensionAgentTaskStart}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
      expect((await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'unsupported', input: { topic: 'x' } })).status).toBe(400);
      expect((await postJson(server.url, API_ROUTES.extensionAgentTaskStart, { kind: 'eforge-plan.planning-draft', input: { topic: 'x', sourceProvider: { module: './provider.mjs' } } })).status).toBe(400);
      expect((await fetch(`${server.url}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'bad id' })}`)).status).toBe(400);
      expect((await fetch(`${server.url}${buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'task-missing' })}`)).status).toBe(404);
    } finally {
      await server.stop();
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 250; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

async function waitForTask(base: string, taskId: string, status: string): Promise<any> {
  for (let i = 0; i < 250; i += 1) {
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
  constructor(
    private readonly submission: unknown,
    private readonly onRun?: (options: AgentRunOptions, agent: AgentRole, planId?: string) => Promise<void>,
  ) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    await this.onRun?.(options, agent, planId);
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

class ProgressSubmitHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];
  constructor(private readonly submission: unknown, private readonly progress: unknown) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    const agentId = 'agent-progress';
    yield { type: 'agent:start', agent, planId, agentId, model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    const progressTool = options.customTools?.find((candidate) => candidate.name === 'report_eforge_plan_planning_progress');
    if (progressTool) {
      yield { type: 'agent:tool_use', agent, planId, agentId, tool: progressTool.name, toolUseId: 'tool-progress', input: this.progress, timestamp: new Date().toISOString() };
      const output = await progressTool.handler(this.progress);
      yield { type: 'agent:tool_result', agent, planId, agentId, tool: progressTool.name, toolUseId: 'tool-progress', output, timestamp: new Date().toISOString() };
    }
    const submitTool = options.customTools?.find((candidate) => candidate.name === 'submit_eforge_plan_planning_result');
    if (submitTool) {
      yield { type: 'agent:tool_use', agent, planId, agentId, tool: submitTool.name, toolUseId: 'tool-1', input: this.submission, timestamp: new Date().toISOString() };
      const output = await submitTool.handler(this.submission);
      yield { type: 'agent:tool_result', agent, planId, agentId, tool: submitTool.name, toolUseId: 'tool-1', output, timestamp: new Date().toISOString() };
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

class NoSubmitHarness implements AgentHarness {
  effectiveCustomToolName(name: string): string { return name; }
  async *run(_options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = 'agent-no-submit';
    yield { type: 'agent:start', agent, planId, agentId, model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    yield { type: 'agent:result', agent, planId, agentId, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {} }, timestamp: new Date().toISOString() };
    yield { type: 'agent:stop', agent, planId, agentId, timestamp: new Date().toISOString() };
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
