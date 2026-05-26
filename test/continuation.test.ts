import { describe, it, expect } from 'vitest';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { builderImplement } from '@eforge-build/engine/agents/builder';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const makePlanFile = (id = 'plan-01') => ({
  id,
  name: 'Test Plan',
  dependsOn: [],
  branch: 'test/main',
  body: '# Test\n\nImplement something.',
  filePath: '/tmp/test-plan.md',
});

// --- builderImplement without continuation ---

describe('builderImplement without continuation', () => {
  const makeTempDir = useTempDir('eforge-continuation-test-');

  it('succeeds without continuation on normal completion', async () => {
    const backend = new StubHarness([{ text: 'Implementation complete.' }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    const events = await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
    }));

    expect(findEvent(events, 'plan:build:implement:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
    expect(findEvent(events, 'plan:build:failed')).toBeUndefined();
    // No continuation events
    const continuations = filterEvents(events, 'plan:build:implement:continuation' as EforgeEvent['type']);
    expect(continuations).toHaveLength(0);
  });

  it('emits build:failed on error_max_turns without continuation context', async () => {
    const backend = new StubHarness([{
      error: new AgentTerminalError('error_max_turns', 'Reached maximum number of turns (50).'),
    }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    const events = await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
    }));

    expect(findEvent(events, 'plan:build:implement:start')).toBeDefined();
    const failed = findEvent(events, 'plan:build:failed');
    expect(failed).toBeDefined();
    expect(failed!.error).toContain('Reached maximum number of turns');
    expect(failed!.terminalSubtype).toBe('error_max_turns');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeUndefined();
  });

  it('emits build:failed on non-max_turns errors', async () => {
    const backend = new StubHarness([{
      error: new Error('Agent builder failed: some_other_error'),
    }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    const events = await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
    }));

    const failed = findEvent(events, 'plan:build:failed');
    expect(failed).toBeDefined();
    expect(failed!.error).toContain('some_other_error');
    expect(failed!.error).not.toContain('error_max_turns');
  });
});

// --- builderImplement with continuation context ---

describe('builderImplement with continuation context', () => {
  const makeTempDir = useTempDir('eforge-continuation-ctx-test-');

  it('includes continuation context in prompt when provided (checkpointed-diff)', async () => {
    const backend = new StubHarness([{ text: 'Continued implementation.' }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
      continuationContext: {
        attempt: 1,
        maxContinuations: 3,
        handoffMode: 'checkpointed-diff',
        completedDiff: 'diff --git a/foo.ts b/foo.ts\n+added line',
      },
    }));

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).toContain('Continuation Context');
    expect(prompt).toContain('continuation attempt 1 of 3');
    expect(prompt).toContain('diff --git a/foo.ts b/foo.ts');
    expect(prompt).toContain('Do NOT redo any of the completed work');
    expect(prompt).toContain('All prior progress has been committed');
  });

  it('discovery-only continuation: prompt contains discovery sections and omits committed-progress statement', async () => {
    const backend = new StubHarness([{ text: 'Continued implementation.' }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
      continuationContext: {
        attempt: 2,
        maxContinuations: 3,
        handoffMode: 'discovery-only',
        filesInspected: ['src/engine.ts', 'src/retry.ts'],
        searches: ['grep: withRetry in packages'],
        commands: ['pnpm type-check'],
        recentMessages: ['Inspected the retry module.'],
        toolResultSnippets: ['[Read] export async function* withRetry'],
      },
    }));

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).toContain('Continuation Context');
    expect(prompt).toContain('continuation attempt 2 of 3');
    // Discovery sections present
    expect(prompt).toContain('Files inspected');
    expect(prompt).toContain('src/engine.ts');
    expect(prompt).toContain('Searches and globs run');
    expect(prompt).toContain('grep: withRetry');
    expect(prompt).toContain('Shell commands run');
    expect(prompt).toContain('pnpm type-check');
    expect(prompt).toContain('Recent agent messages');
    expect(prompt).toContain('Inspected the retry module.');
    expect(prompt).toContain('Tool result snippets');
    expect(prompt).toContain('withRetry');
    // Must NOT contain committed-progress statement
    expect(prompt).not.toContain('All prior progress has been committed');
    // Must contain the no-checkpoint handoff distinction
    expect(prompt).toContain('No checkpoint commit was created');
  });

  it('discovery-only continuation with all empty lists renders a fallback message', async () => {
    const backend = new StubHarness([{ text: 'Continued implementation.' }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
      continuationContext: {
        attempt: 1,
        maxContinuations: 2,
        handoffMode: 'discovery-only',
        filesInspected: [],
        searches: [],
        commands: [],
        recentMessages: [],
        toolResultSnippets: [],
      },
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('Continuation Context');
    // Falls back to the "no discovery events" message
    expect(prompt).toContain('No discovery events were captured');
    expect(prompt).not.toContain('All prior progress has been committed');
  });

  it('does not include continuation context when not provided', async () => {
    const backend = new StubHarness([{ text: 'Normal implementation.' }]);
    const cwd = makeTempDir();
    const plan = makePlanFile();

    await collectEvents(builderImplement(plan, {
      harness: backend,
      cwd,
    }));

    expect(backend.prompts).toHaveLength(1);
    const prompt = backend.prompts[0];
    expect(prompt).not.toContain('Continuation Context');
    expect(prompt).not.toContain('continuation attempt');
  });
});

// --- Config: maxContinuations ---

describe('maxContinuations config', () => {
  it('DEFAULT_CONFIG has maxContinuations = 3', () => {
    expect(DEFAULT_CONFIG.agents.maxContinuations).toBe(3);
  });
});

// --- OrchestrationConfig: maxContinuations per-plan ---

describe('parseOrchestrationConfig with maxContinuations', () => {
  const makeTempDir = useTempDir('eforge-orch-config-test-');

  it('parses maxContinuations from plan entries', async () => {
    const dir = makeTempDir();
    const orchYaml = `
name: test-set
description: Test
created: "2024-01-01"
mode: errand
base_branch: main
pipeline:
  scope: errand
  compile:
    - planner
  defaultBuild:
    - implement
    - review-cycle
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: test
plans:
  - id: plan-01
    name: Test Plan
    depends_on: []
    branch: test/main
    max_continuations: 5
    build:
      - implement
      - review-cycle
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
`;
    const orchPath = join(dir, 'orchestration.yaml');
    writeFileSync(orchPath, orchYaml);

    const config = await parseOrchestrationConfig(orchPath);
    expect(config.plans[0].maxContinuations).toBe(5);
  });

  it('omits maxContinuations when not specified', async () => {
    const dir = makeTempDir();
    const orchYaml = `
name: test-set
description: Test
created: "2024-01-01"
mode: errand
base_branch: main
pipeline:
  scope: errand
  compile:
    - planner
  defaultBuild:
    - implement
    - review-cycle
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: test
plans:
  - id: plan-01
    name: Test Plan
    depends_on: []
    branch: test/main
    build:
      - implement
      - review-cycle
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
`;
    const orchPath = join(dir, 'orchestration.yaml');
    writeFileSync(orchPath, orchYaml);

    const config = await parseOrchestrationConfig(orchPath);
    expect(config.plans[0].maxContinuations).toBeUndefined();
  });
});

// --- EforgeEvent type: build:implement:continuation ---

describe('build:implement:continuation event type', () => {
  it('is a valid EforgeEvent', () => {
    // Type-check: this should compile without errors
    const event: EforgeEvent = {
      type: 'plan:build:implement:continuation',
      planId: 'plan-01',
      attempt: 1,
      maxContinuations: 3,
    };
    expect(event.type).toBe('plan:build:implement:continuation');
    expect(event.attempt).toBe(1);
    expect(event.maxContinuations).toBe(3);
  });
});
