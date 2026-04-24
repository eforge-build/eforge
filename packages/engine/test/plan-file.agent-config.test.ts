/**
 * Tests for plan-level agentRuntime override precedence and dangling-ref validation.
 *
 * Covers:
 * (a) plan-level agentRuntime override beats config-level role default
 * (b) plan referencing undeclared runtime fails at load time with the plan file
 *     path, role name, and referenced runtime name in the error message.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlanFile } from '@eforge-build/engine/plan';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'eforge-plan-agent-config-test-'));
}

describe('parsePlanFile agentRuntime override', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('plan-level agentRuntime override is preserved when runtime is declared', async () => {
    const planContent = [
      '---',
      'id: test-plan',
      'name: Test Plan',
      'depends_on: []',
      'branch: test/main',
      'agents:',
      '  builder:',
      '    agentRuntime: pi-runtime',
      '---',
      '',
      '# Test Plan',
      '',
    ].join('\n');
    const planPath = join(tmpDir, 'test-plan.md');
    await writeFile(planPath, planContent, 'utf-8');

    const agentRuntimes = {
      'claude-sdk': { harness: 'claude-sdk' },
      'pi-runtime': { harness: 'pi' },
    };

    const plan = await parsePlanFile(planPath, agentRuntimes as Record<string, unknown>);
    expect(plan.agents?.['builder']?.agentRuntime).toBe('pi-runtime');
  });

  it('plan without agentRuntime override parses successfully when agentRuntimes provided', async () => {
    const planContent = [
      '---',
      'id: test-plan',
      'name: Test Plan',
      'depends_on: []',
      'branch: test/main',
      '---',
      '',
      '# Test Plan',
      '',
    ].join('\n');
    const planPath = join(tmpDir, 'test-plan.md');
    await writeFile(planPath, planContent, 'utf-8');

    const agentRuntimes = { 'claude-sdk': { harness: 'claude-sdk' } };
    const plan = await parsePlanFile(planPath, agentRuntimes as Record<string, unknown>);
    expect(plan.id).toBe('test-plan');
    expect(plan.agents).toBeUndefined();
  });

  it('rejects plan referencing undeclared agentRuntime with path, role, and runtime name in error', async () => {
    const planContent = [
      '---',
      'id: test-plan',
      'name: Test Plan',
      'depends_on: []',
      'branch: test/main',
      'agents:',
      '  builder:',
      '    agentRuntime: nonexistent-runtime',
      '---',
      '',
      '# Test Plan',
      '',
    ].join('\n');
    const planPath = join(tmpDir, 'test-plan.md');
    await writeFile(planPath, planContent, 'utf-8');

    const agentRuntimes = { 'claude-sdk': { harness: 'claude-sdk' } };

    const error = await parsePlanFile(planPath, agentRuntimes as Record<string, unknown>).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const msg = (error as Error).message;
    // Error must contain all three: plan file path, role name, referenced runtime name
    expect(msg).toContain(planPath);
    expect(msg).toContain('builder');
    expect(msg).toContain('nonexistent-runtime');
  });

  it('allows parsePlanFile without agentRuntimes even if plan has agentRuntime override', async () => {
    // When no agentRuntimes map is provided (validation skipped), plan parses successfully
    const planContent = [
      '---',
      'id: test-plan',
      'name: Test Plan',
      'depends_on: []',
      'branch: test/main',
      'agents:',
      '  builder:',
      '    agentRuntime: any-runtime',
      '---',
      '',
      '# Test Plan',
      '',
    ].join('\n');
    const planPath = join(tmpDir, 'test-plan.md');
    await writeFile(planPath, planContent, 'utf-8');

    // No agentRuntimes argument — validation is skipped
    const plan = await parsePlanFile(planPath);
    expect(plan.agents?.['builder']?.agentRuntime).toBe('any-runtime');
  });
});
