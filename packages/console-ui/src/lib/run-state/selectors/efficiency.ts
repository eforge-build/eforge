import {
  computeCachePercentage,
  computeCostBurnRate,
  computeOutputGenerationRate,
  computeOutputTokensPerDollar,
} from '@eforge-build/client/browser';
import type { AgentThread, RunState } from '../types';

export type EfficiencyAvailability = 'available' | 'partial' | 'unavailable';

export interface EfficiencySampleCounts {
  included: number;
  omitted: number;
  total: number;
}

export interface EfficiencyMetric {
  label: string;
  value: number | null;
  formula: string;
  sampleCounts?: EfficiencySampleCounts;
  availability: EfficiencyAvailability;
  detail: string;
}

export interface RunEfficiencyMetrics {
  outputGenerationRate: EfficiencyMetric;
  tokenTraffic: EfficiencyMetric;
  costBurn: EfficiencyMetric;
  outputTokensPerDollar: EfficiencyMetric;
  cacheContext: EfficiencyMetric;
  raw: {
    outputTokensForRate: number;
    durationApiMsForRate: number;
    totalTokensWallClock: number;
    totalCostUsd: number;
    totalCostUsdWallClock: number;
    elapsedWallClockMs: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function liveUsageTotals(state: RunState) {
  return Object.values(state.liveAgentUsage).reduce(
    (acc, usage) => ({
      input: acc.input + usage.input,
      output: acc.output + usage.output,
      cacheRead: acc.cacheRead + usage.cacheRead,
      cacheCreation: acc.cacheCreation + usage.cacheCreation,
      cost: acc.cost + usage.cost,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 },
  );
}

function isFinalizedThread(thread: AgentThread): boolean {
  return finite(thread.durationMs);
}

function isRateIncluded(thread: AgentThread): boolean {
  return isFinalizedThread(thread) && finite(thread.outputTokens) && finite(thread.durationApiMs) && thread.durationApiMs > 0;
}

function hasRateNumeratorWithoutDuration(thread: AgentThread): boolean {
  return isFinalizedThread(thread) && finite(thread.outputTokens) && (!finite(thread.durationApiMs) || thread.durationApiMs <= 0);
}

function elapsedWallClockMs(state: RunState, now: number): number | null {
  if (!finite(state.startTime)) return null;
  const end = finite(state.endTime) ? state.endTime : now;
  const elapsed = end - state.startTime;
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : null;
}

function availabilityFor(value: number | null, hasPartialData: boolean): EfficiencyAvailability {
  if (value != null) return hasPartialData ? 'partial' : 'available';
  return hasPartialData ? 'partial' : 'unavailable';
}

export function selectRunEfficiencyMetrics(state: RunState, now: number = Date.now()): RunEfficiencyMetrics {
  const live = liveUsageTotals(state);
  const inputTokens = state.tokensIn;
  const outputTokens = state.tokensOut;
  const totalCostUsd = state.totalCost;
  const cacheReadTokens = state.cacheRead;
  const cacheCreationTokens = state.cacheCreation;
  const totalTokensWallClock = state.tokensIn + live.input + state.tokensOut + live.output;
  const totalCostUsdWallClock = state.totalCost + live.cost;
  const elapsedMs = elapsedWallClockMs(state, now);

  let outputTokensForRate = 0;
  let durationApiMsForRate = 0;
  let included = 0;
  let omitted = 0;
  for (const thread of state.agentThreads) {
    if (isRateIncluded(thread)) {
      const output = thread.outputTokens;
      const durationApiMs = thread.durationApiMs;
      if (output != null && durationApiMs != null) {
        outputTokensForRate += output;
        durationApiMsForRate += durationApiMs;
        included += 1;
      }
    } else if (hasRateNumeratorWithoutDuration(thread)) {
      omitted += 1;
    }
  }
  const totalSamples = included + omitted;
  const outputGenerationRateValue = included > 0
    ? computeOutputGenerationRate(outputTokensForRate, durationApiMsForRate)
    : null;
  const outputGenerationAvailability = availabilityFor(outputGenerationRateValue, omitted > 0);

  const tokenTrafficValue = elapsedMs != null
    ? totalTokensWallClock / (elapsedMs / 60_000)
    : null;
  const costBurnValue = elapsedMs != null
    ? computeCostBurnRate(totalCostUsdWallClock, elapsedMs)
    : null;
  const outputTokensPerDollarValue = computeOutputTokensPerDollar(outputTokens, totalCostUsd);
  const cacheContextValue = computeCachePercentage(cacheReadTokens, inputTokens);

  return {
    outputGenerationRate: {
      label: 'output generation rate',
      value: outputGenerationRateValue,
      formula: 'sum(output tokens) / sum(API duration seconds)',
      sampleCounts: totalSamples > 0 ? { included, omitted, total: totalSamples } : undefined,
      availability: outputGenerationAvailability,
      detail: omitted > 0
        ? 'Only finalized agent results with positive API duration are included; live usage overlays are excluded.'
        : 'Finalized agent result output tokens divided by provider API duration.',
    },
    tokenTraffic: {
      label: 'token traffic',
      value: tokenTrafficValue,
      formula: '(input + output tokens) / elapsed wall-clock minute',
      availability: availabilityFor(tokenTrafficValue, elapsedMs == null && totalTokensWallClock > 0),
      detail: 'Includes finalized usage and live in-flight agent:usage overlays.',
    },
    costBurn: {
      label: 'cost burn',
      value: costBurnValue,
      formula: 'total cost / elapsed wall-clock minute',
      availability: availabilityFor(costBurnValue, elapsedMs == null && totalCostUsdWallClock > 0),
      detail: 'Includes finalized cost and live in-flight cost overlays.',
    },
    outputTokensPerDollar: {
      label: 'output tokens / $',
      value: outputTokensPerDollarValue,
      formula: 'output tokens / total cost',
      availability: outputTokensPerDollarValue == null ? 'unavailable' : 'available',
      detail: 'Unavailable when total cost is zero or missing.',
    },
    cacheContext: {
      label: 'cache context',
      value: cacheContextValue,
      formula: 'cache read tokens / input tokens',
      availability: cacheContextValue == null ? 'unavailable' : 'available',
      detail: cacheCreationTokens > 0
        ? `Cache creation tokens: ${cacheCreationTokens}.`
        : 'Cache read tokens as a share of input tokens.',
    },
    raw: {
      outputTokensForRate,
      durationApiMsForRate,
      totalTokensWallClock,
      totalCostUsd,
      totalCostUsdWallClock,
      elapsedWallClockMs: elapsedMs,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
    },
  };
}
