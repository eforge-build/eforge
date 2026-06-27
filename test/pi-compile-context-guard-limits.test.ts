import { describe, expect, it } from 'vitest';

import { MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH, safeParseEforgeEvent } from '@eforge-build/client';
import { createCompileContextGuard, DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS } from '@eforge-build/engine/compile-resilience/context-guard';
import type { EforgeEvent } from '@eforge-build/engine/events';
import {
  PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS,
  PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
  PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP,
  PI_COMPILE_CONTEXT_SAFETY_MARGIN,
  derivePiCompileContextGuard,
} from '@eforge-build/engine/harnesses/pi-model-resolution';

function expectedLimit(contextWindow: number, outputReserveTokens: number): number {
  return Math.floor((contextWindow - outputReserveTokens - PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS) * PI_COMPILE_CONTEXT_SAFETY_MARGIN);
}

const USAGE = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 };

function scopeContextFailureEvent(guardDiagnostics: Awaited<ReturnType<typeof derivePiCompileContextGuard>>['guardDiagnostics']) {
  return {
    type: 'planning:scope-context:failure',
    timestamp: '2026-06-26T10:00:00.000Z',
    failure: {
      source: 'live-context-guard',
      failureKind: 'context-budget',
      stage: 'planner',
      explanation: 'Planner context budget exceeded.',
      observed: { inputTokens: 200000, outputTokens: 1000, turns: 2, promptBytes: 4096 },
      recovery: { action: 'bounded-decomposition', eligible: true, attempted: false, attempt: 0, maxAttempts: 1, reason: 'decompose' },
      artifacts: {
        orchestrationExists: true,
        validPlanCount: 1,
        invalidPlanCount: 0,
        missingPlanFileCount: 0,
        missingPlanFiles: [],
        invalidPlanFiles: [],
      },
      guardDiagnostics,
    },
  };
}

describe('Pi compile context guard limit derivation', () => {
  it('derives a safe per-turn input limit from Pi built-in metadata', async () => {
    const contextWindow = 1_048_576;
    const outputReserveTokens = 65_536;
    const result = await derivePiCompileContextGuard({
      model: { provider: 'google', id: 'gemini-2.5-flash' },
      modelRegistry: registry({}),
    });

    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(contextWindow, outputReserveTokens));
    expect(result.limits.maxObservedInputTokens).toBeLessThan(contextWindow);
    expect(result.limits.maxObservedInputTokens).toBeGreaterThan(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.guardDiagnostics).toMatchObject({
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      metadataSource: 'builtin',
      contextWindow,
      outputReserveTokens,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits: result.limits,
    });
    expect(result.guardDiagnostics).not.toHaveProperty('fallbackReason');
  });

  it('caps large planner-family output-token metadata before deriving the input limit', async () => {
    const contextWindow = 272_000;
    const result = await derivePiCompileContextGuard({
      model: { provider: 'openai-codex', id: 'gpt-5.5' },
      modelRegistry: registry({ findModel: model({ provider: 'openai-codex', id: 'gpt-5.5', contextWindow, maxTokens: 128_000 }) }),
    });

    expect(result.guardDiagnostics).toMatchObject({
      provider: 'openai-codex',
      modelId: 'gpt-5.5',
      metadataSource: 'registry',
      contextWindow,
      outputReserveTokens: PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits: result.limits,
    });
    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(contextWindow, PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP));
    expect(result.limits.maxObservedInputTokens).toBeGreaterThan(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.limits.maxObservedInputTokens).toBeLessThan(Math.floor((contextWindow - PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS) * PI_COMPILE_CONTEXT_SAFETY_MARGIN));

    const guard = createCompileContextGuard({ stage: 'planner', limits: result.limits, guardDiagnostics: result.guardDiagnostics });
    guard.assertPrompt('ok');
    expect(() => guard.observe(usageEvent(124_543))).not.toThrow();
  });

  it('uses custom override-style metadata and below-cap output-token metadata in the formula', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: ' custom-provider ', id: ' custom-planner ' },
      limits: { maxPromptBytes: 123_456 },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'custom-planner', contextWindow: 300_000, maxTokens: 20_000 }) }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(300_000, 20_000));
    expect(result.limits.maxPromptBytes).toBe(123_456);
    expect(result.guardDiagnostics).toMatchObject({
      provider: 'custom-provider',
      modelId: 'custom-planner',
      metadataSource: 'registry',
      contextWindow: 300_000,
      outputReserveTokens: 20_000,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits: result.limits,
    });
  });

  it('honors stricter explicit input-token limits for Pi guard diagnostics', async () => {
    const modelDerivedLimit = expectedLimit(300_000, 20_000);
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-planner' },
      limits: { maxObservedInputTokens: 50_000 },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'custom-planner', contextWindow: 300_000, maxTokens: 20_000 }) }),
    });

    expect(50_000).toBeLessThan(modelDerivedLimit);
    expect(result.limits.maxObservedInputTokens).toBe(50_000);
    expect(result.guardDiagnostics.limits.maxObservedInputTokens).toBe(50_000);
    expect(result.guardDiagnostics).toMatchObject({
      provider: 'custom-provider',
      modelId: 'custom-planner',
      metadataSource: 'registry',
      contextWindow: 300_000,
      outputReserveTokens: 20_000,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits: result.limits,
    });
  });

  it('uses the conservative output reserve when output metadata is missing', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-no-output' },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'custom-no-output', contextWindow: 300_000 }) }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(300_000, PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS));
    expect(result.guardDiagnostics.outputReserveTokens).toBe(PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS);
  });

  it('falls back with a reason for missing provider and missing model id', async () => {
    const missingProvider = await derivePiCompileContextGuard({ model: { id: 'custom-planner' }, modelRegistry: registry({}) });
    const missingModel = await derivePiCompileContextGuard({ model: { provider: 'custom-provider', id: '' }, modelRegistry: registry({}) });

    expect(missingProvider.guardDiagnostics).not.toHaveProperty('provider');
    expect(missingModel.guardDiagnostics).not.toHaveProperty('modelId');

    for (const result of [missingProvider, missingModel]) {
      expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
      expect(result.limits.maxObservedInputTokens).toBeGreaterThan(0);
      expect(result.guardDiagnostics.fallbackReason).toBeTruthy();
      expect(result.guardDiagnostics).toMatchObject({
        metadataSource: 'fallback',
        outputReserveTokens: PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS,
        overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
        safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
        limits: result.limits,
      });
      expect(safeParseEforgeEvent(scopeContextFailureEvent(result.guardDiagnostics)).success).toBe(true);
    }
  });

  it('falls back with a reason for missing or invalid context metadata', async () => {
    const missingContext = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'missing-context' },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'missing-context' }) }),
    });
    const invalidContext = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'invalid-context' },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'invalid-context', contextWindow: -1, maxTokens: 1_000 }) }),
    });
    const nonPositiveBudget = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'tiny-context' },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'tiny-context', contextWindow: 8_000, maxTokens: 8_000 }) }),
    });
    const invalidOutputMetadata = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'invalid-output' },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'invalid-output', contextWindow: 300_000, maxTokens: -10 }) }),
    });

    for (const result of [missingContext, invalidContext, nonPositiveBudget, invalidOutputMetadata]) {
      expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
      expect(result.limits.maxObservedInputTokens).toBeGreaterThan(0);
      expect(result.guardDiagnostics.fallbackReason).toBeTruthy();
      expect(result.guardDiagnostics.limits).toBe(result.limits);
    }
    expect(missingContext.guardDiagnostics).toMatchObject({ metadataSource: 'registry', outputReserveTokens: PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS });
    expect(invalidContext.guardDiagnostics).toMatchObject({ metadataSource: 'registry', outputReserveTokens: PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS });
    expect(nonPositiveBudget.guardDiagnostics).toMatchObject({ metadataSource: 'registry', contextWindow: 8_000, outputReserveTokens: 8_000 });
    expect(invalidOutputMetadata.guardDiagnostics).toMatchObject({ metadataSource: 'registry', contextWindow: 300_000, outputReserveTokens: PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS });
  });

  it('falls back with a reason when registry lookup throws', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-planner' },
      modelRegistry: registry({ error: new Error('bad models.json') }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.limits.maxObservedInputTokens).toBeGreaterThan(0);
    expect(result.guardDiagnostics.fallbackReason).toContain('bad models.json');
    expect(result.guardDiagnostics.limits).toBe(result.limits);
  });

  it('bounds fallback diagnostics so emitted scope/context failures satisfy the public schema', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-planner' },
      modelRegistry: registry({ error: new Error('x'.repeat(MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH + 100)) }),
    });

    expect(result.guardDiagnostics.fallbackReason?.length).toBe(MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH);
    expect(safeParseEforgeEvent(scopeContextFailureEvent(result.guardDiagnostics)).success).toBe(true);
  });

  it('uses conservative fallback limits for synthetic model metadata', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'x'.repeat(MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH + 100) },
      modelRegistry: registry({ all: [model({ provider: 'custom-provider', id: 'sibling', contextWindow: 300_000 })] }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.limits.maxObservedInputTokens).toBeGreaterThan(0);
    expect(result.guardDiagnostics.metadataSource).toBe('synthetic');
    expect(result.guardDiagnostics.contextWindow).toBeUndefined();
    expect(result.guardDiagnostics.fallbackReason?.length).toBe(MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH);
    expect(result.guardDiagnostics.limits).toBe(result.limits);
  });

  it('normalizes invalid explicit diagnostic limits to schema-valid defaults', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-planner' },
      limits: { maxPromptBytes: 0, maxObservedTurns: -1, maxExplanationBytes: 1.5 },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'custom-planner', contextWindow: 300_000, maxTokens: 20_000 }) }),
    });

    expect(result.guardDiagnostics.limits.maxPromptBytes).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxPromptBytes);
    expect(result.guardDiagnostics.limits.maxObservedTurns).toBeUndefined();
    expect(result.guardDiagnostics.limits.maxExplanationBytes).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxExplanationBytes);
    expect(safeParseEforgeEvent(scopeContextFailureEvent(result.guardDiagnostics)).success).toBe(true);
  });
});

function usageEvent(inputTokens: number): EforgeEvent {
  return {
    type: 'agent:usage',
    agentId: 'agent-1',
    agent: 'planner',
    usage: { ...USAGE, input: inputTokens, total: inputTokens },
    costUsd: 0,
    numTurns: 1,
    final: false,
    timestamp: new Date().toISOString(),
  };
}

function registry(input: { findModel?: unknown; all?: unknown[]; error?: Error }) {
  return {
    find: () => {
      if (input.error) throw input.error;
      return input.findModel;
    },
    getAll: () => input.all ?? [],
  } as unknown as Parameters<typeof derivePiCompileContextGuard>[0]['modelRegistry'];
}

function model(input: { provider: string; id: string; contextWindow?: number; maxTokens?: number }) {
  return {
    id: input.id,
    name: input.id,
    provider: input.provider,
    api: 'anthropic-messages',
    baseUrl: 'https://example.invalid',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
  };
}
