import { describe, expect, it } from 'vitest';
import { initialRunState } from '../reducer';
import { selectRunEfficiencyMetrics } from '../selectors/efficiency';
import type { AgentThread, RunState } from '../types';

function thread(overrides: Partial<AgentThread>): AgentThread {
  return {
    agentId: 'a1',
    agent: 'builder',
    startedAt: '2024-01-01T00:00:00.000Z',
    endedAt: '2024-01-01T00:00:10.000Z',
    durationMs: 10_000,
    durationApiMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'model',
    ...overrides,
  };
}

function state(overrides: Partial<RunState>): RunState {
  return { ...initialRunState, ...overrides };
}

describe('selectRunEfficiencyMetrics', () => {
  it('computes output generation rate from summed output tokens and API seconds including zero-token samples', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      agentThreads: [
        thread({ agentId: 'a1', outputTokens: 120, durationApiMs: 4_000 }),
        thread({ agentId: 'a2', outputTokens: 0, durationApiMs: 2_000 }),
      ],
    }));
    expect(metrics.outputGenerationRate.value).toBe(20);
    expect(metrics.outputGenerationRate.sampleCounts).toEqual({ included: 2, omitted: 0, total: 2 });
  });

  it('marks output generation rate partial when output tokens are missing positive API duration', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      agentThreads: [thread({ outputTokens: 100, durationApiMs: null })],
    }));
    expect(metrics.outputGenerationRate.value).toBeNull();
    expect(metrics.outputGenerationRate.availability).toBe('partial');
    expect(metrics.outputGenerationRate.sampleCounts).toEqual({ included: 0, omitted: 1, total: 1 });
  });

  it('omits zero API duration samples while keeping valid samples available as partial', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      agentThreads: [
        thread({ agentId: 'a1', outputTokens: 100, durationApiMs: 10_000 }),
        thread({ agentId: 'a2', outputTokens: 50, durationApiMs: 0 }),
      ],
    }));
    expect(metrics.outputGenerationRate.value).toBe(10);
    expect(metrics.outputGenerationRate.availability).toBe('partial');
    expect(metrics.outputGenerationRate.sampleCounts).toEqual({ included: 1, omitted: 1, total: 2 });
  });

  it('includes live overlays in wall-clock traffic and cost burn only', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      startTime: 0,
      tokensIn: 100,
      tokensOut: 50,
      cacheRead: 20,
      cacheCreation: 10,
      totalCost: 1,
      liveAgentUsage: { a1: { input: 50, output: 25, cacheRead: 80, cacheCreation: 90, cost: 0.5, turns: 1 } },
      agentThreads: [thread({ outputTokens: 100, durationApiMs: 10_000 })],
    }), 60_000);
    expect(metrics.tokenTraffic.value).toBe(225);
    expect(metrics.costBurn.value).toBe(1.5);
    expect(metrics.outputGenerationRate.value).toBe(10);
    expect(metrics.outputGenerationRate.availability).toBe('available');
    expect(metrics.outputGenerationRate.sampleCounts).toEqual({ included: 1, omitted: 0, total: 1 });
    expect(metrics.outputTokensPerDollar.value).toBe(50);
    expect(metrics.cacheContext.value).toBe(20);
    expect(metrics.cacheContext.detail).toContain('Cache creation tokens: 10');
    expect(metrics.raw.outputTokens).toBe(50);
    expect(metrics.raw.totalCostUsd).toBe(1);
    expect(metrics.raw.totalCostUsdWallClock).toBe(1.5);
  });

  it('does not count in-flight live usage as omitted output-generation samples', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      liveAgentUsage: { a1: { input: 50, output: 25, cacheRead: 80, cacheCreation: 90, cost: 0.5, turns: 1 } },
      agentThreads: [thread({ outputTokens: 100, durationMs: null, durationApiMs: null })],
    }));
    expect(metrics.outputGenerationRate.value).toBeNull();
    expect(metrics.outputGenerationRate.availability).toBe('unavailable');
    expect(metrics.outputGenerationRate.sampleCounts).toBeUndefined();
  });

  it('renders zero wall-clock rates as available zero values when elapsed time is known', () => {
    const metrics = selectRunEfficiencyMetrics(state({ startTime: 0, tokensIn: 0, tokensOut: 0, totalCost: 0 }), 60_000);
    expect(metrics.tokenTraffic.value).toBe(0);
    expect(metrics.tokenTraffic.availability).toBe('available');
    expect(metrics.costBurn.value).toBe(0);
    expect(metrics.costBurn.availability).toBe('available');
  });

  it('renders output tokens per dollar unavailable for zero cost and cache context from cache read/input', () => {
    const metrics = selectRunEfficiencyMetrics(state({
      tokensIn: 200,
      tokensOut: 100,
      cacheRead: 50,
      cacheCreation: 25,
      totalCost: 0,
    }));
    expect(metrics.outputTokensPerDollar.availability).toBe('unavailable');
    expect(metrics.cacheContext.value).toBe(25);
    expect(metrics.cacheContext.detail).toContain('Cache creation tokens: 25');
  });
});
