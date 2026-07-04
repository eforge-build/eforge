import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { isTransientTransportError, classifyAgentTerminalSubtype } from '@eforge-build/engine/harness';
import type { EforgeEvent, AgentRole, AgentResultData, PlanFile } from '@eforge-build/engine/events';
import { builderImplement } from '@eforge-build/engine/agents/builder';
import { AgentTerminalError, isPiToolInfrastructureError } from '@eforge-build/engine/harness';
import { withRetry, DEFAULT_RETRY_POLICIES, type BuilderContinuationInput, type PlannerContinuationInput, type RetryPolicy } from '@eforge-build/engine/retry';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { openDatabase } from '@eforge-build/monitor/db';
import { collectEvents, filterEvents, findEvent } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

const TRANSIENT_CLOSE = 'Backend error: WebSocket closed 1012';
const TRANSIENT_CLOSE_1000 = 'Backend error: WebSocket closed 1000';
const CODEX_SSE_HEADERS_TIMEOUT = 'Backend error: Codex SSE response headers timed out after 10000ms';
// Exact observed Claude Code SDK socket-close message (raw and eforge-wrapped forms).
const CLAUDE_SDK_SOCKET_CLOSE_RAW =
  "API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
const CLAUDE_SDK_SOCKET_CLOSE_WRAPPED =
  "Claude Code returned an error result: API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";

const RESULT: AgentResultData = {
  durationMs: 10,
  durationApiMs: 8,
  numTurns: 1,
  totalCostUsd: 0,
  usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
  modelUsage: {},
  resultText: 'done',
};

function makePlan(): PlanFile {
  return {
    id: 'plan-01-transport-resilience',
    name: 'Pi Transport Close Resilience',
    dependsOn: [],
    branch: 'test/transport-resilience',
    body: '# Plan\n\nImplement transport resilience.',
    filePath: '/tmp/plan.md',
  };
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@eforge.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

function commitFile(dir: string, file: string, content: string): void {
  writeFileSync(join(dir, file), content);
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-m', `test: commit ${file}`], { cwd: dir });
}

class BuilderScriptHarness implements AgentHarness {
  constructor(private readonly script: (options: AgentRunOptions, agentId: string, agent: AgentRole, planId?: string) => AsyncGenerator<EforgeEvent>) {}

  effectiveCustomToolName(name: string): string {
    return name;
  }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = 'builder-agent-1';
    let error: string | undefined;
    yield {
      type: 'agent:start',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      model: 'stub-model',
      harness: 'pi',
      harnessSource: 'tier',
      tier: 'stub',
      tierSource: 'tier',
    };
    try {
      yield* this.script(options, agentId, agent, planId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      yield { type: 'agent:stop', timestamp: new Date().toISOString(), planId, agentId, agent, error };
    }
  }
}

function resultEvent(agentId: string, agent: AgentRole, planId?: string): EforgeEvent {
  return { type: 'agent:result', timestamp: new Date().toISOString(), planId, agentId, agent, result: RESULT };
}

describe('Pi transport transient classifier', () => {
  it('recognizes observed transient WebSocket close messages conservatively', () => {
    expect(isTransientTransportError('Backend error: WebSocket closed 1012')).toBe(true);
    expect(isTransientTransportError('Backend error: WebSocket error')).toBe(true);
    expect(isTransientTransportError('Backend error: invalid API key')).toBe(false);
  });

  it('recognizes Backend error: WebSocket closed 1000 (observed planner failure)', () => {
    expect(isTransientTransportError('Backend error: WebSocket closed 1000')).toBe(true);
  });

  it('classifies any backend WebSocket close code as transient transport', () => {
    // Arbitrary numeric close codes from the backend are all transient transport.
    expect(isTransientTransportError('Backend error: WebSocket closed 1001')).toBe(true);
    expect(isTransientTransportError('Backend error: WebSocket closed 4000')).toBe(true);
  });

  it('does not classify non-transport backend errors as transient transport', () => {
    // Auth / model / budget-style backend application failures must not be classified
    // as transient transport, regardless of the numeric content in the message.
    expect(isTransientTransportError('Backend error: invalid API key')).toBe(false);
    expect(isTransientTransportError('Backend error: authentication failed')).toBe(false);
    expect(isTransientTransportError('Backend error: model not found')).toBe(false);
    expect(isTransientTransportError('Backend error: budget exceeded 1000 USD')).toBe(false);
    expect(isTransientTransportError('Backend error: HTTP 500')).toBe(false);
  });

  it('does not classify bare WebSocket close codes without the backend-error prefix', () => {
    // A message with a close code but missing the required prefix must not match.
    expect(isTransientTransportError('WebSocket closed 1000')).toBe(false);
    expect(isTransientTransportError('connection closed 1000')).toBe(false);
    expect(isTransientTransportError('closed 1000')).toBe(false);
  });

  it('classifies backend upstream idle timeouts as transient transport (observed atom-planner failure)', () => {
    expect(isTransientTransportError('Backend error: Upstream idle timeout exceeded')).toBe(true);
    // The retry loop classifies errors wrapped by outer planner-compiler context too.
    expect(isTransientTransportError('atom planner failed:atom-root: Backend error: Upstream idle timeout exceeded')).toBe(true);
  });

  it('classifies backend WebSocket idle timeouts as transient transport (observed intake failure)', () => {
    expect(isTransientTransportError('Backend error: WebSocket idle timeout after 300000ms')).toBe(true);
  });

  it('does not classify idle-timeout text without the backend-error prefix', () => {
    expect(isTransientTransportError('Upstream idle timeout exceeded')).toBe(false);
    expect(isTransientTransportError('daemon request timed out (idle timeout)')).toBe(false);
  });

  it('classifies the raw Claude Code SDK socket-close message as transient transport', () => {
    expect(isTransientTransportError(CLAUDE_SDK_SOCKET_CLOSE_RAW)).toBe(true);
  });

  it('classifies the eforge-wrapped Claude Code SDK socket-close message as transient transport', () => {
    expect(isTransientTransportError(CLAUDE_SDK_SOCKET_CLOSE_WRAPPED)).toBe(true);
  });

  it('does not classify generic API Error messages as transient transport', () => {
    expect(isTransientTransportError('API Error: invalid API key')).toBe(false);
    expect(isTransientTransportError('Claude Code returned an error result: API Error: authentication failed')).toBe(false);
    expect(isTransientTransportError('API Error: model not found')).toBe(false);
    expect(isTransientTransportError('API Error: budget exceeded')).toBe(false);
    expect(isTransientTransportError('API Error: HTTP 500 internal server error')).toBe(false);
  });

  it('does not classify generic socket or connection messages without the API Error prefix', () => {
    expect(isTransientTransportError('socket connection was closed unexpectedly')).toBe(false);
    expect(isTransientTransportError('The socket connection was closed unexpectedly')).toBe(false);
  });

  it('classifies only backend Codex SSE response-header timeouts as transient transport', () => {
    expect(isTransientTransportError(CODEX_SSE_HEADERS_TIMEOUT)).toBe(true);
    expect(isTransientTransportError('command timed out after 10000ms')).toBe(false);
    expect(isTransientTransportError('SSE response headers timed out after 10000ms')).toBe(false);
  });
});

describe('classifyAgentTerminalSubtype Claude SDK socket close', () => {
  it('classifies a plain Error with raw Claude SDK socket-close message as error_transient_transport', () => {
    expect(classifyAgentTerminalSubtype(new Error(CLAUDE_SDK_SOCKET_CLOSE_RAW))).toBe('error_transient_transport');
  });

  it('classifies a plain Error with wrapped Claude SDK socket-close message as error_transient_transport', () => {
    expect(classifyAgentTerminalSubtype(new Error(CLAUDE_SDK_SOCKET_CLOSE_WRAPPED))).toBe('error_transient_transport');
  });

  it('classifies an AgentTerminalError whose detail contains the socket-close message as error_transient_transport', () => {
    const err = new AgentTerminalError('error_during_execution', CLAUDE_SDK_SOCKET_CLOSE_RAW);
    expect(classifyAgentTerminalSubtype(err)).toBe('error_transient_transport');
  });

  it('classifies backend Codex SSE response-header timeout errors as error_transient_transport', () => {
    expect(classifyAgentTerminalSubtype(new Error(CODEX_SSE_HEADERS_TIMEOUT))).toBe('error_transient_transport');
  });

  it('preserves original AgentTerminalError subtype when message is not a transport error', () => {
    const err = new AgentTerminalError('error_max_turns', 'Reached maximum number of turns.');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_max_turns');
  });
});

describe('builderImplement transient transport downgrade', () => {
  const makeTempDir = useTempDir('eforge-pi-transport-builder-');

  it('downgrades a post-result transient close only when HEAD advanced', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (options, agentId, agent, planId) {
      commitFile(options.cwd, 'done.txt', 'done\n');
      yield resultEvent(agentId, agent, planId);
      throw new Error(TRANSIENT_CLOSE);
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const warnings = filterEvents(events, 'agent:warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('transient-transport-downgraded');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
  });

  it('classifies a pre-result transient close as a build failure', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* () {
      throw new Error(TRANSIENT_CLOSE);
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_transient_transport');
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(0);
  });

  it('does not downgrade post-result transient closes when HEAD did not advance', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (_options, agentId, agent, planId) {
      yield resultEvent(agentId, agent, planId);
      throw new Error(TRANSIENT_CLOSE);
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_transient_transport');
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(0);
  });

  it('does not downgrade transient closes when HEAD advanced but no agent:result was emitted', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (options) {
      commitFile(options.cwd, 'done.txt', 'done\n');
      throw new Error(TRANSIENT_CLOSE);
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_transient_transport');
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(0);
  });

  it('does not downgrade post-result non-transient backend failures', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (options, agentId, agent, planId) {
      commitFile(options.cwd, 'done.txt', 'done\n');
      yield resultEvent(agentId, agent, planId);
      throw new Error('Backend error: invalid API key');
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe('Backend error: invalid API key');
    expect(failures[0].terminalSubtype).toBeUndefined();
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(0);
  });
});

describe('builderImplement pi-infrastructure downgrade', () => {
  const makeTempDir = useTempDir('eforge-pi-infra-builder-');

  it('downgrades post-result pi-infrastructure error when HEAD advanced', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (options, agentId, agent, planId) {
      commitFile(options.cwd, 'done.txt', 'done\n');
      yield resultEvent(agentId, agent, planId);
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const warnings = filterEvents(events, 'agent:warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('pi-infrastructure-downgraded');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
  });

  it('does not downgrade pi-infrastructure error when HEAD did not advance', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (_options, agentId, agent, planId) {
      yield resultEvent(agentId, agent, planId);
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_pi_tool_infrastructure');
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
  });

  it('classifies pre-result pi-infrastructure error as a build failure', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* () {
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_pi_tool_infrastructure');
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(0);
  });
});

describe('builderImplement Claude SDK socket-close regressions', () => {
  const makeTempDir = useTempDir('eforge-claude-sdk-socket-builder-');

  it('retries a pre-result Claude SDK socket-close error and emits one agent:retry with error_transient_transport', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    let attempts = 0;
    // Retry is orchestrated by withRetry (not builderImplement internally).
    // Use the same pattern as "builder withRetry transient transport continuation".
    const runBuilderAttempt = async function* (input: BuilderContinuationInput): AsyncGenerator<EforgeEvent> {
      attempts++;
      if (attempts === 1) {
        throw new Error(CLAUDE_SDK_SOCKET_CLOSE_RAW);
      }
      yield { type: 'plan:build:implement:complete', timestamp: new Date().toISOString(), planId: input.planId };
    };

    const policy = DEFAULT_RETRY_POLICIES.builder as RetryPolicy<BuilderContinuationInput>;
    const events = await collectEvents(withRetry(runBuilderAttempt, policy, {
      worktreePath: cwd,
      baseBranch: 'main',
      planId: 'plan-01-transport-resilience',
      builderOptions: {},
    }));

    expect(attempts).toBe(2);
    const retries = filterEvents(events, 'agent:retry');
    expect(retries).toHaveLength(1);
    expect(retries[0].subtype).toBe('error_transient_transport');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
  });

  it('downgrades a post-result Claude SDK socket-close error to transient-transport-downgraded when HEAD advanced', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const harness = new BuilderScriptHarness(async function* (options, agentId, agent, planId) {
      commitFile(options.cwd, 'done.txt', 'done\n');
      yield resultEvent(agentId, agent, planId);
      throw new Error(CLAUDE_SDK_SOCKET_CLOSE_RAW);
    });

    const events = await collectEvents(builderImplement(makePlan(), { harness, cwd }));

    const warnings = filterEvents(events, 'agent:warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('transient-transport-downgraded');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
  });
});

describe('builder withRetry transient transport continuation', () => {
  const makeTempDir = useTempDir('eforge-pi-transport-builder-retry-');

  it('retries plain transient transport errors with the builder policy', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    let attempts = 0;
    const runBuilderAttempt = async function* (input: BuilderContinuationInput): AsyncGenerator<EforgeEvent> {
      attempts++;
      if (attempts === 1) {
        writeFileSync(join(input.worktreePath, 'partial.txt'), 'partial progress\n');
        throw new Error(TRANSIENT_CLOSE);
      }
      yield { type: 'plan:build:implement:complete', timestamp: new Date().toISOString(), planId: input.planId };
    };

    const policy = DEFAULT_RETRY_POLICIES.builder as RetryPolicy<BuilderContinuationInput>;
    const events = await collectEvents(withRetry(runBuilderAttempt, policy, {
      worktreePath: cwd,
      baseBranch: 'main',
      planId: 'plan-01-transport-resilience',
      builderOptions: {},
    }));

    expect(attempts).toBe(2);
    const retry = findEvent(events, 'agent:retry');
    expect(retry).toMatchObject({
      agent: 'builder',
      subtype: 'error_transient_transport',
      label: 'builder-continuation',
      planId: 'plan-01-transport-resilience',
    });
    expect(findEvent(events, 'plan:build:implement:continuation')).toBeDefined();
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
  });
});

describe('planner withRetry transient transport continuation', () => {
  const makeTempDir = useTempDir('eforge-pi-transport-planner-');

  it('retries a transient close before planning:submission using dropped-submission continuation context', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const seenInputs: PlannerContinuationInput[] = [];
    const runPlannerAttempt = async function* (input: PlannerContinuationInput): AsyncGenerator<EforgeEvent> {
      attempts++;
      seenInputs.push(input);
      if (attempts === 1) {
        yield { type: 'agent:result', timestamp: new Date().toISOString(), agentId: 'planner-1', agent: 'planner', result: RESULT };
        throw new Error(TRANSIENT_CLOSE);
      }
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events = await collectEvents(withRetry(runPlannerAttempt, policy, initialInput));

    expect(attempts).toBe(2);
    expect(seenInputs[1]?.plannerOptions.continuationContext).toMatchObject({
      attempt: 1,
      maxContinuations: 2,
      reason: 'dropped_submission',
      existingPlans: '[No existing plans — previous attempt did not submit]',
    });
    const retry = findEvent(events, 'agent:retry');
    expect(retry?.subtype).toBe('error_transient_transport');
    const continuation = findEvent(events, 'planning:continuation');
    expect(continuation?.reason).toBe('dropped_submission');
    expect(findEvent(events, 'planning:submission')).toBeDefined();
  });

  it('does not retry a transient close after planning:submission already emitted', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
      throw new Error(TRANSIENT_CLOSE);
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events: EforgeEvent[] = [];
    await expect(async () => {
      for await (const event of withRetry(runPlannerAttempt, policy, initialInput)) {
        events.push(event);
      }
    }).rejects.toThrow(TRANSIENT_CLOSE);

    expect(attempts).toBe(1);
    expect(filterEvents(events, 'planning:submission')).toHaveLength(1);
    expect(filterEvents(events, 'agent:retry')).toHaveLength(0);
  });

  it('retries close-code 1000 before planning:submission — exact observed regression case', async () => {
    // Regression test: Backend error: WebSocket closed 1000 was not classified as
    // transient transport before this fix. Verify end-to-end retry behavior.
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      if (attempts === 1) {
        throw new Error(TRANSIENT_CLOSE_1000);
      }
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events = await collectEvents(withRetry(runPlannerAttempt, policy, initialInput));

    expect(attempts).toBe(2);
    const retry = findEvent(events, 'agent:retry');
    expect(retry?.subtype).toBe('error_transient_transport');
    expect(findEvent(events, 'planning:continuation')).toBeDefined();
    expect(findEvent(events, 'planning:submission')).toBeDefined();
    expect(filterEvents(events, 'agent:retry')).toHaveLength(1);
  });

  it('does not retry close-code 1000 after planning:submission already emitted', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
      throw new Error(TRANSIENT_CLOSE_1000);
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events: EforgeEvent[] = [];
    await expect(async () => {
      for await (const event of withRetry(runPlannerAttempt, policy, initialInput)) {
        events.push(event);
      }
    }).rejects.toThrow(TRANSIENT_CLOSE_1000);

    expect(attempts).toBe(1);
    expect(filterEvents(events, 'planning:submission')).toHaveLength(1);
    expect(filterEvents(events, 'agent:retry')).toHaveLength(0);
  });

  it('downgrades close-code 1000 after planning:skip to warning (no retry, no error)', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      yield { type: 'planning:skip', timestamp: new Date().toISOString(), reason: 'already implemented' };
      throw new Error(TRANSIENT_CLOSE_1000);
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events = await collectEvents(withRetry(runPlannerAttempt, policy, initialInput));

    expect(attempts).toBe(1);
    expect(filterEvents(events, 'planning:skip')).toHaveLength(1);
    expect(filterEvents(events, 'agent:retry')).toHaveLength(0);
    const warnings = filterEvents(events, 'agent:warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('infrastructure-error-post-checkpoint-downgraded');
  });

  it('downgrades planning:complete + transient close to warning (no retry, no error)', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      yield { type: 'planning:complete', timestamp: new Date().toISOString(), plans: [] };
      throw new Error(TRANSIENT_CLOSE_1000);
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events = await collectEvents(withRetry(runPlannerAttempt, policy, initialInput));

    expect(attempts).toBe(1);
    expect(findEvent(events, 'planning:complete')).toBeDefined();
    expect(filterEvents(events, 'agent:retry')).toHaveLength(0);
    const warnings = filterEvents(events, 'agent:warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('infrastructure-error-post-checkpoint-downgraded');
    expect(warnings[0].message).toContain(TRANSIENT_CLOSE_1000);
  });

  it('retries error_pi_tool_infrastructure before planning:submission using dropped-submission context', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const seenInputs: PlannerContinuationInput[] = [];
    const runPlannerAttempt = async function* (input: PlannerContinuationInput): AsyncGenerator<EforgeEvent> {
      attempts++;
      seenInputs.push(input);
      if (attempts === 1) {
        throw new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
      }
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events = await collectEvents(withRetry(runPlannerAttempt, policy, initialInput));

    expect(attempts).toBe(2);
    expect(seenInputs[1]?.plannerOptions.continuationContext).toMatchObject({
      reason: 'dropped_submission',
    });
    const retries = filterEvents(events, 'agent:retry');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      agent: 'planner',
      subtype: 'error_pi_tool_infrastructure',
      attempt: 1,
      maxAttempts: 3,
      label: 'planner-continuation',
    });
    const continuations = filterEvents(events, 'planning:continuation');
    expect(continuations).toHaveLength(1);
    expect(continuations[0].reason).toBe('dropped_submission');
    expect(findEvent(events, 'planning:submission')).toBeDefined();
  });

  it('does not retry error_pi_tool_infrastructure after planning:submission (ambiguous, propagates error)', async () => {
    const cwd = makeTempDir();
    const initialInput: PlannerContinuationInput = {
      sideEffects: { cwd, planSetName: 'set-1', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };
    let attempts = 0;
    const runPlannerAttempt = async function* (): AsyncGenerator<EforgeEvent> {
      attempts++;
      yield { type: 'planning:submission', timestamp: new Date().toISOString(), planCount: 1, totalBodySize: 10, hasMigrations: false };
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    };

    const policy = DEFAULT_RETRY_POLICIES.planner as RetryPolicy<PlannerContinuationInput>;
    const events: EforgeEvent[] = [];
    await expect(async () => {
      for await (const event of withRetry(runPlannerAttempt, policy, initialInput)) {
        events.push(event);
      }
    }).rejects.toBeInstanceOf(AgentTerminalError);

    expect(attempts).toBe(1);
    expect(filterEvents(events, 'agent:retry')).toHaveLength(0);
    expect(filterEvents(events, 'agent:warning')).toHaveLength(0);
  });
});

describe('recovery event-history compile failure synthesis', () => {
  const makeTempDir = useTempDir('eforge-pi-transport-recovery-');

  it('synthesizes compile as the failing plan from failed phase:end plus planner agent:stop', async () => {
    const cwd = makeTempDir();
    initGitRepo(cwd);
    const dbPath = resolve(cwd, 'monitor.db');
    const db = openDatabase(dbPath);
    const runId = 'run-compile-1';
    const timestamp = new Date().toISOString();
    db.insertRun({ id: runId, sessionId: 'session-1', planSet: 'set-1', command: 'compile', status: 'failed', startedAt: timestamp, cwd });
    db.insertEvent({
      runId,
      type: 'agent:start',
      agent: 'planner',
      data: JSON.stringify({ type: 'agent:start', timestamp, agentId: 'planner-1', agent: 'planner', model: 'model-a', harness: 'pi', harnessSource: 'tier', tier: 'stub', tierSource: 'tier' }),
      timestamp,
    });
    db.insertEvent({
      runId,
      type: 'agent:stop',
      agent: 'planner',
      data: JSON.stringify({ type: 'agent:stop', timestamp, agentId: 'planner-1', agent: 'planner', error: TRANSIENT_CLOSE }),
      timestamp,
    });
    db.insertEvent({
      runId,
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', timestamp, runId, result: { status: 'failed', summary: 'compile failed' } }),
      timestamp,
    });
    db.close();

    const summary = await buildFailureSummary({ setName: 'set-1', prdId: 'prd-1', cwd, dbPath });

    expect(summary.failingPlan.planId).toBe('compile');
    expect(summary.failingPlan.agentRole).toBe('planner');
    expect(summary.failingPlan.agentId).toBe('planner-1');
    expect(summary.failingPlan.errorMessage).toContain('WebSocket closed 1012');
    expect(summary.failingPlan.terminalSubtype).toBe('error_transient_transport');
  });
});
