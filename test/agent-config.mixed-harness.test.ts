import { describe, it, expect } from 'vitest';
import { resolveAgentConfig, MODEL_CLASS_DEFAULTS } from '@eforge-build/engine/pipeline';
import { resolveConfig } from '@eforge-build/engine/config';

// ---------------------------------------------------------------------------
// Mixed-harness config: planner on claude-sdk, builder on pi
// ---------------------------------------------------------------------------

describe('resolveAgentConfig mixed-harness config', () => {
  const mixedConfig = resolveConfig(
    {
      agentRuntimes: {
        opus: { harness: 'claude-sdk' },
        'pi-openrouter': {
          harness: 'pi',
          pi: { apiKey: 'test-key' },
        },
      },
      defaultAgentRuntime: 'opus',
      agents: {
        roles: {
          builder: {
            agentRuntime: 'pi-openrouter',
            model: { id: 'qwen-coder', provider: 'openrouter' },
          },
        },
        models: {
          max: { id: 'qwen-max', provider: 'openrouter' },
        },
      },
    },
    {},
  );

  it('planner resolves to opus (claude-sdk)', () => {
    // Use a clean config without cross-harness model conflicts
    const cleanConfig = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': { harness: 'pi', pi: { apiKey: 'test-key' } },
        },
        defaultAgentRuntime: 'opus',
        agents: {
          roles: {
            builder: {
              agentRuntime: 'pi-openrouter',
              model: { id: 'qwen-coder', provider: 'openrouter' },
            },
          },
        },
      },
      {},
    );
    const result = resolveAgentConfig('planner', cleanConfig);
    expect(result.agentRuntimeName).toBe('opus');
    expect(result.harness).toBe('claude-sdk');
  });

  it('builder resolves to pi-openrouter (pi)', () => {
    const result = resolveAgentConfig('builder', mixedConfig);
    expect(result.agentRuntimeName).toBe('pi-openrouter');
    expect(result.harness).toBe('pi');
  });

  it('planner uses class-defaults for claude-sdk harness', () => {
    // planner is max class; user provides agents.models.max for pi, but planner is on claude-sdk
    // so the user-configured agents.models.max { id: 'qwen-max', provider: 'openrouter' } would be used
    // But it has a provider which is forbidden for claude-sdk — so it should throw
    expect(() => resolveAgentConfig('planner', mixedConfig)).toThrow(
      /harness "claude-sdk".*forbidden "provider"/,
    );
  });

  it('each role resolves to its correct class-defaults entry', () => {
    const cleanConfig = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': {
            harness: 'pi',
            pi: { apiKey: 'test-key' },
          },
        },
        defaultAgentRuntime: 'opus',
        agents: {
          roles: {
            builder: {
              agentRuntime: 'pi-openrouter',
              model: { id: 'qwen-coder', provider: 'openrouter' },
            },
          },
        },
      },
      {},
    );

    // planner is on claude-sdk → max class → claude-sdk default is claude-opus-4-7
    const plannerResult = resolveAgentConfig('planner', cleanConfig);
    expect(plannerResult.harness).toBe('claude-sdk');
    expect(plannerResult.model).toEqual(MODEL_CLASS_DEFAULTS['claude-sdk']['max']);

    // builder is on pi with per-role model override
    const builderResult = resolveAgentConfig('builder', cleanConfig);
    expect(builderResult.harness).toBe('pi');
    expect(builderResult.model).toEqual({ id: 'qwen-coder', provider: 'openrouter' });
  });

  it('reviewer also defaults to opus (claude-sdk) via defaultAgentRuntime', () => {
    const cleanConfig = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': { harness: 'pi', pi: { apiKey: 'key' } },
        },
        defaultAgentRuntime: 'opus',
        agents: {
          roles: {
            builder: {
              agentRuntime: 'pi-openrouter',
              model: { id: 'qwen-coder', provider: 'openrouter' },
            },
          },
        },
      },
      {},
    );
    const reviewerResult = resolveAgentConfig('reviewer', cleanConfig);
    expect(reviewerResult.agentRuntimeName).toBe('opus');
    expect(reviewerResult.harness).toBe('claude-sdk');
  });

  it('agentRuntimeName and harness are present on every resolved config', () => {
    const cleanConfig = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': { harness: 'pi', pi: { apiKey: 'key' } },
        },
        defaultAgentRuntime: 'opus',
        agents: {
          roles: {
            builder: {
              agentRuntime: 'pi-openrouter',
              model: { id: 'qwen-coder', provider: 'openrouter' },
            },
          },
        },
      },
      {},
    );
    const roles = ['planner', 'reviewer', 'evaluator'] as const;
    for (const role of roles) {
      const result = resolveAgentConfig(role, cleanConfig);
      expect(result.agentRuntimeName).toBeDefined();
      expect(result.harness).toBeDefined();
      expect(['claude-sdk', 'pi']).toContain(result.harness);
    }
  });
});
