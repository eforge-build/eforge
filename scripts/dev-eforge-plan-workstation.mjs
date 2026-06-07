#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const lockfilePath = resolve(root, '.eforge', 'daemon.lock');
const pollIntervalMs = 250;
const startTimeoutMs = 15_000;

const forwardedArgs = process.argv.slice(2);
if (forwardedArgs[0] === '--') forwardedArgs.shift();

try {
  const daemonUrl = await resolveDaemonUrl();
  console.log(`[eforge-plan-workstation] using daemon ${daemonUrl}`);
  const child = spawn('pnpm', ['--filter', '@eforge-build/eforge-plan-workstation', 'dev', ...forwardedArgs], {
    cwd: root,
    env: { ...process.env, VITE_EFORGE_DAEMON_URL: daemonUrl },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function resolveDaemonUrl() {
  const existing = await readLiveLockfile();
  if (existing) return daemonUrl(existing.port);

  console.log('[eforge-plan-workstation] no live daemon found; starting eforge daemon...');
  const start = spawnSync('eforge', ['daemon', 'start'], { cwd: root, stdio: 'inherit' });
  if (start.status !== 0) {
    throw new Error(`eforge daemon start failed with exit code ${start.status ?? 'unknown'}`);
  }

  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    const lock = await readLiveLockfile();
    if (lock) return daemonUrl(lock.port);
    await sleep(pollIntervalMs);
  }

  throw new Error('Daemon failed to become healthy within 15s. Run `eforge daemon start` manually to diagnose.');
}

function daemonUrl(port) {
  return `http://127.0.0.1:${port}`;
}

async function readLiveLockfile() {
  const lock = await readLockfile();
  if (!lock) return null;
  return await isDaemonHealthy(lock.port) ? lock : null;
}

async function readLockfile() {
  try {
    const parsed = JSON.parse(await readFile(lockfilePath, 'utf8'));
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function isDaemonHealthy(port) {
  try {
    const response = await fetch(`${daemonUrl(port)}/api/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.status === 'ok';
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
