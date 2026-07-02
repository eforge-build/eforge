/**
 * Pipeline — stage registry, compile pipeline, build pipeline.
 *
 * Tests the pipeline infrastructure: stage registration/retrieval,
 * pipeline runners (compile and build), agent config threading,
 * and mutable context passing between stages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execFile);
import { stringify as stringifyYaml } from 'yaml';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import type { EforgeEvent, PlanFile, OrchestrationConfig, ReviewIssue } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';

const DEFAULT_BUILD = ['implement', 'review-cycle'];

const TEST_PIPELINE: PipelineComposition = {
  scope: 'excursion',
  compile: ['planner', 'plan-review-cycle'],
  defaultBuild: DEFAULT_BUILD,
  defaultReview: DEFAULT_REVIEW,
  rationale: 'test pipeline',
};
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import {
  getCompileStage,
  getBuildStage,
  getCompileStageNames,
  registerCompileStage,
  registerBuildStage,
  runCompilePipeline,
  runBuildPipeline,
  type PipelineContext,
  type BuildStageContext,
  type CompileStage,
  type BuildStage,
  type StageDescriptor,
} from '@eforge-build/engine/pipeline';
import { StubHarness } from './stub-harness.js';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { testDescriptor, collect, makePipelineCtx, makeBuildCtx } from './pipeline-helpers.js';

describe('PipelineContext mutable state', () => {
  it('plans set by first stage are readable by subsequent stage', async () => {
    const testPlan: PlanFile = {
      id: 'plan-01',
      name: 'Test',
      dependsOn: [],
      branch: 'test',
      body: '# test',
      filePath: '/tmp/test.md',
    };

    registerCompileStage(testDescriptor('test-set-plans', 'compile'), async function* (ctx) {
      ctx.plans = [testPlan];
      yield { type: 'planning:progress', message: 'set-plans' };
    });

    let readPlans: PlanFile[] = [];
    registerCompileStage(testDescriptor('test-read-plans', 'compile'), async function* (ctx) {
      readPlans = ctx.plans;
      yield { type: 'planning:progress', message: 'read-plans' };
    });

    const pipeline: PipelineComposition = {
      ...TEST_PIPELINE,
      compile: ['test-set-plans', 'test-read-plans'],
    };

    const ctx = makePipelineCtx({ pipeline });
    await collect(runCompilePipeline(ctx));

    expect(readPlans).toEqual([testPlan]);
  });
});

// ---------------------------------------------------------------------------
// Agent Config Threading Tests
// ---------------------------------------------------------------------------

describe('agent config threading', () => {
  it('resolveAgentConfig uses the implementation tier maxTurns for builder', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const result = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(80);
  });

  it('resolveAgentConfig returns tier maxTurns when no profile config set', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');

    const result = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(80);
  });

  it('resolveAgentConfig returns tier maxTurns over global config', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');

    const config = { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents, maxTurns: 25 } };
    const result = resolveAgentConfig('builder', config);
    expect(result.maxTurns).toBe(80);
  });

  it('resolveAgentConfig falls back to global maxTurns when the tier omits maxTurns', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');

    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        maxTurns: 42,
        tiers: {
          ...DEFAULT_CONFIG.agents.tiers,
          evaluation: { harness: 'claude-sdk' as const, model: 'claude-opus-4-7', effort: 'high' as const },
        },
      },
    };
    const result = resolveAgentConfig('evaluator', config);
    expect(result.maxTurns).toBe(42);
  });

  it('resolveAgentConfig returns tier defaults for SDK fields when not configured', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const result = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(80);
    // builder maps to implementation tier: claude-sonnet-4-6, effort: medium
    expect(result.model).toEqual({ id: 'claude-sonnet-4-6' });
    expect(result.thinking).toBeUndefined();
    expect(result.effort).toBe('medium'); // from implementation tier recipe
    expect(result.effortSource).toBe('tier');
    expect(result.fallbackModel).toBeUndefined();
    expect(result.allowedTools).toBeUndefined();
    expect(result.disallowedTools).toBeUndefined();
  });

  it('resolveAgentConfig returns global effort when no role override exists', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: { ...DEFAULT_CONFIG.agents, effort: 'high' as const },
    };
    const result = resolveAgentConfig('reviewer', config);
    expect(result.effort).toBe('high');
  });

  it('resolveAgentConfig returns role-specific value over global', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        effort: 'high' as const,
        roles: {
          formatter: { effort: 'low' as const },
        },
      },
    };
    const result = resolveAgentConfig('formatter', config);
    expect(result.effort).toBe('low');
  });

  it('resolveAgentConfig: user per-role maxTurns overrides tier default', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        roles: {
          builder: { maxTurns: 100 },
        },
      },
    };
    const result = resolveAgentConfig('builder', config);
    expect(result.maxTurns).toBe(100);
  });

  it('resolveAgentConfig: tier maxTurns beats user global maxTurns', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: { ...DEFAULT_CONFIG.agents, maxTurns: 20 },
    };
    const result = resolveAgentConfig('builder', config);
    expect(result.maxTurns).toBe(80);
  });

  it('resolveAgentConfig: tier model flows to reviewer role', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    // reviewer maps to review tier which uses claude-opus-4-7 in DEFAULT_CONFIG
    const result = resolveAgentConfig('reviewer', DEFAULT_CONFIG);
    expect(result.model).toEqual({ id: 'claude-opus-4-7' });
  });

  it('resolveAgentConfig: user per-role thinking overrides user global thinking', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        thinking: { type: 'adaptive' as const },
        roles: {
          builder: { thinking: { type: 'disabled' as const } },
        },
      },
    };
    const result = resolveAgentConfig('builder', config);
    expect(result.thinking).toEqual({ type: 'disabled' });
  });
});

// ---------------------------------------------------------------------------
// Default Profile Behavior Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Parallel Stage Group Tests
// ---------------------------------------------------------------------------


describe('default pipeline compile stages', () => {
  it('getCompileStageNames includes planner and planning-quality-review-cycle', () => {
    const names = getCompileStageNames();
    expect(names.has('planner')).toBe(true);
    expect(names.has('planning-quality-review-cycle')).toBe(true);
  });

  it('getCompileStageNames includes module-planning, compile-expedition, cohesion-review-cycle', () => {
    const names = getCompileStageNames();
    expect(names.has('module-planning')).toBe(true);
    expect(names.has('compile-expedition')).toBe(true);
    expect(names.has('cohesion-review-cycle')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EforgeEngineOptions Tests
// ---------------------------------------------------------------------------

describe('EforgeEngineOptions type', () => {
  it('EforgeEngineOptions accepts empty object', async () => {
    const opts: import('@eforge-build/engine/eforge').EforgeEngineOptions = {};
    expect(opts.cwd).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Re-export Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Model Class Resolution Tests
// ---------------------------------------------------------------------------

describe('tier-based model resolution', () => {
  it('implementation tier roles use claude-sonnet-4-6 by default', async () => {
    const { resolveAgentConfig, AGENT_ROLE_TIERS } = await import('@eforge-build/engine/pipeline');
    const implementationRoles = Object.entries(AGENT_ROLE_TIERS)
      .filter(([, tier]) => tier === 'implementation')
      .map(([role]) => role);

    for (const role of implementationRoles) {
      const result = resolveAgentConfig(role as import('@eforge-build/engine/events').AgentRole, DEFAULT_CONFIG);
      expect(result.model, `${role} should use sonnet`).toEqual({ id: 'claude-sonnet-4-6' });
    }
  });

  it('planning/review/evaluation tier roles use claude-opus-4-7 by default', async () => {
    const { resolveAgentConfig, AGENT_ROLE_TIERS } = await import('@eforge-build/engine/pipeline');
    const nonImplRoles = Object.entries(AGENT_ROLE_TIERS)
      .filter(([, tier]) => tier !== 'implementation')
      .map(([role]) => role);

    for (const role of nonImplRoles) {
      const result = resolveAgentConfig(role as import('@eforge-build/engine/events').AgentRole, DEFAULT_CONFIG);
      expect(result.model, `${role} should use opus`).toEqual({ id: 'claude-opus-4-7' });
    }
  });

  it('per-role tier reassignment changes the model', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    // builder normally uses implementation tier (sonnet); reassign to planning tier (opus)
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        roles: {
          builder: { tier: 'planning' as const },
        },
      },
    };
    const result = resolveAgentConfig('builder', config);
    expect(result.model).toEqual({ id: 'claude-opus-4-7' });
    expect(result.tierSource).toBe('role');
  });

  it('pi harness tier resolves with provider from pi config', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        tiers: {
          ...DEFAULT_CONFIG.agents.tiers,
          implementation: { harness: 'pi' as const, pi: { provider: 'openrouter' }, model: 'qwen-coder', effort: 'medium' as const },
        },
      },
    };
    const result = resolveAgentConfig('builder', config);
    expect(result.harness).toBe('pi');
    expect(result.model).toEqual({ id: 'qwen-coder', provider: 'openrouter' });
  });

  it('missing tier recipe throws with actionable message', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    const config = {
      ...DEFAULT_CONFIG,
      agents: {
        ...DEFAULT_CONFIG.agents,
        // Remove the implementation tier entirely
        tiers: {
          planning: DEFAULT_CONFIG.agents.tiers.planning,
          review: DEFAULT_CONFIG.agents.tiers.review,
          evaluation: DEFAULT_CONFIG.agents.tiers.evaluation,
        },
      },
    };
    expect(() => resolveAgentConfig('builder', config)).toThrow(/tier "implementation".*no tier recipe/);
  });

  it('plan-file tier override reassigns role to different tier', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    // builder normally maps to implementation (sonnet); plan overrides to planning (opus)
    const result = resolveAgentConfig('builder', DEFAULT_CONFIG, {
      agents: { builder: { tier: 'planning' } },
    });
    expect(result.model).toEqual({ id: 'claude-opus-4-7' });
    expect(result.tierSource).toBe('plan');
  });

  it('tier recipe effort flows to all roles in that tier', async () => {
    const { resolveAgentConfig } = await import('@eforge-build/engine/pipeline');
    // Default: planning=high, implementation=medium, review=high, evaluation=high
    const planner = resolveAgentConfig('planner', DEFAULT_CONFIG);
    expect(planner.effort).toBe('high');
    expect(planner.effortSource).toBe('tier');

    const builder = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(builder.effort).toBe('medium');
    expect(builder.effortSource).toBe('tier');
  });
});

// ---------------------------------------------------------------------------
// plannerStage graceful fallback when orchestration.yaml is missing
// ---------------------------------------------------------------------------
