import { describe, expect, it } from 'vitest';
import { runResolvedAgentTask } from '@eforge-build/engine/agents/resolved-agent-task';
import { StubHarness } from './stub-harness.js';
import type { CustomTool } from '@eforge-build/engine/harness';

async function drain<T>(task: AsyncGenerator<unknown, T>): Promise<T> {
  let next = await task.next();
  while (!next.done) next = await task.next();
  return next.value;
}

describe('runResolvedAgentTask', () => {
  it('renders prompt templates before invoking the harness', async () => {
    const harness = new StubHarness([{ text: 'ok' }]);
    await drain(runResolvedAgentTask({ harness, cwd: process.cwd(), promptTemplate: 'Hello {{name}}', variables: { name: 'Ada' }, promptLabel: 'test', getResult: () => 'done', missingResultMessage: 'missing' }));
    expect(harness.prompts[0]).toBe('Hello Ada');
  });

  it('throws unresolved-template-variable errors before harness invocation', async () => {
    const harness = new StubHarness([{ text: 'never' }]);
    await expect(drain(runResolvedAgentTask({ harness, cwd: process.cwd(), promptTemplate: 'Hello {{missing}}', variables: {}, promptLabel: 'test-template', getResult: () => 'done', missingResultMessage: 'missing' }))).rejects.toThrow('test-template: unresolved template variables: missing');
    expect(harness.calls).toHaveLength(0);
  });

  it('captures custom tool results through caller-owned callbacks', async () => {
    let submitted: { ok: boolean } | undefined;
    const tool: CustomTool = { name: 'submit', description: 'submit', inputSchema: { type: 'object', properties: {}, additionalProperties: true }, async handler(input) { submitted = input as { ok: boolean }; return 'accepted'; } } as CustomTool;
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit', toolUseId: 'call-1', input: { ok: true }, output: '' }] }]);
    const result = await drain(runResolvedAgentTask({ harness, cwd: process.cwd(), promptTemplate: 'Run', promptLabel: 'test', customTools: [tool], getResult: () => submitted, missingResultMessage: 'missing' }));
    expect(result).toEqual({ ok: true });
  });

  it('forwards tool presets, allowed tools, and cancellation signals', async () => {
    const controller = new AbortController();
    const harness = new StubHarness([{ text: 'ok' }]);
    await drain(runResolvedAgentTask({ harness, cwd: process.cwd(), promptTemplate: 'Run', promptLabel: 'test', tools: 'none', allowedTools: ['Read'], abortController: controller, getResult: () => 'done', missingResultMessage: 'missing' }));
    expect(harness.calls[0]?.tools).toBe('none');
    expect(harness.calls[0]?.allowedTools).toEqual(['Read']);
    expect(harness.calls[0]?.abortSignal).toBe(controller.signal);
  });

  it('does not load prompt templates from paths or prompt ids', async () => {
    const harness = new StubHarness([{ text: 'ok' }]);
    await drain(runResolvedAgentTask({ harness, cwd: process.cwd(), promptTemplate: './missing/{{name}}.md', variables: { name: 'asset' }, promptLabel: 'literal-template', getResult: () => 'done', missingResultMessage: 'missing' }));
    expect(harness.prompts[0]).toBe('./missing/asset.md');
  });
});
