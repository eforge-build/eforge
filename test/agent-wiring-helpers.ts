import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import type { EforgeConfig } from '@eforge-build/engine/config';

export function makeStubHarness(...responses: ConstructorParameters<typeof StubHarness>[0]): StubHarness {
  return new StubHarness(responses);
}

export function makeAgentPlanFile(id = 'plan-1') {
  return { id, name: 'Feature', dependsOn: [], branch: `feature/${id}`, body: 'content', filePath: `/tmp/${id}.md` };
}

export function makeAgentConfig(overrides: Partial<EforgeConfig> = {}): EforgeConfig {
  return { ...overrides } as EforgeConfig;
}

export class StopErrorHarness implements AgentHarness {
  constructor(
    private readonly stopErrorMessage: string,
    private readonly emitResultBeforeStop = false,
  ) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(_options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = 'stop-error-agent-1';
    yield {
      type: 'agent:start',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      model: 'stub-model',
      harness: 'pi' as const,
      harnessSource: 'tier' as const,
      tier: 'stub',
      tierSource: 'tier' as const,
    };
    if (this.emitResultBeforeStop) {
      yield {
        type: 'agent:result',
        planId,
        agentId,
        agent,
        result: {
          durationMs: 100,
          durationApiMs: 80,
          numTurns: 1,
          totalCostUsd: 0,
          usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
          modelUsage: {},
          resultText: 'Implementation done.',
        },
      };
    }
    yield {
      type: 'agent:stop',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      error: this.stopErrorMessage,
    };
  }
}
