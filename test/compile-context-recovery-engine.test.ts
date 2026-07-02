import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collect } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-compile-context-recovery-engine-');

describe('compile context recovery engine integration', () => {
  it('classifies provider context-length failures inside the bounded compiler as typed compile failures', async () => {
    const harness = new StubHarness([
      { error: new AgentTerminalError('error_during_execution', 'context_length_exceeded maximum context length') },
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
    expect(events[scopeFailureIndex]).toMatchObject({ type: 'planning:scope-context:failure', failure: { source: 'provider', failureKind: 'context-length' } });
    expect(events[terminalIndex]).toMatchObject({ type: 'build:terminal-failure', failure: { scope: 'compile', terminalSubtype: 'error_context_window' } });
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
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


