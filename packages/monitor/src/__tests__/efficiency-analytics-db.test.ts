import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunInfo, SessionMetadata } from '@eforge-build/client';
import { aggregateEfficiencyAnalytics } from '../analytics/efficiency.js';
import { openDatabase, type EventRecord, type MonitorDB } from '../db.js';

function tsDaysAgo(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function insertRun(db: MonitorDB, id: string, sessionId: string, status = 'completed', timestamp = tsDaysAgo(0)): void {
  db.insertRun({ id, sessionId, planSet: 'set', command: 'build', status, startedAt: timestamp, cwd: '/tmp/efficiency' });
}

function insertProfile(db: MonitorDB, runId: string, profileName: string | null, timestamp = tsDaysAgo(0)): void {
  db.insertEvent({ runId, type: 'session:profile', data: JSON.stringify({ type: 'session:profile', profileName, source: profileName ? 'project' : 'none', scope: profileName ? 'project' : null, config: null }), timestamp });
}

function insertResult(
  db: MonitorDB,
  runId: string,
  result: Record<string, unknown>,
  timestamp = tsDaysAgo(0),
): void {
  db.insertEvent({ runId, type: 'agent:result', data: JSON.stringify({ type: 'agent:result', agent: 'builder', result }), timestamp });
}

function result(opts: {
  cost?: number;
  durationApiMs?: number;
  output?: number;
  input?: number;
  cacheRead?: number;
  modelUsage?: Record<string, Record<string, number>>;
  harness?: 'claude-sdk' | 'pi';
  provider?: string;
}): Record<string, unknown> {
  const input = opts.input ?? 0;
  const output = opts.output ?? 0;
  return {
    durationMs: opts.durationApiMs ?? 1000,
    durationApiMs: opts.durationApiMs ?? 1000,
    numTurns: 1,
    totalCostUsd: opts.cost ?? 0,
    usage: { input, output, total: input + output, cacheRead: opts.cacheRead ?? 0, cacheCreation: 0 },
    modelUsage: opts.modelUsage ?? {},
    ...(opts.harness ? { harness: opts.harness } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}),
  };
}

function mu(inputTokens: number, outputTokens: number, costUSD: number, cacheReadInputTokens = 0): Record<string, number> {
  return { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens: 0, costUSD };
}

describe('MonitorDB.getEfficiencyAnalytics', () => {
  let db: MonitorDB;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'efficiency-analytics-db-'));
    db = openDatabase(join(dir, 'monitor.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('groups the same model separately by harness and provider', () => {
    insertRun(db, 'run-1', 'session-1');
    insertProfile(db, 'run-1', 'deep-dive');
    insertResult(db, 'run-1', result({ cost: 6, output: 200, input: 1000, modelUsage: { opus: mu(1000, 200, 6) }, harness: 'claude-sdk' }));
    insertResult(db, 'run-1', result({ cost: 4, output: 100, input: 500, modelUsage: { opus: mu(500, 100, 4) }, harness: 'pi', provider: 'openrouter' }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.models).toHaveLength(2);
    expect(summary.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'opus', harness: 'claude-sdk', provider: null, totalCostUsd: 6, successCount: 1, failureCount: 0 }),
      expect.objectContaining({ model: 'opus', harness: 'pi', provider: 'openrouter', totalCostUsd: 4, successCount: 1, failureCount: 0 }),
    ]));
  });

  it('computes cost/run, cost/min, output tokens/dollar, and success/failure counts', () => {
    insertRun(db, 'run-ok', 'session-ok', 'completed');
    insertProfile(db, 'run-ok', 'careful');
    insertResult(db, 'run-ok', result({ cost: 2, durationApiMs: 60_000, input: 1000, output: 200, cacheRead: 500, modelUsage: { sonnet: mu(1000, 200, 2, 500) } }));
    insertRun(db, 'run-fail', 'session-fail', 'failed');
    insertProfile(db, 'run-fail', 'careful');
    insertResult(db, 'run-fail', result({ cost: 1, durationApiMs: 60_000, input: 500, output: 100, modelUsage: { sonnet: mu(500, 100, 1) } }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.models[0]).toMatchObject({ costPerRunUsd: 1.5, costPerMinuteUsd: 1.5, outputTokensPerDollar: 100, successCount: 1, failureCount: 1 });
    expect(summary.profiles[0]).toMatchObject({ profileName: 'careful', costPerRunUsd: 1.5, costPerMinuteUsd: 1.5, outputTokensPerDollar: 100, successCount: 1, failureCount: 1 });
  });

  it('reports missing model attribution for costly results without model usage', () => {
    insertRun(db, 'run-1', 'session-1');
    insertProfile(db, 'run-1', 'default');
    insertResult(db, 'run-1', result({ cost: 1, output: 100, input: 300, modelUsage: {} }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.models).toEqual([]);
    expect(summary.missingModelAttributionCount).toBe(1);
    expect(summary.profiles[0]).toMatchObject({ profileName: 'default', totalCostUsd: 1, outputTokensPerDollar: 100 });
  });

  it('excludes multi-model durations from model speed percentiles while counting tokens and cost', () => {
    insertRun(db, 'run-1', 'session-1');
    insertProfile(db, 'run-1', 'default');
    insertResult(db, 'run-1', result({ cost: 3, durationApiMs: 10_000, input: 1200, output: 300, modelUsage: { a: mu(100, 50, 1), b: mu(200, 100, 2) } }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'a', totalCostUsd: 1, outputTokens: 50, speedExcludedSampleCount: 1, costPerMinuteUsd: null, outputTokensPerSecondP50: null }),
      expect.objectContaining({ model: 'b', totalCostUsd: 2, outputTokens: 100, speedExcludedSampleCount: 1, costPerMinuteUsd: null, outputTokensPerSecondP95: null }),
    ]));
  });

  it('counts whitespace-only profile events as missing profile attribution', () => {
    insertRun(db, 'run-whitespace', 'session-whitespace');
    insertProfile(db, 'run-whitespace', '   ');
    insertResult(db, 'run-whitespace', result({ cost: 1, output: 10, input: 10 }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.profiles).toEqual([expect.objectContaining({ profileName: '', totalCostUsd: 1 })]);
    expect(summary.missingProfileAttributionCount).toBe(1);
  });

  it('uses the first session profile event and counts missing profile attribution', () => {
    insertRun(db, 'run-profiled', 'session-profiled');
    insertProfile(db, 'run-profiled', 'first');
    insertProfile(db, 'run-profiled', 'second');
    insertResult(db, 'run-profiled', result({ cost: 1, output: 10, input: 10 }));
    insertRun(db, 'run-missing', 'session-missing');
    insertResult(db, 'run-missing', result({ cost: 1, output: 10, input: 10 }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.profiles.map((row) => row.profileName)).toEqual(['first', '']);
    expect(summary.profiles[1]).toMatchObject({ profileName: '', totalCostUsd: 1 });
    expect(summary.missingProfileAttributionCount).toBe(1);
  });

  it('uses the first session profile from an older same-session run', () => {
    insertRun(db, 'run-old-profile', 'session-shared', 'completed', tsDaysAgo(30));
    insertProfile(db, 'run-old-profile', 'older-first', tsDaysAgo(30));
    insertRun(db, 'run-recent-work', 'session-shared');
    insertProfile(db, 'run-recent-work', 'recent-second');
    insertResult(db, 'run-recent-work', result({ cost: 1, output: 10, input: 10 }));

    const summary = db.getEfficiencyAnalytics(7);
    expect(summary.profiles).toEqual([expect.objectContaining({ profileName: 'older-first', totalCostUsd: 1 })]);
    expect(summary.runCount).toBe(1);
  });

  it('rolls up one speed sample per session before profile percentiles', () => {
    insertRun(db, 'run-chatty', 'session-chatty');
    insertProfile(db, 'run-chatty', 'shared');
    insertResult(db, 'run-chatty', result({ cost: 1, durationApiMs: 1000, output: 10, input: 10 }));
    insertResult(db, 'run-chatty', result({ cost: 1, durationApiMs: 1000, output: 10, input: 10 }));
    insertResult(db, 'run-chatty', result({ cost: 1, durationApiMs: 1000, output: 10, input: 10 }));
    insertRun(db, 'run-middle', 'session-middle');
    insertProfile(db, 'run-middle', 'shared');
    insertResult(db, 'run-middle', result({ cost: 1, durationApiMs: 1000, output: 60, input: 10 }));
    insertRun(db, 'run-fast', 'session-fast');
    insertProfile(db, 'run-fast', 'shared');
    insertResult(db, 'run-fast', result({ cost: 1, durationApiMs: 1000, output: 100, input: 10 }));

    const profile = db.getEfficiencyAnalytics(7).profiles[0];
    expect(profile).toMatchObject({ profileName: 'shared', sampleCount: 3, outputTokensPerSecondP50: 60 });
  });

  it('falls back to session metadata when no session profile event exists', () => {
    const run: RunInfo = { id: 'run-meta', sessionId: 'session-meta', planSet: 'set', command: 'build', status: 'completed', startedAt: tsDaysAgo(0), cwd: '/tmp/efficiency' };
    const event: EventRecord = { id: 1, runId: run.id, origin: 'run', type: 'agent:result', data: JSON.stringify({ type: 'agent:result', agent: 'builder', result: result({ cost: 2, durationApiMs: 60_000, output: 200, input: 100 }) }), timestamp: tsDaysAgo(0) };
    const sessionMetadata: Record<string, SessionMetadata> = { 'session-meta': { planCount: null, baseProfile: 'metadata-profile' } };

    const summary = aggregateEfficiencyAnalytics({ runs: [run], events: [event], sessionMetadata, windowDays: 7, startedAt: tsDaysAgo(7), endedAt: tsDaysAgo(0) });
    expect(summary.profiles).toEqual([expect.objectContaining({ profileName: 'metadata-profile', totalCostUsd: 2, outputTokensPerDollar: 100 })]);
    expect(summary.missingProfileAttributionCount).toBe(0);
  });

  it('returns nullable derived metrics when numerators or denominators are absent', () => {
    insertRun(db, 'run-1', 'session-1');
    insertProfile(db, 'run-1', 'sparse');
    insertResult(db, 'run-1', { modelUsage: { sparse: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, usage: {} });

    const model = db.getEfficiencyAnalytics(7).models[0];
    expect(model).toMatchObject({ totalCostUsd: null, costPerMinuteUsd: null, outputTokensPerDollar: null, cachePercentage: null, outputTokensPerSecondP50: null, outputTokensPerSecondP95: null });
  });
});
