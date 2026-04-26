import { describe, it, expect } from 'vitest';
import { resolveAgentConfig } from '@eforge-build/engine/pipeline';
import { resolveConfig } from '@eforge-build/engine/config';

// ---------------------------------------------------------------------------
// Mixed Pi provider config: two named Pi runtimes with distinct pi.provider values
// routed to different roles via agents.roles.<role>.agentRuntime.
// ---------------------------------------------------------------------------

describe('resolveAgentConfig mixed pi-provider config', () => {
  const mixedConfig = resolveConfig(
    {
      agentRuntimes: {
        'pi-anthropic': {
          harness: 'pi',
          pi: { provider: 'anthropic' },
        },
        'pi-mlx': {
          harness: 'pi',
          pi: { provider: 'mlx-lm' },
        },
      },
      defaultAgentRuntime: 'pi-anthropic',
      agents: {
        roles: {
          planner: {
            agentRuntime: 'pi-anthropic',
          },
          builder: {
            agentRuntime: 'pi-mlx',
          },
        },
        models: {
          max: { id: 'claude-opus-4-7' },
          balanced: { id: 'claude-sonnet-4-6' },
        },
      },
    },
    {},
  );

  it('planner resolves to pi-anthropic with provider === "anthropic"', () => {
    const result = resolveAgentConfig('planner', mixedConfig);
    expect(result.agentRuntimeName).toBe('pi-anthropic');
    expect(result.harness).toBe('pi');
    expect(result.model?.provider).toBe('anthropic');
  });

  it('builder resolves to pi-mlx with provider === "mlx-lm"', () => {
    const result = resolveAgentConfig('builder', mixedConfig);
    expect(result.agentRuntimeName).toBe('pi-mlx');
    expect(result.harness).toBe('pi');
    expect(result.model?.provider).toBe('mlx-lm');
  });

  it('each role resolves to its runtime\'s declared provider via model.provider', () => {
    const plannerResult = resolveAgentConfig('planner', mixedConfig);
    const builderResult = resolveAgentConfig('builder', mixedConfig);

    // provider comes from the runtime entry, not the model ref
    expect(plannerResult.model?.provider).toBe('anthropic');
    expect(builderResult.model?.provider).toBe('mlx-lm');

    // model ids come from agents.models class defaults
    // planner is planning tier → max class → claude-opus-4-7
    expect(plannerResult.model?.id).toBe('claude-opus-4-7');
    // builder is implementation tier → balanced class → claude-sonnet-4-6
    expect(builderResult.model?.id).toBe('claude-sonnet-4-6');
  });

  it('reviewer defaults to pi-anthropic (defaultAgentRuntime) with provider === "anthropic"', () => {
    const result = resolveAgentConfig('reviewer', mixedConfig);
    expect(result.agentRuntimeName).toBe('pi-anthropic');
    expect(result.harness).toBe('pi');
    expect(result.model?.provider).toBe('anthropic');
  });

  it('agentRuntimeName and harness are present on every resolved config', () => {
    const roles = ['planner', 'reviewer', 'evaluator'] as const;
    for (const role of roles) {
      const result = resolveAgentConfig(role, mixedConfig);
      expect(result.agentRuntimeName).toBeDefined();
      expect(result.harness).toBe('pi');
    }
  });
});
