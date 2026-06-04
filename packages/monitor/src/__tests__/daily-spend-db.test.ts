/**
 * Tests for MonitorDB.getDailySpend.
 *
 * Covers:
 * - Tokens aggregate from the `final: true` agent:usage checkpoint, cost from
 *   agent:result, grouped per day.
 * - Non-final agent:usage events (per-turn deltas) are NOT summed, so tokens
 *   are not double-counted.
 * - Multiple agents on the same day sum into one row.
 * - Days are returned oldest -> newest.
 * - Events older than the window are excluded.
 * - Non-usage/result event types are ignored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type MonitorDB } from '../db.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'daily-spend-db-test-'));
}

/** Local `YYYY-MM-DD` for an offset in days from today (mirrors getDailySpend's day key). */
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Midday ISO timestamp for an offset in days from today, to stay clear of day boundaries. */
function tsDaysAgo(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function insertRun(db: MonitorDB, runId: string, timestamp: string): void {
  db.insertRun({
    id: runId,
    sessionId: `session-${runId}`,
    planSet: 'test-plan',
    command: 'build',
    status: 'completed',
    startedAt: timestamp,
    cwd: '/tmp/test',
  });
}

function insertUsage(
  db: MonitorDB,
  runId: string,
  usage: { input: number; output: number; total: number; cacheRead: number; cacheCreation: number },
  timestamp: string,
  final = true,
): void {
  db.insertEvent({
    runId,
    type: 'agent:usage',
    data: JSON.stringify({ type: 'agent:usage', agentId: 'a', agent: 'builder', usage, costUsd: 0, numTurns: 1, final, timestamp }),
    timestamp,
  });
}

type ModelUsage = Record<
  string,
  { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }
>;

function insertResult(
  db: MonitorDB,
  runId: string,
  totalCostUsd: number,
  timestamp: string,
  modelUsage: ModelUsage = {},
  attribution: { harness?: 'claude-sdk' | 'pi'; provider?: string } = {},
): void {
  db.insertEvent({
    runId,
    type: 'agent:result',
    data: JSON.stringify({
      type: 'agent:result',
      agent: 'builder',
      result: {
        durationMs: 1,
        durationApiMs: 1,
        numTurns: 1,
        totalCostUsd,
        usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
        modelUsage,
        ...attribution,
      },
      timestamp,
    }),
    timestamp,
  });
}

/** Shorthand for a single per-model usage entry. */
function mu(
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  costUSD: number,
): ModelUsage[string] {
  return { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens: 0, costUSD };
}

describe('MonitorDB.getDailySpend', () => {
  let db: MonitorDB;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    db = openDatabase(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty array when there is no spend', () => {
    expect(db.getDailySpend(7)).toEqual([]);
  });

  it('aggregates tokens from usage and cost from result into one row per day', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-1', ts);
    insertUsage(db, 'run-1', { input: 1000, output: 200, total: 1200, cacheRead: 800, cacheCreation: 100 }, ts);
    insertResult(db, 'run-1', 1.25, ts);

    const days = db.getDailySpend(7);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: localDay(0),
      tokensIn: 1000,
      tokensOut: 200,
      tokensTotal: 1200,
      cacheRead: 800,
      cacheCreation: 100,
      costUsd: 1.25,
    });
  });

  it('sums multiple agents on the same day', () => {
    const ts = tsDaysAgo(1);
    insertRun(db, 'run-a', ts);
    // Each agent emits one final cumulative usage event + one result.
    insertUsage(db, 'run-a', { input: 500, output: 100, total: 600, cacheRead: 0, cacheCreation: 0 }, ts);
    insertResult(db, 'run-a', 0.5, ts);
    insertUsage(db, 'run-a', { input: 1500, output: 300, total: 1800, cacheRead: 0, cacheCreation: 0 }, ts);
    insertResult(db, 'run-a', 1.0, ts);

    const days = db.getDailySpend(7);
    expect(days).toHaveLength(1);
    expect(days[0].tokensIn).toBe(2000);
    expect(days[0].tokensTotal).toBe(2400);
    expect(days[0].costUsd).toBeCloseTo(1.5, 5);
  });

  it('counts only the final cumulative usage event, not per-turn deltas', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-cadence', ts);
    // Realistic cadence: per-turn deltas (final=false) plus one authoritative
    // cumulative checkpoint (final=true). Only the cumulative must be counted.
    insertUsage(db, 'run-cadence', { input: 400, output: 80, total: 480, cacheRead: 300, cacheCreation: 40 }, ts, false);
    insertUsage(db, 'run-cadence', { input: 600, output: 120, total: 720, cacheRead: 500, cacheCreation: 60 }, ts, false);
    insertUsage(db, 'run-cadence', { input: 1000, output: 200, total: 1200, cacheRead: 800, cacheCreation: 100 }, ts, true);
    insertResult(db, 'run-cadence', 2.0, ts);

    const days = db.getDailySpend(7);
    expect(days).toHaveLength(1);
    // Cumulative values, not cumulative + deltas (which would double them).
    expect(days[0].tokensIn).toBe(1000);
    expect(days[0].tokensOut).toBe(200);
    expect(days[0].tokensTotal).toBe(1200);
    expect(days[0].cacheRead).toBe(800);
    expect(days[0].cacheCreation).toBe(100);
    expect(days[0].costUsd).toBeCloseTo(2.0, 5);
  });

  it('returns days oldest -> newest and excludes events outside the window', () => {
    insertRun(db, 'run-today', tsDaysAgo(0));
    insertResult(db, 'run-today', 3, tsDaysAgo(0));
    insertRun(db, 'run-2ago', tsDaysAgo(2));
    insertResult(db, 'run-2ago', 2, tsDaysAgo(2));
    insertRun(db, 'run-old', tsDaysAgo(10));
    insertResult(db, 'run-old', 9, tsDaysAgo(10));

    const days = db.getDailySpend(7);
    expect(days.map((d) => d.date)).toEqual([localDay(2), localDay(0)]);
    expect(days.some((d) => d.date === localDay(10))).toBe(false);
  });

  it('ignores event types other than agent:usage and agent:result', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-x', ts);
    db.insertEvent({ runId: 'run-x', type: 'agent:stop', data: JSON.stringify({ type: 'agent:stop', agent: 'builder', timestamp: ts }), timestamp: ts });

    expect(db.getDailySpend(7)).toEqual([]);
  });
});

describe('MonitorDB.getModelSpend', () => {
  let db: MonitorDB;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    db = openDatabase(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty array when no results carry per-model usage', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-1', ts);
    insertResult(db, 'run-1', 1.0, ts); // modelUsage defaults to {}
    expect(db.getModelSpend(7)).toEqual([]);
  });

  it('aggregates per model across results and orders by cost descending', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-1', ts);
    insertResult(db, 'run-1', 3, ts, {
      'claude-opus-4-7': mu(1000, 200, 900, 2.0),
      'claude-sonnet-4-6': mu(400, 80, 300, 1.0),
    });
    insertResult(db, 'run-1', 2, ts, {
      'claude-opus-4-7': mu(500, 100, 450, 2.0),
    });

    const models = db.getModelSpend(7);
    expect(models.map((m) => m.model)).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(models[0]).toMatchObject({
      model: 'claude-opus-4-7',
      inputTokens: 1500,
      outputTokens: 300,
      tokensTotal: 1800,
      cacheReadTokens: 1350,
      costUsd: 4,
    });
    expect(models[1]).toMatchObject({ model: 'claude-sonnet-4-6', inputTokens: 400, tokensTotal: 480, costUsd: 1 });
  });

  it('excludes results outside the window', () => {
    insertRun(db, 'run-old', tsDaysAgo(10));
    insertResult(db, 'run-old', 9, tsDaysAgo(10), { 'claude-opus-4-7': mu(100, 20, 0, 9) });
    insertRun(db, 'run-now', tsDaysAgo(0));
    insertResult(db, 'run-now', 1, tsDaysAgo(0), { 'claude-sonnet-4-6': mu(50, 10, 0, 1) });

    const models = db.getModelSpend(7);
    expect(models.map((m) => m.model)).toEqual(['claude-sonnet-4-6']);
  });

  it('reports the same model under different harnesses as distinct rows', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-1', ts);
    insertResult(db, 'run-1', 6, ts, { 'claude-opus-4-8': mu(1000, 200, 0, 6) }, { harness: 'claude-sdk' });
    insertResult(db, 'run-1', 4, ts, { 'claude-opus-4-8': mu(500, 100, 0, 4) }, { harness: 'pi', provider: 'openrouter' });

    const models = db.getModelSpend(7);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ model: 'claude-opus-4-8', harness: 'claude-sdk', provider: null, costUsd: 6 });
    expect(models[1]).toMatchObject({ model: 'claude-opus-4-8', harness: 'pi', provider: 'openrouter', costUsd: 4 });
  });

  it('returns null harness/provider for results without attribution', () => {
    const ts = tsDaysAgo(0);
    insertRun(db, 'run-legacy', ts);
    insertResult(db, 'run-legacy', 2, ts, { 'claude-opus-4-7': mu(100, 20, 0, 2) });

    const models = db.getModelSpend(7);
    expect(models[0]).toMatchObject({ harness: null, provider: null });
  });
});
