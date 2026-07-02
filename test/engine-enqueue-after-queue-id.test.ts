/**
 * Behavioral tests for EforgeEngine.enqueue explicit dependency handoff.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import { StubHarness } from './stub-harness.js';
import { appendAcceptanceCriteriaInventoryBlock, parseAcceptanceCriteriaExtractorOutput } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
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

function emptyExplicitExtractorOutput(): string {
  return JSON.stringify({ version: 1, criteria: [], warnings: ['No explicit acceptance criteria found'] });
}

function validExtractorOutput(): string {
  return JSON.stringify({
    version: 1,
    criteria: [{
      text: 'The dependent PRD is queued with the selected upstream dependency.',
      sourceQuote: 'The dependent PRD is queued with the selected upstream dependency.',
      confidence: 0.95,
    }],
  });
}

function validInventoryPrdBody(): string {
  const body = validFormattedPrd();
  const inventory = parseAcceptanceCriteriaExtractorOutput(validExtractorOutput(), body);
  return appendAcceptanceCriteriaInventoryBlock(body, inventory);
}

describe('EforgeEngine.enqueue — explicit afterQueueId', () => {
  it('persists depends_on frontmatter for an explicit afterQueueId', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeActiveQueuePrd(tmpDir, 'upstream-build');

    const harness = new StubHarness([{ text: emptyExplicitExtractorOutput() }, { text: validFormattedPrd() }, { text: validExtractorOutput() }]);
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

    const harness = new StubHarness([{ text: emptyExplicitExtractorOutput() }, { text: validFormattedPrd() }, { text: validExtractorOutput() }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.enqueue('raw source', { afterQueueId: 'explicit-upstream' })) {
      events.push(event);
    }

    expect(harness.calls).toHaveLength(3);
    expect(events.some((event) => event.type === 'enqueue:complete')).toBe(true);
    const complete = findEnqueueComplete(events);
    expect(complete).toBeDefined();
    const queuedContent = await readFile(complete!.filePath, 'utf-8');
    expect(queuedContent).toContain('depends_on: ["explicit-upstream"]');
    expect(queuedContent).not.toContain('other-queued-build');
  });

  it('strips hidden inventory blocks from queued summaries sent to dependency detection', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    await writeFile(resolve(queueDir, 'existing-build.md'), [
      '---',
      'title: Existing Build',
      'created: 2026-01-01',
      '---',
      '',
      '# Existing Build',
      '',
      'Visible queued PRD prose.',
      '',
      '<!-- eforge:acceptance-criteria-inventory',
      '{"version":1,"criteria":[]}',
      'eforge:end-acceptance-criteria-inventory -->',
    ].join('\n'), 'utf-8');

    const harness = new StubHarness([{ text: emptyExplicitExtractorOutput() }, { text: validFormattedPrd() }, { text: validExtractorOutput() }, { text: '[]' }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.enqueue('raw source')) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'enqueue:complete')).toBe(true);
    expect(harness.calls).toHaveLength(4);
    expect(harness.prompts[3]).toContain('Visible queued PRD prose.');
    expect(harness.prompts[3]).not.toContain('eforge:acceptance-criteria-inventory');
  });

  it('strips hidden inventory blocks from staleness assessor PRD content', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const oldHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf-8' }).trim();
    await writeFile(resolve(tmpDir, 'README.md'), 'changed\n', 'utf-8');
    execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'chore: change'], { cwd: tmpDir });

    const staleBody = [
      '# Stale PRD',
      '',
      'Visible stale PRD prose.',
      '',
      '## Acceptance Criteria',
      '',
      '- The stale PRD remains valid for the current codebase.',
    ].join('\n');
    const staleInventory = parseAcceptanceCriteriaExtractorOutput(JSON.stringify({
      version: 1,
      criteria: [{ text: 'The stale PRD remains valid for the current codebase.', sourceQuote: 'The stale PRD remains valid for the current codebase.', confidence: 0.95 }],
    }), staleBody);
    const prdContent = `---\ntitle: Stale PRD\ncreated: 2026-01-01\n---\n\n${appendAcceptanceCriteriaInventoryBlock(staleBody, staleInventory)}`;
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const filePath = resolve(queueDir, 'stale-prd.md');
    await writeFile(filePath, prdContent, 'utf-8');
    const prd: QueuedPrd = {
      id: 'stale-prd',
      filePath,
      frontmatter: { title: 'Stale PRD' },
      content: prdContent,
      lastCommitHash: oldHead,
      lastCommitDate: '2026-01-01',
    };

    const harness = new StubHarness([{ text: '<staleness verdict="proceed">Still valid.</staleness>' }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    for await (const event of engine.buildSinglePrd(prd, {})) {
      if (event.type === 'agent:stop') break;
    }

    expect(harness.prompts).toHaveLength(1);
    expect(harness.prompts[0]).toContain('Visible stale PRD prose.');
    expect(harness.prompts[0]).not.toContain('eforge:acceptance-criteria-inventory');
  });

  it('strips hidden inventory blocks from planner input when compiling a queued PRD file', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const filePath = resolve(queueDir, 'queued-with-inventory.md');
    await writeFile(filePath, `---\ntitle: Queued With Inventory\ncreated: 2026-01-01\n---\n\n${validInventoryPrdBody()}`, 'utf-8');

    const harness = new StubHarness([{ text: '' }, { text: '' }]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    for await (const event of engine.compile(filePath, { name: 'queued-with-inventory' })) {
      if (event.type === 'agent:start' && event.agent === 'planner') break;
    }

    expect(harness.prompts.length).toBeGreaterThan(0);
    expect(harness.prompts.some((prompt) => prompt.includes('The dependent PRD is queued with the selected upstream dependency.'))).toBe(true);
    for (const prompt of harness.prompts) {
      expect(prompt).not.toContain('eforge:acceptance-criteria-inventory');
    }
  });

  it.each([
    ['missing', validFormattedPrd()],
    ['malformed', `${validFormattedPrd()}\n\n<!-- eforge:acceptance-criteria-inventory\nnot json\neforge:end-acceptance-criteria-inventory -->`],
    ['duplicate', `${validInventoryPrdBody()}\n${validInventoryPrdBody()}`],
  ])('fails queued builds with %s inventory before orchestration', async (_name, body) => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const filePath = resolve(queueDir, 'invalid-inventory.md');
    const content = `---\ntitle: Invalid Inventory\ncreated: 2026-01-01\n---\n\n${body}\n`;
    await writeFile(filePath, content, 'utf-8');
    const prd: QueuedPrd = {
      id: 'invalid-inventory',
      filePath,
      frontmatter: { title: 'Invalid Inventory' },
      content,
    };

    const harness = new StubHarness([]);
    const engine = await EforgeEngine.create({
      cwd: tmpDir,
      agentRuntimes: harness,
      config: { plugins: { enabled: false } },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.buildSinglePrd(prd, {})) events.push(event);

    const sessionEnd = events.find((event) => event.type === 'session:end');
    expect(sessionEnd?.result.status).toBe('failed');
    expect(sessionEnd?.result.summary).toMatch(/re-enqueue/i);
    expect(harness.calls).toHaveLength(0);
  });
});
