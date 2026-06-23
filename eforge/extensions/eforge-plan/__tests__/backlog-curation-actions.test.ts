import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { safeParseWithSchema } from '@eforge-build/client';
import { describe, expect, it } from 'vitest';
import { analyzeAllBacklogAction } from '../backlog-curation-actions.js';
import { AnalyzeAllBacklogInputSchema } from '../backlog-curation-schemas.js';
import { buildSource as buildBacklogCurationTaskSource } from '../backlog-curation-source-provider.js';
import { markPlanningTaskWorkflowEntryApplied, readPlanningTaskWorkflowIndex } from '../planning-task-workflow-store.js';
import { writeBacklogItem } from '../markdown-store.js';

const execFile = promisify(execFileCallback);

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('analyze-all-backlog action', () => {
  it('validates analyze-all input without a scan mode parameter', () => {
    expect(safeParseWithSchema(AnalyzeAllBacklogInputSchema, {}).success).toBe(true);
    expect(safeParseWithSchema(AnalyzeAllBacklogInputSchema, { scanMode: 'delta' }).success).toBe(false);
    expect(safeParseWithSchema(AnalyzeAllBacklogInputSchema, { scanMode: 'invalid-mode' }).success).toBe(false);
  });

  it('validates source-first item audit concurrency bounds', async () => {
    for (const itemAuditConcurrency of [1, 4, 8]) {
      expect(safeParseWithSchema(AnalyzeAllBacklogInputSchema, { itemAuditConcurrency }).success).toBe(true);
    }
    for (const itemAuditConcurrency of [0, -1, 1.5, 9]) {
      expect(safeParseWithSchema(AnalyzeAllBacklogInputSchema, { itemAuditConcurrency }).success).toBe(false);
    }

    await withTempProject(async (cwd) => {
      await expect(buildBacklogCurationTaskSource({ cwd, signal: new AbortController().signal, input: { itemAuditConcurrency: 9 } })).rejects.toThrow(/itemAuditConcurrency/);
    });
  });

  it('starts a curation planning task with workflow purpose and no build queue side effect', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const starts: unknown[] = [];
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            starts.push(request);
            return { task: { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { throw new Error('not found'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
        buildQueue: { async enqueue() { throw new Error('analyze-all-backlog must not enqueue builds'); } },
      };
      const output = await analyzeAllBacklogAction.handler({}, ctx as never) as { sourceFingerprint?: string };
      expect(output.sourceFingerprint).toBeUndefined();
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({ input: { requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, sourceProvider: { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource', input: { itemAuditConcurrency: 4 } } } });
      const index = await readPlanningTaskWorkflowIndex(cwd);
      expect(index.entries[0]).toMatchObject({ taskId: 'task-1', purpose: 'backlog-curation', itemAuditConcurrency: 4, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] });
    });
  });

  it('omits scan mode from the deferred source-provider input and workflow entry', async () => {
    await withTempProject(async (cwd) => {
      const starts: unknown[] = [];
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            starts.push(request);
            return { task: { taskId: 'task-backlog-analysis', kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { throw new Error('not found'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      const output = await analyzeAllBacklogAction.handler({}, ctx as never) as { entry: { scanMode?: string } };

      expect(starts[0]).toMatchObject({ input: { sourceProvider: { input: { itemAuditConcurrency: 4 } } } });
      expect(output.entry.scanMode).toBeUndefined();
    });
  });

  it('normalizes source-first concurrency into source-provider input and workflow entries', async () => {
    await withTempProject(async (cwd) => {
      const starts: unknown[] = [];
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            starts.push(request);
            return { task: { taskId: `task-${starts.length}`, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { throw new Error('not found'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      const full = await analyzeAllBacklogAction.handler({}, ctx as never) as { entry: { itemAuditConcurrency?: number } };
      const custom = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 8 }, ctx as never) as { entry: { itemAuditConcurrency?: number } };

      expect(starts[0]).toMatchObject({ input: { sourceProvider: { input: { itemAuditConcurrency: 4 } } } });
      expect(full.entry.itemAuditConcurrency).toBe(4);
      expect(starts[1]).toMatchObject({ input: { sourceProvider: { input: { itemAuditConcurrency: 8 } } } });
      expect(custom.entry.itemAuditConcurrency).toBe(8);
    });
  });

  it('reuses active source-first curation tasks only when normalized concurrency matches', async () => {
    await withTempProject(async (cwd) => {
      const started: unknown[] = [];
      const tasks = new Map<string, { taskId: string; kind: string; status: string; createdAt: string; updatedAt: string }>();
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            const task = { taskId: `task-${started.length + 1}`, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' };
            started.push(request);
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId: string) { const task = tasks.get(taskId); if (!task) throw new Error('not found'); return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      const first = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 2 }, ctx as never) as { task: { taskId: string } };
      const second = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 3 }, ctx as never) as { task: { taskId: string }; reused?: boolean };
      const firstAgain = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 2 }, ctx as never) as { task: { taskId: string }; reused?: boolean };

      expect(second.task.taskId).not.toBe(first.task.taskId);
      expect(second.reused).toBeUndefined();
      expect(firstAgain).toMatchObject({ task: { taskId: first.task.taskId }, reused: true });
      expect(started).toHaveLength(2);
    });
  });

  it('defers bounded shipped evidence source assembly to the daemon-owned background task', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'action-evidence', status: 'candidate', body: '# Action Evidence\n' });
      await git(cwd, ['checkout', '-b', 'feature/action-evidence']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src/action-evidence.ts'), 'Action Evidence action-evidence\n');
      await git(cwd, ['add', 'src/action-evidence.ts']);
      await git(cwd, ['commit', '-m', 'feat(action-evidence): action evidence']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/action-evidence', '-m', 'Merge pull request #777 from owner/action-evidence']);
      const starts: unknown[] = [];
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            starts.push(request);
            return { task: { taskId: 'task-evidence', kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { throw new Error('not found'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      await analyzeAllBacklogAction.handler({}, ctx as never);
      expect(starts[0]).toMatchObject({ input: { sourceProvider: { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource', input: { itemAuditConcurrency: 4 } } } });
      const { sourceText, backlogCurationMapReduce } = await buildBacklogCurationTaskSource({ cwd, signal: new AbortController().signal, input: {} });
      const packet = JSON.parse(sourceText) as { sourceFingerprint: string; shippedEvidenceCandidates: Array<Record<string, unknown>> };

      expect(backlogCurationMapReduce.sourceFingerprint).toBe(packet.sourceFingerprint);
      expect(backlogCurationMapReduce.globalContext.itemCount).toBe(1);
      expect(packet.shippedEvidenceCandidates).toEqual([expect.objectContaining({ itemId: 'action-evidence', confidence: 'strong', evidenceSource: 'git-history' })]);
      expect(sourceText).toContain('shippedEvidenceCandidates');
      expect(sourceText).toContain('src/action-evidence.ts');
    });
  });

  it('passes redraft context through deferred source-provider assembly', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'redraft-item', status: 'candidate', body: '# Redraft Item\n\n## Claim\n\nClaim\n' });
      const { sourceText } = await buildBacklogCurationTaskSource({
        cwd,
        signal: new AbortController().signal,
        input: { redraft: { parentTaskId: 'task-parent', steering: 'Close PR-linked items automatically when evidence is strong.' } },
      });
      const packet = JSON.parse(sourceText) as { redraft?: Record<string, unknown> };
      expect(packet.redraft).toMatchObject({ parentTaskId: 'task-parent', steering: 'Close PR-linked items automatically when evidence is strong.' });
    });
  });

  it.each(['queued', 'running'] as const)('reuses unapplied active %s curation tasks without building source first', async (status) => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const started: unknown[] = [];
      const tasks = new Map<string, { taskId: string; kind: string; status: string; createdAt: string; updatedAt: string; result?: unknown }>();
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            const task = { taskId: `task-${started.length + 1}`, kind: 'eforge-plan.planning-draft', status, createdAt: 'now', updatedAt: 'now' };
            started.push(task);
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId: string) { const task = tasks.get(taskId); if (!task) throw new Error('not found'); return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      await analyzeAllBacklogAction.handler({}, ctx as never);
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { reused?: boolean };
      expect(second.reused).toBe(true);
      expect(started).toHaveLength(1);
    });
  });

  it('reuses queued/running curation tasks only when source-first concurrency matches', async () => {
    await withTempProject(async (cwd) => {
      const started: unknown[] = [];
      const tasks = new Map<string, { taskId: string; kind: string; status: string; createdAt: string; updatedAt: string }>();
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            const task = { taskId: `task-${started.length + 1}`, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' };
            started.push(task);
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId: string) { const task = tasks.get(taskId); if (!task) throw new Error('not found'); return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      const first = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 4 }, ctx as never) as { task: { taskId: string }; reused?: boolean };
      const firstAgain = await analyzeAllBacklogAction.handler({}, ctx as never) as { task: { taskId: string }; reused?: boolean };
      const second = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 5 }, ctx as never) as { task: { taskId: string }; reused?: boolean };
      const secondAgain = await analyzeAllBacklogAction.handler({ itemAuditConcurrency: 5 }, ctx as never) as { task: { taskId: string }; reused?: boolean };

      expect(firstAgain).toMatchObject({ task: { taskId: first.task.taskId }, reused: true });
      expect(second.task.taskId).not.toBe(first.task.taskId);
      expect(second.reused).toBeUndefined();
      expect(secondAgain).toMatchObject({ task: { taskId: second.task.taskId }, reused: true });
      expect(started).toHaveLength(2);
    });
  });

  it.each(['failed', 'cancelled'] as const)('starts a new task when the same-fingerprint entry points to a %s daemon task', async (status) => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      let starts = 0;
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            starts += 1;
            return { task: { taskId: starts === 1 ? 'old-task' : `new-after-${status}`, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { return { task: { taskId: 'old-task', kind: 'eforge-plan.planning-draft', status, createdAt: 'now', updatedAt: 'now' } }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      await analyzeAllBacklogAction.handler({}, ctx as never);
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { task: { taskId: string }; reused?: boolean };
      expect(second.task.taskId).toBe(`new-after-${status}`);
      expect(second.reused).toBeUndefined();
      expect(starts).toBe(2);
    });
  });

  it('starts a new task when a completed same-fingerprint curation entry has no applicable draft', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      let starts = 0;
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            starts += 1;
            return { task: { taskId: starts === 1 ? 'bad-completed' : 'replacement-task', kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: 'ready', assumptionsOpenQuestions: [] } } };
          },
          async get(taskId: string) { return { task: { taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: 'ready', assumptionsOpenQuestions: [] } } }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      await analyzeAllBacklogAction.handler({}, ctx as never);
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { task: { taskId: string }; reused?: boolean };
      expect(second.task.taskId).toBe('replacement-task');
      expect(second.reused).toBeUndefined();
      expect(starts).toBe(2);
    });
  });

  it('starts a new task instead of synchronously validating completed needs-input curation entries', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      let starts = 0;
      const tasks = new Map<string, { taskId: string; kind: string; status: string; createdAt: string; updatedAt: string; result?: unknown }>();
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            starts += 1;
            const task = { taskId: 'needs-input-task', kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: 'Need input.', assumptionsOpenQuestions: [], decision: 'needs-input', clarificationQuestions: [{ question: 'Which scope?' }], rationale: 'Need scope.' } };
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId: string) { const task = tasks.get(taskId); if (!task) throw new Error('not found'); return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      await analyzeAllBacklogAction.handler({}, ctx as never);
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { reused?: boolean };
      expect(second.reused).toBeUndefined();
      expect(starts).toBe(2);
    });
  });

  it('rethrows operational task lookup failures instead of starting duplicates', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      let starts = 0;
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() { starts += 1; return { task: { taskId: 'task-1', kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: 'now', updatedAt: 'now' } }; },
          async get() { throw new Error('storage unavailable'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      await analyzeAllBacklogAction.handler({}, ctx as never);
      await expect(analyzeAllBacklogAction.handler({}, ctx as never)).rejects.toThrow(/storage unavailable/);
      expect(starts).toBe(1);
    });
  });

  it('starts a new task when a completed same-fingerprint curation entry has already been applied', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      let starts = 0;
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start() {
            starts += 1;
            return { task: { taskId: starts === 1 ? 'curation-preview' : 'curation-after-apply', kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: 'now', updatedAt: 'now', result: { summary: 'ready', assumptionsOpenQuestions: [], backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: 'placeholder', summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } } } };
          },
          async get(taskId: string) { return { task: { taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: 'now', updatedAt: 'now' } }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      const first = await analyzeAllBacklogAction.handler({}, ctx as never) as { task: { taskId: string } };
      await markPlanningTaskWorkflowEntryApplied(cwd, first.task.taskId, '2026-01-01T00:00:00.000Z');
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { task: { taskId: string }; reused?: boolean };
      expect(second.task.taskId).toBe('curation-after-apply');
      expect(second.reused).toBeUndefined();
      expect(starts).toBe(2);
    });
  });
});

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@example.com']);
  await git(cwd, ['config', 'user.name', 'Test User']);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await execFile('git', [...args], { cwd });
}
