// --- eforge:region efficiency-analytics-aggregation ---
import {
  computeCachePercentage,
  computeCostBurnRate,
  computeOutputGenerationRate,
  computeOutputTokensPerDollar,
  computeTotalTokenTrafficRate,
  nearestRankPercentile,
} from '@eforge-build/client';
import type {
  EfficiencyAnalyticsSummary,
  EfficiencyModelRollup,
  EfficiencyProfileRollup,
  RunInfo,
  SessionMetadata,
} from '@eforge-build/client';
import type { EventRecord } from '../db.js';

interface AggregateEfficiencyOptions {
  runs: RunInfo[];
  events: EventRecord[];
  sessionMetadata: Record<string, SessionMetadata>;
  windowDays: number;
  startedAt: string;
  endedAt: string;
}

interface AgentResultInfo {
  run: RunInfo;
  event: EventRecord;
  result: Record<string, unknown>;
}

interface RollupAccumulator {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  inputTokenSampleCount: number;
  outputTokenSampleCount: number;
  totalTokenSampleCount: number;
  cacheReadSampleCount: number;
  costUsd: number;
  costSampleCount: number;
  tokenSampleCount: number;
  durationApiMs: number;
  durationSampleCount: number;
  durationUnavailableCount: number;
  speedExcludedSampleCount: number;
  outputRateSamples: number[];
  totalRateSamples: number[];
  runIds: Set<string>;
  successRunIds: Set<string>;
  failureRunIds: Set<string>;
  sampleCount: number;
}

interface SessionSample {
  profileName: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  inputTokenSampleCount: number;
  outputTokenSampleCount: number;
  totalTokenSampleCount: number;
  cacheReadSampleCount: number;
  costUsd: number;
  costSampleCount: number;
  tokenSampleCount: number;
  durationApiMs: number;
  durationSampleCount: number;
  durationUnavailableCount: number;
  runIds: Set<string>;
  successRunIds: Set<string>;
  failureRunIds: Set<string>;
}

export function aggregateEfficiencyAnalytics(options: AggregateEfficiencyOptions): EfficiencyAnalyticsSummary {
  const byRunId = new Map(options.runs.map((run) => [run.id, run]));
  const agentResults = collectAgentResults(options.events, byRunId);
  const models = aggregateModels(agentResults);
  const profileAggregation = aggregateProfiles(options.runs, options.events, agentResults, options.sessionMetadata);

  return {
    windowDays: options.windowDays,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    models: models.rows,
    profiles: profileAggregation.rows,
    agentResultCount: agentResults.length,
    runCount: options.runs.length,
    sessionCount: new Set(options.runs.map((run) => run.sessionId ?? run.id)).size,
    missingModelAttributionCount: models.missingModelAttributionCount,
    missingProfileAttributionCount: profileAggregation.missingProfileAttributionCount,
  };
}

function collectAgentResults(events: EventRecord[], byRunId: Map<string, RunInfo>): AgentResultInfo[] {
  const results: AgentResultInfo[] = [];
  for (const event of events) {
    if (event.type !== 'agent:result' || event.runId === null) continue;
    const run = byRunId.get(event.runId);
    if (run === undefined) continue;
    const data = parseObject(event.data);
    const result = objectValue(data.result);
    if (result !== null) results.push({ run, event, result });
  }
  return results;
}

function aggregateModels(agentResults: AgentResultInfo[]): {
  rows: EfficiencyModelRollup[];
  missingModelAttributionCount: number;
} {
  const rows = new Map<string, { model: string; harness: 'claude-sdk' | 'pi' | null; provider: string | null; acc: RollupAccumulator }>();
  let missingModelAttributionCount = 0;

  for (const item of agentResults) {
    const modelUsage = readModelUsage(item.result);
    if (modelUsage.length === 0) {
      if (resultHasUsageOrCost(item.result)) missingModelAttributionCount += 1;
      continue;
    }
    const harness = readHarness(item.result);
    const provider = readString(item.result.provider);
    const durationApiMs = readNumber(item.result.durationApiMs);
    const exactSpeedEligible = modelUsage.length === 1 && durationApiMs !== null && durationApiMs > 0;

    for (const usage of modelUsage) {
      const key = JSON.stringify([usage.model, harness, provider]);
      const entry = rows.get(key) ?? { model: usage.model, harness, provider, acc: createAccumulator() };
      rows.set(key, entry);
      addModelUsage(entry.acc, usage, item.run, exactSpeedEligible ? durationApiMs : null, modelUsage.length > 1 && durationApiMs !== null && durationApiMs > 0);
    }
  }

  return {
    rows: [...rows.values()].map((entry) => modelRow(entry.model, entry.harness, entry.provider, entry.acc))
      .sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0)),
    missingModelAttributionCount,
  };
}

function aggregateProfiles(
  runs: RunInfo[],
  events: EventRecord[],
  agentResults: AgentResultInfo[],
  sessionMetadata: Record<string, SessionMetadata>,
): { rows: EfficiencyProfileRollup[]; missingProfileAttributionCount: number } {
  const byRunId = new Map(runs.map((run) => [run.id, run]));
  const profileBySession = resolveProfilesBySession(events, sessionMetadata, byRunId);
  const samples = buildSessionSamples(runs, agentResults, profileBySession);
  const rows = new Map<string, RollupAccumulator>();
  let missingProfileAttributionCount = 0;

  for (const sample of samples.values()) {
    if (sample.profileName === null) {
      if (sessionSampleHasData(sample)) missingProfileAttributionCount += 1;
      continue;
    }
    const acc = rows.get(sample.profileName) ?? createAccumulator();
    rows.set(sample.profileName, acc);
    addSessionSample(acc, sample);
  }

  return {
    rows: [...rows.entries()].map(([profileName, acc]) => profileRow(profileName, acc))
      .sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0)),
    missingProfileAttributionCount,
  };
}

function buildSessionSamples(
  runs: RunInfo[],
  agentResults: AgentResultInfo[],
  profileBySession: Map<string, string | null>,
): Map<string, SessionSample> {
  const samples = new Map<string, SessionSample>();
  for (const run of runs) ensureSessionSample(samples, run, profileBySession);
  for (const item of agentResults) addResultToSessionSample(ensureSessionSample(samples, item.run, profileBySession), item.result);
  return samples;
}

function ensureSessionSample(
  samples: Map<string, SessionSample>,
  run: RunInfo,
  profileBySession: Map<string, string | null>,
): SessionSample {
  const sessionId = run.sessionId ?? run.id;
  const existing = samples.get(sessionId);
  if (existing) {
    existing.runIds.add(run.id);
    if (run.status === 'completed') existing.successRunIds.add(run.id);
    if (run.status === 'failed') existing.failureRunIds.add(run.id);
    return existing;
  }
  const sample = {
    profileName: profileBySession.get(sessionId) ?? null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    inputTokenSampleCount: 0,
    outputTokenSampleCount: 0,
    totalTokenSampleCount: 0,
    cacheReadSampleCount: 0,
    costUsd: 0,
    costSampleCount: 0,
    tokenSampleCount: 0,
    durationApiMs: 0,
    durationSampleCount: 0,
    durationUnavailableCount: 0,
    runIds: new Set([run.id]),
    successRunIds: run.status === 'completed' ? new Set([run.id]) : new Set<string>(),
    failureRunIds: run.status === 'failed' ? new Set([run.id]) : new Set<string>(),
  };
  samples.set(sessionId, sample);
  return sample;
}

function sessionSampleHasData(sample: SessionSample): boolean {
  return sample.costSampleCount > 0 || sample.tokenSampleCount > 0 || sample.durationSampleCount > 0;
}

function addResultToSessionSample(sample: SessionSample, result: Record<string, unknown>): void {
  const usage = objectValue(result.usage);
  addNumberToSample(readNumber(result.totalCostUsd), (value) => { sample.costUsd += value; sample.costSampleCount += 1; });
  const durationApiMs = readNumber(result.durationApiMs);
  if (durationApiMs !== null && durationApiMs > 0) {
    sample.durationApiMs += durationApiMs;
    sample.durationSampleCount += 1;
  } else {
    sample.durationUnavailableCount += 1;
  }
  if (usage === null) return;
  const input = readNumber(usage.input);
  const output = readNumber(usage.output);
  const total = readNumber(usage.total) ?? (input !== null && output !== null ? input + output : null);
  addNumberToSample(input, (value) => { sample.inputTokens += value; sample.inputTokenSampleCount += 1; });
  addNumberToSample(output, (value) => { sample.outputTokens += value; sample.outputTokenSampleCount += 1; });
  addNumberToSample(total, (value) => { sample.totalTokens += value; sample.totalTokenSampleCount += 1; });
  addNumberToSample(readNumber(usage.cacheRead), (value) => { sample.cacheReadTokens += value; sample.cacheReadSampleCount += 1; });
  if (input !== null || output !== null || total !== null) sample.tokenSampleCount += 1;
}

function addModelUsage(
  acc: RollupAccumulator,
  usage: ModelUsageEntry,
  run: RunInfo,
  speedDurationApiMs: number | null,
  speedExcluded: boolean,
): void {
  acc.sampleCount += 1;
  acc.runIds.add(run.id);
  if (run.status === 'completed') acc.successRunIds.add(run.id);
  if (run.status === 'failed') acc.failureRunIds.add(run.id);
  if (usage.inputTokens !== null || usage.outputTokens !== null || usage.totalTokens !== null) acc.tokenSampleCount += 1;
  addNumberToAccumulator(acc, 'inputTokens', 'inputTokenSampleCount', usage.inputTokens);
  addNumberToAccumulator(acc, 'outputTokens', 'outputTokenSampleCount', usage.outputTokens);
  addNumberToAccumulator(acc, 'totalTokens', 'totalTokenSampleCount', usage.totalTokens);
  addNumberToAccumulator(acc, 'cacheReadTokens', 'cacheReadSampleCount', usage.cacheReadTokens);
  addNumberToSample(usage.costUsd, (value) => { acc.costUsd += value; acc.costSampleCount += 1; });
  if (speedDurationApiMs !== null) {
    addSpeedSamples(acc, usage.outputTokens, usage.totalTokens, speedDurationApiMs);
  } else if (speedExcluded) {
    acc.speedExcludedSampleCount += 1;
  } else {
    acc.durationUnavailableCount += 1;
  }
}

function addSessionSample(acc: RollupAccumulator, sample: SessionSample): void {
  acc.sampleCount += 1;
  for (const runId of sample.runIds) acc.runIds.add(runId);
  for (const runId of sample.successRunIds) acc.successRunIds.add(runId);
  for (const runId of sample.failureRunIds) acc.failureRunIds.add(runId);
  acc.inputTokens += sample.inputTokens;
  acc.outputTokens += sample.outputTokens;
  acc.totalTokens += sample.totalTokens;
  acc.cacheReadTokens += sample.cacheReadTokens;
  acc.inputTokenSampleCount += sample.inputTokenSampleCount;
  acc.outputTokenSampleCount += sample.outputTokenSampleCount;
  acc.totalTokenSampleCount += sample.totalTokenSampleCount;
  acc.cacheReadSampleCount += sample.cacheReadSampleCount;
  acc.costUsd += sample.costUsd;
  acc.costSampleCount += sample.costSampleCount > 0 ? 1 : 0;
  acc.tokenSampleCount += sample.tokenSampleCount > 0 ? 1 : 0;
  acc.durationUnavailableCount += sample.durationUnavailableCount;
  if (sample.durationApiMs > 0) {
    const outputTokens = sample.outputTokenSampleCount > 0 ? sample.outputTokens : null;
    const totalTokens = sample.totalTokenSampleCount > 0 ? sample.totalTokens : null;
    addSpeedSamples(acc, outputTokens, totalTokens, sample.durationApiMs);
  }
}

function addSpeedSamples(acc: RollupAccumulator, outputTokens: number | null, totalTokens: number | null, durationApiMs: number): void {
  acc.durationApiMs += durationApiMs;
  acc.durationSampleCount += 1;
  const outputRate = computeOutputGenerationRate(outputTokens, durationApiMs);
  const totalRate = computeTotalTokenTrafficRate(totalTokens, durationApiMs);
  if (outputRate !== null) acc.outputRateSamples.push(outputRate);
  if (totalRate !== null) acc.totalRateSamples.push(totalRate);
}

interface ModelUsageEntry {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  costUsd: number | null;
}

function readModelUsage(result: Record<string, unknown>): ModelUsageEntry[] {
  const raw = objectValue(result.modelUsage);
  if (raw === null) return [];
  return Object.entries(raw).flatMap(([model, value]) => {
    const entry = objectValue(value);
    if (entry === null) return [];
    const inputTokens = readNumber(entry.inputTokens);
    const outputTokens = readNumber(entry.outputTokens);
    return [{
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
      cacheReadTokens: readNumber(entry.cacheReadInputTokens),
      costUsd: readNumber(entry.costUSD),
    }];
  });
}

function resolveProfilesBySession(
  events: EventRecord[],
  metadata: Record<string, SessionMetadata>,
  byRunId: Map<string, RunInfo>,
): Map<string, string | null> {
  const profiles = new Map<string, string | null>();
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (event.type !== 'session:profile' || event.runId === null) continue;
    const run = byRunId.get(event.runId);
    const sessionId = run?.sessionId ?? event.runId;
    if (profiles.has(sessionId)) continue;
    const data = parseObject(event.data);
    profiles.set(sessionId, readString(data.profileName));
  }
  for (const [sessionId, value] of Object.entries(metadata)) {
    if (!profiles.has(sessionId)) profiles.set(sessionId, value.baseProfile);
  }
  return profiles;
}

function modelRow(
  model: string,
  harness: 'claude-sdk' | 'pi' | null,
  provider: string | null,
  acc: RollupAccumulator,
): EfficiencyModelRollup {
  return {
    model,
    harness,
    provider,
    ...finishRollup(acc),
  };
}

function profileRow(profileName: string, acc: RollupAccumulator): EfficiencyProfileRollup {
  return {
    profileName,
    ...finishRollup(acc),
  };
}

function finishRollup(acc: RollupAccumulator) {
  const totalCostUsd = acc.costSampleCount > 0 ? acc.costUsd : null;
  const inputTokens = acc.inputTokenSampleCount > 0 ? acc.inputTokens : null;
  const outputTokens = acc.outputTokenSampleCount > 0 ? acc.outputTokens : null;
  const totalTokens = acc.totalTokenSampleCount > 0 ? acc.totalTokens : null;
  const cacheReadTokens = acc.cacheReadSampleCount > 0 ? acc.cacheReadTokens : null;
  return {
    runCount: acc.runIds.size,
    successCount: acc.successRunIds.size,
    failureCount: acc.failureRunIds.size,
    sampleCount: acc.sampleCount,
    costSampleCount: acc.costSampleCount,
    tokenSampleCount: acc.tokenSampleCount,
    durationSampleCount: acc.durationSampleCount,
    durationUnavailableCount: acc.durationUnavailableCount,
    speedExcludedSampleCount: acc.speedExcludedSampleCount,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    totalCostUsd,
    costPerRunUsd: totalCostUsd !== null ? totalCostUsd / Math.max(1, acc.runIds.size) : null,
    costPerMinuteUsd: computeCostBurnRate(totalCostUsd, acc.durationApiMs),
    outputTokensPerDollar: computeOutputTokensPerDollar(outputTokens, totalCostUsd),
    cachePercentage: computeCachePercentage(cacheReadTokens, inputTokens),
    outputTokensPerSecondP50: nearestRankPercentile(acc.outputRateSamples, 50),
    outputTokensPerSecondP95: nearestRankPercentile(acc.outputRateSamples, 95),
    totalTokensPerSecondP50: nearestRankPercentile(acc.totalRateSamples, 50),
    totalTokensPerSecondP95: nearestRankPercentile(acc.totalRateSamples, 95),
  };
}

function createAccumulator(): RollupAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    inputTokenSampleCount: 0,
    outputTokenSampleCount: 0,
    totalTokenSampleCount: 0,
    cacheReadSampleCount: 0,
    costUsd: 0,
    costSampleCount: 0,
    tokenSampleCount: 0,
    durationApiMs: 0,
    durationSampleCount: 0,
    durationUnavailableCount: 0,
    speedExcludedSampleCount: 0,
    outputRateSamples: [],
    totalRateSamples: [],
    runIds: new Set(),
    successRunIds: new Set(),
    failureRunIds: new Set(),
    sampleCount: 0,
  };
}

function addNumberToAccumulator(
  acc: RollupAccumulator,
  field: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cacheReadTokens',
  countField: 'inputTokenSampleCount' | 'outputTokenSampleCount' | 'totalTokenSampleCount' | 'cacheReadSampleCount',
  value: number | null,
): void {
  addNumberToSample(value, (finite) => { acc[field] += finite; acc[countField] += 1; });
}

function addNumberToSample(value: number | null, fn: (value: number) => void): void {
  if (value !== null) fn(value);
}

function resultHasUsageOrCost(result: Record<string, unknown>): boolean {
  return readNumber(result.totalCostUsd) !== null || objectValue(result.usage) !== null;
}

function readHarness(result: Record<string, unknown>): 'claude-sdk' | 'pi' | null {
  return result.harness === 'claude-sdk' || result.harness === 'pi' ? result.harness : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}
// --- eforge:endregion efficiency-analytics-aggregation ---
