/**
 * Tests for POST /api/stack/sync daemon route.
 *
 * Follows AGENTS.md conventions:
 * - Real SQLite DB via openDatabase. Real HTTP via startServer.
 * - Real temp git repos where git operations are needed.
 * - No mocks. Inputs constructed inline.
 *
 * Verifies:
 *   1. POST with stacking.enabled: false returns outcome: 'skipped', stackingActive: false,
 *      a non-empty reason, and an empty providerCommands array.
 *   2. POST with { dryRun: true } and stacking enabled returns dryRun: true and provider
 *      commands marked as not executed (ran: false).
 *   3. POST skips active-build branches from running DB runs and includes them in activeBuildSkips.
 *   4. POST with invalid dryRun value returns HTTP 400.
 *   5. POST without a configured cwd returns HTTP 503.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer } from '@eforge-build/monitor/server';
import type { DaemonState } from '@eforge-build/monitor/server';
import { AutoBuildSupervisor } from '@eforge-build/monitor/auto-build-supervisor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpCwd(suffix = 'eforge-stack-sync-route-'): string {
  const dir = mkdtempSync(join(tmpdir(), suffix));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

function writeStackingConfig(dir: string, enabled: boolean): void {
  mkdirSync(join(dir, 'eforge'), { recursive: true });
  writeFileSync(
    join(dir, 'eforge', 'config.yaml'),
    `stacking:\n  enabled: ${enabled}\n`,
    'utf-8',
  );
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), '# Test\n', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}

function makeDaemonState(): DaemonState {
  const supervisor = new AutoBuildSupervisor({
    initialState: {
      desired: 'disabled',
      mode: 'disabled',
      watcher: { running: false, pid: null, sessionId: null },
      scheduler: { alive: false, paused: false },
    },
    effects: {
      now: () => new Date().toISOString(),
      getWatcher: () => ({ running: false, pid: null, sessionId: null }),
      isSchedulerAlive: () => false,
      spawnWatcher: () => {},
      stopWatcher: () => {},
      restartWatcher: () => {},
      pauseScheduler: () => {},
      resumeScheduler: () => {},
      emitSchedulerMutation: () => {},
      emitEvent: () => {},
    },
  });
  return { autoBuildController: supervisor };
}

async function postStackSync(
  port: number,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${API_ROUTES.stackSync}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }
  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const servers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  for (const srv of servers) {
    await srv.stop().catch(() => {});
  }
  servers.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/stack/sync — stacking disabled', () => {
  it('(1) returns outcome: skipped, stackingActive: false, non-empty reason, empty providerCommands', async () => {
    const cwd = makeTmpCwd();
    writeStackingConfig(cwd, false);

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, daemonState: makeDaemonState() });
    servers.push(server);

    const { status, data } = await postStackSync(server.port, {});
    const resp = data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(resp.outcome).toBe('skipped');
    expect(resp.stackingActive).toBe(false);
    expect(typeof resp.reason).toBe('string');
    expect((resp.reason as string).length).toBeGreaterThan(0);
    expect(resp.providerCommands).toEqual([]);
    expect(resp.activeBuildSkips).toEqual([]);
  });
});

describe('POST /api/stack/sync — dry run', () => {
  it('(2) returns dryRun: true and provider commands with ran: false when stacking enabled', async () => {
    const cwd = makeTmpCwd();
    initGitRepo(cwd);
    writeStackingConfig(cwd, true);

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, daemonState: makeDaemonState() });
    servers.push(server);

    const { status, data } = await postStackSync(server.port, { dryRun: true });
    const resp = data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(resp.dryRun).toBe(true);
    expect(resp.stackingActive).toBe(true);

    const cmds = resp.providerCommands as Array<Record<string, unknown>>;
    expect(Array.isArray(cmds)).toBe(true);
    // At minimum the repo sync command should be present
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    for (const cmd of cmds) {
      expect(cmd.ran).toBe(false);
      expect(cmd.dryRun).toBe(true);
      expect(typeof cmd.command).toBe('string');
      expect(Array.isArray(cmd.args)).toBe(true);
    }
    // Verify the repo sync command is included
    const syncCmd = cmds.find((c) => (c.args as string[]).includes('sync'));
    expect(syncCmd).toBeDefined();
  });
});

describe('POST /api/stack/sync — active-build skip', () => {
  it('(3) skips active build branch from running DB run and includes it in activeBuildSkips', async () => {
    const cwd = makeTmpCwd();
    initGitRepo(cwd);
    writeStackingConfig(cwd, true);

    // Write a stack state file so the active build's branch prefix matches an actual stack candidate
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(cwd, '.eforge', 'stacks', 'layers.json'),
      JSON.stringify({
        version: 1,
        layers: [
          {
            prdId: 'my-feature',
            stackId: 'my-feature',
            provider: 'git-spice',
            branch: 'feature/my-feature',
            artifact: { branch: 'eforge/my-feature' },
            status: 'built',
            recordedAt: now,
            updatedAt: now,
          },
        ],
      }),
      'utf-8',
    );

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // Insert a running run to simulate an active build
    db.insertRun({
      id: 'run-active-001',
      sessionId: 'session-active-001',
      planSet: 'my-feature',
      command: 'build',
      status: 'running',
      startedAt: now,
      cwd: join(cwd, 'eforge', 'my-feature-worktrees', 'plan-01'),
      pid: process.pid,
    });

    const server = await startServer(db, 0, { cwd, daemonState: makeDaemonState() });
    servers.push(server);

    const { status, data } = await postStackSync(server.port, { dryRun: true });
    const resp = data as Record<string, unknown>;

    expect(status).toBe(200);

    const skips = resp.activeBuildSkips as Array<Record<string, unknown>>;
    expect(Array.isArray(skips)).toBe(true);
    // Only builds whose branches match actual stack candidates appear in activeBuildSkips
    expect(skips.length).toBeGreaterThan(0);

    // The skip for eforge/my-feature branch should be present (it matched the stack candidate)
    const featureSkip = skips.find((s) => (s.branch as string).includes('my-feature'));
    expect(featureSkip).toBeDefined();
    expect(typeof featureSkip!.reason).toBe('string');
  });
});

describe('POST /api/stack/sync — validation', () => {
  it('(4) returns 400 when dryRun is not a boolean', async () => {
    const cwd = makeTmpCwd();
    writeStackingConfig(cwd, false);

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd, daemonState: makeDaemonState() });
    servers.push(server);

    const { status } = await postStackSync(server.port, { dryRun: 'yes' });
    expect(status).toBe(400);
  });

  it('(5) returns 503 when no cwd is configured', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    // Start server without cwd option
    const server = await startServer(db, 0, { daemonState: makeDaemonState() });
    servers.push(server);

    const { status } = await postStackSync(server.port, {});
    expect(status).toBe(503);
  });
});
