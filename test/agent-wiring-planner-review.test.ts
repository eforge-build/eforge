import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import { AgentTerminalError, PlannerSubmissionError } from '@eforge-build/engine/harness';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { runPlanner } from '@eforge-build/engine/agents/planner';
import { runReview } from '@eforge-build/engine/agents/reviewer';
import { builderImplement, builderEvaluate, type BuilderEvaluationResult } from '@eforge-build/engine/agents/builder';
import type { EvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runPlanReview } from '@eforge-build/engine/agents/plan-reviewer';
import { runPlanEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runArchitectureEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runModulePlanner } from '@eforge-build/engine/agents/module-planner';
import { runArchitectureReview } from '@eforge-build/engine/agents/architecture-reviewer';
import { runPrdValidator } from '@eforge-build/engine/agents/prd-validator';
import type { ExpectedAcceptanceCriterion } from '@eforge-build/engine/validation/acceptance-criteria';
import { validatePipeline, formatStageRegistry, getCompileStageNames, getBuildStageNames, getCompileStageDescriptors, getBuildStageDescriptors, resolveAgentConfig } from '@eforge-build/engine/pipeline';
import { DEFAULT_CONFIG, resolveConfig, loadConfig } from '@eforge-build/engine/config';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { singletonRegistry, buildAgentRuntimeRegistry, type AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';

// --- eforge:region planner-review-wiring ---

// --- Planner ---

describe('runPlanner wiring', () => {
  const makeTempDir = useTempDir('eforge-planner-test-');

  it('throws PlannerSubmissionError when neither submission tool nor <skip> fires', async () => {
    const backend = new StubHarness([{ text: 'Planning done.' }]);
    const cwd = makeTempDir();

    // Collect events until the throw. plan:start and agent:result are yielded
    // before the terminal throw, so we can verify lifecycle emission too.
    const events: EforgeEvent[] = [];
    let thrown: unknown;
    try {
      for await (const ev of runPlanner('Build a widget', { harness: backend, cwd })) {
        events.push(ev);
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PlannerSubmissionError);
    expect((thrown as Error).message).toContain('submit_plan_set');
    expect(findEvent(events, 'planning:start')).toBeDefined();
    expect(findEvent(events, 'planning:complete')).toBeUndefined();
    // agent:result should have been yielded before the throw
    expect(findEvent(events, 'agent:result')).toBeDefined();
    // No plan:error events are yielded any more — the terminal is always thrown.
    expect(events.filter(e => e.type === 'planning:error')).toHaveLength(0);
  });

  it('emits plan:skip when agent output contains a skip block', async () => {
    const backend = new StubHarness([{
      text: '<skip>Already implemented in a previous PR.</skip>',
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Fix a bug', {
      harness: backend,
      cwd,
    }));

    const skip = findEvent(events, 'planning:skip');
    expect(skip).toBeDefined();
    expect(skip!.reason).toBe('Already implemented in a previous PR.');

    // Skip should short-circuit — no plan:complete or plan scanning
    expect(findEvent(events, 'planning:complete')).toBeUndefined();
    const progressEvents = filterEvents(events, 'planning:progress');
    expect(progressEvents.every(e => e.message !== 'Scanning plan files...')).toBe(true);
  });

  it('triggers clarification callback and restarts with answers', async () => {
    const backend = new StubHarness([
      // First run: agent asks a clarification question
      { text: '<clarification><question id="q1">Which database?</question></clarification>' },
      // Second run: agent produces final output (answers baked into prompt)
      { text: 'Planning with Postgres.' },
    ]);
    const cwd = makeTempDir();

    const clarificationCalls: Array<{ id: string; question: string }[]> = [];
    const events: EforgeEvent[] = [];
    // Second iteration emits no submission tool so the planner throws
    // PlannerSubmissionError — collect pre-throw events for lifecycle asserts.
    try {
      for await (const ev of runPlanner('Add a feature', {
        harness: backend,
        cwd,
        onClarification: async (questions) => {
          clarificationCalls.push(questions);
          return { q1: 'Postgres' };
        },
      })) {
        events.push(ev);
      }
    } catch { /* expected PlannerSubmissionError */ }

    // Callback was invoked
    expect(clarificationCalls).toHaveLength(1);
    expect(clarificationCalls[0][0].id).toBe('q1');

    // Clarification events emitted
    expect(findEvent(events, 'planning:clarification')).toBeDefined();
    expect(findEvent(events, 'planning:clarification:answer')).toBeDefined();

    // Backend was called twice (first run + restart)
    expect(backend.prompts).toHaveLength(2);
    // Second prompt should contain the clarification answers
    expect(backend.prompts[1]).toContain('Postgres');
    expect(backend.prompts[1]).toContain('Prior Clarifications');
  });

  it('handles multiple clarification rounds', async () => {
    const backend = new StubHarness([
      { text: '<clarification><question id="q1">Database?</question></clarification>' },
      { text: '<clarification><question id="q2">ORM?</question></clarification>' },
      { text: 'Final plan.' },
    ]);
    const cwd = makeTempDir();

    const events: EforgeEvent[] = [];
    // Third iteration emits no submission tool so the planner throws.
    try {
      for await (const ev of runPlanner('Add feature', {
        harness: backend,
        cwd,
        onClarification: async (questions) => {
          const id = questions[0].id;
          return { [id]: id === 'q1' ? 'Postgres' : 'Drizzle' };
        },
      })) {
        events.push(ev);
      }
    } catch { /* expected PlannerSubmissionError */ }

    expect(backend.prompts).toHaveLength(3);
    // Third prompt should contain both prior answers
    expect(backend.prompts[2]).toContain('Postgres');
    expect(backend.prompts[2]).toContain('Drizzle');

    const clarifications = filterEvents(events, 'planning:clarification');
    expect(clarifications).toHaveLength(2);
  });

  it('stops after max iterations', async () => {
    // Provide 6 clarification responses (max is 5)
    const responses = Array.from({ length: 6 }, () => ({
      text: '<clarification><question id="q1">Again?</question></clarification>',
    }));
    const backend = new StubHarness(responses);
    const cwd = makeTempDir();

    // After max iterations without submission or skip, planner throws
    // PlannerSubmissionError instead of yielding plan:error.
    await expect(collectEvents(runPlanner('Loop forever', {
      harness: backend,
      cwd,
      onClarification: async () => ({ q1: 'yes' }),
    }))).rejects.toThrow(PlannerSubmissionError);

    // Should stop at 5 iterations, not use the 6th response
    expect(backend.prompts).toHaveLength(5);
  });

  it('skips clarification in auto mode', async () => {
    const backend = new StubHarness([{
      text: '<clarification><question id="q1">Database?</question></clarification> Done.',
    }]);
    const cwd = makeTempDir();

    let callbackCalled = false;
    // In auto mode the clarification callback must not fire, and the planner
    // throws PlannerSubmissionError because no submission tool was called.
    await expect(collectEvents(runPlanner('Auto plan', {
      harness: backend,
      cwd,
      auto: true,
      onClarification: async () => {
        callbackCalled = true;
        return {};
      },
    }))).rejects.toThrow(PlannerSubmissionError);

    expect(callbackCalled).toBe(false);
    // No restart — only one backend call
    expect(backend.prompts).toHaveLength(1);
  });

  it('suppresses agent:message when verbose is false, emits when true', async () => {
    const makeBackend = () => new StubHarness([{ text: 'Some output.' }]);
    const cwd = makeTempDir();

    // verbose=false (default): agent:message should be suppressed. Planner
    // throws PlannerSubmissionError after the stream completes without a
    // submission tool call, but pre-throw events are still collected.
    const quietEvents: EforgeEvent[] = [];
    try {
      for await (const ev of runPlanner('Test', { harness: makeBackend(), cwd })) {
        quietEvents.push(ev);
      }
    } catch { /* expected PlannerSubmissionError */ }
    expect(filterEvents(quietEvents, 'agent:message')).toHaveLength(0);

    // verbose=true: agent:message should be emitted
    const cwd2 = makeTempDir();
    const verboseEvents: EforgeEvent[] = [];
    try {
      for await (const ev of runPlanner('Test', { harness: makeBackend(), cwd: cwd2, verbose: true })) {
        verboseEvents.push(ev);
      }
    } catch { /* expected PlannerSubmissionError */ }
    expect(filterEvents(verboseEvents, 'agent:message').length).toBeGreaterThan(0);
  });

  it('writes plans via submission tool and yields plan:complete', async () => {
    const cwd = makeTempDir();

    const backend = new StubHarness([{
      toolCalls: [{
        tool: 'submit_plan_set',
        toolUseId: 'tu-1',
        input: {
          description: 'A test plan',
          plans: [{
            frontmatter: {
              id: 'feature',
              name: 'Add feature',
            },
            body: '# Implementation\n\nDo the thing.',
          }],
          orchestration: {
            validate: [],
            plans: [{
              id: 'feature',
              dependsOn: [],
            }],
          },
        },
        output: '',
      }],
      text: 'Done planning.',
    }]);
    const events = await collectEvents(runPlanner('my-plan', {
      harness: backend,
      cwd,
      name: 'my-plan',
      scope: 'excursion',
    }));

    const complete = findEvent(events, 'planning:complete');
    expect(complete).toBeDefined();
    expect(complete!.plans).toHaveLength(1);
    expect(complete!.plans[0].id).toBe('feature');
    expect(complete!.plans[0].name).toBe('Add feature');
  });
});

// --- Planner submission tool naming ---

describe('runPlanner submission tool naming', () => {
  const makeTempDir = useTempDir('eforge-planner-submit-name-');

  /**
   * StubHarness subclass whose `effectiveCustomToolName` returns a
   * distinguishable prefix so tests can verify that the planner asks the
   * backend for the per-backend tool name and interpolates it into the
   * rendered prompt.
   */
  class PrefixedStubHarness extends StubHarness {
    override effectiveCustomToolName(name: string): string {
      return `stub__${name}`;
    }
  }

  it('injects backend-provided effective tool name into the rendered prompt (excursion)', async () => {
    const backend = new PrefixedStubHarness([{ text: '' }]);
    const cwd = makeTempDir();

    // No submission tool is called in this stub response so the planner throws
    // PlannerSubmissionError after recording the prompt. The prompt capture
    // is what this test verifies.
    await expect(collectEvents(runPlanner('Add a thing', {
      harness: backend,
      cwd,
      scope: 'excursion',
    }))).rejects.toThrow(PlannerSubmissionError);

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).toContain('stub__submit_plan_set');
    expect(prompt).not.toContain('mcp__eforge_engine__');
    // The bare name must not appear standalone (surrounded by non-identifier
    // chars). It is allowed as a substring of `stub__submit_plan_set`, so
    // strip that compound token before asserting the bare name is absent.
    const withoutPrefixed = prompt.split('stub__submit_plan_set').join('');
    expect(withoutPrefixed).not.toMatch(/\bsubmit_plan_set\b/);
  });

  it('injects backend-provided effective tool name into the rendered prompt (expedition)', async () => {
    const backend = new PrefixedStubHarness([{ text: '' }]);
    const cwd = makeTempDir();

    // No submission tool is called in this stub response so the planner throws
    // PlannerSubmissionError after recording the prompt.
    await expect(collectEvents(runPlanner('Design a system', {
      harness: backend,
      cwd,
      scope: 'expedition',
    }))).rejects.toThrow(PlannerSubmissionError);

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).toContain('stub__submit_architecture');
    expect(prompt).not.toContain('mcp__eforge_engine__');
  });

  it('reports backend-visible names in the thrown PlannerSubmissionError when no submission tool was called', async () => {
    const backend = new PrefixedStubHarness([{ text: 'Nothing to do.' }]);
    const cwd = makeTempDir();

    let thrown: unknown;
    try {
      await collectEvents(runPlanner('Hmm', {
        harness: backend,
        cwd,
        scope: 'excursion',
      }));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PlannerSubmissionError);
    const message = (thrown as Error).message;
    expect(message).toContain('stub__submit_plan_set');
    expect(message).not.toContain('mcp__eforge_engine__');
  });
});

// --- Reviewer ---

describe('runReview wiring', () => {
  const validReviewXml = '<review-issues><issue severity="warning" category="bug" file="src/late.ts" line="7">Late reviewer finding</issue></review-issues>';
  const reviewOptions = (harness: StubHarness, planId = 'plan-1') => ({ harness, planContent: 'test plan', baseBranch: 'main', planId, cwd: '/tmp' });
  async function collectReviewFailure(harness: StubHarness): Promise<{ events: EforgeEvent[]; thrown: unknown }> {
    const events: EforgeEvent[] = [];
    let thrown: unknown;
    try {
      for await (const event of runReview(reviewOptions(harness))) events.push(event);
    } catch (err) {
      thrown = err;
    }
    return { events, thrown };
  }

  it('parses review issues from agent output', async () => {
    const events = await collectEvents(runReview(reviewOptions(new StubHarness([{ text: `<review-issues>
  <issue severity="critical" category="bug" file="src/a.ts" line="42">Memory leak in handler</issue>
  <issue severity="warning" category="perf" file="src/b.ts">Slow query<fix>Add index</fix></issue>
</review-issues>` }]))));
    expect(findEvent(events, 'plan:build:review:start')).toBeDefined();
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toHaveLength(2);
    expect(complete!.issues[0]).toMatchObject({ severity: 'critical', category: 'bug', file: 'src/a.ts', line: 42, description: 'Memory leak in handler' });
    expect(complete!.issues[1].fix).toBe('Add index');
  });

  it('parses review issues from resultText-only reviewer output', async () => {
    const complete = findEvent(await collectEvents(runReview(reviewOptions(new StubHarness([{ resultText: validReviewXml }])))), 'plan:build:review:complete');
    expect(complete!.issues).toEqual([expect.objectContaining({ severity: 'warning', category: 'bug', file: 'src/late.ts', line: 7, description: 'Late reviewer finding' })]);
  });

  it('downgrades a late transient reviewer error after valid result text', async () => {
    const planId = 'plan-late-transient';
    const events = await collectEvents(runReview(reviewOptions(new StubHarness([{ resultText: validReviewXml, lateError: new AgentTerminalError('error_transient_transport', 'socket closed after result') }]), planId)));
    const reviewerStart = findEvent(events, 'agent:start');
    const warning = findEvent(events, 'agent:warning');
    expect(warning).toMatchObject({
      code: 'reviewer-late-infrastructure-error-downgraded',
      agent: 'reviewer',
      planId,
      agentId: reviewerStart!.agentId,
    });
    expect(findEvent(events, 'plan:build:review:complete')!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'bug', file: 'src/late.ts' })]));
  });

  it('uses final resultText when streamed reviewer output only contains a preamble', async () => {
    const events = await collectEvents(runReview(reviewOptions(new StubHarness([{
      text: 'Review summary follows. ',
      resultText: validReviewXml,
      lateError: new AgentTerminalError('error_pi_tool_infrastructure', 'tool closed after result'),
    }]))));
    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'bug', file: 'src/late.ts' })]));
    expect(complete!.issues.some(issue => issue.category === 'review-contract')).toBe(false);
  });

  it('downgrades a late Pi tool infrastructure reviewer error after valid result text', async () => {
    const events = await collectEvents(runReview(reviewOptions(new StubHarness([{ resultText: validReviewXml, lateError: new AgentTerminalError('error_pi_tool_infrastructure', 'tool closed after result') }]))));
    expect(findEvent(events, 'agent:warning')!.code).toBe('reviewer-late-infrastructure-error-downgraded');
    expect(findEvent(events, 'plan:build:review:complete')!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'bug', file: 'src/late.ts' })]));
  });

  it('rethrows a late max-turns reviewer error after valid result text', async () => {
    const { events, thrown } = await collectReviewFailure(new StubHarness([{ resultText: validReviewXml, lateError: new AgentTerminalError('error_max_turns', 'turn limit after result') }]));
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_turns');
    expect(findEvent(events, 'agent:warning')).toBeUndefined();
    expect(findEvent(events, 'plan:build:review:complete')).toBeUndefined();
  });

  it('rethrows a pre-result transient reviewer failure without a review complete event', async () => {
    const { events, thrown } = await collectReviewFailure(new StubHarness([{ error: new AgentTerminalError('error_transient_transport', 'socket closed before result') }]));
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect(findEvent(events, 'plan:build:review:complete')).toBeUndefined();
  });

  it('rethrows a late transient reviewer failure when reviewer output is invalid', async () => {
    const { events, thrown } = await collectReviewFailure(new StubHarness([{ resultText: 'Review complete without XML.', lateError: new AgentTerminalError('error_transient_transport', 'socket closed after invalid output') }]));
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect(findEvent(events, 'agent:warning')).toBeUndefined();
    expect(findEvent(events, 'plan:build:review:complete')).toBeUndefined();
  });

  it('emits a synthetic critical issue when reviewer output lacks the terminal XML block', async () => {
    const complete = findEvent(await collectEvents(runReview(reviewOptions(new StubHarness([{ text: 'Code looks good. No issues found.' }])))), 'plan:build:review:complete');
    expect(complete!.issues).toEqual([expect.objectContaining({ severity: 'critical', category: 'review-contract' })]);
  });

  it('dispatches the reviewer with read-only tools', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);
    await collectEvents(runReview(reviewOptions(backend)));
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('read-only');
  });
});

// --- Builder ---

describe('runPlanReview wiring', () => {
  it('parses review issues from plan review output', async () => {
    const backend = new StubHarness([{
      text: `<review-issues>
  <issue severity="warning" category="scope" file="plans/feature.md">Missing edge case</issue>
</review-issues>`,
    }]);

    const events = await collectEvents(runPlanReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-plan',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:review:start')).toBeDefined();
    const complete = findEvent(events, 'planning:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(1);
    expect(complete!.issues[0].category).toBe('scope');
  });

  it('includes both Claude-cased and Pi-lowercase mutation tools in denylist', async () => {
    const backend = new StubHarness([{
      text: '<review-issues></review-issues>',
    }]);

    await collectEvents(runPlanReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-plan',
      cwd: '/tmp',
    }));

    expect(backend.calls[0].disallowedTools).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'write', 'edit', 'bash']),
    );
  });
});

// --- eforge:endregion planner-review-wiring ---

// --- Plan Evaluator ---
