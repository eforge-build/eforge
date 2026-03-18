import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { evaluateStateCheck, type StateCheckContext } from '../src/monitor/server-main.js';

// We need to mock lockfile, isServerAlive, and openDatabase
// to test signalMonitorShutdown without real servers

vi.mock('../src/monitor/lockfile.js', () => ({
  readLockfile: vi.fn(),
  isServerAlive: vi.fn(),
}));

vi.mock('../src/monitor/db.js', () => ({
  openDatabase: vi.fn(),
}));

import { signalMonitorShutdown } from '../src/monitor/index.js';
import { readLockfile, isServerAlive } from '../src/monitor/lockfile.js';
import { openDatabase } from '../src/monitor/db.js';

const mockReadLockfile = vi.mocked(readLockfile);
const mockIsServerAlive = vi.mocked(isServerAlive);
const mockOpenDatabase = vi.mocked(openDatabase);

describe('signalMonitorShutdown', () => {
  const makeTempDir = useTempDir();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when lockfile is not found', async () => {
    const cwd = makeTempDir();
    mockReadLockfile.mockReturnValue(null);

    await signalMonitorShutdown(cwd);

    expect(mockReadLockfile).toHaveBeenCalledWith(cwd);
    expect(mockIsServerAlive).not.toHaveBeenCalled();
  });

  it('does nothing when server is not alive', async () => {
    const cwd = makeTempDir();
    mockReadLockfile.mockReturnValue({ pid: 99999, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(false);

    await signalMonitorShutdown(cwd);

    expect(mockIsServerAlive).toHaveBeenCalled();
    expect(mockOpenDatabase).not.toHaveBeenCalled();
  });

  it('does not send SIGTERM when runs are still active', async () => {
    const cwd = makeTempDir();
    const fakePid = process.pid; // Use own PID so it's definitely alive
    mockReadLockfile.mockReturnValue({ pid: fakePid, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(true);

    const fakeDb = {
      getRunningRuns: () => [{ id: 'run-1', status: 'running' }],
      close: vi.fn(),
    };
    mockOpenDatabase.mockReturnValue(fakeDb as unknown as ReturnType<typeof openDatabase>);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await signalMonitorShutdown(cwd);

    expect(fakeDb.close).toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('sends SIGTERM when server is alive with no running runs', async () => {
    const cwd = makeTempDir();
    const fakePid = 12345;
    mockReadLockfile.mockReturnValue({ pid: fakePid, port: 4567, startedAt: new Date().toISOString() });
    mockIsServerAlive.mockResolvedValue(true);

    const fakeDb = {
      getRunningRuns: () => [],
      close: vi.fn(),
    };
    mockOpenDatabase.mockReturnValue(fakeDb as unknown as ReturnType<typeof openDatabase>);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await signalMonitorShutdown(cwd);

    expect(fakeDb.close).toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(fakePid, 'SIGTERM');

    killSpy.mockRestore();
  });
});

describe('hasSeenActivity gate', () => {
  function makeContext(overrides: Partial<StateCheckContext> = {}): StateCheckContext {
    return {
      state: 'WATCHING',
      lastActivityTimestamp: Date.now(),
      hasSeenActivity: false,
      serverStartedAt: Date.now(),
      getRunningRuns: () => [],
      getLatestEventTimestamp: () => undefined,
      transitionToCountdown: vi.fn(),
      cancelCountdown: vi.fn(),
      ...overrides,
    };
  }

  it('does not transition to COUNTDOWN when hasSeenActivity is false and no events exist', () => {
    const serverStartedAt = Date.now();
    const ctx = makeContext({
      serverStartedAt,
      lastActivityTimestamp: serverStartedAt - 20_000, // idle for 20s
      getLatestEventTimestamp: () => undefined,
    });

    const result = evaluateStateCheck(ctx);

    expect(result.state).toBe('WATCHING');
    expect(result.hasSeenActivity).toBe(false);
    expect(ctx.transitionToCountdown).not.toHaveBeenCalled();
  });

  it('does not transition to COUNTDOWN when only pre-startup events exist', () => {
    const serverStartedAt = Date.now();
    const ctx = makeContext({
      serverStartedAt,
      lastActivityTimestamp: serverStartedAt - 20_000,
      getLatestEventTimestamp: () => new Date(serverStartedAt - 5000).toISOString(),
    });

    const result = evaluateStateCheck(ctx);

    expect(result.state).toBe('WATCHING');
    expect(result.hasSeenActivity).toBe(false);
    expect(ctx.transitionToCountdown).not.toHaveBeenCalled();
  });

  it('sets hasSeenActivity and evaluates idle logic when a post-startup event exists', () => {
    const serverStartedAt = Date.now() - 30_000; // started 30s ago
    const eventTimestamp = serverStartedAt + 5000; // event 5s after start
    const ctx = makeContext({
      serverStartedAt,
      lastActivityTimestamp: eventTimestamp, // last activity was the event
      getLatestEventTimestamp: () => new Date(eventTimestamp).toISOString(),
    });

    // Event is old enough that idle threshold is met
    const result = evaluateStateCheck(ctx);

    expect(result.hasSeenActivity).toBe(true);
    // 30s - 5s = 25s idle, which exceeds the 10s threshold
    expect(ctx.transitionToCountdown).toHaveBeenCalled();
    expect(result.state).toBe('COUNTDOWN');
  });

  it('does not transition when hasSeenActivity becomes true but idle threshold not met', () => {
    const serverStartedAt = Date.now() - 1000; // started 1s ago
    const eventTimestamp = Date.now(); // just now
    const ctx = makeContext({
      serverStartedAt,
      lastActivityTimestamp: eventTimestamp,
      getLatestEventTimestamp: () => new Date(eventTimestamp).toISOString(),
    });

    const result = evaluateStateCheck(ctx);

    expect(result.hasSeenActivity).toBe(true);
    expect(result.state).toBe('WATCHING');
    expect(ctx.transitionToCountdown).not.toHaveBeenCalled();
  });

  it('hasSeenActivity is a one-way latch — stays true once set', () => {
    const serverStartedAt = Date.now() - 5000;
    const ctx = makeContext({
      serverStartedAt,
      hasSeenActivity: true, // already true
      lastActivityTimestamp: Date.now(), // recent activity
      getLatestEventTimestamp: () => undefined, // no events now
    });

    const result = evaluateStateCheck(ctx);

    expect(result.hasSeenActivity).toBe(true);
  });
});
