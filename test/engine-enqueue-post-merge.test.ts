import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent, BuildOptions, CompileOptions } from '@eforge-build/engine/events';
import { loadQueue, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { runQueuedPrdBuild, type QueuedPrdBuildContext } from '@eforge-build/engine/queue/build-single-prd';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { appendAcceptanceCriteriaInventoryBlock, parseAcceptanceCriteriaExtractorOutput } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-engine-enqueue-post-merge-');

async function setupProject(tmpDir: string): Promise<void> {
  execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], { cwd: tmpDir });
  await mkdir(resolve(tmpDir, 'eforge'), { recursive: true });
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), 'plugins:\n  enabled: false\n', 'utf-8');
}

function formattedPrd(): string {
  return [
    '# Post Merge Queue Contract',
    '',
    '## Problem / Motivation',
    '',
    'Queued PRDs need per-enqueue validation commands.',
    '',
    '## Acceptance Criteria',
    '',
    '- The queued PRD preserves post-merge commands.',
  ].join('\n');
}

function extractorOutput(): string {
  return JSON.stringify({
    version: 1,
    criteria: [{
      text: 'The queued PRD preserves post-merge commands.',
      sourceQuote: 'The queued PRD preserves post-merge commands.',
      confidence: 0.95,
    }],
  });
}

function inventoryPrdBody(): string {
  const body = formattedPrd();
  return appendAcceptanceCriteriaInventoryBlock(body, parseAcceptanceCriteriaExtractorOutput(extractorOutput(), body));
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('EforgeEngine.enqueue postMerge queue metadata', () => {
  it('persists postMerge frontmatter and loadQueue round-trips it', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: new StubHarness([{ text: formattedPrd() }, { text: extractorOutput() }]),
      config: { plugins: { enabled: false } },
    });

    const events = await collect(engine.enqueue('raw source', { postMerge: ['pnpm build', 'pnpm test'] }));
    const complete = events.find((event): event is Extract<EforgeEvent, { type: 'enqueue:complete' }> => event.type === 'enqueue:complete');
    expect(complete).toBeDefined();

    const queuedContent = await readFile(complete!.filePath, 'utf-8');
    expect(queuedContent).toContain('postMerge:\n  - "pnpm build"\n  - "pnpm test"');

    const queue = await loadQueue('.eforge/queue', tmpDir);
    expect(queue).toHaveLength(1);
    expect(queue[0].frontmatter.postMerge).toEqual(['pnpm build', 'pnpm test']);
  });

  it.each([
    { name: 'non-string entries', postMerge: ['pnpm build', 42] as unknown as string[] },
    { name: 'control characters', postMerge: ['pnpm build\npnpm test'] },
  ])('rejects $name in postMerge commands without writing a queued PRD', async ({ postMerge }) => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: new StubHarness([{ text: formattedPrd() }, { text: extractorOutput() }]),
      config: { plugins: { enabled: false } },
    });

    const events = await collect(engine.enqueue('raw source', { postMerge }));
    expect(events.some((event) => event.type === 'enqueue:failed')).toBe(true);
    const entries = await readdir(resolve(tmpDir, '.eforge', 'queue')).catch(() => []);
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });

  it('loadQueue rejects modified queue files with invalid postMerge commands', async () => {
    const tmpDir = makeTempDir();
    await mkdir(resolve(tmpDir, '.eforge', 'queue'), { recursive: true });
    await writeFile(resolve(tmpDir, '.eforge', 'queue', 'blank.md'), '---\ntitle: Blank\npostMerge:\n  - ""\n---\n\n# Blank\n', 'utf-8');
    await writeFile(resolve(tmpDir, '.eforge', 'queue', 'control.md'), '---\ntitle: Control\npostMerge:\n  - pnpm\u0007test\n---\n\n# Control\n', 'utf-8');

    await expect(loadQueue('.eforge/queue', tmpDir)).resolves.toEqual([]);
  });

  it('passes queued PRD postMerge frontmatter to queued build execution', async () => {
    const tmpDir = makeTempDir();
    await mkdir(resolve(tmpDir, '.eforge', 'queue'), { recursive: true });
    const filePath = resolve(tmpDir, '.eforge', 'queue', 'queued.md');
    await writeFile(filePath, inventoryPrdBody(), 'utf-8');
    const prd: QueuedPrd = {
      id: 'queued',
      filePath,
      frontmatter: { title: 'Queued', created: '2026-01-01', postMerge: ['pnpm build'] },
      content: inventoryPrdBody(),
      lastCommitHash: '',
      lastCommitDate: '',
    };
    let buildOptions: Partial<BuildOptions> | undefined;
    const ctx: QueuedPrdBuildContext = {
      cwd: tmpDir,
      config: { stacking: { enabled: false }, build: { validation: { allowNoAcceptanceCriteria: false }, trunkSync: { enabled: false } } } as unknown as EforgeConfig,
      agentRuntimes: new StubHarness([]) as never,
      async *compile(_source: string, _options: Partial<CompileOptions>) {
        yield { type: 'phase:end', runId: 'compile', planSet: 'queued', command: 'compile', result: { status: 'completed', summary: 'ok' }, timestamp: new Date().toISOString() } as EforgeEvent;
      },
      async *build(_planSet: string, options: Partial<BuildOptions>) {
        buildOptions = options;
        yield { type: 'phase:end', runId: 'build', planSet: 'queued', command: 'build', result: { status: 'completed', summary: 'ok' }, timestamp: new Date().toISOString() } as EforgeEvent;
      },
      async *resumeBuild() {},
    };

    await collect(runQueuedPrdBuild(ctx, prd, { auto: true }));
    expect(buildOptions?.postMergeCommands).toEqual(['pnpm build']);
  });
});
