import { afterEach } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { openDatabase as openMonitorDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES, type EforgeEvent } from '@eforge-build/client';
import { useTempDir } from './test-tmpdir.js';

export const makeTempDir = useTempDir('eforge-extension-tooling-routes-');
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

export let server: MonitorServer | undefined;

const openDatabases = new Set<ReturnType<typeof openMonitorDatabase>>();

export function openDatabase(dbPath: string): ReturnType<typeof openMonitorDatabase> {
  const db = openMonitorDatabase(dbPath);
  openDatabases.add(db);
  return db;
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
  for (const db of openDatabases) {
    db.close();
  }
  openDatabases.clear();
  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }
});

export async function setupProject(tmpDir: string): Promise<void> {
  process.env.XDG_CONFIG_HOME = resolve(tmpDir, 'xdg-config');
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });

  execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], { cwd: tmpDir });

  await mkdir(resolve(tmpDir, 'eforge', 'extensions'), { recursive: true });
  await mkdir(resolve(tmpDir, '.eforge', 'extensions'), { recursive: true });
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), [
    'extensions:',
    '  enabled: true',
    '  exclude:',
    '    - excluded',
  ].join('\n'), 'utf-8');

  await writeFile(
    resolve(tmpDir, '.eforge', 'extensions', 'loaded.js'),
    'export default function extension(eforge) { eforge.registerInputSource({ name: "loaded-input", description: "loaded", fetch: async () => "ok" }); }',
    'utf-8',
  );
  await writeFile(
    resolve(tmpDir, 'eforge', 'extensions', 'loaded.js'),
    'export default function extension(eforge) { eforge.registerTool({ name: "shadow-tool", description: "shadow", inputSchema: { type: "object", properties: {} }, handler: () => "ok" }); }',
    'utf-8',
  );
  await writeFile(
    resolve(tmpDir, 'eforge', 'extensions', 'team.js'),
    'export default function extension(eforge) { eforge.registerInputSource({ name: "team-input", description: "team", fetch: async () => "ok" }); }',
    'utf-8',
  );
  await writeFile(resolve(tmpDir, '.eforge', 'extensions', 'bad.js'), 'export default 42;', 'utf-8');
  await writeFile(
    resolve(tmpDir, '.eforge', 'extensions', 'excluded.js'),
    'export default function extension() {}',
    'utf-8',
  );
}

export async function start(tmpDir: string): Promise<MonitorServer> {
  const db = openDatabase(resolve(tmpDir, '.eforge', 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });
  return server;
}

export async function startWithDatabase(
  db: ReturnType<typeof openDatabase>,
  tmpDir: string,
  options: Omit<NonNullable<Parameters<typeof startServer>[2]>, 'strictPort' | 'cwd'> = {},
): Promise<MonitorServer> {
  openDatabases.add(db);
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...options });
  return server;
}

export function replayEvent(type: 'config:warning' | 'plan:build:start', runId?: string): EforgeEvent {
  const timestamp = new Date().toISOString();
  if (type === 'config:warning') return { type, timestamp, ...(runId !== undefined && { runId }), message: 'warning', source: 'test' };
  return { type, timestamp, ...(runId !== undefined && { runId }), planId: 'plan-1' };
}

export function insertReplayRun(db: ReturnType<typeof openDatabase>, opts: { runId: string; sessionId: string; cwd: string; events: EforgeEvent[]; startedAt?: string }): void {
  db.insertRun({ id: opts.runId, sessionId: opts.sessionId, planSet: 'set', command: 'build', status: 'completed', startedAt: opts.startedAt ?? new Date().toISOString(), cwd: opts.cwd });
  for (const event of opts.events) {
    db.insertEvent({ runId: opts.runId, type: event.type, data: JSON.stringify(event), timestamp: event.timestamp });
  }
}

export function postExtensionTestRaw(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({
      hostname: 'localhost',
      port,
      path: API_ROUTES.extensionTest,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolveStatus(res.statusCode ?? 0));
    });
    req.on('error', rejectStatus);
    req.end(JSON.stringify({}));
  });
}

export function postTrustRaw(port: number, path: string, headers: Record<string, string>, body: unknown): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolveStatus(res.statusCode ?? 0));
    });
    req.on('error', rejectStatus);
    req.end(JSON.stringify(body));
  });
}

export { startServer };
