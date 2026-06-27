import { describe, expect, it } from 'vitest';

import { MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH, safeParseEforgeEvent } from '@eforge-build/client';
import { DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS } from '@eforge-build/engine/compile-resilience/context-guard';
import {
  PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS,
  PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
  PI_COMPILE_CONTEXT_SAFETY_MARGIN,
  derivePiCompileContextGuard,
} from '@eforge-build/engine/harnesses/pi-model-resolution';

function expectedLimit(contextWindow: number, outputReserveTokens: number): number {
  return Math.floor((contextWindow - outputReserveTokens - PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS) * PI_COMPILE_CONTEXT_SAFETY_MARGIN);
}

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
  it('derives a safe per-turn input limit from built-in-style registry metadata', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'anthropic', id: 'claude-large-context' },
      modelRegistry: registry({ findModel: model({ provider: 'anthropic', id: 'claude-large-context', contextWindow: 1_000_000, maxTokens: 64_000 }) }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(1_000_000, 64_000));
    expect(result.limits.maxObservedInputTokens).toBeLessThan(1_000_000);
    expect(result.limits.maxObservedInputTokens).toBeGreaterThan(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.guardDiagnostics).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-large-context',
      metadataSource: 'registry',
      contextWindow: 1_000_000,
      outputReserveTokens: 64_000,
      overheadReserveTokens: PI_COMPILE_CONTEXT_OVERHEAD_RESERVE_TOKENS,
      safetyMargin: PI_COMPILE_CONTEXT_SAFETY_MARGIN,
      limits: result.limits,
    });
  });

  it('uses custom override-style metadata and output-token metadata in the formula', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: ' custom-provider ', id: ' custom-planner ' },
      limits: { maxPromptBytes: 123_456 },
      modelRegistry: registry({ findModel: model({ provider: 'custom-provider', id: 'custom-planner', contextWindow: 300_000, maxTokens: 20_000 }) }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(expectedLimit(300_000, 20_000));
    expect(result.limits.maxPromptBytes).toBe(123_456);
    expect(result.guardDiagnostics.outputReserveTokens).toBe(20_000);
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

    for (const result of [missingProvider, missingModel]) {
      expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
      expect(result.guardDiagnostics.fallbackReason).toBeTruthy();
      expect(result.guardDiagnostics.metadataSource).toBe('fallback');
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
      expect(result.guardDiagnostics.fallbackReason).toBeTruthy();
    }
  });

  it('falls back with a reason when registry lookup throws', async () => {
    const result = await derivePiCompileContextGuard({
      model: { provider: 'custom-provider', id: 'custom-planner' },
      modelRegistry: registry({ error: new Error('bad models.json') }),
    });

    expect(result.limits.maxObservedInputTokens).toBe(DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens);
    expect(result.guardDiagnostics.fallbackReason).toContain('bad models.json');
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
    expect(result.guardDiagnostics.metadataSource).toBe('synthetic');
    expect(result.guardDiagnostics.contextWindow).toBeUndefined();
    expect(result.guardDiagnostics.fallbackReason?.length).toBe(MAX_COMPILE_SCOPE_CONTEXT_EXPLANATION_LENGTH);
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
