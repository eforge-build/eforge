import { describe, it, expect } from 'vitest';
import { Type } from '@eforge-build/extension-sdk';
import { builderImplement } from '@eforge-build/engine/agents/builder';
import type { CustomTool } from '@eforge-build/engine/harness';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { withAgentContextHooks } from '@eforge-build/engine/extensions';
import type { AgentRunRegistration, NativeExtensionRegistry } from '@eforge-build/engine/extensions';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';

// --- withAgentContextHooks registry decorator wiring ---

describe('withAgentContextHooks — registry decorator wiring', () => {
  function makeAgentRunHook(
    extensionName: string,
    handler: (ctx: import('@eforge-build/extension-sdk').AgentRunContext) => import('@eforge-build/extension-sdk').AgentRunAugmentation | undefined,
  ): AgentRunRegistration {
    return {
      kind: 'agentRunHook',
      extensionName,
      extensionPath: `/extensions/${extensionName}.js`,
      value: handler as never,
    };
  }

  it('onAgentRun registration applies promptAppend to builder run and emits applied event', async () => {
    const stub = new StubHarness([{ text: 'Implementation done.' }]);
    const innerRegistry = singletonRegistry(stub);

    const extRegistry: Pick<NativeExtensionRegistry, 'agentRunHooks' | 'tools'> = {
      agentRunHooks: [
        makeAgentRunHook('wiring-test-ext', () => ({
          promptAppend: 'WIRING_TEST_CONTEXT_SENTINEL',
        })),
      ],
      tools: [],
    };

    const decorated = withAgentContextHooks(innerRegistry, {
      extensionRegistry: extRegistry,
      profileName: 'default',
      cwd: '/tmp',
      timeoutMs: 1000,
    });

    // Run a builder through the decorated registry
    const events = await collectEvents(builderImplement(
      { id: 'plan-wiring-01', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: decorated.forRole('builder'), cwd: '/tmp' },
    ));

    // Inner stub must have received the augmented prompt
    expect(stub.prompts).toHaveLength(1);
    expect(stub.prompts[0]).toContain('WIRING_TEST_CONTEXT_SENTINEL');
    expect(stub.prompts[0]).toContain('## Native extension context');
    expect(stub.prompts[0]).toContain('### wiring-test-ext');

    // extension:agent-context:applied must appear in the event stream
    const applied = filterEvents(events, 'extension:agent-context:applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.extensionName).toBe('wiring-test-ext');
    expect(applied[0]!.role).toBe('builder');

    // Build lifecycle events still emitted normally
    expect(findEvent(events, 'plan:build:implement:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
  });

  it('extension custom tools reach AgentRunOptions and handler output appears in tool_result', async () => {
    const existingTool: CustomTool = {
      name: 'engine_tool',
      description: 'Existing engine tool',
      inputSchema: Type.Object({}),
      handler: async () => 'engine-output',
    };
    const stub = new StubHarness([
      {
        toolCalls: [
          { tool: 'extension_tool', toolUseId: 'call-1', input: { value: 42 }, output: 'fallback' },
        ],
        text: 'Done.',
      },
    ]);
    const innerRegistry = singletonRegistry(stub);

    const extRegistry: Pick<NativeExtensionRegistry, 'agentRunHooks' | 'tools'> = {
      agentRunHooks: [
        makeAgentRunHook('tools-ext', () => ({
          promptAppend: 'Use extension_tool when useful.',
          tools: [{
            name: 'extension_tool',
            description: 'Extension tool',
            inputSchema: Type.Object({}),
            handler: async (input: unknown) => `extension-output:${JSON.stringify(input)}`,
          }],
        })),
      ],
      tools: [],
    };

    const decorated = withAgentContextHooks(innerRegistry, {
      extensionRegistry: extRegistry,
      profileName: 'default',
      cwd: '/tmp',
      timeoutMs: 1000,
    });

    const events = await collectEvents(decorated.forRole('builder').run(
      {
        prompt: 'Test.',
        cwd: '/tmp',
        maxTurns: 1,
        tools: 'none',
        customTools: [existingTool],
      },
      'builder',
    ));

    expect(stub.customToolSets[0]?.map(t => t.name)).toEqual(['engine_tool', 'extension_tool']);
    const firstDiagnosticIndex = events.findIndex(e => e.type === 'extension:agent-context:applied');
    const agentStartIndex = events.findIndex(e => e.type === 'agent:start');
    expect(firstDiagnosticIndex).toBeGreaterThanOrEqual(0);
    expect(firstDiagnosticIndex).toBeLessThan(agentStartIndex);
    const toolEvents = filterEvents(events, 'extension:agent-tools:applied');
    expect(toolEvents).toHaveLength(1);
    const toolDiagnosticIndex = events.findIndex(e => e.type === 'extension:agent-tools:applied');
    expect(toolDiagnosticIndex).toBeGreaterThanOrEqual(0);
    expect(toolDiagnosticIndex).toBeLessThan(agentStartIndex);
    const toolResult = filterEvents(events, 'agent:tool_result')[0];
    expect(toolResult?.output).toBe('extension-output:{"value":42}');
  });

  it('options toolbelt fields are byte-identical before and after decoration', async () => {
    const stub = new StubHarness([{ text: 'Done.' }]);
    const innerRegistry = singletonRegistry(stub);

    const extRegistry: Pick<NativeExtensionRegistry, 'agentRunHooks' | 'tools'> = {
      agentRunHooks: [
        makeAgentRunHook('no-mutate-ext', () => ({ promptAppend: 'X' })),
      ],
      tools: [],
    };

    const decorated = withAgentContextHooks(innerRegistry, {
      extensionRegistry: extRegistry,
      profileName: 'default',
      cwd: '/tmp',
      timeoutMs: 1000,
    });

    const harness = decorated.forRole('builder');
    await collectEvents(harness.run(
      {
        prompt: 'Test.',
        cwd: '/tmp',
        maxTurns: 1,
        tools: 'none',
        allowedTools: ['read'],
        disallowedTools: [],
      },
      'builder',
    ));

    // Tools options on the call received by the inner stub must be unchanged
    expect(stub.calls[0]!.allowedTools).toEqual(['read']);
    expect(stub.calls[0]!.disallowedTools).toEqual([]);
  });
});
