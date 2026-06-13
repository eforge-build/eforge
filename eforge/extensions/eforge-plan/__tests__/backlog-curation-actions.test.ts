import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { analyzeAllBacklogAction } from '../backlog-curation-actions.js';
import { markPlanningTaskWorkflowEntryApplied, readPlanningTaskWorkflowIndex } from '../planning-task-workflow-store.js';
import { writeBacklogItem } from '../markdown-store.js';

const execFile = promisify(execFileCallback);

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-curation-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('analyze-all-backlog action', () => {
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
      const output = await analyzeAllBacklogAction.handler({}, ctx as never) as { sourceFingerprint: string };
      expect(output.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({ input: { requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true } });
      const index = await readPlanningTaskWorkflowIndex(cwd);
      expect(index.entries[0]).toMatchObject({ taskId: 'task-1', purpose: 'backlog-curation', requestedOutputSections: ['backlogCurationDraft', 'recommendations'] });
    });
  });

  it('starts the daemon task with bounded shipped evidence in sourceText before model assembly', async () => {
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
      const sourceText = (starts[0] as { input: { sourceText: string } }).input.sourceText;
      const packet = JSON.parse(sourceText) as { shippedEvidenceCandidates: Array<Record<string, unknown>> };

      expect(packet.shippedEvidenceCandidates).toEqual([expect.objectContaining({ itemId: 'action-evidence', confidence: 'strong', source: 'git-history' })]);
      expect(sourceText).toContain('shippedEvidenceCandidates');
      expect(sourceText).toContain('src/action-evidence.ts');
    });
  });

  it.each(['queued', 'running', 'completed'] as const)('reuses unapplied %s same-fingerprint curation tasks', async (status) => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-1', status: 'candidate', body: '# Item 1\n\n## Claim\n\nClaim\n' });
      const started: unknown[] = [];
      const tasks = new Map<string, { taskId: string; kind: string; status: string; createdAt: string; updatedAt: string; result?: unknown }>();
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            const sourceText = (request as { input: { sourceText: string } }).input.sourceText;
            const sourceFingerprint = (JSON.parse(sourceText) as { sourceFingerprint: string }).sourceFingerprint;
            const task = { taskId: `task-${started.length + 1}`, kind: 'eforge-plan.planning-draft', status, createdAt: 'now', updatedAt: 'now', ...(status === 'completed' && { result: { summary: 'ready', assumptionsOpenQuestions: [], backlogCurationDraft: { schemaVersion: 1, sourceFingerprint, summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } } }) };
            started.push(task);
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId: string) { const task = tasks.get(taskId); if (!task) throw new Error('not found'); return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };
      const first = await analyzeAllBacklogAction.handler({}, ctx as never) as { sourceFingerprint: string };
      const second = await analyzeAllBacklogAction.handler({}, ctx as never) as { sourceFingerprint: string; reused?: boolean };
      expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
      expect(second.reused).toBe(true);
      expect(started).toHaveLength(1);
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

  it('reuses a completed same-fingerprint needs-input curation entry', async () => {
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
      expect(second.reused).toBe(true);
      expect(starts).toBe(1);
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
