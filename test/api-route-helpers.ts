import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach } from 'vitest';
import type { WorkerTracker } from '@eforge-build/monitor/server';

let previousXdgConfigHome: string | undefined;
let hasIsolatedXdgConfigHome = false;

function isolateXdgConfigHome(tmpDir: string): void {
  if (!hasIsolatedXdgConfigHome) {
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    hasIsolatedXdgConfigHome = true;
  }
  process.env.XDG_CONFIG_HOME = resolve(tmpDir, 'xdg-config');
}

afterEach(() => {
  if (!hasIsolatedXdgConfigHome) return;
  if (previousXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  }
  previousXdgConfigHome = undefined;
  hasIsolatedXdgConfigHome = false;
});

export async function setupApiProject(tmpDir: string): Promise<{ configDir: string }> {
  isolateXdgConfigHome(tmpDir);
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  await writeFile(resolve(tmpDir, '.gitignore'), '.eforge/\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore'], gitOpts);
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], gitOpts);
  const configDir = resolve(tmpDir, 'eforge');
  await mkdir(resolve(tmpDir, 'xdg-config'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(resolve(configDir, 'config.yaml'), '{}\n', 'utf-8');
  return { configDir };
}

export function makeStubWorkerTracker(): WorkerTracker {
  return {
    spawnWorker(_command: string, _args: string[]): { sessionId: string; pid: number } {
      return { sessionId: 'stub-session', pid: 99999 };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };
}


export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
