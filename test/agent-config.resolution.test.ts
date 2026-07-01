import { describe, it, expect } from 'vitest';
import { resolveAgentConfig, resolveRuntimeChoiceForInvocation, pathMatchesGlob } from '@eforge-build/engine/pipeline';
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_TIER_MAX_TURNS, parseRawConfig, ConfigValidationError } from '@eforge-build/engine/config';

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

// --- eforge:region plan-01-runtime-choice-core ---
describe('runtime choice config and resolver', () => {
  const config = resolveConfig({
    agents: {
      tiers: {
        implementation: {
          harness: 'pi' as const,
          pi: { provider: 'anthropic' },
          model: 'claude-sonnet-4-6',
          effort: 'medium' as const,
          choices: {
            backend: { model: 'qwen3-coder', pi: { provider: 'local' }, toolbelt: 'none' },
            ui: { effort: 'high' as const, toolbelt: 'browser-ui' },
          },
          routing: {
            rules: [
              { name: 'ui-paths', choice: 'ui', when: { pathGlobs: ['packages/console-ui/**', 'web/**', '**/*.{tsx,jsx,css}'], keywords: ['ui', 'frontend', 'browser', 'component'] } },
              { name: 'backend-paths', choice: 'implementation.backend', when: { pathGlobs: ['packages/engine/**'], keywords: ['backend', 'daemon'] } },
            ],
          },
        },
      },
    },
    tools: { toolbelts: { 'browser-ui': { mcpServers: ['playwright'] } } },
  });

  it('inherits missing fields from the tier default and selects ordered routing choices', () => {
    const ui = resolveRuntimeChoiceForInvocation('builder', config, { name: 'UI component', body: 'frontend browser component' }, { pathHints: ['packages/console-ui/src/app/page.tsx'] });
    expect(ui.choiceRef).toBe('implementation.ui');
    expect(ui.matchedRule).toBe('ui-paths');
    expect(ui.effectiveRecipe.harness).toBe('pi');
    expect(ui.effectiveRecipe.model).toBe('claude-sonnet-4-6');
    expect(ui.effectiveRecipe.effort).toBe('high');
    expect(ui.effectiveRecipe.pi?.provider).toBe('anthropic');

    const backend = resolveRuntimeChoiceForInvocation('builder', config, { name: 'Backend daemon', body: 'backend daemon work' }, { pathHints: ['packages/engine/src/config.ts'] });
    expect(backend.choiceRef).toBe('implementation.backend');
    expect(backend.effectiveRecipe.model).toBe('qwen3-coder');
    expect(backend.effectiveRecipe.pi?.provider).toBe('local');
    expect(backend.effectiveRecipe.toolbelt).toBe('none');
  });

  it('falls back deterministically to default when no rule matches', () => {
    const result = resolveRuntimeChoiceForInvocation('builder', config, { name: 'Docs', body: 'copy editing' }, { pathHints: ['docs/readme.md'] });
    expect(result.choiceRef).toBe('implementation.default');
    expect(result.fallbackReason).toBe('no routing rule matched; selected implicit default choice');
  });

  it('resolves overridden tier before evaluating choices', () => {
    const result = resolveRuntimeChoiceForInvocation('tester', config, { agents: { tester: { tier: 'implementation' } }, name: 'UI', body: 'frontend component' }, { pathHints: ['web/app/page.tsx'] });
    expect(result.tier).toBe('implementation');
    expect(result.tierSource).toBe('plan');
    expect(result.choiceRef).toBe('implementation.ui');
  });

  it('matches role, phase, stage, shard id, and shard root predicates', () => {
    const routed = resolveConfig({
      agents: {
        tiers: {
          implementation: {
            harness: 'claude-sdk' as const,
            model: 'claude-sonnet-4-6',
            effort: 'medium' as const,
            choices: {
              backend: { model: 'qwen3-coder' },
              ui: { effort: 'high' as const },
            },
            routing: {
              rules: [
                { name: 'implement-stage', choice: 'ui', when: { roles: ['builder'], phase: ['build'], stage: ['implement'] } },
                { name: 'api-shard', choice: 'backend', when: { shardIds: ['api-shard'] } },
                { name: 'ui-root', choice: 'ui', when: { shardRoots: ['packages/console-ui/**'] } },
              ],
            },
          },
        },
      },
    });

    expect(resolveRuntimeChoiceForInvocation('builder', routed, { name: 'Build', body: '' }, { phase: 'build', stage: 'implement' }).matchedRule).toBe('implement-stage');
    expect(resolveRuntimeChoiceForInvocation('builder', routed, { name: 'Shard', body: '' }, { shardIds: ['api-shard'] }).matchedRule).toBe('api-shard');
    expect(resolveRuntimeChoiceForInvocation('builder', routed, { name: 'Root', body: '' }, { shardRoots: ['packages/console-ui/src'] }).matchedRule).toBe('ui-root');
    expect(resolveRuntimeChoiceForInvocation('builder', routed, { name: 'Other', body: '' }, { phase: 'build', stage: 'test' }).choiceRef).toBe('implementation.default');
  });

  it('supports documented glob forms', () => {
    expect(pathMatchesGlob('packages/console-ui/src/App.tsx', 'packages/console-ui/**')).toBe(true);
    expect(pathMatchesGlob('web/app/page.css', '**/*.{tsx,jsx,css}')).toBe(true);
    expect(pathMatchesGlob('packages/engine/src/config.ts', 'packages/engine')).toBe(true);
    expect(pathMatchesGlob('src/index.ts', '**')).toBe(true);
  });

  it('does not route from the unbounded plan body text', () => {
    const keywordOnlyConfig = resolveConfig({
      agents: {
        tiers: {
          implementation: {
            harness: 'claude-sdk' as const,
            model: 'claude-sonnet-4-6',
            effort: 'medium' as const,
            choices: { ui: { effort: 'high' as const } },
            routing: { rules: [{ name: 'body-keyword', choice: 'ui', when: { keywords: ['frontend'] } }] },
          },
        },
      },
    });
    const result = resolveRuntimeChoiceForInvocation('builder', keywordOnlyConfig, { name: 'Docs', body: 'frontend browser component' });
    expect(result.choiceRef).toBe('implementation.default');
    expect(result.matchedRule).toBeUndefined();
  });

  it('rejects invalid choice and routing shapes with path-specific messages', () => {
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', choices: { default: { model: 'x' } } } } } })).toThrow(ConfigValidationError);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', choices: { Ui: { model: 'x' } } } } } })).toThrow(/Invalid key in record[\s\S]*agents\.tiers\.implementation\.choices\.Ui/);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', choices: { ui: { routing: {} } } } } } })).toThrow(/Unrecognized key: "routing"[\s\S]*agents\.tiers\.implementation\.choices\.ui/);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', choices: { ui: { choices: {} } } } } } })).toThrow(/Unrecognized key: "choices"[\s\S]*agents\.tiers\.implementation\.choices\.ui/);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', choices: { ui: { effort: 'high' } }, routing: { rules: [{ name: 'bad', choice: 'review.ui', when: { keywords: ['ui'] } }] } } } } })).toThrow(/routing.*rules.*0.*choice/s);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', routing: { rules: [{ name: 'unknown', choice: 'ui', when: { keywords: ['ui'] } }] } } } } })).toThrow(/unknown choice "ui"/);
    expect(() => parseRawConfig({ agents: { tiers: { implementation: { harness: 'claude-sdk', model: 'm', effort: 'medium', routing: { rules: [{ name: 'empty', choice: 'default', when: {} }] } } } } })).toThrow(/when block/);
  });
});
// --- eforge:endregion plan-01-runtime-choice-core ---
