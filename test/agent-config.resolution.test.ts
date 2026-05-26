import { describe, it, expect } from 'vitest';
import { resolveAgentConfig } from '@eforge-build/engine/pipeline';
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_TIER_MAX_TURNS } from '@eforge-build/engine/config';

// ---------------------------------------------------------------------------
// resolveAgentConfig — tier recipes drive harness, model, effort
// ---------------------------------------------------------------------------

describe('resolveAgentConfig with tier recipes', () => {
  it('preserves default tier recipes when a partial profile config omits a tier', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });
    // builder is in the implementation tier; the omitted tier falls back to defaults.
    const builder = resolveAgentConfig('builder', config);
    expect(builder.harness).toBe('claude-sdk');
    expect(builder.model.id).toBe('claude-sonnet-4-6');
    expect(builder.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
  });

  it('DEFAULT_CONFIG resolves every role to claude-sdk via tier recipes', () => {
    const roles = ['planner', 'builder', 'reviewer', 'evaluator', 'review-fixer'] as const;
    for (const role of roles) {
      const result = resolveAgentConfig(role, DEFAULT_CONFIG);
      expect(result.harness).toBe('claude-sdk');
      expect(result.harnessSource).toBe('tier');
    }
  });

  it('routes role to its tier recipe', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'pi' as const, pi: { provider: 'openrouter' }, model: 'qwen-coder', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });
    const builder = resolveAgentConfig('builder', config);
    expect(builder.harness).toBe('pi');
    expect(builder.model.id).toBe('qwen-coder');
    expect(builder.model.provider).toBe('openrouter');

    const planner = resolveAgentConfig('planner', config);
    expect(planner.harness).toBe('claude-sdk');
    expect(planner.model.id).toBe('claude-opus-4-7');
    expect(planner.model.provider).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Provider splice for pi tier
// ---------------------------------------------------------------------------

describe('resolveAgentConfig provider splice', () => {
  it('pi tier splices pi.provider into model.provider', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'pi' as const, pi: { provider: 'anthropic' }, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'pi' as const, pi: { provider: 'anthropic' }, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'pi' as const, pi: { provider: 'anthropic' }, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'pi' as const, pi: { provider: 'anthropic' }, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });
    const result = resolveAgentConfig('builder', config);
    expect(result.harness).toBe('pi');
    expect(result.model.id).toBe('claude-sonnet-4-6');
    expect(result.model.provider).toBe('anthropic');
  });

  it('claude-sdk tier produces model.provider === undefined', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });
    const result = resolveAgentConfig('builder', config);
    expect(result.harness).toBe('claude-sdk');
    expect(result.model.provider).toBeUndefined();
    expect(result.model.id).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// maxTurns resolution — implementation tier default propagation
// ---------------------------------------------------------------------------

describe('resolveAgentConfig maxTurns — tier budgets', () => {
  it('uses the planning tier maxTurns for planner roles', () => {
    const result = resolveAgentConfig('planner', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.planning);
  });

  it('uses the implementation tier maxTurns for implementation roles', () => {
    expect(resolveAgentConfig('review-fixer', DEFAULT_CONFIG).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
    expect(resolveAgentConfig('validation-fixer', DEFAULT_CONFIG).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
    expect(resolveAgentConfig('builder', DEFAULT_CONFIG).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
    expect(resolveAgentConfig('doc-author', DEFAULT_CONFIG).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
  });

  it('uses the review tier maxTurns for reviewer roles', () => {
    const result = resolveAgentConfig('reviewer', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.review);
  });

  it('uses the evaluation tier maxTurns for evaluator roles', () => {
    const result = resolveAgentConfig('evaluator', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.evaluation);
  });

  it('custom agents.tiers.implementation preserves the default implementation maxTurns when omitted', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'pi' as const, pi: { provider: 'openai-codex' }, model: 'gpt-5.5', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'pi' as const, pi: { provider: 'openai-codex' }, model: 'gpt-5.5', effort: 'high' as const },
          evaluation: { harness: 'pi' as const, pi: { provider: 'openai-codex' }, model: 'gpt-5.5', effort: 'high' as const },
        },
      },
    });
    expect(resolveAgentConfig('review-fixer', config).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
    expect(resolveAgentConfig('validation-fixer', config).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
    expect(resolveAgentConfig('builder', config).maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.implementation);
  });

  it('custom agents.tiers.implementation.maxTurns overrides the 80 default for review-fixer', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const, maxTurns: 120 },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });
    expect(resolveAgentConfig('review-fixer', config).maxTurns).toBe(120);
    expect(resolveAgentConfig('validation-fixer', config).maxTurns).toBe(120);
    expect(resolveAgentConfig('builder', config).maxTurns).toBe(120);
  });

  it('plan-level maxTurns override takes highest precedence over tier default', () => {
    const planEntry = {
      agents: {
        'review-fixer': { maxTurns: 50 },
      },
    };
    const result = resolveAgentConfig('review-fixer', DEFAULT_CONFIG, planEntry);
    expect(result.maxTurns).toBe(50);
  });

  it('role-level maxTurns override takes precedence over tier default', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
        roles: {
          'review-fixer': { maxTurns: 45 },
        },
      },
    });
    expect(resolveAgentConfig('review-fixer', config).maxTurns).toBe(45);
  });

  it('plan override beats role override beats tier default', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const, maxTurns: 100 },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
        roles: {
          'review-fixer': { maxTurns: 60 },
        },
      },
    });
    // Plan override wins over both role and tier
    const planEntry = { agents: { 'review-fixer': { maxTurns: 25 } } };
    expect(resolveAgentConfig('review-fixer', config, planEntry).maxTurns).toBe(25);
    // Role override wins over tier without a plan override
    expect(resolveAgentConfig('review-fixer', config).maxTurns).toBe(60);
  });
});
