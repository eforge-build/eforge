/**
 * Tests for orchestrator-assigned lane ids on plan-less agents.
 *
 * Verifies that each agent class forwards its `lane` option as the harness.run
 * 3rd arg (planId), and that the gap-closer build pipeline still carries
 * `planId: 'gap-close'`.
 */
import { describe, it, expect } from 'vitest';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, filterEvents } from './test-events.js';
import { composePipeline } from '@eforge-build/engine/agents/pipeline-composer';
import { runPlanner } from '@eforge-build/engine/agents/planner';
import { runPlanReview } from '@eforge-build/engine/agents/plan-reviewer';
import { runPlanEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runModulePlanner } from '@eforge-build/engine/agents/module-planner';
import { runDependencyDetector } from '@eforge-build/engine/agents/dependency-detector';
import { runValidationFixer } from '@eforge-build/engine/agents/validation-fixer';
import { runPrdValidator } from '@eforge-build/engine/agents/prd-validator';
import { runGapCloser } from '@eforge-build/engine/agents/gap-closer';
import { DEFAULT_TIER_MAX_TURNS } from '@eforge-build/engine/config';
// Side-effect import triggers stage registration (needed by composePipeline's validatePipeline).
import '@eforge-build/engine/pipeline';
import type { BuildStageContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';

/**
 * Collect agent:start events from an async generator, tolerating terminal errors.
 * Many agent functions throw when the stub response doesn't satisfy their contract
 * (e.g. planner without a submission tool call); we only care about the events
 * emitted before the throw.
 */
async function collectAgentStartEvents(gen: AsyncGenerator<EforgeEvent>): Promise<Array<Extract<EforgeEvent, { type: 'agent:start' }>>> {
  const events: EforgeEvent[] = [];
  try {
    for await (const event of gen) {
      events.push(event);
    }
  } catch {
    // Tolerate terminal errors - we only need agent:start events
  }
  return filterEvents(events, 'agent:start');
}

// --- Planning agents ---

describe('planning agent lane assignment', () => {
  it('pipeline-composer agent:start carries planId: planning', async () => {
    const validComposition = JSON.stringify({
      scope: 'errand',
      compile: ['planner'],
      defaultBuild: ['implement'],
      defaultReview: { strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'lenient' },
      rationale: 'test',
    });
    const harness = new StubHarness([{ resultText: validComposition }]);

    const starts = await collectAgentStartEvents(composePipeline({
      harness,
      source: 'Build a widget',
      cwd: '/tmp',
      lane: 'planning',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('pipeline-composer');
  });

  it('planner agent:start carries planId: planning', async () => {
    // Planner will throw PlannerSubmissionError because the stub response
    // doesn't call a submission tool, but agent:start is emitted first.
    const harness = new StubHarness([{ text: 'I will plan this.' }]);

    const starts = await collectAgentStartEvents(runPlanner('Build a widget', {
      harness,
      cwd: '/tmp',
      lane: 'planning',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('planner');
  });

  it('plan-reviewer agent:start carries planId: planning', async () => {
    const harness = new StubHarness([{ text: 'No issues found.' }]);

    const starts = await collectAgentStartEvents(runPlanReview({
      harness,
      sourceContent: 'Build a widget',
      planSetName: 'test-set',
      cwd: '/tmp',
      lane: 'planning',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('plan-reviewer');
  });

  it('plan-evaluator agent:start carries planId: planning', async () => {
    const harness = new StubHarness([{ text: '<evaluation>[]</evaluation>' }]);

    const starts = await collectAgentStartEvents(runPlanEvaluate({
      harness,
      planSetName: 'test-set',
      sourceContent: 'Build a widget',
      cwd: '/tmp',
      lane: 'planning',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('plan-evaluator');
  });

  it('module-planner agent:start carries planId: planning', async () => {
    const harness = new StubHarness([{ text: 'Module plan content.' }]);

    const starts = await collectAgentStartEvents(runModulePlanner({
      harness,
      cwd: '/tmp',
      planSetName: 'test-set',
      moduleId: 'mod-1',
      moduleDescription: 'A module',
      moduleDependsOn: [],
      architectureContent: 'arch doc',
      sourceContent: 'Build a widget',
      lane: 'planning',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('module-planner');
  });

  it('dependency-detector agent:start carries planId: planning', async () => {
    const harness = new StubHarness([{ text: '[]' }]);

    const gen = runDependencyDetector({
      harness,
      prdContent: 'Build a widget',
      queueItems: [],
      runningBuilds: [],
      lane: 'planning',
    });
    // runDependencyDetector is a return-value generator; drain it fully
    const starts: Array<Extract<EforgeEvent, { type: 'agent:start' }>> = [];
    let result = await gen.next();
    while (!result.done) {
      if (result.value.type === 'agent:start') {
        starts.push(result.value as Extract<EforgeEvent, { type: 'agent:start' }>);
      }
      result = await gen.next();
    }

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('planning');
    expect(starts[0].agent).toBe('dependency-detector');
  });
});

// --- Validation agents ---

describe('validation agent lane assignment', () => {
  it('validation-fixer agent:start carries planId: validation (pre-gap-close)', async () => {
    const harness = new StubHarness([{ text: 'Fixed the issue.' }]);

    const starts = await collectAgentStartEvents(runValidationFixer({
      harness,
      cwd: '/tmp',
      failures: [{ command: 'pnpm type-check', exitCode: 1, output: 'error TS123' }],
      attempt: 1,
      maxAttempts: 2,
      lane: 'validation',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('validation');
    expect(starts[0].agent).toBe('validation-fixer');
  });

  it('validation-fixer agent:start carries planId: final-validation (post-gap-close)', async () => {
    const harness = new StubHarness([{ text: 'Fixed the issue.' }]);

    const starts = await collectAgentStartEvents(runValidationFixer({
      harness,
      cwd: '/tmp',
      failures: [{ command: 'pnpm type-check', exitCode: 1, output: 'error TS123' }],
      attempt: 1,
      maxAttempts: 2,
      lane: 'final-validation',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('final-validation');
    expect(starts[0].agent).toBe('validation-fixer');
  });

  it('prd-validator agent:start carries planId: validation (pre-gap-close)', async () => {
    const validResult = JSON.stringify({
      gaps: [],
      completionPercent: 100,
      acceptanceVerdicts: [{ criterion: 'Feature works', verdict: 'pass', evidence: 'Tests pass' }],
    });
    const harness = new StubHarness([{ text: validResult }]);

    const starts = await collectAgentStartEvents(runPrdValidator({
      harness,
      cwd: '/tmp',
      prdContent: 'Build a widget',
      diff: 'diff --git a/widget.ts b/widget.ts\n+export const widget = true;',
      lane: 'validation',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('validation');
    expect(starts[0].agent).toBe('prd-validator');
  });

  it('prd-validator agent:start carries planId: final-validation (post-gap-close)', async () => {
    const validResult = JSON.stringify({
      gaps: [],
      completionPercent: 100,
      acceptanceVerdicts: [{ criterion: 'Feature works', verdict: 'pass', evidence: 'Tests pass' }],
    });
    const harness = new StubHarness([{ text: validResult }]);

    const starts = await collectAgentStartEvents(runPrdValidator({
      harness,
      cwd: '/tmp',
      prdContent: 'Build a widget',
      diff: 'diff --git a/widget.ts b/widget.ts\n+export const widget = true;',
      lane: 'final-validation',
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('final-validation');
    expect(starts[0].agent).toBe('prd-validator');
  });
});

// --- Gap-closer regression ---

describe('gap-closer lane assignment (regression)', () => {
  it('gap-closer build pipeline receives planId: gap-close', async () => {
    // The gap-closer agent first runs a planning pass, then delegates to
    // runBuildPipeline with planId: 'gap-close'. We intercept runBuildPipeline
    // to capture the planId it receives.
    let capturedPlanId: string | undefined;

    const planMarkdown = [
      '# Gap-close Plan',
      '',
      '## Implementation',
      '',
      'Add dark mode CSS classes.',
      '',
      '## Scope',
      '',
      '### Modify',
      '- `src/theme.ts` - Add dark mode configuration',
    ].join('\n');

    const harness = new StubHarness([
      { text: planMarkdown, resultText: planMarkdown },
    ]);

    const stubPipelineHarness = new StubHarness([]);
    const pipelineContext = {
      config: {
        agents: {
          maxTurns: 30,
          tiers: {
            planning: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.planning },
            implementation: { harness: 'claude-sdk', model: 'claude-sonnet-4-6', effort: 'medium', maxTurns: DEFAULT_TIER_MAX_TURNS.implementation },
            review: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.review },
            evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.evaluation },
          },
        },
      } as never,
      pipeline: { compile: [], build: [] } as never,
      tracing: { createSpan: () => ({ setInput: () => {}, end: () => {}, error: () => {} }) } as never,
      planSetName: 'test-set',
      orchConfig: { name: 'test', description: '', created: '', mode: 'errand' as const, baseBranch: 'main', pipeline: { compile: [], build: [] }, plans: [] } as never,
      planFileMap: new Map(),
      agentRuntimes: singletonRegistry(stubPipelineHarness),
    };

    const events = await collectEvents(runGapCloser({
      harness,
      cwd: '/tmp',
      gaps: [{ requirement: 'Must support dark mode', explanation: 'No dark mode CSS classes found' }],
      prdContent: '# PRD\n\n## Requirements\n\n- Must support dark mode',
      pipelineContext,
      runBuildPipeline: async function* (ctx: BuildStageContext) {
        capturedPlanId = ctx.planId;
        yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: ctx.planId } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: ctx.planId } as EforgeEvent;
      },
    }));

    const gapCloserStarts = filterEvents(events, 'agent:start').filter((event) => event.agent === 'gap-closer');
    expect(gapCloserStarts).toHaveLength(1);
    expect(gapCloserStarts[0].planId).toBe('gap-close');
    expect(capturedPlanId).toBe('gap-close');
  });
});
