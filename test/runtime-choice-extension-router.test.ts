import { describe, expect, it, vi } from 'vitest';
import { safeParseEforgeEvent } from '@eforge-build/client';
import { resolveConfig, type EforgeConfig } from '@eforge-build/engine/config';
import { resolveRuntimeChoiceWithExtensionRouters } from '@eforge-build/engine/extensions/runtime-choice-router';
import type { RuntimeChoiceRouterRegistration } from '@eforge-build/engine/extensions/types';

function configWithRouting(ruleChoice?: string): EforgeConfig {
  return resolveConfig({
    agents: {
      tiers: {
        implementation: {
          harness: 'claude-sdk',
          model: 'base-model',
          effort: 'medium',
          choices: { ui: { model: 'ui-model' }, backend: { model: 'backend-model' } },
          ...(ruleChoice ? { routing: { rules: [{ name: 'matched-default', choice: ruleChoice, when: { phase: ['build'], stage: ['implement'] } }] } } : {}),
        },
      },
    },
  });
}

function router(name: string, resolveRuntimeChoice: (ctx: unknown) => unknown): RuntimeChoiceRouterRegistration {
  return { kind: 'runtimeChoiceRouter', extensionName: 'test-ext', extensionPath: `/ext/${name}.js`, name, value: { name, resolveRuntimeChoice: resolveRuntimeChoice as never } };
}

const baseOptions = { profileName: 'default', cwd: process.cwd(), timeoutMs: 20 };

describe('runtime choice extension routers', () => {
  it('selects the first valid configured choice after declarative no-match', async () => {
    const second = vi.fn(() => ({ choice: 'backend' }));
    const selection = await resolveRuntimeChoiceWithExtensionRouters('builder', configWithRouting(), undefined, { phase: 'build', stage: 'other' }, { ...baseOptions, routers: [router('decline', () => null), router('pick-backend', second)] });
    expect(selection.choiceRef).toBe('implementation.backend');
    expect(selection.source).toBe('extension-router');
    expect(selection.router).toBe('pick-backend');
    expect(selection.effectiveRecipe.model).toBe('backend-model');
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not invoke routers when a declarative rule matches default', async () => {
    const called = vi.fn(() => ({ choice: 'ui' }));
    const selection = await resolveRuntimeChoiceWithExtensionRouters('builder', configWithRouting('default'), undefined, { phase: 'build', stage: 'implement' }, { ...baseOptions, routers: [router('must-not-run', called)] });
    expect(selection.choiceRef).toBe('implementation.default');
    expect(selection.source).toBe('rule');
    expect(selection.matchedRule).toBe('matched-default');
    expect(called).not.toHaveBeenCalled();
  });

  it('falls back deterministically for decline, invalid, thrown, and timeout outcomes', async () => {
    const cases = [
      { expected: 'router-declined' as const, routers: [router('decline', () => ({ decline: true }))] },
      { expected: 'router-invalid-choice' as const, routers: [router('invalid', () => ({ choice: 'missing' }))] },
      { expected: 'router-invalid-choice' as const, routers: [router('malformed', () => ({ choice: 123 }))] },
      { expected: 'router-error' as const, routers: [router('throwing', () => { throw new Error('boom'); })] },
      { expected: 'router-timeout' as const, routers: [router('slow', () => new Promise(() => undefined))], timeoutMs: 1 },
    ];
    for (const testCase of cases) {
      const selection = await resolveRuntimeChoiceWithExtensionRouters('builder', configWithRouting(), undefined, { phase: 'build', stage: 'other' }, { ...baseOptions, timeoutMs: testCase.timeoutMs ?? baseOptions.timeoutMs, routers: testCase.routers });
      expect(selection.choiceRef).toBe('implementation.default');
      expect(selection.source).toBe('fallback');
      expect(selection.fallbackReason).toBe(testCase.expected);
    }
  });

  it('validates agent:start runtime choice metadata through the client event schema', () => {
    const valid = safeParseEforgeEvent({ type: 'agent:start', timestamp: new Date().toISOString(), agentId: 'a1', agent: 'builder', model: 'ui-model', harness: 'claude-sdk', harnessSource: 'tier', tier: 'implementation', tierSource: 'tier', runtimeChoice: 'ui', runtimeChoiceQualified: 'implementation.ui', runtimeChoiceSource: 'extension-router', runtimeChoiceRouter: 'pick-ui' });
    expect(valid.success).toBe(true);
    const invalid = safeParseEforgeEvent({ type: 'agent:start', timestamp: new Date().toISOString(), agentId: 'a1', agent: 'builder', model: 'ui-model', harness: 'claude-sdk', harnessSource: 'tier', tier: 'implementation', tierSource: 'tier', runtimeChoice: 'ui', runtimeChoiceQualified: 'implementation.ui', runtimeChoiceSource: 'secret-router' });
    expect(invalid.success).toBe(false);
  });
});
