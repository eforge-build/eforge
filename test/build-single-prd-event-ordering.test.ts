import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type EforgeConfig } from '@eforge-build/engine/config';
import type { BuildOptions, CompileOptions, EforgeEvent } from '@eforge-build/engine/events';
import { runQueuedPrdBuild, type QueuedPrdBuildContext } from '@eforge-build/engine/queue/build-single-prd';
import { QueueSkipReason, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import {
  appendAcceptanceCriteriaInventoryBlock,
  parseAcceptanceCriteriaExtractorOutput,
} from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { StubHarness } from './stub-harness.js';

async function makeCwd(prefix = 'eforge-build-single-prd-ordering-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function initGitRepo(cwd: string): Promise<void> {
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd });
  await writeFile(join(cwd, 'README.md'), '# test\n', 'utf-8');
  execFileSync('git', ['add', 'README.md'], { cwd });
  execFileSync('git', ['commit', '-m', 'chore: initial'], { cwd });
}

function baseConfig(): EforgeConfig {
  return {
    ...DEFAULT_CONFIG,
    build: {
      ...DEFAULT_CONFIG.build,
      trunkSync: { ...DEFAULT_CONFIG.build.trunkSync, enabled: false },
    },
    plugins: { enabled: false },
  };
}

function validPrdBody(): string {
  const body = [
    '# Build Single PRD Ordering',
    '',
    '## Acceptance Criteria',
    '',
    '- Build callbacks receive landing overrides.',
  ].join('\n');
  const inventory = parseAcceptanceCriteriaExtractorOutput(JSON.stringify({
    version: 1,
    criteria: [
      {
        text: 'Build callbacks receive landing overrides.',
        sourceQuote: 'Build callbacks receive landing overrides.',
        confidence: 0.95,
      },
    ],
  }), body);
  return appendAcceptanceCriteriaInventoryBlock(body, inventory);
}

async function writeQueuedPrd(cwd: string, prd: QueuedPrd): Promise<void> {
  await mkdir(join(cwd, '.eforge', 'queue'), { recursive: true });
  await writeFile(prd.filePath, prd.content, 'utf-8');
}

function makePrd(cwd: string, overrides: Partial<QueuedPrd> = {}): QueuedPrd {
  const id = overrides.id ?? 'ordering-prd';
  const body = validPrdBody();
  const content = overrides.content ?? `---\ntitle: Ordering PRD\n---\n\n${body}\n`;
  return {
    id,
    filePath: join(cwd, '.eforge', 'queue', `${id}.md`),
    frontmatter: { title: 'Ordering PRD' },
    content,
    lastCommitHash: '',
    lastCommitDate: '',
    ...overrides,
  };
}

function makeContext(cwd: string, overrides: Partial<QueuedPrdBuildContext> = {}): QueuedPrdBuildContext {
  return {
    cwd,
    config: baseConfig(),
    agentRuntimes: new StubHarness([]),
    compile: async function* (): AsyncGenerator<EforgeEvent> {
      throw new Error('compile should not run in this test');
    },
    build: async function* (): AsyncGenerator<EforgeEvent> {
      throw new Error('build should not run in this test');
    },
    resumeBuild: async function* (): AsyncGenerator<EforgeEvent> {
      throw new Error('resume should not run in this test');
    },
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('runQueuedPrdBuild event ordering', () => {
  it('preserves the already-claimed skip sequence for direct and injected sessions', async () => {
    const directCwd = await makeCwd();
    const directPrd = makePrd(directCwd, { id: 'direct-claimed' });
    await mkdir(join(directCwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(directCwd, '.eforge', 'queue-locks', 'direct-claimed.lock'), '12345', 'utf-8');

    const directEvents = await collect(runQueuedPrdBuild(makeContext(directCwd), directPrd, {}));
    expect(directEvents.map((event) => event.type)).toEqual([
      'queue:prd:start',
      'queue:prd:skip',
      'queue:prd:complete',
    ]);
    expect(directEvents[1]).toEqual(expect.objectContaining({
      type: 'queue:prd:skip',
      reason: QueueSkipReason.AlreadyClaimed,
    }));

    const injectedCwd = await makeCwd();
    const injectedPrd = makePrd(injectedCwd, { id: 'injected-claimed' });
    await mkdir(join(injectedCwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(injectedCwd, '.eforge', 'queue-locks', 'injected-claimed.lock'), '12345', 'utf-8');

    const injectedSessionId = 'injected-session-id';
    const injectedEvents = await collect(runQueuedPrdBuild(makeContext(injectedCwd), injectedPrd, {}, injectedSessionId));
    expect(injectedEvents.map((event) => event.type)).toEqual([
      'queue:prd:start',
      'queue:prd:skip',
      'session:end',
      'queue:prd:complete',
    ]);
    expect(injectedEvents[2]).toEqual(expect.objectContaining({
      type: 'session:end',
      sessionId: injectedSessionId,
      result: { status: 'skipped', summary: 'PRD already claimed by another process' },
    }));
  });

  it('preserves pre-build failure ordering for invalid compiled-resume frontmatter', async () => {
    const cwd = await makeCwd();
    const prd = makePrd(cwd, {
      id: 'invalid-resume',
      frontmatter: { title: 'Invalid Resume PRD', resume_mode: 'compiled' },
    });
    await writeQueuedPrd(cwd, prd);

    const events = await collect(runQueuedPrdBuild(makeContext(cwd), prd, {}));

    expect(events.map((event) => event.type)).toEqual([
      'queue:prd:start',
      'session:start',
      'plan:status:change',
      'plan:error:set',
      'session:end',
      'queue:prd:complete',
    ]);
    expect(events[3]).toEqual(expect.objectContaining({
      type: 'plan:error:set',
      planId: 'invalid-resume',
      error: expect.stringContaining('Incomplete compiled resume frontmatter'),
    }));
    expect(events[4]).toEqual(expect.objectContaining({
      type: 'session:end',
      result: expect.objectContaining({ status: 'failed' }),
    }));
    expect(events[5]).toEqual(expect.objectContaining({
      type: 'queue:prd:complete',
      prdId: 'invalid-resume',
      status: 'failed',
    }));
  });

  it('wraps compile/build phases with run ids, stamps the PRD session, and prefers explicit landing options', async () => {
    const cwd = await makeCwd();
    await initGitRepo(cwd);
    const prd = makePrd(cwd, {
      id: 'main-session',
      frontmatter: { title: 'Main Session PRD', landing: 'leave', landing_auto_merge: false },
    });
    await writeQueuedPrd(cwd, prd);

    let compileOptions: Partial<CompileOptions> | undefined;
    let buildOptions: Partial<BuildOptions> | undefined;
    const ctx = makeContext(cwd, {
      compile: async function* (_source: string, options: Partial<CompileOptions>): AsyncGenerator<EforgeEvent> {
        compileOptions = options;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'phase:start', runId: 'compile-run', planSet: 'main-session', command: 'compile' } as EforgeEvent;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'planning:start', source: prd.filePath } as EforgeEvent;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'phase:end', runId: 'compile-run', result: { status: 'completed', summary: 'Compile complete' } } as EforgeEvent;
      },
      build: async function* (_planSet: string, options: Partial<BuildOptions>): AsyncGenerator<EforgeEvent> {
        buildOptions = options;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'phase:start', runId: 'build-run', planSet: 'main-session', command: 'build' } as EforgeEvent;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'plan:build:start', planId: 'plan-01' } as EforgeEvent;
        yield { timestamp: '2026-01-01T00:00:00.000Z', type: 'phase:end', runId: 'build-run', result: { status: 'completed', summary: 'Build complete' } } as EforgeEvent;
      },
    });

    const events = await collect(runQueuedPrdBuild(ctx, prd, {
      landingAction: 'pr',
      landingAutoMerge: true,
    }));
    const sessionStart = events.find((event) => event.type === 'session:start') as Extract<EforgeEvent, { type: 'session:start' }>;

    expect(events.map((event) => event.type)).toEqual([
      'queue:prd:start',
      'session:start',
      'phase:start',
      'planning:start',
      'phase:end',
      'phase:start',
      'plan:build:start',
      'phase:end',
      'session:end',
      'queue:prd:complete',
    ]);
    expect(events[3]).toEqual(expect.objectContaining({
      type: 'planning:start',
      runId: 'compile-run',
      sessionId: sessionStart.sessionId,
    }));
    expect(events[6]).toEqual(expect.objectContaining({
      type: 'plan:build:start',
      runId: 'build-run',
      sessionId: sessionStart.sessionId,
    }));
    expect(events.at(-2)).toEqual(expect.objectContaining({
      type: 'session:end',
      sessionId: sessionStart.sessionId,
      result: { status: 'completed', summary: 'Build complete' },
    }));
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'queue:prd:complete',
      prdId: 'main-session',
      status: 'completed',
    }));
    expect(compileOptions).toEqual(expect.objectContaining({ name: 'main-session', cwd }));
    expect(buildOptions).toEqual(expect.objectContaining({
      prdId: 'main-session',
      prdFilePath: prd.filePath,
      landingAction: 'pr',
      landingAutoMerge: true,
    }));
  });
});
