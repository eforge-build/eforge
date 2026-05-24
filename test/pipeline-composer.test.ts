import { describe, it, expect } from 'vitest';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { composePipeline } from '@eforge-build/engine/agents/pipeline-composer';
import type { ValidationProviderRegistration } from '../packages/engine/src/extensions/types.js';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { withRetry, DEFAULT_RETRY_POLICIES } from '@eforge-build/engine/retry';
import type { RetryPolicy } from '@eforge-build/engine/retry';
import { getCompileStage, type PipelineContext } from '@eforge-build/engine/pipeline';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';

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

const VALID_DELEGATED_COMPILE = JSON.stringify({
  scope: 'errand',
  compile: [],
  defaultBuild: ['implement'],
  defaultReview: {
    strategy: 'single',
    perspectives: ['code'],
    maxRounds: 1,
    evaluatorStrictness: 'lenient',
  },
  rationale: 'Composer selected no further compile stages for this test.',
});

describe('composePipeline', () => {
  const makeTempDir = useTempDir('eforge-composer-test-');

  function makePlannerStageContext(backend: StubHarness, cwd: string): PipelineContext {
    return {
      agentRuntimes: singletonRegistry(backend),
      config: DEFAULT_CONFIG,
      pipeline: {
        scope: 'errand',
        compile: ['planner'],
        defaultBuild: ['implement'],
        defaultReview: DEFAULT_REVIEW,
        rationale: 'initial test pipeline',
      },
      tracing: createNoopTracingContext(),
      cwd,
      planSetName: 'test-plan',
      sourceContent: '# PRD\nAdd a /health endpoint.',
      modelTracker: new ModelTracker(),
      plans: [],
      expeditionModules: [],
      moduleBuildConfigs: new Map(),
    };
  }

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

  it('retries and eventually emits planning:pipeline after a harness-level infrastructure error', async () => {
    // Simulate a Pi tool-call infrastructure failure on the first attempt, success on the second.
    // The infrastructure retry wrapping lives in compile-stages, so we apply it here
    // directly to verify the agent:retry + planning:pipeline integration.
    const infraError = new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    const backend = new StubHarness([
      { error: infraError },
      { resultText: VALID_SEQUENTIAL },
    ]);
    const cwd = makeTempDir();

    const composerInput = { harness: backend, source: '# PRD\nAdd a /health endpoint.', cwd };
    const policy = DEFAULT_RETRY_POLICIES['pipeline-composer'] as RetryPolicy<typeof composerInput>;

    const events = await collectEvents(
      withRetry(
        async function* (input) {
          for await (const event of composePipeline(input)) yield event;
        },
        policy,
        composerInput,
      ),
    );

    const retries = filterEvents(events, 'agent:retry');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      agent: 'pipeline-composer',
      subtype: 'error_pi_tool_infrastructure',
      attempt: 1,
      maxAttempts: 2,
      label: 'pipeline-composer-infrastructure-retry',
    });
    // The second attempt succeeds and emits planning:pipeline.
    expect(findEvent(events, 'planning:pipeline')).toBeDefined();
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
    // Two harness calls were made (one per attempt).
    expect(backend.prompts).toHaveLength(2);
  });

  it('planner compile stage wraps pipeline-composer in retry policy', async () => {
    const backend = new StubHarness([
      { error: new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.') },
      { resultText: VALID_DELEGATED_COMPILE },
    ]);
    const cwd = makeTempDir();
    const ctx = makePlannerStageContext(backend, cwd);
    const plannerStage = getCompileStage('planner');

    const events = await collectEvents(plannerStage(ctx));

    expect(filterEvents(events, 'agent:retry')).toHaveLength(1);
    expect(filterEvents(events, 'agent:retry')[0]).toMatchObject({
      agent: 'pipeline-composer',
      subtype: 'error_pi_tool_infrastructure',
      label: 'pipeline-composer-infrastructure-retry',
    });
    expect(findEvent(events, 'planning:pipeline')).toMatchObject({ compile: [] });
    expect(findEvent(events, 'planning:progress')?.message).toContain('delegating to new compile stages');
    expect(ctx.pipeline.compile).toEqual([]);
    expect(backend.prompts).toHaveLength(2);
  });
});
