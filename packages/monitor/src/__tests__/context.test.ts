import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { openDatabase } from '../db.js';
import { createMonitorContext } from '../context.js';

describe('createMonitorContext', () => {
  it('derives default paths and version metadata', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eforge-context-'));
    const db = openDatabase(':memory:');
    const ctx = await createMonitorContext(db, 4567, { cwd });
    expect(ctx.queuePaths).toMatchObject({
      relativeQueueDir: '.eforge/queue',
      queueDir: resolve(cwd, '.eforge/queue'),
      lockDir: resolve(cwd, '.eforge/queue-locks'),
      failedDir: resolve(cwd, '.eforge/queue/failed'),
      skippedDir: resolve(cwd, '.eforge/queue/skipped'),
      waitingDir: resolve(cwd, '.eforge/queue/waiting'),
    });
    expect(ctx.relativePlanOutputDir).toBe('eforge/plans');
    expect(ctx.planOutputDir).toBe(resolve(cwd, 'eforge/plans'));
    expect(ctx.versionInfo.pid).toBe(process.pid);
    db.close();
  });

  it('honors configured queue and plan paths', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eforge-context-'));
    const db = openDatabase(':memory:');
    const ctx = await createMonitorContext(db, 0, {
      cwd,
      queueDir: 'fallback-queue',
      planOutputDir: 'fallback-plans',
      config: {
        build: DEFAULT_CONFIG.build,
        monitor: DEFAULT_CONFIG.monitor,
        agents: DEFAULT_CONFIG.agents,
        prdQueue: { ...DEFAULT_CONFIG.prdQueue, dir: 'configured-queue' },
        plan: { ...DEFAULT_CONFIG.plan, outputDir: 'configured-plans' },
        maxConcurrentBuilds: 7,
      },
    });
    expect(ctx.queuePaths?.relativeQueueDir).toBe('configured-queue');
    expect(ctx.queuePaths?.queueDir).toBe(resolve(cwd, 'configured-queue'));
    expect(ctx.relativePlanOutputDir).toBe('configured-plans');
    expect(ctx.planOutputDir).toBe(resolve(cwd, 'configured-plans'));
    expect(ctx.getSchedulerLimit()).toBe(7);
    db.close();
  });

  it('uses db-backed helpers', async () => {
    const db = openDatabase(':memory:');
    const ctx = await createMonitorContext(db);
    db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'running', startedAt: new Date().toISOString(), cwd: process.cwd() });
    db.insertRun({ id: 'run-2', sessionId: 'session-2', planSet: 'set', command: 'build', status: 'completed', startedAt: new Date().toISOString(), cwd: process.cwd() });
    expect(ctx.resolveSessionId('run-1')).toBe('session-1');
    expect(ctx.resolveSessionId('unknown')).toBe('unknown');
    expect(ctx.getRunningBuildCount()).toBe(1);
    db.close();
  });

  it('captures git remote once and resolves config directories', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eforge-context-git-'));
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.test/repo.git'], { cwd });
    mkdirSync(join(cwd, 'eforge'), { recursive: true });
    writeFileSync(join(cwd, 'eforge', 'config.yaml'), 'build: {}\n');

    const db = openDatabase(':memory:');
    const ctx = await createMonitorContext(db, 4567, { cwd });

    execFileSync('git', ['remote', 'set-url', 'origin', 'https://example.test/changed.git'], { cwd });
    expect(ctx.cachedGitRemote).toBe('https://example.test/repo.git');
    expect(await ctx.getDiscoveredConfigDir()).toBe(join(cwd, 'eforge'));
    expect(await ctx.getConfigDirOrConventional()).toBe(join(cwd, 'eforge'));
    db.close();
  });

  it('delegates queue mutation notifications and falls back to conventional config dir', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eforge-context-conventional-'));
    const reasons: string[] = [];
    const db = openDatabase(':memory:');
    const ctx = await createMonitorContext(db, 4567, {
      cwd,
      daemonState: {
        autoBuildController: {
          notifyQueueMutation(reason: string) {
            reasons.push(reason);
          },
        },
      } as never,
    });

    ctx.notifyQueueMutation('external');
    expect(reasons).toEqual(['external']);
    expect(await ctx.getDiscoveredConfigDir()).toBeNull();
    expect(await ctx.getConfigDirOrConventional()).toBe(join(cwd, 'eforge'));
    db.close();
  });
});
