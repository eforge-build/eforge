/**
 * StubHarness — test helper that implements AgentHarness with scripted responses.
 * Lives in test/ (not src/) since it's only for testing.
 */
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { EforgeEvent, AgentRole, AgentResultData } from '@eforge-build/engine/events';

export interface StubToolCall {
  tool: string;
  toolUseId: string;
  input: unknown;
  output: string;
}

export type StubScriptedEvent =
  | { kind: 'message'; content: string }
  | { kind: 'usage'; usage?: Partial<AgentResultData['usage']>; costUsd?: number; numTurns?: number; final?: boolean }
  | { kind: 'tool_call'; tool: string; toolUseId: string; input: unknown; output: string }
  | { kind: 'event'; event: EforgeEvent };

export interface StubResponse {
  /** Text content the "agent" produces (emitted as agent:message events) */
  text?: string;
  /**
   * Text captured as the agent's final result (emitted on agent:result).
   * Defaults to `text` when omitted. Agents like pipeline-composer read from
   * `agent:result.resultText` rather than streaming messages.
   */
  resultText?: string;
  /** Tool use/result events to emit before the text */
  toolCalls?: StubToolCall[];
  /** Interleaved scripted events emitted before the final result. Preserves legacy toolCalls/text behavior when omitted. */
  events?: StubScriptedEvent[];
  /** Throw this error instead of completing normally */
  error?: Error;
  /** Throw this error after emitting agent:result */
  lateError?: Error;
}

const STUB_RESULT: AgentResultData = {
  durationMs: 100,
  durationApiMs: 80,
  numTurns: 1,
  totalCostUsd: 0,
  usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
  modelUsage: {},
};

type StubEmitContext = {
  planId?: string;
  agentId: string;
  agent: AgentRole;
  customToolMap: Map<string, NonNullable<AgentRunOptions['customTools']>[number]>;
};

async function* emitToolCall(tc: StubToolCall, ctx: StubEmitContext): AsyncGenerator<EforgeEvent> {
  yield { type: 'agent:tool_use', planId: ctx.planId, agentId: ctx.agentId, agent: ctx.agent, tool: tc.tool, toolUseId: tc.toolUseId, input: tc.input };
  const customTool = ctx.customToolMap.get(tc.tool);
  const output = customTool ? await customTool.handler(tc.input) : tc.output;
  yield { type: 'agent:tool_result', planId: ctx.planId, agentId: ctx.agentId, agent: ctx.agent, tool: tc.tool, toolUseId: tc.toolUseId, output };
}

async function* emitScriptedEvent(scripted: StubScriptedEvent, ctx: StubEmitContext): AsyncGenerator<EforgeEvent> {
  if (scripted.kind === 'tool_call') {
    yield* emitToolCall(scripted, ctx);
    return;
  }
  if (scripted.kind === 'usage') {
    yield {
      type: 'agent:usage',
      planId: ctx.planId,
      agentId: ctx.agentId,
      agent: ctx.agent,
      usage: { ...STUB_RESULT.usage, ...(scripted.usage ?? {}) },
      costUsd: scripted.costUsd ?? 0,
      numTurns: scripted.numTurns ?? 1,
      ...(scripted.final !== undefined ? { final: scripted.final } : {}),
    };
    return;
  }
  if (scripted.kind === 'message') {
    yield { type: 'agent:message', planId: ctx.planId, agentId: ctx.agentId, agent: ctx.agent, content: scripted.content };
    return;
  }
  yield scripted.event;
}

/**
 * A test harness that yields scripted EforgeEvents.
 *
 * Responses are consumed sequentially across multiple `run()` calls.
 * This enables testing multi-iteration flows (e.g., planner clarification
 * restarts) by providing a response for each call.
 *
 * Fidelity notes vs. real ClaudeSDKHarness:
 * - Text is emitted as a single agent:message, not streamed as many small deltas.
 *   XML parsers run on accumulated text so single-vs-chunked doesn't affect wiring tests.
 * - Tool calls are emitted before text. Real harnesses interleave text and tool_use
 *   blocks within a single assistant turn. No wiring logic depends on ordering.
 */
export class StubHarness implements AgentHarness {
  private readonly responses: StubResponse[];
  private callIndex = 0;

  /** Every prompt passed to `run()`, in order. Use for assertion. */
  readonly prompts: string[] = [];
  /** Every AgentRunOptions passed to `run()`, in order. */
  readonly calls: AgentRunOptions[] = [];
  /** Custom tools from each call, in order. Use for assertion. */
  readonly customToolSets: (AgentRunOptions['customTools'])[] = [];

  constructor(responses: StubResponse[]) {
    this.responses = responses;
  }

  /**
   * Default identity mapping: the stub treats a bare `CustomTool.name` as the
   * name the "model" calls directly, mirroring the Pi harness's convention.
   * Tests that need to verify harness-specific prompt rendering (e.g. that
   * the planner injects the per-harness effective name into the prompt) can
   * subclass `StubHarness` and override this method to return a
   * distinguishable prefix.
   */
  effectiveCustomToolName(name: string): string {
    return name;
  }

  async *run(
    options: AgentRunOptions,
    agent: AgentRole,
    planId?: string,
  ): AsyncGenerator<EforgeEvent> {
    this.prompts.push(options.prompt);
    this.calls.push(options);
    this.customToolSets.push(options.customTools);

    const agentId = crypto.randomUUID();
    yield {
      type: 'agent:start',
      planId,
      agent,
      agentId,
      model: options.model?.id ?? 'stub-model',
      harness: options.harness ?? 'claude-sdk' as const,
      harnessSource: options.harnessSource ?? 'tier',
      tier: options.tier ?? 'stub',
      tierSource: options.tierSource ?? 'tier',
      runtimeChoice: options.runtimeChoice ?? 'default',
      runtimeChoiceQualified: options.runtimeChoiceQualified ?? `${options.tier ?? 'stub'}.default`,
      runtimeChoiceSource: options.runtimeChoiceSource ?? 'default',
      ...(options.runtimeChoiceRule !== undefined && { runtimeChoiceRule: options.runtimeChoiceRule }),
      ...(options.runtimeChoiceRouter !== undefined && { runtimeChoiceRouter: options.runtimeChoiceRouter }),
      ...(options.runtimeChoiceFallbackReason !== undefined && { runtimeChoiceFallbackReason: options.runtimeChoiceFallbackReason }),
      timestamp: new Date().toISOString(),
    };

    if (options.thinkingCoerced) {
      yield { type: 'agent:warning', planId, agentId, agent, code: 'thinking-coerced', message: `Thinking coerced from 'enabled' to 'adaptive': model ${options.model?.id ?? 'unknown'} only supports adaptive thinking`, timestamp: new Date().toISOString() };
    }

    let error: string | undefined;
    try {
      const response = this.responses[this.callIndex++];
      if (!response) {
        throw new Error(`StubHarness: no response at index ${this.callIndex - 1} (only ${this.responses.length} responses provided)`);
      }

      if (response.error) {
        throw response.error;
      }

      const customToolMap = new Map(
        (options.customTools ?? []).map(ct => [ct.name, ct]),
      );
      if (response.events) {
        for (const scripted of response.events) {
          yield* emitScriptedEvent(scripted, { planId, agentId, agent, customToolMap });
        }
      } else if (response.toolCalls) {
        for (const tc of response.toolCalls) {
          yield* emitToolCall(tc, { planId, agentId, agent, customToolMap });
        }
      }

      // Emit text as agent:message
      if (response.text) {
        yield { type: 'agent:message', planId, agentId, agent, content: response.text };
      }

      // Always emit agent:result to match real harness behavior
      const resultText = response.resultText ?? response.text;
      yield {
        type: 'agent:result',
        planId,
        agent,
        result: resultText !== undefined ? { ...STUB_RESULT, resultText } : STUB_RESULT,
      };

      if (response.lateError) {
        throw response.lateError;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      yield { type: 'agent:stop', planId, agent, agentId, error, timestamp: new Date().toISOString() };
    }
  }
}
