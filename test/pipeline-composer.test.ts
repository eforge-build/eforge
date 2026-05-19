import { describe, it, expect } from 'vitest';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { composePipeline } from '@eforge-build/engine/agents/pipeline-composer';
import type { ValidationProviderRegistration } from '../packages/engine/src/extensions/types.js';

const VALID_SEQUENTIAL = JSON.stringify({
  scope: 'errand',
  compile: ['planner'],
  defaultBuild: ['implement', 'test-write'],
  defaultReview: {
    strategy: 'single',
    perspectives: ['code'],
    maxRounds: 1,
    evaluatorStrictness: 'lenient',
  },
  rationale: 'Trivial change; sequential implement then test-write.',
});

const INVALID_PARALLEL = JSON.stringify({
  scope: 'errand',
  compile: ['planner'],
  // test-write declares implement as a predecessor — validatePipeline must reject this
  defaultBuild: [['implement', 'test-write']],
  defaultReview: {
    strategy: 'single',
    perspectives: ['code'],
    maxRounds: 1,
    evaluatorStrictness: 'lenient',
  },
  rationale: 'Parallel attempt.',
});

describe('composePipeline', () => {
  const makeTempDir = useTempDir('eforge-composer-test-');

  it('yields plan:pipeline on a valid first attempt', async () => {
    const backend = new StubHarness([{ resultText: VALID_SEQUENTIAL }]);
    const cwd = makeTempDir();

    const events = await collectEvents(composePipeline({
      harness: backend,
      source: '# PRD\nAdd a /health endpoint.',
      cwd,
    }));

    const agentResults = filterEvents(events, 'agent:result');
    expect(agentResults).toHaveLength(1);

    const pipeline = findEvent(events, 'planning:pipeline');
    expect(pipeline).toBeDefined();
    expect(pipeline!.scope).toBe('errand');
    expect(pipeline!.defaultBuild).toEqual(['implement', 'test-write']);

    expect(backend.prompts).toHaveLength(1);
  });

  it('retries with prior output and error when validatePipeline rejects a parallel group', async () => {
    const backend = new StubHarness([
      { resultText: INVALID_PARALLEL },
      { resultText: VALID_SEQUENTIAL },
    ]);
    const cwd = makeTempDir();

    const events = await collectEvents(composePipeline({
      harness: backend,
      source: '# PRD\nAdd a /health endpoint.',
      cwd,
    }));

    expect(filterEvents(events, 'agent:result')).toHaveLength(2);
    expect(findEvent(events, 'planning:pipeline')).toBeDefined();

    expect(backend.prompts).toHaveLength(2);
    const retryPrompt = backend.prompts[1];

    // Prior output is carried into the retry prompt — not just the error string.
    expect(retryPrompt).toContain('Your previous attempt produced:');
    expect(retryPrompt).toContain('[["implement","test-write"]]');
    // And the specific validatePipeline error is echoed back.
    expect(retryPrompt).toContain('That response was rejected:');
    expect(retryPrompt).toContain('predecessor "implement"');
  });

  it('throws after maxAttempts (3) when every response is unparseable', async () => {
    const backend = new StubHarness([
      { resultText: 'not json at all' },
      { resultText: 'still not json' },
      { resultText: 'nope' },
    ]);
    const cwd = makeTempDir();

    await expect(collectEvents(composePipeline({
      harness: backend,
      source: '# PRD',
      cwd,
    }))).rejects.toThrow(/failed after 3 attempts/);

    expect(backend.prompts).toHaveLength(3);
  });

  it('no validationProviders — prompt contains no "Validation providers loaded" section', async () => {
    const backend = new StubHarness([{ resultText: VALID_SEQUENTIAL }]);
    const cwd = makeTempDir();

    await collectEvents(composePipeline({ harness: backend, source: '# PRD', cwd }));

    expect(backend.prompts[0]).not.toContain('Validation providers loaded');
  });

  it('validationProviders present — prompt contains "Validation providers loaded" summary', async () => {
    const backend = new StubHarness([{ resultText: VALID_SEQUENTIAL }]);
    const cwd = makeTempDir();

    const providers: ValidationProviderRegistration[] = [
      { kind: 'validationProvider', extensionName: 'my-ext', extensionPath: '/ext', name: 'type-check', value: { name: 'type-check', description: 'TS check', commands: ['pnpm type-check'] } },
    ];
    await collectEvents(composePipeline({
      harness: backend,
      source: '# PRD',
      cwd,
      validationProviders: providers,
    }));

    expect(backend.prompts[0]).toContain('Validation providers loaded');
    expect(backend.prompts[0]).toContain('type-check (my-ext)');
  });

  it('validationProviders + promptAppend — both appear in prompt, joined with blank line', async () => {
    const backend = new StubHarness([{ resultText: VALID_SEQUENTIAL }]);
    const cwd = makeTempDir();

    const providers: ValidationProviderRegistration[] = [
      { kind: 'validationProvider', extensionName: 'my-ext', extensionPath: '/ext', name: 'lint', value: { name: 'lint', description: 'Lint check', commands: ['pnpm lint'] } },
    ];
    await collectEvents(composePipeline({
      harness: backend,
      source: '# PRD',
      cwd,
      promptAppend: 'EXTRA INSTRUCTIONS',
      validationProviders: providers,
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('EXTRA INSTRUCTIONS');
    expect(prompt).toContain('Validation providers loaded');
    // Both sections appear — promptAppend precedes the validation summary
    expect(prompt.indexOf('EXTRA INSTRUCTIONS')).toBeLessThan(prompt.indexOf('Validation providers loaded'));
  });
});
