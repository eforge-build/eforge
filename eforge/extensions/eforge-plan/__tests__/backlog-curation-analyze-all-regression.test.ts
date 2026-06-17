import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { analyzeAllBacklogAction } from '../backlog-curation-actions.js';
import { buildSource as buildBacklogCurationTaskSource } from '../backlog-curation-source-provider.js';
import { writeBacklogItem } from '../markdown-store.js';

const execFile = promisify(execFileCallback);

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-analyze-all-gap-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

describe('analyze-all shipped evidence regression', () => {
  it('can produce a shipped itemChange from strong reachable PR evidence without lifecycle trace', async () => {
    await withTempProject(async (cwd) => {
      await initRepo(cwd);
      await writeFile(join(cwd, 'README.md'), 'base\n');
      await git(cwd, ['add', 'README.md']);
      await git(cwd, ['commit', '-m', 'initial']);
      await writeBacklogItem(cwd, { id: 'analyze-shipped-item', status: 'candidate', body: '# Analyze Shipped Item\n' });
      await git(cwd, ['checkout', '-b', 'feature/analyze-shipped-item']);
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(join(cwd, 'src/analyze-shipped-item.ts'), 'Analyze Shipped Item analyze-shipped-item\n');
      await git(cwd, ['add', 'src/analyze-shipped-item.ts']);
      await git(cwd, ['commit', '-m', 'feat(analyze-shipped-item): analyze shipped item']);
      await git(cwd, ['checkout', 'main']);
      await git(cwd, ['merge', '--no-ff', 'feature/analyze-shipped-item', '-m', 'Merge pull request #515 from owner/feature/analyze-shipped-item']);
      const starts: unknown[] = [];
      const ctx = {
        cwd,
        signal: new AbortController().signal,
        agentTasks: {
          async start(request: unknown) {
            starts.push(request);
            return { task: { taskId: 'analyze-shipped-task', kind: 'eforge-plan.planning-draft', status: 'running', createdAt: 'now', updatedAt: 'now' } };
          },
          async get() { throw new Error('not found'); },
          async cancel() { throw new Error('unexpected cancel'); },
        },
      };

      await analyzeAllBacklogAction.handler({}, ctx as never);
      expect(starts[0]).toMatchObject({ input: { sourceProvider: { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource' } } });
      const { sourceText } = await buildBacklogCurationTaskSource({ cwd, signal: new AbortController().signal });
      const source = JSON.parse(sourceText) as {
        openItems: Array<{ id: string; precondition: Record<string, unknown> }>;
        shippedEvidenceCandidates: Array<{ itemId: string; confidence: string; citations?: string[] }>;
      };
      const evidence = source.shippedEvidenceCandidates.find((candidate) => candidate.itemId === 'analyze-shipped-item' && candidate.confidence === 'strong');
      const item = source.openItems.find((entry) => entry.id === 'analyze-shipped-item');
      const itemChanges = evidence && item ? [{ id: 'analyze-shipped-item', metadata: { status: 'shipped' }, evidence: evidence.citations ?? [] }] : [];

      expect(itemChanges).toEqual([
        expect.objectContaining({ id: 'analyze-shipped-item', metadata: { status: 'shipped' }, evidence: [expect.stringContaining('Merge pull request #515')] }),
      ]);
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
