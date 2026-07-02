import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, DEFAULT_REVIEW, type EforgeConfig } from '@eforge-build/engine/config';
import { CompileScopeContextError } from '@eforge-build/engine/compile-resilience/context-guard';
import { getCompileStage, type PipelineContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { StubHarness } from './stub-harness.js';
import { makePipelineCtx } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const PROVIDER = 'stage-provider';
const MODEL_ID = 'stage-model';

const VALID_PIPELINE = JSON.stringify({
  scope: 'errand',
  compile: ['planner'],
  defaultBuild: ['implement'],
  defaultReview: DEFAULT_REVIEW,
  rationale: 'Continue to planner for guard derivation coverage.',
});

describe('compile stages model-aware context guards', () => {
  const makeTempDir = useTempDir('eforge-stage-context-guard-');

  it('carries module-planner guard diagnostics from the module-planner resolved Pi config on provider context failures', async () => {
    const backend = new StubHarness([{ error: new Error('context window exceeded') }]);
    const err = await expectCompileScopeContextError(stageContext('module-planning', backend, makeTempDir(), {
      expeditionModules: [{ id: 'mod-a', description: 'Module A', dependsOn: [] }],
      pipeline: { scope: 'expedition', compile: ['module-planning'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'module planning test' },
    }));

    expect(err.failure.stage).toBe('module-planner');
    expect(err.failure.guardDiagnostics).toMatchObject({
      provider: PROVIDER,
      modelId: MODEL_ID,
      metadataSource: 'fallback',
    });
    expect(backend.calls).toHaveLength(1);
  });
});

function stageContext(stage: 'planner' | 'module-planning', backend: StubHarness, cwd: string, overrides: Partial<PipelineContext> = {}): AsyncGenerator<unknown> {
  return getCompileStage(stage)(makePipelineCtx({
    cwd,
    agentRuntimes: singletonRegistry(backend),
    config: piPlanningConfig(),
    ...overrides,
  }));
}

async function expectCompileScopeContextError(gen: AsyncGenerator<unknown>): Promise<CompileScopeContextError> {
  try {
    for await (const _event of gen) {
      // Exhaust the stage until it fails.
    }
  } catch (err) {
    expect(err).toBeInstanceOf(CompileScopeContextError);
    return err as CompileScopeContextError;
  }
  throw new Error('expected CompileScopeContextError');
}

function piPlanningConfig(): EforgeConfig {
  return {
    ...DEFAULT_CONFIG,
    agents: {
      ...DEFAULT_CONFIG.agents,
      tiers: {
        ...DEFAULT_CONFIG.agents.tiers,
        planning: {
          harness: 'pi',
          pi: { provider: PROVIDER },
          model: MODEL_ID,
          effort: 'high',
          maxTurns: 80,
        },
      },
    },
  };
}
