import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listProviders, listModels } from '@eforge-build/engine/models';
import { useTempDir } from './test-tmpdir';

const makeTempDir = useTempDir('eforge-models-listing-');

async function withPiAgentDir<T>(agentDir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
}

describe('listProviders', () => {
  it('returns [] for claude-sdk (provider implicit)', async () => {
    const providers = await listProviders('claude-sdk');
    expect(providers).toEqual([]);
  });

  it('returns a non-empty array for pi, including anthropic', async () => {
    const providers = await listProviders('pi');
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers).toContain('anthropic');
  });

  it('includes custom providers from Pi models.json', async () => {
    const agentDir = makeTempDir();
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        'eforge-test-local': {
          baseUrl: 'http://localhost:1234/v1',
          api: 'openai-completions',
          apiKey: 'test-key',
          models: [{ id: 'eforge-test-model' }],
        },
      },
    }));

    await withPiAgentDir(agentDir, async () => {
      const providers = await listProviders('pi');
      expect(providers).toContain('eforge-test-local');
    });
  });
});

describe('listModels', () => {
  it('returns Anthropic models for claude-sdk without the provider field', async () => {
    const models = await listModels('claude-sdk');
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe('string');
      // Provider is omitted for claude-sdk results
      expect(m.provider).toBeUndefined();
    }
  });

  it('returns at least one entry for pi + anthropic with { id, provider }', async () => {
    const models = await listModels('pi', 'anthropic');
    expect(models.length).toBeGreaterThan(0);
    const first = models[0];
    expect(typeof first.id).toBe('string');
    expect(first.provider).toBe('anthropic');
  });

  it('without a provider filter returns models across providers for pi', async () => {
    const models = await listModels('pi');
    expect(models.length).toBeGreaterThan(0);
    const providers = new Set(models.map((m) => m.provider).filter(Boolean));
    expect(providers.size).toBeGreaterThan(0);
  });

  it('includes custom models from Pi models.json for provider-filtered and unfiltered pi listings', async () => {
    const agentDir = makeTempDir();
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        'eforge-test-local': {
          baseUrl: 'http://localhost:1234/v1',
          api: 'openai-completions',
          apiKey: 'test-key',
          models: [{ id: 'eforge-test-model' }],
        },
      },
    }));

    await withPiAgentDir(agentDir, async () => {
      const providerModels = await listModels('pi', 'eforge-test-local');
      expect(providerModels).toEqual([
        expect.objectContaining({ id: 'eforge-test-model', provider: 'eforge-test-local' }),
      ]);

      const allModels = await listModels('pi');
      expect(allModels).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'eforge-test-model', provider: 'eforge-test-local' }),
      ]));
    });
  });
});
