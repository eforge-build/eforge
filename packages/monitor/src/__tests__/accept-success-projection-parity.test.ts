import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { API_ROUTES, type DaemonStreamSnapshot, type RunInfo } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import { startServer, type MonitorServer } from '../server.js';
import { AutoBuildSupervisor } from '../auto-build-supervisor.js';
import { projectRunsForAcceptedSuccess } from '../projections/runs.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'eforge-accept-parity-')); }
function git(cwd: string, args: string[]): void { execFileSync('git', args, { cwd }); }

function initRepo(dir: string): void {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['commit', '--allow-empty', '-m', 'initial']);
  git(dir, ['checkout', '-b', 'eforge/accepted-set']);
  git(dir, ['commit', '--allow-empty', '-m', 'feature']);
  git(dir, ['checkout', 'main']);
}

function seedAcceptedSuccess(cwd: string, prdId: string): void {
  const failed = join(cwd, '.eforge', 'queue', 'failed');
  mkdirSync(failed, { recursive: true });
  writeFileSync(join(failed, `${prdId}.md`), `---\ntitle: ${prdId}\n---\n# ${prdId}\n`);
  writeFileSync(join(failed, `${prdId}.recovery.md`), 'recovery');
  writeFileSync(join(failed, `${prdId}.recovery.json`), JSON.stringify({
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    prdId,
    setName: 'accepted-set',
    verdict: { verdict: 'manual', confidence: 'low', rationale: 'manual', completedWork: [], remainingWork: [], risks: [] },
    report: { operatorSummary: 'manual', recommendedAction: 'Review manually.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
    boundedEvidence: {
      identity: { prdId, setName: 'accepted-set', featureBranch: 'eforge/accepted-set', baseBranch: 'main', failedAt: new Date().toISOString() },
      plans: [{ planId: 'plan-01', status: 'failed' }],
      failingPlan: { planId: 'plan-01' },
      landedCommits: [{ sha: 'abc', subject: 'work', author: 'Test', date: new Date().toISOString() }],
      diffStat: '',
      modelsUsed: [],
      acceptanceValidation: { passed: false, total: 1, pass: 0, fail: 1, unknown: 0, verdicts: [] },
      validationCommands: [{ command: 'true', exitCode: 0 }],
    },
    applied: { action: 'accepted-success', acceptedAt: '2026-01-01T00:00:00.000Z', reasonCategory: 'other', reason: 'ok', cleanup: { status: 'noop' }, landing: { action: 'leave', status: 'complete', branch: 'eforge/accepted-set' }, dependents: { unblocked: [], remainedBlocked: [], notFound: [] } },
  }, null, 2));
}

function firstHello(url: string): Promise<DaemonStreamSnapshot> {
  return new Promise((resolveSnapshot, reject) => {
    let buffer = '';
    const req = http.get(url, { headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const block = buffer.split(/\r?\n\r?\n/).find((part) => part.includes('event: stream:hello'));
        if (!block) return;
        req.destroy();
        const line = block.split(/\r?\n/).find((part) => part.startsWith('data: '));
        if (!line) reject(new Error('missing data line'));
        else resolveSnapshot(JSON.parse(line.slice(6)) as DaemonStreamSnapshot);
      });
    });
    req.on('error', () => {
      if (buffer.length === 0) reject(new Error('SSE failed'));
    });
    setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 2000).unref();
  });
}

describe('accepted-success projection parity', () => {
  let server: MonitorServer | undefined;
  afterEach(async () => { await server?.stop(); server = undefined; });

  it('reconciles failed runs to completed and matches REST/stream projections', async () => {
    const cwd = tmp(); initRepo(cwd); seedAcceptedSuccess(cwd, 'accepted-prd');
    const db = openDatabase(resolve(cwd, 'monitor.db'));
    db.insertRun({ id: 'run-1', planSet: 'accepted-set', command: 'build', status: 'failed', startedAt: '2025-01-01T00:00:00.000Z', cwd });
    server = await startServer(db, 0, { strictPort: true, cwd, daemonState: { autoBuildController: new AutoBuildSupervisor() } });

    const apply = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccess}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: 'accepted-prd', reasonCategory: 'other', reason: 'again', unblockDependentIds: [] }),
    });
    expect(apply.status).toBe(200);

    const runs = await (await fetch(`http://localhost:${server.port}${API_ROUTES.runs}`)).json();
    const queue = await (await fetch(`http://localhost:${server.port}${API_ROUTES.queue}`)).json();
    const hello = await firstHello(`http://localhost:${server.port}${API_ROUTES.daemonEvents}`);

    expect(runs.find((run: { id: string }) => run.id === 'run-1')?.status).toBe('completed');
    expect(queue.find((item: { id: string }) => item.id === 'accepted-prd')?.status).toBe('completed');
    expect(hello.runs).toEqual(runs);
    expect(hello.queue).toEqual(queue);
  });

  it('targets the failed run identified by failedAt and preserves its completedAt', () => {
    const cwd = tmp();
    const failed = join(cwd, '.eforge', 'queue', 'failed');
    mkdirSync(failed, { recursive: true });
    writeFileSync(join(failed, 'accepted-prd.recovery.json'), JSON.stringify({
      summary: { setName: 'accepted-set', failedAt: '2025-01-01T00:10:00.000Z' },
      applied: { action: 'accepted-success', acceptedAt: '2025-01-02T00:00:00.000Z', reasonCategory: 'other', reason: 'ok', cleanup: { status: 'noop' }, landing: { action: 'leave', status: 'complete', branch: 'eforge/accepted-set' }, dependents: { unblocked: [], remainedBlocked: [], notFound: [] } },
    }));
    const runs: RunInfo[] = [
      { id: 'old-failure', planSet: 'accepted-set', command: 'build', status: 'failed', startedAt: '2025-01-01T00:00:00.000Z', completedAt: '2025-01-01T00:10:00.000Z', cwd },
      { id: 'new-failure', planSet: 'accepted-set', command: 'build', status: 'failed', startedAt: '2025-01-03T00:00:00.000Z', completedAt: '2025-01-03T00:10:00.000Z', cwd },
    ];

    const projected = projectRunsForAcceptedSuccess(runs, join(cwd, '.eforge', 'queue'));

    expect(projected.find((run) => run.id === 'old-failure')).toMatchObject({ status: 'completed', completedAt: '2025-01-01T00:10:00.000Z' });
    expect(projected.find((run) => run.id === 'new-failure')).toMatchObject({ status: 'failed', completedAt: '2025-01-03T00:10:00.000Z' });
  });
});
