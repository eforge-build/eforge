import { describe, it, expect } from 'vitest';
import type { EforgeEvent } from '../src/engine/events.js';
import { StubBackend } from './stub-backend.js';
import { collectEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { runPlanner } from '../src/engine/agents/planner.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { resolveAgentConfig } from '../src/engine/pipeline.js';

// --- runPlanner with continuation context ---

describe('runPlanner with continuation context', () => {
  const makeTempDir = useTempDir('eforge-planner-continuation-test-');

  it('includes continuation context in prompt when provided', async () => {
    const backend = new StubBackend([{ text: 'Plan complete.' }]);
    const cwd = makeTempDir();

    await collectEvents(runPlanner('Build a widget', {
      backend,
      cwd,
      auto: true,
      continuationContext: {
        attempt: 1,
        maxContinuations: 2,
        existingPlans: 'plan-01.md: Widget scaffolding',
      },
    }));

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).toContain('Continuation Context');
    expect(prompt).toContain('continuation attempt 1 of 2');
    expect(prompt).toContain('Do NOT redo');
    expect(prompt).toContain('plan-01.md: Widget scaffolding');
  });
});

// --- runPlanner without continuation context ---

describe('runPlanner without continuation context', () => {
  const makeTempDir = useTempDir('eforge-planner-no-continuation-test-');

  it('does not include continuation context when not provided', async () => {
    const backend = new StubBackend([{ text: 'Plan complete.' }]);
    const cwd = makeTempDir();

    await collectEvents(runPlanner('Build a widget', {
      backend,
      cwd,
      auto: true,
    }));

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).not.toContain('Continuation Context');
    expect(prompt).not.toContain('continuation attempt');
  });
});

// --- plan:continuation event type ---

describe('plan:continuation event type', () => {
  it('is a valid EforgeEvent', () => {
    // Type-check: this should compile without errors
    const event: EforgeEvent = {
      type: 'plan:continuation',
      attempt: 1,
      maxContinuations: 2,
    };
    expect(event.type).toBe('plan:continuation');
    expect(event.attempt).toBe(1);
    expect(event.maxContinuations).toBe(2);
  });
});

// --- Continuation context coexists with prior clarifications ---

describe('Continuation context coexists with prior clarifications', () => {
  const makeTempDir = useTempDir('eforge-planner-continuation-clarify-test-');

  it('includes both continuation context and prior clarifications in prompt', async () => {
    // First call: emit clarification questions, second call: complete
    const backend = new StubBackend([
      { text: '<clarification><question id="q1">What framework?</question></clarification>' },
      { text: 'Plan complete after clarification.' },
    ]);
    const cwd = makeTempDir();

    await collectEvents(runPlanner('Build a widget', {
      backend,
      cwd,
      auto: false,
      continuationContext: {
        attempt: 1,
        maxContinuations: 2,
        existingPlans: 'plan-01.md: Widget scaffolding',
      },
      onClarification: async () => ({ q1: 'React' }),
    }));

    // First prompt should contain continuation context
    expect(backend.prompts.length).toBeGreaterThanOrEqual(2);
    const firstPrompt = backend.prompts[0];
    expect(firstPrompt).toContain('Continuation Context');
    expect(firstPrompt).toContain('continuation attempt 1 of 2');

    // Second prompt should contain both continuation context and prior clarifications
    const secondPrompt = backend.prompts[1];
    expect(secondPrompt).toContain('Continuation Context');
    expect(secondPrompt).toContain('Prior Clarifications');
    expect(secondPrompt).toContain('React');
  });
});

// --- StubBackend error_max_turns propagation ---

describe('StubBackend error_max_turns propagation', () => {
  const makeTempDir = useTempDir('eforge-planner-maxturns-test-');

  it('propagates error_max_turns from runPlanner', async () => {
    const backend = new StubBackend([{
      error: new Error('Agent planner failed: error_max_turns'),
    }]);
    const cwd = makeTempDir();

    await expect(
      collectEvents(runPlanner('Build a widget', {
        backend,
        cwd,
        auto: true,
      })),
    ).rejects.toThrow('error_max_turns');
  });
});

// --- resolveAgentConfig for builder is 50 ---

describe('resolveAgentConfig for builder', () => {
  it('returns maxTurns of 50', () => {
    const result = resolveAgentConfig('builder', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(50);
  });
});

// --- resolveAgentConfig for planner is 30 ---

describe('resolveAgentConfig for planner', () => {
  it('returns maxTurns of 30 (global default, no role-specific override)', () => {
    const result = resolveAgentConfig('planner', DEFAULT_CONFIG);
    expect(result.maxTurns).toBe(30);
  });
});
