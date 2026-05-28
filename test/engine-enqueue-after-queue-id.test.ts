/**
 * Behavioral tests for EforgeEngine.enqueue explicit dependency handoff.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-engine-enqueue-after-');

async function setupProject(tmpDir: string): Promise<void> {
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);

  await mkdir(resolve(tmpDir, 'eforge'), { recursive: true });
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), 'plugins:\n  enabled: false\n', 'utf-8');
}

async function writeActiveQueuePrd(tmpDir: string, id: string): Promise<void> {
  const queueDir = resolve(tmpDir, '.eforge', 'queue');
  await mkdir(queueDir, { recursive: true });
  await writeFile(
    resolve(queueDir, `${id}.md`),
    `---\ntitle: ${id}\ncreated: 2026-01-01\n---\n\n# ${id}\n`,
    'utf-8',
  );
}

type EnqueueCompleteEvent = Extract<EforgeEvent, { type: 'enqueue:complete' }>;

function findEnqueueComplete(events: EforgeEvent[]): EnqueueCompleteEvent | undefined {
  return events.find((event): event is EnqueueCompleteEvent => event.type === 'enqueue:complete');
}

function validFormattedPrd(): string {
  return [
    '# Dependent Feature',
    '',
    '## Problem / Motivation',
    '',
    'A dependent feature needs to be queued after an upstream build.',
    '',
    '## Goal',
    '',
    'Queue the dependent feature.',
    '',
    '## Approach',
    '',
    'Use the explicit dependency handoff path.',
    '',
    '## Scope',
    '',
    '- In scope: enqueue behavior.',
    '',
    '## Acceptance Criteria',
    '',
    '- The dependent PRD is queued with the selected upstream dependency.',
  ].join('\n');
}

describe('EforgeEngine.enqueue — explicit afterQueueId', () => {
  it('persists depends_on frontmatter for an explicit afterQueueId', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeActiveQueuePrd(tmpDir, 'upstream-build');

    const harness = new StubHarness([{ text: validFormattedPrd() }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.enqueue('raw source', { afterQueueId: 'upstream-build' })) {
      events.push(event);
    }

    const complete = findEnqueueComplete(events);
    expect(complete).toBeDefined();
    const queuedContent = await readFile(complete!.filePath, 'utf-8');
    expect(queuedContent).toContain('depends_on: ["upstream-build"]');
  });

  it('does not invoke dependency detection or override an explicit afterQueueId', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeActiveQueuePrd(tmpDir, 'explicit-upstream');
    await writeActiveQueuePrd(tmpDir, 'other-queued-build');

    const harness = new StubHarness([{ text: validFormattedPrd() }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.enqueue('raw source', { afterQueueId: 'explicit-upstream' })) {
      events.push(event);
    }

    expect(harness.calls).toHaveLength(1);
    expect(events.some((event) => event.type === 'enqueue:complete')).toBe(true);
    const complete = findEnqueueComplete(events);
    expect(complete).toBeDefined();
    const queuedContent = await readFile(complete!.filePath, 'utf-8');
    expect(queuedContent).toContain('depends_on: ["explicit-upstream"]');
    expect(queuedContent).not.toContain('other-queued-build');
  });
});
