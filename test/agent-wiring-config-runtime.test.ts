import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import { AgentTerminalError, PlannerSubmissionError } from '@eforge-build/engine/harness';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { runReview } from '@eforge-build/engine/agents/reviewer';
import { builderImplement, builderEvaluate, type BuilderEvaluationResult } from '@eforge-build/engine/agents/builder';
import type { EvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runPlanReview } from '@eforge-build/engine/agents/plan-reviewer';
import { runPlanEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runPrdValidator } from '@eforge-build/engine/agents/prd-validator';
import type { ExpectedAcceptanceCriterion } from '@eforge-build/engine/validation/acceptance-criteria';
import { validatePipeline, getCompileStageNames, getBuildStageNames, getCompileStageDescriptors, getBuildStageDescriptors, resolveAgentConfig } from '@eforge-build/engine/pipeline';
import { DEFAULT_CONFIG, resolveConfig, loadConfig } from '@eforge-build/engine/config';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { singletonRegistry, buildAgentRuntimeRegistry, type AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';

// --- eforge:region config-runtime-wiring ---

describe('stage descriptor metadata', () => {
  it('all 2 compile stage descriptors have non-empty description, whenToUse, and costHint', () => {
    const descriptors = getCompileStageDescriptors();
    expect(descriptors.length).toBe(2);
    for (const d of descriptors) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.whenToUse.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(d.costHint);
      expect(d.phase).toBe('compile');
    }
  });

  it('all 11 build stage descriptors have non-empty description, whenToUse, and costHint', () => {
    const descriptors = getBuildStageDescriptors();
    expect(descriptors.length).toBe(11);
    for (const d of descriptors) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.whenToUse.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(d.costHint);
      expect(d.phase).toBe('build');
    }
  });
});

// --- Stage Registry: validatePipeline ---

describe('validatePipeline', () => {
  it('returns valid for a correct pipeline', () => {
    const result = validatePipeline(
      ['planner', 'planning-quality-review-cycle'],
      ['implement', 'doc-author', 'doc-sync', 'review-cycle'],
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error for unknown compile stage', () => {
    const result = validatePipeline(['nonexistent'], ['implement']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown compile stage') && e.includes('nonexistent'))).toBe(true);
  });

  it('returns error for unknown build stage', () => {
    const result = validatePipeline(['planner'], ['nonexistent']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown build stage') && e.includes('nonexistent'))).toBe(true);
  });

  it('returns error for missing predecessor', () => {
    // planning-quality-review-cycle requires 'planner' as predecessor
    const result = validatePipeline(['planning-quality-review-cycle'], ['implement']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('predecessor') && e.includes('planner'))).toBe(true);
  });

  it('returns warning for non-parallelizable stage in parallel group', () => {
    const result = validatePipeline(['planner'], [['implement', 'review-cycle']]);
    expect(result.warnings.some((w) => w.includes('not parallelizable'))).toBe(true);
  });
});

// --- resolveAgentConfig per-plan override ---

describe('resolveAgentConfig per-plan override', () => {
  function makeConfig(overrides?: Partial<EforgeConfig['agents']>): EforgeConfig {
    return resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
        ...overrides,
      },
    });
  }

  it('planEntry override wins over per-role config for effort', () => {
    const config = makeConfig({
      roles: {
        builder: { effort: 'high' },
      },
    });

    const result = resolveAgentConfig('builder', config, {
      agents: { builder: { effort: 'xhigh' } },
    });

    expect(result.effort).toBe('xhigh');
    expect(result.effortSource).toBe('plan');
  });

  it('missing planEntry falls back to current behavior', () => {
    const config = makeConfig({
      roles: {
        builder: { effort: 'high' },
      },
    });

    const resultWithPlan = resolveAgentConfig('builder', config);
    const resultWithoutPlan = resolveAgentConfig('builder', config, undefined);

    expect(resultWithPlan.effort).toBe(resultWithoutPlan.effort);
    expect(resultWithPlan.effortSource).toBe('role');
  });

  it('xhigh and max effort levels flow through on capable models', () => {
    // Use a tier with claude-opus-4-7 which supports all effort levels
    const config = makeConfig({});

    const resultXhigh = resolveAgentConfig('builder', config, {
      agents: { builder: { effort: 'xhigh' } },
    });
    expect(resultXhigh.effort).toBe('xhigh');
    expect(resultXhigh.effortClamped).toBe(false);

    const resultMax = resolveAgentConfig('reviewer', config, {
      agents: { reviewer: { effort: 'max' } },
    });
    expect(resultMax.effort).toBe('max');
    expect(resultMax.effortClamped).toBe(false);
  });

  it('clamping reflects in resolved config for Sonnet model with max effort', () => {
    // Override implementation tier to use sonnet-4-0 to trigger clamping
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-0', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });

    const result = resolveAgentConfig('builder', config, {
      agents: { builder: { effort: 'max' } },
    });

    expect(result.effort).toBe('xhigh');
    expect(result.effortClamped).toBe(true);
    expect(result.effortOriginal).toBe('max');
    expect(result.effortSource).toBe('plan');
  });

  it('planEntry thinking override wins over per-role config', () => {
    const config = makeConfig({
      model: { id: 'claude-opus-4-6' },
      roles: {
        builder: { thinking: { type: 'disabled' } },
      },
    });

    const result = resolveAgentConfig('builder', config, {
      agents: { builder: { thinking: { type: 'enabled', budgetTokens: 5000 } } },
    });

    expect(result.thinking).toEqual({ type: 'enabled', budgetTokens: 5000 });
  });

  it('effortSource is tier when effort comes from tier recipe', () => {
    // Implementation tier has effort: 'medium', builder maps to implementation
    const config = makeConfig({});

    const result = resolveAgentConfig('builder', config);

    expect(result.effort).toBe('medium');
    expect(result.effortSource).toBe('tier');
  });

  it('effortSource and thinkingSource are tier when no overrides configured', () => {
    const config = makeConfig({});
    const result = resolveAgentConfig('builder', config);
    // Builder maps to implementation tier which has effort: 'medium'
    expect(result.effort).toBe('medium');
    expect(result.effortSource).toBe('tier');
    expect(result.thinking).toBeUndefined();
    expect(result.thinkingSource).toBe('tier');
  });

  it('thinkingSource tracks plan provenance', () => {
    const config = makeConfig({
      roles: {
        builder: { thinking: true },
      },
    });

    const result = resolveAgentConfig('builder', config, {
      agents: { builder: { thinking: { type: 'enabled', budgetTokens: 5000 } } },
    });

    expect(result.thinking).toEqual({ type: 'enabled', budgetTokens: 5000 });
    expect(result.thinkingSource).toBe('plan');
  });

  it('thinkingSource tracks role provenance', () => {
    const config = makeConfig({
      roles: {
        builder: { thinking: true },
      },
    });

    const result = resolveAgentConfig('builder', config);

    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.thinkingSource).toBe('role');
  });

  it('thinkingSource tracks tier provenance when set in tier recipe', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-6', effort: 'medium' as const, thinking: true },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });

    const result = resolveAgentConfig('builder', config);

    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.thinkingSource).toBe('tier');
  });

  it('effortSource is always stamped even when effort is set from tier', () => {
    const config = makeConfig({});

    const result = resolveAgentConfig('builder', config);

    expect(result.effort).toBe('medium');
    expect(result.effortSource).toBe('tier');
    expect(result.thinkingSource).toBe('tier');
  });

  it('uses the review tier maxTurns for reviewer agents', () => {
    const config = makeConfig({ maxTurns: 30 });

    const result = resolveAgentConfig('reviewer', config);

    expect(result.maxTurns).toBe(60);
  });
});

// --- Per-role effort defaults ---

describe('resolveAgentConfig per-role effort defaults', () => {
  function makeConfig(overrides?: Partial<EforgeConfig['agents']>): EforgeConfig {
    return resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
        ...overrides,
      },
    });
  }

  // In the new tier-recipe system, effort flows from the tier.
  // planning/review/evaluation tiers have effort: 'high'; implementation has effort: 'medium'.
  const effortTable: Array<{ role: string; expectedEffort: string }> = [
    // Planning tier (effort: 'high')
    { role: 'planner', expectedEffort: 'high' },
    { role: 'module-planner', expectedEffort: 'high' },
    { role: 'merge-conflict-resolver', expectedEffort: 'high' },
    // Implementation tier (effort: 'medium') — doc-author and doc-syncer are both implementation tier agents
    { role: 'doc-author', expectedEffort: 'medium' },
    { role: 'doc-syncer', expectedEffort: 'medium' },
    { role: 'gap-closer', expectedEffort: 'high' },
    // Review tier (effort: 'high')
    { role: 'architecture-reviewer', expectedEffort: 'high' },
    { role: 'cohesion-reviewer', expectedEffort: 'high' },
    { role: 'plan-reviewer', expectedEffort: 'high' },
    { role: 'reviewer', expectedEffort: 'high' },
    // Evaluation tier (effort: 'high')
    { role: 'architecture-evaluator', expectedEffort: 'high' },
    { role: 'cohesion-evaluator', expectedEffort: 'high' },
    { role: 'plan-evaluator', expectedEffort: 'high' },
    { role: 'evaluator', expectedEffort: 'high' },
    // Implementation tier (effort: 'medium')
    { role: 'builder', expectedEffort: 'medium' },
    { role: 'review-fixer', expectedEffort: 'medium' },
    { role: 'validation-fixer', expectedEffort: 'medium' },
    { role: 'test-writer', expectedEffort: 'medium' },
    { role: 'tester', expectedEffort: 'medium' },
  ];

  for (const { role, expectedEffort } of effortTable) {
    it(`${role} defaults to effort '${expectedEffort}' with effortSource 'tier'`, () => {
      const config = makeConfig({});
      const result = resolveAgentConfig(role as import('@eforge-build/engine/events').AgentRole, config);
      expect(result.effort).toBe(expectedEffort);
      expect(result.effortSource).toBe('tier');
    });
  }

  it('user per-role effort overrides tier default', () => {
    const config = makeConfig({
      roles: {
        builder: { effort: 'xhigh' },
      },
    });

    const result = resolveAgentConfig('builder', config);
    expect(result.effort).toBe('xhigh');
    expect(result.effortSource).toBe('role');
  });

  it('plan override effort overrides both user config and tier default', () => {
    // reviewer maps to review tier which uses claude-opus-4-7 and supports 'max' effort
    const config = makeConfig({
      roles: {
        reviewer: { effort: 'xhigh' },
      },
    });

    const result = resolveAgentConfig('reviewer', config, {
      agents: { reviewer: { effort: 'max' } },
    });
    expect(result.effort).toBe('max');
    expect(result.effortSource).toBe('plan');
  });
});

// --- Thinking coercion ---

describe('resolveAgentConfig thinking coercion', () => {
  function makeConfig(overrides?: Partial<EforgeConfig['agents']>): EforgeConfig {
    return resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-sonnet-4-6', effort: 'medium' as const },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
        ...overrides,
      },
    });
  }

  it('coerces enabled thinking to adaptive on Opus 4.7', () => {
    // Use a tier with claude-opus-4-7 and thinking: true → gets coerced to adaptive
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'medium' as const, thinking: true },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    });

    const result = resolveAgentConfig('builder', config);
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.thinkingCoerced).toBe(true);
    expect(result.thinkingOriginal).toEqual({ type: 'enabled' });
  });

  it('does not coerce enabled thinking on Opus 4.6', () => {
    const config = resolveConfig({
      agents: {
        tiers: {
          planning: { harness: 'claude-sdk' as const, model: 'claude-opus-4-6', effort: 'high' as const },
          implementation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-6', effort: 'medium' as const, thinking: true },
          review: { harness: 'claude-sdk' as const, model: 'claude-opus-4-6', effort: 'high' as const },
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-6', effort: 'high' as const },
        },
      },
    });

    const result = resolveAgentConfig('builder', config);
    expect(result.thinking).toEqual({ type: 'enabled' });
    expect(result.thinkingCoerced).toBeUndefined();
  });

  it('does not coerce adaptive thinking on Opus 4.7 (already the target)', () => {
    // adaptive thinking is represented as false in the tier boolean field;
    // use plan override with explicit adaptive type instead
    const config = makeConfig({});
    const result = resolveAgentConfig('builder', config, {
      agents: { builder: { thinking: { type: 'adaptive' } } },
    });
    expect(result.thinking).toEqual({ type: 'adaptive' });
    expect(result.thinkingCoerced).toBeUndefined();
  });

  it('does not coerce when thinking is undefined regardless of model', () => {
    const config = makeConfig({
      model: { id: 'claude-opus-4-7' },
    });

    const result = resolveAgentConfig('builder', config);
    expect(result.thinking).toBeUndefined();
    expect(result.thinkingCoerced).toBeUndefined();
  });
});

// --- Thinking coercion warning event ---

describe('agent:warning event for thinking coercion', () => {
  it('emits agent:warning with code thinking-coerced when thinkingCoerced is true', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    const events = await collectEvents(backend.run(
      {
        prompt: 'test',
        cwd: '/tmp',
        maxTurns: 1,
        tools: 'none',
        model: { id: 'claude-opus-4-7' },
        thinking: { type: 'adaptive' },
        thinkingCoerced: true,
        thinkingOriginal: { type: 'enabled', budgetTokens: 10000 },
      },
      'builder',
      'plan-1',
    ));

    const warning = findEvent(events, 'agent:warning');
    expect(warning).toBeDefined();
    expect(warning!.code).toBe('thinking-coerced');
    expect(warning!.message).toContain('claude-opus-4-7');
    expect(warning!.message).toContain('adaptive');
    expect(warning!.agentId).toBeDefined();
    expect(warning!.agent).toBe('builder');
    expect(warning!.planId).toBe('plan-1');
  });

  it('does not emit agent:warning when thinkingCoerced is absent', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    const events = await collectEvents(backend.run(
      {
        prompt: 'test',
        cwd: '/tmp',
        maxTurns: 1,
        tools: 'none',
        model: { id: 'claude-opus-4-6' },
        thinking: { type: 'enabled', budgetTokens: 10000 },
      },
      'builder',
      'plan-1',
    ));

    const warning = findEvent(events, 'agent:warning');
    expect(warning).toBeUndefined();
  });

  it('does not emit agent:warning when thinkingCoerced is false', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    const events = await collectEvents(backend.run(
      {
        prompt: 'test',
        cwd: '/tmp',
        maxTurns: 1,
        tools: 'none',
        model: { id: 'claude-opus-4-6' },
        thinkingCoerced: false,
      },
      'builder',
    ));

    const warning = findEvent(events, 'agent:warning');
    expect(warning).toBeUndefined();
  });
});

// --- Retry policy wiring ---
//
// These tests pin the contract between pipeline agent call sites and the
// shared `withRetry` wrapper from `retry.ts`. They do not re-test policy
// internals (covered in `retry.test.ts`), but confirm that the default
// policies are registered for each agent role the pipeline uses.

describe('DEFAULT_RETRY_POLICIES registration (pipeline-facing)', () => {
  it('registers a policy for every agent that previously had inline retry logic', async () => {
    const { DEFAULT_RETRY_POLICIES } = await import('@eforge-build/engine/retry');

    // Roles that formerly had ad-hoc retry loops in pipeline.ts.
    const requiredRoles = [
      'planner',
      'builder',
      'evaluator',
      'plan-evaluator',
    ] as const;

    for (const role of requiredRoles) {
      const policy = DEFAULT_RETRY_POLICIES[role];
      expect(policy, `policy missing for ${role}`).toBeDefined();
      if (role === 'planner') {
        expect(policy!.shouldRetry).toBeDefined();
      } else {
        expect(policy!.retryableSubtypes.has('error_max_turns')).toBe(true);
      }
      expect(policy!.maxAttempts).toBeGreaterThanOrEqual(2);
    }
  });

  it('preserves prior AGENT_MAX_CONTINUATIONS_DEFAULTS semantics (attempts = maxContinuations + 1)', async () => {
    const { DEFAULT_RETRY_POLICIES } = await import('@eforge-build/engine/retry');

    // AGENT_MAX_CONTINUATIONS_DEFAULTS (maxAttempts = maxContinuations + 1):
    //   planner: 2 => 3 attempts
    //   evaluator / plan-evaluator: 1 => 2 attempts
    expect(DEFAULT_RETRY_POLICIES.planner!.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICIES.evaluator!.maxAttempts).toBe(2);
    expect(DEFAULT_RETRY_POLICIES['plan-evaluator']!.maxAttempts).toBe(2);
  });
});

// --- AgentRuntimeRegistry dual-stub dispatch ---

describe('AgentRuntimeRegistry dual-stub dispatch', () => {
  /**
   * Build a minimal AgentRuntimeRegistry where specific roles map to specific
   * stubs, and a fallback stub is used for all other roles.
   *
   * This helper lets tests verify that stage wiring dispatches the correct
   * harness per role without needing a full config + buildAgentRuntimeRegistry.
   */
  function makeRoleMappedRegistry(
    roleMap: Map<string, AgentHarness>,
    fallback: AgentHarness,
  ): AgentRuntimeRegistry {
    const toolbeltSummary = {
      toolbeltSource: 'default' as const,
      projectMcpSelection: 'all' as const,
      projectMcpServerNames: [],
    };
    return {
      forRole(role) { return roleMap.get(role) ?? fallback; },
      forRoleResolved(role) { return { harness: roleMap.get(role) ?? fallback, toolbeltSummary }; },
    };
  }

  it('dispatches planner role to plannerStub and reviewer to reviewerStub', () => {
    const plannerStub = new StubHarness([]);
    const reviewerStub = new StubHarness([]);

    const registry = makeRoleMappedRegistry(
      new Map<string, AgentHarness>([
        ['planner', plannerStub],
        ['reviewer', reviewerStub],
      ]),
      plannerStub,
    );

    // Each role resolves to its mapped stub
    expect(registry.forRole('planner')).toBe(plannerStub);
    expect(registry.forRole('reviewer')).toBe(reviewerStub);
    expect(registry.forRoleResolved('planner').harness).toBe(plannerStub);
    expect(registry.forRoleResolved('reviewer').harness).toBe(reviewerStub);
    // Cross-checks: stubs are distinct
    expect(registry.forRole('planner')).not.toBe(reviewerStub);
    expect(registry.forRole('reviewer')).not.toBe(plannerStub);
  });

  it('two singletonRegistry instances are distinct registries dispatching to their own stub', () => {
    const stubA = new StubHarness([]);
    const stubB = new StubHarness([]);

    const registryA = singletonRegistry(stubA);
    const registryB = singletonRegistry(stubB);

    // Each singleton registry dispatches every role to its own stub
    expect(registryA.forRole('planner')).toBe(stubA);
    expect(registryA.forRole('builder')).toBe(stubA);
    expect(registryB.forRole('planner')).toBe(stubB);
    expect(registryB.forRole('builder')).toBe(stubB);

    // The two registries dispatch to different stubs for the same role
    expect(registryA.forRole('planner')).not.toBe(registryB.forRole('planner'));
    expect(registryA.forRole('builder')).not.toBe(registryB.forRole('builder'));
  });

  it('forRole reference equality holds across multiple calls (consistent dispatch)', () => {
    const builderStub = new StubHarness([]);
    const plannerStub = new StubHarness([]);

    const registry = makeRoleMappedRegistry(
      new Map<string, AgentHarness>([
        ['builder', builderStub],
        ['planner', plannerStub],
      ]),
      builderStub,
    );

    // Same role resolved twice yields the same reference
    expect(registry.forRole('builder')).toBe(registry.forRole('builder'));
    expect(registry.forRole('planner')).toBe(registry.forRole('planner'));
    // Different roles remain distinct
    expect(registry.forRole('builder')).not.toBe(registry.forRole('planner'));
  });

});

// --- Parallel Reviewer: decision events ---


describe('AgentRuntimeRegistry profile override threading', () => {
  const makeTempDir = useTempDir('eforge-profile-override-wiring-');

  /**
   * Write a minimal eforge project with an eforge/config.yaml and an optional
   * profile override file. Only the `planning` tier is required because the
   * tests only call `forRole('planner')`.
   */
  function writeProjectConfig(projectRoot: string, planningModel: string, planningEffort: string): void {
    mkdirSync(join(projectRoot, 'eforge'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'eforge', 'config.yaml'),
      [
        'agents:',
        '  tiers:',
        '    planning:',
        '      harness: claude-sdk',
        `      model: ${planningModel}`,
        `      effort: ${planningEffort}`,
      ].join('\n') + '\n',
      'utf-8',
    );
  }

  function writeProfile(projectRoot: string, profileName: string, content: string): void {
    mkdirSync(join(projectRoot, 'eforge', 'profiles'), { recursive: true });
    writeFileSync(join(projectRoot, 'eforge', 'profiles', `${profileName}.yaml`), content, 'utf-8');
  }

  it('buildAgentRuntimeRegistry consumes merged tiers from the override profile, not the project default', async () => {
    const projectRoot = makeTempDir();

    // Project default: planning uses haiku / low
    writeProjectConfig(projectRoot, 'claude-haiku-4-5', 'low');

    // Override profile: planning uses opus / xhigh
    writeProfile(
      projectRoot,
      'profile-a',
      [
        'agents:',
        '  tiers:',
        '    planning:',
        '      harness: claude-sdk',
        '      model: claude-opus-4-7',
        '      effort: xhigh',
      ].join('\n') + '\n',
    );

    const result = await loadConfig(projectRoot, { profileOverride: 'profile-a' });

    // The merged config's planning tier must carry the override profile's values
    expect(result.config.agents.tiers?.['planning']?.model).toBe('claude-opus-4-7');
    expect(result.config.agents.tiers?.['planning']?.effort).toBe('xhigh');

    // Building a registry from the merged config must succeed and resolve planner
    const registry = await buildAgentRuntimeRegistry(result.config);
    expect(registry.forRole('planner')).toBeDefined();
  });

  it('two profile overrides produce registries wired to their own tier recipes', async () => {
    const projectRoot = makeTempDir();

    // Project default: planning uses haiku / low (no claudeSdk overrides)
    writeProjectConfig(projectRoot, 'claude-haiku-4-5', 'low');

    // profile-a: disableSubagents = false
    writeProfile(
      projectRoot,
      'profile-a',
      [
        'agents:',
        '  tiers:',
        '    planning:',
        '      harness: claude-sdk',
        '      model: claude-haiku-4-5',
        '      effort: low',
        '      claudeSdk:',
        '        disableSubagents: false',
      ].join('\n') + '\n',
    );

    // profile-b: disableSubagents = true (distinct from profile-a)
    writeProfile(
      projectRoot,
      'profile-b',
      [
        'agents:',
        '  tiers:',
        '    planning:',
        '      harness: claude-sdk',
        '      model: claude-haiku-4-5',
        '      effort: low',
        '      claudeSdk:',
        '        disableSubagents: true',
      ].join('\n') + '\n',
    );

    const [resultA, resultB] = await Promise.all([
      loadConfig(projectRoot, { profileOverride: 'profile-a' }),
      loadConfig(projectRoot, { profileOverride: 'profile-b' }),
    ]);

    // Confirm the merged configs carry distinct tier recipes
    expect(resultA.config.agents.tiers?.['planning']?.claudeSdk?.disableSubagents).toBe(false);
    expect(resultB.config.agents.tiers?.['planning']?.claudeSdk?.disableSubagents).toBe(true);
    expect(
      resultA.config.agents.tiers?.['planning']?.claudeSdk?.disableSubagents,
    ).not.toBe(
      resultB.config.agents.tiers?.['planning']?.claudeSdk?.disableSubagents,
    );

    // Both registries must resolve planner role successfully
    const [registryA, registryB] = await Promise.all([
      buildAgentRuntimeRegistry(resultA.config),
      buildAgentRuntimeRegistry(resultB.config),
    ]);
    expect(registryA.forRole('planner')).toBeDefined();
    expect(registryB.forRole('planner')).toBeDefined();
  });

  it("override profile's per-role tier mapping is honored by forRole", async () => {
    const projectRoot = makeTempDir();

    // Project default defines the implementation tier. Defaults now preserve
    // the planning tier too, so this test distinguishes the role override by
    // giving the implementation tier a unique toolbelt setting.
    mkdirSync(join(projectRoot, 'eforge'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'eforge', 'config.yaml'),
      [
        'agents:',
        '  tiers:',
        '    implementation:',
        '      harness: claude-sdk',
        '      model: claude-haiku-4-5',
        '      effort: low',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Override profile: planner role points to implementation tier. Defines
    // implementation tier (mirrors project) but NOT planning, so the merged
    // config has no planning tier — only the role override can resolve.
    writeProfile(
      projectRoot,
      'profile-role-override',
      [
        'agents:',
        '  tiers:',
        '    implementation:',
        '      harness: claude-sdk',
        '      model: claude-haiku-4-5',
        '      effort: low',
        '      toolbelt: none',
        '  roles:',
        '    planner:',
        '      tier: implementation',
      ].join('\n') + '\n',
    );

    const result = await loadConfig(projectRoot, { profileOverride: 'profile-role-override' });

    // The override's role map must reach the merged config so the registry
    // can read it at agent-runtime-registry.ts:187.
    expect(result.config.agents.roles?.planner?.tier).toBe('implementation');
    // The default planning tier is preserved, so the assertion below proves the
    // registry uses the role override rather than the built-in planner tier.
    expect(result.config.agents.tiers?.['planning']).toBeDefined();

    const registry = await buildAgentRuntimeRegistry(result.config);

    // forRoleResolved('planner') must use the override profile's roles map and
    // resolve planner -> implementation tier, observing implementation's unique
    // toolbelt setting. Without role-mapping threading, planner would resolve
    // to the preserved default planning tier with projectMcpSelection: 'all'.
    const resolved = registry.forRoleResolved('planner');
    expect(resolved.harness).toBeDefined();
    expect(resolved.toolbeltSummary.projectMcpSelection).toBe('none');
  });
});

// --- eforge:endregion config-runtime-wiring ---
