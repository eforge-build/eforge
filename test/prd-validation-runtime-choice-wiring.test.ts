import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '@eforge-build/engine/config';
import { createPrdValidationWiring } from '@eforge-build/engine/validation/prd-validation-wiring';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { RuntimeChoiceRouterRegistration } from '@eforge-build/engine/extensions/types';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';
import { collectEvents, filterEvents } from './test-events.js';

const exec = promisify(execFile);

async function makeChangedRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-prd-runtime-choice-'));
  await exec('git', ['init', '-b', 'main'], { cwd });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd });
  await writeFile(join(cwd, 'feature.txt'), 'before\n', 'utf-8');
  await exec('git', ['add', '.'], { cwd });
  await exec('git', ['commit', '-m', 'initial'], { cwd });
  await exec('git', ['checkout', '-b', 'feature'], { cwd });
  await writeFile(join(cwd, 'feature.txt'), 'before\nhello runtime choice\n', 'utf-8');
  await exec('git', ['add', '.'], { cwd });
  await exec('git', ['commit', '-m', 'feature change'], { cwd });
  return cwd;
}

function makeTracing() {
  return {
    createSpan: () => ({
      setInput: () => undefined,
      setOutput: () => undefined,
      setModel: () => undefined,
      setUsage: () => undefined,
      setUsageDetails: () => undefined,
      setCostDetails: () => undefined,
      setMetadata: () => undefined,
      addToolCall: () => ({ end: () => undefined }),
      end: () => undefined,
      error: () => undefined,
    }),
  } as never;
}

function router(resolveRuntimeChoice: (ctx: unknown) => unknown): RuntimeChoiceRouterRegistration {
  return {
    kind: 'runtimeChoiceRouter',
    extensionName: 'test-ext',
    extensionPath: '/ext/runtime-router.js',
    name: 'standalone-router',
    value: { name: 'standalone-router', resolveRuntimeChoice: resolveRuntimeChoice as never },
  };
}

function makeConfig() {
  return resolveConfig({
    agents: {
      tiers: {
        planning: {
          harness: 'claude-sdk',
          model: 'planning-base-model',
          effort: 'high',
          maxTurns: 11,
          choices: {
            routed: { model: 'routed-model', maxTurns: 4 },
          },
        },
        implementation: {
          harness: 'claude-sdk',
          model: 'base-model',
          effort: 'medium',
          maxTurns: 11,
          choices: {
            routed: { model: 'routed-model', maxTurns: 4 },
          },
        },
      },
    },
  });
}

async function makeWiring(harness: StubHarness, routerSpy: ReturnType<typeof vi.fn>) {
  const cwd = await makeChangedRepo();
  const config = makeConfig();
  return {
    cwd,
    wiring: await createPrdValidationWiring({
      cwd,
      config,
      agentRuntimes: singletonRegistry(harness),
      tracing: makeTracing(),
      planSetName: 'runtime-choice',
      orchConfig: { name: 'runtime-choice', description: '', created: '', mode: 'errand', baseBranch: 'main', pipeline: { compile: [], build: [] }, plans: [] } as never,
      planFileMap: new Map(),
      buildPipeline: [] as never,
      prdContent: '# PRD\n\n## Acceptance Criteria\n\n- Runtime choice is routed.\n\n<!-- eforge:acceptance-criteria-inventory\n{"version":1,"criteria":[{"id":"ac-001","text":"Runtime choice is routed.","raw":"Runtime choice is routed.","sourceQuote":"Runtime choice is routed.","confidence":0.95}]}\neforge:end-acceptance-criteria-inventory -->\n',
      extensionRuntimeChoiceRouters: [router(routerSpy)],
      configProfileName: 'runtime-profile',
      extensionConfigDir: join(cwd, '.eforge'),
    }),
  };
}

describe('standalone PRD validation runtime-choice wiring', () => {
  it('invokes extension runtime-choice routers with phase standalone and emits selected metadata for prd-validator', async () => {
    const routerSpy = vi.fn((ctx: { phase?: string; stage?: string; changedFiles?: string[] }) => {
      expect(ctx.phase).toBe('standalone');
      expect(ctx.stage).toBe('prd-validator');
      expect(ctx.changedFiles).toContain('feature.txt');
      return { choice: 'routed' };
    });
    const harness = new StubHarness([{ text: '{"gaps":[],"completionPercent":100}' }]);
    const { cwd, wiring } = await makeWiring(harness, routerSpy);

    const events = await collectEvents(wiring.prdValidator!(cwd));

    expect(routerSpy).toHaveBeenCalledOnce();
    const start = filterEvents(events, 'agent:start').find((event) => event.agent === 'prd-validator');
    expect(start).toMatchObject({
      model: 'routed-model',
      runtimeChoice: 'routed',
      runtimeChoiceQualified: 'implementation.routed',
      runtimeChoiceSource: 'extension-router',
      runtimeChoiceRouter: 'standalone-router',
    });
    expect(harness.calls[0].maxTurns).toBe(4);
  });

  it('routes acceptance unknown resolver through the same resolved config and harness path', async () => {
    const routerSpy = vi.fn((ctx: { phase?: string; stage?: string }) => {
      expect(ctx.phase).toBe('standalone');
      expect(ctx.stage).toBe('acceptance-unknown-resolver');
      return { choice: 'routed' };
    });
    const harness = new StubHarness([{ text: '{"verdicts":[{"criterion":"ac-001","verdict":"fail","evidence":{"type":"file","path":"feature.txt","excerpt":"hello runtime choice"}}]}' }]);
    const { cwd, wiring } = await makeWiring(harness, routerSpy);

    const events: EforgeEvent[] = [];
    const result = await (async () => {
      const generator = wiring.acceptanceUnknownResolver!(cwd, {
        unknownCriteria: [{ id: 'ac-001', text: 'Runtime choice is routed.', raw: 'Runtime choice is routed.' }],
        acceptanceVerdicts: [{ criterion: 'Runtime choice is routed.', verdict: 'unknown', evidence: 'Needs inspection.' }],
        implementationDiffContext: '',
      });
      while (true) {
        const next = await generator.next();
        if (next.done) return next.value;
        events.push(next.value);
      }
    })();

    expect(result).toEqual([expect.objectContaining({ criterion: 'ac-001', verdict: 'fail' })]);
    expect(routerSpy).toHaveBeenCalledOnce();
    expect(filterEvents(events, 'agent:start')[0]).toMatchObject({
      agent: 'prd-validator',
      model: 'routed-model',
      runtimeChoiceSource: 'extension-router',
      runtimeChoiceRouter: 'standalone-router',
    });
    expect(harness.calls[0].maxTurns).toBe(4);
  });

  it('routes gap-closer through the same resolved config and harness path', async () => {
    const routerSpy = vi.fn((ctx: { phase?: string; stage?: string; taskSummary?: string }) => {
      expect(ctx.phase).toBe('standalone');
      expect(ctx.stage).toBe('gap-closer');
      expect(ctx.taskSummary).toContain('Missing routed gap');
      return { choice: 'routed' };
    });
    const harness = new StubHarness([{ text: '## Overview\nClose gap\n\n## Files\n- feature.txt: update' }]);
    const { cwd, wiring } = await makeWiring(harness, routerSpy);

    const events: EforgeEvent[] = [];
    for await (const event of wiring.gapCloser!(cwd, [{ requirement: 'Missing routed gap', explanation: 'No routed evidence.' }], 55)) {
      events.push(event);
      if (event.type === 'agent:start') break;
    }

    expect(routerSpy).toHaveBeenCalledOnce();
    expect(filterEvents(events, 'agent:start')[0]).toMatchObject({
      agent: 'gap-closer',
      model: 'routed-model',
      runtimeChoiceSource: 'extension-router',
      runtimeChoiceRouter: 'standalone-router',
    });
    expect(harness.calls[0].maxTurns).toBe(4);
  });
});
