import { describe, it, expect } from 'vitest';
import { resolveAgentConfig, resolveAgentRuntimeForRole } from '@eforge-build/engine/pipeline';
import { resolveConfig, DEFAULT_CONFIG } from '@eforge-build/engine/config';

// ---------------------------------------------------------------------------
// resolveAgentRuntimeForRole — precedence, dangling refs, legacy fallback
// ---------------------------------------------------------------------------

describe('resolveAgentRuntimeForRole', () => {
  describe('throws when agentRuntimes is absent or empty', () => {
    it('throws when agentRuntimes is absent', () => {
      const config = { ...DEFAULT_CONFIG, agentRuntimes: undefined, defaultAgentRuntime: undefined };
      expect(() => resolveAgentRuntimeForRole('builder', config)).toThrow(
        '"agentRuntimes" is not declared in config',
      );
    });

    it('throws when agentRuntimes is empty object', () => {
      const config = { ...DEFAULT_CONFIG, agentRuntimes: {}, defaultAgentRuntime: undefined };
      expect(() => resolveAgentRuntimeForRole('builder', config)).toThrow(
        '"agentRuntimes" is not declared in config',
      );
    });

    it('DEFAULT_CONFIG has agentRuntimes and resolves to claude-sdk', () => {
      const result = resolveAgentRuntimeForRole('builder', DEFAULT_CONFIG);
      expect(result).toEqual({ agentRuntimeName: 'claude-sdk', harness: 'claude-sdk' });
    });
  });

  describe('new path (agentRuntimes declared)', () => {
    const configWithRuntimes = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': { harness: 'pi', pi: { apiKey: 'test', provider: 'openrouter' } },
        },
        defaultAgentRuntime: 'opus',
      },
      {},
    );

    it('resolves to defaultAgentRuntime when role has no override', () => {
      const result = resolveAgentRuntimeForRole('planner', configWithRuntimes);
      expect(result).toEqual({ agentRuntimeName: 'opus', harness: 'claude-sdk' });
    });

    it('resolves to role-level agentRuntime over default', () => {
      const config = resolveConfig(
        {
          agentRuntimes: {
            opus: { harness: 'claude-sdk' },
            'pi-openrouter': { harness: 'pi', pi: { apiKey: 'test', provider: 'openrouter' } },
          },
          defaultAgentRuntime: 'opus',
          agents: {
            roles: {
              builder: { agentRuntime: 'pi-openrouter' },
            },
          },
        },
        {},
      );
      const builderResult = resolveAgentRuntimeForRole('builder', config);
      expect(builderResult).toEqual({ agentRuntimeName: 'pi-openrouter', harness: 'pi', provider: 'openrouter' });
      const plannerResult = resolveAgentRuntimeForRole('planner', config);
      expect(plannerResult).toEqual({ agentRuntimeName: 'opus', harness: 'claude-sdk' });
    });

    it('throws when no defaultAgentRuntime and role has no override', () => {
      const config = {
        ...DEFAULT_CONFIG,
        agentRuntimes: { opus: { harness: 'claude-sdk' as const } },
        defaultAgentRuntime: undefined,
      };
      expect(() => resolveAgentRuntimeForRole('planner', config)).toThrow(
        'could not resolve an agentRuntime',
      );
    });

    it('throws when role agentRuntime references non-existent entry', () => {
      const config = {
        ...DEFAULT_CONFIG,
        agentRuntimes: { opus: { harness: 'claude-sdk' as const } },
        defaultAgentRuntime: 'opus',
        agents: {
          ...DEFAULT_CONFIG.agents,
          roles: {
            builder: { agentRuntime: 'ghost', agentRuntimeName: 'claude-sdk', harness: 'claude-sdk' as const },
          },
        },
      };
      expect(() => resolveAgentRuntimeForRole('builder', config)).toThrow(
        '"ghost" which is not declared in agentRuntimes',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAgentConfig — new fields agentRuntimeName and harness
// ---------------------------------------------------------------------------

describe('resolveAgentConfig new fields', () => {
  it('populates agentRuntimeName and harness from DEFAULT_CONFIG agentRuntimes', () => {
    const result = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(result.agentRuntimeName).toBe('claude-sdk');
    expect(result.harness).toBe('claude-sdk');
  });

  it('populates agentRuntimeName and harness from agentRuntimes map', () => {
    const config = resolveConfig(
      {
        agentRuntimes: {
          opus: { harness: 'claude-sdk' },
          'pi-openrouter': { harness: 'pi', pi: { apiKey: 'test', provider: 'openrouter' } },
        },
        defaultAgentRuntime: 'opus',
        agents: {
          roles: {
            builder: { agentRuntime: 'pi-openrouter', model: { id: 'qwen-coder' } },
          },
        },
      },
      {},
    );
    const builder = resolveAgentConfig('builder', config);
    expect(builder.agentRuntimeName).toBe('pi-openrouter');
    expect(builder.harness).toBe('pi');

    const planner = resolveAgentConfig('planner', config);
    expect(planner.agentRuntimeName).toBe('opus');
    expect(planner.harness).toBe('claude-sdk');
  });

  it('DEFAULT_CONFIG resolves every role to claude-sdk harness via agentRuntimes default', () => {
    const roles = [
      'planner', 'builder', 'reviewer', 'evaluator', 'review-fixer',
    ] as const;
    for (const role of roles) {
      const result = resolveAgentConfig(role, DEFAULT_CONFIG);
      expect(result.agentRuntimeName).toBe('claude-sdk');
      expect(result.harness).toBe('claude-sdk');
    }
  });
});

// ---------------------------------------------------------------------------
// Provider splice: resolver populates model.provider from agentRuntime entry
// ---------------------------------------------------------------------------

describe('resolveAgentConfig provider splice', () => {
  it('provider round-trip: pi harness with pi.provider splices provider into model', () => {
    const config = resolveConfig(
      {
        agentRuntimes: {
          default: { harness: 'pi', pi: { provider: 'anthropic' } },
        },
        defaultAgentRuntime: 'default',
        agents: {
          models: {
            max: { id: 'claude-opus-4-7' },
          },
        },
      },
      {},
    );
    // builder (balanced class) falls back to max since only max is configured
    const result = resolveAgentConfig('builder', config);
    expect(result.harness).toBe('pi');
    expect(result.model?.provider).toBe('anthropic');
    expect(result.model?.id).toBe('claude-opus-4-7');
  });

  it('claude-sdk harness produces model.provider === undefined (no splice)', () => {
    const config = resolveConfig(
      {
        agentRuntimes: {
          default: { harness: 'claude-sdk' },
        },
        defaultAgentRuntime: 'default',
        agents: {
          models: {
            max: { id: 'claude-opus-4-7' },
          },
        },
      },
      {},
    );
    const result = resolveAgentConfig('builder', config);
    expect(result.harness).toBe('claude-sdk');
    expect(result.model?.provider).toBeUndefined();
    // builder is balanced class; claude-sdk has built-in balanced default (claude-sonnet-4-6)
    // since no balanced is configured, the harness default is used (not the user-configured max)
    expect(result.model?.id).toBe('claude-sonnet-4-6');
  });

  it('pi harness with pi.provider resolves model correctly', () => {
    const config = resolveConfig(
      {
        agentRuntimes: { mypi: { harness: 'pi', pi: { apiKey: 'key', provider: 'openrouter' } } },
        defaultAgentRuntime: 'mypi',
        agents: {
          models: {
            max: { id: 'qwen-coder' },
            balanced: { id: 'gpt-4o' },
            fast: { id: 'gpt-4o-mini' },
          },
        },
      },
      {},
    );
    const result = resolveAgentConfig('planner', config);
    expect(result.harness).toBe('pi');
    // planner is max class; provider spliced from runtime entry
    expect(result.model).toEqual({ id: 'qwen-coder', provider: 'openrouter' });
  });
});
