import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { StubHarness } from './stub-harness.js';
import { collect } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-compile-context-recovery-engine-');

describe('compile context recovery engine integration', () => {
  it('classifies provider context-length planner failures as typed compile failures', async () => {
    const harness = new StubHarness([
      { resultText: composer('expedition') },
      { error: new AgentTerminalError('error_during_execution', 'context_length_exceeded maximum context length') },
    ]);
    const engine = await EforgeEngine.create({ cwd: await setupProject(), agentRuntimes: harness });
    const events = await collect(engine.compile('# Context failure', { name: `compile-context-${Date.now()}` }));
    const scopeFailureIndex = events.findIndex((event) => event.type === 'planning:scope-context:failure');
    const terminalIndex = events.findIndex((event) => event.type === 'build:terminal-failure');
    const phaseEndIndex = events.findIndex((event) => event.type === 'phase:end');

    expect(scopeFailureIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThan(scopeFailureIndex);
    expect(phaseEndIndex).toBeGreaterThan(terminalIndex);
    expect(events[scopeFailureIndex]).toMatchObject({ type: 'planning:scope-context:failure', failure: { source: 'provider', failureKind: 'context-length', stage: 'planner' } });
    expect(events[terminalIndex]).toMatchObject({ type: 'build:terminal-failure', failure: { scope: 'compile', terminalSubtype: 'error_context_window', stage: 'planner' } });
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'phase:end', result: { status: 'failed' } });
  });

  it('caps retry-as-expedition after one preflight escalation and emits bounded decomposition guidance', async () => {
    const harness = new StubHarness([
      { resultText: composer('excursion') },
      { error: new AgentTerminalError('error_during_execution', 'context window exceeded before submission') },
      { error: new AgentTerminalError('error_during_execution', 'context window exceeded after retry') },
    ]);
    const engine = await EforgeEngine.create({ cwd: await setupProject(), agentRuntimes: harness });
    const overflowSource = `# Retry cap\n\nTouch packages/engine packages/client packages/monitor packages/console-ui.\n\n${'large scope evidence\n'.repeat(5_000)}`;
    const events = await collect(engine.compile(overflowSource, { name: `compile-context-retry-${Date.now()}` }));
    const plannerPromptCount = harness.calls.filter((_call, index) => index > 0).length;
    const failures = events.filter((event): event is Extract<EforgeEvent, { type: 'planning:scope-context:failure' }> => event.type === 'planning:scope-context:failure');
    const attempted = failures.find((event) => event.failure.recovery.attempted);
    const terminal = failures.at(-1);

    expect(plannerPromptCount).toBe(1);
    expect(attempted).toMatchObject({ failure: { recovery: { action: 'retry-as-expedition', attempted: true } } });
    expect(terminal?.failure.recovery.action).toMatch(/bounded-decomposition|manual-reduce-scope/);
    expect(terminal?.failure.recovery.attempt).toBeGreaterThanOrEqual(terminal?.failure.recovery.maxAttempts ?? 1);
    expect(events.at(-1)).toMatchObject({ type: 'phase:end', result: { status: 'failed' } });
  });
});

async function setupProject(): Promise<string> {
  const cwd = makeTempDir();
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], { cwd });
  await mkdir(resolve(cwd, 'eforge'), { recursive: true });
  await writeFile(resolve(cwd, 'eforge/config.yaml'), 'plugins:\n  enabled: false\n', 'utf8');
  return cwd;
}

function composer(scope: 'errand' | 'excursion' | 'expedition'): string {
  return JSON.stringify({
    scope,
    compile: ['planner'],
    defaultBuild: ['implement', 'review-cycle'],
    defaultReview: DEFAULT_REVIEW,
    rationale: 'test',
  });
}

