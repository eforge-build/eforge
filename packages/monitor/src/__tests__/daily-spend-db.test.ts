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

function insertResult(db: MonitorDB, runId: string, totalCostUsd: number, timestamp: string): void {
  db.insertEvent({
    runId,
    type: 'agent:result',
    data: JSON.stringify({
      type: 'agent:result',
      agent: 'builder',
      result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {} },
      timestamp,
    }),
    timestamp,
  });
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
